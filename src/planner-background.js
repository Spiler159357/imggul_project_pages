const NAI_ENDPOINT = "https://image.novelai.net/ai/generate-image";
const QUALITY_TAGS = "masterpiece, best quality, very aesthetic, no text";
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
    return new Date().toISOString();
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

function nowKstIso() {
    const parts = getKstDateParts();
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.millisecond}+09:00`;
}

function isoBeforeNow(ms) {
    return new Date(Date.now() - ms).toISOString();
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

function getPlannerPrefix(projectPrefix) {
    return `${projectPrefix}_planner_temp_image/`;
}

function getPlannerMetaKey(projectPrefix, characterId = "") {
    const normalizedCharacterId = String(characterId || "").trim().replace(/[\\/]+/g, "_");
    return normalizedCharacterId
        ? `${getPlannerPrefix(projectPrefix)}plans/${normalizedCharacterId}_planner_meta.json`
        : `${getPlannerPrefix(projectPrefix)}_planner_meta.json`;
}

function getPlannerImagePrefix(projectPrefix, imageNumber) {
    return `${getPlannerPrefix(projectPrefix)}${imageNumber}/`;
}

function getActiveJobKey(projectId, targetSituationId = null) {
    return `${projectId}:${targetSituationId || "__all__"}`;
}

function getActiveProjectKey(projectId) {
    return `${projectId}:__project__`;
}

function parsePositiveInt(value, fallback = 1) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseResultKeys(value) {
    try {
        const parsed = JSON.parse(value || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function compactResultKeys(value) {
    return parseResultKeys(value).filter(Boolean);
}

function getExistingPlannerResultKeys(item, count) {
    const keys = Array.isArray(item?.images) ? item.images.filter(Boolean) : [];
    return keys.slice(0, count);
}

function getResultKeyCount(resultKeys) {
    return Array.isArray(resultKeys) ? resultKeys.filter(Boolean).length : 0;
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

async function ensurePlannerBackgroundSchema(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS planner_background_rate_limits (
            key TEXT PRIMARY KEY,
            available_at INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        )
    `).run();
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS planner_background_queue (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            image_index INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            attempts INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            UNIQUE(job_id, sequence),
            UNIQUE(job_id, item_id, image_index)
        )
    `).run();
    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_planner_background_queue_next
        ON planner_background_queue(job_id, status, sequence)
    `).run();

    const columns = await queryAll(env.DB, "PRAGMA table_info(planner_background_jobs)");
    if (!columns.length) return;
    const hasJobStage = columns.some(column => column.name === "stage");
    if (!hasJobStage) {
        await env.DB.prepare("ALTER TABLE planner_background_jobs ADD COLUMN stage TEXT").run();
    }
    const hasActiveKey = columns.some(column => column.name === "active_key");
    if (!hasActiveKey) {
        await env.DB.prepare("ALTER TABLE planner_background_jobs ADD COLUMN active_key TEXT").run();
    }
    const hasActiveProjectKey = columns.some(column => column.name === "active_project_key");
    if (!hasActiveProjectKey) {
        await env.DB.prepare("ALTER TABLE planner_background_jobs ADD COLUMN active_project_key TEXT").run();
    }
    await env.DB.prepare(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_background_jobs_active_key
        ON planner_background_jobs(active_key)
        WHERE status IN ('queued', 'running', 'cancel_requested')
    `).run();
    await env.DB.prepare(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_background_jobs_active_project_key
        ON planner_background_jobs(active_project_key)
        WHERE status IN ('queued', 'running', 'cancel_requested')
    `).run();

    const itemColumns = await queryAll(env.DB, "PRAGMA table_info(planner_background_items)");
    const hasItemStage = itemColumns.some(column => column.name === "stage");
    if (itemColumns.length && !hasItemStage) {
        await env.DB.prepare("ALTER TABLE planner_background_items ADD COLUMN stage TEXT").run();
    }
    const hasQueueOrder = itemColumns.some(column => column.name === "queue_order");
    if (itemColumns.length && !hasQueueOrder) {
        await env.DB.prepare("ALTER TABLE planner_background_items ADD COLUMN queue_order INTEGER").run();
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
        env.DB.prepare(`DELETE FROM planner_background_queue WHERE job_id IN (${jobPlaceholders})`).bind(...jobIds),
        env.DB.prepare(`DELETE FROM planner_background_items WHERE job_id IN (${jobPlaceholders})`).bind(...jobIds),
        env.DB.prepare(`DELETE FROM planner_background_jobs WHERE id IN (${jobPlaceholders})`).bind(...jobIds)
    ]);
    return jobIds.length;
}

async function findActiveBackgroundJob(env, projectId) {
    const activePlaceholders = ACTIVE_JOB_STATUSES.map(() => "?").join(", ");
    const params = [
        projectId,
        ...ACTIVE_JOB_STATUSES
    ];
    return await queryFirst(
        env.DB,
        `
            SELECT * FROM planner_background_jobs
            WHERE project_id = ?
              AND status IN (${activePlaceholders})
            ORDER BY created_at DESC
            LIMIT 1
        `,
        ...params
    );
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
    const initialCompletedCount = targetItems.reduce((sum, item) => {
        const count = parsePositiveInt(item.count || plannerMeta.defaultCount, 1);
        return sum + Math.min(count, getExistingPlannerResultKeys(item, count).length);
    }, 0);
    const activeKey = getActiveJobKey(projectId, targetSituationId);
    const activeProjectKey = getActiveProjectKey(projectId);
    const activeJob = await findActiveBackgroundJob(env, projectId);
    if (activeJob) {
        await syncPlannerMetaToR2Safely(env, activeJob.id, { stage: "background_start_existing_job" });
        return {
            jobId: activeJob.id,
            status: activeJob.status,
            totalCount: activeJob.total_count,
            existing: true
        };
    }

    const jobId = makeId("job");
    const createdAt = nowIso();
    const hasPendingGeneration = initialCompletedCount < totalCount;
    const initialJobStatus = hasPendingGeneration ? "queued" : "completed";
    const initialJobStage = initialJobStatus;

    const inserts = [
        env.DB.prepare(`
            INSERT INTO planner_background_jobs (
                id, project_id, project_prefix, character_id, character_prefix, status, stage,
                total_count, completed_count, failed_count, target_situation_id,
                planner_meta_json, active_key, active_project_key, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
        `).bind(
            jobId,
            projectId,
            projectPrefix,
            characterId,
            characterPrefix,
            initialJobStatus,
            initialJobStage,
            totalCount,
            initialCompletedCount,
            targetSituationId,
            JSON.stringify(plannerMeta),
            activeKey,
            activeProjectKey,
            createdAt,
            createdAt
        )
    ];

    let queueSequence = 0;
    for (const [queueOrder, item] of targetItems.entries()) {
        const itemId = makeId("item");
        const count = parsePositiveInt(item.count || plannerMeta.defaultCount, 1);
        const resultKeys = getExistingPlannerResultKeys(item, count);
        const completedCount = Math.min(count, getResultKeyCount(resultKeys));
        const itemStatus = completedCount >= count ? "completed" : "queued";
        const outputPrefix = getPlannerImagePrefix(projectPrefix, item.imageNumber);
        const generationJson = itemStatus === "completed"
            ? "{}"
            : JSON.stringify(item.generation || {});
        inserts.push(env.DB.prepare(`
            INSERT INTO planner_background_items (
                id, job_id, situation_id, situation_name, image_number, output_prefix,
                generation_json, count, completed_count, failed_count, status, stage,
                result_keys, queue_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
        `).bind(
            itemId,
            jobId,
            item.situationId || "",
            item.situationName || item.situationId || "",
            String(item.imageNumber),
            outputPrefix,
            generationJson,
            count,
            completedCount,
            itemStatus,
            itemStatus,
            JSON.stringify(resultKeys),
            queueOrder,
            createdAt,
            createdAt
        ));
        for (let imageIndex = 0; imageIndex < count; imageIndex += 1) {
            if (resultKeys[imageIndex]) continue;
            inserts.push(env.DB.prepare(`
                INSERT INTO planner_background_queue (
                    id, job_id, item_id, sequence, image_index, status, attempts, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?)
            `).bind(
                makeId("queue"),
                jobId,
                itemId,
                queueSequence,
                imageIndex,
                createdAt,
                createdAt
            ));
            queueSequence += 1;
        }
    }

    try {
        await env.DB.batch(inserts);
    } catch (error) {
        const concurrentJob = await findActiveBackgroundJob(env, projectId);
        if (concurrentJob) {
            await syncPlannerMetaToR2Safely(env, concurrentJob.id, { stage: "background_start_concurrent_job" });
            return {
                jobId: concurrentJob.id,
                status: concurrentJob.status,
                totalCount: concurrentJob.total_count,
                existing: true
            };
        }
        throw error;
    }
    await enqueueNextPlannerQueueMessage(env, jobId);
    await syncPlannerMetaToR2Safely(env, jobId, { stage: "background_start_sync" });

    return { jobId, status: initialJobStatus, totalCount };
}

