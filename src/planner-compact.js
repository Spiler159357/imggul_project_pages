const RECORD_TYPES = new Set(["settings", "run", "confirm", "rate"]);
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "paused", "cancel_requested"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "partial_failed", "failed", "cancelled"]);
const PAYLOAD_WARNING_BYTES = 1_250_000;
const PAYLOAD_LIMIT_BYTES = 1_500_000;
const MAX_OPTIMISTIC_RETRIES = 3;
const CONFIRM_RETENTION_MS = 24 * 60 * 60 * 1000;

function plannerError(code, status, message) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function nowIso() {
    return new Date().toISOString();
}

function futureIso(milliseconds) {
    return new Date(Date.now() + milliseconds).toISOString();
}

function cloneJson(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function asString(value, fallback = "") {
    const result = value === undefined || value === null ? "" : String(value).trim();
    return result || fallback;
}

function asNonNegativeInteger(value, fallback = 0) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function clampTargetCount(value, fallback = 1) {
    return Math.max(1, Math.min(100, asNonNegativeInteger(value, fallback) || fallback));
}

function translateSchemaError(error) {
    const message = error?.message || String(error || "");
    if (/no such table:\s*planner_compact_records/i.test(message)) {
        return plannerError(
            "PLANNER_COMPACT_SCHEMA_MISSING",
            503,
            "Planner compact schema is not installed. Run migration 0018."
        );
    }
    return error;
}

export function stablePlannerRefHash(value) {
    const bytes = new TextEncoder().encode(String(value ?? "").normalize("NFKC"));
    let hash = 0x811c9dc5;
    for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0").slice(0, 6);
}

export function safePlannerRef(value, fallback = "default") {
    const raw = asString(value);
    const fallbackRaw = asString(fallback, "default");
    if (/^[A-Za-z0-9_-]+$/.test(raw)) return raw.toLowerCase();

    const source = raw || fallbackRaw;
    const normalized = source
        .normalize("NFKC")
        .replace(/[\s/\\:]+/g, "_")
        .replace(/[^\p{L}\p{N}_-]+/gu, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();
    const slug = normalized || safePlannerRef(fallbackRaw === source ? "default" : fallbackRaw, "default");
    return `${slug}_${stablePlannerRefHash(source)}`;
}

function resolvePlannerRefs(input = {}) {
    const projectRef = safePlannerRef(input.projectId || input.projectPrefix, "project");
    const characterRef = safePlannerRef(input.characterId || input.characterPrefix, "character");
    const situationRef = safePlannerRef(
        input.situationId || input.imageNumber || input.situationName,
        "situation"
    );
    const characterVariantRef = safePlannerRef(input.characterPromptVariantId, "default");
    const situationVariantRef = safePlannerRef(input.situationPromptVariantId, "default");
    return { projectRef, characterRef, situationRef, characterVariantRef, situationVariantRef };
}

export function makePlannerCompactIds(input = {}) {
    const refs = resolvePlannerRefs(input);
    const runId = `prun:${refs.projectRef}:${refs.characterRef}`;
    const itemId = `pitem:${refs.projectRef}:${refs.characterRef}:${refs.situationRef}`;
    const itemRef = safePlannerRef(input.itemId || itemId, "item");
    const variantId = `pvar:${itemRef}:${refs.characterVariantRef}:${refs.situationVariantRef}`;
    const runRef = safePlannerRef(input.runId || runId, "run");
    const targetRef = input.targetSituationId
        ? safePlannerRef(input.targetSituationId, "all")
        : "all";
    const mode = safePlannerRef(input.mode, "background");
    const generationSequence = asNonNegativeInteger(input.generationSequence, 0);
    const generationSuffix = generationSequence > 0 ? `:${generationSequence}` : "";
    return {
        ...refs,
        runId,
        itemId,
        variantId,
        jobId: `pjob:${runRef}:${targetRef}:${mode}${generationSuffix}`,
        operationId: `pcfm:${itemRef}${generationSuffix}`
    };
}

export function makePlannerCompactKey(type, input = {}) {
    const ids = makePlannerCompactIds(input);
    if (type === "settings") return `settings:${ids.projectRef}`;
    if (type === "run") return `run:${ids.projectRef}:${ids.characterRef}`;
    if (type === "confirm") return `confirm:${safePlannerRef(input.itemId || ids.itemId, "item")}`;
    if (type === "rate") return `rate:${safePlannerRef(input.key || "novelai", "novelai")}`;
    throw plannerError("PLANNER_INVALID_INPUT", 400, `Unknown planner compact record type: ${type}`);
}

export function makePlannerCompactAssetId(input = {}) {
    const ids = makePlannerCompactIds(input);
    const itemRef = safePlannerRef(input.itemId || ids.itemId, "item");
    const variantRef = safePlannerRef(input.variantId || ids.variantId, "variant");
    const imageIndex = asNonNegativeInteger(input.variantImageIndex ?? input.imageIndex, 0);
    const generationSequence = asNonNegativeInteger(input.generationSequence, 0);
    const generationSuffix = generationSequence > 0 ? `:${generationSequence}` : "";
    return `passet:${itemRef}:${variantRef}:${imageIndex}${generationSuffix}`;
}

function serializePayload(payload, recordKey = "") {
    const json = JSON.stringify(payload);
    const byteLength = new TextEncoder().encode(json).byteLength;
    if (byteLength >= PAYLOAD_LIMIT_BYTES) {
        throw plannerError(
            "PLANNER_RUN_PAYLOAD_TOO_LARGE",
            413,
            `Planner payload is too large (${byteLength} bytes).`
        );
    }
    if (byteLength >= PAYLOAD_WARNING_BYTES) {
        console.warn("[planner-compact-payload]", { recordKey, byteLength });
    }
    return json;
}

export async function runPlannerCompactWrite(statement, label, env, context = {}) {
    let result;
    try {
        result = await statement.run();
    } catch (error) {
        throw translateSchemaError(error);
    }
    if (env?.PLANNER_D1_METRICS === "1") {
        console.log("[planner-compact-d1]", label, {
            rowsRead: result.meta?.rows_read,
            rowsWritten: result.meta?.rows_written,
            changes: result.meta?.changes,
            ...context
        });
    }
    return result;
}

function parsePlannerCompactRow(row, expectedType = "") {
    if (!row) return null;
    if (!RECORD_TYPES.has(row.record_type) || (expectedType && row.record_type !== expectedType)) {
        throw plannerError(
            "PLANNER_COMPACT_RECORD_CORRUPT",
            500,
            `Planner compact record type mismatch for ${row.record_key}.`
        );
    }
    let payload;
    try {
        payload = JSON.parse(row.payload_json);
    } catch {
        throw plannerError(
            "PLANNER_COMPACT_RECORD_CORRUPT",
            500,
            `Planner compact payload is invalid for ${row.record_key}.`
        );
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw plannerError(
            "PLANNER_COMPACT_RECORD_CORRUPT",
            500,
            `Planner compact payload is not an object for ${row.record_key}.`
        );
    }
    if (row.record_type === "run" && (
        asString(payload.projectId) !== asString(row.project_id)
        || asString(payload.characterId) !== asString(row.character_id)
        || asString(payload.status) !== asString(row.status)
    )) {
        throw plannerError(
            "PLANNER_COMPACT_RECORD_CORRUPT",
            500,
            `Planner compact run columns do not match its payload for ${row.record_key}.`
        );
    }
    return {
        recordKey: row.record_key,
        recordType: row.record_type,
        projectId: row.project_id,
        characterId: row.character_id,
        status: row.status,
        payload,
        revision: Number(row.revision || 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at || null
    };
}

export async function ensurePlannerCompactSchema(env) {
    try {
        await env.DB.prepare("SELECT record_key FROM planner_compact_records LIMIT 1").first();
        return true;
    } catch (error) {
        throw translateSchemaError(error);
    }
}

export async function getPlannerCompactRecord(env, recordKey, expectedType = "") {
    let row;
    try {
        row = await env.DB.prepare(`
            SELECT record_key, record_type, project_id, character_id, status,
                   payload_json, revision, created_at, updated_at, expires_at
            FROM planner_compact_records
            WHERE record_key = ?
        `).bind(recordKey).first();
    } catch (error) {
        throw translateSchemaError(error);
    }
    return parsePlannerCompactRow(row, expectedType);
}

export async function putPlannerCompactRecord(env, record) {
    if (!RECORD_TYPES.has(record.recordType)) {
        throw plannerError("PLANNER_INVALID_INPUT", 400, "Invalid planner compact record type.");
    }
    const timestamp = nowIso();
    const createdAt = record.createdAt || timestamp;
    const updatedAt = record.updatedAt || timestamp;
    const payloadJson = serializePayload(record.payload, record.recordKey);
    await runPlannerCompactWrite(env.DB.prepare(`
        INSERT INTO planner_compact_records (
            record_key, record_type, project_id, character_id, status,
            payload_json, revision, created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(record_key) DO UPDATE SET
            project_id = excluded.project_id,
            character_id = excluded.character_id,
            status = excluded.status,
            payload_json = excluded.payload_json,
            revision = planner_compact_records.revision + 1,
            updated_at = excluded.updated_at,
            expires_at = excluded.expires_at
        WHERE planner_compact_records.record_type = excluded.record_type
    `).bind(
        record.recordKey,
        record.recordType,
        record.projectId || "",
        record.characterId || "",
        record.status || "",
        payloadJson,
        createdAt,
        updatedAt,
        record.expiresAt || null
    ), `put:${record.recordType}`, env, { recordKey: record.recordKey });
    return await getPlannerCompactRecord(env, record.recordKey, record.recordType);
}

export async function updatePlannerCompactRecord(env, current, nextPayload, options = {}) {
    const timestamp = options.updatedAt || nowIso();
    const status = options.status ?? nextPayload.status ?? current.status;
    nextPayload.status = status;
    nextPayload.updatedAt = timestamp;
    const payloadJson = serializePayload(nextPayload, current.recordKey);
    const result = await runPlannerCompactWrite(env.DB.prepare(`
        UPDATE planner_compact_records
        SET status = ?, payload_json = ?, revision = revision + 1,
            updated_at = ?, expires_at = ?
        WHERE record_key = ? AND record_type = ? AND revision = ?
    `).bind(
        status,
        payloadJson,
        timestamp,
        options.expiresAt ?? current.expiresAt,
        current.recordKey,
        current.recordType,
        current.revision
    ), options.label || `update:${current.recordType}`, env, {
        recordKey: current.recordKey,
        revisionBefore: current.revision,
        revisionAfter: current.revision + 1
    });
    return Number(result.meta?.changes || 0) > 0;
}

export async function deletePlannerCompactRecord(env, recordKey, revision) {
    const result = await runPlannerCompactWrite(env.DB.prepare(`
        DELETE FROM planner_compact_records
        WHERE record_key = ? AND revision = ?
    `).bind(recordKey, revision), "delete:record", env, { recordKey, revisionBefore: revision });
    return Number(result.meta?.changes || 0) > 0;
}

function normalizeGeneration(generation = {}) {
    const source = generation && typeof generation === "object" ? generation : {};
    const fields = source.fields && typeof source.fields === "object" ? cloneJson(source.fields) : {};
    const prompts = source.prompts && typeof source.prompts === "object"
        ? cloneJson(source.prompts)
        : {
            "prompt-style": fields.style || "",
            "prompt-composition": fields.composition || "",
            "prompt-character": fields.character || "",
            "prompt-clothing": fields.clothing || "",
            "prompt-expression": fields.expression || "",
            "prompt-action": fields.action || "",
            "prompt-background": fields.background || "",
            "prompt-raw": source.prompt || ""
        };
    return {
        prompt: asString(source.prompt || source.Prompt || fields.Prompt),
        negative: asString(source.negative || source.negativePrompt || fields.Negative),
        fields,
        prompts,
        simpleMode: Boolean(source.simpleMode),
        qualityTags: source.qualityTags,
        defaultNegativePrompt: source.defaultNegativePrompt,
        useQualityTags: source.useQualityTags,
        useDefaultNegativePrompt: source.useDefaultNegativePrompt,
        v4PromptCharacters: cloneJson(asArray(source.v4PromptCharacters || source.v4_rows)),
        model: asString(source.model, "nai-diffusion-4-5-full"),
        res: asString(source.res || source.resolution, "832x1216"),
        steps: asString(source.steps, "28"),
        scale: asString(source.scale, "5.0"),
        sampler: asString(source.sampler, "k_euler_ancestral"),
        seed: asString(source.seed),
        sm: Boolean(source.sm),
        sm_dyn: Boolean(source.sm_dyn),
        vibeStrength: asString(source.vibeStrength),
        vibeInfo: asString(source.vibeInfo),
        preciseStrength: asString(source.preciseStrength),
        preciseFidelity: asString(source.preciseFidelity),
        preciseType: asString(source.preciseType),
        vibeImageKey: asString(source.vibeImageKey),
        preciseImageKey: asString(source.preciseImageKey)
    };
}

function candidateSlotKey(candidate) {
    return `${candidate.variantId}:${asNonNegativeInteger(candidate.variantImageIndex ?? candidate.imageIndex, 0)}`;
}

function normalizeRunItems(meta, ids, existingPayload = null) {
    const existingByItemId = new Map(asArray(existingPayload?.items).map(item => [item.itemId, item]));
    return asArray(meta.items).map((sourceItem, itemIndex) => {
        const itemIds = makePlannerCompactIds({
            ...meta,
            ...sourceItem,
            projectId: meta.projectId,
            characterId: meta.characterId
        });
        const itemId = itemIds.itemId;
        const existingItem = existingByItemId.get(itemId);
        const variantSources = asArray(sourceItem.variantGenerations).length
            ? sourceItem.variantGenerations
            : asArray(sourceItem.variants).length
                ? sourceItem.variants
                : [{
                    characterPromptVariantId: sourceItem.characterPromptVariantId,
                    situationPromptVariantId: asArray(sourceItem.situationPromptVariantIds)[0],
                    count: sourceItem.count || sourceItem.targetCount,
                    generation: sourceItem.generation
                }];
        const variants = variantSources.map((sourceVariant, variantIndex) => {
            const variantIds = makePlannerCompactIds({
                ...meta,
                ...sourceItem,
                ...sourceVariant,
                itemId,
                projectId: meta.projectId,
                characterId: meta.characterId
            });
            return {
                variantId: variantIds.variantId,
                characterPromptVariantId: asString(sourceVariant.characterPromptVariantId || sourceItem.characterPromptVariantId),
                situationPromptVariantId: asString(sourceVariant.situationPromptVariantId),
                sortOrder: asNonNegativeInteger(sourceVariant.sortOrder, variantIndex),
                targetCount: clampTargetCount(sourceVariant.targetCount || sourceVariant.count || sourceItem.count || meta.defaultCount, 1),
                generation: normalizeGeneration(sourceVariant.generation || sourceItem.generation)
            };
        }).sort((a, b) => a.sortOrder - b.sortOrder || a.variantId.localeCompare(b.variantId));

        const allowedSlots = new Set();
        for (const variant of variants) {
            for (let index = 0; index < variant.targetCount; index += 1) {
                allowedSlots.add(`${variant.variantId}:${index}`);
            }
        }
        const candidateSource = Array.isArray(sourceItem.generatedImages)
            ? sourceItem.generatedImages
            : Array.isArray(sourceItem.candidates)
                ? sourceItem.candidates
                : existingItem?.candidates;
        const candidates = asArray(candidateSource)
            .map(candidate => ({
                assetId: asString(candidate.assetId || candidate.id),
                r2Key: asString(candidate.r2Key || candidate.key),
                itemId,
                variantId: asString(candidate.variantId),
                variantImageIndex: asNonNegativeInteger(candidate.variantImageIndex ?? candidate.imageIndex, 0),
                globalImageIndex: asNonNegativeInteger(candidate.globalImageIndex, 0),
                generationSequence: asNonNegativeInteger(candidate.generationSequence, 0),
                width: asNonNegativeInteger(candidate.width, 0),
                height: asNonNegativeInteger(candidate.height, 0),
                byteSize: asNonNegativeInteger(candidate.byteSize, 0),
                mimeType: asString(candidate.mimeType, "image/webp"),
                createdAt: asString(candidate.createdAt, nowIso())
            }))
            .filter(candidate => candidate.assetId && candidate.r2Key && allowedSlots.has(candidateSlotKey(candidate)))
            .filter(candidate => candidate.assetId === makePlannerCompactAssetId(candidate));
        const uniqueCandidates = [...new Map(candidates.map(candidate => [candidate.assetId, candidate])).values()];
        const completedCount = uniqueCandidates.length;
        const failedCount = Math.min(
            asNonNegativeInteger(existingItem?.failedCount || sourceItem.failedCount, 0),
            Math.max(0, variants.reduce((total, variant) => total + variant.targetCount, 0) - completedCount)
        );
        return {
            itemId,
            situationId: asString(sourceItem.situationId),
            situationName: asString(sourceItem.situationName || sourceItem.name),
            situationIndex: asNonNegativeInteger(sourceItem.situationIndex, itemIndex),
            imageNumber: asString(sourceItem.imageNumber, String(itemIndex + 1)),
            rating: asString(sourceItem.rating, "sfw"),
            status: asString(existingItem?.status || sourceItem.status, "pending"),
            targetCount: variants.reduce((total, variant) => total + variant.targetCount, 0),
            completedCount,
            failedCount,
            generation: normalizeGeneration(sourceItem.generation || variants[0]?.generation),
            variants,
            candidates: uniqueCandidates
        };
    }).sort((a, b) => a.situationIndex - b.situationIndex || a.itemId.localeCompare(b.itemId));
}

function normalizeRunPayload(meta = {}, existingPayload = null) {
    const projectId = asString(meta.projectId || existingPayload?.projectId);
    const characterId = asString(meta.characterId || existingPayload?.characterId);
    if (!projectId || !characterId) {
        throw plannerError("PLANNER_INVALID_INPUT", 400, "projectId and characterId are required.");
    }
    const source = {
        ...existingPayload,
        ...cloneJson(meta),
        projectId,
        characterId,
        projectPrefix: asString(meta.projectPrefix || existingPayload?.projectPrefix),
        characterPrefix: asString(meta.characterPrefix || existingPayload?.characterPrefix)
    };
    const ids = makePlannerCompactIds(source);
    const items = normalizeRunItems(source, ids, existingPayload);
    let activeJob = existingPayload?.activeJob ? cloneJson(existingPayload.activeJob) : null;
    if (activeJob && !ACTIVE_JOB_STATUSES.has(activeJob.status) && !TERMINAL_JOB_STATUSES.has(activeJob.status)) {
        activeJob = null;
    }
    return {
        version: 1,
        runId: ids.runId,
        projectId,
        projectPrefix: source.projectPrefix,
        characterId,
        characterPrefix: source.characterPrefix,
        status: activeJob
            ? runStatusFromJob(activeJob.status)
            : runStatusFromJob(asString(source.status, "draft")),
        mode: asString(source.mode, "background"),
        defaultCount: clampTargetCount(source.defaultCount, 1),
        items,
        activeJob,
        updatedAt: nowIso()
    };
}

function generationStructureSignature(payload) {
    return JSON.stringify(asArray(payload?.items).map(item => ({
        itemId: item.itemId,
        targetCount: item.targetCount,
        variants: asArray(item.variants).map(variant => ({
            variantId: variant.variantId,
            targetCount: variant.targetCount,
            generation: variant.generation
        }))
    })));
}

function assertRunEditable(currentPayload, nextPayload) {
    if (!ACTIVE_JOB_STATUSES.has(currentPayload?.activeJob?.status)) return;
    if (generationStructureSignature(currentPayload) !== generationStructureSignature(nextPayload)) {
        throw plannerError("PLANNER_RUN_ACTIVE", 409, "Planner run is active.");
    }
}

function compactStatusFromRun(payload) {
    const job = payload.activeJob;
    return {
        runId: payload.runId,
        jobId: job?.jobId || "",
        projectId: payload.projectId,
        characterId: payload.characterId,
        status: job?.status || payload.status || "draft",
        mode: job?.mode || payload.mode || "background",
        totalCount: asNonNegativeInteger(job?.totalCount, 0),
        completedCount: asNonNegativeInteger(job?.completedCount, 0),
        failedCount: asNonNegativeInteger(job?.failedCount, 0),
        generationSequence: asNonNegativeInteger(job?.generationSequence, 0),
        stage: asString(job?.stage, job?.status || payload.status || "draft"),
        stageLabel: asString(job?.stageLabel, job?.status || payload.status || "Draft"),
        errorMessage: asString(job?.lastError),
        updatedAt: asString(job?.updatedAt || payload.updatedAt)
    };
}

function runStatusFromJob(status) {
    return status === "completed" ? "complete" : status;
}

export function plannerCompactRunToClient(record) {
    if (!record) return null;
    const payload = cloneJson(record.payload);
    if (payload.status === "complete") payload.status = "completed";
    payload.items = asArray(payload.items).map(item => {
        const generatedImages = asArray(item.candidates).map(candidate => ({
            ...candidate,
            id: candidate.assetId,
            key: candidate.r2Key
        }));
        const activeJobTargetsItem = Boolean(
            payload.activeJob
            && (!payload.activeJob.targetSituationId
                || payload.activeJob.targetSituationId === item.situationId
                || payload.activeJob.targetSituationId === item.itemId)
        );
        return {
            ...item,
            status: item.status === "complete" ? "completed" : item.status,
            id: item.itemId,
            count: item.targetCount,
            generationSequence: asNonNegativeInteger(
                generatedImages[0]?.generationSequence,
                activeJobTargetsItem ? payload.activeJob?.generationSequence : 0
            ),
            images: generatedImages.map(candidate => candidate.r2Key),
            generatedImages,
            variantGenerations: asArray(item.variants).map(variant => ({
                ...variant,
                id: variant.variantId,
                count: variant.targetCount
            }))
        };
    });
    return {
        ...payload,
        id: payload.runId,
        runKey: record.recordKey,
        revision: record.revision,
        backgroundJobId: payload.activeJob?.jobId || "",
        backgroundStatus: compactStatusFromRun(payload)
    };
}

export async function getPlannerCompactSettings(env, projectId) {
    if (!asString(projectId)) throw plannerError("PLANNER_INVALID_INPUT", 400, "projectId is required.");
    const record = await getPlannerCompactRecord(env, makePlannerCompactKey("settings", { projectId }), "settings");
    return record ? {
        ...record.payload.defaults,
        projectId: record.payload.projectId,
        projectPrefix: record.payload.projectPrefix,
        version: record.payload.version,
        revision: record.revision
    } : null;
}

export async function putPlannerCompactSettings(env, input = {}) {
    const projectId = asString(input.projectId);
    if (!projectId) throw plannerError("PLANNER_INVALID_INPUT", 400, "projectId is required.");
    const defaults = input.defaults && typeof input.defaults === "object" ? input.defaults : input;
    const allowedDefaults = [
        "model", "steps", "scale", "sampler", "resolution", "sm", "sm_dyn",
        "vibeStrength", "vibeInfo", "preciseStrength", "preciseFidelity", "preciseType",
        "vibeImageKey", "preciseImageKey"
    ];
    const normalizedDefaults = Object.fromEntries(allowedDefaults
        .filter(key => defaults[key] !== undefined)
        .map(key => [key, cloneJson(defaults[key])]));
    const payload = {
        version: 1,
        projectId,
        projectPrefix: asString(input.projectPrefix),
        defaults: normalizedDefaults
    };
    const record = await putPlannerCompactRecord(env, {
        recordKey: makePlannerCompactKey("settings", { projectId }),
        recordType: "settings",
        projectId,
        characterId: "",
        status: "active",
        payload
    });
    return {
        ...record.payload.defaults,
        projectId: record.payload.projectId,
        projectPrefix: record.payload.projectPrefix,
        version: record.payload.version,
        revision: record.revision
    };
}

export async function getPlannerCompactRunRecord(env, lookup = {}) {
    if (lookup.runKey) return await getPlannerCompactRecord(env, lookup.runKey, "run");
    if (lookup.runId) {
        const parts = String(lookup.runId).split(":");
        if (parts.length === 3 && parts[0] === "prun") {
            return await getPlannerCompactRecord(env, `run:${parts[1]}:${parts[2]}`, "run");
        }
    }
    const projectId = asString(lookup.projectId);
    const characterId = asString(lookup.characterId);
    if (!projectId || !characterId) {
        throw plannerError("PLANNER_INVALID_INPUT", 400, "runKey or projectId and characterId are required.");
    }
    return await getPlannerCompactRecord(env, makePlannerCompactKey("run", { projectId, characterId }), "run");
}

export async function getPlannerCompactRun(env, lookup = {}) {
    return plannerCompactRunToClient(await getPlannerCompactRunRecord(env, lookup));
}

export async function putPlannerCompactRunFromMeta(env, meta = {}, options = {}) {
    const lookup = {
        runKey: options.runKey || meta.runKey,
        projectId: meta.projectId,
        characterId: meta.characterId
    };
    for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt += 1) {
        const existing = await getPlannerCompactRunRecord(env, lookup).catch(error => {
            if (error.code === "PLANNER_INVALID_INPUT" && meta.projectId && meta.characterId) return null;
            throw error;
        });
        const payload = normalizeRunPayload(meta, existing?.payload || null);
        if (existing) assertRunEditable(existing.payload, payload);
        const recordKey = makePlannerCompactKey("run", payload);
        if (existing && existing.recordKey !== recordKey) {
            throw plannerError("PLANNER_INVALID_INPUT", 400, "Planner run identity cannot be changed.");
        }
        if (!existing) {
            const record = await putPlannerCompactRecord(env, {
                recordKey,
                recordType: "run",
                projectId: payload.projectId,
                characterId: payload.characterId,
                status: payload.status,
                payload
            });
            return plannerCompactRunToClient(record);
        }
        if (await updatePlannerCompactRecord(env, existing, payload, {
            status: payload.status,
            label: "run:save"
        })) {
            return plannerCompactRunToClient(await getPlannerCompactRecord(env, recordKey, "run"));
        }
    }
    throw plannerError("PLANNER_REVISION_CONFLICT", 409, "Planner revision conflict.");
}

async function mutateRunWithRetry(env, lookup, mutation, label) {
    for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt += 1) {
        const current = await getPlannerCompactRunRecord(env, lookup);
        if (!current) throw plannerError("PLANNER_RUN_NOT_FOUND", 404, "Planner run not found.");
        const result = await mutation(cloneJson(current.payload), current, attempt);
        if (result?.noWrite) return { record: current, result };
        const nextPayload = result?.payload || result;
        if (await updatePlannerCompactRecord(env, current, nextPayload, {
            status: nextPayload.status,
            expiresAt: result?.expiresAt,
            label
        })) {
            return {
                record: await getPlannerCompactRecord(env, current.recordKey, "run"),
                result
            };
        }
    }
    throw plannerError("PLANNER_REVISION_CONFLICT", 409, "Planner revision conflict.");
}

export async function putPlannerCompactItemFromMeta(env, input = {}) {
    const meta = input.meta && typeof input.meta === "object" ? input.meta : {};
    const runKey = asString(input.runKey || input.data?.runKey || meta.runKey);
    const item = cloneJson(input.item || input.data || input);
    const lookup = runKey
        ? { runKey }
        : {
            projectId: input.projectId || item.projectId || meta.projectId,
            characterId: input.characterId || item.characterId || meta.characterId
        };
    const existingRun = await getPlannerCompactRunRecord(env, lookup);
    if (!existingRun) {
        if (!meta.projectId || !meta.characterId) {
            throw plannerError("PLANNER_RUN_NOT_FOUND", 404, "Planner run not found.");
        }
        return await putPlannerCompactRunFromMeta(env, {
            ...meta,
            items: asArray(meta.items).length ? meta.items : [item]
        });
    }
    const updated = await mutateRunWithRetry(env, lookup, payload => {
        if (ACTIVE_JOB_STATUSES.has(payload.activeJob?.status)) {
            throw plannerError("PLANNER_RUN_ACTIVE", 409, "Planner run is active.");
        }
        const itemIds = makePlannerCompactIds({ ...payload, ...item });
        const items = [
            ...asArray(payload.items).filter(current => current.itemId !== itemIds.itemId),
            item
        ];
        return normalizeRunPayload({ ...payload, items }, payload);
    }, "run:item:put");
    return plannerCompactRunToClient(updated.record);
}

export async function updatePlannerCompactItem(env, itemId, patch = {}) {
    const lookup = patch.runKey
        ? { runKey: patch.runKey }
        : { projectId: patch.projectId, characterId: patch.characterId };
    const updated = await mutateRunWithRetry(env, lookup, payload => {
        if (ACTIVE_JOB_STATUSES.has(payload.activeJob?.status)) {
            throw plannerError("PLANNER_RUN_ACTIVE", 409, "Planner run is active.");
        }
        const index = payload.items.findIndex(item => item.itemId === itemId);
        if (index < 0) throw plannerError("PLANNER_ITEM_NOT_FOUND", 404, "Planner item not found.");
        const items = [...payload.items];
        items[index] = { ...items[index], ...cloneJson(patch), itemId };
        return normalizeRunPayload({ ...payload, items }, payload);
    }, "run:item:update");
    return plannerCompactRunToClient(updated.record);
}

export async function deletePlannerCompactItem(env, itemId, lookup = {}) {
    let candidateKeys = [];
    const updated = await mutateRunWithRetry(env, lookup, payload => {
        if (ACTIVE_JOB_STATUSES.has(payload.activeJob?.status)) {
            throw plannerError("PLANNER_RUN_ACTIVE", 409, "Planner run is active.");
        }
        const targetItem = payload.items.find(item => item.itemId === itemId);
        const items = payload.items.filter(item => item.itemId !== itemId);
        if (items.length === payload.items.length) {
            throw plannerError("PLANNER_ITEM_NOT_FOUND", 404, "Planner item not found.");
        }
        candidateKeys = asArray(targetItem?.candidates).map(candidate => asString(candidate.r2Key)).filter(Boolean);
        return { ...payload, items, status: "draft", activeJob: null };
    }, "run:item:delete");
    if (candidateKeys.length) {
        await cleanupPlannerCompactAssets(env, { keys: candidateKeys });
    }
    return plannerCompactRunToClient(updated.record);
}

export async function deletePlannerCompactRun(env, lookup = {}) {
    for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt += 1) {
        const current = await getPlannerCompactRunRecord(env, typeof lookup === "string" ? { runId: lookup } : lookup);
        if (!current) return { deleted: false };
        if (ACTIVE_JOB_STATUSES.has(current.payload.activeJob?.status)) {
            throw plannerError("PLANNER_RUN_ACTIVE", 409, "Planner run is active.");
        }
        const candidateKeys = current.payload.items
            .flatMap(item => asArray(item.candidates))
            .map(candidate => asString(candidate.r2Key))
            .filter(Boolean);
        if (await deletePlannerCompactRecord(env, current.recordKey, current.revision)) {
            const cleanup = candidateKeys.length
                ? await cleanupPlannerCompactAssets(env, { keys: candidateKeys })
                : { scanned: 0, deletedCount: 0, failedCount: 0, failedKeys: [] };
            return { deleted: true, runKey: current.recordKey, cleanup };
        }
    }
    throw plannerError("PLANNER_REVISION_CONFLICT", 409, "Planner revision conflict.");
}

