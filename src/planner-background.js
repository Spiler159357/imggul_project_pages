const NAI_ENDPOINT = "https://image.novelai.net/ai/generate-image";
const QUALITY_TAGS = "masterpiece, best quality, very aesthetic, no text";
const DEFAULT_NEGATIVE_PROMPT = "";
const QUEUE_SEND_BATCH_SIZE = 100;
const MAX_ATTEMPTS = 5;
const NAI_MIN_REQUEST_INTERVAL_MS = 15000;
const MAX_INLINE_COOLDOWN_MS = 30000;
const R2_PUT_MAX_ATTEMPTS = 4;
const TERMINAL_JOB_RETENTION_MS = 10 * 60 * 1000;
const TERMINAL_JOB_STATUSES = ["completed", "partial_failed", "failed", "paused"];
const ACTIVE_JOB_STATUSES = ["queued", "running", "cancel_requested"];
const PAUSED_JOB_STATUS = "paused";
const STAGE_LABELS = {
    queued: "Queue waiting",
    running: "Preparing generation",
    rate_limited: "Waiting after NovelAI rate limit",
    novelai_request: "Calling NovelAI",
    novelai_response: "NovelAI response received",
    zip_extract: "Extracting generated image",
    webp_encode: "Encoding WebP",
    r2_put: "Saving image to R2",
    saving: "Saving image",
    metadata_put: "Saving metadata",
    rollup: "Updating job status",
    completed: "Completed",
    failed: "Failed",
    paused: "Paused"
};

export function jsonResponse(data, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(data), { ...init, headers });
}

function requireBackgroundBindings(env) {
    const missing = [];
    if (!env.DB) missing.push("DB");
    if (!env.GENERATION_QUEUE) missing.push("GENERATION_QUEUE");
    if (!env.imgBucket) missing.push("imgBucket");
    if (missing.length) {
        throw new Error(`Missing Cloudflare binding(s): ${missing.join(", ")}`);
    }
}

function requireWorkerBindings(env) {
    const missing = [];
    if (!env.DB) missing.push("DB");
    if (!env.imgBucket) missing.push("imgBucket");
    if (!env.NOVELAI_TOKEN) missing.push("NOVELAI_TOKEN");
    if (!env.IMAGES) missing.push("IMAGES");
    if (missing.length) {
        throw new Error(`Missing Cloudflare binding(s): ${missing.join(", ")}`);
    }
}

