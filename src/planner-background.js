import { decode as decodePng, init as initPngDecode } from "@jsquash/png/decode.js";
import decodeJpeg, { init as initJpegDecode } from "@jsquash/jpeg/decode.js";
import decodeWebP, { init as initWebPDecode } from "@jsquash/webp/decode.js";
import encodeWebPImage, { init as initWebPEncode } from "@jsquash/webp/encode.js";
import pngDecodeWasm from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm";
import jpegDecodeWasm from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
import webpDecodeWasm from "@jsquash/webp/codec/dec/webp_dec.wasm";
import webpEncodeWasm from "@jsquash/webp/codec/enc/webp_enc.wasm";
import {
    commitPlannerCompactQueueSlot,
    deferPlannerCompactQueueSlot,
    failPlannerCompactGeneration,
    getPlannerCompactRateLimit,
    markPlannerCompactQueueExecution,
    preparePlannerCompactQueueSlot,
    putPlannerCompactRateLimit,
    recordPlannerCompactSlotFailure,
    recoverStalledPlannerCompactRuns
} from "./planner-compact.js";
import {
    buildNovelAiBaseParameters,
    getNovelAiModelProfile,
    normalizeNovelAiModelId
} from "../public/js/nai-models.js";
import {
    classifyPlannerGenerationError,
    getPlannerRetryDelaySeconds,
    isNovelAiRateLimitError
} from "./planner-retry-policy.js";

const NAI_ENDPOINT = "https://image.novelai.net/ai/generate-image";
const QUALITY_TAGS = "masterpiece, best quality, very aesthetic, no text";
const DEFAULT_NEGATIVE_PROMPT = "";
const R2_PUT_MAX_ATTEMPTS = 4;
const PLANNER_COMPACT_MAX_ATTEMPTS = 3;
const PLANNER_SLOT_REGENERATION_ATTEMPTS = 3;
const NOVELAI_REQUEST_TIMEOUT_MS = 8 * 60 * 1000;
const PLANNER_EXECUTION_LEASE_MS = NOVELAI_REQUEST_TIMEOUT_MS + (2 * 60 * 1000);
const PLANNER_MAX_SLOTS_PER_INVOCATION = 2;
const PLANNER_CONTINUATION_START_LIMIT_MS = 3 * 60 * 1000;

function stampPlannerQueueMessage(message = {}, options = {}) {
    const publishedAtMs = Date.now();
    const scheduledDelayMs = Math.max(0, Number(options.delaySeconds || 0) * 1000);
    return {
        ...message,
        queuePublishedAt: new Date(publishedAtMs).toISOString(),
        queueEligibleAt: new Date(publishedAtMs + scheduledDelayMs).toISOString(),
        scheduledDelayMs,
        dispatchReason: String(options.dispatchReason || (scheduledDelayMs > 0 ? "retry_delay" : "queue"))
    };
}

async function sendPlannerQueueMessage(env, message, options = {}) {
    const stamped = stampPlannerQueueMessage(message, options);
    const delaySeconds = Math.max(0, Number(options.delaySeconds || 0));
    await env.GENERATION_QUEUE.send(stamped, delaySeconds > 0 ? { delaySeconds } : undefined);
    return stamped;
}

export function jsonResponse(data, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");
    return new Response(JSON.stringify(data), { ...init, headers });
}

function requireWorkerBindings(env) {
    const missing = [];
    if (!env.DB) missing.push("DB");
    if (!env.imgBucket) missing.push("imgBucket");
    if (!env.NOVELAI_TOKEN) missing.push("NOVELAI_TOKEN");
    if (missing.length) {
        throw new Error(`Missing Cloudflare binding(s): ${missing.join(", ")}`);
    }
}

function getKstDateParts(date = new Date()) {
    const kstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
    const pad = value => String(value).padStart(2, "0");
    const padMs = value => String(value).padStart(3, "0");
    return {
        year: kstDate.getUTCFullYear(),
        month: pad(kstDate.getUTCMonth() + 1),
        day: pad(kstDate.getUTCDate()),
        hour: pad(kstDate.getUTCHours()),
        minute: pad(kstDate.getUTCMinutes()),
        second: pad(kstDate.getUTCSeconds()),
        millisecond: padMs(kstDate.getUTCMilliseconds())
    };
}