function enumerateRunSlots(payload, targetSituationId = "", generationSequence = 0) {
    const slots = [];
    let globalImageIndex = 0;
    const normalizedGenerationSequence = asNonNegativeInteger(generationSequence, 0);
    for (let itemIndex = 0; itemIndex < payload.items.length; itemIndex += 1) {
        const item = payload.items[itemIndex];
        for (let variantIndex = 0; variantIndex < item.variants.length; variantIndex += 1) {
            const variant = item.variants[variantIndex];
            for (let variantImageIndex = 0; variantImageIndex < variant.targetCount; variantImageIndex += 1) {
                if (!targetSituationId || item.situationId === targetSituationId || item.itemId === targetSituationId) {
                    const assetId = makePlannerCompactAssetId({
                        itemId: item.itemId,
                        variantId: variant.variantId,
                        variantImageIndex,
                        generationSequence: normalizedGenerationSequence
                    });
                    slots.push({
                        itemIndex,
                        variantIndex,
                        variantImageIndex,
                        globalImageIndex,
                        itemId: item.itemId,
                        variantId: variant.variantId,
                        generationSequence: normalizedGenerationSequence,
                        assetId,
                        item,
                        variant
                    });
                }
                globalImageIndex += 1;
            }
        }
    }
    return slots;
}

