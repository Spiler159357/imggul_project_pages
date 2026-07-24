// functions/[[path]].js
import {
    jsonResponse,
    writeBackgroundErrorLog
} from "../src/worker-utils.js";
import {
    handleGuestApi,
    normalizeGuestProjectPath,
    resolveGuestProject
} from "../src/guest-api.js";
import {
    isImageObjectKey,
    isPublicR2ImageObject,
    normalizeImageObjectKey,
    serveR2Image
} from "../src/image-serving.js";
import {
    cancelPlannerCompactGeneration,
    cleanupPlannerCompactAssets,
    completePlannerCompactBrowserQueue,
    confirmPlannerCompactAsset,
    deletePlannerCompactItem,
    deletePlannerCompactRun,
    getPlannerCompactBrowserQueue,
    getPlannerCompactRun,
    getPlannerCompactSettings,
    getPlannerCompactStatus,
    pausePlannerCompactGeneration,
    putPlannerCompactItemFromMeta,
    putPlannerCompactRunFromMeta,
    putPlannerCompactSettings,
    resumePlannerCompactGeneration,
    startPlannerCompactGeneration,
    updatePlannerCompactItem
} from "../src/planner-compact.js";
// Cloudflare Pages Functions - Catch-all 라우터 및 API 서버리스 핸들러

function plannerApiErrorResponse(error) {
    return jsonResponse({
        error: error?.message || String(error || "Planner request failed"),
        code: error?.code || undefined
    }, { status: error?.status || 500 });
}

async function constantTimeTextEqual(left, right) {
    const encoder = new TextEncoder();
    const [leftHash, rightHash] = await Promise.all([
        crypto.subtle.digest('SHA-256', encoder.encode(String(left || ''))),
        crypto.subtle.digest('SHA-256', encoder.encode(String(right || '')))
    ]);
    const leftBytes = new Uint8Array(leftHash);
    const rightBytes = new Uint8Array(rightHash);
    let difference = 0;
    for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
    return difference === 0;
}

/**
 * 역할: R2 object key가 텍스트 메모 파일인지 판별한다.
 * 매개변수: key - 검사할 파일 경로 문자열.
 * 주요 변수: key - 소문자로 변환해 확장자를 확인한다.
 * 반환값: .txt로 끝나면 true, 아니면 false.
 */
function isTextFile(key) {
    return key.toLowerCase().endsWith('.txt');
}

function isReadableTextFile(key) {
    const lowerKey = key.toLowerCase();
    return lowerKey.endsWith('.txt') || lowerKey.endsWith('.log');
}

/**
 * 역할: R2 object key를 폴더 prefix와 파일명으로 분리한다.
 * 매개변수: key - 분리할 전체 경로 문자열.
 * 주요 변수: parts, fileName, prefix - 경로 조각과 마지막 파일명.
 * 반환값: { prefix, fileName } 형태의 객체.
 */
function splitPath(key) {
    const parts = key.split('/');
    const fileName = parts.pop();
    const prefix = parts.length > 0 ? parts.join('/') + '/' : '';
    return { prefix, fileName };
}

function getKstDateParts(date = new Date()) {
    const kstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
    const pad = value => String(value).padStart(2, '0');
    const padMs = value => String(value).padStart(3, '0');
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

function toKstIso(date = new Date()) {
    const parts = getKstDateParts(date);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.millisecond}+09:00`;
}

function nowIso() {
    return toKstIso();
}

async function ensureJsonDbSchema(env) {
    if (!env.DB) throw new Error('DB binding is not configured');
    await env.DB.batch([
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS json_documents (
                doc_type TEXT NOT NULL,
                object_key TEXT NOT NULL,
                data_json TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'db',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (doc_type, object_key)
            )
        `),
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS file_metadata (
                folder_prefix TEXT NOT NULL,
                file_name TEXT NOT NULL,
                metadata_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (folder_prefix, file_name)
            )
        `),
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS aliases (
                scope TEXT NOT NULL,
                project_name TEXT NOT NULL DEFAULT '',
                target_key TEXT NOT NULL,
                alias TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (scope, project_name, target_key)
            )
        `)
    ]);
}

async function readR2Json(env, key, fallback = null) {
    try {
        const object = await env.imgBucket.get(key);
        return object ? await object.json() : fallback;
    } catch {
        return fallback;
    }
}

async function getJsonDocument(env, docType, objectKey, fallbackKey = objectKey, fallbackValue = null) {
    await ensureJsonDbSchema(env);
    const row = await env.DB.prepare(
        'SELECT data_json FROM json_documents WHERE doc_type = ? AND object_key = ?'
    ).bind(docType, objectKey).first();
    if (row?.data_json) {
        try {
            return JSON.parse(row.data_json);
        } catch {}
    }
    return fallbackValue;
}

async function putJsonDocument(env, docType, objectKey, value, source = 'db') {
    await ensureJsonDbSchema(env);
    const timestamp = nowIso();
    await env.DB.prepare(`
        INSERT INTO json_documents (doc_type, object_key, data_json, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(doc_type, object_key) DO UPDATE SET
            data_json = excluded.data_json,
            source = excluded.source,
            updated_at = excluded.updated_at
    `).bind(docType, objectKey, JSON.stringify(value || {}), source, timestamp, timestamp).run();
    await mirrorJsonDocumentToV2(env, docType, objectKey, value || {}).catch(() => null);
}

function getProjectPrefixFromDocumentKey(key = '') {
    const value = String(key || '');
    const slashIndex = value.indexOf('/');
    if (slashIndex >= 0) return value.slice(0, slashIndex + 1);
    const situationSuffix = '_situations_meta.json';
    if (value.endsWith(situationSuffix)) return `${value.slice(0, -situationSuffix.length)}/`;
    return '';
}

async function upsertV2PromptSnapshot(env, ownerType, ownerId, kind, compiledPrompt, timestamp = nowIso()) {
    const promptSetId = makeStableDbId('prompt', `${ownerType}:${ownerId}:${kind}`);
    await env.DB.prepare(`
        INSERT INTO v2_prompt_sets (
            id, owner_type, owner_id, kind, name, is_active, sort_order,
            compiled_prompt_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, '', 1, 0, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            compiled_prompt_json = excluded.compiled_prompt_json,
            is_active = excluded.is_active,
            updated_at = excluded.updated_at
    `).bind(promptSetId, ownerType, ownerId, kind, JSON.stringify(compiledPrompt || {}), timestamp, timestamp).run();
    return promptSetId;
}

async function mirrorJsonDocumentToV2(env, docType, objectKey, value) {
    if (!env?.DB) return;
    const timestamp = nowIso();
    if (docType === 'character_meta') {
        const projectPrefix = getProjectPrefixFromDocumentKey(objectKey);
        const characterId = objectKey.replace(/_character_meta\.json$/, '');
        const projectId = projectPrefix || makeStableDbId('project', objectKey);
        await env.DB.prepare(`
            INSERT INTO v2_projects (id, name, prefix, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET prefix = excluded.prefix, updated_at = excluded.updated_at
        `).bind(projectId, projectPrefix || projectId, projectPrefix || projectId, timestamp, timestamp).run();
        await env.DB.prepare(`
            INSERT INTO v2_characters (id, project_id, name, prefix, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, prefix = excluded.prefix, updated_at = excluded.updated_at
        `).bind(characterId, projectId, value?.name || characterId, characterId, timestamp, timestamp).run();
        await upsertV2PromptSnapshot(env, 'character', characterId, 'default', value, timestamp);
    }
    if (docType === 'situations_meta') {
        const projectPrefix = getProjectPrefixFromDocumentKey(objectKey);
        const projectId = projectPrefix || makeStableDbId('project', objectKey);
        await env.DB.prepare(`
            INSERT INTO v2_projects (id, name, prefix, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET prefix = excluded.prefix, updated_at = excluded.updated_at
        `).bind(projectId, projectPrefix || projectId, projectPrefix || projectId, timestamp, timestamp).run();
        const situations = Array.isArray(value?.situations) ? value.situations : [];
        const statements = [];
        situations.forEach((situation, index) => {
            const situationId = situation?.id || situation?.folderName || makeStableDbId('situation', `${objectKey}:${index}`);
            statements.push(env.DB.prepare(`
                INSERT INTO v2_situations (id, project_id, name, image_number, rating, sort_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    project_id = excluded.project_id,
                    name = excluded.name,
                    image_number = excluded.image_number,
                    rating = excluded.rating,
                    sort_order = excluded.sort_order,
                    updated_at = excluded.updated_at
            `).bind(
                situationId,
                projectId,
                situation?.name || situation?.alias || situationId,
                String(situation?.imageNumber ?? index),
                situation?.rating === 'nsfw' ? 'nsfw' : 'sfw',
                index,
                timestamp,
                timestamp
            ));
            statements.push(env.DB.prepare(`
                INSERT INTO v2_prompt_sets (
                    id, owner_type, owner_id, kind, name, is_active, sort_order,
                    compiled_prompt_json, created_at, updated_at
                ) VALUES (?, 'situation', ?, 'default', '', 1, 0, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    compiled_prompt_json = excluded.compiled_prompt_json,
                    updated_at = excluded.updated_at
            `).bind(makeStableDbId('prompt', `situation:${situationId}:default`), situationId, JSON.stringify(situation || {}), timestamp, timestamp));
        });
        for (let i = 0; i < statements.length; i += 50) {
            await env.DB.batch(statements.slice(i, i + 50));
        }
    }
}