function nowKstIso(date = new Date()) {
    const parts = getKstDateParts(date);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.millisecond}+09:00`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function makeRetriedStorageError(error, key) {
    const message = error?.message || String(error || "Unknown R2 put error");
    const retried = new Error(`R2 put failed after ${R2_PUT_MAX_ATTEMPTS} attempts for ${key}: ${message}`);
    retried.code = "R2_PUT_RETRY_EXHAUSTED";
    retried.cause = error;
    return retried;
}

function getR2PutRetryDelayMs(attempt) {
    return Math.min(1000 * (2 ** Math.max(attempt - 1, 0)), 8000);
}

function isRetriableR2PutError(error) {
    const message = error?.message || String(error || "");
    return message.includes("(10001)")
        || message.includes("(10043)")
        || message.includes("(10058)")
        || message.includes("InternalError")
        || message.includes("ServiceUnavailable")
        || message.includes("TooManyRequests")
        || message.includes("internal error");
}

async function putR2WithRetry(bucket, key, value, options = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= R2_PUT_MAX_ATTEMPTS; attempt += 1) {
        try {
            return await bucket.put(key, value, options);
        } catch (error) {
            lastError = error;
            if (!isRetriableR2PutError(error) || attempt >= R2_PUT_MAX_ATTEMPTS) break;
            await sleep(getR2PutRetryDelayMs(attempt));
        }
    }
    throw makeRetriedStorageError(lastError, key);
}

function makeLogKey(jobId = "unknown") {
    const parts = getKstDateParts();
    const day = `${parts.year}${parts.month}${parts.day}`;
    const stamp = `${day}_${parts.hour}${parts.minute}${parts.second}_${crypto.randomUUID().slice(0, 8)}`;
    return `logs/background-generation/${day}/${stamp}_${jobId}.log`;
}

export async function writeBackgroundErrorLog(env, error, context = {}) {
    if (!env?.imgBucket) return;
    try {
        const message = error?.message || String(error || "Unknown error");
        const stack = error?.stack || message;
        const contextText = Object.entries(context || {})
            .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
            .join("\n");
        const logText = [
            `[${nowKstIso()}] background-generation-error`,
            "",
            "Message:",
            message,
            "",
            "StackTrace:",
            stack,
            "",
            "Context:",
            contextText || "(none)",
            ""
        ].join("\n");
        await env.imgBucket.put(makeLogKey(context.jobId), logText, {
            httpMetadata: { contentType: "text/plain; charset=utf-8" },
            customMetadata: {
                ispublic: "false",
                kind: "background-generation-error",
                jobid: String(context.jobId || "")
            }
        });
    } catch {
        // Avoid masking the original failure if logging itself fails.
    }
}






function parsePositiveInt(value, fallback = 1) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}





function parseResolution(value) {
    const [width, height] = String(value || "832x1216").split("x").map(Number);
    return {
        width: Number.isFinite(width) ? width : 832,
        height: Number.isFinite(height) ? height : 1216
    };
}




function getPromptParts(generation = {}) {
    const prompts = generation.prompts || {};
    if (generation.simpleMode && prompts["prompt-raw"]) {
        return [prompts["prompt-raw"]];
    }
    const ids = [
        "prompt-style",
        "prompt-composition",
        "prompt-character",
        "prompt-clothing",
        "prompt-expression",
        "prompt-action",
        "prompt-background"
    ];
    return ids.map(id => String(prompts[id] || "").trim()).filter(Boolean);
}

function combinePromptSegments(...parts) {
    return parts
        .map(part => String(part || "").trim())
        .filter(Boolean)
        .join(", ");
}

function getGenerationQualityTags(generation = {}) {
    if (generation.useQualityTags === false) return "";
    return generation.qualityTags === undefined ? QUALITY_TAGS : String(generation.qualityTags || "").trim();
}

function getGenerationDefaultNegativePrompt(generation = {}) {
    if (generation.useDefaultNegativePrompt === false) return "";
    return generation.defaultNegativePrompt === undefined ? DEFAULT_NEGATIVE_PROMPT : String(generation.defaultNegativePrompt || "").trim();
}

function getSplitPrompts(generation = {}) {
    const fields = generation.fields || {};
    const prompts = generation.prompts || {};
    const splitPrompts = {
        style: fields.style || prompts["prompt-style"] || "",
        composition: fields.composition || prompts["prompt-composition"] || "",
        character: fields.character || prompts["prompt-character"] || "",
        clothing: fields.clothing || prompts["prompt-clothing"] || "",
        expression: fields.expression || prompts["prompt-expression"] || "",
        action: fields.action || prompts["prompt-action"] || "",
        background: fields.background || prompts["prompt-background"] || ""
    };
    Object.keys(splitPrompts).forEach(key => {
        if (!splitPrompts[key]) delete splitPrompts[key];
    });
    return splitPrompts;
}

function buildNovelAiPayload(generation = {}, seed) {
    const promptParts = getPromptParts(generation);
    const prompt = combinePromptSegments(promptParts.join(", "), getGenerationQualityTags(generation));
    const negative = combinePromptSegments(getGenerationDefaultNegativePrompt(generation), generation.negative);
    const { width, height } = parseResolution(generation.res);
    const model = normalizeNovelAiModelId(generation.model);
    const profile = getNovelAiModelProfile(model);
    const steps = parsePositiveInt(generation.steps, profile.defaultSteps);
    const scale = Number.parseFloat(generation.scale || String(profile.defaultScale)) || profile.defaultScale;
    const sampler = generation.sampler || profile.defaultSampler;
    const base = buildNovelAiBaseParameters({
        model,
        width,
        height,
        steps,
        sampler,
        scale,
        negativePrompt: negative,
        seed,
        sm: generation.sm,
        smDyn: generation.sm_dyn
    });

    const payload = {
        input: prompt,
        model,
        action: "generate",
        parameters: base.parameters
    };
    if (profile.family === "v5") payload.use_new_shared_trial = true;

    const rows = Array.isArray(generation.v4PromptCharacters) ? generation.v4PromptCharacters : [];
    const charCaptions = rows
        .map(row => [row.subject, row.clothing, row.expression, row.action].filter(Boolean).join(", "))
        .filter(Boolean)
        .map(char_caption => ({ char_caption, centers: [{ x: 0.5, y: 0.5 }] }));
    const negativeCaptions = rows
        .map(row => String(row.negative || "").trim())
        .filter(Boolean)
        .map(char_caption => ({ char_caption, centers: [{ x: 0.5, y: 0.5 }] }));

    if (profile.supportsStructuredPrompt) {
        payload.parameters.v4_prompt = {
            caption: { base_caption: prompt, char_captions: charCaptions },
            use_coords: charCaptions.length > 0,
            use_order: true
        };
        payload.parameters.v4_negative_prompt = {
            caption: { base_caption: negative, char_captions: negativeCaptions }
        };
    }

    return { payload, prompt, splitPrompts: getSplitPrompts(generation), negative, width, height, model, steps, sampler, scale };
}

async function queryAll(db, sql, ...params) {
    const statement = db.prepare(sql);
    const result = params.length ? await statement.bind(...params).all() : await statement.all();
    return result.results || [];
}

async function callNovelAi(env, payload) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NOVELAI_REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(NAI_ENDPOINT, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${env.NOVELAI_TOKEN}`,
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "application/x-zip-compressed",
                "Origin": "https://novelai.net",
                "Referer": "https://novelai.net/"
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        if (!res.ok) {
            const text = await res.text();
            const error = new Error(`[NovelAI ${res.status}] ${text}`);
            error.status = res.status;
            const retryAfter = Number.parseInt(res.headers.get("Retry-After") || "", 10);
            if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterSeconds = retryAfter;
            throw error;
        }
        return await res.arrayBuffer();
    } catch (error) {
        if (error?.name === "AbortError") {
            const timeoutError = new Error(`NovelAI request timed out after ${Math.round(NOVELAI_REQUEST_TIMEOUT_MS / 1000)} seconds`);
            timeoutError.code = "NOVELAI_REQUEST_TIMEOUT";
            throw timeoutError;
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

function readString(view, offset, length) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
    return new TextDecoder().decode(bytes);
}

async function inflateRaw(buffer) {
    if (typeof DecompressionStream === "undefined") {
        throw new Error("This runtime does not support DecompressionStream");
    }
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(stream).arrayBuffer();
}

async function extractFirstZipFile(zipBuffer) {
    const view = new DataView(zipBuffer);
    let eocd = -1;
    for (let i = view.byteLength - 22; i >= 0; i -= 1) {
        if (view.getUint32(i, true) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error("Invalid zip: EOCD not found");

    const centralDirectoryOffset = view.getUint32(eocd + 16, true);
    const totalEntries = view.getUint16(eocd + 10, true);
    let offset = centralDirectoryOffset;

    for (let entry = 0; entry < totalEntries; entry += 1) {
        if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Invalid zip: central directory is corrupt");
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const fileNameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);
        const fileName = readString(view, offset + 46, fileNameLength);

        offset += 46 + fileNameLength + extraLength + commentLength;
        if (!fileName || fileName.endsWith("/")) continue;

        if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
            throw new Error("Invalid zip: local header is corrupt");
        }
        const localNameLength = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
        const compressed = zipBuffer.slice(dataStart, dataStart + compressedSize);
        const data = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null;
        if (!data) throw new Error(`Unsupported zip compression method: ${method}`);
        if (uncompressedSize && data.byteLength !== uncompressedSize) {
            throw new Error("Invalid zip: extracted file size mismatch");
        }
        return { fileName, data };
    }

    throw new Error("Invalid zip: no files found");
}

let imageCodecsReadyPromise;

function detectImageFormat(buffer) {
    const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 16));
    if (bytes.length >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4E
        && bytes[3] === 0x47
        && bytes[4] === 0x0D
        && bytes[5] === 0x0A
        && bytes[6] === 0x1A
        && bytes[7] === 0x0A) {
        return "png";
    }
    if (bytes.length >= 3
        && bytes[0] === 0xFF
        && bytes[1] === 0xD8
        && bytes[2] === 0xFF) {
        return "jpeg";
    }
    if (bytes.length >= 12
        && bytes[0] === 0x52
        && bytes[1] === 0x49
        && bytes[2] === 0x46
        && bytes[3] === 0x46
        && bytes[8] === 0x57
        && bytes[9] === 0x45
        && bytes[10] === 0x42
        && bytes[11] === 0x50) {
        return "webp";
    }
    return "";
}