function getCompletedAssetIds(payload) {
    return new Set(payload.items.flatMap(item => asArray(item.candidates).map(candidate => candidate.assetId)));
}

function nextRunnableSlot(payload, activeJob = payload.activeJob) {
    if (!activeJob) return null;
    if (TERMINAL_JOB_STATUSES.has(activeJob.status)
        || activeJob.status === "paused"
        || activeJob.status === "cancel_requested") return null;
    const completed = getCompletedAssetIds(payload);
    const failed = new Set(asArray(activeJob.failedSlots).map(slot => slot.assetId));
    return enumerateRunSlots(payload, activeJob.targetSituationId, activeJob.generationSequence)
        .find(slot => !completed.has(slot.assetId) && !failed.has(slot.assetId)) || null;
}

function pointerFromSlot(slot, fallbackGlobalIndex = 0) {
    return slot ? {
        itemIndex: slot.itemIndex,
        variantIndex: slot.variantIndex,
        variantImageIndex: slot.variantImageIndex,
        globalImageIndex: slot.globalImageIndex
    } : {
        itemIndex: 0,
        variantIndex: 0,
        variantImageIndex: 0,
        globalImageIndex: fallbackGlobalIndex
    };
}

function plannerTempPrefix(payload) {
    const projectPrefix = asString(payload.projectPrefix)
        .replace(/\\/g, "/")
        .replace(/\/+$/g, "");
    return projectPrefix ? `${projectPrefix}/_planner_temp_image` : "_planner_temp_image";
}

