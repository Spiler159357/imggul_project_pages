const NAI_ENDPOINT = "https://image.novelai.net/ai/generate-image";
const QUALITY_TAGS = "masterpiece, best quality, very aesthetic, no text";
const QUEUE_SEND_BATCH_SIZE = 100;
const MAX_ATTEMPTS = 5;
const NAI_MIN_REQUEST_INTERVAL_MS = 15000;
const MAX_INLINE_COOLDOWN_MS = 30000;
const TERMINAL_JOB_RETENTION_MS = 10 * 60 * 1000;
const TERMINAL_JOB_STATUSES = ["completed", "partial_failed", "failed", "cancelled"];
const STAGE_LABELS = {
    queued: "Queue waiting",
    running: "Preparing generation",
    rate_limited: "Waiting after NovelAI rate limit",
    novelai_request: "Calling NovelAI",
    novelai_response: "NovelAI response received",
    zip_extract: "Extracting generated image",
    webp_encode: "Encoding WebP",
    r2_put: "Saving image to R2",
    metadata_put: "Saving metadata",
    rollup: "Updating job status",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled"
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
    return new Date().toISOString();
}

function isoBeforeNow(ms) {
    return new Date(Date.now() - ms).toISOString();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function makeId(prefix) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function makeLogKey(jobId = "unknown") {
    const d = new Date();
    const pad = value => String(value).padStart(2, "0");
    const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const stamp = `${day}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}_${crypto.randomUUID().slice(0, 8)}`;
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
            `[${nowIso()}] background-generation-error`,
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

function getPlannerPrefix(projectPrefix) {
    return `${projectPrefix}_planner_temp_image/`;
}

function getPlannerMetaKey(projectPrefix) {
    return `${getPlannerPrefix(projectPrefix)}_planner_meta.json`;
}

function getPlannerImagePrefix(projectPrefix, imageNumber) {
    return `${getPlannerPrefix(projectPrefix)}${imageNumber}/`;
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

function normalizePlannerMeta(meta) {
    if (!meta || typeof meta !== "object") throw new Error("plannerMeta is required");
    if (!Array.isArray(meta.items) || meta.items.length === 0) {
        throw new Error("plannerMeta.items is empty");
    }
    return meta;
}

function collectTargetItems(meta, targetSituationId = null) {
    const items = targetSituationId
        ? meta.items.filter(item => item.situationId === targetSituationId)
        : meta.items;
    if (!items.length) throw new Error("No planner items matched the background run target");
    return items;
}

function assertSupportedBackgroundItem(item) {
    const generation = item.generation || {};
    if (generation.vibeImageKey || generation.preciseImageKey) {
        throw new Error("Background generation does not support planner reference images yet");
    }
    if (generation.inpaintPayload || generation.inpaintImageKey) {
        throw new Error("Background generation does not support inpaint yet");
    }
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

function buildNovelAiPayload(generation = {}, seed) {
    const promptParts = getPromptParts(generation);
    const prompt = promptParts.length ? `${promptParts.join(", ")}, ${QUALITY_TAGS}` : QUALITY_TAGS;
    const negative = String(generation.negative || "").trim();
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

    return { payload, prompt, negative, width, height, model, steps, sampler, scale };
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

async function ensurePlannerBackgroundSchema(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS planner_background_rate_limits (
            key TEXT PRIMARY KEY,
            available_at INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        )
    `).run();

    const columns = await queryAll(env.DB, "PRAGMA table_info(planner_background_jobs)");
    if (!columns.length) return;
    const hasJobStage = columns.some(column => column.name === "stage");
    if (!hasJobStage) {
        await env.DB.prepare("ALTER TABLE planner_background_jobs ADD COLUMN stage TEXT").run();
    }

    const itemColumns = await queryAll(env.DB, "PRAGMA table_info(planner_background_items)");
    const hasItemStage = itemColumns.some(column => column.name === "stage");
    if (itemColumns.length && !hasItemStage) {
        await env.DB.prepare("ALTER TABLE planner_background_items ADD COLUMN stage TEXT").run();
    }
}

async function cleanupFinishedBackgroundJobs(env) {
    const cutoff = isoBeforeNow(TERMINAL_JOB_RETENTION_MS);
    const placeholders = TERMINAL_JOB_STATUSES.map(() => "?").join(", ");
    const oldJobs = await queryAll(
        env.DB,
        `SELECT id FROM planner_background_jobs WHERE status IN (${placeholders}) AND updated_at <= ? LIMIT 50`,
        ...TERMINAL_JOB_STATUSES,
        cutoff
    );
    const jobIds = oldJobs.map(job => job.id).filter(Boolean);
    if (!jobIds.length) return 0;

    const jobPlaceholders = jobIds.map(() => "?").join(", ");
    await env.DB.batch([
        env.DB.prepare(`DELETE FROM planner_background_items WHERE job_id IN (${jobPlaceholders})`).bind(...jobIds),
        env.DB.prepare(`DELETE FROM planner_background_jobs WHERE id IN (${jobPlaceholders})`).bind(...jobIds)
    ]);
    return jobIds.length;
}

export async function startPlannerBackgroundJob(env, body) {
    requireBackgroundBindings(env);
    await ensurePlannerBackgroundSchema(env);
    await cleanupFinishedBackgroundJobs(env).catch(() => null);
    const plannerMeta = normalizePlannerMeta(body?.plannerMeta);
    const projectId = String(body.projectId || plannerMeta.projectId || "").trim();
    const projectPrefix = String(body.projectPrefix || "").trim();
    const characterId = String(plannerMeta.characterId || "").trim();
    const characterPrefix = String(plannerMeta.characterPrefix || "").trim();
    const targetSituationId = body.targetSituationId || null;

    if (!projectId) throw new Error("projectId is required");
    if (!projectPrefix || projectPrefix.startsWith("/") || projectPrefix.includes("..")) {
        throw new Error("projectPrefix is invalid");
    }

    const targetItems = collectTargetItems(plannerMeta, targetSituationId);
    targetItems.forEach(assertSupportedBackgroundItem);
    const totalCount = targetItems.reduce((sum, item) => sum + parsePositiveInt(item.count || plannerMeta.defaultCount, 1), 0);

    const jobId = makeId("job");
    const createdAt = nowIso();
    const metaForStorage = {
        ...plannerMeta,
        status: "queued",
        backgroundJobId: jobId,
        stage: "queued",
        stageLabel: STAGE_LABELS.queued,
        runningSituationIds: targetItems.map(item => item.situationId),
        updatedAt: Date.now(),
        items: plannerMeta.items.map(item => targetItems.includes(item)
            ? { ...item, status: "queued", stage: "queued", stageLabel: STAGE_LABELS.queued, images: [], selectedImage: null, backgroundJobId: jobId }
            : item
        )
    };

    const inserts = [
        env.DB.prepare(`
            INSERT INTO planner_background_jobs (
                id, project_id, project_prefix, character_id, character_prefix, status, stage,
                total_count, completed_count, failed_count, target_situation_id,
                planner_meta_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'queued', 'queued', ?, 0, 0, ?, ?, ?, ?)
        `).bind(
            jobId,
            projectId,
            projectPrefix,
            characterId,
            characterPrefix,
            totalCount,
            targetSituationId,
            JSON.stringify(metaForStorage),
            createdAt,
            createdAt
        )
    ];

    const queueMessages = [];
    for (const item of targetItems) {
        const itemId = makeId("item");
        const count = parsePositiveInt(item.count || plannerMeta.defaultCount, 1);
        const outputPrefix = getPlannerImagePrefix(projectPrefix, item.imageNumber);
        inserts.push(env.DB.prepare(`
            INSERT INTO planner_background_items (
                id, job_id, situation_id, situation_name, image_number, output_prefix,
                generation_json, count, completed_count, failed_count, status, stage,
                result_keys, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'queued', 'queued', '[]', ?, ?)
        `).bind(
            itemId,
            jobId,
            item.situationId || "",
            item.situationName || item.situationId || "",
            String(item.imageNumber),
            outputPrefix,
            JSON.stringify(item.generation || {}),
            count,
            createdAt,
            createdAt
        ));

        for (let imageIndex = 0; imageIndex < count; imageIndex += 1) {
            queueMessages.push({
                body: {
                    jobId,
                    itemId,
                    imageIndex,
                    attempt: 1
                }
            });
        }
    }

    await env.DB.batch(inserts);
    if (env.GENERATION_QUEUE.sendBatch) {
        for (const batch of chunkArray(queueMessages, QUEUE_SEND_BATCH_SIZE)) {
            await env.GENERATION_QUEUE.sendBatch(batch);
        }
    } else {
        for (const message of queueMessages) {
            await env.GENERATION_QUEUE.send(message.body);
        }
    }
    await syncPlannerMetaToR2(env, jobId);

    return { jobId, status: "queued", totalCount };
}

export async function getPlannerBackgroundStatus(env, jobId) {
    if (!env.DB) throw new Error("Missing Cloudflare binding: DB");
    await ensurePlannerBackgroundSchema(env);
    await cleanupFinishedBackgroundJobs(env).catch(() => null);
    const job = await queryFirst(env.DB, "SELECT * FROM planner_background_jobs WHERE id = ?", jobId);
    if (!job) throw new Error("Background job not found");
    const items = await queryAll(env.DB, "SELECT * FROM planner_background_items WHERE job_id = ? ORDER BY image_number", jobId);
    return {
        jobId: job.id,
        status: job.status,
        stage: job.stage || "",
        stageLabel: STAGE_LABELS[job.stage] || job.stage || "",
        projectId: job.project_id,
        projectPrefix: job.project_prefix,
        totalCount: job.total_count,
        completedCount: job.completed_count,
        failedCount: job.failed_count,
        errorMessage: job.error_message || "",
        createdAt: job.created_at,
        updatedAt: job.updated_at,
        completedAt: job.completed_at,
        items: items.map(item => ({
            id: item.id,
            situationId: item.situation_id,
            situationName: item.situation_name,
            imageNumber: item.image_number,
            outputPrefix: item.output_prefix,
            count: item.count,
            completedCount: item.completed_count,
            failedCount: item.failed_count,
            status: item.status,
            stage: item.stage || "",
            stageLabel: STAGE_LABELS[item.stage] || item.stage || "",
            resultKeys: JSON.parse(item.result_keys || "[]"),
            errorMessage: item.error_message || ""
        }))
    };
}

export async function cancelPlannerBackgroundJob(env, jobId) {
    if (!env.DB) throw new Error("Missing Cloudflare binding: DB");
    await ensurePlannerBackgroundSchema(env);
    const updatedAt = nowIso();
    const job = await queryFirst(env.DB, "SELECT * FROM planner_background_jobs WHERE id = ?", jobId);
    if (!job) throw new Error("Background job not found");
    const terminalStatuses = ["completed", "failed", "partial_failed", "cancelled"];
    if (terminalStatuses.includes(job.status)) {
        await syncPlannerMetaToR2(env, jobId).catch(() => null);
        return { jobId, status: job.status };
    }

    await env.DB.batch([
        env.DB.prepare(`
        UPDATE planner_background_jobs
        SET status = 'cancelled',
            stage = 'cancelled',
            updated_at = ?,
            completed_at = COALESCE(completed_at, ?),
            cancelled_at = COALESCE(cancelled_at, ?)
            WHERE id = ?
        `).bind(updatedAt, updatedAt, updatedAt, jobId),
        env.DB.prepare(`
        UPDATE planner_background_items
        SET status = 'cancelled',
            stage = 'cancelled',
            updated_at = ?,
            completed_at = COALESCE(completed_at, ?)
            WHERE job_id = ? AND status NOT IN ('completed', 'partial_failed', 'failed', 'cancelled')
        `).bind(updatedAt, updatedAt, jobId)
    ]);
    await syncPlannerMetaToR2(env, jobId).catch(() => null);
    await cleanupFinishedBackgroundJobs(env).catch(() => null);
    return { jobId, status: "cancelled" };
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
        INSERT INTO planner_background_rate_limits (key, available_at, updated_at)
        VALUES ('novelai', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            available_at = MAX(available_at, excluded.available_at),
            updated_at = excluded.updated_at
    `).bind(availableAt, nowIso()).run();
}

async function waitForNovelAiSlot(env) {
    const row = await queryFirst(env.DB, "SELECT available_at FROM planner_background_rate_limits WHERE key = 'novelai'");
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
        INSERT INTO planner_background_rate_limits (key, available_at, updated_at)
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

function makeResultFileName(imageIndex) {
    const d = new Date();
    const pad = value => String(value).padStart(2, "0");
    const dateString = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `nai_bg_${dateString}_${String(imageIndex + 1).padStart(2, "0")}_${crypto.randomUUID().slice(0, 8)}.webp`;
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

async function readJsonObject(bucket, key, fallback = {}) {
    const object = await bucket.get(key);
    if (!object) return fallback;
    try {
        return await object.json();
    } catch {
        return fallback;
    }
}

async function putJsonObject(bucket, key, value) {
    await bucket.put(key, JSON.stringify(value, null, 2), {
        httpMetadata: { contentType: "application/json; charset=utf-8" }
    });
}

async function saveMetadata(env, outputPrefix, fileName, metadata) {
    const key = `${outputPrefix}_meta.json`;
    const db = await readJsonObject(env.imgBucket, key, {});
    db[fileName] = metadata;
    await putJsonObject(env.imgBucket, key, db);
}

async function updateProgressStage(env, jobId, itemId, stage) {
    const updatedAt = nowIso();
    await env.DB.batch([
        env.DB.prepare("UPDATE planner_background_jobs SET stage = ?, updated_at = ? WHERE id = ? AND status NOT IN ('completed', 'partial_failed', 'failed', 'cancelled', 'cancel_requested')")
            .bind(stage, updatedAt, jobId),
        env.DB.prepare("UPDATE planner_background_items SET stage = ?, updated_at = ? WHERE id = ? AND status NOT IN ('completed', 'partial_failed', 'failed', 'cancelled', 'cancel_requested')")
            .bind(stage, updatedAt, itemId)
    ]);
    await syncPlannerMetaToR2(env, jobId).catch(() => null);
}

async function refreshJobRollup(env, jobId) {
    const rows = await queryAll(env.DB, "SELECT status, completed_count, failed_count, count FROM planner_background_items WHERE job_id = ?", jobId);
    const completedCount = rows.reduce((sum, row) => sum + Number(row.completed_count || 0), 0);
    const failedCount = rows.reduce((sum, row) => sum + Number(row.failed_count || 0), 0);
    const totalCount = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
    const done = rows.every(row => ["completed", "partial_failed", "failed", "cancelled"].includes(row.status));
    let status = "running";
    if (done) {
        if (completedCount === totalCount) status = "completed";
        else if (completedCount > 0) status = "partial_failed";
        else status = "failed";
    }
    const completedAt = done ? nowIso() : null;
    await env.DB.prepare(`
        UPDATE planner_background_jobs
        SET status = ?, stage = ?, completed_count = ?, failed_count = ?, updated_at = ?, completed_at = COALESCE(completed_at, ?)
        WHERE id = ?
    `).bind(status, done ? status : "rollup", completedCount, failedCount, nowIso(), completedAt, jobId).run();
}

export async function syncPlannerMetaToR2(env, jobId) {
    const job = await queryFirst(env.DB, "SELECT * FROM planner_background_jobs WHERE id = ?", jobId);
    if (!job?.planner_meta_json) return;
    const items = await queryAll(env.DB, "SELECT * FROM planner_background_items WHERE job_id = ?", jobId);
    const metaKey = getPlannerMetaKey(job.project_prefix);
    const storedMeta = await readJsonObject(env.imgBucket, metaKey, null);
    if (!storedMeta || typeof storedMeta !== "object") return;
    const meta = storedMeta;
    const bySituation = new Map(items.map(item => [item.situation_id, item]));
    const currentIds = new Set(Array.isArray(meta.items) ? meta.items.map(item => item.situationId) : []);
    const snapshotTargetIds = new Set(items.map(item => item.situation_id));
    const hasCurrentTarget = [...snapshotTargetIds].some(id => currentIds.has(id));
    if (!hasCurrentTarget) return;

    meta.status = job.status;
    meta.stage = job.stage || "";
    meta.stageLabel = STAGE_LABELS[job.stage] || job.stage || "";
    meta.backgroundJobId = job.id;
    meta.updatedAt = Date.now();
    if (["completed", "failed", "partial_failed", "cancelled"].includes(job.status)) {
        delete meta.runningSituationIds;
    } else {
        meta.runningSituationIds = Array.isArray(meta.runningSituationIds)
            ? meta.runningSituationIds.filter(id => currentIds.has(id))
            : [...snapshotTargetIds].filter(id => currentIds.has(id));
    }
    meta.items = (meta.items || []).map(item => {
        const row = bySituation.get(item.situationId);
        if (!row) return item;
        const resultKeys = JSON.parse(row.result_keys || "[]");
        return {
            ...item,
            status: row.status === "completed" ? "done" : row.status,
            stage: row.stage || "",
            stageLabel: STAGE_LABELS[row.stage] || row.stage || "",
            images: resultKeys,
            selectedImage: resultKeys.includes(item.selectedImage) ? item.selectedImage : null,
            backgroundJobId: job.id,
            backgroundItemId: row.id,
            errorMessage: row.error_message || ""
        };
    });

    await putJsonObject(env.imgBucket, metaKey, meta);
}

async function markItemFailure(env, item, errorMessage) {
    const failedCount = Number(item.failed_count || 0) + 1;
    const completedCount = Number(item.completed_count || 0);
    const count = Number(item.count || 0);
    const status = completedCount + failedCount >= count
        ? (completedCount > 0 ? "partial_failed" : "failed")
        : "running";
    await env.DB.prepare(`
        UPDATE planner_background_items
        SET failed_count = ?, status = ?, stage = 'failed', error_message = ?, updated_at = ?
        WHERE id = ?
    `).bind(failedCount, status, errorMessage.slice(0, 1000), nowIso(), item.id).run();
}

async function enqueueRetry(env, message, attempt, delaySeconds) {
    if (!env.GENERATION_QUEUE || attempt >= MAX_ATTEMPTS) return false;
    await env.GENERATION_QUEUE.send({
        ...message,
        attempt: attempt + 1
    }, { delaySeconds });
    return true;
}

async function isBackgroundJobCancelled(env, jobId, itemId) {
    const row = await queryFirst(env.DB, `
        SELECT j.status AS job_status, i.status AS item_status
        FROM planner_background_jobs j
        LEFT JOIN planner_background_items i ON i.id = ?
        WHERE j.id = ?
    `, itemId, jobId);
    return !row || row.job_status === "cancelled" || row.job_status === "cancel_requested" || row.item_status === "cancelled" || row.item_status === "cancel_requested";
}

async function abortIfBackgroundJobCancelled(env, jobId, itemId) {
    if (!await isBackgroundJobCancelled(env, jobId, itemId)) return;
    const error = new Error("Background job cancelled");
    error.code = "BACKGROUND_JOB_CANCELLED";
    throw error;
}

export async function processPlannerQueueMessage(env, message) {
    requireWorkerBindings(env);
    await ensurePlannerBackgroundSchema(env);
    const jobId = message?.jobId;
    const itemId = message?.itemId;
    const imageIndex = Number(message?.imageIndex || 0);
    const attempt = Number(message?.attempt || 1);
    if (!jobId || !itemId) throw new Error("Invalid queue message");

    const job = await queryFirst(env.DB, "SELECT * FROM planner_background_jobs WHERE id = ?", jobId);
    const item = await queryFirst(env.DB, "SELECT * FROM planner_background_items WHERE id = ?", itemId);
    if (!job || !item) return;

    if (["cancel_requested", "cancelled"].includes(job.status) || ["cancel_requested", "cancelled"].includes(item.status)) {
        await env.DB.batch([
            env.DB.prepare(`
                UPDATE planner_background_jobs
                SET status = 'cancelled', stage = 'cancelled', updated_at = ?, completed_at = COALESCE(completed_at, ?), cancelled_at = COALESCE(cancelled_at, ?)
                WHERE id = ? AND status NOT IN ('completed', 'partial_failed', 'failed', 'cancelled')
            `).bind(nowIso(), nowIso(), nowIso(), jobId),
            env.DB.prepare(`
                UPDATE planner_background_items
                SET status = 'cancelled', stage = 'cancelled', updated_at = ?, completed_at = COALESCE(completed_at, ?)
                WHERE job_id = ? AND status NOT IN ('completed', 'partial_failed', 'failed', 'cancelled')
            `).bind(nowIso(), nowIso(), jobId)
        ]);
        await syncPlannerMetaToR2(env, jobId);
        await cleanupFinishedBackgroundJobs(env).catch(() => null);
        return;
    }

    await env.DB.batch([
        env.DB.prepare("UPDATE planner_background_jobs SET status = 'running', stage = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?")
            .bind(nowIso(), nowIso(), jobId),
        env.DB.prepare("UPDATE planner_background_items SET status = 'running', stage = 'running', started_at = COALESCE(started_at, ?), attempts = ?, updated_at = ? WHERE id = ?")
            .bind(nowIso(), attempt, nowIso(), itemId)
    ]);
    await syncPlannerMetaToR2(env, jobId);

    try {
        const generation = JSON.parse(item.generation_json || "{}");
        const baseSeed = Number.parseInt(generation.seed, 10);
        const seed = Number.isFinite(baseSeed) ? (baseSeed + imageIndex) % 4294967296 : Math.floor(Math.random() * 4294967296);
        const generatedAt = nowIso();
        const request = buildNovelAiPayload(generation, seed);
        await updateProgressStage(env, jobId, itemId, "novelai_request");
        await waitForNovelAiSlot(env);
        await abortIfBackgroundJobCancelled(env, jobId, itemId);
        const zipBuffer = await callNovelAi(env, request.payload);
        await abortIfBackgroundJobCancelled(env, jobId, itemId);
        await updateProgressStage(env, jobId, itemId, "novelai_response");
        await updateProgressStage(env, jobId, itemId, "zip_extract");
        const extracted = await extractFirstZipFile(zipBuffer);
        await abortIfBackgroundJobCancelled(env, jobId, itemId);
        await updateProgressStage(env, jobId, itemId, "webp_encode");
        const webpBuffer = await encodeWebP(env, extracted.data);
        await abortIfBackgroundJobCancelled(env, jobId, itemId);
        const fileName = makeResultFileName(imageIndex);
        const key = `${item.output_prefix}${fileName}`;

        await updateProgressStage(env, jobId, itemId, "r2_put");
        await abortIfBackgroundJobCancelled(env, jobId, itemId);
        await env.imgBucket.put(key, webpBuffer, {
            httpMetadata: { contentType: "image/webp" },
            customMetadata: { ispublic: "false", backgroundjobid: jobId }
        });
        if (await isBackgroundJobCancelled(env, jobId, itemId)) {
            await env.imgBucket.delete(key).catch(() => null);
            await abortIfBackgroundJobCancelled(env, jobId, itemId);
        }

        const resultKeys = JSON.parse(item.result_keys || "[]");
        resultKeys.push(key);
        await updateProgressStage(env, jobId, itemId, "metadata_put");
        await abortIfBackgroundJobCancelled(env, jobId, itemId);
        await saveMetadata(env, item.output_prefix, fileName, {
            Prompt: request.prompt,
            "Negative Prompt": request.negative,
            Resolution: `${request.width} x ${request.height}`,
            Seed: seed,
            Steps: request.steps,
            Sampler: request.sampler,
            "CFG Scale": request.scale,
            Model: request.model,
            "Background Job": jobId,
            "Generated At": generatedAt
        });

        const completedCount = Number(item.completed_count || 0) + 1;
        const failedCount = Number(item.failed_count || 0);
        const count = Number(item.count || 0);
        const status = completedCount + failedCount >= count ? "completed" : "running";
        await env.DB.prepare(`
            UPDATE planner_background_items
            SET completed_count = ?, status = ?, stage = ?, result_keys = ?, error_message = NULL, updated_at = ?, completed_at = CASE WHEN ? IN ('completed', 'partial_failed') THEN ? ELSE completed_at END
            WHERE id = ?
        `).bind(completedCount, status, status === "completed" ? "completed" : "running", JSON.stringify(resultKeys), nowIso(), status, nowIso(), itemId).run();
    } catch (error) {
        const errorMessage = error.message || String(error);
        if (error?.code === "BACKGROUND_JOB_CANCELLED") {
            await syncPlannerMetaToR2(env, jobId).catch(() => null);
            await cleanupFinishedBackgroundJobs(env).catch(() => null);
            return;
        }
        const retryDelaySeconds = getRetryDelaySeconds(error, attempt);
        const isRateLimited = isNovelAiRateLimitError(error) || isNovelAiCooldownError(error);
        if (!isNovelAiCooldownError(error)) {
            await writeBackgroundErrorLog(env, error, {
                jobId,
                itemId,
                imageIndex,
                attempt,
                stage: item.stage || job.stage || "unknown",
                outputPrefix: item.output_prefix,
                retryDelaySeconds
            });
        }
        if (isRateLimited) {
            await setNovelAiCooldown(env, retryDelaySeconds);
        }
        if (attempt < MAX_ATTEMPTS && await enqueueRetry(env, message, attempt, retryDelaySeconds)) {
            const retryStage = isRateLimited ? "rate_limited" : "running";
            await env.DB.batch([
                env.DB.prepare(`
                    UPDATE planner_background_jobs
                    SET stage = ?, updated_at = ?
                    WHERE id = ?
                `).bind(retryStage, nowIso(), jobId),
                env.DB.prepare(`
                    UPDATE planner_background_items
                    SET status = 'queued', stage = ?, attempts = ?, error_message = ?, updated_at = ?
                    WHERE id = ?
                `).bind(retryStage, attempt, errorMessage.slice(0, 1000), nowIso(), itemId)
            ]);
            await syncPlannerMetaToR2(env, jobId);
            return;
        }
        await markItemFailure(env, item, errorMessage);
        await refreshJobRollup(env, jobId);
        await syncPlannerMetaToR2(env, jobId);
        await cleanupFinishedBackgroundJobs(env).catch(() => null);
        return;
    }

    await refreshJobRollup(env, jobId);
    await syncPlannerMetaToR2(env, jobId);
    await cleanupFinishedBackgroundJobs(env).catch(() => null);
}

export default {
    async queue(batch, env) {
        for (const message of batch.messages) {
            try {
                await processPlannerQueueMessage(env, message.body);
            } catch (error) {
                await writeBackgroundErrorLog(env, error, {
                    jobId: message.body?.jobId || "",
                    itemId: message.body?.itemId || "",
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