async function initImageCodecs() {
    if (!imageCodecsReadyPromise) {
        imageCodecsReadyPromise = Promise.all([
            initPngDecode(pngDecodeWasm),
            initJpegDecode(jpegDecodeWasm),
            initWebPDecode(webpDecodeWasm),
            initWebPEncode(webpEncodeWasm)
        ]);
    }
    await imageCodecsReadyPromise;
}

async function decodeGeneratedImage(imageBuffer, format) {
    await initImageCodecs();
    if (format === "png") return await decodePng(imageBuffer);
    if (format === "jpeg") return await decodeJpeg(imageBuffer);
    if (format === "webp") return await decodeWebP(imageBuffer);
    throw new Error(`Unsupported image format for WebP conversion: ${format || "unknown"}`);
}

async function encodeWebP(env, imageBuffer) {
    if (!(imageBuffer instanceof ArrayBuffer) || imageBuffer.byteLength === 0) {
        throw new Error("WebP conversion failed: empty image buffer");
    }
    const format = detectImageFormat(imageBuffer);
    const decoded = await decodeGeneratedImage(imageBuffer, format);
    if (!decoded?.data || !decoded.width || !decoded.height) {
        throw new Error(`WebP conversion failed: decoded ${format || "unknown"} image is invalid`);
    }
    const maxPixels = 2048 * 2048;
    if (decoded.width * decoded.height > maxPixels) {
        throw new Error(`WebP conversion failed: image is too large (${decoded.width}x${decoded.height})`);
    }
    await initImageCodecs();
    return await encodeWebPImage(decoded, { quality: 80 });
}