function makePlannerCompactR2Key(payload, slot) {
    const characterRef = safePlannerRef(payload.characterId || payload.characterPrefix, "character");
    const situationRef = safePlannerRef(slot.item.situationId || slot.item.imageNumber || slot.item.situationName, "situation");
    const variantRef = safePlannerRef(slot.variant.variantId, "variant");
    const generationSequence = asNonNegativeInteger(slot.generationSequence, 0);
    const generationPath = generationSequence > 0 ? `/${generationSequence}` : "";
    return `${plannerTempPrefix(payload)}/${characterRef}/${situationRef}${generationPath}/${variantRef}/${slot.variantImageIndex}.webp`;
}

function recalculateJob(payload, job) {
    const slots = enumerateRunSlots(payload, job.targetSituationId, job.generationSequence);
    const targetAssetIds = new Set(slots.map(slot => slot.assetId));
    const completedCount = payload.items.flatMap(item => item.candidates)
        .filter(candidate => targetAssetIds.has(candidate.assetId)).length;
    const failedCount = asArray(job.failedSlots).filter(slot => targetAssetIds.has(slot.assetId)).length;
    const next = nextRunnableSlot(payload, job);
    let status = job.status;
    if (!next && !["cancel_requested", "cancelled"].includes(status)) {
        status = failedCount > 0 ? (completedCount > 0 ? "partial_failed" : "failed") : "completed";
    }
    return {
        ...job,
        status,
        totalCount: slots.length,
        completedCount,
        failedCount,
        next: pointerFromSlot(next, slots.length),
        updatedAt: nowIso()
    };
}

function applyJobStatusToItems(payload) {
    const job = payload.activeJob;
    if (!job) return;
    const targetIds = new Set(enumerateRunSlots(payload, job.targetSituationId, job.generationSequence).map(slot => slot.itemId));
    for (const item of payload.items) {
        if (!targetIds.has(item.itemId)) continue;
        item.completedCount = item.candidates.length;
        item.failedCount = asArray(job.failedSlots).filter(slot => slot.itemId === item.itemId).length;
        if (TERMINAL_JOB_STATUSES.has(job.status)) {
            item.status = item.failedCount
                ? (item.completedCount ? "partial_failed" : "failed")
                : "complete";
        } else {
            item.status = job.status;
        }
    }
    payload.status = runStatusFromJob(job.status);
}