function nowIso() {
    return nowKstIso();
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

function isoBeforeNow(ms) {
    return nowKstIso(new Date(Date.now() - ms));
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

function makeId(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function makeStableDbId(prefix, value = "") {
    const source = String(value || prefix);
    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
        hash ^= source.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const compact = source.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
    return `${prefix}_${compact || "row"}_${(hash >>> 0).toString(16)}`;
}

function getFileNameFromKey(key = "") {
    return String(key || "").split("/").filter(Boolean).pop() || String(key || "");
}

function getAssetIdFromKey(key = "") {
    return makeStableDbId("asset", key);
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





function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
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
    return generation.qualityTags === undefined ? QUALITY_TAGS : String(generation.qualityTags || "").trim();
}

function getGenerationDefaultNegativePrompt(generation = {}) {
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

async function queryFirst(db, sql, ...params) {
    const statement = db.prepare(sql);
    return params.length ? await statement.bind(...params).first() : await statement.first();
}

async function callNovelAi(env, payload) {
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
        body: JSON.stringify(payload)
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

async function setNovelAiCooldown(env, delaySeconds) {
    const delayMs = Math.max(0, Number(delaySeconds || 0) * 1000);
    const availableAt = Date.now() + delayMs;
    await env.DB.prepare(`
        INSERT INTO planner_v3_rate_limits (key, available_at, updated_at)
        VALUES ('novelai', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            available_at = MAX(available_at, excluded.available_at),
            updated_at = excluded.updated_at
    `).bind(availableAt, nowIso()).run();
}

async function waitForNovelAiSlot(env) {
    const row = await queryFirst(env.DB, "SELECT available_at FROM planner_v3_rate_limits WHERE key = 'novelai'");
    const availableAt = Number(row?.available_at || 0);
    const waitMs = Math.max(0, availableAt - Date.now());
    if (waitMs > MAX_INLINE_COOLDOWN_MS) {
        const error = new Error(`NovelAI cooldown active for ${Math.ceil(waitMs / 1000)} seconds`);
        error.code = "NOVELAI_COOLDOWN";
        error.retryAfterSeconds = Math.ceil(waitMs / 1000);
        throw error;
    }
    if (waitMs > 0) await sleep(waitMs);

    const nextAvailableAt = Date.now() + NAI_MIN_REQUEST_INTERVAL_MS;
    await env.DB.prepare(`
        INSERT INTO planner_v3_rate_limits (key, available_at, updated_at)
        VALUES ('novelai', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            available_at = excluded.available_at,
            updated_at = excluded.updated_at
    `).bind(nextAvailableAt, nowIso()).run();
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

async function encodeWebP(env, imageBuffer) {
    const imageStream = new Blob([imageBuffer]).stream();
    const output = await env.IMAGES.input(imageStream)
        .output({ format: "image/webp", quality: 80 });
    const transformed = output.response();
    if (!transformed.ok) {
        throw new Error(`WebP conversion failed: ${transformed.status}`);
    }
    return await transformed.arrayBuffer();
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


export async function startPlannerBackgroundJob(env, body) {
    return await startPlannerV3Generation(env, { ...(body || {}), mode: "background" });
}

export async function getPlannerBackgroundStatus(env, jobId) {
    return await getPlannerV3Status(env, jobId);
}

export async function cancelPlannerBackgroundJob(env, jobId) {
    return await cancelPlannerV3Generation(env, jobId);
}

export async function pausePlannerBackgroundJob(env, jobId) {
    return await pausePlannerV3Generation(env, jobId);
}

export async function resumePlannerBackgroundJob(env, jobId) {
    return await resumePlannerV3Generation(env, jobId);
}

export async function processPlannerQueueMessage(env, message) {
    if (message?.plannerV3) {
        await processPlannerV3QueueMessage(env, message);
        return;
    }
    throw new Error("Legacy planner background queue is disabled. Use Planner V3 queue messages.");
}

// Planner V3 DB-backed planner implementation.
const PLANNER_V3_ACTIVE_JOB_STATUSES = ["queued", "running", "paused", "cancel_requested"];
const PLANNER_V3_TERMINAL_JOB_STATUSES = ["completed", "partial_failed", "failed", "cancelled"];
const PROMPT_PART_KEYS = ["style", "composition", "character", "clothing", "expression", "action", "background", "negative", "raw"];
const CONFIRM_RETENTION_MS = 24 * 60 * 60 * 1000;
const BROWSER_QUEUE_LEASE_MS = 5 * 60 * 1000;

function nowPlannerV3Iso() {
    const date = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return date.toISOString().replace("Z", "+09:00");
}

function futurePlannerV3Iso(ms) {
    const date = new Date(Date.now() + ms + 9 * 60 * 60 * 1000);
    return date.toISOString().replace("Z", "+09:00");
}

function makePlannerV3Id(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function parseJson(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function asInt(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function plannerV3DbValue(value) {
    return value === undefined ? null : value;
}

function bindPlannerV3(statement, ...values) {
    return statement.bind(...values.map(plannerV3DbValue));
}

function normalizeRunStatus(status = "draft") {
    const value = String(status || "draft");
    if (value === "done" || value === "completed") return "complete";
    if (value === "cancel_requested") return "running";
    return ["draft", "queued", "running", "paused", "complete", "partial_failed", "failed"].includes(value) ? value : "draft";
}

function normalizeItemStatus(status = "pending") {
    const value = String(status || "pending");
    if (value === "done" || value === "completed") return "complete";
    if (value === "cancel_requested") return "running";
    return ["pending", "queued", "running", "paused", "complete", "partial_failed", "failed"].includes(value) ? value : "pending";
}

function normalizeSettings(settings = {}) {
    return {
        model: settings.model || "nai-diffusion-4-5-full",
        steps: String(settings.steps || "28"),
        scale: String(settings.scale || "5.0"),
        sampler: settings.sampler || "k_euler_ancestral",
        resolution: settings.resolution || settings.res || "832x1216",
        sm: settings.sm ? 1 : 0,
        sm_dyn: settings.sm_dyn ? 1 : 0,
        vibe_strength: String(settings.vibeStrength ?? settings.vibe_strength ?? ""),
        vibe_info: String(settings.vibeInfo ?? settings.vibe_info ?? ""),
        precise_strength: String(settings.preciseStrength ?? settings.precise_strength ?? ""),
        precise_fidelity: String(settings.preciseFidelity ?? settings.precise_fidelity ?? ""),
        precise_type: String(settings.preciseType ?? settings.precise_type ?? ""),
        vibe_image_key: String(settings.vibeImageKey ?? settings.vibe_image_key ?? ""),
        precise_image_key: String(settings.preciseImageKey ?? settings.precise_image_key ?? "")
    };
}

function settingsRowToClient(row) {
    if (!row) return null;
    return {
        projectId: row.project_id,
        projectPrefix: row.project_prefix,
        model: row.model,
        steps: row.steps,
        scale: row.scale,
        sampler: row.sampler,
        resolution: row.resolution,
        sm: !!row.sm,
        sm_dyn: !!row.sm_dyn,
        vibeStrength: row.vibe_strength || "",
        vibeInfo: row.vibe_info || "",
        preciseStrength: row.precise_strength || "",
        preciseFidelity: row.precise_fidelity || "",
        preciseType: row.precise_type || "",
        vibeImageKey: row.vibe_image_key || "",
        preciseImageKey: row.precise_image_key || ""
    };
}

function generationFromItem(item = {}) {
    return item.generation || {};
}

function splitGeneration(generation = {}) {
    const prompts = generation.prompts || {};
    const fields = generation.fields || {};
    return {
        style: fields.style || prompts["prompt-style"] || "",
        composition: fields.composition || prompts["prompt-composition"] || "",
        character: fields.character || prompts["prompt-character"] || "",
        clothing: fields.clothing || prompts["prompt-clothing"] || "",
        expression: fields.expression || prompts["prompt-expression"] || "",
        action: fields.action || prompts["prompt-action"] || "",
        background: fields.background || prompts["prompt-background"] || "",
        negative: generation.negative || "",
        raw: generation.simpleMode ? prompts["prompt-raw"] || "" : ""
    };
}

function generationSettingsFromGeneration(generation = {}) {
    const [width, height] = String(generation.res || generation.resolution || "").split("x").map(value => asInt(value, null));
    return {
        model: generation.model || "",
        resolution: generation.res || generation.resolution || "",
        width,
        height,
        steps: generation.steps ? asInt(generation.steps, null) : null,
        scale: generation.scale || "",
        sampler: generation.sampler || "",
        seed: generation.seed || "",
        sm: generation.sm ? 1 : 0,
        sm_dyn: generation.sm_dyn ? 1 : 0,
        vibe_strength: String(generation.vibeStrength ?? ""),
        vibe_info: String(generation.vibeInfo ?? ""),
        precise_strength: String(generation.preciseStrength ?? ""),
        precise_fidelity: String(generation.preciseFidelity ?? ""),
        precise_type: String(generation.preciseType ?? ""),
        vibe_asset_key: String(generation.vibeImageKey ?? ""),
        precise_asset_key: String(generation.preciseImageKey ?? ""),
        inpaint_asset_key: String(generation.inpaintImageKey ?? "")
    };
}

function clientExtraForItem(item = {}) {
    const {
        situationId,
        situationName,
        situationIndex,
        imageNumber,
        rating,
        status,
        count,
        completedCount,
        failedCount,
        stage,
        stageLabel,
        errorMessage,
        generation,
        variantGenerations,
        images,
        generatedImages,
        selectedImage,
        ...extra
    } = item;
    return {
        ...extra,
        legacyImages: Array.isArray(images) ? images : [],
        legacyGeneratedImages: Array.isArray(generatedImages) ? generatedImages : []
    };
}

function validatePlannerV3Binding(env) {
    if (!env.DB) throw new Error("DB binding is not configured");
}

export async function ensurePlannerV3Schema(env) {
    validatePlannerV3Binding(env);
    const row = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'planner_v3_runs'"
    ).first();
    if (!row?.name) {
        throw new Error("Planner V3 schema is not installed. Run migrations/0014_planner_v3_schema.sql first.");
    }
}

export async function getPlannerV3Settings(env, projectId) {
    await ensurePlannerV3Schema(env);
    const row = await env.DB.prepare(
        "SELECT * FROM planner_v3_project_settings WHERE project_id = ?"
    ).bind(projectId).first();
    return settingsRowToClient(row);
}

export async function putPlannerV3Settings(env, input = {}) {
    await ensurePlannerV3Schema(env);
    const projectId = String(input.projectId || input.project_id || "").trim();
    const projectPrefix = String(input.projectPrefix || input.project_prefix || "").trim();
    if (!projectId) throw new Error("projectId is required");
    if (!projectPrefix) throw new Error("projectPrefix is required");
    const settings = normalizeSettings(input);
    const timestamp = nowPlannerV3Iso();
    await env.DB.prepare(`
        INSERT INTO planner_v3_project_settings (
            project_id, project_prefix, model, steps, scale, sampler, resolution,
            sm, sm_dyn, vibe_strength, vibe_info, precise_strength, precise_fidelity,
            precise_type, vibe_image_key, precise_image_key, extra_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
            project_prefix = excluded.project_prefix,
            model = excluded.model,
            steps = excluded.steps,
            scale = excluded.scale,
            sampler = excluded.sampler,
            resolution = excluded.resolution,
            sm = excluded.sm,
            sm_dyn = excluded.sm_dyn,
            vibe_strength = excluded.vibe_strength,
            vibe_info = excluded.vibe_info,
            precise_strength = excluded.precise_strength,
            precise_fidelity = excluded.precise_fidelity,
            precise_type = excluded.precise_type,
            vibe_image_key = excluded.vibe_image_key,
            precise_image_key = excluded.precise_image_key,
            updated_at = excluded.updated_at
    `).bind(
        projectId,
        projectPrefix,
        settings.model,
        settings.steps,
        settings.scale,
        settings.sampler,
        settings.resolution,
        settings.sm,
        settings.sm_dyn,
        settings.vibe_strength,
        settings.vibe_info,
        settings.precise_strength,
        settings.precise_fidelity,
        settings.precise_type,
        settings.vibe_image_key,
        settings.precise_image_key,
        timestamp,
        timestamp
    ).run();
    return getPlannerV3Settings(env, projectId);
}

async function deletePlannerV3SnapshotsForRun(env, runId) {
    await env.DB.batch([
        env.DB.prepare("DELETE FROM planner_v3_prompt_parts WHERE run_id = ?").bind(runId),
        env.DB.prepare("DELETE FROM planner_v3_v4_rows WHERE run_id = ?").bind(runId),
        env.DB.prepare("DELETE FROM planner_v3_generation_settings WHERE run_id = ?").bind(runId),
        env.DB.prepare("DELETE FROM planner_v3_item_variants WHERE item_id IN (SELECT id FROM planner_v3_items WHERE run_id = ?)").bind(runId)
    ]);
}

export async function putPlannerV3RunFromMeta(env, meta = {}) {
    await ensurePlannerV3Schema(env);
    const projectId = String(meta.projectId || "").trim();
    const projectPrefix = String(meta.projectPrefix || "").trim();
    const characterId = String(meta.characterId || "").trim();
    if (!projectId) throw new Error("projectId is required");
    if (!characterId) throw new Error("characterId is required");

    const timestamp = nowPlannerV3Iso();
    const existing = await env.DB.prepare(
        "SELECT * FROM planner_v3_runs WHERE project_id = ? AND character_id = ? LIMIT 1"
    ).bind(projectId, characterId).first();
    const runId = existing?.id || makePlannerV3Id("prun");
    const defaultCount = Math.max(1, asInt(meta.defaultCount, 20));

    await bindPlannerV3(env.DB.prepare(`
        INSERT INTO planner_v3_runs (
            id, project_id, project_prefix, character_id, character_prefix, status, mode,
            default_count, active_job_id, running_situation_ids_json, stage, stage_label,
            error_message, created_at, updated_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            project_prefix = excluded.project_prefix,
            character_prefix = excluded.character_prefix,
            status = excluded.status,
            mode = excluded.mode,
            default_count = excluded.default_count,
            running_situation_ids_json = excluded.running_situation_ids_json,
            stage = excluded.stage,
            stage_label = excluded.stage_label,
            error_message = excluded.error_message,
            updated_at = excluded.updated_at
    `),
        runId,
        projectId,
        projectPrefix,
        characterId,
        meta.characterPrefix || "",
        normalizeRunStatus(meta.status),
        meta.mode === "browser" ? "browser" : "background",
        defaultCount,
        meta.backgroundJobId || existing?.active_job_id || null,
        JSON.stringify(meta.runningSituationIds || []),
        meta.stage || "",
        meta.stageLabel || "",
        meta.errorMessage || "",
        existing?.created_at || timestamp,
        timestamp,
        existing?.started_at || null,
        existing?.completed_at || null
    ).run();

    const activeGenerationRow = await env.DB.prepare(`
        SELECT id FROM planner_v3_jobs
        WHERE run_id = ?
          AND status IN ('queued', 'running', 'paused', 'cancel_requested')
        LIMIT 1
    `).bind(runId).first();
    if (activeGenerationRow?.id) {
        return getPlannerV3RunById(env, runId);
    }

    await deletePlannerV3SnapshotsForRun(env, runId);

    const existingItems = (await env.DB.prepare(
        "SELECT id, situation_id FROM planner_v3_items WHERE run_id = ?"
    ).bind(runId).all()).results || [];
    const existingItemBySituationId = new Map(existingItems.map(item => [item.situation_id, item.id]));
    const currentItemIds = [];
    for (const [index, item] of (meta.items || []).entries()) {
        const situationId = String(item.situationId || item.situation_id || "").trim() || makePlannerV3Id("sit");
        const itemId = item.id || existingItemBySituationId.get(situationId) || makePlannerV3Id("pitem");
        currentItemIds.push(itemId);
        const targetCount = Math.max(1, asInt(item.count || item.targetCount || defaultCount, defaultCount));
        await bindPlannerV3(env.DB.prepare(`
            INSERT INTO planner_v3_items (
                id, run_id, situation_id, situation_name, situation_index, image_number,
                situation_rating, status, target_count, completed_count, failed_count,
                stage, stage_label, error_message, extra_json, sort_order, created_at, updated_at,
                started_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                situation_name = excluded.situation_name,
                situation_index = excluded.situation_index,
                image_number = excluded.image_number,
                situation_rating = excluded.situation_rating,
                status = excluded.status,
                target_count = excluded.target_count,
                completed_count = excluded.completed_count,
                failed_count = excluded.failed_count,
                stage = excluded.stage,
                stage_label = excluded.stage_label,
                error_message = excluded.error_message,
                extra_json = excluded.extra_json,
                sort_order = excluded.sort_order,
                updated_at = excluded.updated_at,
                started_at = COALESCE(planner_v3_items.started_at, excluded.started_at),
                completed_at = excluded.completed_at
        `),
            itemId,
            runId,
            situationId,
            item.situationName || item.name || "",
            item.situationIndex ?? index,
            String(item.imageNumber || index + 1),
            item.rating === "nsfw" || item.situationRating === "nsfw" ? "nsfw" : "sfw",
            normalizeItemStatus(item.status),
            targetCount,
            Math.max(0, asInt(item.completedCount, Array.isArray(item.images) ? item.images.length : 0)),
            Math.max(0, asInt(item.failedCount, 0)),
            item.stage || "",
            item.stageLabel || "",
            item.errorMessage || "",
            JSON.stringify(clientExtraForItem(item)),
            index,
            timestamp,
            timestamp,
            item.startedAt || null,
            item.completedAt || null
        ).run();

        const runs = Array.isArray(item.variantGenerations) && item.variantGenerations.length
            ? item.variantGenerations
            : [{ count: targetCount, generation: generationFromItem(item) }];
        let variantCountSum = 0;
        for (const [variantIndex, run] of runs.entries()) {
            const variantId = makePlannerV3Id("pvar");
            const variantTargetCount = Math.max(1, asInt(run.count || targetCount, targetCount));
            variantCountSum += variantTargetCount;
            await bindPlannerV3(env.DB.prepare(`
                INSERT INTO planner_v3_item_variants (
                    id, item_id, character_prompt_variant_id, character_prompt_variant_name,
                    situation_prompt_variant_id, situation_prompt_variant_name, target_count,
                    sort_order, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `),
                variantId,
                itemId,
                run.characterPromptVariantId || item.characterPromptVariantId || "",
                run.characterPromptVariantName || item.characterPromptVariantName || "",
                run.situationPromptVariantId || item.situationPromptVariantId || "",
                run.situationPromptVariantName || item.situationPromptVariantName || "",
                variantTargetCount,
                variantIndex,
                timestamp,
                timestamp
            ).run();
            const generation = run.generation || generationFromItem(item);
            await insertPlannerV3GenerationSnapshot(env, {
                runId,
                itemId,
                variantId,
                ownerType: "variant",
                ownerId: variantId,
                generation,
                timestamp
            });
        }
        if (variantCountSum !== targetCount) {
            await env.DB.prepare(
                "UPDATE planner_v3_items SET target_count = ?, updated_at = ? WHERE id = ?"
            ).bind(variantCountSum || targetCount, timestamp, itemId).run();
        }
        await insertPlannerV3GenerationSnapshot(env, {
            runId,
            itemId,
            variantId: null,
            ownerType: "item",
            ownerId: itemId,
            generation: generationFromItem(item),
            timestamp
        });
    }

    if (currentItemIds.length) {
        const placeholders = currentItemIds.map(() => "?").join(",");
        await env.DB.prepare(`
            DELETE FROM planner_v3_items
            WHERE run_id = ?
              AND id NOT IN (${placeholders})
        `).bind(runId, ...currentItemIds).run();
    } else {
        await env.DB.prepare("DELETE FROM planner_v3_items WHERE run_id = ?").bind(runId).run();
    }

    return getPlannerV3RunById(env, runId);
}

async function insertPlannerV3GenerationSnapshot(env, { runId, itemId, variantId, ownerType, ownerId, generation, timestamp }) {
    const settings = generationSettingsFromGeneration(generation);
    await bindPlannerV3(env.DB.prepare(`
        INSERT INTO planner_v3_generation_settings (
            id, owner_type, owner_id, run_id, item_id, variant_id, model, resolution,
            width, height, steps, scale, sampler, seed, sm, sm_dyn, vibe_strength,
            vibe_info, precise_strength, precise_fidelity, precise_type, vibe_asset_key,
            precise_asset_key, inpaint_asset_key, extra_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
        makePlannerV3Id("pset"),
        ownerType,
        ownerId,
        runId,
        itemId,
        variantId,
        settings.model,
        settings.resolution,
        settings.width,
        settings.height,
        settings.steps,
        settings.scale,
        settings.sampler,
        settings.seed,
        settings.sm,
        settings.sm_dyn,
        settings.vibe_strength,
        settings.vibe_info,
        settings.precise_strength,
        settings.precise_fidelity,
        settings.precise_type,
        settings.vibe_asset_key,
        settings.precise_asset_key,
        settings.inpaint_asset_key,
        JSON.stringify(generation || {}),
        timestamp,
        timestamp
    ).run();

    const parts = splitGeneration(generation);
    for (const [sortOrder, key] of PROMPT_PART_KEYS.entries()) {
        await bindPlannerV3(env.DB.prepare(`
            INSERT INTO planner_v3_prompt_parts (
                id, owner_type, owner_id, run_id, item_id, variant_id, part_key,
                value, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `), makePlannerV3Id("ppart"), ownerType, ownerId, runId, itemId, variantId, key, parts[key] || "", sortOrder, timestamp, timestamp).run();
    }

    const rows = Array.isArray(generation.v4PromptCharacters)
        ? generation.v4PromptCharacters
        : (Array.isArray(generation.v4_prompt) ? generation.v4_prompt : []);
    for (const [rowIndex, row] of rows.entries()) {
        await bindPlannerV3(env.DB.prepare(`
            INSERT INTO planner_v3_v4_rows (
                id, owner_type, owner_id, run_id, item_id, variant_id, row_index,
                subject, clothing, expression, action, negative, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
            makePlannerV3Id("pv4"),
            ownerType,
            ownerId,
            runId,
            itemId,
            variantId,
            rowIndex,
            row?.subject || "",
            row?.clothing || "",
            row?.expression || "",
            row?.action || "",
            row?.negative || "",
            timestamp,
            timestamp
        ).run();
    }
}

export async function getPlannerV3Run(env, { projectId, characterId }) {
    await ensurePlannerV3Schema(env);
    const row = await env.DB.prepare(`
        SELECT id FROM planner_v3_runs
        WHERE project_id = ? AND character_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
    `).bind(projectId, characterId).first();
    return row?.id ? getPlannerV3RunById(env, row.id) : null;
}

export async function getPlannerV3RunById(env, runId) {
    await ensurePlannerV3Schema(env);
    const run = await env.DB.prepare("SELECT * FROM planner_v3_runs WHERE id = ?").bind(runId).first();
    if (!run) return null;
    const items = (await env.DB.prepare(`
        SELECT * FROM planner_v3_items
        WHERE run_id = ?
        ORDER BY sort_order, image_number
    `).bind(runId).all()).results || [];
    const itemIds = items.map(item => item.id);
    const assetsByItem = new Map();
    if (itemIds.length) {
        const placeholders = itemIds.map(() => "?").join(",");
        const assets = (await env.DB.prepare(`
            SELECT * FROM planner_v3_assets
            WHERE item_id IN (${placeholders}) AND status = 'candidate'
            ORDER BY item_id, image_index, created_at
        `).bind(...itemIds).all()).results || [];
        for (const asset of assets) {
            if (!assetsByItem.has(asset.item_id)) assetsByItem.set(asset.item_id, []);
            assetsByItem.get(asset.item_id).push(asset);
        }
    }
    return {
        id: run.id,
        projectId: run.project_id,
        projectPrefix: run.project_prefix,
        characterId: run.character_id,
        characterPrefix: run.character_prefix,
        status: run.status,
        mode: run.mode,
        defaultCount: run.default_count,
        backgroundJobId: run.active_job_id || undefined,
        runningSituationIds: parseJson(run.running_situation_ids_json, []),
        stage: run.stage || "",
        stageLabel: run.stage_label || "",
        errorMessage: run.error_message || "",
        items: await Promise.all(items.map(item => plannerV3ItemToClient(env, item, assetsByItem.get(item.id) || [])))
    };
}

async function plannerV3ItemToClient(env, row, assets = []) {
    const setting = await env.DB.prepare(`
        SELECT extra_json FROM planner_v3_generation_settings
        WHERE owner_type = 'item' AND owner_id = ?
        LIMIT 1
    `).bind(row.id).first();
    const generation = parseJson(setting?.extra_json, {});
    const extra = parseJson(row.extra_json, {});
    const fallbackImages = Array.isArray(extra.legacyImages) ? extra.legacyImages : [];
    const fallbackGeneratedImages = Array.isArray(extra.legacyGeneratedImages) ? extra.legacyGeneratedImages : [];
    return {
        ...extra,
        id: row.id,
        situationId: row.situation_id,
        situationName: row.situation_name,
        situationIndex: row.situation_index,
        imageNumber: row.image_number,
        rating: row.situation_rating,
        status: row.status === "complete" ? "done" : row.status,
        count: row.target_count,
        completedCount: row.completed_count,
        failedCount: row.failed_count,
        stage: row.stage || "",
        stageLabel: row.stage_label || "",
        errorMessage: row.error_message || "",
        generation,
        images: assets.length ? assets.map(asset => asset.r2_key) : fallbackImages,
        generatedImages: assets.length ? assets.map(asset => ({
            id: asset.id,
            key: asset.r2_key,
            r2Key: asset.r2_key,
            imageIndex: asset.image_index,
            createdAt: asset.created_at
        })) : fallbackGeneratedImages
    };
}

export async function deletePlannerV3Run(env, runId) {
    await ensurePlannerV3Schema(env);
    const timestamp = nowPlannerV3Iso();
    await env.DB.prepare(`
        INSERT OR IGNORE INTO planner_v3_asset_cleanup_queue (
            id, r2_key, source_asset_id, source_run_id, source_item_id, reason,
            status, created_at, updated_at
        )
        SELECT 'cleanup_' || id, r2_key, id, run_id, item_id, 'deleted_run_cleanup',
            'pending', ?, ?
        FROM planner_v3_assets
        WHERE run_id = ?
    `).bind(timestamp, timestamp, runId).run();
    await env.DB.prepare("DELETE FROM planner_v3_runs WHERE id = ?").bind(runId).run();
    return { success: true };
}

export async function updatePlannerV3Item(env, itemId, patch = {}) {
    await ensurePlannerV3Schema(env);
    const row = await env.DB.prepare("SELECT * FROM planner_v3_items WHERE id = ?").bind(itemId).first();
    if (!row) throw new Error("Planner item not found");
    const timestamp = nowPlannerV3Iso();
    await env.DB.prepare(`
        UPDATE planner_v3_items
        SET situation_name = ?, image_number = ?, situation_rating = ?, target_count = ?,
            stage = ?, stage_label = ?, error_message = ?, extra_json = ?, updated_at = ?
        WHERE id = ?
    `).bind(
        patch.situationName ?? row.situation_name,
        patch.imageNumber ?? row.image_number,
        patch.rating === "nsfw" || patch.situationRating === "nsfw" ? "nsfw" : row.situation_rating,
        Math.max(1, asInt(patch.count || patch.targetCount || row.target_count, row.target_count)),
        patch.stage ?? row.stage,
        patch.stageLabel ?? row.stage_label,
        patch.errorMessage ?? row.error_message,
        JSON.stringify(clientExtraForItem({ ...parseJson(row.extra_json, {}), ...patch })),
        timestamp,
        itemId
    ).run();
    return getPlannerV3RunById(env, row.run_id);
}

export async function deletePlannerV3Item(env, itemId) {
    await ensurePlannerV3Schema(env);
    const item = await env.DB.prepare("SELECT * FROM planner_v3_items WHERE id = ?").bind(itemId).first();
    if (!item) return { success: true };
    const timestamp = nowPlannerV3Iso();
    await queuePlannerV3ItemAssetsForCleanup(env, itemId, "deleted_item_cleanup", timestamp);
    await env.DB.prepare("DELETE FROM planner_v3_items WHERE id = ?").bind(itemId).run();
    await deleteEmptyPlannerV3JobsAndRuns(env, item.run_id);
    return { success: true };
}

async function queuePlannerV3ItemAssetsForCleanup(env, itemId, reason, timestamp = nowPlannerV3Iso()) {
    await env.DB.prepare(`
        INSERT OR IGNORE INTO planner_v3_asset_cleanup_queue (
            id, r2_key, source_asset_id, source_run_id, source_item_id, reason,
            status, created_at, updated_at
        )
        SELECT 'cleanup_' || id, r2_key, id, run_id, item_id, ?,
            'pending', ?, ?
        FROM planner_v3_assets
        WHERE item_id = ?
    `).bind(reason, timestamp, timestamp, itemId).run();
}

async function deleteEmptyPlannerV3JobsAndRuns(env, runId) {
    await env.DB.prepare(`
        DELETE FROM planner_v3_jobs
        WHERE run_id = ?
          AND id NOT IN (SELECT DISTINCT job_id FROM planner_v3_job_tasks)
    `).bind(runId).run();
    await env.DB.prepare(`
        DELETE FROM planner_v3_runs
        WHERE id = ?
          AND id NOT IN (SELECT DISTINCT run_id FROM planner_v3_items)
    `).bind(runId).run();
}

export async function startPlannerV3Generation(env, body = {}) {
    await ensurePlannerV3Schema(env);
    const meta = body.plannerMeta ? await putPlannerV3RunFromMeta(env, body.plannerMeta) : await getPlannerV3RunById(env, body.runId);
    if (!meta) throw new Error("Planner run not found");
    const runId = meta.id;
    const targetSituationId = body.targetSituationId || "";
    const mode = body.mode === "browser" ? "browser" : "background";
    const existing = await env.DB.prepare(`
        SELECT * FROM planner_v3_jobs
        WHERE run_id = ? AND status IN ('queued', 'running', 'paused', 'cancel_requested')
        ORDER BY updated_at DESC
        LIMIT 1
    `).bind(runId).first();
    if (existing) return getPlannerV3Status(env, existing.id);

    const timestamp = nowPlannerV3Iso();
    const candidates = meta.items.filter(item => {
        if (targetSituationId && item.situationId !== targetSituationId) return false;
        return !["done", "complete"].includes(item.status) || (item.images || []).length < item.count;
    });
    if (!candidates.length) throw new Error("No runnable planner items");

    const totalCount = candidates.reduce((sum, item) => sum + Math.max(1, asInt(item.count || meta.defaultCount, meta.defaultCount)), 0);
    const jobId = makePlannerV3Id("pjob");
    const activeKey = `${meta.projectId}:${meta.characterId}:${targetSituationId || "all"}`;
    await env.DB.prepare(`
        INSERT INTO planner_v3_jobs (
            id, run_id, project_id, project_prefix, character_id, mode, status,
            target_situation_id, total_count, completed_count, failed_count,
            stage, stage_label, error_message, active_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, 0, 0, 'queued', 'Queue waiting', '', ?, ?, ?)
    `).bind(jobId, runId, meta.projectId, meta.projectPrefix, meta.characterId, mode, targetSituationId || null, totalCount, activeKey, timestamp, timestamp).run();
    await env.DB.prepare("UPDATE planner_v3_runs SET status = 'queued', active_job_id = ?, mode = ?, updated_at = ? WHERE id = ?")
        .bind(jobId, mode, timestamp, runId).run();

    let sequence = 0;
    for (const [taskIndex, item] of candidates.entries()) {
        const itemRow = await env.DB.prepare("SELECT * FROM planner_v3_items WHERE id = ?").bind(item.id).first();
        const variants = (await env.DB.prepare(`
            SELECT * FROM planner_v3_item_variants WHERE item_id = ? ORDER BY sort_order
        `).bind(item.id).all()).results || [];
        const taskId = makePlannerV3Id("ptask");
        await env.DB.prepare(`
            INSERT INTO planner_v3_job_tasks (
                id, job_id, item_id, status, target_count, completed_count, failed_count,
                attempts, stage, stage_label, error_message, queue_order, created_at, updated_at
            ) VALUES (?, ?, ?, 'queued', ?, 0, 0, 0, 'queued', 'Queue waiting', '', ?, ?, ?)
        `).bind(taskId, jobId, item.id, itemRow.target_count, taskIndex, timestamp, timestamp).run();
        await env.DB.prepare("UPDATE planner_v3_items SET status = 'queued', updated_at = ? WHERE id = ?")
            .bind(timestamp, item.id).run();
        let imageIndex = 0;
        for (const variant of variants) {
            for (let variantImageIndex = 0; variantImageIndex < variant.target_count; variantImageIndex += 1) {
                await env.DB.prepare(`
                    INSERT INTO planner_v3_queue (
                        id, job_id, task_id, item_id, variant_id, sequence, image_index,
                        variant_image_index, executor, status, attempts, scheduled_at,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)
                `).bind(
                    makePlannerV3Id("pqueue"),
                    jobId,
                    taskId,
                    item.id,
                    variant.id,
                    sequence,
                    imageIndex,
                    variantImageIndex,
                    mode,
                    timestamp,
                    timestamp,
                    timestamp
                ).run();
                sequence += 1;
                imageIndex += 1;
            }
        }
    }

    if (mode === "background" && env.GENERATION_QUEUE) {
        const first = await env.DB.prepare(`
            SELECT id FROM planner_v3_queue
            WHERE job_id = ? AND executor = 'background' AND status = 'queued'
            ORDER BY sequence
            LIMIT 1
        `).bind(jobId).first();
        if (first?.id) await env.GENERATION_QUEUE.send({ plannerV3: true, queueId: first.id, jobId });
    }
    return getPlannerV3Status(env, jobId);
}

export async function getPlannerV3Status(env, jobId) {
    await ensurePlannerV3Schema(env);
    const job = await env.DB.prepare("SELECT * FROM planner_v3_jobs WHERE id = ?").bind(jobId).first();
    if (!job) throw new Error("Planner job not found");
    const tasks = (await env.DB.prepare(`
        SELECT t.*, i.situation_id, i.image_number
        FROM planner_v3_job_tasks t
        LEFT JOIN planner_v3_items i ON i.id = t.item_id
        WHERE t.job_id = ?
        ORDER BY t.queue_order
    `).bind(jobId).all()).results || [];
    const assets = (await env.DB.prepare(`
        SELECT item_id, id, r2_key, image_index, created_at
        FROM planner_v3_assets
        WHERE job_id = ?
        ORDER BY item_id, image_index, created_at
    `).bind(jobId).all()).results || [];
    const assetsByItem = new Map();
    for (const asset of assets) {
        if (!assetsByItem.has(asset.item_id)) assetsByItem.set(asset.item_id, []);
        assetsByItem.get(asset.item_id).push(asset);
    }
    return {
        jobId: job.id,
        runId: job.run_id,
        status: job.status,
        mode: job.mode,
        totalCount: job.total_count,
        completedCount: job.completed_count,
        failedCount: job.failed_count,
        stage: job.stage || "",
        stageLabel: job.stage_label || "",
        errorMessage: job.error_message || "",
        items: tasks.map(task => {
            const itemAssets = assetsByItem.get(task.item_id) || [];
            return {
                id: task.id,
                itemId: task.item_id,
                situationId: task.situation_id,
                imageNumber: task.image_number,
                status: task.status,
                targetCount: task.target_count,
                count: task.target_count,
                completedCount: task.completed_count,
                failedCount: task.failed_count,
                stage: task.stage || "",
                stageLabel: task.stage_label || "",
                errorMessage: task.error_message || "",
                resultKeys: itemAssets.map(asset => asset.r2_key),
                generatedImages: itemAssets.map(asset => ({
                    id: asset.id,
                    key: asset.r2_key,
                    r2Key: asset.r2_key,
                    imageIndex: asset.image_index,
                    createdAt: asset.created_at
                }))
            };
        })
    };
}

export async function pausePlannerV3Generation(env, jobId) {
    await ensurePlannerV3Schema(env);
    const timestamp = nowPlannerV3Iso();
    const job = await env.DB.prepare("SELECT * FROM planner_v3_jobs WHERE id = ?").bind(jobId).first();
    if (!job) throw new Error("Planner job not found");
    await env.DB.batch([
        env.DB.prepare("UPDATE planner_v3_jobs SET status = 'paused', stage = 'paused', stage_label = 'Paused', updated_at = ? WHERE id = ?").bind(timestamp, jobId),
        env.DB.prepare("UPDATE planner_v3_job_tasks SET status = 'paused', stage = 'paused', stage_label = 'Paused', updated_at = ? WHERE job_id = ? AND status IN ('queued', 'running')").bind(timestamp, jobId),
        env.DB.prepare("UPDATE planner_v3_queue SET status = 'paused', updated_at = ? WHERE job_id = ? AND status IN ('queued', 'running')").bind(timestamp, jobId),
        env.DB.prepare("UPDATE planner_v3_runs SET status = 'paused', stage = 'paused', stage_label = 'Paused', updated_at = ? WHERE id = ?").bind(timestamp, job.run_id),
        env.DB.prepare("UPDATE planner_v3_items SET status = 'paused', stage = 'paused', stage_label = 'Paused', updated_at = ? WHERE id IN (SELECT item_id FROM planner_v3_job_tasks WHERE job_id = ?) AND status IN ('queued', 'running')").bind(timestamp, jobId)
    ]);
    return getPlannerV3Status(env, jobId);
}

export async function resumePlannerV3Generation(env, jobId) {
    await ensurePlannerV3Schema(env);
    const timestamp = nowPlannerV3Iso();
    const job = await env.DB.prepare("SELECT * FROM planner_v3_jobs WHERE id = ?").bind(jobId).first();
    if (!job) throw new Error("Planner job not found");
    await env.DB.batch([
        env.DB.prepare("UPDATE planner_v3_jobs SET status = 'queued', stage = 'queued', stage_label = 'Queue waiting', updated_at = ? WHERE id = ?").bind(timestamp, jobId),
        env.DB.prepare("UPDATE planner_v3_job_tasks SET status = 'queued', stage = 'queued', stage_label = 'Queue waiting', updated_at = ? WHERE job_id = ? AND status = 'paused'").bind(timestamp, jobId),
        env.DB.prepare("UPDATE planner_v3_queue SET status = 'queued', claimed_by = '', claim_token = '', claimed_at = NULL, lease_expires_at = NULL, updated_at = ? WHERE job_id = ? AND status = 'paused'").bind(timestamp, jobId),
        env.DB.prepare("UPDATE planner_v3_runs SET status = 'queued', stage = 'queued', stage_label = 'Queue waiting', updated_at = ? WHERE id = ?").bind(timestamp, job.run_id),
        env.DB.prepare("UPDATE planner_v3_items SET status = 'queued', stage = 'queued', stage_label = 'Queue waiting', updated_at = ? WHERE id IN (SELECT item_id FROM planner_v3_job_tasks WHERE job_id = ?) AND status = 'paused'").bind(timestamp, jobId)
    ]);
    if (job.mode === "background" && env.GENERATION_QUEUE) {
        const next = await env.DB.prepare(`
            SELECT id FROM planner_v3_queue
            WHERE job_id = ? AND executor = 'background' AND status = 'queued'
            ORDER BY sequence LIMIT 1
        `).bind(jobId).first();
        if (next?.id) await env.GENERATION_QUEUE.send({ plannerV3: true, queueId: next.id, jobId });
    }
    return getPlannerV3Status(env, jobId);
}

export async function cancelPlannerV3Generation(env, jobId) {
    await ensurePlannerV3Schema(env);
    const timestamp = nowPlannerV3Iso();
    const job = await env.DB.prepare("SELECT * FROM planner_v3_jobs WHERE id = ?").bind(jobId).first();
    if (!job) throw new Error("Planner job not found");
    await env.DB.batch([
        env.DB.prepare("UPDATE planner_v3_jobs SET status = 'cancelled', stage = 'cancelled', stage_label = 'Cancelled', cancelled_at = ?, updated_at = ? WHERE id = ?").bind(timestamp, timestamp, jobId),
        env.DB.prepare("UPDATE planner_v3_job_tasks SET status = 'cancelled', updated_at = ? WHERE job_id = ? AND status NOT IN ('completed', 'partial_failed', 'failed')").bind(timestamp, jobId),
        env.DB.prepare("UPDATE planner_v3_queue SET status = 'cancelled', updated_at = ? WHERE job_id = ? AND status NOT IN ('completed', 'failed')").bind(timestamp, jobId),
        env.DB.prepare("UPDATE planner_v3_runs SET status = 'draft', active_job_id = NULL, stage = '', stage_label = '', updated_at = ? WHERE id = ?").bind(timestamp, job.run_id),
        env.DB.prepare("UPDATE planner_v3_items SET status = CASE WHEN completed_count > 0 THEN status ELSE 'pending' END, stage = '', stage_label = '', updated_at = ? WHERE id IN (SELECT item_id FROM planner_v3_job_tasks WHERE job_id = ?)").bind(timestamp, jobId)
    ]);
    return getPlannerV3Status(env, jobId);
}

export async function claimNextPlannerV3BrowserQueue(env, jobId) {
    await ensurePlannerV3Schema(env);
    const timestamp = nowPlannerV3Iso();
    const token = makePlannerV3Id("claim");
    const row = await env.DB.prepare(`
        SELECT * FROM planner_v3_queue
        WHERE job_id = ? AND executor = 'browser'
          AND (status = 'queued' OR (status = 'running' AND lease_expires_at <= ?))
        ORDER BY sequence
        LIMIT 1
    `).bind(jobId, timestamp).first();
    if (!row) return { queue: null, status: await getPlannerV3Status(env, jobId) };
    await env.DB.prepare(`
        UPDATE planner_v3_queue
        SET status = 'running', attempts = attempts + 1, claimed_by = 'browser',
            claim_token = ?, claimed_at = ?, lease_expires_at = ?, started_at = COALESCE(started_at, ?),
            updated_at = ?
        WHERE id = ?
    `).bind(token, timestamp, futurePlannerV3Iso(BROWSER_QUEUE_LEASE_MS), timestamp, timestamp, row.id).run();
    await env.DB.batch([
        env.DB.prepare("UPDATE planner_v3_jobs SET status = 'running', stage = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?").bind(timestamp, timestamp, jobId),
        env.DB.prepare("UPDATE planner_v3_job_tasks SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?").bind(timestamp, timestamp, row.task_id),
        env.DB.prepare("UPDATE planner_v3_items SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?").bind(timestamp, timestamp, row.item_id)
    ]);
    const setting = await env.DB.prepare(`
        SELECT extra_json FROM planner_v3_generation_settings
        WHERE owner_type = 'variant' AND owner_id = ?
        LIMIT 1
    `).bind(row.variant_id).first();
    return {
        queue: {
            id: row.id,
            jobId: row.job_id,
            taskId: row.task_id,
            itemId: row.item_id,
            variantId: row.variant_id,
            imageIndex: row.image_index,
            variantImageIndex: row.variant_image_index,
            claimToken: token,
            generation: parseJson(setting?.extra_json, {})
        },
        status: await getPlannerV3Status(env, jobId)
    };
}

export async function completePlannerV3BrowserQueue(env, body = {}) {
    await ensurePlannerV3Schema(env);
    const queueId = String(body.queueId || "").trim();
    const claimToken = String(body.claimToken || "").trim();
    const r2Key = String(body.r2Key || body.key || "").trim();
    if (!queueId || !claimToken || !r2Key) throw new Error("queueId, claimToken, and r2Key are required");
    const queue = await env.DB.prepare("SELECT * FROM planner_v3_queue WHERE id = ?").bind(queueId).first();
    if (!queue || queue.status !== "running" || queue.claim_token !== claimToken) {
        throw new Error("Queue claim is no longer valid");
    }
    const timestamp = nowPlannerV3Iso();
    const assetId = makePlannerV3Id("passet");
    const fileName = r2Key.split("/").pop() || `${assetId}.webp`;
    await env.DB.prepare(`
        INSERT INTO planner_v3_assets (
            id, run_id, item_id, variant_id, job_id, task_id, queue_id, r2_key,
            file_name, mime_type, byte_size, width, height, image_index, status,
            is_public, created_at, updated_at
        )
        SELECT ?, j.run_id, q.item_id, q.variant_id, q.job_id, q.task_id, q.id, ?,
            ?, ?, ?, ?, ?, q.image_index, 'candidate', 0, ?, ?
        FROM planner_v3_queue q
        JOIN planner_v3_jobs j ON j.id = q.job_id
        WHERE q.id = ?
    `).bind(
        assetId,
        r2Key,
        fileName,
        body.mimeType || "image/webp",
        body.byteSize || null,
        body.width || null,
        body.height || null,
        timestamp,
        timestamp,
        queueId
    ).run();
    await env.DB.prepare(`
        INSERT INTO planner_v3_asset_metadata (
            asset_id, prompt, negative_prompt, model, sampler, steps, scale, seed,
            width, height, split_prompts_json, v4_rows_json, request_json, response_json,
            metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        assetId,
        body.prompt || "",
        body.negativePrompt || "",
        body.model || "",
        body.sampler || "",
        body.steps || null,
        body.scale || "",
        body.seed || "",
        body.width || null,
        body.height || null,
        JSON.stringify(body.splitPrompts || {}),
        JSON.stringify(body.v4Rows || []),
        JSON.stringify(body.request || {}),
        JSON.stringify(body.response || {}),
        JSON.stringify(body.metadata || {}),
        timestamp,
        timestamp
    ).run();
    await env.DB.batch([
        env.DB.prepare("UPDATE planner_v3_queue SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").bind(timestamp, timestamp, queueId),
        env.DB.prepare("UPDATE planner_v3_job_tasks SET completed_count = completed_count + 1, updated_at = ? WHERE id = ?").bind(timestamp, queue.task_id),
        env.DB.prepare("UPDATE planner_v3_items SET completed_count = completed_count + 1, updated_at = ? WHERE id = ?").bind(timestamp, queue.item_id),
        env.DB.prepare("UPDATE planner_v3_jobs SET completed_count = completed_count + 1, updated_at = ? WHERE id = ?").bind(timestamp, queue.job_id)
    ]);
    await rollupPlannerV3Job(env, queue.job_id);
    return { assetId, status: await getPlannerV3Status(env, queue.job_id) };
}

async function rollupPlannerV3Job(env, jobId) {
    const timestamp = nowPlannerV3Iso();
    const job = await env.DB.prepare("SELECT * FROM planner_v3_jobs WHERE id = ?").bind(jobId).first();
    if (!job || PLANNER_V3_TERMINAL_JOB_STATUSES.includes(job.status)) return;
    const rows = (await env.DB.prepare("SELECT status FROM planner_v3_queue WHERE job_id = ?").bind(jobId).all()).results || [];
    if (!rows.length) return;
    const done = rows.every(row => row.status === "completed" || row.status === "failed" || row.status === "cancelled");
    if (!done) return;
    const failed = rows.some(row => row.status === "failed");
    const status = failed ? "partial_failed" : "completed";
    await env.DB.batch([
        env.DB.prepare("UPDATE planner_v3_jobs SET status = ?, stage = ?, stage_label = ?, completed_at = ?, updated_at = ? WHERE id = ?").bind(status, status, status === "completed" ? "Completed" : "Partial failed", timestamp, timestamp, jobId),
        env.DB.prepare("UPDATE planner_v3_job_tasks SET status = CASE WHEN failed_count > 0 THEN 'partial_failed' ELSE 'completed' END, completed_at = ?, updated_at = ? WHERE job_id = ?").bind(timestamp, timestamp, jobId),
        env.DB.prepare("UPDATE planner_v3_items SET status = CASE WHEN failed_count > 0 THEN 'partial_failed' ELSE 'complete' END, completed_at = ?, updated_at = ? WHERE id IN (SELECT item_id FROM planner_v3_job_tasks WHERE job_id = ?)").bind(timestamp, timestamp, jobId),
        env.DB.prepare("UPDATE planner_v3_runs SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?").bind(failed ? "partial_failed" : "complete", timestamp, timestamp, job.run_id)
    ]);
}

export async function confirmPlannerV3Asset(env, body = {}) {
    await ensurePlannerV3Schema(env);
    if (!env.imgBucket) throw new Error("imgBucket binding is not configured");
    const itemId = String(body.itemId || body.item_id || "").trim();
    const assetId = String(body.assetId || body.asset_id || "").trim();
    const idempotencyKey = String(body.idempotencyKey || body.idempotency_key || "").trim();
    if (!itemId || !assetId || !idempotencyKey) throw new Error("itemId, assetId, and idempotencyKey are required");
    const existing = await env.DB.prepare("SELECT * FROM planner_v3_confirm_operations WHERE idempotency_key = ?").bind(idempotencyKey).first();
    if (existing?.status === "completed") return { success: true, operation: existing };
    const conflicting = await env.DB.prepare("SELECT * FROM planner_v3_confirm_operations WHERE item_id = ? AND idempotency_key <> ?").bind(itemId, idempotencyKey).first();
    if (conflicting) {
        const error = new Error("A different confirm operation already exists for this item");
        error.status = 409;
        throw error;
    }
    const asset = await env.DB.prepare("SELECT * FROM planner_v3_assets WHERE id = ? AND item_id = ? AND status = 'candidate'").bind(assetId, itemId).first();
    if (!asset) throw new Error("Candidate asset not found");
    const item = await env.DB.prepare("SELECT * FROM planner_v3_items WHERE id = ?").bind(itemId).first();
    const run = item ? await env.DB.prepare("SELECT * FROM planner_v3_runs WHERE id = ?").bind(item.run_id).first() : null;
    if (!item || !run) throw new Error("Planner item not found");
    const targetFolderPrefix = String(body.targetFolderPrefix || body.target_folder_prefix || `${run.character_prefix || run.character_id}/`).replace(/^\/+/, "");
    const targetFileName = String(body.targetFileName || body.target_file_name || `${item.image_number}.webp`);
    const targetR2Key = `${targetFolderPrefix}${targetFileName}`;
    const timestamp = nowPlannerV3Iso();
    const operationId = existing?.id || makePlannerV3Id("pcfm");
    if (!existing) {
        await env.DB.prepare(`
            INSERT INTO planner_v3_confirm_operations (
                id, run_id, item_id, selected_asset_id, selected_asset_r2_key,
                target_r2_key, target_folder_prefix, target_file_name, status,
                idempotency_key, attempts, error_message, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, '', ?, ?)
        `).bind(operationId, run.id, itemId, assetId, asset.r2_key, targetR2Key, targetFolderPrefix, targetFileName, idempotencyKey, timestamp, timestamp).run();
    }
    await env.DB.prepare("UPDATE planner_v3_confirm_operations SET status = 'copying', attempts = attempts + 1, updated_at = ? WHERE id = ?")
        .bind(timestamp, operationId).run();
    const object = await env.imgBucket.get(asset.r2_key);
    if (!object) throw new Error("Selected candidate image is missing in R2");
    await env.imgBucket.put(targetR2Key, object.body, {
        httpMetadata: { contentType: asset.mime_type || "image/webp" },
        customMetadata: { ispublic: "false", plannerConfirmOperationId: operationId }
    });
    await env.DB.prepare(`
        INSERT INTO file_metadata (folder_prefix, file_name, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(folder_prefix, file_name) DO UPDATE SET
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
    `).bind(targetFolderPrefix, targetFileName, JSON.stringify(body.metadata || {}), timestamp, timestamp).run();
    await env.DB.prepare("UPDATE planner_v3_confirm_operations SET status = 'metadata_saved', updated_at = ? WHERE id = ?")
        .bind(timestamp, operationId).run();
    const itemAssets = (await env.DB.prepare(`
        SELECT id, run_id, item_id, r2_key
        FROM planner_v3_assets
        WHERE item_id = ?
        ORDER BY image_index, created_at
    `).bind(itemId).all()).results || [];
    const cleanupFailures = [];
    for (const candidate of itemAssets) {
        try {
            await env.imgBucket.delete(candidate.r2_key);
        } catch (error) {
            cleanupFailures.push({
                ...candidate,
                errorMessage: error?.message || String(error)
            });
        }
    }
    for (const failed of cleanupFailures) {
        await env.DB.prepare(`
            INSERT OR IGNORE INTO planner_v3_asset_cleanup_queue (
                id, r2_key, source_asset_id, source_run_id, source_item_id, reason,
                status, attempts, error_message, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'confirmed_item_cleanup_failed', 'pending', 0, ?, ?, ?)
        `).bind(
            `cleanup_${failed.id}`,
            failed.r2_key,
            failed.id,
            failed.run_id,
            failed.item_id,
            failed.errorMessage,
            timestamp,
            timestamp
        ).run();
    }
    await env.DB.prepare("UPDATE planner_v3_confirm_operations SET status = 'cleanup_queued', updated_at = ? WHERE id = ?")
        .bind(timestamp, operationId).run();
    await env.DB.batch([
        env.DB.prepare("DELETE FROM planner_v3_queue WHERE item_id = ?").bind(itemId),
        env.DB.prepare("DELETE FROM planner_v3_job_tasks WHERE item_id = ?").bind(itemId),
        env.DB.prepare("DELETE FROM planner_v3_items WHERE id = ?").bind(itemId)
    ]);
    await env.DB.prepare(`
        UPDATE planner_v3_confirm_operations
        SET status = 'completed', completed_at = ?, expires_at = ?, updated_at = ?
        WHERE id = ?
    `).bind(timestamp, futurePlannerV3Iso(CONFIRM_RETENTION_MS), timestamp, operationId).run();
    await deleteEmptyPlannerV3JobsAndRuns(env, run.id);
    return {
        success: true,
        operationId,
        targetR2Key,
        cleanupFailedKeys: cleanupFailures.map(item => item.r2_key)
    };
}

export async function cleanupPlannerV3Assets(env, limit = 50) {
    await ensurePlannerV3Schema(env);
    if (!env.imgBucket) throw new Error("imgBucket binding is not configured");
    const timestamp = nowPlannerV3Iso();
    const rows = (await env.DB.prepare(`
        SELECT * FROM planner_v3_asset_cleanup_queue
        WHERE status IN ('pending', 'failed')
        ORDER BY updated_at
        LIMIT ?
    `).bind(Math.max(1, Math.min(200, asInt(limit, 50)))).all()).results || [];
    let completed = 0;
    let failed = 0;
    for (const row of rows) {
        try {
            await env.DB.prepare("UPDATE planner_v3_asset_cleanup_queue SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?")
                .bind(timestamp, row.id).run();
            await env.imgBucket.delete(row.r2_key);
            await env.DB.prepare("UPDATE planner_v3_asset_cleanup_queue SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?")
                .bind(nowPlannerV3Iso(), nowPlannerV3Iso(), row.id).run();
            completed += 1;
        } catch (error) {
            await env.DB.prepare("UPDATE planner_v3_asset_cleanup_queue SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?")
                .bind(error?.message || String(error), nowPlannerV3Iso(), row.id).run();
            failed += 1;
        }
    }
    await env.DB.prepare(`
        DELETE FROM planner_v3_confirm_operations
        WHERE status IN ('completed', 'failed')
          AND expires_at IS NOT NULL
          AND expires_at <= ?
    `).bind(nowPlannerV3Iso()).run();
    return { completed, failed, checked: rows.length };
}

async function enqueueNextPlannerV3QueueMessage(env, jobId) {
    if (!env.GENERATION_QUEUE) return false;
    const row = await env.DB.prepare(`
        SELECT id
        FROM planner_v3_queue
        WHERE job_id = ?
          AND executor = 'background'
          AND status = 'queued'
        ORDER BY sequence
        LIMIT 1
    `).bind(jobId).first();
    if (!row?.id) return false;
    await env.GENERATION_QUEUE.send({ plannerV3: true, queueId: row.id, jobId });
    return true;
}

async function getPlannerV3QueueContext(env, queueId) {
    return await env.DB.prepare(`
        SELECT
            q.*,
            j.run_id,
            j.project_id,
            j.project_prefix,
            j.character_id,
            j.status AS job_status,
            t.status AS task_status,
            i.status AS item_status,
            gs.extra_json AS generation_json
        FROM planner_v3_queue q
        JOIN planner_v3_jobs j ON j.id = q.job_id
        JOIN planner_v3_job_tasks t ON t.id = q.task_id
        JOIN planner_v3_items i ON i.id = q.item_id
        LEFT JOIN planner_v3_generation_settings gs
          ON gs.owner_type = 'variant'
         AND gs.owner_id = q.variant_id
        WHERE q.id = ?
    `).bind(queueId).first();
}

async function claimPlannerV3Queue(env, queueId) {
    const timestamp = nowPlannerV3Iso();
    const claimToken = makePlannerV3Id("claim");
    const row = await getPlannerV3QueueContext(env, queueId);
    if (!row) return null;
    if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") return null;
    if (row.job_status === "paused" || row.task_status === "paused" || row.item_status === "paused" || row.status === "paused") return null;
    if (row.job_status === "cancel_requested" || row.status === "cancel_requested") {
        await env.DB.prepare("UPDATE planner_v3_queue SET status = 'cancelled', updated_at = ? WHERE id = ?")
            .bind(timestamp, queueId).run();
        return null;
    }
    const result = await env.DB.prepare(`
        UPDATE planner_v3_queue
        SET status = 'running',
            attempts = attempts + 1,
            claimed_by = 'background',
            claim_token = ?,
            claimed_at = ?,
            lease_expires_at = ?,
            started_at = COALESCE(started_at, ?),
            updated_at = ?
        WHERE id = ?
          AND (
              status = 'queued'
              OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
          )
    `).bind(claimToken, timestamp, futurePlannerV3Iso(BROWSER_QUEUE_LEASE_MS), timestamp, timestamp, queueId, timestamp).run();
    if (!result.success) return null;
    const claimed = await getPlannerV3QueueContext(env, queueId);
    if (!claimed || claimed.claim_token !== claimToken) return null;
    await env.DB.batch([
        env.DB.prepare("UPDATE planner_v3_jobs SET status = 'running', stage = 'running', stage_label = 'Preparing generation', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ? AND status IN ('queued', 'running')")
            .bind(timestamp, timestamp, claimed.job_id),
        env.DB.prepare("UPDATE planner_v3_job_tasks SET status = 'running', stage = 'running', stage_label = 'Preparing generation', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ? AND status IN ('queued', 'running')")
            .bind(timestamp, timestamp, claimed.task_id),
        env.DB.prepare("UPDATE planner_v3_items SET status = 'running', stage = 'running', stage_label = 'Preparing generation', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ? AND status IN ('queued', 'running')")
            .bind(timestamp, timestamp, claimed.item_id),
        env.DB.prepare("UPDATE planner_v3_runs SET status = 'running', stage = 'running', stage_label = 'Preparing generation', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ? AND status IN ('queued', 'running')")
            .bind(timestamp, timestamp, claimed.run_id)
    ]);
    return claimed;
}

async function validatePlannerV3Claim(env, queueId, claimToken) {
    const timestamp = nowPlannerV3Iso();
    const row = await env.DB.prepare(`
        SELECT status, claim_token, lease_expires_at
        FROM planner_v3_queue
        WHERE id = ?
    `).bind(queueId).first();
    return !!row
        && row.status === "running"
        && row.claim_token === claimToken
        && (!row.lease_expires_at || row.lease_expires_at > timestamp);
}

async function markPlannerV3QueueFailure(env, queue, message) {
    const timestamp = nowPlannerV3Iso();
    await env.DB.batch([
        env.DB.prepare("UPDATE planner_v3_queue SET status = 'failed', error_message = ?, completed_at = ?, updated_at = ? WHERE id = ? AND status <> 'failed'")
            .bind(message, timestamp, timestamp, queue.id),
        env.DB.prepare("UPDATE planner_v3_job_tasks SET failed_count = failed_count + 1, status = CASE WHEN completed_count > 0 THEN 'partial_failed' ELSE 'failed' END, error_message = ?, updated_at = ? WHERE id = ?")
            .bind(message, timestamp, queue.task_id),
        env.DB.prepare("UPDATE planner_v3_items SET failed_count = failed_count + 1, status = CASE WHEN completed_count > 0 THEN 'partial_failed' ELSE 'failed' END, error_message = ?, updated_at = ? WHERE id = ?")
            .bind(message, timestamp, queue.item_id),
        env.DB.prepare("UPDATE planner_v3_jobs SET failed_count = failed_count + 1, status = CASE WHEN completed_count > 0 THEN 'partial_failed' ELSE 'failed' END, error_message = ?, updated_at = ? WHERE id = ?")
            .bind(message, timestamp, queue.job_id)
    ]);
    await rollupPlannerV3Job(env, queue.job_id);
}

async function registerPlannerV3GeneratedAsset(env, queue, request, r2Key, fileName, webpBuffer) {
    const timestamp = nowPlannerV3Iso();
    const assetId = r2Key.split("/").pop().replace(/\.webp$/i, "") || makePlannerV3Id("passet");
    await env.DB.prepare(`
        INSERT INTO planner_v3_assets (
            id, run_id, item_id, variant_id, job_id, task_id, queue_id, r2_key,
            file_name, mime_type, byte_size, width, height, image_index, status,
            is_public, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'image/webp', ?, ?, ?, ?, 'candidate', 0, ?, ?)
    `).bind(
        assetId,
        queue.run_id,
        queue.item_id,
        queue.variant_id,
        queue.job_id,
        queue.task_id,
        queue.id,
        r2Key,
        fileName,
        webpBuffer.byteLength,
        request.width || null,
        request.height || null,
        queue.image_index,
        timestamp,
        timestamp
    ).run();
    await env.DB.prepare(`
        INSERT INTO planner_v3_asset_metadata (
            asset_id, prompt, negative_prompt, model, sampler, steps, scale, seed,
            width, height, split_prompts_json, v4_rows_json, request_json, response_json,
            metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)
    `).bind(
        assetId,
        request.prompt || "",
        request.negative || "",
        request.model || "",
        request.sampler || "",
        request.steps || null,
        request.scale == null ? "" : String(request.scale),
        request.payload?.parameters?.seed == null ? "" : String(request.payload.parameters.seed),
        request.width || null,
        request.height || null,
        JSON.stringify(request.splitPrompts || {}),
        JSON.stringify(request.payload?.parameters?.v4_prompt?.caption?.char_captions || []),
        JSON.stringify(request.payload || {}),
        JSON.stringify({
            Prompt: request.prompt || "",
            "Negative Prompt": request.negative || "",
            Model: request.model || "",
            Sampler: request.sampler || "",
            Steps: request.steps || "",
            "CFG Scale": request.scale == null ? "" : String(request.scale),
            Seed: request.payload?.parameters?.seed == null ? "" : String(request.payload.parameters.seed),
            Width: request.width || "",
            Height: request.height || ""
        }),
        timestamp,
        timestamp
    ).run();
    return assetId;
}

export async function processPlannerV3QueueMessage(env, body = {}) {
    requireWorkerBindings(env);
    await ensurePlannerV3Schema(env);
    const queueId = String(body.queueId || "").trim();
    if (!queueId) throw new Error("queueId is required");
    const queue = await claimPlannerV3Queue(env, queueId);
    if (!queue) return;
    const attempt = Number(queue.attempts || 1);
    const generation = parseJson(queue.generation_json, {});
    const baseSeed = Number.parseInt(generation.seed, 10);
    const seed = Number.isFinite(baseSeed)
        ? (baseSeed + Number(queue.image_index || 0)) % 4294967296
        : Math.floor(Math.random() * 4294967296);
    let uploadedKey = "";
    try {
        const request = buildNovelAiPayload(generation, seed);
        await waitForNovelAiSlot(env);
        if (!await validatePlannerV3Claim(env, queue.id, queue.claim_token)) return;
        const zipBuffer = await callNovelAi(env, request.payload);
        if (!await validatePlannerV3Claim(env, queue.id, queue.claim_token)) return;
        const extracted = await extractFirstZipFile(zipBuffer);
        const webpBuffer = await encodeWebP(env, extracted.data);
        if (!await validatePlannerV3Claim(env, queue.id, queue.claim_token)) return;

        const assetId = makePlannerV3Id("passet");
        const fileName = `${assetId}.webp`;
        uploadedKey = `planner-v3/${queue.project_id}/${queue.run_id}/${queue.item_id}/${fileName}`;
        await putR2WithRetry(env.imgBucket, uploadedKey, webpBuffer, {
            httpMetadata: { contentType: "image/webp" },
            customMetadata: {
                ispublic: "false",
                plannerV3JobId: queue.job_id,
                plannerV3QueueId: queue.id
            }
        });
        if (!await validatePlannerV3Claim(env, queue.id, queue.claim_token)) {
            await env.DB.prepare(`
                INSERT OR IGNORE INTO planner_v3_asset_cleanup_queue (
                    id, r2_key, source_run_id, source_item_id, reason, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'stale_queue_upload', 'pending', ?, ?)
            `).bind(makePlannerV3Id("cleanup"), uploadedKey, queue.run_id, queue.item_id, nowPlannerV3Iso(), nowPlannerV3Iso()).run();
            return;
        }
        await registerPlannerV3GeneratedAsset(env, queue, request, uploadedKey, fileName, webpBuffer);
        const timestamp = nowPlannerV3Iso();
        await env.DB.batch([
            env.DB.prepare("UPDATE planner_v3_queue SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'running' AND claim_token = ?")
                .bind(timestamp, timestamp, queue.id, queue.claim_token),
            env.DB.prepare("UPDATE planner_v3_job_tasks SET completed_count = completed_count + 1, stage = 'running', updated_at = ? WHERE id = ?")
                .bind(timestamp, queue.task_id),
            env.DB.prepare("UPDATE planner_v3_items SET completed_count = completed_count + 1, stage = 'running', updated_at = ? WHERE id = ?")
                .bind(timestamp, queue.item_id),
            env.DB.prepare("UPDATE planner_v3_jobs SET completed_count = completed_count + 1, stage = 'running', updated_at = ? WHERE id = ?")
                .bind(timestamp, queue.job_id)
        ]);
        await rollupPlannerV3Job(env, queue.job_id);
        await enqueueNextPlannerV3QueueMessage(env, queue.job_id);
    } catch (error) {
        const message = error?.message || String(error);
        if (uploadedKey) {
            await env.imgBucket.delete(uploadedKey).catch(() => null);
        }
        const retryDelaySeconds = getRetryDelaySeconds(error, attempt);
        const isRateLimited = isNovelAiRateLimitError(error) || isNovelAiCooldownError(error);
        if (isRateLimited) await setNovelAiCooldown(env, retryDelaySeconds);
        if (!isNovelAiCooldownError(error)) {
            await writeBackgroundErrorLog(env, error, {
                jobId: queue.job_id,
                itemId: queue.item_id,
                queueId: queue.id,
                imageIndex: queue.image_index,
                attempt,
                stage: "planner_v3_queue"
            });
        }
        if (!isR2PutRetryExhausted(error) && attempt < MAX_ATTEMPTS && env.GENERATION_QUEUE) {
            await env.DB.prepare(`
                UPDATE planner_v3_queue
                SET status = 'queued',
                    error_message = ?,
                    claim_token = '',
                    claimed_by = '',
                    claimed_at = NULL,
                    lease_expires_at = NULL,
                    updated_at = ?
                WHERE id = ?
            `).bind(message.slice(0, 1000), nowPlannerV3Iso(), queue.id).run();
            await env.GENERATION_QUEUE.send({ plannerV3: true, queueId: queue.id, jobId: queue.job_id }, { delaySeconds: retryDelaySeconds });
            return;
        }
        await markPlannerV3QueueFailure(env, queue, message.slice(0, 1000));
        await enqueueNextPlannerV3QueueMessage(env, queue.job_id);
    }
}


export default {
    async scheduled(_event, env) {
        await cleanupDeletedAssets(env).catch(error => writeBackgroundErrorLog(env, error, {
            stage: "scheduled_asset_cleanup"
        }));
    },
    async queue(batch, env) {
        for (const message of batch.messages) {
            try {
                await processPlannerQueueMessage(env, message.body);
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
                throw error;
            }
        }
    }
};