async function cleanupDeletedAssets(env, olderThanHours = 24, limit = 100) {
    if (!env?.DB || !env?.imgBucket) return { scanned: 0, deletedCount: 0, failedCount: 0 };
    const cutoff = nowKstIso(new Date(Date.now() - olderThanHours * 60 * 60 * 1000));
    const rows = await queryAll(env.DB, `
        SELECT id, r2_key
        FROM v2_assets
        WHERE status = 'deleted'
          AND deleted_at IS NOT NULL
          AND deleted_at < ?
        ORDER BY deleted_at
        LIMIT ?
    `, cutoff, limit);
    let deletedCount = 0;
    let failedCount = 0;
    for (const row of rows) {
        try {
            await env.imgBucket.delete(row.r2_key);
            await env.DB.prepare("DELETE FROM v2_assets WHERE id = ? AND status = 'deleted'")
                .bind(row.id).run();
            deletedCount += 1;
        } catch {
            failedCount += 1;
        }
    }
    return { scanned: rows.length, deletedCount, failedCount };
}


export async function processPlannerQueueMessage(env, message, options = {}) {
    if (message?.plannerCompact) {
        return await processPlannerCompactQueueMessage(env, message, options);
    }
    throw new Error("Unknown planner queue message.");
}

function makePlannerCompactSeed(generation, imageIndex) {
    const configured = Number.parseInt(generation?.seed, 10);
    if (Number.isFinite(configured)) return (configured + Number(imageIndex || 0)) % 4294967296;
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0];
}