export async function startPlannerCompactGeneration(env, body = {}) {
    let record = body.runKey || (body.projectId && body.characterId)
        ? await getPlannerCompactRunRecord(env, {
            runKey: body.runKey,
            projectId: body.projectId,
            characterId: body.characterId
        })
        : null;
    if (!record && body.plannerMeta) {
        await putPlannerCompactRunFromMeta(env, body.plannerMeta);
        record = await getPlannerCompactRunRecord(env, {
            projectId: body.projectId || body.plannerMeta.projectId,
            characterId: body.characterId || body.plannerMeta.characterId
        });
    }
    if (!record) throw plannerError("PLANNER_RUN_NOT_FOUND", 404, "Planner run not found.");

    if (ACTIVE_JOB_STATUSES.has(record.payload.activeJob?.status)) {
        if (record.payload.activeJob.status === "queued" && record.payload.activeJob.mode === "background" && env.GENERATION_QUEUE) {
            await env.GENERATION_QUEUE.send({
                plannerCompact: true,
                runKey: record.recordKey,
                jobId: record.payload.activeJob.jobId,
                generationSequence: record.payload.activeJob.generationSequence,
                expectedGlobalImageIndex: record.payload.activeJob.next?.globalImageIndex || 0
            });
        }
        return { ...compactStatusFromRun(record.payload), runKey: record.recordKey, existing: true };
    }

    const mode = body.mode === "browser" ? "browser" : "background";
    const targetSituationId = asString(body.targetSituationId);
    const updated = await mutateRunWithRetry(env, { runKey: record.recordKey }, (payload, current) => {
        if (ACTIVE_JOB_STATUSES.has(payload.activeJob?.status)) return { noWrite: true };
        const targetItems = payload.items.filter(item =>
            !targetSituationId || item.situationId === targetSituationId || item.itemId === targetSituationId
        );
        const candidateSequences = new Set(targetItems
            .flatMap(item => asArray(item.candidates))
            .map(candidate => asNonNegativeInteger(candidate.generationSequence, 0))
            .filter(sequence => sequence > 0));
        const reusableGenerationSequence = body.clearExisting !== true && candidateSequences.size === 1
            ? [...candidateSequences][0]
            : 0;
        const generationSequence = reusableGenerationSequence || (current.revision + 1);
        const startsNewGeneration = reusableGenerationSequence === 0;
        if (body.clearExisting === true || startsNewGeneration) {
            for (const item of payload.items) {
                if (!targetSituationId || item.situationId === targetSituationId || item.itemId === targetSituationId) {
                    item.candidates = [];
                    item.completedCount = 0;
                    item.failedCount = 0;
                }
            }
        }
        const slots = enumerateRunSlots(payload, targetSituationId, generationSequence);
        const completed = getCompletedAssetIds(payload);
        const runnable = slots.find(slot => !completed.has(slot.assetId));
        if (!runnable) throw plannerError("PLANNER_NO_RUNNABLE_ITEMS", 409, "No runnable planner items.");
        const ids = makePlannerCompactIds({
            ...payload,
            runId: payload.runId,
            targetSituationId,
            mode,
            generationSequence
        });
        payload.activeJob = {
            jobId: ids.jobId,
            generationSequence,
            mode,
            status: "queued",
            targetSituationId,
            totalCount: slots.length,
            completedCount: slots.length - slots.filter(slot => !completed.has(slot.assetId)).length,
            failedCount: 0,
            failedSlots: [],
            next: pointerFromSlot(runnable),
            startedAt: nowIso(),
            updatedAt: nowIso(),
            stage: "queued",
            stageLabel: "Queued",
            lastError: ""
        };
        payload.status = "queued";
        applyJobStatusToItems(payload);
        return payload;
    }, "run:generation:start");
    record = updated.record;
    const status = { ...compactStatusFromRun(record.payload), runKey: record.recordKey, existing: false };
    if (mode === "background" && env.GENERATION_QUEUE) {
        await env.GENERATION_QUEUE.send({
            plannerCompact: true,
            runKey: record.recordKey,
            jobId: record.payload.activeJob.jobId,
            generationSequence: record.payload.activeJob.generationSequence,
            expectedGlobalImageIndex: record.payload.activeJob.next.globalImageIndex
        });
    }
    return status;
}

export async function getPlannerCompactStatus(env, lookup = {}) {
    const record = await getPlannerCompactRunRecord(env, lookup);
    if (!record) throw plannerError("PLANNER_RUN_NOT_FOUND", 404, "Planner run not found.");
    const client = plannerCompactRunToClient(record);
    return {
        ...compactStatusFromRun(record.payload),
        runKey: record.recordKey,
        revision: record.revision,
        items: client.items
    };
}

async function controlPlannerCompactGeneration(env, lookup, action) {
    const transitions = {
        pause: { from: new Set(["queued", "running"]), to: "paused" },
        resume: { from: new Set(["paused"]), to: "queued" },
        cancel: { from: new Set(["queued", "running", "paused"]), to: "cancel_requested" }
    };
    const transition = transitions[action];
    const updated = await mutateRunWithRetry(env, lookup, payload => {
        const job = payload.activeJob;
        if (!job) return { noWrite: true };
        if (!transition.from.has(job.status)) return { noWrite: true };
        const nextStatus = action === "cancel" && job.mode === "browser" ? "cancelled" : transition.to;
        job.status = nextStatus;
        job.stage = nextStatus;
        job.stageLabel = nextStatus.replace(/_/g, " ");
        job.updatedAt = nowIso();
        payload.status = nextStatus;
        applyJobStatusToItems(payload);
        return payload;
    }, `run:generation:${action}`);
    const record = updated.record;
    if (action === "resume" && record.payload.activeJob?.status === "queued" && record.payload.activeJob.mode === "background" && env.GENERATION_QUEUE) {
        await env.GENERATION_QUEUE.send({
            plannerCompact: true,
            runKey: record.recordKey,
            jobId: record.payload.activeJob.jobId,
            generationSequence: record.payload.activeJob.generationSequence,
            expectedGlobalImageIndex: record.payload.activeJob.next?.globalImageIndex || 0
        });
    }
    if (action === "cancel" && record.payload.activeJob?.status === "cancel_requested" && record.payload.activeJob.mode === "background" && env.GENERATION_QUEUE) {
        await env.GENERATION_QUEUE.send({
            plannerCompact: true,
            runKey: record.recordKey,
            jobId: record.payload.activeJob.jobId,
            generationSequence: record.payload.activeJob.generationSequence,
            expectedGlobalImageIndex: record.payload.activeJob.next?.globalImageIndex || 0
        });
    }
    return { ...compactStatusFromRun(record.payload), runKey: record.recordKey, revision: record.revision };
}

export async function pausePlannerCompactGeneration(env, lookup) {
    return await controlPlannerCompactGeneration(env, lookup, "pause");
}

export async function resumePlannerCompactGeneration(env, lookup) {
    return await controlPlannerCompactGeneration(env, lookup, "resume");
}

export async function cancelPlannerCompactGeneration(env, lookup) {
    return await controlPlannerCompactGeneration(env, lookup, "cancel");
}

export async function preparePlannerCompactQueueSlot(env, message = {}) {
    const record = await getPlannerCompactRunRecord(env, { runKey: message.runKey });
    if (!record?.payload.activeJob) return { disposition: "ack", reason: "run_missing" };
    const payload = record.payload;
    const job = payload.activeJob;
    if (job.jobId !== message.jobId) return { disposition: "ack", reason: "stale_job" };
    const messageGenerationSequence = asNonNegativeInteger(message.generationSequence, job.generationSequence);
    if (messageGenerationSequence !== asNonNegativeInteger(job.generationSequence, 0)) {
        return { disposition: "ack", reason: "stale_generation" };
    }
    if (job.status === "paused") return { disposition: "ack", reason: "paused" };
    if (job.status === "cancel_requested") {
        const updated = await mutateRunWithRetry(env, { runKey: record.recordKey }, latest => {
            if (latest.activeJob?.jobId !== message.jobId || latest.activeJob.status === "cancelled") return { noWrite: true };
            latest.activeJob.status = "cancelled";
            latest.activeJob.stage = "cancelled";
            latest.activeJob.stageLabel = "Cancelled";
            latest.status = "cancelled";
            applyJobStatusToItems(latest);
            return latest;
        }, "run:generation:cancelled");
        return { disposition: "ack", reason: "cancelled", status: compactStatusFromRun(updated.record.payload) };
    }
    if (!new Set(["queued", "running"]).has(job.status)) return { disposition: "ack", reason: "terminal" };
    const slot = nextRunnableSlot(payload, job);
    if (!slot) return { disposition: "ack", reason: "complete" };
    const expected = asNonNegativeInteger(message.expectedGlobalImageIndex, slot.globalImageIndex);
    if (expected < slot.globalImageIndex) return { disposition: "ack", reason: "duplicate" };
    if (expected > slot.globalImageIndex) return { disposition: "retry", delaySeconds: 15, reason: "future_slot" };
    return {
        disposition: "process",
        runKey: record.recordKey,
        revision: record.revision,
        jobId: job.jobId,
        slot: {
            itemIndex: slot.itemIndex,
            variantIndex: slot.variantIndex,
            variantImageIndex: slot.variantImageIndex,
            globalImageIndex: slot.globalImageIndex,
            generationSequence: slot.generationSequence,
            itemId: slot.itemId,
            variantId: slot.variantId,
            assetId: slot.assetId,
            r2Key: makePlannerCompactR2Key(payload, slot)
        },
        generation: { ...slot.item.generation, ...slot.variant.generation }
    };
}