export async function getPlannerBackgroundStatus(env, jobId) {
    if (!env.DB) throw new Error("Missing Cloudflare binding: DB");
    await ensurePlannerBackgroundSchema(env);
    await cleanupFinishedBackgroundJobs(env).catch(() => null);
    const job = await queryFirst(env.DB, "SELECT * FROM planner_background_jobs WHERE id = ?", jobId);
    if (!job) {
        return {
            jobId,
            status: "expired",
            stage: "expired",
            stageLabel: "Expired",
            expired: true,
            items: []
        };
    }
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
            resultKeys: compactResultKeys(item.result_keys),
            errorMessage: item.error_message || ""
        }))
    };
}

export async function cancelPlannerBackgroundJob(env, jobId) {
    if (!env.DB) throw new Error("Missing Cloudflare binding: DB");
    await ensurePlannerBackgroundSchema(env);
    const job = await queryFirst(env.DB, "SELECT * FROM planner_background_jobs WHERE id = ?", jobId);
    if (!job) throw new Error("Background job not found");
    const terminalStatuses = ["completed", "failed", "partial_failed"];
    if (terminalStatuses.includes(job.status)) {
        await syncPlannerMetaToR2(env, jobId).catch(() => null);
        return { jobId, status: job.status };
    }

    await resetPlannerMetaAfterBackgroundCancel(env, jobId).catch(() => null);
    await env.DB.batch([
        env.DB.prepare("DELETE FROM planner_background_queue WHERE job_id = ?").bind(jobId),
        env.DB.prepare("DELETE FROM planner_background_items WHERE job_id = ?").bind(jobId),
        env.DB.prepare("DELETE FROM planner_background_jobs WHERE id = ?").bind(jobId)
    ]);
    await cleanupFinishedBackgroundJobs(env).catch(() => null);
    return { jobId, status: "queued" };
}

export async function pausePlannerBackgroundJob(env, jobId) {
    if (!env.DB) throw new Error("Missing Cloudflare binding: DB");
    await ensurePlannerBackgroundSchema(env);
    const updatedAt = nowIso();
    const job = await queryFirst(env.DB, "SELECT * FROM planner_background_jobs WHERE id = ?", jobId);
    if (!job) throw new Error("Background job not found");
    const terminalStatuses = ["completed", "failed", "partial_failed"];
    if (terminalStatuses.includes(job.status) || job.status === PAUSED_JOB_STATUS) {
        await syncPlannerMetaToR2(env, jobId).catch(() => null);
        return { jobId, status: job.status };
    }

    await env.DB.batch([
        env.DB.prepare(`
        UPDATE planner_background_jobs
        SET status = 'paused',
            stage = 'paused',
            updated_at = ?
            WHERE id = ? AND status NOT IN ('completed', 'partial_failed', 'failed')
        `).bind(updatedAt, jobId),
        env.DB.prepare(`
        UPDATE planner_background_items
        SET status = 'paused',
            stage = 'paused',
            updated_at = ?
            WHERE job_id = ? AND status NOT IN ('completed', 'partial_failed', 'failed')
        `).bind(updatedAt, jobId),
        env.DB.prepare(`
        UPDATE planner_background_queue
        SET status = 'paused',
            updated_at = ?
            WHERE job_id = ? AND status IN ('queued', 'running')
        `).bind(updatedAt, jobId)
    ]);
    await syncPlannerMetaToR2(env, jobId).catch(() => null);
    return { jobId, status: PAUSED_JOB_STATUS };
}

async function enqueuePlannerBackgroundMessages(env, messages) {
    if (!messages.length) return;
    if (env.GENERATION_QUEUE.sendBatch) {
        for (const batch of chunkArray(messages, QUEUE_SEND_BATCH_SIZE)) {
            await env.GENERATION_QUEUE.sendBatch(batch);
        }
        return;
    }
    for (const message of messages) {
        await env.GENERATION_QUEUE.send(message.body);
    }
}

async function ensurePlannerQueueEntriesForJob(env, jobId) {
    const existing = await queryFirst(env.DB, "SELECT id FROM planner_background_queue WHERE job_id = ? LIMIT 1", jobId);
    if (existing) return;
    const items = await queryAll(env.DB, `
        SELECT id, count, result_keys
        FROM planner_background_items
        WHERE job_id = ?
        ORDER BY
          CASE WHEN queue_order IS NULL THEN 1 ELSE 0 END,
          queue_order ASC,
          CAST(image_number AS INTEGER) ASC,
          image_number ASC,
          created_at ASC
    `, jobId);
    const now = nowIso();
    const inserts = [];
    let sequence = 0;
    for (const item of items) {
        const resultKeys = parseResultKeys(item.result_keys);
        const count = Number(item.count || 0);
        for (let imageIndex = 0; imageIndex < count; imageIndex += 1) {
            if (resultKeys[imageIndex]) continue;
            inserts.push(env.DB.prepare(`
                INSERT OR IGNORE INTO planner_background_queue (
                    id, job_id, item_id, sequence, image_index, status, attempts, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?)
            `).bind(makeId("queue"), jobId, item.id, sequence, imageIndex, now, now));
            sequence += 1;
        }
    }
    if (inserts.length) await env.DB.batch(inserts);
}

async function getNextPlannerQueueMessage(env, jobId) {
    const job = await queryFirst(env.DB, "SELECT status FROM planner_background_jobs WHERE id = ?", jobId);
    if (!job || !["queued", "running"].includes(job.status)) return null;
    await ensurePlannerQueueEntriesForJob(env, jobId);
    const running = await queryFirst(
        env.DB,
        "SELECT id FROM planner_background_queue WHERE job_id = ? AND status = 'running' LIMIT 1",
        jobId
    );
    if (running) return null;

    const entry = await queryFirst(env.DB, `
        SELECT id, item_id, image_index, attempts
        FROM planner_background_queue
        WHERE job_id = ? AND status = 'queued'
        ORDER BY sequence ASC
        LIMIT 1
    `, jobId);
    if (!entry) return null;
    const now = nowIso();
    await env.DB.prepare(`
        UPDATE planner_background_queue
        SET status = 'running',
            attempts = attempts + 1,
            started_at = COALESCE(started_at, ?),
            updated_at = ?
        WHERE id = ? AND status = 'queued'
    `).bind(now, now, entry.id).run();
    return {
        body: {
            jobId,
            queueId: entry.id,
            itemId: entry.item_id,
            imageIndex: Number(entry.image_index || 0),
            attempt: Number(entry.attempts || 0) + 1
        }
    };
}

async function enqueueNextPlannerQueueMessage(env, jobId) {
    const message = await getNextPlannerQueueMessage(env, jobId);
    if (!message) return false;
    await enqueuePlannerBackgroundMessages(env, [message]);
    return true;
}