async function getPlannerCompactCooldown(env) {
    const rate = await getPlannerCompactRateLimit(env, "novelai");
    const waitMs = Math.max(0, Number(rate?.availableAt || 0) - Date.now());
    return {
        rate,
        delaySeconds: waitMs > 0 ? Math.max(1, Math.ceil(waitMs / 1000)) : 0
    };
}

export async function processPlannerCompactQueueMessage(env, body = {}, options = {}) {
    requireWorkerBindings(env);
    const cycleStartedAt = Date.now();
    const queueReceivedAt = new Date().toISOString();
    const prepared = await preparePlannerCompactQueueSlot(env, body);
    if (prepared.disposition !== "process") return prepared;

    const attempt = Math.max(1, Number(options.attempts || 1), Number(body.attempt || 1));
    const slot = prepared.slot;
    const queuePublishedAtMs = Date.parse(String(body.queuePublishedAt || ""));
    const queueEligibleAtMs = Date.parse(String(body.queueEligibleAt || body.queuePublishedAt || ""));
    const queueReceivedAtMs = Date.parse(queueReceivedAt);
    const timing = {
        assetId: slot.assetId,
        globalImageIndex: slot.globalImageIndex,
        generationSequence: slot.generationSequence,
        dispatchReason: String(body.dispatchReason || (options.directContinuation ? "direct_continuation" : "queue")),
        scheduledDelayMs: Math.max(0, Number(body.scheduledDelayMs || 0)),
        totalQueueWaitMs: Number.isFinite(queuePublishedAtMs) ? Math.max(0, queueReceivedAtMs - queuePublishedAtMs) : 0,
        eligibleQueueWaitMs: Number.isFinite(queueEligibleAtMs) ? Math.max(0, queueReceivedAtMs - queueEligibleAtMs) : 0,
        queueWaitMs: Number.isFinite(queueEligibleAtMs) ? Math.max(0, queueReceivedAtMs - queueEligibleAtMs) : 0,
        novelAiMs: 0,
        imageProcessingMs: 0,
        storageMs: 0,
        cycleMs: 0,
        measuredAt: "",
        completedAt: ""
    };
    const executionBase = {
        assetId: slot.assetId,
        globalImageIndex: slot.globalImageIndex,
        traceId: body.traceId || options.messageId || crypto.randomUUID(),
        queuePublishedAt: body.queuePublishedAt || "",
        queueReceivedAt,
        leaseUntil: new Date(Date.now() + PLANNER_EXECUTION_LEASE_MS).toISOString(),
        deliveryAttempt: attempt
    };
    const claimed = await markPlannerCompactQueueExecution(env, body, {
        ...executionBase,
        phase: "preparing",
        stageLabel: "Preparing image generation"
    });
    if (claimed.stale) return { disposition: "ack", reason: "state_changed" };
    const request = buildNovelAiPayload(
        prepared.generation,
        makePlannerCompactSeed(prepared.generation, slot.globalImageIndex)
    );
    let object = await env.imgBucket.head(slot.r2Key);
    const objectGenerationSequence = Number.parseInt(object?.customMetadata?.generationSequence, 10);
    const reusableObject = Boolean(
        object
        && object.customMetadata?.assetId === slot.assetId
        && Number.isFinite(objectGenerationSequence)
        && objectGenerationSequence === slot.generationSequence
    );

    let slotCommitted = false;
    try {
        if (!reusableObject) {
            const cooldown = await getPlannerCompactCooldown(env);
            if (cooldown.delaySeconds > 0) {
                const deferred = await deferPlannerCompactQueueSlot(env, {
                    runKey: prepared.runKey,
                    jobId: prepared.jobId,
                    assetId: slot.assetId,
                    generationSequence: slot.generationSequence
                }, {
                    kind: "rate_limit",
                    errorMessage: "NovelAI cooldown is active.",
                    nextRetryAt: new Date(Date.now() + cooldown.delaySeconds * 1000).toISOString()
                });
                if (deferred.nextMessage && env.GENERATION_QUEUE) {
                    await sendPlannerQueueMessage(env, deferred.nextMessage, {
                        delaySeconds: cooldown.delaySeconds,
                        dispatchReason: "rate_limit_cooldown"
                    });
                }
                return { disposition: "ack", status: deferred.status };
            }

            await markPlannerCompactQueueExecution(env, body, {
                ...executionBase,
                phase: "novelai_request",
                stageLabel: "Waiting for NovelAI"
            });
            const novelAiStartedAt = Date.now();
            const zipBuffer = await callNovelAi(env, request.payload);
            timing.novelAiMs = Date.now() - novelAiStartedAt;
            if (Number(cooldown.rate?.strikeCount || 0) > 0 || Number(cooldown.rate?.availableAt || 0) > 0) {
                await putPlannerCompactRateLimit(env, {
                    key: "novelai",
                    availableAt: 0,
                    strikeCount: 0,
                    lastLimitedAt: cooldown.rate?.lastLimitedAt || "",
                    lastMessageId: "",
                    reason: ""
                });
            }
            await markPlannerCompactQueueExecution(env, body, {
                ...executionBase,
                phase: "image_processing",
                stageLabel: "Processing generated image"
            });
            const imageProcessingStartedAt = Date.now();
            const extracted = await extractFirstZipFile(zipBuffer);
            const webpBuffer = await encodeWebP(env, extracted.data);
            timing.imageProcessingMs = Date.now() - imageProcessingStartedAt;
            await markPlannerCompactQueueExecution(env, body, {
                ...executionBase,
                phase: "storage",
                stageLabel: "Saving generated image"
            });
            const storageStartedAt = Date.now();
            await putR2WithRetry(env.imgBucket, slot.r2Key, webpBuffer, {
                httpMetadata: { contentType: "image/webp" },
                customMetadata: {
                    ispublic: "false",
                    visibilityconfigured: "true",
                    visibilitysource: "system",
                    plannerCompact: "true",
                    assetId: slot.assetId,
                    generationSequence: String(slot.generationSequence),
                    width: String(request.width || 0),
                    height: String(request.height || 0)
                }
            });
            timing.storageMs = Date.now() - storageStartedAt;
            object = {
                size: webpBuffer.byteLength,
                httpMetadata: { contentType: "image/webp" },
                customMetadata: {
                    assetId: slot.assetId,
                    generationSequence: String(slot.generationSequence),
                    width: String(request.width || 0),
                    height: String(request.height || 0)
                }
            };
        }

        timing.cycleMs = Date.now() - cycleStartedAt;
        timing.measuredAt = new Date().toISOString();
        timing.completedAt = timing.measuredAt;
        const commitStartedAt = Date.now();
        const committed = await commitPlannerCompactQueueSlot(env, {
            runKey: prepared.runKey,
            jobId: prepared.jobId,
            assetId: slot.assetId,
            generationSequence: slot.generationSequence
        }, {
            r2Key: slot.r2Key,
            width: Number(object.customMetadata?.width || request.width || 0),
            height: Number(object.customMetadata?.height || request.height || 0),
            byteSize: Number(object.size || 0),
            mimeType: object.httpMetadata?.contentType || "image/webp",
            timing
        });
        slotCommitted = true;
        const completedTiming = {
            ...timing,
            commitMs: Date.now() - commitStartedAt,
            cycleMs: Date.now() - cycleStartedAt
        };
        console.log(JSON.stringify({
            event: "planner_slot_completed",
            jobId: prepared.jobId,
            traceId: executionBase.traceId,
            deliveryAttempt: attempt,
            directContinuation: Boolean(options.directContinuation),
            ...completedTiming
        }));
        if (committed.nextMessage && env.GENERATION_QUEUE && options.dispatchNext !== false) {
            await sendPlannerQueueMessage(env, committed.nextMessage, { dispatchReason: "next_slot" });
        }
        return {
            disposition: "ack",
            status: committed.status,
            nextMessage: committed.nextMessage,
            terminal: committed.terminal,
            timing: completedTiming
        };
    } catch (error) {
        if (slotCommitted) throw error;
        const message = error?.message || String(error);
        const retryDelaySeconds = getPlannerRetryDelaySeconds(error, attempt);
        if (error?.code === "PLANNER_REVISION_CONFLICT"
            || error?.code === "PLANNER_COMPACT_SCHEMA_MISSING"
            || error?.code === "PLANNER_COMPACT_RECORD_CORRUPT") {
            await writeBackgroundErrorLog(env, error, {
                runKey: prepared.runKey,
                jobId: prepared.jobId,
                assetId: slot.assetId,
                attempt,
                stage: "planner_compact_state_commit"
            });
            if (attempt < PLANNER_COMPACT_MAX_ATTEMPTS) {
                return { disposition: "retry", delaySeconds: 15 };
            }
            throw error;
        }
        if (isNovelAiRateLimitError(error)) {
            const currentRateResult = await Promise.allSettled([
                getPlannerCompactRateLimit(env, "novelai")
            ]);
            const currentRate = currentRateResult[0].status === "fulfilled"
                ? currentRateResult[0].value
                : null;
            const messageId = String(options.messageId || "");
            const duplicateDelivery = Boolean(messageId && currentRate?.lastMessageId === messageId);
            const strikeCount = duplicateDelivery
                ? Math.max(1, Number(currentRate?.strikeCount || 1))
                : Math.max(1, Number(currentRate?.strikeCount || 0) + 1);
            const rateLimitDelaySeconds = getPlannerRetryDelaySeconds(error, strikeCount);
            const deferred = await deferPlannerCompactQueueSlot(env, {
                runKey: prepared.runKey,
                jobId: prepared.jobId,
                assetId: slot.assetId,
                generationSequence: slot.generationSequence
            }, {
                kind: "rate_limit",
                errorMessage: message,
                nextRetryAt: new Date(Date.now() + rateLimitDelaySeconds * 1000).toISOString()
            });
            await Promise.allSettled([
                putPlannerCompactRateLimit(env, {
                    key: "novelai",
                    availableAt: Date.now() + rateLimitDelaySeconds * 1000,
                    strikeCount,
                    lastLimitedAt: new Date().toISOString(),
                    lastMessageId: messageId,
                    reason: "rate_limit"
                }),
                writeBackgroundErrorLog(env, error, {
                    runKey: prepared.runKey,
                    jobId: prepared.jobId,
                    itemId: slot.itemId,
                    assetId: slot.assetId,
                    imageIndex: slot.globalImageIndex,
                    attempt,
                    strikeCount,
                    stage: "planner_compact_rate_limit"
                })
            ]);
            if (deferred.nextMessage && env.GENERATION_QUEUE) {
                await sendPlannerQueueMessage(env, deferred.nextMessage, {
                    delaySeconds: rateLimitDelaySeconds,
                    dispatchReason: "rate_limit_retry"
                });
            }
            return { disposition: "ack", status: deferred.status };
        }

        const errorKind = classifyPlannerGenerationError(error);
        await writeBackgroundErrorLog(env, error, {
            runKey: prepared.runKey,
            jobId: prepared.jobId,
            itemId: slot.itemId,
            assetId: slot.assetId,
            imageIndex: slot.globalImageIndex,
            attempt,
            errorKind,
            stage: "planner_compact_generation"
        });
        if (errorKind === "fatal") {
            const failed = await failPlannerCompactGeneration(env, {
                runKey: prepared.runKey,
                jobId: prepared.jobId,
                generationSequence: slot.generationSequence
            }, {
                kind: errorKind,
                errorMessage: message
            });
            return { disposition: "ack", status: failed.status };
        }
        if (attempt < PLANNER_COMPACT_MAX_ATTEMPTS) {
            const deferred = await deferPlannerCompactQueueSlot(env, {
                runKey: prepared.runKey,
                jobId: prepared.jobId,
                assetId: slot.assetId,
                generationSequence: slot.generationSequence
            }, {
                kind: errorKind,
                errorMessage: message,
                nextRetryAt: new Date(Date.now() + retryDelaySeconds * 1000).toISOString()
            });
            if (deferred.nextMessage && env.GENERATION_QUEUE) {
                await sendPlannerQueueMessage(env, {
                    ...deferred.nextMessage,
                    attempt: attempt + 1
                }, { delaySeconds: retryDelaySeconds, dispatchReason: "transient_retry" });
            }
            return { disposition: "ack", status: deferred.status };
        }
        const nextRetryDelaySeconds = errorKind === "storage" ? 120 : 60;
        const failed = await recordPlannerCompactSlotFailure(env, {
            runKey: prepared.runKey,
            jobId: prepared.jobId,
            assetId: slot.assetId,
            generationSequence: slot.generationSequence
        }, {
            kind: errorKind,
            errorMessage: message,
            failureToken: options.messageId,
            maxAttempts: PLANNER_SLOT_REGENERATION_ATTEMPTS,
            nextRetryAt: new Date(Date.now() + nextRetryDelaySeconds * 1000).toISOString()
        });
        if (failed.nextMessage && env.GENERATION_QUEUE) {
            await sendPlannerQueueMessage(env,
                failed.nextMessage,
                failed.retrying
                    ? { delaySeconds: nextRetryDelaySeconds, dispatchReason: "slot_regeneration" }
                    : { dispatchReason: "next_slot_after_failure" }
            );
        }
        return { disposition: "ack", status: failed.status };
    }
}