export async function commitPlannerCompactQueueSlot(env, message = {}, outcome = {}) {
    const updated = await mutateRunWithRetry(env, { runKey: message.runKey }, payload => {
        const job = payload.activeJob;
        if (!job || job.jobId !== message.jobId) return { noWrite: true, stale: true };
        if (asNonNegativeInteger(message.generationSequence, job.generationSequence)
            !== asNonNegativeInteger(job.generationSequence, 0)) {
            return { noWrite: true, stale: true };
        }
        if (job.status === "paused") return { noWrite: true, stale: true };
        if (job.status === "cancel_requested") {
            job.status = "cancelled";
            job.stage = "cancelled";
            job.stageLabel = "Cancelled";
            job.updatedAt = nowIso();
            payload.status = "cancelled";
            applyJobStatusToItems(payload);
            return payload;
        }
        const existing = payload.items.flatMap(item => item.candidates)
            .find(candidate => candidate.assetId === message.assetId);
        if (existing) return { noWrite: true, duplicate: true };
        const slot = nextRunnableSlot(payload, job);
        if (!slot || slot.assetId !== message.assetId) return { noWrite: true, stale: true };
        if (outcome.errorMessage) {
            job.failedSlots = [
                ...asArray(job.failedSlots).filter(failed => failed.assetId !== slot.assetId),
                {
                    assetId: slot.assetId,
                    itemId: slot.itemId,
                    variantId: slot.variantId,
                    variantImageIndex: slot.variantImageIndex,
                    globalImageIndex: slot.globalImageIndex,
                    generationSequence: slot.generationSequence,
                    errorMessage: asString(outcome.errorMessage).slice(0, 1000)
                }
            ];
            job.lastError = asString(outcome.errorMessage).slice(0, 1000);
        } else {
            const candidate = {
                assetId: slot.assetId,
                r2Key: asString(outcome.r2Key),
                itemId: slot.itemId,
                variantId: slot.variantId,
                variantImageIndex: slot.variantImageIndex,
                globalImageIndex: slot.globalImageIndex,
                generationSequence: slot.generationSequence,
                width: asNonNegativeInteger(outcome.width, 0),
                height: asNonNegativeInteger(outcome.height, 0),
                byteSize: asNonNegativeInteger(outcome.byteSize, 0),
                mimeType: asString(outcome.mimeType, "image/webp"),
                createdAt: asString(outcome.createdAt, nowIso())
            };
            if (!candidate.r2Key) throw plannerError("PLANNER_INVALID_INPUT", 400, "r2Key is required.");
            const item = payload.items[slot.itemIndex];
            item.candidates = [
                ...item.candidates.filter(current => current.assetId !== candidate.assetId),
                candidate
            ];
        }
        job.status = "running";
        job.stage = "generating";
        job.stageLabel = "Generating image";
        payload.activeJob = recalculateJob(payload, job);
        payload.status = runStatusFromJob(payload.activeJob.status);
        applyJobStatusToItems(payload);
        return payload;
    }, outcome.errorMessage ? "run:generation:slot-failed" : "run:generation:slot-complete");
    const record = updated.record;
    const next = nextRunnableSlot(record.payload, record.payload.activeJob);
    const duplicate = Boolean(updated.result?.duplicate);
    const stale = Boolean(updated.result?.stale);
    return {
        duplicate,
        stale,
        terminal: !next,
        nextMessage: next && !duplicate && !stale ? {
            plannerCompact: true,
            runKey: record.recordKey,
            jobId: record.payload.activeJob.jobId,
            generationSequence: record.payload.activeJob.generationSequence,
            expectedGlobalImageIndex: next.globalImageIndex
        } : null,
        status: { ...compactStatusFromRun(record.payload), runKey: record.recordKey, revision: record.revision }
    };
}

export async function getPlannerCompactBrowserQueue(env, lookup = {}) {
    const record = await getPlannerCompactRunRecord(env, lookup);
    if (!record) throw plannerError("PLANNER_RUN_NOT_FOUND", 404, "Planner run not found.");
    const job = record.payload.activeJob;
    if (!job || job.mode !== "browser" || TERMINAL_JOB_STATUSES.has(job.status)) {
        return { done: true, runKey: record.recordKey, revision: record.revision };
    }
    if (job.status === "paused") {
        return { done: true, paused: true, runKey: record.recordKey, jobId: job.jobId, revision: record.revision };
    }
    const slot = nextRunnableSlot(record.payload, job);
    if (!slot) return { done: true, runKey: record.recordKey, jobId: job.jobId, revision: record.revision };
    return {
        done: false,
        runKey: record.recordKey,
        jobId: job.jobId,
        expectedRevision: record.revision,
        slot: {
            itemId: slot.itemId,
            variantId: slot.variantId,
            variantImageIndex: slot.variantImageIndex,
            globalImageIndex: slot.globalImageIndex,
            generationSequence: slot.generationSequence,
            assetId: slot.assetId,
            r2Key: makePlannerCompactR2Key(record.payload, slot)
        },
        generation: { ...slot.item.generation, ...slot.variant.generation }
    };
}

export async function completePlannerCompactBrowserQueue(env, body = {}) {
    const current = await getPlannerCompactRunRecord(env, { runKey: body.runKey });
    if (!current) throw plannerError("PLANNER_RUN_NOT_FOUND", 404, "Planner run not found.");
    const existing = current.payload.items.flatMap(item => item.candidates)
        .find(candidate => candidate.assetId === body.assetId);
    if (existing) {
        return {
            duplicate: true,
            terminal: !nextRunnableSlot(current.payload, current.payload.activeJob),
            status: { ...compactStatusFromRun(current.payload), runKey: current.recordKey, revision: current.revision }
        };
    }
    const next = await getPlannerCompactBrowserQueue(env, { runKey: body.runKey });
    if (next.done) return next;
    if (next.jobId !== body.jobId
        || next.slot.assetId !== body.assetId
        || next.slot.r2Key !== body.r2Key
        || asNonNegativeInteger(body.generationSequence, next.slot.generationSequence) !== next.slot.generationSequence) {
        throw plannerError("PLANNER_REVISION_CONFLICT", 409, "Browser generation slot is stale.");
    }
    const object = await env.imgBucket.head(next.slot.r2Key);
    if (!object) throw plannerError("PLANNER_ASSET_NOT_FOUND", 404, "Planner browser asset object not found.");
    return await commitPlannerCompactQueueSlot(env, {
        runKey: body.runKey,
        jobId: body.jobId,
        assetId: next.slot.assetId,
        generationSequence: next.slot.generationSequence
    }, {
        r2Key: next.slot.r2Key,
        width: body.width,
        height: body.height,
        byteSize: object.size || body.byteSize,
        mimeType: object.httpMetadata?.contentType || body.mimeType
    });
}

export async function getPlannerCompactRateLimit(env, key = "novelai") {
    const record = await getPlannerCompactRecord(env, makePlannerCompactKey("rate", { key }), "rate");
    return record?.payload || null;
}

export async function putPlannerCompactRateLimit(env, input = {}) {
    const key = safePlannerRef(input.key || "novelai", "novelai");
    const requestedAvailableAt = Number(input.availableAt || 0);
    const payload = {
        version: 1,
        key,
        availableAt: Number.isFinite(requestedAvailableAt) ? Math.max(0, requestedAvailableAt) : 0,
        reason: asString(input.reason, "cooldown")
    };
    return await putPlannerCompactRecord(env, {
        recordKey: makePlannerCompactKey("rate", { key }),
        recordType: "rate",
        projectId: "",
        characterId: "",
        status: "cooldown",
        payload,
        expiresAt: new Date(payload.availableAt).toISOString()
    });
}

async function removeConfirmedItemFromRun(env, runKey, itemId, assetId) {
    for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt += 1) {
        const current = await getPlannerCompactRunRecord(env, { runKey });
        if (!current) return null;
        const item = current.payload.items.find(entry => entry.itemId === itemId);
        if (!item) return current;
        if (!item.candidates.some(candidate => candidate.assetId === assetId)) {
            throw plannerError("PLANNER_CONFIRM_CONFLICT", 409, "Planner item candidates changed during confirm.");
        }
        const payload = cloneJson(current.payload);
        payload.items = payload.items.filter(entry => entry.itemId !== itemId);
        payload.status = payload.items.length ? "draft" : "confirmed";
        payload.activeJob = null;
        if (await updatePlannerCompactRecord(env, current, payload, {
            status: payload.status,
            label: payload.items.length ? "run:confirm:remove-item" : "run:confirm:tombstone"
        })) return await getPlannerCompactRunRecord(env, { runKey });
    }
    throw plannerError("PLANNER_REVISION_CONFLICT", 409, "Planner revision conflict.");
}

function makePlannerCompactConfirmBackupKey(candidateR2Key) {
    return `${candidateR2Key}.confirm-backup`;
}

function plannerCompactObjectMatches(left, right) {
    return Boolean(
        left
        && right
        && left.key === right.key
        && left.etag === right.etag
        && Number(left.size) === Number(right.size)
    );
}