export async function resumePlannerBackgroundJob(env, jobId) {
    requireBackgroundBindings(env);
    await ensurePlannerBackgroundSchema(env);
    await cleanupFinishedBackgroundJobs(env).catch(() => null);
    const job = await queryFirst(env.DB, "SELECT * FROM planner_background_jobs WHERE id = ?", jobId);
    if (!job) {
        return { jobId, status: "expired", expired: true };
    }
    if (["completed", "failed", "partial_failed"].includes(job.status)) {
        await syncPlannerMetaToR2(env, jobId).catch(() => null);
        return { jobId, status: job.status };
    }
    if (job.status !== PAUSED_JOB_STATUS) {
        await syncPlannerMetaToR2(env, jobId).catch(() => null);
        return { jobId, status: job.status };
    }

    const activeJob = await findActiveBackgroundJob(env, job.project_id);
    if (activeJob && activeJob.id !== jobId) {
        throw new Error("Another planner background job is already active for this project");
    }

    const items = await queryAll(env.DB, "SELECT * FROM planner_background_items WHERE job_id = ? ORDER BY image_number", jobId);
    const updatedAt = nowIso();
    const runnableItems = items.filter(item => !["completed", "partial_failed", "failed"].includes(item.status));
    const itemUpdates = [];
    for (const item of runnableItems) {
        const resultKeys = parseResultKeys(item.result_keys);
        const count = Number(item.count || 0);
        const completedCount = Math.min(count, getResultKeyCount(resultKeys));
        const complete = completedCount >= count;
        itemUpdates.push(env.DB.prepare(`
            UPDATE planner_background_items
            SET completed_count = ?,
                status = ?,
                stage = ?,
                generation_json = CASE WHEN ? = 1 THEN '{}' ELSE generation_json END,
                updated_at = ?,
                completed_at = CASE WHEN ? = 1 THEN COALESCE(completed_at, ?) ELSE completed_at END
            WHERE id = ?
        `).bind(completedCount, complete ? "completed" : "queued", complete ? "completed" : "queued", complete ? 1 : 0, updatedAt, complete ? 1 : 0, updatedAt, item.id));
    }

    await env.DB.batch([
        env.DB.prepare(`
            UPDATE planner_background_jobs
            SET status = 'queued',
                stage = 'queued',
                updated_at = ?
            WHERE id = ?
        `).bind(updatedAt, jobId),
        env.DB.prepare(`
            UPDATE planner_background_items
            SET status = 'queued',
                stage = 'queued',
                updated_at = ?
            WHERE job_id = ? AND status NOT IN ('completed', 'partial_failed', 'failed')
        `).bind(updatedAt, jobId)
    ]);
    if (itemUpdates.length) await env.DB.batch(itemUpdates);
    await ensurePlannerQueueEntriesForJob(env, jobId);
    await env.DB.prepare(`
        UPDATE planner_background_queue
        SET status = 'queued',
            updated_at = ?
        WHERE job_id = ? AND status IN ('paused', 'running')
    `).bind(updatedAt, jobId).run();
    await refreshJobRollup(env, jobId);
    await enqueueNextPlannerQueueMessage(env, jobId);
    await syncPlannerMetaToR2(env, jobId).catch(() => null);
    const resumedJob = await queryFirst(env.DB, "SELECT status FROM planner_background_jobs WHERE id = ?", jobId);
    return { jobId, status: resumedJob?.status || "queued", totalCount: job.total_count };
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

function parseJsonField(value, fallback) {
    try {
        return value ? JSON.parse(value) : fallback;
    } catch {
        return fallback;
    }
}

async function putJsonDocument(env, docType, objectKey, value) {
    if (!env?.DB) return;
    if (docType === "planner_meta") {
        await putPlannerMetaDocument(env, objectKey, value);
        return;
    }
    const timestamp = nowIso();
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS json_documents (
            doc_type TEXT NOT NULL,
            object_key TEXT NOT NULL,
            data_json TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'db',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (doc_type, object_key)
        )
    `).run();
    await env.DB.prepare(`
        INSERT INTO json_documents (doc_type, object_key, data_json, source, created_at, updated_at)
        VALUES (?, ?, ?, 'background_worker', ?, ?)
        ON CONFLICT(doc_type, object_key) DO UPDATE SET
            data_json = excluded.data_json,
            source = excluded.source,
            updated_at = excluded.updated_at
    `).bind(docType, objectKey, JSON.stringify(value || {}), timestamp, timestamp).run();
}

async function ensurePlannerMetaSchema(env) {
    if (!env?.DB) return;
    await env.DB.batch([
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS planner_metas (
                object_key TEXT PRIMARY KEY,
                project_id TEXT NOT NULL DEFAULT '',
                project_prefix TEXT NOT NULL,
                character_id TEXT NOT NULL,
                character_prefix TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'draft',
                stage TEXT NOT NULL DEFAULT '',
                stage_label TEXT NOT NULL DEFAULT '',
                default_count INTEGER NOT NULL DEFAULT 20,
                background_job_id TEXT NOT NULL DEFAULT '',
                background_status_json TEXT NOT NULL DEFAULT '{}',
                running_situation_ids_json TEXT NOT NULL DEFAULT '[]',
                extra_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        `),
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS planner_items (
                id TEXT PRIMARY KEY,
                meta_object_key TEXT NOT NULL,
                situation_id TEXT NOT NULL,
                situation_name TEXT NOT NULL DEFAULT '',
                situation_index INTEGER,
                image_number TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 20,
                status TEXT NOT NULL DEFAULT 'pending',
                stage TEXT NOT NULL DEFAULT '',
                stage_label TEXT NOT NULL DEFAULT '',
                selected_image TEXT NOT NULL DEFAULT '',
                final_image TEXT NOT NULL DEFAULT '',
                error_message TEXT NOT NULL DEFAULT '',
                background_job_id TEXT NOT NULL DEFAULT '',
                background_item_id TEXT NOT NULL DEFAULT '',
                generation_json TEXT NOT NULL DEFAULT '{}',
                extra_json TEXT NOT NULL DEFAULT '{}',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE (meta_object_key, situation_id)
            )
        `),
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS planner_item_v4_rows (
                item_id TEXT NOT NULL,
                row_index INTEGER NOT NULL,
                subject TEXT NOT NULL DEFAULT '',
                clothing TEXT NOT NULL DEFAULT '',
                expression TEXT NOT NULL DEFAULT '',
                action TEXT NOT NULL DEFAULT '',
                negative TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (item_id, row_index)
            )
        `),
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS planner_item_images (
                item_id TEXT NOT NULL,
                image_key TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                PRIMARY KEY (item_id, image_key)
            )
        `),
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS planner_item_image_snapshots (
                item_id TEXT NOT NULL,
                image_key TEXT NOT NULL,
                snapshot_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (item_id, image_key)
            )
        `)
    ]);
}

function getPlannerItemDbId(objectKey, item, index) {
    return `${objectKey}#${item?.situationId || item?.imageNumber || index}`;
}

function getPlannerIdentityFromKey(objectKey = "") {
    const key = String(objectKey || "");
    const marker = "_planner_temp_image/";
    const markerIndex = key.indexOf(marker);
    const projectPrefix = markerIndex >= 0 ? key.slice(0, markerIndex) : "";
    const planMatch = key.match(/\/plans\/([^/]+)_planner_meta\.json$/);
    return {
        projectPrefix,
        characterId: planMatch?.[1] || ""
    };
}

function getCanonicalPlannerObjectKey(objectKey = "", header = {}) {
    const identity = getPlannerIdentityFromKey(objectKey);
    const projectPrefix = header.projectPrefix || identity.projectPrefix || header.projectId || "";
    const rawCharacterId = header.characterId || identity.characterId || "";
    const characterId = String(rawCharacterId || "").trim().replace(/[\\/]+/g, "_");
    if (!projectPrefix) return String(objectKey || "");
    return characterId
        ? `${projectPrefix}_planner_temp_image/plans/${characterId}_planner_meta.json`
        : `${projectPrefix}_planner_temp_image/_planner_meta.json`;
}

async function ensureV2PlannerSourceSchema(env) {
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS v2_planner_sources (
            source_key TEXT PRIMARY KEY,
            planner_run_id TEXT NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'planner_meta',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (planner_run_id) REFERENCES v2_planner_runs(id) ON DELETE CASCADE
        )
    `).run();
    await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_v2_planner_sources_run
        ON v2_planner_sources(planner_run_id)
    `).run();
}

function normalizeV2PlannerRunStatus(status = "draft") {
    if (status === "queued") return "running";
    if (status === "partial_failed") return "failed";
    if (status === "cancel_requested") return "draft";
    return ["draft", "running", "paused", "completed", "confirmed", "failed"].includes(status) ? status : "draft";
}

function normalizeV2PlannerItemStatus(status = "pending") {
    if (status === "queued") return "running";
    if (status === "completed") return "done";
    if (status === "partial_failed") return "failed";
    if (status === "cancel_requested") return "pending";
    return ["pending", "running", "paused", "done", "confirmed", "failed"].includes(status) ? status : "pending";
}

function splitPlannerMetaForDb(meta = {}) {
    const {
        items,
        projectId,
        projectPrefix,
        characterId,
        characterPrefix,
        status,
        stage,
        stageLabel,
        defaultCount,
        backgroundJobId,
        backgroundStatus,
        runningSituationIds,
        createdAt,
        ...extra
    } = meta || {};
    return {
        header: {
            projectId: projectId || '',
            projectPrefix: projectPrefix || '',
            characterId: characterId || '',
            characterPrefix: characterPrefix || '',
            status: status || 'draft',
            stage: stage || '',
            stageLabel: stageLabel || '',
            defaultCount: Number.parseInt(defaultCount || 20, 10) || 20,
            backgroundJobId: backgroundJobId || '',
            backgroundStatus: backgroundStatus || {},
            runningSituationIds: Array.isArray(runningSituationIds) ? runningSituationIds : [],
            extra,
            createdAt
        },
        items: Array.isArray(items) ? items : []
    };
}

