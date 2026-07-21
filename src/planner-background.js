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
    getPlannerCompactRateLimit,
    preparePlannerCompactQueueSlot,
    putPlannerCompactRateLimit
} from "./planner-compact.js";

const NAI_ENDPOINT = "https://image.novelai.net/ai/generate-image";
const QUALITY_TAGS = "masterpiece, best quality, very aesthetic, no text";
const DEFAULT_NEGATIVE_PROMPT = "";
const R2_PUT_MAX_ATTEMPTS = 4;
const PLANNER_COMPACT_MAX_ATTEMPTS = 3;
const NOVELAI_REQUEST_TIMEOUT_MS = 8 * 60 * 1000;

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

function isR2PutRetryExhausted(error) {
    return error?.code === "R2_PUT_RETRY_EXHAUSTED";
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
    const model = generation.model || "nai-diffusion-4-5-full";
    const steps = parsePositiveInt(generation.steps, 28);
    const scale = Number.parseFloat(generation.scale || "5.0") || 5.0;
    const sampler = generation.sampler || "k_euler_ancestral";

    const payload = {
        input: prompt,
        model,
        action: "generate",
        parameters: {
            params_version: 3,
            width,
            height,
            steps,
            sampler,
            scale,
            cfg_rescale: 0.0,
            negative_prompt: negative,
            seed,
            noise_schedule: "native",
            legacy_v3_extend: false,
            skip_cfg_above_sigma: 58.0
        }
    };

    const rows = Array.isArray(generation.v4PromptCharacters) ? generation.v4PromptCharacters : [];
    const charCaptions = rows
        .map(row => [row.subject, row.clothing, row.expression, row.action].filter(Boolean).join(", "))
        .filter(Boolean)
        .map(char_caption => ({ char_caption, centers: [{ x: 0.5, y: 0.5 }] }));
    const negativeCaptions = rows
        .map(row => String(row.negative || "").trim())
        .filter(Boolean)
        .map(char_caption => ({ char_caption, centers: [{ x: 0.5, y: 0.5 }] }));

    if (model.includes("nai-diffusion-4")) {
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

function isNovelAiRateLimitError(error) {
    const message = error?.message || String(error || "");
    return error?.status === 429
        || message.includes("[NovelAI 429]")
        || message.includes("error code: 1015")
        || message.includes("Concurrent generation is locked");
}

function isNovelAiCooldownError(error) {
    return error?.code === "NOVELAI_COOLDOWN";
}

function getRetryDelaySeconds(error, attempt) {
    if (isNovelAiCooldownError(error)) {
        return Math.max(30, Number(error.retryAfterSeconds || 60));
    }
    if (isNovelAiRateLimitError(error)) {
        const fallbackDelays = [120, 300, 900, 1800];
        const fallback = fallbackDelays[Math.min(Math.max(attempt - 1, 0), fallbackDelays.length - 1)];
        return Math.max(Number(error.retryAfterSeconds || 0), fallback);
    }
    return Math.min(60 * attempt, 300);
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

async function getPlannerCompactCooldownDelay(env) {
    const rate = await getPlannerCompactRateLimit(env, "novelai");
    const waitMs = Math.max(0, Number(rate?.availableAt || 0) - Date.now());
    return waitMs > 0 ? Math.max(1, Math.ceil(waitMs / 1000)) : 0;
}

export async function processPlannerCompactQueueMessage(env, body = {}, options = {}) {
    requireWorkerBindings(env);
    const prepared = await preparePlannerCompactQueueSlot(env, body);
    if (prepared.disposition !== "process") return prepared;

    const attempt = Math.max(1, Number(options.attempts || body.attempt || 1));
    const slot = prepared.slot;
    const request = buildNovelAiPayload(
        prepared.generation,
        makePlannerCompactSeed(prepared.generation, slot.globalImageIndex)
    );
    let object = await env.imgBucket.head(slot.r2Key);

    try {
        if (!object) {
            const cooldownDelay = await getPlannerCompactCooldownDelay(env);
            if (cooldownDelay > 0) return { disposition: "retry", delaySeconds: cooldownDelay };

            const zipBuffer = await callNovelAi(env, request.payload);
            const extracted = await extractFirstZipFile(zipBuffer);
            const webpBuffer = await encodeWebP(env, extracted.data);
            await putR2WithRetry(env.imgBucket, slot.r2Key, webpBuffer, {
                httpMetadata: { contentType: "image/webp" },
                customMetadata: {
                    ispublic: "false",
                    plannerCompact: "true",
                    assetId: slot.assetId,
                    width: String(request.width || 0),
                    height: String(request.height || 0)
                }
            });
            object = {
                size: webpBuffer.byteLength,
                httpMetadata: { contentType: "image/webp" },
                customMetadata: {
                    width: String(request.width || 0),
                    height: String(request.height || 0)
                }
            };
        }

        const committed = await commitPlannerCompactQueueSlot(env, {
            runKey: prepared.runKey,
            jobId: prepared.jobId,
            assetId: slot.assetId
        }, {
            r2Key: slot.r2Key,
            width: Number(object.customMetadata?.width || request.width || 0),
            height: Number(object.customMetadata?.height || request.height || 0),
            byteSize: Number(object.size || 0),
            mimeType: object.httpMetadata?.contentType || "image/webp"
        });
        if (committed.nextMessage && env.GENERATION_QUEUE) {
            await env.GENERATION_QUEUE.send(committed.nextMessage);
        }
        return { disposition: "ack", status: committed.status };
    } catch (error) {
        const message = error?.message || String(error);
        const retryDelaySeconds = getRetryDelaySeconds(error, attempt);
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
            await putPlannerCompactRateLimit(env, {
                key: "novelai",
                availableAt: Date.now() + retryDelaySeconds * 1000,
                reason: "cooldown"
            });
        }
        await writeBackgroundErrorLog(env, error, {
            runKey: prepared.runKey,
            jobId: prepared.jobId,
            itemId: slot.itemId,
            assetId: slot.assetId,
            imageIndex: slot.globalImageIndex,
            attempt,
            stage: "planner_compact_generation"
        });
        if (!isR2PutRetryExhausted(error) && attempt < PLANNER_COMPACT_MAX_ATTEMPTS) {
            return { disposition: "retry", delaySeconds: retryDelaySeconds };
        }
        const committed = await commitPlannerCompactQueueSlot(env, {
            runKey: prepared.runKey,
            jobId: prepared.jobId,
            assetId: slot.assetId
        }, { errorMessage: message.slice(0, 1000) });
        if (committed.nextMessage && env.GENERATION_QUEUE) {
            await env.GENERATION_QUEUE.send(committed.nextMessage);
        }
        return { disposition: "ack", status: committed.status };
    }
}

export default {
    async scheduled(event, env) {
        if (event?.cron === "17 */6 * * *") {
            await cleanupDeletedAssets(env).catch(error => writeBackgroundErrorLog(env, error, {
                stage: "scheduled_asset_cleanup"
            }));
        }
    },
    async queue(batch, env) {
        for (const message of batch.messages) {
            try {
                const result = await processPlannerQueueMessage(env, message.body, {
                    attempts: message.attempts
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