async function ensurePlannerMetaSchema(env) {
    if (!env.DB) throw new Error('DB binding is not configured');
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
                default_count INTEGER NOT NULL DEFAULT 10,
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
                count INTEGER NOT NULL DEFAULT 10,
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

function parseJsonField(value, fallback) {
    try {
        return value ? JSON.parse(value) : fallback;
    } catch {
        return fallback;
    }
}

function getPlannerItemDbId(objectKey, item, index) {
    return `${objectKey}#${item?.situationId || item?.imageNumber || index}`;
}

function makeStableDbId(prefix, value = '') {
    const source = String(value || prefix);
    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
        hash ^= source.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    const compact = source.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
    return `${prefix}_${compact || 'row'}_${(hash >>> 0).toString(16)}`;
}

function getPlannerIdentityFromKey(objectKey = '') {
    const key = String(objectKey || '');
    const marker = '_planner_temp_image/';
    const markerIndex = key.indexOf(marker);
    const projectPrefix = markerIndex >= 0 ? key.slice(0, markerIndex) : '';
    const planMatch = key.match(/\/plans\/([^/]+)_planner_meta\.json$/);
    return {
        projectPrefix,
        characterId: planMatch?.[1] || ''
    };
}

function getCanonicalPlannerObjectKey(objectKey = '', header = {}) {
    const identity = getPlannerIdentityFromKey(objectKey);
    const projectPrefix = header.projectPrefix || identity.projectPrefix || header.projectId || '';
    const rawCharacterId = header.characterId || identity.characterId || '';
    const characterId = String(rawCharacterId || '').trim().replace(/[\\/]+/g, '_');
    if (!projectPrefix) return String(objectKey || '');
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

function normalizeV2PlannerRunStatus(status = 'draft') {
    if (status === 'queued') return 'running';
    if (status === 'partial_failed') return 'failed';
    if (status === 'cancel_requested') return 'draft';
    return ['draft', 'running', 'paused', 'completed', 'confirmed', 'failed'].includes(status) ? status : 'draft';
}

function normalizeV2PlannerItemStatus(status = 'pending') {
    if (status === 'queued') return 'running';
    if (status === 'completed') return 'done';
    if (status === 'partial_failed') return 'failed';
    if (status === 'cancel_requested') return 'pending';
    return ['pending', 'running', 'paused', 'done', 'confirmed', 'failed'].includes(status) ? status : 'pending';
}

function getFileNameFromKey(key = '') {
    return String(key || '').split('/').filter(Boolean).pop() || String(key || '');
}

function getAssetIdFromKey(key = '') {
    return makeStableDbId('asset', key);
}

async function putV2PlannerMetaDocument(env, objectKey, meta = {}) {
    await ensureV2PlannerSourceSchema(env);
    const timestamp = nowIso();
    const { header, items } = splitPlannerMetaForDb(meta);
    const canonicalObjectKey = getCanonicalPlannerObjectKey(objectKey, header);
    const identity = getPlannerIdentityFromKey(canonicalObjectKey);
    const projectPrefix = header.projectPrefix || identity.projectPrefix || header.projectId || makeStableDbId('project', objectKey);
    const projectId = projectPrefix;
    const characterId = header.characterId || identity.characterId || makeStableDbId('character', objectKey);
    const characterPrefix = header.characterPrefix || characterId;
    const runId = makeStableDbId('run', canonicalObjectKey);
    const currentPlannerItemIds = items.map((rawItem, index) => {
        const situationId = rawItem?.situationId || makeStableDbId('situation', `${objectKey}:${index}`);
        return makeStableDbId('pitem', `${objectKey}:${situationId}`);
    });

    const statements = [
        env.DB.prepare(`
            INSERT INTO v2_projects (id, name, prefix, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = COALESCE(NULLIF(excluded.name, ''), v2_projects.name),
                prefix = excluded.prefix,
                updated_at = excluded.updated_at
        `).bind(projectId, projectPrefix, projectPrefix, timestamp, timestamp),
        env.DB.prepare(`
            INSERT INTO v2_characters (id, project_id, name, prefix, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                project_id = excluded.project_id,
                name = COALESCE(NULLIF(excluded.name, ''), v2_characters.name),
                prefix = excluded.prefix,
                updated_at = excluded.updated_at
        `).bind(characterId, projectId, characterPrefix || characterId, characterPrefix || characterId, timestamp, timestamp),
        env.DB.prepare('DELETE FROM v2_planner_sources WHERE source_key IN (?, ?)')
            .bind(objectKey, canonicalObjectKey),
        env.DB.prepare(`
            INSERT INTO v2_planner_runs (
                id, project_id, character_id, status, mode, default_count, source_object_key,
                ui_status, stage, stage_label, background_job_id, background_status_json,
                running_situation_ids_json, created_at, updated_at, completed_at, confirmed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                project_id = excluded.project_id,
                character_id = excluded.character_id,
                status = excluded.status,
                mode = excluded.mode,
                default_count = excluded.default_count,
                source_object_key = excluded.source_object_key,
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
            header.backgroundJobId ? 'background' : 'browser',
            header.defaultCount,
            canonicalObjectKey,
            header.status || '',
            header.stage || '',
            header.stageLabel || '',
            header.backgroundJobId || '',
            JSON.stringify(header.backgroundStatus || {}),
            JSON.stringify(header.runningSituationIds || []),
            header.createdAt || timestamp,
            timestamp,
            ['completed', 'confirmed'].includes(normalizeV2PlannerRunStatus(header.status)) ? timestamp : null,
            normalizeV2PlannerRunStatus(header.status) === 'confirmed' ? timestamp : null
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
        `).bind(objectKey, runId, objectKey === canonicalObjectKey ? 'canonical' : 'alias', timestamp, timestamp)
    ];
    if (currentPlannerItemIds.length) {
        const itemPlaceholders = currentPlannerItemIds.map(() => '?').join(',');
        statements.push(
            env.DB.prepare(`DELETE FROM v2_prompt_v4_rows WHERE prompt_set_id IN (SELECT id FROM v2_prompt_sets WHERE owner_type = ? AND owner_id IN (${itemPlaceholders}))`)
                .bind('planner_item', ...currentPlannerItemIds),
            env.DB.prepare(`DELETE FROM v2_prompt_parts WHERE prompt_set_id IN (SELECT id FROM v2_prompt_sets WHERE owner_type = ? AND owner_id IN (${itemPlaceholders}))`)
                .bind('planner_item', ...currentPlannerItemIds),
            env.DB.prepare(`DELETE FROM v2_prompt_sets WHERE owner_type = ? AND owner_id IN (${itemPlaceholders})`)
                .bind('planner_item', ...currentPlannerItemIds)
        );
    }

    const seenAssetIds = new Set();

    items.forEach((rawItem, index) => {
        const split = splitPlannerItemForDb(rawItem);
        const situationId = split.item.situationId || makeStableDbId('situation', `${objectKey}:${index}`);
        const itemId = makeStableDbId('pitem', `${objectKey}:${situationId}`);
        const promptSetId = makeStableDbId('prompt', itemId);
        const imageIds = [];
        split.images.forEach(imageKey => {
            const assetId = getAssetIdFromKey(imageKey);
            if (seenAssetIds.has(assetId)) return;
            seenAssetIds.add(assetId);
            imageIds.push({
                key: imageKey,
                assetId,
                generatedId: makeStableDbId('pgen', `${itemId}:${imageKey}`)
            });
        });
        const selected = imageIds.find(image => image.key === split.item.selectedImage);
        const confirmed = imageIds.find(image => image.key === split.item.finalImage);

        statements.push(
            env.DB.prepare(`
                INSERT INTO v2_situations (id, project_id, name, image_number, rating, sort_order, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'sfw', ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    project_id = excluded.project_id,
                    name = COALESCE(NULLIF(excluded.name, ''), v2_situations.name),
                    image_number = excluded.image_number,
                    sort_order = excluded.sort_order,
                    updated_at = excluded.updated_at
            `).bind(situationId, projectId, split.item.situationName || situationId, split.item.imageNumber || String(index + 1), index, timestamp, timestamp),
            env.DB.prepare(`
                INSERT INTO v2_planner_items (
                    id, planner_run_id, situation_id, image_number, status, target_count,
                    selected_generated_image_id, confirmed_asset_id, sort_order, ui_status, situation_index,
                    stage, stage_label, error_message, background_job_id, background_item_id, extra_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    planner_run_id = excluded.planner_run_id,
                    situation_id = excluded.situation_id,
                    image_number = excluded.image_number,
                    status = CASE
                        WHEN v2_planner_items.status IN ('done', 'confirmed')
                         AND excluded.status IN ('pending', 'running')
                         AND excluded.background_job_id = ''
                         AND excluded.background_item_id = ''
                        THEN v2_planner_items.status
                        ELSE excluded.status
                    END,
                    target_count = excluded.target_count,
                    selected_generated_image_id = COALESCE(excluded.selected_generated_image_id, v2_planner_items.selected_generated_image_id),
                    confirmed_asset_id = COALESCE(excluded.confirmed_asset_id, v2_planner_items.confirmed_asset_id),
                    sort_order = excluded.sort_order,
                    ui_status = CASE
                        WHEN v2_planner_items.ui_status IN ('done', 'confirmed')
                         AND excluded.ui_status IN ('pending', 'running')
                         AND excluded.background_job_id = ''
                         AND excluded.background_item_id = ''
                        THEN v2_planner_items.ui_status
                        ELSE excluded.ui_status
                    END,
                    situation_index = excluded.situation_index,
                    stage = COALESCE(NULLIF(excluded.stage, ''), v2_planner_items.stage),
                    stage_label = COALESCE(NULLIF(excluded.stage_label, ''), v2_planner_items.stage_label),
                    error_message = excluded.error_message,
                    background_job_id = COALESCE(NULLIF(excluded.background_job_id, ''), v2_planner_items.background_job_id),
                    background_item_id = COALESCE(NULLIF(excluded.background_item_id, ''), v2_planner_items.background_item_id),
                    extra_json = excluded.extra_json,
                    updated_at = excluded.updated_at
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
                split.item.status || '',
                split.item.situationIndex,
                split.item.stage || '',
                split.item.stageLabel || '',
                split.item.errorMessage || '',
                split.item.backgroundJobId || '',
                split.item.backgroundItemId || '',
                JSON.stringify(split.item.extra || {}),
                timestamp,
                timestamp
            ),
            env.DB.prepare(`
                INSERT INTO v2_prompt_sets (
                    id, owner_type, owner_id, kind, name, is_active, sort_order,
                    compiled_prompt_json, created_at, updated_at
                ) VALUES (?, 'planner_item', ?, 'snapshot', '', 1, 0, ?, ?, ?)
            `).bind(promptSetId, itemId, JSON.stringify(split.item.generation || {}), timestamp, timestamp)
        );

        split.v4Rows.forEach((row, rowIndex) => {
            statements.push(env.DB.prepare(`
                INSERT INTO v2_prompt_v4_rows (
                    id, prompt_set_id, row_index, subject, clothing, expression, action, negative
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                makeStableDbId('v4', `${promptSetId}:${rowIndex}`),
                promptSetId,
                rowIndex,
                row?.subject || '',
                row?.clothing || '',
                row?.expression || '',
                row?.action || '',
                row?.negative || ''
            ));
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
                `).bind(
                    image.generatedId,
                    itemId,
                    image.assetId,
                    imageIndex,
                    image.key === split.item.finalImage ? 'confirmed' : (image.key === split.item.selectedImage ? 'selected' : 'candidate'),
                    timestamp
                )
            );
            const snapshot = split.snapshots[image.key];
            if (snapshot) {
                statements.push(env.DB.prepare(`
                    INSERT INTO v2_asset_metadata (
                        asset_id, prompt, negative_prompt, metadata_json, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(asset_id) DO UPDATE SET
                        prompt = excluded.prompt,
                        negative_prompt = excluded.negative_prompt,
                        metadata_json = excluded.metadata_json,
                        updated_at = excluded.updated_at
                `).bind(
                    image.assetId,
                    snapshot.Prompt || '',
                    snapshot['Negative Prompt'] || '',
                    JSON.stringify(snapshot || {}),
                    timestamp,
                    timestamp
                ));
            }
        });
    });

    if (currentPlannerItemIds.length) {
        const itemPlaceholders = currentPlannerItemIds.map(() => '?').join(',');
        statements.push(env.DB.prepare(`
            DELETE FROM v2_planner_items
            WHERE planner_run_id = ?
              AND id NOT IN (${itemPlaceholders})
              AND id NOT IN (
                  SELECT planner_item_id
                  FROM v2_planner_generated_images
                  WHERE planner_item_id IS NOT NULL
              )
        `).bind(runId, ...currentPlannerItemIds));
    }

    for (let i = 0; i < statements.length; i += 50) {
        await env.DB.batch(statements.slice(i, i + 50));
    }
}

async function getV2PlannerMetaDocument(env, objectKey) {
    await ensureV2PlannerSourceSchema(env);
    const run = await env.DB.prepare(`
        SELECT
            r.*,
            p.prefix AS project_prefix,
            c.prefix AS character_prefix
        FROM v2_planner_runs r
        LEFT JOIN v2_projects p ON p.id = r.project_id
        LEFT JOIN v2_characters c ON c.id = r.character_id
        LEFT JOIN v2_planner_sources src ON src.planner_run_id = r.id
        WHERE r.source_object_key = ? OR src.source_key = ?
        LIMIT 1
    `).bind(objectKey, objectKey).first();
    if (!run) return null;

    const itemRows = (await env.DB.prepare(`
        SELECT
            i.*,
            s.name AS situation_name
        FROM v2_planner_items i
        LEFT JOIN v2_situations s ON s.id = i.situation_id
        WHERE i.planner_run_id = ?
        ORDER BY i.sort_order, i.image_number
    `).bind(run.id).all()).results || [];
    const itemIds = itemRows.map(row => row.id);
    const promptsByItem = new Map();
    const imagesByItem = new Map();
    const selectedByGeneratedId = new Map();
    const assetById = new Map();
    const v4ByPromptSet = new Map();

    itemRows.forEach(row => imagesByItem.set(row.id, []));
    if (itemIds.length) {
        const placeholders = itemIds.map(() => '?').join(',');
        const promptRows = (await env.DB.prepare(`
            SELECT * FROM v2_prompt_sets
            WHERE owner_type = 'planner_item'
              AND owner_id IN (${placeholders})
              AND kind = 'snapshot'
            ORDER BY owner_id, sort_order
        `).bind(...itemIds).all()).results || [];
        promptRows.forEach(row => {
            if (!promptsByItem.has(row.owner_id)) promptsByItem.set(row.owner_id, row);
            v4ByPromptSet.set(row.id, []);
        });
        const promptIds = promptRows.map(row => row.id);
        if (promptIds.length) {
            const promptPlaceholders = promptIds.map(() => '?').join(',');
            const v4Rows = (await env.DB.prepare(`
                SELECT * FROM v2_prompt_v4_rows
                WHERE prompt_set_id IN (${promptPlaceholders})
                ORDER BY prompt_set_id, row_index
            `).bind(...promptIds).all()).results || [];
            v4Rows.forEach(row => v4ByPromptSet.get(row.prompt_set_id)?.push({
                subject: row.subject || '',
                clothing: row.clothing || '',
                expression: row.expression || '',
                action: row.action || '',
                negative: row.negative || ''
            }));
        }
        const imageRows = (await env.DB.prepare(`
            SELECT pgi.*, a.r2_key, a.id AS resolved_asset_id
            FROM v2_planner_generated_images pgi
            JOIN v2_assets a ON a.id = pgi.asset_id
            WHERE pgi.planner_item_id IN (${placeholders})
            ORDER BY pgi.planner_item_id, pgi.image_index
        `).bind(...itemIds).all()).results || [];
        imageRows.forEach(row => {
            imagesByItem.get(row.planner_item_id)?.push(row.r2_key);
            selectedByGeneratedId.set(row.id, row.r2_key);
            assetById.set(row.resolved_asset_id, row.r2_key);
        });
    }

    const meta = {
        projectId: run.project_id || '',
        projectPrefix: run.project_prefix || '',
        characterId: run.character_id || '',
        characterPrefix: run.character_prefix || '',
        status: run.ui_status || run.status || 'draft',
        stage: run.stage || '',
        stageLabel: run.stage_label || '',
        defaultCount: run.default_count || 10,
        updatedAt: Date.parse(run.updated_at) || Date.now(),
        items: itemRows.map(row => {
            const prompt = promptsByItem.get(row.id);
            const generation = parseJsonField(prompt?.compiled_prompt_json, {});
            const v4Rows = prompt ? (v4ByPromptSet.get(prompt.id) || []) : [];
            generation.v4PromptCharacters = v4Rows;
            generation.v4_prompt = v4Rows;
            return {
                ...parseJsonField(row.extra_json, {}),
                situationId: row.situation_id,
                situationName: row.situation_name || row.situation_id,
                situationIndex: row.situation_index,
                imageNumber: row.image_number,
                count: row.target_count,
                status: row.ui_status || row.status,
                stage: row.stage || '',
                stageLabel: row.stage_label || '',
                selectedImage: selectedByGeneratedId.get(row.selected_generated_image_id) || null,
                finalImage: assetById.get(row.confirmed_asset_id) || null,
                errorMessage: row.error_message || '',
                backgroundJobId: row.background_job_id || undefined,
                backgroundItemId: row.background_item_id || undefined,
                generation,
                images: imagesByItem.get(row.id) || []
            };
        })
    };
    if (run.background_job_id) meta.backgroundJobId = run.background_job_id;
    const backgroundStatus = parseJsonField(run.background_status_json, {});
    if (Object.keys(backgroundStatus).length) meta.backgroundStatus = backgroundStatus;
    const runningSituationIds = parseJsonField(run.running_situation_ids_json, []);
    if (runningSituationIds.length) meta.runningSituationIds = runningSituationIds;
    return meta;
}

async function deleteV2PlannerMetaDocument(env, objectKey) {
    await ensureV2PlannerSourceSchema(env);
    const run = await env.DB.prepare(`
        SELECT r.id
        FROM v2_planner_runs r
        LEFT JOIN v2_planner_sources src ON src.planner_run_id = r.id
        WHERE r.source_object_key = ? OR src.source_key = ?
        LIMIT 1
    `).bind(objectKey, objectKey).first();
    if (!run?.id) return;
    const timestamp = nowIso();
    await env.DB.batch([
        env.DB.prepare(`
            DELETE FROM v2_generation_queue
            WHERE generation_job_item_id IN (
                SELECT gji.id
                FROM v2_generation_job_items gji
                LEFT JOIN v2_generation_jobs gj ON gj.id = gji.generation_job_id
                WHERE gj.planner_run_id = ?
                   OR gji.planner_item_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id = ?)
            )
        `).bind(run.id, run.id),
        env.DB.prepare(`
            DELETE FROM v2_generation_job_items
            WHERE generation_job_id IN (SELECT id FROM v2_generation_jobs WHERE planner_run_id = ?)
               OR planner_item_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id = ?)
        `).bind(run.id, run.id),
        env.DB.prepare('DELETE FROM v2_generation_jobs WHERE planner_run_id = ?').bind(run.id),
        env.DB.prepare(`
            UPDATE v2_assets
            SET status = 'deleted',
                deleted_at = COALESCE(deleted_at, ?),
                updated_at = ?
            WHERE owner_type = ?
              AND owner_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id = ?)
              AND status <> 'deleted'
        `).bind(timestamp, timestamp, 'planner_item', run.id),
        env.DB.prepare('DELETE FROM v2_prompt_v4_rows WHERE prompt_set_id IN (SELECT id FROM v2_prompt_sets WHERE owner_type = ? AND owner_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id = ?))')
            .bind('planner_item', run.id),
        env.DB.prepare('DELETE FROM v2_prompt_parts WHERE prompt_set_id IN (SELECT id FROM v2_prompt_sets WHERE owner_type = ? AND owner_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id = ?))')
            .bind('planner_item', run.id),
        env.DB.prepare('DELETE FROM v2_prompt_sets WHERE owner_type = ? AND owner_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id = ?)')
            .bind('planner_item', run.id),
        env.DB.prepare('DELETE FROM v2_planner_generated_images WHERE planner_item_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id = ?)')
            .bind(run.id),
        env.DB.prepare('DELETE FROM v2_planner_items WHERE planner_run_id = ?').bind(run.id),
        env.DB.prepare('DELETE FROM v2_planner_sources WHERE planner_run_id = ?').bind(run.id),
        env.DB.prepare('DELETE FROM v2_planner_runs WHERE id = ?').bind(run.id)
    ]);
}

async function cleanupDeletedAssets(env, olderThanHours = 24, limit = 100) {
    if (!env.DB) throw new Error('DB binding is not configured');
    if (!env.imgBucket) throw new Error('imgBucket binding is not configured');
    const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 100));
    const safeHours = Math.max(0, Number.parseFloat(olderThanHours) || 0);
    const cutoff = toKstIso(new Date(Date.now() - safeHours * 60 * 60 * 1000));
    const rows = (await env.DB.prepare(`
        SELECT id, r2_key
        FROM v2_assets
        WHERE status = 'deleted'
          AND deleted_at IS NOT NULL
          AND deleted_at < ?
        ORDER BY deleted_at
        LIMIT ?
    `).bind(cutoff, safeLimit).all()).results || [];
    const deleted = [];
    const failed = [];
    for (const row of rows) {
        try {
            await env.imgBucket.delete(row.r2_key);
            await env.DB.prepare('DELETE FROM v2_assets WHERE id = ? AND status = ?').bind(row.id, 'deleted').run();
            deleted.push(row.id);
        } catch (error) {
            failed.push({ id: row.id, error: error?.message || String(error) });
        }
    }
    return {
        scanned: rows.length,
        deletedCount: deleted.length,
        failedCount: failed.length,
        deleted,
        failed
    };
}

async function migrateR2JsonStateToDb(env, limit = 500, cursor = undefined) {
    if (!env.DB) throw new Error('DB binding is not configured');
    if (!env.imgBucket) throw new Error('imgBucket binding is not configured');
    await ensureJsonDbSchema(env);
    const safeLimit = Math.min(1000, Math.max(1, Number.parseInt(limit, 10) || 500));
    const listed = await env.imgBucket.list({ limit: safeLimit, cursor });
    const imported = [];
    const skipped = [];
    for (const object of listed.objects || []) {
        const key = object.key || '';
        let docType = '';
        if (key.endsWith('_planner_meta.json')) {
            skipped.push({ key, reason: 'planner_meta_import_disabled' });
            continue;
        }
        if (key.endsWith('_character_meta.json')) docType = 'character_meta';
        else if (key.endsWith('_situations_meta.json')) docType = 'situations_meta';
        else if (key.endsWith('_planner_settings.json')) docType = 'planner_settings';
        else if (key.endsWith('_meta.json')) docType = 'file_metadata';
        else if (key === '.imggul_aliases.json') docType = 'aliases_global';
        else if (key.endsWith('/.aliases.json')) docType = 'aliases_project';
        else {
            skipped.push({ key, reason: 'unsupported_json_state' });
            continue;
        }
        const data = await readR2Json(env, key, null);
        if (data === null || data === undefined) {
            skipped.push({ key, reason: 'invalid_json' });
            continue;
        }
        if (docType === 'file_metadata') {
            const folderPrefix = key.slice(0, -'_meta.json'.length);
            const timestamp = nowIso();
            const rows = Object.entries(data || {});
            for (const [fileName, metadata] of rows) {
                await env.DB.prepare(`
                    INSERT INTO file_metadata (folder_prefix, file_name, metadata_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(folder_prefix, file_name) DO UPDATE SET
                        metadata_json = excluded.metadata_json,
                        updated_at = excluded.updated_at
                `).bind(folderPrefix, fileName, JSON.stringify(metadata || {}), timestamp, timestamp).run();
            }
            imported.push({ key, docType, rows: rows.length });
            continue;
        }
        if (docType === 'aliases_global' || docType === 'aliases_project') {
            const projectName = docType === 'aliases_project' ? key.split('/')[0] : '';
            const scope = docType === 'aliases_project' ? 'project' : 'global';
            const entries = Object.entries(data || {});
            for (const [targetKey, alias] of entries) {
                await putDbAlias(env, scope, projectName, targetKey, alias);
            }
            imported.push({ key, docType, rows: entries.length });
            continue;
        }
        await putJsonDocument(env, docType, key, data, 'r2_import');
        imported.push({ key, docType, rows: 1 });
    }
    return {
        importedCount: imported.length,
        skippedCount: skipped.length,
        imported,
        skipped,
        truncated: !!listed.truncated,
        cursor: listed.cursor || ''
    };
}

async function cleanupLegacyPlannerState(env, limit = 500, cursor = undefined, options = {}) {
    if (!env.DB) throw new Error('DB binding is not configured');
    if (!env.imgBucket) throw new Error('imgBucket binding is not configured');
    await ensureJsonDbSchema(env);
    await ensurePlannerMetaSchema(env);
    const cleanupBackground = options.cleanupBackground !== false;
    const forceBackground = options.forceBackground === true;
    const timestamp = nowIso();
    const legacyMetaRows = (await env.DB.prepare('SELECT COUNT(*) AS count FROM planner_metas').first()) || {};
    const legacyPlannerJsonRows = (await env.DB.prepare("SELECT COUNT(*) AS count FROM json_documents WHERE doc_type = 'planner_meta'").first()) || {};
    const legacyV2Runs = (await env.DB.prepare(`
        SELECT id
        FROM v2_planner_runs
        WHERE source_object_key LIKE '%_planner_temp_image/_planner_meta.json'
    `).all()).results || [];
    const legacyV2RunIds = legacyV2Runs.map(row => row.id).filter(Boolean);
    if (legacyV2RunIds.length) {
        const placeholders = legacyV2RunIds.map(() => '?').join(',');
        await env.DB.batch([
            env.DB.prepare(`
                DELETE FROM v2_generation_queue
                WHERE generation_job_item_id IN (
                    SELECT gji.id
                    FROM v2_generation_job_items gji
                    LEFT JOIN v2_generation_jobs gj ON gj.id = gji.generation_job_id
                    WHERE gj.planner_run_id IN (${placeholders})
                       OR gji.planner_item_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id IN (${placeholders}))
                )
            `).bind(...legacyV2RunIds, ...legacyV2RunIds),
            env.DB.prepare(`
                DELETE FROM v2_generation_job_items
                WHERE generation_job_id IN (SELECT id FROM v2_generation_jobs WHERE planner_run_id IN (${placeholders}))
                   OR planner_item_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id IN (${placeholders}))
            `).bind(...legacyV2RunIds, ...legacyV2RunIds),
            env.DB.prepare(`DELETE FROM v2_generation_jobs WHERE planner_run_id IN (${placeholders})`).bind(...legacyV2RunIds),
            env.DB.prepare(`
                UPDATE v2_assets
                SET status = 'deleted',
                    deleted_at = COALESCE(deleted_at, ?),
                    updated_at = ?
                WHERE owner_type = 'planner_item'
                  AND owner_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id IN (${placeholders}))
                  AND status <> 'deleted'
            `).bind(timestamp, timestamp, ...legacyV2RunIds),
            env.DB.prepare(`DELETE FROM v2_prompt_v4_rows WHERE prompt_set_id IN (SELECT id FROM v2_prompt_sets WHERE owner_type = 'planner_item' AND owner_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id IN (${placeholders})))`).bind(...legacyV2RunIds),
            env.DB.prepare(`DELETE FROM v2_prompt_parts WHERE prompt_set_id IN (SELECT id FROM v2_prompt_sets WHERE owner_type = 'planner_item' AND owner_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id IN (${placeholders})))`).bind(...legacyV2RunIds),
            env.DB.prepare(`DELETE FROM v2_prompt_sets WHERE owner_type = 'planner_item' AND owner_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id IN (${placeholders}))`).bind(...legacyV2RunIds),
            env.DB.prepare(`DELETE FROM v2_planner_generated_images WHERE planner_item_id IN (SELECT id FROM v2_planner_items WHERE planner_run_id IN (${placeholders}))`).bind(...legacyV2RunIds),
            env.DB.prepare(`DELETE FROM v2_planner_items WHERE planner_run_id IN (${placeholders})`).bind(...legacyV2RunIds),
            env.DB.prepare(`DELETE FROM v2_planner_sources WHERE planner_run_id IN (${placeholders})`).bind(...legacyV2RunIds),
            env.DB.prepare(`DELETE FROM v2_planner_runs WHERE id IN (${placeholders})`).bind(...legacyV2RunIds)
        ]);
    }
    const backgroundTables = (await env.DB.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('planner_background_jobs', 'planner_background_items', 'planner_background_queue', 'planner_background_rate_limits')
    `).all()).results || [];
    const backgroundTableNames = new Set(backgroundTables.map(row => row.name));
    const hasBackgroundJobTables = backgroundTableNames.has('planner_background_jobs')
        && backgroundTableNames.has('planner_background_items')
        && backgroundTableNames.has('planner_background_queue');
    let legacyBackgroundJobCount = 0;
    let deletedLegacyBackgroundJobCount = 0;
    let skippedActiveLegacyBackgroundJobCount = 0;
    if (cleanupBackground && hasBackgroundJobTables) {
        const terminalStatuses = ['completed', 'partial_failed', 'failed'];
        const terminalPlaceholders = terminalStatuses.map(() => '?').join(',');
        const totalBackgroundRows = (await env.DB.prepare('SELECT COUNT(*) AS count FROM planner_background_jobs').first()) || {};
        legacyBackgroundJobCount = totalBackgroundRows.count || 0;
        if (forceBackground) {
            deletedLegacyBackgroundJobCount = legacyBackgroundJobCount;
            const statements = [
                env.DB.prepare('DELETE FROM planner_background_queue'),
                env.DB.prepare('DELETE FROM planner_background_items'),
                env.DB.prepare('DELETE FROM planner_background_jobs')
            ];
            if (backgroundTableNames.has('planner_background_rate_limits')) {
                statements.push(env.DB.prepare('DELETE FROM planner_background_rate_limits'));
            }
            await env.DB.batch(statements);
        } else {
            const terminalRows = (await env.DB.prepare(`SELECT COUNT(*) AS count FROM planner_background_jobs WHERE status IN (${terminalPlaceholders})`).bind(...terminalStatuses).first()) || {};
            const activeRows = (await env.DB.prepare(`SELECT COUNT(*) AS count FROM planner_background_jobs WHERE status NOT IN (${terminalPlaceholders})`).bind(...terminalStatuses).first()) || {};
            deletedLegacyBackgroundJobCount = terminalRows.count || 0;
            skippedActiveLegacyBackgroundJobCount = activeRows.count || 0;
            await env.DB.batch([
                env.DB.prepare(`DELETE FROM planner_background_queue WHERE job_id IN (SELECT id FROM planner_background_jobs WHERE status IN (${terminalPlaceholders}))`).bind(...terminalStatuses),
                env.DB.prepare(`DELETE FROM planner_background_items WHERE job_id IN (SELECT id FROM planner_background_jobs WHERE status IN (${terminalPlaceholders}))`).bind(...terminalStatuses),
                env.DB.prepare(`DELETE FROM planner_background_jobs WHERE status IN (${terminalPlaceholders})`).bind(...terminalStatuses)
            ]);
        }
    }
    await env.DB.batch([
        env.DB.prepare("DELETE FROM v2_planner_sources WHERE source_key LIKE '%_planner_temp_image/_planner_meta.json'"),
        env.DB.prepare('DELETE FROM planner_item_image_snapshots'),
        env.DB.prepare('DELETE FROM planner_item_images'),
        env.DB.prepare('DELETE FROM planner_item_v4_rows'),
        env.DB.prepare('DELETE FROM planner_items'),
        env.DB.prepare('DELETE FROM planner_metas'),
        env.DB.prepare("DELETE FROM json_documents WHERE doc_type = 'planner_meta'")
    ]);
    const safeLimit = Math.min(1000, Math.max(1, Number.parseInt(limit, 10) || 500));
    const listed = await env.imgBucket.list({ limit: safeLimit, cursor });
    const deletedPlannerJson = [];
    for (const object of listed.objects || []) {
        const key = object.key || '';
        if (!key.endsWith('_planner_meta.json')) continue;
        await env.imgBucket.delete(key);
        deletedPlannerJson.push(key);
    }
    return {
        deletedJsonDocuments: true,
        deletedLegacyPlannerMetaCount: legacyMetaRows.count || 0,
        deletedLegacyPlannerJsonDocumentCount: legacyPlannerJsonRows.count || 0,
        deletedLegacyV2PlannerRunCount: legacyV2RunIds.length,
        cleanupBackground,
        forceBackground,
        legacyBackgroundJobCount,
        deletedLegacyBackgroundJobCount,
        skippedActiveLegacyBackgroundJobCount,
        deletedPlannerJsonCount: deletedPlannerJson.length,
        deletedPlannerJson,
        truncated: !!listed.truncated,
        cursor: listed.cursor || ''
    };
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
        updatedAt,
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
            defaultCount: Number.parseInt(defaultCount || 10, 10) || 10,
            backgroundJobId: backgroundJobId || '',
            backgroundStatus: backgroundStatus || {},
            runningSituationIds: Array.isArray(runningSituationIds) ? runningSituationIds : [],
            extra,
            createdAt,
            updatedAt
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
            count: Number.parseInt(count || 10, 10) || 10,
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