function splitPlannerItemForDb(item = {}) {
    const {
        generation,
        images,
        imagePromptSnapshots,
        situationId,
        situationName,
        situationIndex,
        imageNumber,
        count,
        status,
        stage,
        stageLabel,
        selectedImage,
        finalImage,
        errorMessage,
        backgroundJobId,
        backgroundItemId,
        ...extra
    } = item || {};
    const generationCopy = { ...(generation || {}) };
    const v4Rows = Array.isArray(generationCopy.v4PromptCharacters)
        ? generationCopy.v4PromptCharacters
        : (Array.isArray(generationCopy.v4_prompt) ? generationCopy.v4_prompt : []);
    delete generationCopy.v4PromptCharacters;
    delete generationCopy.v4_prompt;
    return {
        item: {
            situationId: situationId || '',
            situationName: situationName || situationId || '',
            situationIndex: Number.isFinite(Number(situationIndex)) ? Number(situationIndex) : null,
            imageNumber: String(imageNumber || ''),
            count: Number.parseInt(count || 20, 10) || 20,
            status: status || 'pending',
            stage: stage || '',
            stageLabel: stageLabel || '',
            selectedImage: selectedImage || '',
            finalImage: finalImage || '',
            errorMessage: errorMessage || '',
            backgroundJobId: backgroundJobId || '',
            backgroundItemId: backgroundItemId || '',
            generation: generationCopy,
            extra
        },
        images: Array.isArray(images) ? images.filter(Boolean) : [],
        snapshots: imagePromptSnapshots && typeof imagePromptSnapshots === 'object' ? imagePromptSnapshots : {},
        v4Rows: Array.isArray(v4Rows) ? v4Rows : []
    };
}

async function putV2PlannerMetaDocument(env, objectKey, meta = {}) {
    await ensureV2PlannerSourceSchema(env);
    const timestamp = nowIso();
    const { header, items } = splitPlannerMetaForDb(meta);
    const canonicalObjectKey = getCanonicalPlannerObjectKey(objectKey, header);
    const identity = getPlannerIdentityFromKey(canonicalObjectKey);
    const projectPrefix = header.projectPrefix || identity.projectPrefix || header.projectId || makeStableDbId("project", objectKey);
    const projectId = projectPrefix;
    const characterId = header.characterId || identity.characterId || makeStableDbId("character", objectKey);
    const characterPrefix = header.characterPrefix || characterId;
    const runId = makeStableDbId("run", canonicalObjectKey);
    const statements = [
        env.DB.prepare(`
            INSERT INTO v2_projects (id, name, prefix, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET prefix = excluded.prefix, updated_at = excluded.updated_at
        `).bind(projectId, projectPrefix, projectPrefix, timestamp, timestamp),
        env.DB.prepare(`
            INSERT INTO v2_characters (id, project_id, name, prefix, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, prefix = excluded.prefix, updated_at = excluded.updated_at
        `).bind(characterId, projectId, characterPrefix, characterPrefix, timestamp, timestamp),
        env.DB.prepare("DELETE FROM v2_prompt_v4_rows WHERE prompt_set_id IN (SELECT id FROM v2_prompt_sets WHERE owner_type = ? AND owner_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id = ?))")
            .bind("planner_item", runId),
        env.DB.prepare("DELETE FROM v2_prompt_parts WHERE prompt_set_id IN (SELECT id FROM v2_prompt_sets WHERE owner_type = ? AND owner_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id = ?))")
            .bind("planner_item", runId),
        env.DB.prepare("DELETE FROM v2_prompt_sets WHERE owner_type = ? AND owner_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id = ?)")
            .bind("planner_item", runId),
        env.DB.prepare("DELETE FROM v2_planner_generated_images WHERE planner_item_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id = ?)")
            .bind(runId),
        env.DB.prepare("DELETE FROM v2_planner_items WHERE planner_run_id = ?").bind(runId),
        env.DB.prepare("DELETE FROM v2_planner_sources WHERE source_key IN (?, ?)")
            .bind(objectKey, canonicalObjectKey),
        env.DB.prepare(`
            INSERT INTO v2_planner_runs (
                id, project_id, character_id, status, mode, default_count, legacy_object_key,
                ui_status, stage, stage_label, background_job_id, background_status_json,
                running_situation_ids_json, created_at, updated_at, completed_at, confirmed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                project_id = excluded.project_id,
                character_id = excluded.character_id,
                status = excluded.status,
                mode = excluded.mode,
                default_count = excluded.default_count,
                legacy_object_key = excluded.legacy_object_key,
                ui_status = excluded.ui_status,
                stage = excluded.stage,
                stage_label = excluded.stage_label,
                background_job_id = excluded.background_job_id,
                background_status_json = excluded.background_status_json,
                running_situation_ids_json = excluded.running_situation_ids_json,
                updated_at = excluded.updated_at,
                completed_at = excluded.completed_at,
                confirmed_at = excluded.confirmed_at
        `).bind(
            runId,
            projectId,
            characterId,
            normalizeV2PlannerRunStatus(header.status),
            header.backgroundJobId ? "background" : "browser",
            header.defaultCount,
            canonicalObjectKey,
            header.status || "",
            header.stage || "",
            header.stageLabel || "",
            header.backgroundJobId || "",
            JSON.stringify(header.backgroundStatus || {}),
            JSON.stringify(header.runningSituationIds || []),
            header.createdAt || timestamp,
            timestamp,
            ["completed", "confirmed"].includes(normalizeV2PlannerRunStatus(header.status)) ? timestamp : null,
            normalizeV2PlannerRunStatus(header.status) === "confirmed" ? timestamp : null
        ),
        env.DB.prepare(`
            INSERT INTO v2_planner_sources (source_key, planner_run_id, source_type, created_at, updated_at)
            VALUES (?, ?, 'canonical', ?, ?)
            ON CONFLICT(source_key) DO UPDATE SET
                planner_run_id = excluded.planner_run_id,
                source_type = excluded.source_type,
                updated_at = excluded.updated_at
        `).bind(canonicalObjectKey, runId, timestamp, timestamp),
        env.DB.prepare(`
            INSERT INTO v2_planner_sources (source_key, planner_run_id, source_type, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(source_key) DO UPDATE SET
                planner_run_id = excluded.planner_run_id,
                source_type = excluded.source_type,
                updated_at = excluded.updated_at
        `).bind(objectKey, runId, objectKey === canonicalObjectKey ? "canonical" : "legacy_alias", timestamp, timestamp)
    ];

    const seenAssetIds = new Set();

    items.forEach((rawItem, index) => {
        const split = splitPlannerItemForDb(rawItem);
        const situationId = split.item.situationId || makeStableDbId("situation", `${objectKey}:${index}`);
        const itemId = makeStableDbId("pitem", `${objectKey}:${situationId}`);
        const promptSetId = makeStableDbId("prompt", itemId);
        const imageIds = [];
        split.images.forEach(imageKey => {
            const assetId = getAssetIdFromKey(imageKey);
            if (seenAssetIds.has(assetId)) return;
            seenAssetIds.add(assetId);
            imageIds.push({
                key: imageKey,
                assetId,
                generatedId: makeStableDbId("pgen", `${itemId}:${imageKey}`)
            });
        });
        const selected = imageIds.find(image => image.key === split.item.selectedImage);
        const confirmed = imageIds.find(image => image.key === split.item.finalImage);
        statements.push(
            env.DB.prepare(`
                INSERT INTO v2_situations (id, project_id, name, image_number, rating, sort_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'sfw', ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, image_number = excluded.image_number, sort_order = excluded.sort_order, updated_at = excluded.updated_at
            `).bind(situationId, projectId, split.item.situationName || situationId, split.item.imageNumber || String(index + 1), index, timestamp, timestamp),
            env.DB.prepare(`
                INSERT INTO v2_planner_items (
                    id, planner_run_id, situation_id, image_number, status, target_count,
                    selected_generated_image_id, confirmed_asset_id, sort_order, ui_status, situation_index,
                    stage, stage_label, error_message, background_job_id, background_item_id, extra_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                itemId,
                runId,
                situationId,
                split.item.imageNumber || String(index + 1),
                normalizeV2PlannerItemStatus(split.item.status),
                split.item.count,
                selected?.generatedId || null,
                confirmed?.assetId || null,
                index,
                split.item.status || "",
                split.item.situationIndex,
                split.item.stage || "",
                split.item.stageLabel || "",
                split.item.errorMessage || "",
                split.item.backgroundJobId || "",
                split.item.backgroundItemId || "",
                JSON.stringify(split.item.extra || {}),
                timestamp,
                timestamp
            ),
            env.DB.prepare(`
                INSERT INTO v2_prompt_sets (id, owner_type, owner_id, kind, name, is_active, sort_order, compiled_prompt_json, created_at, updated_at)
                VALUES (?, 'planner_item', ?, 'snapshot', '', 1, 0, ?, ?, ?)
            `).bind(promptSetId, itemId, JSON.stringify(split.item.generation || {}), timestamp, timestamp)
        );
        split.v4Rows.forEach((row, rowIndex) => {
            statements.push(env.DB.prepare(`
                INSERT INTO v2_prompt_v4_rows (id, prompt_set_id, row_index, subject, clothing, expression, action, negative)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(makeStableDbId("v4", `${promptSetId}:${rowIndex}`), promptSetId, rowIndex, row?.subject || "", row?.clothing || "", row?.expression || "", row?.action || "", row?.negative || ""));
        });
        imageIds.forEach((image, imageIndex) => {
            statements.push(
                env.DB.prepare(`
                    INSERT INTO v2_assets (
                        id, project_id, owner_type, owner_id, r2_key, file_name, mime_type,
                        kind, status, is_public, sort_order, created_at, updated_at
                    ) VALUES (?, ?, 'planner_item', ?, ?, ?, 'image/webp', 'image', 'active', 0, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        project_id = excluded.project_id,
                        owner_type = excluded.owner_type,
                        owner_id = excluded.owner_id,
                        r2_key = excluded.r2_key,
                        file_name = excluded.file_name,
                        sort_order = excluded.sort_order,
                        status = 'active',
                        deleted_at = NULL,
                        updated_at = excluded.updated_at
                `).bind(image.assetId, projectId, itemId, image.key, getFileNameFromKey(image.key), imageIndex, timestamp, timestamp),
                env.DB.prepare(`
                    INSERT INTO v2_planner_generated_images (id, planner_item_id, asset_id, image_index, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(asset_id) DO UPDATE SET
                        id = excluded.id,
                        planner_item_id = excluded.planner_item_id,
                        image_index = excluded.image_index,
                        status = excluded.status,
                        created_at = excluded.created_at
                `).bind(image.generatedId, itemId, image.assetId, imageIndex, image.key === split.item.finalImage ? "confirmed" : (image.key === split.item.selectedImage ? "selected" : "candidate"), timestamp)
            );
        });
    });

    for (let i = 0; i < statements.length; i += 50) {
        await env.DB.batch(statements.slice(i, i + 50));
    }
}