async function preparePlannerCompactTargetWrite(env, {
    candidate,
    generationSequence,
    operationId,
    targetR2Key
}) {
    const backupR2Key = makePlannerCompactConfirmBackupKey(candidate.r2Key);
    let backup = await env.imgBucket.head(backupR2Key);
    let previousTarget = null;

    if (backup) {
        if (backup.customMetadata?.plannerConfirmBackupOperationId !== operationId) {
            throw plannerError(
                "PLANNER_CONFIRM_BACKUP_CONFLICT",
                409,
                "Planner confirm backup belongs to another operation."
            );
        }
        previousTarget = await env.imgBucket.head(targetR2Key);
        if (previousTarget?.customMetadata?.plannerConfirmOperationId !== operationId) {
            throw plannerError(
                "PLANNER_CONFIRM_TARGET_CONFLICT",
                409,
                "Planner confirm target changed while recovering an interrupted operation."
            );
        }
    } else {
        const originalTarget = await env.imgBucket.get(targetR2Key);
        const originalMissing = !originalTarget;
        const backupResult = await env.imgBucket.put(
            backupR2Key,
            originalTarget ? originalTarget.body : null,
            {
                httpMetadata: originalTarget?.httpMetadata,
                customMetadata: {
                    ...(originalTarget?.customMetadata || {}),
                    plannerConfirmBackupOperationId: operationId,
                    plannerConfirmOriginalMissing: originalMissing ? "true" : "false"
                }
            }
        );
        backup = await env.imgBucket.head(backupR2Key);
        if (!backupResult || !plannerCompactObjectMatches(backupResult, backup)
            || backup?.customMetadata?.plannerConfirmBackupOperationId !== operationId) {
            throw plannerError(
                "PLANNER_CONFIRM_BACKUP_FAILED",
                502,
                "Planner target backup could not be verified."
            );
        }
        previousTarget = originalTarget;
    }

    const object = await env.imgBucket.get(candidate.r2Key);
    if (!object) {
        throw plannerError("PLANNER_ASSET_NOT_FOUND", 404, "Planner candidate object not found.");
    }
    const onlyIf = previousTarget
        ? { etagMatches: previousTarget.etag }
        : { etagDoesNotMatch: "*" };
    const stored = await env.imgBucket.put(targetR2Key, object.body, {
        onlyIf,
        httpMetadata: {
            contentType: candidate.mimeType || object.httpMetadata?.contentType || "image/webp"
        },
        customMetadata: {
            ispublic: "false",
            visibilityconfigured: "true",
            plannerConfirmOperationId: operationId,
            plannerAssetId: candidate.assetId,
            plannerGenerationSequence: String(generationSequence)
        }
    });
    if (!stored) {
        throw plannerError(
            "PLANNER_CONFIRM_TARGET_CONFLICT",
            409,
            "Planner target changed before the replacement could be stored."
        );
    }

    const verified = await env.imgBucket.head(targetR2Key);
    if (!plannerCompactObjectMatches(stored, verified)
        || verified?.customMetadata?.plannerConfirmOperationId !== operationId
        || verified?.customMetadata?.plannerAssetId !== candidate.assetId
        || verified?.customMetadata?.plannerGenerationSequence !== String(generationSequence)) {
        throw plannerError(
            "PLANNER_CONFIRM_TARGET_VERIFY_FAILED",
            502,
            "Planner target replacement could not be verified."
        );
    }

    return {
        backupR2Key,
        storedEtag: stored.etag
    };
}

async function rollbackPlannerCompactTargetWrite(env, {
    backupR2Key,
    operationId,
    storedEtag,
    targetR2Key
}) {
    const current = await env.imgBucket.head(targetR2Key);
    if (!current || current.customMetadata?.plannerConfirmOperationId !== operationId) {
        await env.imgBucket.delete(backupR2Key);
        return { restored: false, targetWasUnchanged: true };
    }
    if (storedEtag && current.etag !== storedEtag) {
        throw plannerError(
            "PLANNER_CONFIRM_ROLLBACK_CONFLICT",
            409,
            "Planner target changed before the failed confirmation could be rolled back."
        );
    }

    const backup = await env.imgBucket.get(backupR2Key);
    if (!backup || backup.customMetadata?.plannerConfirmBackupOperationId !== operationId) {
        throw plannerError(
            "PLANNER_CONFIRM_ROLLBACK_FAILED",
            500,
            "Planner target backup is missing."
        );
    }
    if (backup.customMetadata?.plannerConfirmOriginalMissing === "true") {
        await env.imgBucket.delete(targetR2Key);
        if (await env.imgBucket.head(targetR2Key)) {
            throw plannerError(
                "PLANNER_CONFIRM_ROLLBACK_FAILED",
                500,
                "New planner target could not be removed during rollback."
            );
        }
    } else {
        const restoredMetadata = { ...(backup.customMetadata || {}) };
        delete restoredMetadata.plannerConfirmBackupOperationId;
        delete restoredMetadata.plannerConfirmOriginalMissing;
        const restored = await env.imgBucket.put(targetR2Key, backup.body, {
            onlyIf: { etagMatches: current.etag },
            httpMetadata: backup.httpMetadata,
            customMetadata: restoredMetadata
        });
        const verified = await env.imgBucket.head(targetR2Key);
        if (!restored || !plannerCompactObjectMatches(restored, verified)) {
            throw plannerError(
                "PLANNER_CONFIRM_ROLLBACK_FAILED",
                500,
                "Previous planner target could not be restored."
            );
        }
    }
    await env.imgBucket.delete(backupR2Key);
    return { restored: true, targetWasUnchanged: false };
}

async function commitPlannerCompactConfirmation(env, {
    assetId,
    completedPayload,
    confirmKey,
    itemId,
    metadata,
    runKey,
    targetFileName,
    targetFolderPrefix,
    timestamp
}) {
    const [currentConfirm, currentRun] = await Promise.all([
        getPlannerCompactRecord(env, confirmKey, "confirm"),
        getPlannerCompactRunRecord(env, { runKey })
    ]);
    if (!currentConfirm || currentConfirm.payload.status !== "pending") {
        throw plannerError("PLANNER_CONFIRM_CONFLICT", 409, "Planner confirmation is no longer pending.");
    }
    const currentItem = currentRun?.payload.items.find(entry => entry.itemId === itemId);
    if (!currentItem?.candidates.some(candidate => candidate.assetId === assetId)) {
        throw plannerError("PLANNER_CONFIRM_CONFLICT", 409, "Planner item candidates changed during confirm.");
    }

    const nextRunPayload = cloneJson(currentRun.payload);
    nextRunPayload.items = nextRunPayload.items.filter(entry => entry.itemId !== itemId);
    nextRunPayload.status = nextRunPayload.items.length ? "draft" : "confirmed";
    nextRunPayload.activeJob = null;
    nextRunPayload.updatedAt = timestamp;

    const nextConfirmPayload = {
        ...completedPayload,
        updatedAt: timestamp
    };
    const nextRunPayloadJson = serializePayload(nextRunPayload, currentRun.recordKey);
    const nextConfirmPayloadJson = serializePayload(nextConfirmPayload, currentConfirm.recordKey);
    const nextRunRevision = currentRun.revision + 1;

    const results = await env.DB.batch([
        env.DB.prepare(`
            INSERT INTO file_metadata (folder_prefix, file_name, metadata_json, created_at, updated_at)
            SELECT ?, ?, ?, ?, ?
            WHERE EXISTS (
                SELECT 1 FROM planner_compact_records
                WHERE record_key = ? AND record_type = 'confirm' AND revision = ?
            ) AND EXISTS (
                SELECT 1 FROM planner_compact_records
                WHERE record_key = ? AND record_type = 'run' AND revision = ?
            )
            ON CONFLICT(folder_prefix, file_name) DO UPDATE SET
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at
        `).bind(
            targetFolderPrefix,
            targetFileName,
            JSON.stringify(metadata || {}),
            timestamp,
            timestamp,
            currentConfirm.recordKey,
            currentConfirm.revision,
            currentRun.recordKey,
            currentRun.revision
        ),
        env.DB.prepare(`
            UPDATE planner_compact_records
            SET status = ?, payload_json = ?, revision = revision + 1,
                updated_at = ?, expires_at = ?
            WHERE record_key = ? AND record_type = 'run' AND revision = ?
              AND EXISTS (
                  SELECT 1 FROM planner_compact_records
                  WHERE record_key = ? AND record_type = 'confirm' AND revision = ?
              )
        `).bind(
            nextRunPayload.status,
            nextRunPayloadJson,
            timestamp,
            currentRun.expiresAt,
            currentRun.recordKey,
            currentRun.revision,
            currentConfirm.recordKey,
            currentConfirm.revision
        ),
        env.DB.prepare(`
            UPDATE planner_compact_records
            SET status = 'completed', payload_json = ?, revision = revision + 1,
                updated_at = ?, expires_at = ?
            WHERE record_key = ? AND record_type = 'confirm' AND revision = ?
              AND EXISTS (
                  SELECT 1 FROM planner_compact_records
                  WHERE record_key = ? AND record_type = 'run'
                    AND revision = ? AND payload_json = ?
              )
        `).bind(
            nextConfirmPayloadJson,
            timestamp,
            nextConfirmPayload.expiresAt,
            currentConfirm.recordKey,
            currentConfirm.revision,
            currentRun.recordKey,
            nextRunRevision,
            nextRunPayloadJson
        )
    ]);
    const changes = results.map(result => Number(result.meta?.changes || 0));
    if (changes.some(changeCount => changeCount !== 1)) {
        throw plannerError("PLANNER_REVISION_CONFLICT", 409, "Planner confirm revision conflict.");
    }
    if (env?.PLANNER_D1_METRICS === "1") {
        console.log("[planner-compact-d1]", "confirm:commit-batch", {
            itemId,
            rowsWritten: results.reduce((total, result) => total + Number(result.meta?.rows_written || 0), 0),
            changes
        });
    }
    return nextConfirmPayload;
}