export async function processPlannerCompactQueueBurst(env, initialBody = {}, options = {}) {
    const invocationStartedAt = Date.now();
    let body = initialBody;
    let lastResult = null;

    for (let slotCount = 0; slotCount < PLANNER_MAX_SLOTS_PER_INVOCATION; slotCount += 1) {
        try {
            lastResult = await processPlannerCompactQueueMessage(env, body, {
                ...options,
                attempts: slotCount === 0 ? options.attempts : Math.max(1, Number(body.attempt || 1)),
                messageId: slotCount === 0 ? options.messageId : body.traceId,
                dispatchNext: false,
                directContinuation: slotCount > 0
            });
        } catch (error) {
            if (slotCount === 0) throw error;
            await sendPlannerQueueMessage(env, {
                ...body,
                attempt: Math.max(1, Number(body.attempt || 1)) + 1
            }, { delaySeconds: 30, dispatchReason: "continuation_error_retry" });
            console.error(JSON.stringify({
                event: "planner_direct_continuation_requeued",
                jobId: body.jobId,
                traceId: body.traceId,
                reason: error?.message || String(error)
            }));
            return { disposition: "ack", continuationRequeued: true };
        }
        if (lastResult?.disposition === "retry" && slotCount > 0) {
            await sendPlannerQueueMessage(env, {
                ...body,
                attempt: Math.max(1, Number(body.attempt || 1)) + 1
            }, {
                delaySeconds: lastResult.delaySeconds || 15,
                dispatchReason: "continuation_state_retry"
            });
            return { disposition: "ack", continuationRequeued: true };
        }
        if (lastResult?.disposition !== "ack" || lastResult?.terminal || !lastResult?.nextMessage) {
            return lastResult;
        }

        const canContinue = slotCount + 1 < PLANNER_MAX_SLOTS_PER_INVOCATION
            && Date.now() - invocationStartedAt < PLANNER_CONTINUATION_START_LIMIT_MS;
        if (!canContinue) {
            await sendPlannerQueueMessage(env, lastResult.nextMessage, { dispatchReason: "burst_boundary" });
            return { ...lastResult, nextMessage: null };
        }
        body = {
            ...stampPlannerQueueMessage(lastResult.nextMessage, { dispatchReason: "direct_continuation" }),
            directContinuation: true
        };
    }
    return lastResult;
}