function normalizeV2GenerationStatus(status = "queued") {
    if (status === "cancel_requested") return "queued";
    return ["queued", "running", "paused", "completed", "partial_failed", "failed"].includes(status) ? status : "queued";
}

async function syncV2GenerationFromBackgroundJob(env, jobId) {
    if (!env?.DB) return;
    const job = await queryFirst(env.DB, "SELECT * FROM planner_background_jobs WHERE id = ?", jobId);
    if (!job) return;
    const items = await queryAll(env.DB, "SELECT * FROM planner_background_items WHERE job_id = ?", jobId);
    const queueRows = await queryAll(env.DB, "SELECT * FROM planner_background_queue WHERE job_id = ?", jobId);
    const metaKey = getPlannerMetaKey(job.project_prefix, job.character_id);
    const plannerRunId = makeStableDbId("run", metaKey);
    const projectId = job.project_prefix || job.project_id;
    const characterId = job.character_id || makeStableDbId("character", metaKey);
    const timestamp = nowIso();
    const statements = [
        env.DB.prepare(`
            INSERT INTO v2_projects (id, name, prefix, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET prefix = excluded.prefix, updated_at = excluded.updated_at
        `).bind(projectId, job.project_prefix || projectId, job.project_prefix || projectId, timestamp, timestamp),
        env.DB.prepare(`
            INSERT INTO v2_characters (id, project_id, name, prefix, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, prefix = excluded.prefix, updated_at = excluded.updated_at
        `).bind(characterId, projectId, job.character_prefix || characterId, job.character_prefix || characterId, timestamp, timestamp),
        env.DB.prepare(`
            INSERT INTO v2_generation_jobs (
                id, planner_run_id, project_id, character_id, status, mode, total_count,
                completed_count, failed_count, legacy_background_job_id, started_at, completed_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'background', ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                planner_run_id = excluded.planner_run_id,
                project_id = excluded.project_id,
                character_id = excluded.character_id,
                status = excluded.status,
                total_count = excluded.total_count,
                completed_count = excluded.completed_count,
                failed_count = excluded.failed_count,
                started_at = excluded.started_at,
                completed_at = excluded.completed_at,
                updated_at = excluded.updated_at
        `).bind(
            makeStableDbId("genjob", job.id),
            plannerRunId,
            projectId,
            characterId,
            normalizeV2GenerationStatus(job.status),
            job.total_count || 0,
            job.completed_count || 0,
            job.failed_count || 0,
            job.id,
            job.started_at || null,
            job.completed_at || null,
            job.created_at || timestamp,
            job.updated_at || timestamp
        )
    ];
    const itemIdByLegacy = new Map();
    for (const item of items) {
        const v2ItemId = makeStableDbId("genitem", item.id);
        itemIdByLegacy.set(item.id, v2ItemId);
        const plannerItemId = makeStableDbId("pitem", `${metaKey}:${item.situation_id}`);
        statements.push(env.DB.prepare(`
            INSERT INTO v2_generation_job_items (
                id, generation_job_id, planner_item_id, status, target_count, completed_count,
                failed_count, error_message, legacy_background_item_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                generation_job_id = excluded.generation_job_id,
                planner_item_id = excluded.planner_item_id,
                status = excluded.status,
                target_count = excluded.target_count,
                completed_count = excluded.completed_count,
                failed_count = excluded.failed_count,
                error_message = excluded.error_message,
                updated_at = excluded.updated_at
        `).bind(
            v2ItemId,
            makeStableDbId("genjob", job.id),
            plannerItemId,
            normalizeV2GenerationStatus(item.status),
            item.count || 1,
            item.completed_count || 0,
            item.failed_count || 0,
            item.error_message || "",
            item.id,
            item.created_at || timestamp,
            item.updated_at || timestamp
        ));
    }
    for (const queue of queueRows) {
        const generationJobItemId = itemIdByLegacy.get(queue.item_id);
        if (!generationJobItemId) continue;
        statements.push(env.DB.prepare(`
            INSERT INTO v2_generation_queue (
                id, generation_job_item_id, image_index, status, attempts, scheduled_at,
                legacy_background_queue_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                generation_job_item_id = excluded.generation_job_item_id,
                image_index = excluded.image_index,
                status = excluded.status,
                attempts = excluded.attempts,
                scheduled_at = excluded.scheduled_at,
                updated_at = excluded.updated_at
        `).bind(
            makeStableDbId("genqueue", queue.id),
            generationJobItemId,
            queue.image_index || 0,
            normalizeV2GenerationStatus(queue.status),
            queue.attempts || 0,
            queue.started_at || null,
            queue.id,
            queue.created_at || timestamp,
            queue.updated_at || timestamp
        ));
    }
    for (let i = 0; i < statements.length; i += 50) {
        await env.DB.batch(statements.slice(i, i + 50));
    }
}