export async function confirmPlannerCompactAsset(env, body = {}) {
    const runKey = asString(body.runKey);
    const itemId = asString(body.itemId);
    const assetId = asString(body.assetId);
    if (!runKey || !itemId || !assetId) {
        throw plannerError("PLANNER_INVALID_INPUT", 400, "runKey, itemId and assetId are required.");
    }
    const confirmKey = makePlannerCompactKey("confirm", { itemId });
    let confirm = await getPlannerCompactRecord(env, confirmKey, "confirm");
    const requestedGenerationSequence = asNonNegativeInteger(body.generationSequence, 0);
    const requestedTargetFolderPrefix = asString(body.targetFolderPrefix);
    const requestedTargetFileName = asString(body.targetFileName);
    const requestedTargetR2Key = asString(
        body.targetR2Key,
        requestedTargetFolderPrefix && requestedTargetFileName
            ? `${requestedTargetFolderPrefix}${requestedTargetFileName}`
            : ""
    );
    if (confirm?.payload.status === "completed") {
        const confirmGenerationSequence = asNonNegativeInteger(confirm.payload.generationSequence, 0);
        const sameCompletedOperation = confirm.payload.selectedAssetId === assetId
            && (!requestedTargetR2Key || confirm.payload.targetR2Key === requestedTargetR2Key)
            && (!requestedGenerationSequence || confirmGenerationSequence === requestedGenerationSequence);
        if (sameCompletedOperation) {
            const remainingRun = await getPlannerCompactRunRecord(env, { runKey });
            if (remainingRun?.payload.items.some(entry => entry.itemId === itemId)) {
                await removeConfirmedItemFromRun(env, runKey, itemId, assetId);
            }
            const cleanup = await cleanupPlannerCompactAssets(env, {
                keys: [
                    ...asArray(confirm.payload.candidateKeys),
                    asString(confirm.payload.backupR2Key)
                ].filter(Boolean)
            });
            return { ...cloneJson(confirm.payload), cleanup };
        }
    }
    const run = await getPlannerCompactRunRecord(env, { runKey });
    if (!run) throw plannerError("PLANNER_RUN_NOT_FOUND", 404, "Planner run not found.");
    const item = run.payload.items.find(entry => entry.itemId === itemId);
    if (!item) throw plannerError("PLANNER_ITEM_NOT_FOUND", 404, "Planner item not found.");
    const candidate = item.candidates.find(entry => entry.assetId === assetId);
    if (!candidate) throw plannerError("PLANNER_ASSET_NOT_FOUND", 404, "Planner asset not found.");
    const generationSequence = asNonNegativeInteger(candidate.generationSequence, 0);
    if (requestedGenerationSequence && requestedGenerationSequence !== generationSequence) {
        throw plannerError("PLANNER_CONFIRM_CONFLICT", 409, "Planner candidate generation changed during confirm.");
    }
    const targetFolderPrefix = asString(body.targetFolderPrefix);
    const targetFileName = asString(body.targetFileName, `${item.imageNumber}.webp`);
    const targetR2Key = asString(body.targetR2Key, `${targetFolderPrefix}${targetFileName}`);
    if (!targetR2Key) throw plannerError("PLANNER_INVALID_INPUT", 400, "targetR2Key is required.");
    const confirmGenerationSequence = asNonNegativeInteger(confirm?.payload.generationSequence, 0);
    const sameConfirmOperation = Boolean(
        confirm
        && confirmGenerationSequence === generationSequence
        && confirm.payload.selectedAssetId === assetId
        && confirm.payload.targetR2Key === targetR2Key
    );
    if (confirm?.payload.status === "pending" && !sameConfirmOperation) {
        throw plannerError("PLANNER_CONFIRM_CONFLICT", 409, "Another confirm operation is still pending for this item.");
    }
    if (confirm
        && !sameConfirmOperation
        && (generationSequence < confirmGenerationSequence
            || (generationSequence === confirmGenerationSequence && confirm.payload.status === "completed"))) {
        throw plannerError("PLANNER_CONFIRM_CONFLICT", 409, "Planner item was already confirmed with the same or a newer generation.");
    }
    const timestamp = nowIso();
    const candidateKeys = [...new Set(item.candidates.map(entry => asString(entry.r2Key)).filter(Boolean))];
    const confirmPayload = {
        version: 1,
        operationId: makePlannerCompactIds({ itemId, generationSequence }).operationId,
        runKey,
        itemId,
        generationSequence,
        selectedAssetId: assetId,
        selectedR2Key: candidate.r2Key,
        candidateKeys,
        backupR2Key: makePlannerCompactConfirmBackupKey(candidate.r2Key),
        targetR2Key,
        targetFolderPrefix,
        targetFileName,
        status: "pending",
        errorMessage: "",
        createdAt: sameConfirmOperation ? (confirm?.payload.createdAt || timestamp) : timestamp,
        completedAt: "",
        expiresAt: futureIso(CONFIRM_RETENTION_MS)
    };
    if (!confirm || !sameConfirmOperation || confirm.payload.status === "failed") {
        confirm = await putPlannerCompactRecord(env, {
            recordKey: confirmKey,
            recordType: "confirm",
            projectId: run.projectId,
            characterId: run.characterId,
            status: "pending",
            payload: confirmPayload,
            createdAt: confirm?.createdAt,
            expiresAt: confirmPayload.expiresAt
        });
    }
    let targetWrite = null;
    try {
        targetWrite = await preparePlannerCompactTargetWrite(env, {
            candidate,
            generationSequence,
            operationId: confirmPayload.operationId,
            targetR2Key
        });
        const completedPayload = {
            ...confirmPayload,
            status: "completed",
            errorMessage: "",
            completedAt: nowIso(),
            expiresAt: futureIso(CONFIRM_RETENTION_MS)
        };
        const committedPayload = await commitPlannerCompactConfirmation(env, {
            assetId,
            completedPayload,
            confirmKey,
            itemId,
            metadata: body.metadata,
            runKey,
            targetFileName,
            targetFolderPrefix,
            timestamp: nowIso()
        });
        const cleanup = await cleanupPlannerCompactAssets(env, {
            keys: [...candidateKeys, targetWrite.backupR2Key]
        });
        if (cleanup.failedCount > 0) {
            console.warn(JSON.stringify({
                message: "Planner candidate cleanup was incomplete.",
                itemId,
                generationSequence,
                failedKeys: cleanup.failedKeys
            }));
        }
        return { ...committedPayload, cleanup };
    } catch (error) {
        let rollbackError = null;
        const backupR2Key = targetWrite?.backupR2Key
            || makePlannerCompactConfirmBackupKey(candidate.r2Key);
        try {
            await rollbackPlannerCompactTargetWrite(env, {
                backupR2Key,
                operationId: confirmPayload.operationId,
                storedEtag: targetWrite?.storedEtag || "",
                targetR2Key
            });
        } catch (caughtRollbackError) {
            rollbackError = caughtRollbackError;
            console.error(JSON.stringify({
                message: "Planner target rollback failed.",
                itemId,
                generationSequence,
                targetR2Key,
                backupR2Key,
                error: caughtRollbackError?.message || String(caughtRollbackError)
            }));
        }
        const latestConfirm = await getPlannerCompactRecord(env, confirmKey, "confirm").catch(() => null);
        if (latestConfirm && latestConfirm.payload.status !== "completed") {
            const failedPayload = {
                ...latestConfirm.payload,
                status: "failed",
                errorMessage: (
                    rollbackError
                        ? `${error?.message || String(error)} Rollback failed: ${rollbackError?.message || String(rollbackError)}`
                        : (error?.message || String(error))
                ).slice(0, 1000)
            };
            await updatePlannerCompactRecord(env, latestConfirm, failedPayload, {
                status: "failed",
                label: "confirm:failed"
            }).catch(() => false);
        }
        if (rollbackError) throw rollbackError;
        throw error;
    }
}

export async function cleanupPlannerCompactAssets(env, options = {}) {
    const keepKeys = new Set(asArray(options.keepKeys).map(asString).filter(Boolean));
    const explicitKeys = asArray(options.keys || options.candidateKeys).map(asString).filter(Boolean);
    const prefix = asString(options.prefix).replace(/\\/g, "/");
    const listedKeys = [];
    if (prefix) {
        if (!prefix.includes("_planner_temp_image")) {
            throw plannerError("PLANNER_INVALID_INPUT", 400, "Cleanup prefix must target planner temporary images.");
        }
        const listed = await env.imgBucket.list({
            prefix,
            limit: Math.max(1, Math.min(1000, asNonNegativeInteger(options.limit, 100)))
        });
        listedKeys.push(...asArray(listed.objects).map(object => object.key));
    }
    const keys = [...new Set([...explicitKeys, ...listedKeys])].filter(key => !keepKeys.has(key));
    let deletedCount = 0;
    const failedKeys = [];
    for (const key of keys) {
        try {
            await env.imgBucket.delete(key);
            deletedCount += 1;
        } catch {
            failedKeys.push(key);
        }
    }
    return { scanned: keys.length, deletedCount, failedCount: failedKeys.length, failedKeys };
}

export { ACTIVE_JOB_STATUSES, TERMINAL_JOB_STATUSES };