export default {
    async scheduled(event, env) {
        if (event?.cron === "*/2 * * * *") {
            await recoverStalledPlannerCompactRuns(env).catch(error => writeBackgroundErrorLog(env, error, {
                stage: "planner_compact_watchdog"
            }));
        }
        if (event?.cron === "17 */6 * * *") {
            await cleanupDeletedAssets(env).catch(error => writeBackgroundErrorLog(env, error, {
                stage: "scheduled_asset_cleanup"
            }));
        }
    },
    async queue(batch, env) {
        for (const message of batch.messages) {
            try {
                const result = message.body?.plannerCompact
                    ? await processPlannerCompactQueueBurst(env, message.body, {
                        attempts: message.attempts,
                        messageId: message.id
                    })
                    : await processPlannerQueueMessage(env, message.body, {
                        attempts: message.attempts,
                        messageId: message.id
                    });
                if (result?.disposition === "retry") {
                    message.retry({ delaySeconds: result.delaySeconds || 15 });
                } else {
                    message.ack();
                }
            } catch (error) {
                await writeBackgroundErrorLog(env, error, {
                    jobId: message.body?.jobId || "",
                    itemId: message.body?.itemId || "",
                    queueId: message.body?.queueId || "",
                    imageIndex: message.body?.imageIndex,
                    attempt: message.body?.attempt,
                    stage: "queue_handler_uncaught",
                    messageBody: message.body
                });
                message.retry({ delaySeconds: 30 });
            }
        }
    }
};