async function putPlannerMetaDocument(env, objectKey, meta = {}) {
    if (!env?.DB) return;
    await ensurePlannerMetaSchema(env);
    await putV2PlannerMetaDocument(env, objectKey, meta);
    await env.DB.batch([
        env.DB.prepare('DELETE FROM planner_item_image_snapshots WHERE item_id IN (SELECT id FROM planner_items WHERE meta_object_key = ?)').bind(objectKey),
        env.DB.prepare('DELETE FROM planner_item_images WHERE item_id IN (SELECT id FROM planner_items WHERE meta_object_key = ?)').bind(objectKey),
        env.DB.prepare('DELETE FROM planner_item_v4_rows WHERE item_id IN (SELECT id FROM planner_items WHERE meta_object_key = ?)').bind(objectKey),
        env.DB.prepare('DELETE FROM planner_items WHERE meta_object_key = ?').bind(objectKey),
        env.DB.prepare('DELETE FROM planner_metas WHERE object_key = ?').bind(objectKey),
        env.DB.prepare('DELETE FROM json_documents WHERE doc_type = ? AND object_key = ?').bind('planner_meta', objectKey)
    ]);
    return;
    const timestamp = nowIso();
    const { header, items } = splitPlannerMetaForDb(meta);
    await env.DB.batch([
        env.DB.prepare('DELETE FROM planner_item_image_snapshots WHERE item_id IN (SELECT id FROM planner_items WHERE meta_object_key = ?)').bind(objectKey),
        env.DB.prepare('DELETE FROM planner_item_images WHERE item_id IN (SELECT id FROM planner_items WHERE meta_object_key = ?)').bind(objectKey),
        env.DB.prepare('DELETE FROM planner_item_v4_rows WHERE item_id IN (SELECT id FROM planner_items WHERE meta_object_key = ?)').bind(objectKey),
        env.DB.prepare('DELETE FROM planner_items WHERE meta_object_key = ?').bind(objectKey),
        env.DB.prepare(`
            INSERT INTO planner_metas (
                object_key, project_id, project_prefix, character_id, character_prefix, status, stage, stage_label,
                default_count, background_job_id, background_status_json, running_situation_ids_json,
                extra_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(object_key) DO UPDATE SET
                project_id = excluded.project_id,
                project_prefix = excluded.project_prefix,
                character_id = excluded.character_id,
                character_prefix = excluded.character_prefix,
                status = excluded.status,
                stage = excluded.stage,
                stage_label = excluded.stage_label,
                default_count = excluded.default_count,
                background_job_id = excluded.background_job_id,
                background_status_json = excluded.background_status_json,
                running_situation_ids_json = excluded.running_situation_ids_json,
                extra_json = excluded.extra_json,
                updated_at = excluded.updated_at
        `).bind(
            objectKey,
            header.projectId,
            header.projectPrefix,
            header.characterId,
            header.characterPrefix,
            header.status,
            header.stage,
            header.stageLabel,
            header.defaultCount,
            header.backgroundJobId,
            JSON.stringify(header.backgroundStatus || {}),
            JSON.stringify(header.runningSituationIds || []),
            JSON.stringify(header.extra || {}),
            header.createdAt || timestamp,
            timestamp
        )
    ]);
    const statements = [];
    items.forEach((rawItem, index) => {
        const itemId = getPlannerItemDbId(objectKey, rawItem, index);
        const split = splitPlannerItemForDb(rawItem);
        statements.push(env.DB.prepare(`
            INSERT INTO planner_items (
                id, meta_object_key, situation_id, situation_name, situation_index, image_number, count,
                status, stage, stage_label, selected_image, final_image, error_message,
                background_job_id, background_item_id, generation_json, extra_json, sort_order, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            itemId,
            objectKey,
            split.item.situationId,
            split.item.situationName,
            split.item.situationIndex,
            split.item.imageNumber,
            split.item.count,
            split.item.status,
            split.item.stage,
            split.item.stageLabel,
            split.item.selectedImage,
            split.item.finalImage,
            split.item.errorMessage,
            split.item.backgroundJobId,
            split.item.backgroundItemId,
            JSON.stringify(split.item.generation || {}),
            JSON.stringify(split.item.extra || {}),
            index,
            timestamp,
            timestamp
        ));
        split.v4Rows.forEach((row, rowIndex) => {
            statements.push(env.DB.prepare(`
                INSERT INTO planner_item_v4_rows (item_id, row_index, subject, clothing, expression, action, negative)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(itemId, rowIndex, row?.subject || '', row?.clothing || '', row?.expression || '', row?.action || '', row?.negative || ''));
        });
        split.images.forEach((imageKey, imageIndex) => {
            statements.push(env.DB.prepare(`
                INSERT INTO planner_item_images (item_id, image_key, sort_order, created_at)
                VALUES (?, ?, ?, ?)
            `).bind(itemId, imageKey, imageIndex, timestamp));
            if (split.snapshots[imageKey]) {
                statements.push(env.DB.prepare(`
                    INSERT INTO planner_item_image_snapshots (item_id, image_key, snapshot_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                `).bind(itemId, imageKey, JSON.stringify(split.snapshots[imageKey] || {}), timestamp, timestamp));
            }
        });
    });
    for (let i = 0; i < statements.length; i += 50) {
        await env.DB.batch(statements.slice(i, i + 50));
    }
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS json_documents (
            doc_type TEXT NOT NULL,
            object_key TEXT NOT NULL,
            data_json TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'db',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (doc_type, object_key)
        )
    `).run();
    await env.DB.prepare(
        'DELETE FROM json_documents WHERE doc_type = ? AND object_key = ?'
    ).bind('planner_meta', objectKey).run();
}

async function saveMetadata(env, outputPrefix, fileName, metadata) {
    if (!env?.DB) return;
    const timestamp = nowIso();
    await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS file_metadata (
            folder_prefix TEXT NOT NULL,
            file_name TEXT NOT NULL,
            metadata_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (folder_prefix, file_name)
        )
    `).run();
    await env.DB.prepare(`
        INSERT INTO file_metadata (folder_prefix, file_name, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(folder_prefix, file_name) DO UPDATE SET
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
    `).bind(outputPrefix, fileName, JSON.stringify(metadata || {}), timestamp, timestamp).run();

    const r2Key = `${outputPrefix}${fileName}`;
    const projectPrefix = String(outputPrefix || "").split("_planner_temp_image/")[0] || makeStableDbId("project", outputPrefix);
    await env.DB.prepare(`
        INSERT INTO v2_projects (id, name, prefix, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            prefix = excluded.prefix,
            updated_at = excluded.updated_at
    `).bind(projectPrefix, projectPrefix, projectPrefix, timestamp, timestamp).run();
    await env.DB.prepare(`
        INSERT INTO v2_assets (
            id, project_id, owner_type, owner_id, r2_key, file_name, mime_type,
            kind, status, is_public, sort_order, created_at, updated_at
        ) VALUES (?, ?, 'generation_job', '', ?, ?, 'image/webp', 'image', 'active', 0, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            project_id = excluded.project_id,
            r2_key = excluded.r2_key,
            file_name = excluded.file_name,
            status = 'active',
            deleted_at = NULL,
            updated_at = excluded.updated_at
    `).bind(getAssetIdFromKey(r2Key), projectPrefix, r2Key, fileName, timestamp, timestamp).run();
    await env.DB.prepare(`
        INSERT INTO v2_asset_metadata (
            asset_id, prompt, negative_prompt, model, sampler, steps, scale, seed,
            width, height, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id) DO UPDATE SET
            prompt = excluded.prompt,
            negative_prompt = excluded.negative_prompt,
            model = excluded.model,
            sampler = excluded.sampler,
            steps = excluded.steps,
            scale = excluded.scale,
            seed = excluded.seed,
            width = excluded.width,
            height = excluded.height,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
    `).bind(
        getAssetIdFromKey(r2Key),
        metadata?.Prompt || "",
        metadata?.["Negative Prompt"] || "",
        metadata?.Model || null,
        metadata?.Sampler || null,
        metadata?.Steps || null,
        metadata?.["CFG Scale"] == null ? null : String(metadata["CFG Scale"]),
        metadata?.Seed == null ? null : String(metadata.Seed),
        null,
        null,
        JSON.stringify(metadata || {}),
        timestamp,
        timestamp
    ).run();
}