async function putPlannerMetaDocument(env, objectKey, meta = {}) {
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
    await ensureJsonDbSchema(env);
    await env.DB.prepare(
        'DELETE FROM json_documents WHERE doc_type = ? AND object_key = ?'
    ).bind('planner_meta', objectKey).run();
}

async function plannerBackgroundTablesExist(env) {
    const rows = await env.DB.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('planner_background_jobs', 'planner_background_items')
    `).all();
    return (rows.results || []).length >= 2;
}

function compactBackgroundResultKeys(value) {
    const parsed = parseJsonField(value, []);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
}

async function getActivePlannerBackgroundMeta(env, objectKey, baseMeta = null) {
    if (!await plannerBackgroundTablesExist(env)) return null;
    const identity = getPlannerIdentityFromKey(objectKey);
    const projectPrefix = baseMeta?.projectPrefix || identity.projectPrefix;
    const characterId = baseMeta?.characterId || identity.characterId;
    if (!projectPrefix) return null;
    const statuses = ['queued', 'running', 'cancel_requested', 'paused'];
    const placeholders = statuses.map(() => '?').join(',');
    const params = characterId
        ? [projectPrefix, characterId, ...statuses]
        : [projectPrefix, ...statuses];
    const job = await env.DB.prepare(`
        SELECT *
        FROM planner_background_jobs
        WHERE project_prefix = ?
          ${characterId ? 'AND character_id = ?' : ''}
          AND status IN (${placeholders})
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
    `).bind(...params).first();
    if (!job) return null;

    const rows = (await env.DB.prepare(`
        SELECT *
        FROM planner_background_items
        WHERE job_id = ?
        ORDER BY
          CASE WHEN queue_order IS NULL THEN 1 ELSE 0 END,
          queue_order ASC,
          image_number ASC
    `).bind(job.id).all()).results || [];
    const baseItemsBySituation = new Map((baseMeta?.items || []).map(item => [item.situationId, item]));
    const items = rows.map((row, index) => {
        const baseItem = baseItemsBySituation.get(row.situation_id) || {};
        const resultKeys = compactBackgroundResultKeys(row.result_keys);
        const generation = parseJsonField(row.generation_json, {});
        const nextStatus = row.status === 'completed' ? 'done' : (row.status || 'pending');
        return {
            ...baseItem,
            situationId: row.situation_id,
            situationName: row.situation_name || row.situation_id,
            situationIndex: baseItem.situationIndex ?? index,
            imageNumber: row.image_number,
            count: row.count || baseItem.count || 10,
            status: nextStatus,
            stage: row.stage || '',
            stageLabel: row.stage || '',
            failedCount: row.failed_count || 0,
            selectedImage: resultKeys.includes(baseItem.selectedImage) ? baseItem.selectedImage : null,
            errorMessage: row.error_message || '',
            backgroundJobId: job.id,
            backgroundItemId: row.id,
            generation: Object.keys(generation).length ? generation : (baseItem.generation || {}),
            images: resultKeys.length ? resultKeys : (baseItem.images || [])
        };
    });
    return {
        ...(baseMeta || {}),
        projectId: job.project_id || baseMeta?.projectId || '',
        projectPrefix: job.project_prefix || projectPrefix,
        characterId: job.character_id || characterId,
        characterPrefix: job.character_prefix || baseMeta?.characterPrefix || '',
        status: job.status,
        stage: job.stage || '',
        stageLabel: job.stage || '',
        defaultCount: baseMeta?.defaultCount || items[0]?.count || 10,
        backgroundJobId: job.id,
        backgroundStatus: {
            jobId: job.id,
            status: job.status,
            stage: job.stage || '',
            totalCount: job.total_count || 0,
            completedCount: job.completed_count || 0,
            failedCount: job.failed_count || 0,
            updatedAt: job.updated_at || ''
        },
        runningSituationIds: items.map(item => item.situationId).filter(Boolean),
        updatedAt: Date.now(),
        items
    };
}

async function getPlannerMetaDocument(env, objectKey, fallbackKey = objectKey) {
    const v2Meta = await getV2PlannerMetaDocument(env, objectKey);
    if (v2Meta) {
        const activeBackgroundMeta = await getActivePlannerBackgroundMeta(env, objectKey, v2Meta);
        if (activeBackgroundMeta) {
            await putPlannerMetaDocument(env, objectKey, activeBackgroundMeta);
            return activeBackgroundMeta;
        }
        return v2Meta;
    }
    const activeBackgroundMeta = await getActivePlannerBackgroundMeta(env, objectKey, null);
    if (activeBackgroundMeta) {
        await putPlannerMetaDocument(env, objectKey, activeBackgroundMeta);
        return activeBackgroundMeta;
    }
    return null;
}

async function getLegacyPlannerMetaDocument(env, objectKey) {
    await ensurePlannerMetaSchema(env);
    const header = await env.DB.prepare('SELECT * FROM planner_metas WHERE object_key = ?').bind(objectKey).first();
    if (!header) return null;
    const itemRows = (await env.DB.prepare('SELECT * FROM planner_items WHERE meta_object_key = ? ORDER BY sort_order, image_number').bind(objectKey).all()).results || [];
    const itemIds = itemRows.map(row => row.id);
    const v4ByItem = new Map();
    const imagesByItem = new Map();
    const snapshotsByItem = new Map();
    for (const row of itemRows) {
        v4ByItem.set(row.id, []);
        imagesByItem.set(row.id, []);
        snapshotsByItem.set(row.id, {});
    }
    if (itemIds.length) {
        const placeholders = itemIds.map(() => '?').join(',');
        const v4Rows = (await env.DB.prepare(`SELECT * FROM planner_item_v4_rows WHERE item_id IN (${placeholders}) ORDER BY item_id, row_index`).bind(...itemIds).all()).results || [];
        v4Rows.forEach(row => v4ByItem.get(row.item_id)?.push({
            subject: row.subject || '',
            clothing: row.clothing || '',
            expression: row.expression || '',
            action: row.action || '',
            negative: row.negative || ''
        }));
        const imageRows = (await env.DB.prepare(`SELECT * FROM planner_item_images WHERE item_id IN (${placeholders}) ORDER BY item_id, sort_order`).bind(...itemIds).all()).results || [];
        imageRows.forEach(row => imagesByItem.get(row.item_id)?.push(row.image_key));
        const snapshotRows = (await env.DB.prepare(`SELECT * FROM planner_item_image_snapshots WHERE item_id IN (${placeholders})`).bind(...itemIds).all()).results || [];
        snapshotRows.forEach(row => {
            const snapshots = snapshotsByItem.get(row.item_id);
            if (snapshots) snapshots[row.image_key] = parseJsonField(row.snapshot_json, {});
        });
    }
    const meta = {
        ...parseJsonField(header.extra_json, {}),
        projectId: header.project_id || '',
        projectPrefix: header.project_prefix || '',
        characterId: header.character_id || '',
        characterPrefix: header.character_prefix || '',
        status: header.status || 'draft',
        stage: header.stage || '',
        stageLabel: header.stage_label || '',
        defaultCount: header.default_count || 10,
        updatedAt: Date.parse(header.updated_at) || Date.now(),
        items: itemRows.map(row => {
            const generation = parseJsonField(row.generation_json, {});
            const v4Rows = v4ByItem.get(row.id) || [];
            generation.v4PromptCharacters = v4Rows;
            generation.v4_prompt = v4Rows;
            const snapshots = snapshotsByItem.get(row.id) || {};
            return {
                ...parseJsonField(row.extra_json, {}),
                situationId: row.situation_id,
                situationName: row.situation_name,
                situationIndex: row.situation_index,
                imageNumber: row.image_number,
                count: row.count,
                status: row.status,
                stage: row.stage,
                stageLabel: row.stage_label,
                selectedImage: row.selected_image || null,
                finalImage: row.final_image || null,
                errorMessage: row.error_message || '',
                backgroundJobId: row.background_job_id || undefined,
                backgroundItemId: row.background_item_id || undefined,
                generation,
                images: imagesByItem.get(row.id) || [],
                imagePromptSnapshots: Object.keys(snapshots).length ? snapshots : undefined
            };
        })
    };
    if (header.background_job_id) meta.backgroundJobId = header.background_job_id;
    const backgroundStatus = parseJsonField(header.background_status_json, {});
    if (Object.keys(backgroundStatus).length) meta.backgroundStatus = backgroundStatus;
    const runningSituationIds = parseJsonField(header.running_situation_ids_json, []);
    if (runningSituationIds.length) meta.runningSituationIds = runningSituationIds;
    return meta;
}

async function deletePlannerMetaDocument(env, objectKey, fallbackKey = objectKey) {
    await ensurePlannerMetaSchema(env);
    await deleteV2PlannerMetaDocument(env, objectKey);
    await env.DB.batch([
        env.DB.prepare('DELETE FROM planner_item_image_snapshots WHERE item_id IN (SELECT id FROM planner_items WHERE meta_object_key = ?)').bind(objectKey),
        env.DB.prepare('DELETE FROM planner_item_images WHERE item_id IN (SELECT id FROM planner_items WHERE meta_object_key = ?)').bind(objectKey),
        env.DB.prepare('DELETE FROM planner_item_v4_rows WHERE item_id IN (SELECT id FROM planner_items WHERE meta_object_key = ?)').bind(objectKey),
        env.DB.prepare('DELETE FROM planner_items WHERE meta_object_key = ?').bind(objectKey),
        env.DB.prepare('DELETE FROM planner_metas WHERE object_key = ?').bind(objectKey),
        env.DB.prepare('DELETE FROM json_documents WHERE doc_type = ? AND object_key = ?').bind('planner_meta', objectKey)
    ]);
    if (fallbackKey) await env.imgBucket.delete(fallbackKey).catch(() => null);
}

async function getDbAliases(env, scope, projectName = '') {
    await ensureJsonDbSchema(env);
    const rows = await env.DB.prepare(
        'SELECT target_key, alias FROM aliases WHERE scope = ? AND project_name = ?'
    ).bind(scope, projectName || '').all();
    return Object.fromEntries((rows.results || []).map(row => [row.target_key, row.alias]));
}

async function putDbAlias(env, scope, projectName, targetKey, alias) {
    await ensureJsonDbSchema(env);
    if (!alias) {
        await env.DB.prepare(
            'DELETE FROM aliases WHERE scope = ? AND project_name = ? AND target_key = ?'
        ).bind(scope, projectName || '', targetKey).run();
        return;
    }
    const timestamp = nowIso();
    await env.DB.prepare(`
        INSERT INTO aliases (scope, project_name, target_key, alias, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope, project_name, target_key) DO UPDATE SET
            alias = excluded.alias,
            updated_at = excluded.updated_at
    `).bind(scope, projectName || '', targetKey, alias, timestamp, timestamp).run();
}

async function deleteAliasPrefix(env, prefix) {
    await ensureJsonDbSchema(env);
    const parts = String(prefix || '').split('/').filter(Boolean);
    if (parts.length === 1) {
        await env.DB.prepare(
            'DELETE FROM aliases WHERE scope = ? AND project_name = ? AND target_key = ?'
        ).bind('global', '', prefix).run();
    } else if (parts.length > 1) {
        await env.DB.prepare(
            'DELETE FROM aliases WHERE scope = ? AND project_name = ? AND target_key = ?'
        ).bind('project', parts[0], parts[parts.length - 1]).run();
    }
}

async function moveAliasPrefix(env, oldPrefix, newPrefix) {
    await ensureJsonDbSchema(env);
    const oldParts = String(oldPrefix || '').split('/').filter(Boolean);
    const newParts = String(newPrefix || '').split('/').filter(Boolean);
    if (oldParts.length === 1 && newParts.length === 1) {
        await env.DB.prepare(`
            UPDATE aliases SET target_key = ?, updated_at = ?
            WHERE scope = ? AND project_name = ? AND target_key = ?
        `).bind(newPrefix, nowIso(), 'global', '', oldPrefix).run();
    } else if (oldParts.length > 1 && newParts.length > 1 && oldParts[0] === newParts[0]) {
        await env.DB.prepare(`
            UPDATE aliases SET target_key = ?, updated_at = ?
            WHERE scope = ? AND project_name = ? AND target_key = ?
        `).bind(newParts[newParts.length - 1], nowIso(), 'project', oldParts[0], oldParts[oldParts.length - 1]).run();
    }
}

async function ensureImageEditorSchema(env) {
    await ensureJsonDbSchema(env);
    await env.DB.batch([
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS image_editor_documents (
                id TEXT PRIMARY KEY,
                source_key TEXT NOT NULL,
                output_key TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'draft',
                document_json_key TEXT NOT NULL,
                preview_key TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                saved_at TEXT NOT NULL DEFAULT '',
                extra_json TEXT NOT NULL DEFAULT '{}'
            )
        `),
        env.DB.prepare(`
            CREATE INDEX IF NOT EXISTS idx_image_editor_documents_source
            ON image_editor_documents(source_key, updated_at)
        `),
        env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS image_editor_revisions (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                revision_number INTEGER NOT NULL,
                document_json_key TEXT NOT NULL,
                created_at TEXT NOT NULL,
                summary_json TEXT NOT NULL DEFAULT '{}'
            )
        `)
    ]);
}

function normalizeR2Key(key = '') {
    return String(key || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/{2,}/g, '/')
        .trim();
}

function isSafeR2Key(key = '') {
    const value = normalizeR2Key(key);
    if (!value || value.includes('..') || /[\x00-\x1f\x7f]/.test(value)) return false;
    if (value.startsWith('__editor_sessions/') || value.startsWith('__editor_backups/')) return false;
    const fileName = splitPath(value).fileName;
    if (!fileName || ['_meta.json', '.aliases.json', '.memos.json'].some(name => fileName.endsWith(name))) return false;
    return true;
}

function isEditableImageKey(key = '') {
    return /\.(png|jpe?g|webp)$/i.test(String(key || ''));
}

function makeEditorRevisionId(documentId = '') {
    const parts = getKstDateParts();
    return `rev_${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}${parts.second}_${Date.now().toString(36)}`;
}

async function readFileMetadata(env, key = '') {
    await ensureJsonDbSchema(env);
    const { prefix, fileName } = splitPath(key);
    const names = [fileName];
    const baseName = fileName.replace(/\.[^/.]+$/, '');
    for (const ext of ['.png', '.webp', '.jpg', '.jpeg']) {
        const fallbackName = baseName + ext;
        if (!names.includes(fallbackName)) names.push(fallbackName);
    }
    const placeholders = names.map(() => '?').join(',');
    const row = await env.DB.prepare(
        `SELECT metadata_json FROM file_metadata WHERE folder_prefix = ? AND file_name IN (${placeholders}) ORDER BY CASE file_name WHEN ? THEN 0 ELSE 1 END LIMIT 1`
    ).bind(prefix, ...names, fileName).first();
    return row?.metadata_json ? JSON.parse(row.metadata_json) : {};
}

async function putFileMetadataForKey(env, key = '', metadata = {}) {
    await ensureJsonDbSchema(env);
    const { prefix, fileName } = splitPath(key);
    const timestamp = nowIso();
    await env.DB.prepare(`
        INSERT INTO file_metadata (folder_prefix, file_name, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(folder_prefix, file_name) DO UPDATE SET
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
    `).bind(prefix, fileName, JSON.stringify(metadata || {}), timestamp, timestamp).run();
}

function buildEditedMetadata(baseMetadata = {}, { sourceKey, outputKey, documentId, operationsSummary = [] } = {}) {
    return {
        ...(baseMetadata || {}),
        edited: true,
        editorVersion: 1,
        sourceKey,
        savedAsKey: outputKey,
        derivedFromKey: outputKey === sourceKey ? (baseMetadata?.derivedFromKey || sourceKey) : sourceKey,
        editorDocumentId: documentId,
        editedAt: nowIso(),
        operationsSummary
    };
}

async function saveEditorDocumentRecord(env, document, status = 'draft', savedAt = '') {
    await ensureImageEditorSchema(env);
    const timestamp = nowIso();
    const documentId = String(document?.documentId || '').trim();
    if (!documentId) throw new Error('documentId is required');
    const documentJsonKey = `__editor_sessions/${documentId}/document.json`;
    await env.imgBucket.put(documentJsonKey, JSON.stringify(document || {}), {
        httpMetadata: { contentType: 'application/json; charset=UTF-8' }
    });
    const existing = await env.DB.prepare('SELECT id, created_at FROM image_editor_documents WHERE id = ?').bind(documentId).first();
    await env.DB.prepare(`
        INSERT INTO image_editor_documents (
            id, source_key, output_key, status, document_json_key, preview_key,
            created_at, updated_at, saved_at, extra_json
        ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, '{}')
        ON CONFLICT(id) DO UPDATE SET
            source_key = excluded.source_key,
            output_key = excluded.output_key,
            status = excluded.status,
            document_json_key = excluded.document_json_key,
            updated_at = excluded.updated_at,
            saved_at = excluded.saved_at
    `).bind(
        documentId,
        document.sourceKey || '',
        document.outputKey || '',
        status,
        documentJsonKey,
        existing?.created_at || timestamp,
        timestamp,
        savedAt
    ).run();
    return { documentId, documentJsonKey };
}

async function getEditorDocumentById(env, documentId = '') {
    await ensureImageEditorSchema(env);
    const row = await env.DB.prepare('SELECT * FROM image_editor_documents WHERE id = ?').bind(documentId).first();
    if (!row) return null;
    const object = await env.imgBucket.get(row.document_json_key);
    return {
        row,
        document: object ? await object.json() : null
    };
}

async function getLatestEditorDocumentForSource(env, sourceKey = '') {
    await ensureImageEditorSchema(env);
    const row = await env.DB.prepare(`
        SELECT * FROM image_editor_documents
        WHERE source_key = ? AND status IN ('draft', 'saved')
        ORDER BY updated_at DESC
        LIMIT 1
    `).bind(sourceKey).first();
    if (!row) return null;
    const object = await env.imgBucket.get(row.document_json_key);
    return {
        row,
        document: object ? await object.json() : null
    };
}

async function saveImageEditorOutput(env, { sourceKey, outputKey, documentId, document, blob, operationsSummary = [], overwrite = false } = {}) {
    sourceKey = normalizeR2Key(sourceKey);
    outputKey = normalizeR2Key(outputKey || sourceKey);
    if (!isSafeR2Key(sourceKey) || !isEditableImageKey(sourceKey)) throw new Error('Invalid source key');
    if (!isSafeR2Key(outputKey) || !outputKey.toLowerCase().endsWith('.webp')) throw new Error('Invalid output key');

    const sourceObject = await env.imgBucket.get(sourceKey);
    if (!sourceObject) throw new Error('Source image not found');

    const revisionId = makeEditorRevisionId(documentId);
    const backupBase = `__editor_backups/${documentId || 'unknown'}/${revisionId}`;
    const originalBackupKey = `${backupBase}/original`;
    const metadataBackupKey = `${backupBase}/metadata.json`;
    const sourceDbMetadata = await readFileMetadata(env, sourceKey);
    const metadataSnapshot = {
        sourceKey,
        outputKey,
        documentId,
        revisionId,
        createdAt: nowIso(),
        originalContentType: sourceObject.httpMetadata?.contentType || '',
        originalCustomMetadata: sourceObject.customMetadata || {},
        fileMetadata: sourceDbMetadata
    };

    await env.imgBucket.put(originalBackupKey, sourceObject.body, {
        httpMetadata: sourceObject.httpMetadata,
        customMetadata: sourceObject.customMetadata
    });
    await env.imgBucket.put(metadataBackupKey, JSON.stringify(metadataSnapshot), {
        httpMetadata: { contentType: 'application/json; charset=UTF-8' }
    });

    const mergedCustomMetadata = {
        ...(sourceObject.customMetadata || {}),
        ispublic: (sourceObject.customMetadata?.ispublic === 'true') ? 'true' : 'false',
        edited: 'true',
        editorDocumentId: documentId || '',
        derivedFromKey: sourceKey
    };
    await env.imgBucket.put(outputKey, blob, {
        httpMetadata: { contentType: 'image/webp' },
        customMetadata: mergedCustomMetadata
    });

    const editedMetadata = buildEditedMetadata(sourceDbMetadata, {
        sourceKey,
        outputKey,
        documentId,
        operationsSummary
    });
    await putFileMetadataForKey(env, outputKey, editedMetadata);

    if (document?.documentId) {
        document.outputKey = outputKey;
        await saveEditorDocumentRecord(env, document, 'saved', nowIso());
        await env.DB.prepare(`
            INSERT INTO image_editor_revisions (id, document_id, revision_number, document_json_key, created_at, summary_json)
            VALUES (?, ?, COALESCE((SELECT MAX(revision_number) + 1 FROM image_editor_revisions WHERE document_id = ?), 1), ?, ?, ?)
        `).bind(
            revisionId,
            document.documentId,
            document.documentId,
            `__editor_sessions/${document.documentId}/document.json`,
            nowIso(),
            JSON.stringify({ sourceKey, outputKey, operationsSummary, backupKey: originalBackupKey })
        ).run();
    }

    return { outputKey, backupKey: originalBackupKey, metadataBackupKey, revisionId };
}

const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
let cachedAppVersion;

async function getAppVersion(env, request) {
    const runtimeCommitSha = env.CF_PAGES_COMMIT_SHA?.trim();
    if (FULL_GIT_SHA_PATTERN.test(runtimeCommitSha || '')) {
        return runtimeCommitSha.slice(0, 7).toLowerCase();
    }

    if (cachedAppVersion) return cachedAppVersion;

    try {
        const versionResponse = await env.ASSETS.fetch(new URL('/build-version.json', request.url));
        if (!versionResponse.ok) {
            cachedAppVersion = 'unknown';
            return cachedAppVersion;
        }

        const buildMetadata = await versionResponse.json();
        const commitSha = buildMetadata?.commitSha?.trim();
        cachedAppVersion = FULL_GIT_SHA_PATTERN.test(commitSha || '')
            ? commitSha.slice(0, 7).toLowerCase()
            : 'unknown';
    } catch {
        cachedAppVersion = 'unknown';
    }

    return cachedAppVersion;
}

// Pages Functions의 Entry Point (모든 Method 요청을 처리하는 Catch-all 핸들러)
/**
 * 역할: Cloudflare Pages catch-all 요청을 라우팅하고 인증, API, 정적/R2 파일 응답을 처리한다.
 * 매개변수: context - request, env, Pages 런타임 바인딩을 포함한 요청 컨텍스트.
 * 주요 변수: request, env, url, path, method, secret, isAdmin - 요청 라우팅과 권한 판단에 쓰는 값.
 * 반환값: 각 라우트에 맞는 Response 객체.
 */
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const secret = env.secretKey;

    /**
     * 역할: Cookie 헤더 문자열을 key-value 객체로 변환한다.
     * 매개변수: cookieStr - request Cookie 헤더 원문.
     * 주요 변수: cookies, parts - 쿠키 누적 객체와 name/value 분리 결과.
     * 반환값: 쿠키 이름을 key로 가지는 객체.
     */
    const getCookies = (cookieStr) => {
      const cookies = {};
      if (cookieStr) {
        cookieStr.split(';').forEach(cookie => {
          const separatorIndex = cookie.indexOf('=');
          if (separatorIndex < 0) return;
          const name = cookie.slice(0, separatorIndex).trim();
          cookies[name] = cookie.slice(separatorIndex + 1);
        });
      }
      return cookies;
    };
    
    const cookies = getCookies(request.headers.get('Cookie'));
    const isAdmin = !!secret && await constantTimeTextEqual(cookies['auth'], secret);

    // 1. 로그인 POST 라우팅 처리
    if (path === "/login" && method === "POST") {
        try {
            const body = await request.json();
            if (secret && await constantTimeTextEqual(body.password, secret)) {
                return new Response(JSON.stringify({ success: true }), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Set-Cookie': `auth=${body.password}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`
                    }
                });
            } else {
                return new Response(JSON.stringify({ success: false, error: 'Wrong password' }), { 
                    status: 401, headers: { 'Content-Type': 'application/json' }
                });
            }
        } catch (e) { return new Response(JSON.stringify({ success: false, error: 'Error' }), { status: 400 }); }
    }

    // 2. 로그아웃 GET 라우팅 처리
    if (path === "/logout" && method === "GET") {
        return new Response(null, {
            status: 302,
            headers: { 'Location': '/login', 'Set-Cookie': `auth=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` }
        });
    }

    if (path === "/login" && method === "GET" && isAdmin) {
        return Response.redirect(new URL('/', request.url), 302);
    }

    const guestApiResponse = await handleGuestApi(request, env, isAdmin, context);
    if (guestApiResponse) return guestApiResponse;

    // 3. API 라우팅 처리
    if (path === "/api/planner/compact/settings" && method === "GET") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const projectId = url.searchParams.get('projectId') || '';
            if (!projectId) return jsonResponse({ error: 'projectId is required' }, { status: 400 });
            const data = await getPlannerCompactSettings(env, projectId);
            if (!data) return jsonResponse({ data: null }, { status: 404 });
            return jsonResponse({ data });
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (path === "/api/planner/compact/settings" && method === "PUT") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            const data = await putPlannerCompactSettings(env, body || {});
            return jsonResponse({ success: true, data });
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (path === "/api/planner/compact/run" && method === "GET") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const projectId = url.searchParams.get('projectId') || '';
            const characterId = url.searchParams.get('characterId') || '';
            if (!projectId || !characterId) return jsonResponse({ error: 'projectId and characterId are required' }, { status: 400 });
            const data = await getPlannerCompactRun(env, { projectId, characterId });
            if (!data) return jsonResponse({ data: null });
            return jsonResponse({ data });
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (path === "/api/planner/compact/run" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            const data = await putPlannerCompactRunFromMeta(env, body?.data || body || {}, {
                clearExistingItemIds: Array.isArray(body?.clearExistingItemIds) ? body.clearExistingItemIds : []
            });
            return jsonResponse({ success: true, data });
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (path === "/api/planner/compact/item" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            const data = await putPlannerCompactItemFromMeta(env, body || {});
            return jsonResponse({ success: true, data });
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    const plannerCompactRunMatch = path.match(/^\/api\/planner\/compact\/run\/([^/]+)$/);
    if (plannerCompactRunMatch && method === "PUT") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            const data = await putPlannerCompactRunFromMeta(env, { ...(body?.data || body || {}), runId: decodeURIComponent(plannerCompactRunMatch[1]) });
            return jsonResponse({ success: true, data });
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (plannerCompactRunMatch && method === "DELETE") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const data = await deletePlannerCompactRun(env, decodeURIComponent(plannerCompactRunMatch[1]));
            return jsonResponse(data);
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    const plannerCompactItemMatch = path.match(/^\/api\/planner\/compact\/item\/([^/]+)$/);
    if (plannerCompactItemMatch && method === "PUT") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            const data = await updatePlannerCompactItem(env, decodeURIComponent(plannerCompactItemMatch[1]), body || {});
            return jsonResponse({ success: true, data });
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (plannerCompactItemMatch && method === "DELETE") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const runKey = url.searchParams.get('runKey') || '';
            const projectId = url.searchParams.get('projectId') || '';
            const characterId = url.searchParams.get('characterId') || '';
            const data = await deletePlannerCompactItem(env, decodeURIComponent(plannerCompactItemMatch[1]), { runKey, projectId, characterId });
            return jsonResponse(data);
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (path === "/api/planner/compact/generate/start" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            const data = await startPlannerCompactGeneration(env, body || {});
            return jsonResponse(data);
        } catch (e) {
            await writeBackgroundErrorLog(env, e, { route: path, method, stage: "planner_compact_start_api" });
            return plannerApiErrorResponse(e);
        }
    }

    if (path === "/api/planner/compact/generate/status" && method === "GET") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const runKey = url.searchParams.get('runKey') || '';
            const projectId = url.searchParams.get('projectId') || '';
            const characterId = url.searchParams.get('characterId') || '';
            if (!runKey && (!projectId || !characterId)) return jsonResponse({ error: 'runKey is required' }, { status: 400 });
            const data = await getPlannerCompactStatus(env, { runKey, projectId, characterId });
            return jsonResponse(data);
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (path === "/api/planner/compact/generate/next-browser-queue" && method === "GET") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const runKey = url.searchParams.get('runKey') || '';
            if (!runKey) return jsonResponse({ error: 'runKey is required' }, { status: 400 });
            const data = await getPlannerCompactBrowserQueue(env, { runKey });
            return jsonResponse(data);
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (path === "/api/planner/compact/generate/complete-browser-queue" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            const data = await completePlannerCompactBrowserQueue(env, body || {});
            return jsonResponse(data);
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (path === "/api/planner/compact/generate/pause" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            if (!body?.runKey) return jsonResponse({ error: 'runKey is required' }, { status: 400 });
            const data = await pausePlannerCompactGeneration(env, { runKey: body.runKey });
            return jsonResponse(data);
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (path === "/api/planner/compact/generate/resume" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            if (!body?.runKey) return jsonResponse({ error: 'runKey is required' }, { status: 400 });
            const data = await resumePlannerCompactGeneration(env, { runKey: body.runKey });
            return jsonResponse(data);
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (path === "/api/planner/compact/generate/cancel" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            if (!body?.runKey) return jsonResponse({ error: 'runKey is required' }, { status: 400 });
            const data = await cancelPlannerCompactGeneration(env, { runKey: body.runKey });
            return jsonResponse(data);
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (path === "/api/planner/compact/confirm" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            const data = await confirmPlannerCompactAsset(env, body || {});
            return jsonResponse(data);
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (path === "/api/planner/compact/cleanup-assets" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json().catch(() => ({}));
            const data = await cleanupPlannerCompactAssets(env, body || {});
            return jsonResponse(data);
        } catch (e) {
            return plannerApiErrorResponse(e);
        }
    }

    if (path.startsWith("/api/planner/v3/")) {
        return jsonResponse({ error: 'Planner v3 API has been retired. Use /api/planner/compact/*.' }, { status: 410 });
    }

    if (path === "/api/planner/meta" || path.startsWith("/api/planner/background/")) {
        return jsonResponse({ error: 'Legacy planner API is disabled. Use /api/planner/compact/*.' }, { status: 410 });
    }

    if (path === "/api/assets/cleanup-deleted" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json().catch(() => ({}));
            const result = await cleanupDeletedAssets(env, body.olderThanHours ?? 24, body.limit ?? 100);
            return jsonResponse(result);
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/migration/v2/import-r2-json-state" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json().catch(() => ({}));
            const result = await migrateR2JsonStateToDb(env, body.limit ?? 500, body.cursor || undefined);
            return jsonResponse(result);
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/migration/v2/backfill-legacy-db" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        return jsonResponse({ error: 'legacy DB backfill is disabled after v2 migration' }, { status: 410 });
    }

    if (path === "/api/migration/v2/cleanup-legacy-planner-state" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json().catch(() => ({}));
            const result = await cleanupLegacyPlannerState(env, body.limit ?? 500, body.cursor || undefined, {
                cleanupBackground: body.cleanupBackground !== false,
                forceBackground: body.forceBackground === true
            });
            return jsonResponse(result);
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/generate" && method === "POST") {
        if (!isAdmin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
        if (!env.NOVELAI_TOKEN) return new Response(JSON.stringify({ error: 'Novel AI API 토큰이 설정되지 않았습니다.' }), { status: 500 });
        
        try {
            const naiPayload = await request.json();
            const naiRes = await fetch("https://image.novelai.net/ai/generate-image", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${env.NOVELAI_TOKEN}`,
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    "Accept": "application/x-zip-compressed",
                    "Origin": "https://novelai.net",
                    "Referer": "https://novelai.net/"
                },
                body: JSON.stringify(naiPayload)
            });

            if (!naiRes.ok) {
                const errText = await naiRes.text();
                throw new Error(`[${naiRes.status}] ${errText}`);
            }

            const buffer = await naiRes.arrayBuffer();
            return new Response(buffer, {
                headers: {
                    "Content-Type": "application/x-zip-compressed",
                    "Content-Disposition": 'attachment; filename="image.zip"'
                }
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    if (path === "/api/generate-stream" && method === "POST") {
        if (!isAdmin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
        if (!env.NOVELAI_TOKEN) return new Response(JSON.stringify({ error: 'Novel AI API 토큰이 설정되지 않았습니다.' }), { status: 500 });
        
        try {
            const naiPayload = await request.json();
            const naiRes = await fetch("https://image.novelai.net/ai/generate-image-stream", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${env.NOVELAI_TOKEN}`,
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    "Accept": "text/event-stream",
                    "Origin": "https://novelai.net",
                    "Referer": "https://novelai.net/"
                },
                body: JSON.stringify(naiPayload)
            });

            if (!naiRes.ok) {
                const errText = await naiRes.text();
                throw new Error(`[${naiRes.status}] ${errText}`);
            }

            return new Response(naiRes.body, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive"
                }
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    if (path === "/api/db/json-document" && method === "GET") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const docType = url.searchParams.get('type') || '';
            const key = url.searchParams.get('key') || '';
            const fallbackKey = url.searchParams.get('fallbackKey') || key;
            if (!docType || !key) return jsonResponse({ error: 'type and key are required' }, { status: 400 });
            if (docType === 'planner_meta') {
                return jsonResponse({ error: 'planner_meta is only available through /api/planner/meta' }, { status: 410 });
            }
            const data = await getJsonDocument(env, docType, key, fallbackKey, null);
            if (data === null || data === undefined) return jsonResponse({ data: null }, { status: 404 });
            return jsonResponse({ data });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/db/json-document" && method === "PUT") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            if (!body?.type || !body?.key) return jsonResponse({ error: 'type and key are required' }, { status: 400 });
            if (body.type === 'planner_meta') {
                return jsonResponse({ error: 'planner_meta is only available through /api/planner/meta' }, { status: 410 });
            }
            await putJsonDocument(env, body.type, body.key, body.data || {});
            return jsonResponse({ success: true });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/db/json-document" && method === "DELETE") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            if (!body?.type || !body?.key) return jsonResponse({ error: 'type and key are required' }, { status: 400 });
            if (body.type === 'planner_meta') {
                return jsonResponse({ error: 'planner_meta is only available through /api/planner/meta' }, { status: 410 });
            }
            await ensureJsonDbSchema(env);
            await env.DB.prepare(
                'DELETE FROM json_documents WHERE doc_type = ? AND object_key = ?'
            ).bind(body.type, body.key).run();
            return jsonResponse({ success: true });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/db/file-metadata" && method === "GET") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            await ensureJsonDbSchema(env);
            const folderPrefix = url.searchParams.get('folderPrefix') || '';
            const fileName = url.searchParams.get('fileName') || '';
            if (!folderPrefix || !fileName) return jsonResponse({ error: 'folderPrefix and fileName are required' }, { status: 400 });

            const names = [fileName];
            const baseName = fileName.replace(/\.[^/.]+$/, '');
            for (const ext of ['.png', '.webp', '.jpg', '.jpeg']) {
                const fallbackName = baseName + ext;
                if (!names.includes(fallbackName)) names.push(fallbackName);
            }
            const placeholders = names.map(() => '?').join(',');
            const row = await env.DB.prepare(
                `SELECT metadata_json FROM file_metadata WHERE folder_prefix = ? AND file_name IN (${placeholders}) ORDER BY CASE file_name WHEN ? THEN 0 ELSE 1 END LIMIT 1`
            ).bind(folderPrefix, ...names, fileName).first();
            if (row?.metadata_json) return jsonResponse({ data: JSON.parse(row.metadata_json) });

            return jsonResponse({ data: null });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/db/file-metadata" && method === "PUT") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            await ensureJsonDbSchema(env);
            const body = await request.json();
            if (!body?.folderPrefix || !body?.fileName) return jsonResponse({ error: 'folderPrefix and fileName are required' }, { status: 400 });
            const timestamp = nowIso();
            await env.DB.prepare(`
                INSERT INTO file_metadata (folder_prefix, file_name, metadata_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(folder_prefix, file_name) DO UPDATE SET
                    metadata_json = excluded.metadata_json,
                    updated_at = excluded.updated_at
            `).bind(body.folderPrefix, body.fileName, JSON.stringify(body.metadata || {}), timestamp, timestamp).run();

            return jsonResponse({ success: true });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/db/file-metadata" && method === "DELETE") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            await ensureJsonDbSchema(env);
            const body = await request.json();
            if (!body?.folderPrefix || !Array.isArray(body.fileNames)) return jsonResponse({ error: 'folderPrefix and fileNames are required' }, { status: 400 });
            const names = new Set();
            body.fileNames.forEach(name => {
                const baseName = String(name || '').replace(/\.[^/.]+$/, '');
                [name, `${baseName}.png`, `${baseName}.webp`, `${baseName}.jpg`, `${baseName}.jpeg`].forEach(value => names.add(value));
            });
            const fileNames = [...names].filter(Boolean);
            if (fileNames.length) {
                const placeholders = fileNames.map(() => '?').join(',');
                await env.DB.prepare(
                    `DELETE FROM file_metadata WHERE folder_prefix = ? AND file_name IN (${placeholders})`
                ).bind(body.folderPrefix, ...fileNames).run();

            }
            return jsonResponse({ success: true });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/db/file-metadata/move" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            await ensureJsonDbSchema(env);
            const body = await request.json();
            if (!body?.oldPrefix || !body?.oldName || !body?.newPrefix || !body?.newName) {
                return jsonResponse({ error: 'oldPrefix, oldName, newPrefix and newName are required' }, { status: 400 });
            }
            const row = await env.DB.prepare(
                'SELECT metadata_json FROM file_metadata WHERE folder_prefix = ? AND file_name = ?'
            ).bind(body.oldPrefix, body.oldName).first();
            let metadata = row?.metadata_json ? JSON.parse(row.metadata_json) : null;
            if (metadata) {
                const timestamp = nowIso();
                await env.DB.batch([
                    env.DB.prepare('DELETE FROM file_metadata WHERE folder_prefix = ? AND file_name = ?').bind(body.oldPrefix, body.oldName),
                    env.DB.prepare(`
                        INSERT INTO file_metadata (folder_prefix, file_name, metadata_json, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(folder_prefix, file_name) DO UPDATE SET
                            metadata_json = excluded.metadata_json,
                            updated_at = excluded.updated_at
                    `).bind(body.newPrefix, body.newName, JSON.stringify(metadata), timestamp, timestamp)
                ]);
            }
            return jsonResponse({ success: true });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/image-editor/document" && method === "GET") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const documentId = url.searchParams.get('documentId') || '';
            const sourceKey = normalizeR2Key(url.searchParams.get('sourceKey') || '');
            if (!documentId && !sourceKey) return jsonResponse({ error: 'documentId or sourceKey is required' }, { status: 400 });
            const result = documentId
                ? await getEditorDocumentById(env, documentId)
                : await getLatestEditorDocumentForSource(env, sourceKey);
            if (!result?.document) return jsonResponse({ data: null }, { status: 404 });
            return jsonResponse({ document: result.document, row: result.row });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/image-editor/documents" && method === "GET") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            await ensureImageEditorSchema(env);
            const prefix = normalizeR2Key(url.searchParams.get('prefix') || '');
            const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 100), 1), 200);
            const result = prefix
                ? await env.DB.prepare(`
                    SELECT id, source_key, output_key, status, preview_key, created_at, updated_at, saved_at
                    FROM image_editor_documents
                    WHERE source_key LIKE ? AND status IN ('draft', 'saved')
                    ORDER BY updated_at DESC
                    LIMIT ?
                `).bind(`${prefix}%`, limit).all()
                : await env.DB.prepare(`
                    SELECT id, source_key, output_key, status, preview_key, created_at, updated_at, saved_at
                    FROM image_editor_documents
                    WHERE status IN ('draft', 'saved')
                    ORDER BY updated_at DESC
                    LIMIT ?
                `).bind(limit).all();
            return jsonResponse({ documents: result.results || [] });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/image-editor/document" && method === "PUT") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            const document = body?.document || {};
            if (!document.documentId || !document.sourceKey) return jsonResponse({ error: 'documentId and sourceKey are required' }, { status: 400 });
            document.sourceKey = normalizeR2Key(document.sourceKey);
            document.outputKey = normalizeR2Key(document.outputKey || document.sourceKey);
            if (!isSafeR2Key(document.sourceKey) || !isEditableImageKey(document.sourceKey)) return jsonResponse({ error: 'Invalid source key' }, { status: 400 });
            const result = await saveEditorDocumentRecord(env, document, 'saved', nowIso());
            return jsonResponse({ success: true, ...result });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/image-editor/document" && method === "DELETE") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            await ensureImageEditorSchema(env);
            const documentId = String(url.searchParams.get('documentId') || '').trim();
            if (!documentId) return jsonResponse({ error: 'documentId is required' }, { status: 400 });
            const row = await env.DB.prepare(
                'SELECT id, document_json_key, preview_key FROM image_editor_documents WHERE id = ?'
            ).bind(documentId).first();
            if (!row) return jsonResponse({ error: 'Document not found' }, { status: 404 });
            const keys = [row.document_json_key, row.preview_key].filter(Boolean);
            if (keys.length) await env.imgBucket.delete(keys);
            await env.DB.prepare('DELETE FROM image_editor_revisions WHERE document_id = ?').bind(documentId).run();
            await env.DB.prepare('DELETE FROM image_editor_documents WHERE id = ?').bind(documentId).run();
            return jsonResponse({ success: true, documentId });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if ((path === "/api/image-editor/save" || path === "/api/image-editor/save-as") && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const form = await request.formData();
            const file = form.get('file');
            if (!file || typeof file.arrayBuffer !== 'function') return jsonResponse({ error: 'file is required' }, { status: 400 });
            const sourceKey = normalizeR2Key(form.get('sourceKey') || '');
            const outputKey = normalizeR2Key(form.get('outputKey') || sourceKey);
            const documentId = String(form.get('documentId') || '').trim();
            const document = JSON.parse(String(form.get('document') || '{}'));
            const operationsSummary = JSON.parse(String(form.get('operationsSummary') || '[]'));
            const blob = await file.arrayBuffer();
            const result = await saveImageEditorOutput(env, {
                sourceKey,
                outputKey: path === "/api/image-editor/save" ? sourceKey : outputKey,
                documentId,
                document,
                blob,
                operationsSummary,
                overwrite: path === "/api/image-editor/save"
            });
            return jsonResponse({ success: true, ...result });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/image-editor/cleanup" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            await ensureImageEditorSchema(env);
            const body = await request.json().catch(() => ({}));
            const olderThanHours = Number(body.olderThanHours || 24 * 30);
            const cutoff = toKstIso(new Date(Date.now() - olderThanHours * 60 * 60 * 1000));
            const rows = await env.DB.prepare(`
                SELECT id, document_json_key FROM image_editor_documents
                WHERE status = 'draft' AND updated_at < ?
                LIMIT 100
            `).bind(cutoff).all();
            const keys = (rows.results || []).map(row => row.document_json_key).filter(Boolean);
            if (keys.length) await env.imgBucket.delete(keys);
            if (rows.results?.length) {
                const placeholders = rows.results.map(() => '?').join(',');
                await env.DB.prepare(`DELETE FROM image_editor_documents WHERE id IN (${placeholders})`)
                    .bind(...rows.results.map(row => row.id))
                    .run();
            }
            return jsonResponse({ success: true, deleted: rows.results?.length || 0 });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/aliases" && method === "GET") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        const prefix = url.searchParams.get('prefix') || '';
        let globalAliases = {};
        let projectAliases = {};
        
        try {
            globalAliases = await getDbAliases(env, 'global', '');
        } catch(e){}

        const parts = prefix.split('/').filter(Boolean);
        if (parts.length > 0) {
            const projectName = parts[0];
            try {
                projectAliases = await getDbAliases(env, 'project', projectName);
            } catch(e){}
        }

        return new Response(JSON.stringify({ global: globalAliases, project: projectAliases }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (path === "/api/aliases" && method === "POST") {
        if (!isAdmin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
        try {
            const body = await request.json(); 
            const fullPath = body.key;
            const newAlias = body.alias;
            
            const parts = fullPath.split('/').filter(Boolean);
            
            if (parts.length === 1) {
                await putDbAlias(env, 'global', '', fullPath, newAlias);
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
                
            } else if (parts.length > 1) {
                const projectName = parts[0];
                const targetName = parts[parts.length - 1];
                await putDbAlias(env, 'project', projectName, targetName, newAlias);
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            }
            
            return new Response(JSON.stringify({ error: 'Invalid path' }), { status: 400 });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    if (path === "/api/manage" && method === "POST") {
        if (!isAdmin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });

        try {
            const body = await request.json();
            const { action, key, newKey, isPublic, keys } = body;

            if (action === 'toggle_public') {
                if (isTextFile(key)) {
                    const { prefix: mPrefix, fileName: mFileName } = splitPath(key);
                    const memoObj = await env.imgBucket.get(mPrefix + '.memos.json');
                    if (memoObj) {
                        const memos = await memoObj.json();
                        if (memos[mFileName]) {
                            memos[mFileName].isPublic = isPublic;
                            await env.imgBucket.put(mPrefix + '.memos.json', JSON.stringify(memos), { httpMetadata: { contentType: 'application/json' }});
                            return new Response(JSON.stringify({ success: true }));
                        }
                    }
                }
                
                const object = await env.imgBucket.get(key);
                if (!object) throw new Error('File not found');
                const newMetadata = {
                    ...object.customMetadata,
                    ispublic: isPublic ? 'true' : 'false',
                    visibilityconfigured: 'true'
                };
                await env.imgBucket.put(key, object.body, {
                    httpMetadata: object.httpMetadata,
                    customMetadata: newMetadata
                });
                return new Response(JSON.stringify({ success: true }));
            }

            if (action === 'delete') {
                if (isTextFile(key)) {
                    const { prefix: mPrefix, fileName: mFileName } = splitPath(key);
                    const memoObj = await env.imgBucket.get(mPrefix + '.memos.json');
                    if (memoObj) {
                        const memos = await memoObj.json();
                        if (memos[mFileName]) {
                            delete memos[mFileName];
                            await env.imgBucket.put(mPrefix + '.memos.json', JSON.stringify(memos), { httpMetadata: { contentType: 'application/json' }});
                        }
                    }
                }
                try { await env.imgBucket.delete(key); } catch(e){}
                return new Response(JSON.stringify({ success: true }));
            }

            if (action === 'delete_multiple') {
                if (Array.isArray(body.keys) && body.keys.length > 0) {
                    await env.imgBucket.delete(body.keys);
                }
                return new Response(JSON.stringify({ success: true }));
            }

            if (action === 'delete_folder') {
                const prefix = key.endsWith('/') ? key : key + '/';
                let truncated = true;
                let cursor = undefined;
                while (truncated) {
                    const list = await env.imgBucket.list({ prefix: prefix, cursor: cursor });
                    truncated = list.truncated;
                    cursor = list.cursor;
                    const keysToDelete = list.objects.map(o => o.key);
                    if (keysToDelete.length > 0) await env.imgBucket.delete(keysToDelete);
                }
                try {
                    await deleteAliasPrefix(env, prefix).catch(() => null);
                } catch(e){}
                await env.DB.prepare('DELETE FROM v2_projects WHERE prefix = ? OR prefix = ?')
                    .bind(prefix, prefix.replace(/\/+$/g, ''))
                    .run();
                return new Response(JSON.stringify({ success: true }));
            }

            if (action === 'clear_logs') {
                const prefix = 'logs/';
                let truncated = true;
                let cursor = undefined;
                while (truncated) {
                    const list = await env.imgBucket.list({ prefix, cursor });
                    truncated = list.truncated;
                    cursor = list.cursor;
                    const keysToDelete = list.objects.map(o => o.key);
                    if (keysToDelete.length > 0) await env.imgBucket.delete(keysToDelete);
                }
                return new Response(JSON.stringify({ success: true }));
            }

            if (action === 'rename_folder') {
                if (!key || !newKey) throw new Error('Folder paths are required');
                const oldPrefix = key.endsWith('/') ? key : key + '/';
                const newPrefix = newKey.endsWith('/') ? newKey : newKey + '/';
                if (oldPrefix === newPrefix) return new Response(JSON.stringify({ success: true, newKey: newPrefix }));
                if (newPrefix.startsWith(oldPrefix)) throw new Error('Cannot move a folder into itself');

                const existing = await env.imgBucket.list({ prefix: newPrefix, limit: 1 });
                if (existing.objects.length > 0 || (existing.delimitedPrefixes && existing.delimitedPrefixes.length > 0)) {
                    throw new Error('Destination path already exists');
                }

                let truncated = true;
                let cursor = undefined;
                let movedKeys = [];

                while (truncated) {
                    const list = await env.imgBucket.list({ prefix: oldPrefix, cursor: cursor });
                    truncated = list.truncated;
                    cursor = list.cursor;

                    for (const objectInfo of list.objects) {
                        const targetKey = newPrefix + objectInfo.key.slice(oldPrefix.length);
                        const object = await env.imgBucket.get(objectInfo.key);
                        if (object) {
                            await env.imgBucket.put(targetKey, object.body, {
                                httpMetadata: object.httpMetadata,
                                customMetadata: object.customMetadata
                            });
                            movedKeys.push(objectInfo.key);
                        }
                    }
                }

                if (movedKeys.length > 0) {
                    await env.imgBucket.delete(movedKeys);
                }

                try {
                    await moveAliasPrefix(env, oldPrefix, newPrefix).catch(() => null);
                } catch(e){}

                const timestamp = nowIso();
                await env.DB.batch([
                    env.DB.prepare(`
                        UPDATE v2_projects
                        SET prefix = ?, updated_at = ?
                        WHERE prefix = ? OR prefix = ?
                    `).bind(newPrefix, timestamp, oldPrefix, oldPrefix.replace(/\/+$/g, '')),
                    env.DB.prepare(`
                        UPDATE v2_characters
                        SET prefix = ? || substr(prefix, length(?) + 1), updated_at = ?
                        WHERE prefix LIKE ?
                    `).bind(newPrefix, oldPrefix, timestamp, `${oldPrefix}%`),
                    env.DB.prepare(`
                        UPDATE v2_assets
                        SET r2_key = ? || substr(r2_key, length(?) + 1), updated_at = ?
                        WHERE r2_key LIKE ?
                    `).bind(newPrefix, oldPrefix, timestamp, `${oldPrefix}%`),
                    env.DB.prepare(`
                        UPDATE guest_posts
                        SET image_key = ? || substr(image_key, length(?) + 1), updated_at = ?
                        WHERE image_key LIKE ?
                    `).bind(newPrefix, oldPrefix, timestamp, `${oldPrefix}%`)
                ]);

                return new Response(JSON.stringify({ success: true, newKey: newPrefix }));
            }

            if (action === 'move') {
                if (!newKey) throw new Error('New path required');
                let movedVirtual = false;

                if (isTextFile(key)) {
                    const { prefix: mPrefix, fileName: mFileName } = splitPath(key);
                    const { prefix: nPrefix, fileName: nFileName } = splitPath(newKey);
                    
                    const memoObj = await env.imgBucket.get(mPrefix + '.memos.json');
                    if (memoObj) {
                        let memos = await memoObj.json();
                        if (memos[mFileName]) {
                            const memoData = memos[mFileName];
                            if (mPrefix === nPrefix) {
                                memos[nFileName] = memoData;
                                delete memos[mFileName];
                                await env.imgBucket.put(mPrefix + '.memos.json', JSON.stringify(memos), { httpMetadata: { contentType: 'application/json' }});
                            } else {
                                let newMemos = {};
                                const newMemoObj = await env.imgBucket.get(nPrefix + '.memos.json');
                                if (newMemoObj) newMemos = await newMemoObj.json();
                                newMemos[nFileName] = memoData;
                                delete memos[mFileName];
                                await env.imgBucket.put(nPrefix + '.memos.json', JSON.stringify(newMemos), { httpMetadata: { contentType: 'application/json' }});
                                await env.imgBucket.put(mPrefix + '.memos.json', JSON.stringify(memos), { httpMetadata: { contentType: 'application/json' }});
                            }
                            movedVirtual = true;
                        }
                    }
                }
                
                const object = await env.imgBucket.get(key);
                if (object) {
                    await env.imgBucket.put(newKey, object.body, {
                        httpMetadata: object.httpMetadata,
                        customMetadata: object.customMetadata
                    });
                    await env.imgBucket.delete(key);
                } else if (!movedVirtual) {
                    throw new Error('File not found');
                }
                
                return new Response(JSON.stringify({ success: true, newKey }));
            }

            return new Response('Invalid action', { status: 400 });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    if (path === "/api/list" && method === "GET") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        const prefix = url.searchParams.get('prefix') || '';

        try {
            let allFolders = new Set();
            let allFiles = [];
            let truncated = true;
            let cursor = undefined;

            while (truncated) {
                const options = { prefix: prefix, delimiter: '/', include: ['customMetadata'] };
                if (cursor) options.cursor = cursor;
                const listing = await env.imgBucket.list(options);
                
                if (listing.delimitedPrefixes) {
                    listing.delimitedPrefixes.forEach(p => allFolders.add(p));
                }
                
                listing.objects.forEach(o => {
                    if (!o.key.includes('.imggul_aliases.json') && !o.key.endsWith('.aliases.json') && !o.key.endsWith('.memos.json') && !o.key.endsWith('_meta.json')) {
                        allFiles.push({ 
                            key: o.key, 
                            size: o.size, 
                            uploaded: o.uploaded,
                            isPublic: isImageObjectKey(o.key)
                                ? isPublicR2ImageObject(o.key, o.customMetadata)
                                : o.customMetadata?.ispublic === 'true'
                        });
                    }
                });
                
                truncated = listing.truncated;
                cursor = listing.cursor;
            }

            try {
                const memoObj = await env.imgBucket.get(prefix + '.memos.json');
                if (memoObj) {
                    const memos = await memoObj.json();
                    for (const [mKey, mVal] of Object.entries(memos)) {
                        const fullKey = prefix + mKey;
                        if (!allFiles.find(f => f.key === fullKey)) {
                            allFiles.push({
                                key: fullKey,
                                size: mVal.content ? (new TextEncoder().encode(mVal.content)).length : 0,
                                uploaded: new Date(mVal.updated || Date.now()),
                                isPublic: !!mVal.isPublic
                            });
                        }
                    }
                }
            } catch(e){}

            if (!isAdmin) {
                allFiles = allFiles.filter(f => !isReadableTextFile(f.key) || f.isPublic);
            }

            return new Response(JSON.stringify({
                folders: Array.from(allFolders),
                files: allFiles
            }), { headers: { 'Content-Type': 'application/json' } });

        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    if (path === "/api/upload" && method === "PUT") {
      const userKeyHeader = request.headers.get('X-Custom-Auth-Key');
      if ((!secret || secret !== userKeyHeader) && !isAdmin) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
      }

      const absolutePath = request.headers.get('X-Absolute-Path');
      let finalKey;

      if (absolutePath) {
          finalKey = decodeURIComponent(absolutePath);
          if (finalKey.startsWith('/')) finalKey = finalKey.slice(1);
      } else {
          const rawOriginalName = request.headers.get('X-File-Name') || 'image.png';
          const originalName = decodeURIComponent(rawOriginalName);
          finalKey = `${Date.now()}-${originalName}`;
      }

      try {
        if (isTextFile(finalKey)) {
            const { prefix: mPrefix, fileName: mFileName } = splitPath(finalKey);
            const memoPath = mPrefix + '.memos.json';
            
            let memos = {};
            try {
                const memoObj = await env.imgBucket.get(memoPath);
                if (memoObj) memos = await memoObj.json();
            } catch(e){}
            
            const content = await request.text();
            const isPublic = memos[mFileName] ? !!memos[mFileName].isPublic : false;
            
            memos[mFileName] = { content: content, isPublic: isPublic, updated: Date.now() };
            
            await env.imgBucket.put(memoPath, JSON.stringify(memos), {
                httpMetadata: { contentType: 'application/json' }
            });
            
            try { await env.imgBucket.delete(finalKey); } catch(e){}
            
            return new Response(JSON.stringify({ success: true, url: `/${finalKey}` }), { headers: { 'Content-Type': 'application/json' } });
            
        } else {
            const uploadContentType = request.headers.get('Content-Type') || 'application/octet-stream';
            const isImageUpload = /^image\/(?:webp|png|jpeg)$/i.test(uploadContentType)
                && isImageObjectKey(finalKey);
            await env.imgBucket.put(finalKey, request.body, {
              httpMetadata: { contentType: uploadContentType },
              customMetadata: {
                  ispublic: isImageUpload ? 'true' : 'false',
                  visibilityconfigured: 'true'
              }
            });
            return new Response(JSON.stringify({ success: true, url: `/${finalKey}` }), { headers: { 'Content-Type': 'application/json' } });
        }
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Upload failed: ' + err.message }), { status: 500 });
      }
    }

    // 4. 정적 자산(Static Assets) 서빙 여부 검사
    const hasExtension = path.includes(".");
    if (hasExtension) {
        // public 폴더 내 실제 정적 파일(js, css 등) 존재 여부 우선 검사
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) {
            return assetResponse;
        }

        // 정적 에셋에 없는 파일인 경우 R2에서 조회 및 다운로드 서빙
        let objectKey = null;
        if (path.startsWith("/i/")) objectKey = path.split("/i/")[1];
        else objectKey = path.slice(1);

        if (objectKey) {
            const normalizedImageKey = normalizeImageObjectKey(objectKey);
            if (normalizedImageKey && isImageObjectKey(normalizedImageKey)) {
                return serveR2Image({
                    request,
                    env,
                    rawKey: objectKey,
                    isAdmin
                });
            }

            try {
                objectKey = decodeURIComponent(objectKey);
            } catch {
                return new Response('Not found', {
                    status: 404,
                    headers: { 'Cache-Control': 'no-store' }
                });
            }

            if (objectKey.endsWith('_meta.json') && !isAdmin) {
                return new Response('Not found', {
                    status: 404,
                    headers: { 'Cache-Control': 'no-store' }
                });
            }

            if (!isReadableTextFile(objectKey) && !isAdmin) {
                return new Response('Not found', {
                    status: 404,
                    headers: { 'Cache-Control': 'no-store' }
                });
            }

            try {
                let object = await env.imgBucket.get(objectKey);
                
                if (!object && isTextFile(objectKey)) {
                    const { prefix: mPrefix, fileName: mFileName } = splitPath(objectKey);
                    const memoObj = await env.imgBucket.get(mPrefix + '.memos.json');
                    if (memoObj) {
                        const memos = await memoObj.json();
                        if (memos[mFileName]) {
                            const mData = memos[mFileName];
                            if (!mData.isPublic && !isAdmin) {
                                return new Response('Not found', {
                                    status: 404,
                                    headers: { 'Cache-Control': 'no-store' }
                                });
                            }
                            return new Response(mData.content, { 
                                headers: { 
                                    'Content-Type': 'text/plain; charset=UTF-8',
                                    'Cache-Control': 'no-cache'
                                } 
                            });
                        }
                    }
                }

                if (!object) {
                    return new Response('Not found', {
                        status: 404,
                        headers: { 'Cache-Control': 'no-store' }
                    });
                }

                if (isReadableTextFile(objectKey)) {
                    const isPublic = object.customMetadata?.ispublic === 'true';
                    if (!isPublic && !isAdmin) {
                        return new Response('Not found', {
                            status: 404,
                            headers: { 'Cache-Control': 'no-store' }
                        });
                    }
                }

                const headers = new Headers();
                object.writeHttpMetadata(headers);
                headers.set('etag', object.httpEtag);
                headers.set('Cache-Control', isAdmin
                    ? 'private, no-store'
                    : 'public, max-age=300, must-revalidate');
                if (isReadableTextFile(objectKey) && !headers.get('Content-Type')) {
                    headers.set('Content-Type', 'text/plain; charset=UTF-8');
                }
                return new Response(object.body, { headers });

            } catch (e) {
                return new Response('Error', {
                    status: 500,
                    headers: { 'Cache-Control': 'no-store' }
                });
            }
        }
    }

    // 5. 비인증 로그인 화면과 잘못된 루트 접근을 분리한다.
    if (!isAdmin && path === "/login") {
        const loginRes = await env.ASSETS.fetch(new URL('/login.html', request.url));
        let loginHtmlText = await loginRes.text();
        return new Response(loginHtmlText.replace('{{ERROR_STYLE}}', 'none'), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    if (!isAdmin && path === "/") {
        const errorResponse = await env.ASSETS.fetch(new URL('/access-error.html', request.url));
        let errorHtml = await errorResponse.text();
        errorHtml = errorHtml.replace('{{ERROR_MESSAGE}}', '프로젝트 주소를 통해 접속해 주세요.');
        return new Response(errorHtml, {
            status: 404,
            headers: { "Content-Type": "text/html; charset=UTF-8" }
        });
    }

    // 6. 관리자 화면 또는 검증된 단일 프로젝트 게스트 화면을 반환한다.
    if (isAdmin) {
        const templateRes = await env.ASSETS.fetch(new URL('/app.html', request.url));
        let htmlContent = await templateRes.text();
        const commitVersion = await getAppVersion(env, request);
        htmlContent = htmlContent.replace('{{IS_ADMIN}}', 'true');
        htmlContent = htmlContent.replace('{{INITIAL_PATH}}', '');
        htmlContent = htmlContent.replace('{{IS_EMPTY}}', 'false');
        htmlContent = htmlContent.replaceAll('{{APP_VERSION}}', commitVersion);
        return new Response(htmlContent, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    const pathParts = path.split('/').filter(Boolean);
    const isSingleProjectPath = /^\/[^/]+\/?$/.test(path);
    const projectPath = isSingleProjectPath && pathParts.length === 1 ? normalizeGuestProjectPath(pathParts[0]) : '';
    const project = projectPath ? await resolveGuestProject(env, projectPath) : null;
    if (!project) {
        const errorResponse = await env.ASSETS.fetch(new URL('/access-error.html', request.url));
        let errorHtml = await errorResponse.text();
        errorHtml = errorHtml.replace('{{ERROR_MESSAGE}}', '프로젝트 주소를 확인해 주세요.');
        return new Response(errorHtml, { status: 404, headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    const templateRes = await env.ASSETS.fetch(new URL('/guest.html', request.url));
    let htmlContent = await templateRes.text();
    const commitVersion = await getAppVersion(env, request);
    const projectPathJson = JSON.stringify(project.path).replace(/</g, '\\u003c');
    htmlContent = htmlContent.replace('{{INITIAL_PROJECT_PATH_JSON}}', projectPathJson);
    htmlContent = htmlContent.replaceAll('{{APP_VERSION}}', commitVersion);
    return new Response(htmlContent, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
}