async function cleanupDeletedAssets(env, olderThanHours = 24, limit = 100) {
    if (!env?.DB || !env?.imgBucket) return { scanned: 0, deletedCount: 0, failedCount: 0 };
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();
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

async function resetPlannerMetaAfterBackgroundCancel(env, jobId) {
    const job = await queryFirst(env.DB, "SELECT * FROM planner_background_jobs WHERE id = ?", jobId);
    if (!job) return;
    const items = await queryAll(env.DB, "SELECT * FROM planner_background_items WHERE job_id = ?", jobId);
    const metaKey = getPlannerMetaKey(job.project_prefix, job.character_id);
    const storedMeta = parseJsonField(job.planner_meta_json, null);
    if (!storedMeta || typeof storedMeta !== "object") return;

    const bySituation = new Map(items.map(item => [item.situation_id, item]));
    const meta = storedMeta;
    meta.projectId = meta.projectId || job.project_id || "";
    meta.projectPrefix = meta.projectPrefix || job.project_prefix || "";
    meta.characterId = meta.characterId || job.character_id || "";
    meta.characterPrefix = meta.characterPrefix || job.character_prefix || "";
    meta.status = "draft";
    meta.stage = "";
    meta.stageLabel = "";
    delete meta.backgroundJobId;
    delete meta.backgroundStatus;
    delete meta.runningSituationIds;
    meta.updatedAt = Date.now();
    meta.items = (meta.items || []).map(item => {
        const row = bySituation.get(item.situationId);
        if (!row) return item;
        const resultKeys = compactResultKeys(row.result_keys);
        const hasNewResults = resultKeys.length > 0;
        const complete = Number(row.completed_count || 0) >= Number(row.count || 0);
        return {
            ...item,
            status: complete ? "done" : "pending",
            stage: "",
            stageLabel: "",
            failedCount: row.failed_count || 0,
            images: hasNewResults ? resultKeys : (item.images || []),
            selectedImage: hasNewResults
                ? (resultKeys.includes(item.selectedImage) ? item.selectedImage : null)
                : (item.selectedImage || null),
            backgroundJobId: undefined,
            backgroundItemId: undefined,
            errorMessage: row.error_message || ""
        };
    });

    await env.DB.prepare("UPDATE planner_background_jobs SET planner_meta_json = ?, updated_at = ? WHERE id = ?")
        .bind(JSON.stringify(meta), nowIso(), jobId).run();
    await putJsonDocument(env, "planner_meta", metaKey, meta).catch(() => null);
}

async function updateProgressStage(env, jobId, itemId, stage) {
    const updatedAt = nowIso();
    await env.DB.batch([
        env.DB.prepare("UPDATE planner_background_jobs SET stage = ?, updated_at = ? WHERE id = ? AND status NOT IN ('completed', 'partial_failed', 'failed', 'cancel_requested', 'paused')")
            .bind(stage, updatedAt, jobId),
        env.DB.prepare("UPDATE planner_background_items SET stage = ?, updated_at = ? WHERE id = ? AND status NOT IN ('completed', 'partial_failed', 'failed', 'cancel_requested', 'paused')")
            .bind(stage, updatedAt, itemId)
    ]);
    await syncPlannerMetaToR2(env, jobId).catch(() => null);
}

async function refreshJobRollup(env, jobId) {
    const rows = await queryAll(env.DB, "SELECT status, completed_count, failed_count, count FROM planner_background_items WHERE job_id = ?", jobId);
    const completedCount = rows.reduce((sum, row) => sum + Number(row.completed_count || 0), 0);
    const failedCount = rows.reduce((sum, row) => sum + Number(row.failed_count || 0), 0);
    const totalCount = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
    const done = rows.every(row => ["completed", "partial_failed", "failed"].includes(row.status));
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
    if (!job) return;
    await syncV2GenerationFromBackgroundJob(env, jobId).catch(() => null);
    const items = await queryAll(env.DB, "SELECT * FROM planner_background_items WHERE job_id = ?", jobId);
    const metaKey = getPlannerMetaKey(job.project_prefix, job.character_id);
    const storedMeta = parseJsonField(job.planner_meta_json, null);
    if (!storedMeta || typeof storedMeta !== "object") return;
    const meta = storedMeta;
    meta.projectId = meta.projectId || job.project_id || "";
    meta.projectPrefix = meta.projectPrefix || job.project_prefix || "";
    meta.characterId = meta.characterId || job.character_id || "";
    meta.characterPrefix = meta.characterPrefix || job.character_prefix || "";
    const bySituation = new Map(items.map(item => [item.situation_id, item]));
    const currentIds = new Set(Array.isArray(meta.items) ? meta.items.map(item => item.situationId) : []);
    const snapshotTargetIds = new Set(items.map(item => item.situation_id));
    const hasCurrentTarget = [...snapshotTargetIds].some(id => currentIds.has(id));
    if (!hasCurrentTarget) return;

    const cancelRequestedJob = job.status === "cancel_requested";
    meta.status = cancelRequestedJob ? "draft" : job.status;
    meta.stage = cancelRequestedJob ? "" : (job.stage || "");
    meta.stageLabel = cancelRequestedJob ? "" : (STAGE_LABELS[job.stage] || job.stage || "");
    if (cancelRequestedJob) {
        delete meta.backgroundJobId;
        delete meta.backgroundStatus;
    } else {
        meta.backgroundJobId = job.id;
    }
    meta.updatedAt = Date.now();
    if (["completed", "failed", "partial_failed", "cancel_requested", PAUSED_JOB_STATUS].includes(job.status)) {
        delete meta.runningSituationIds;
    } else {
        meta.runningSituationIds = Array.isArray(meta.runningSituationIds)
            ? meta.runningSituationIds.filter(id => currentIds.has(id))
            : [...snapshotTargetIds].filter(id => currentIds.has(id));
    }
    meta.items = (meta.items || []).map(item => {
        const row = bySituation.get(item.situationId);
        if (!row) return item;
        const resultKeys = compactResultKeys(row.result_keys);
        const hasNewResults = resultKeys.length > 0;
        const nextStatus = (cancelRequestedJob || row.status === "cancel_requested")
            ? "pending"
            : (row.status === "completed" ? "done" : row.status);
        return {
            ...item,
            status: nextStatus,
            stage: cancelRequestedJob ? "" : (row.stage || ""),
            stageLabel: cancelRequestedJob ? "" : (STAGE_LABELS[row.stage] || row.stage || ""),
            failedCount: row.failed_count || 0,
            images: hasNewResults ? resultKeys : (item.images || []),
            selectedImage: hasNewResults
                ? (resultKeys.includes(item.selectedImage) ? item.selectedImage : null)
                : (item.selectedImage || null),
            backgroundJobId: cancelRequestedJob ? undefined : job.id,
            backgroundItemId: cancelRequestedJob ? undefined : row.id,
            errorMessage: row.error_message || ""
        };
    });

    await env.DB.prepare("UPDATE planner_background_jobs SET planner_meta_json = ?, updated_at = ? WHERE id = ?")
        .bind(JSON.stringify(meta), nowIso(), jobId).run();
    await putJsonDocument(env, "planner_meta", metaKey, meta).catch(() => null);
}

async function syncPlannerMetaToR2Safely(env, jobId, context = {}) {
    try {
        await syncPlannerMetaToR2(env, jobId);
    } catch (error) {
        await writeBackgroundErrorLog(env, error, {
            jobId,
            stage: "planner_meta_sync",
            ...context
        });
    }
}

async function markItemFailure(env, item, errorMessage) {
    const failedCount = Number(item.failed_count || 0) + 1;
    const completedCount = Number(item.completed_count || 0);
    const count = Number(item.count || 0);
    const status = completedCount + failedCount >= count
        ? (completedCount > 0 ? "partial_failed" : "failed")
        : "queued";
    await env.DB.prepare(`
        UPDATE planner_background_items
        SET failed_count = ?,
            status = ?,
            stage = 'failed',
            generation_json = CASE WHEN ? IN ('partial_failed', 'failed') THEN '{}' ELSE generation_json END,
            error_message = ?,
            updated_at = ?
        WHERE id = ?
    `).bind(failedCount, status, status, errorMessage.slice(0, 1000), nowIso(), item.id).run();
}

async function enqueueRetry(env, message, attempt, delaySeconds) {
    if (!env.GENERATION_QUEUE || attempt >= MAX_ATTEMPTS) return false;
    await env.GENERATION_QUEUE.send({
        ...message,
        attempt: attempt + 1
    }, { delaySeconds });
    return true;
}

async function isBackgroundJobCancelRequested(env, jobId, itemId) {
    const row = await queryFirst(env.DB, `
        SELECT j.status AS job_status, i.status AS item_status
        FROM planner_background_jobs j
        LEFT JOIN planner_background_items i ON i.id = ?
        WHERE j.id = ?
    `, itemId, jobId);
    return !row || row.job_status === "cancel_requested" || row.item_status === "cancel_requested";
}

async function isBackgroundJobPaused(env, jobId, itemId) {
    const row = await queryFirst(env.DB, `
        SELECT j.status AS job_status, i.status AS item_status
        FROM planner_background_jobs j
        LEFT JOIN planner_background_items i ON i.id = ?
        WHERE j.id = ?
    `, itemId, jobId);
    return row?.job_status === PAUSED_JOB_STATUS || row?.item_status === PAUSED_JOB_STATUS;
}

async function abortIfBackgroundJobCancelRequested(env, jobId, itemId) {
    if (!await isBackgroundJobCancelRequested(env, jobId, itemId)) return;
    const error = new Error("Background job cancel requested");
    error.code = "BACKGROUND_JOB_CANCEL_REQUESTED";
    throw error;
}

export async function processPlannerQueueMessage(env, message) {
    requireWorkerBindings(env);
    await ensurePlannerBackgroundSchema(env);
    const jobId = message?.jobId;
    const queueId = message?.queueId || "";
    const queueEntry = queueId
        ? await queryFirst(env.DB, "SELECT * FROM planner_background_queue WHERE id = ?", queueId)
        : await queryFirst(
            env.DB,
            "SELECT * FROM planner_background_queue WHERE job_id = ? AND item_id = ? AND image_index = ?",
            jobId,
            message?.itemId || "",
            Number(message?.imageIndex || 0)
        );
    const itemId = queueEntry?.item_id || message?.itemId;
    const imageIndex = Number(queueEntry?.image_index ?? message?.imageIndex ?? 0);
    const attempt = Number(message?.attempt || queueEntry?.attempts || 1);
    if (!jobId || !itemId) throw new Error("Invalid queue message");

    const job = await queryFirst(env.DB, "SELECT * FROM planner_background_jobs WHERE id = ?", jobId);
    const item = await queryFirst(env.DB, "SELECT * FROM planner_background_items WHERE id = ?", itemId);
    if (!job || !item) return;
    if (queueEntry && queueEntry.status !== "running") {
        await syncPlannerMetaToR2Safely(env, jobId, { itemId, imageIndex, queueId: queueEntry.id, stage: "stale_queue_message_skip" });
        await enqueueNextPlannerQueueMessage(env, jobId).catch(() => null);
        return;
    }
    const storedResultKeys = parseResultKeys(item.result_keys);
    if (storedResultKeys[imageIndex]) {
        if (queueEntry) {
            await env.DB.prepare("DELETE FROM planner_background_queue WHERE id = ?").bind(queueEntry.id).run();
        }
        await syncPlannerMetaToR2Safely(env, jobId, { itemId, imageIndex, stage: "duplicate_message_skip" });
        await enqueueNextPlannerQueueMessage(env, jobId).catch(() => null);
        return;
    }

    if (job.status === "cancel_requested" || item.status === "cancel_requested") {
        await resetPlannerMetaAfterBackgroundCancel(env, jobId).catch(() => null);
        await env.DB.batch([
            env.DB.prepare("DELETE FROM planner_background_queue WHERE job_id = ?").bind(jobId),
            env.DB.prepare("DELETE FROM planner_background_items WHERE job_id = ?").bind(jobId),
            env.DB.prepare("DELETE FROM planner_background_jobs WHERE id = ?").bind(jobId)
        ]);
        await cleanupFinishedBackgroundJobs(env).catch(() => null);
        return;
    }

    if (job.status === PAUSED_JOB_STATUS || item.status === PAUSED_JOB_STATUS) {
        if (queueEntry) {
            await env.DB.prepare(`
                UPDATE planner_background_queue
                SET status = 'paused',
                    updated_at = ?
                WHERE id = ?
            `).bind(nowIso(), queueEntry.id).run();
        }
        await syncPlannerMetaToR2Safely(env, jobId, { itemId, stage: "paused_message_skip" });
        return;
    }

    await env.DB.batch([
        env.DB.prepare("UPDATE planner_background_jobs SET status = 'running', stage = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?")
            .bind(nowIso(), nowIso(), jobId),
        env.DB.prepare("UPDATE planner_background_items SET status = 'running', stage = 'running', started_at = COALESCE(started_at, ?), attempts = ?, updated_at = ? WHERE id = ?")
            .bind(nowIso(), attempt, nowIso(), itemId)
    ]);
    await syncPlannerMetaToR2Safely(env, jobId, { itemId, stage: "running_sync" });

    try {
        const generation = JSON.parse(item.generation_json || "{}");
        const baseSeed = Number.parseInt(generation.seed, 10);
        const seed = Number.isFinite(baseSeed) ? (baseSeed + imageIndex) % 4294967296 : Math.floor(Math.random() * 4294967296);
        const generatedAt = nowIso();
        const request = buildNovelAiPayload(generation, seed);
        await updateProgressStage(env, jobId, itemId, "novelai_request");
        await waitForNovelAiSlot(env);
        await abortIfBackgroundJobCancelRequested(env, jobId, itemId);
        if (await isBackgroundJobPaused(env, jobId, itemId)) {
            if (queueEntry) {
                await env.DB.prepare(`
                    UPDATE planner_background_queue
                    SET status = 'paused',
                        updated_at = ?
                    WHERE id = ?
                `).bind(nowIso(), queueEntry.id).run();
            }
            await syncPlannerMetaToR2Safely(env, jobId, { itemId, imageIndex, stage: "paused_before_request" });
            return;
        }
        const zipBuffer = await callNovelAi(env, request.payload);
        await abortIfBackgroundJobCancelRequested(env, jobId, itemId);
        await updateProgressStage(env, jobId, itemId, "novelai_response");
        await updateProgressStage(env, jobId, itemId, "zip_extract");
        const extracted = await extractFirstZipFile(zipBuffer);
        await abortIfBackgroundJobCancelRequested(env, jobId, itemId);
        await updateProgressStage(env, jobId, itemId, "webp_encode");
        const webpBuffer = await encodeWebP(env, extracted.data);
        await abortIfBackgroundJobCancelRequested(env, jobId, itemId);
        const fileName = makeResultFileName(imageIndex);
        const key = `${item.output_prefix}${fileName}`;

        await updateProgressStage(env, jobId, itemId, "r2_put");
        await abortIfBackgroundJobCancelRequested(env, jobId, itemId);
        await putR2WithRetry(env.imgBucket, key, webpBuffer, {
            httpMetadata: { contentType: "image/webp" },
            customMetadata: { ispublic: "false", backgroundjobid: jobId }
        });
        if (await isBackgroundJobCancelRequested(env, jobId, itemId)) {
            await env.imgBucket.delete(key).catch(() => null);
            await abortIfBackgroundJobCancelRequested(env, jobId, itemId);
        }

        const resultKeys = parseResultKeys(item.result_keys);
        resultKeys[imageIndex] = key;
        await updateProgressStage(env, jobId, itemId, "metadata_put");
        await abortIfBackgroundJobCancelRequested(env, jobId, itemId);
        const metadata = {
            "Negative Prompt": request.negative,
            Resolution: `${request.width} x ${request.height}`,
            Seed: seed,
            Steps: request.steps,
            Sampler: request.sampler,
            "CFG Scale": request.scale,
            Model: request.model,
            "Background Job": jobId,
            "Generated At": generatedAt
        };
        if (Object.keys(request.splitPrompts || {}).length) {
            metadata["Split Prompts"] = request.splitPrompts;
        } else {
            metadata.Prompt = request.prompt;
        }
        await saveMetadata(env, item.output_prefix, fileName, metadata).catch(error => writeBackgroundErrorLog(env, error, {
            jobId,
            itemId,
            imageIndex,
            attempt,
            stage: "metadata_put",
            outputPrefix: item.output_prefix,
            savedImageKey: key
        }));

        const completedCount = Number(item.completed_count || 0) + 1;
        const failedCount = Number(item.failed_count || 0);
        const count = Number(item.count || 0);
        const pausedAfterRequest = await isBackgroundJobPaused(env, jobId, itemId);
        const status = completedCount + failedCount >= count ? "completed" : (pausedAfterRequest ? PAUSED_JOB_STATUS : "queued");
        await env.DB.prepare(`
            UPDATE planner_background_items
            SET completed_count = ?,
                status = ?,
                stage = ?,
                result_keys = ?,
                generation_json = CASE WHEN ? IN ('completed', 'partial_failed', 'failed') THEN '{}' ELSE generation_json END,
                error_message = NULL,
                updated_at = ?,
                completed_at = CASE WHEN ? IN ('completed', 'partial_failed') THEN ? ELSE completed_at END
            WHERE id = ?
        `).bind(completedCount, status, status === "completed" ? "completed" : status, JSON.stringify(resultKeys), status, nowIso(), status, nowIso(), itemId).run();
        if (pausedAfterRequest) {
            if (queueEntry) {
                await env.DB.prepare(`
                    UPDATE planner_background_queue
                    SET status = 'paused',
                        updated_at = ?
                    WHERE id = ?
                `).bind(nowIso(), queueEntry.id).run();
            }
            await syncPlannerMetaToR2Safely(env, jobId, { itemId, imageIndex, attempt, stage: "paused_after_request" });
            return;
        }
        if (queueEntry) {
            await env.DB.prepare("DELETE FROM planner_background_queue WHERE id = ?").bind(queueEntry.id).run();
        }
    } catch (error) {
        const errorMessage = error.message || String(error);
        if (error?.code === "BACKGROUND_JOB_CANCEL_REQUESTED") {
            if (queueEntry) {
                await env.DB.prepare("DELETE FROM planner_background_queue WHERE id = ?").bind(queueEntry.id).run();
            }
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
        if (!isR2PutRetryExhausted(error) && attempt < MAX_ATTEMPTS && await enqueueRetry(env, message, attempt, retryDelaySeconds)) {
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
            if (queueEntry) {
                await env.DB.prepare(`
                    UPDATE planner_background_queue
                    SET attempts = ?,
                        error_message = ?,
                        updated_at = ?
                    WHERE id = ?
                `).bind(attempt, errorMessage.slice(0, 1000), nowIso(), queueEntry.id).run();
            }
            await syncPlannerMetaToR2Safely(env, jobId, { itemId, imageIndex, attempt, stage: "retry_sync" });
            return;
        }
        await markItemFailure(env, item, errorMessage);
        if (queueEntry) {
            await env.DB.prepare("DELETE FROM planner_background_queue WHERE id = ?").bind(queueEntry.id).run();
        }
        await refreshJobRollup(env, jobId);
        await syncPlannerMetaToR2Safely(env, jobId, { itemId, imageIndex, attempt, stage: "failure_sync" });
        await enqueueNextPlannerQueueMessage(env, jobId).catch(() => null);
        await cleanupFinishedBackgroundJobs(env).catch(() => null);
        return;
    }

    await refreshJobRollup(env, jobId);
    await syncPlannerMetaToR2Safely(env, jobId, { itemId, imageIndex, attempt, stage: "success_sync" });
    await enqueueNextPlannerQueueMessage(env, jobId).catch(() => null);
    await cleanupFinishedBackgroundJobs(env).catch(() => null);
}

export default {
    async scheduled(_event, env) {
        await cleanupDeletedAssets(env).catch(error => writeBackgroundErrorLog(env, error, {
            stage: "scheduled_asset_cleanup"
        }));
        await cleanupFinishedBackgroundJobs(env).catch(error => writeBackgroundErrorLog(env, error, {
            stage: "scheduled_background_job_cleanup"
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
