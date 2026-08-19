import {
    prepareCharacterPathPlannerMigration,
    prepareSituationPathPlannerMigration,
    safePlannerRef
} from './planner-compact.js';
import {
    assertSafePathSegment,
    normalizePrefix,
    replaceExactBasename,
    splitObjectKey
} from './path-utils.js';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const INTERNAL_PROJECT_FOLDERS = new Set(['_planner_temp_image', '_guest_posts', '__editor_sessions', '__editor_backups']);
const R2_OPERATION_CONCURRENCY = 4;
const PATH_MIGRATION_TIME_BUDGET_MS = 90_000;

function nowIso() {
    return new Date().toISOString();
}

function pathMigrationError(code, status, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    error.details = details;
    return error;
}

function parseJson(value, fallback) {
    try {
        return value ? JSON.parse(value) : fallback;
    } catch {
        return fallback;
    }
}

async function listAllR2Objects(bucket, options = {}) {
    const objects = [];
    const seenCursors = new Set();
    let cursor;
    let truncated = true;
    while (truncated) {
        const page = await bucket.list({
            ...options,
            cursor,
            include: options.include || ['httpMetadata', 'customMetadata']
        });
        objects.push(...(page.objects || []));
        truncated = page.truncated === true;
        if (!truncated) break;
        if (!page.cursor || seenCursors.has(page.cursor)) {
            throw pathMigrationError('PATH_R2_CURSOR_STALLED', 500, 'R2 파일 목록 조회가 같은 위치에서 반복되었습니다.');
        }
        seenCursors.add(page.cursor);
        cursor = page.cursor;
    }
    return objects;
}

async function runWithConcurrency(items, concurrency, worker) {
    if (!items.length) return;
    let nextIndex = 0;
    let firstError = null;
    const workers = Array.from(
        { length: Math.min(Math.max(1, concurrency), items.length) },
        async () => {
            while (!firstError) {
                const index = nextIndex;
                nextIndex += 1;
                if (index >= items.length) return;
                try {
                    await worker(items[index], index);
                } catch (error) {
                    firstError ||= error;
                }
            }
        }
    );
    await Promise.all(workers);
    if (firstError) throw firstError;
}

function assertMigrationTimeRemaining(deadline) {
    if (Date.now() < deadline) return;
    throw pathMigrationError(
        'PATH_MIGRATION_TIME_BUDGET_EXCEEDED',
        503,
        '경로 변경 안전 제한 시간을 초과하여 변경 내용을 되돌렸습니다. 다시 시도하세요.'
    );
}

function uniqueManifest(entries = []) {
    const bySource = new Map();
    for (const entry of entries) {
        if (!entry?.sourceKey || !entry?.targetKey || entry.sourceKey === entry.targetKey) continue;
        bySource.set(entry.sourceKey, entry);
    }
    return [...bySource.values()].sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
}

function legacyPlannerCharacterRef(value = '') {
    return String(value || '').trim().replace(/[\\/]+/g, '_');
}

async function assertNoDestinationObjects(bucket, manifest) {
    await runWithConcurrency(manifest, R2_OPERATION_CONCURRENCY, async entry => {
        const destination = await bucket.head(entry.targetKey);
        if (!destination) return;
        throw pathMigrationError('PATH_DESTINATION_EXISTS', 409, '변경할 경로에 이미 파일이 존재합니다.', {
            sourceKey: entry.sourceKey,
            targetKey: entry.targetKey
        });
    });
}

async function updateMigration(env, id, fields = {}) {
    const allowed = ['status', 'manifest_json', 'copied_count', 'deleted_count', 'error_json', 'completed_at'];
    const keys = Object.keys(fields).filter(key => allowed.includes(key));
    if (!keys.length) return;
    const assignments = keys.map(key => `${key} = ?`);
    assignments.push('updated_at = ?');
    await env.DB.prepare(`UPDATE path_migrations SET ${assignments.join(', ')} WHERE id = ?`)
        .bind(...keys.map(key => fields[key]), nowIso(), id)
        .run();
}

async function copyManifestObjects(env, migration, manifest, deadline, attemptedTargetKeys) {
    await updateMigration(env, migration.id, { status: 'copying' });
    let copiedCount = 0;
    await runWithConcurrency(manifest, R2_OPERATION_CONCURRENCY, async entry => {
        assertMigrationTimeRemaining(deadline);
        const source = await env.imgBucket.get(entry.sourceKey);
        if (!source) {
            throw pathMigrationError('PATH_SOURCE_MISSING', 409, '이동할 원본 파일을 찾지 못했습니다.', {
                sourceKey: entry.sourceKey
            });
        }
        if (Date.now() >= deadline) {
            await source.body.cancel().catch(() => {});
        }
        assertMigrationTimeRemaining(deadline);
        attemptedTargetKeys.add(entry.targetKey);
        const copied = await env.imgBucket.put(entry.targetKey, source.body, {
            httpMetadata: source.httpMetadata,
            customMetadata: source.customMetadata,
            storageClass: source.storageClass
        });
        if (!copied || copied.size !== source.size) {
            throw pathMigrationError('PATH_COPY_VERIFY_FAILED', 500, '복사된 파일 검증에 실패했습니다.', {
                sourceKey: entry.sourceKey,
                targetKey: entry.targetKey
            });
        }
        entry.copied = true;
        copiedCount += 1;
    });
    await updateMigration(env, migration.id, {
        manifest_json: JSON.stringify(manifest),
        copied_count: copiedCount
    });
    return copiedCount;
}

async function rollbackCopiedTargets(env, targetKeys) {
    const keys = [...targetKeys];
    for (let index = 0; index < keys.length; index += 1000) {
        const chunk = keys.slice(index, index + 1000);
        if (chunk.length) await env.imgBucket.delete(chunk);
    }
    return keys.length;
}

async function deleteManifestSources(env, migration, manifest) {
    await updateMigration(env, migration.id, { status: 'cleaning' });
    const keys = manifest.map(entry => entry.sourceKey);
    let deletedCount = 0;
    for (let index = 0; index < keys.length; index += 1000) {
        const chunk = keys.slice(index, index + 1000);
        if (chunk.length) await env.imgBucket.delete(chunk);
        deletedCount += chunk.length;
        await updateMigration(env, migration.id, { deleted_count: deletedCount });
    }
    return deletedCount;
}

async function createOrResumeMigration(env, input) {
    const existing = await env.DB.prepare('SELECT * FROM path_migrations WHERE idempotency_key = ?')
        .bind(input.idempotencyKey)
        .first();
    if (existing) {
        if (existing.entity_type !== input.entityType || existing.entity_key !== input.entityKey) {
            throw pathMigrationError('PATH_IDEMPOTENCY_CONFLICT', 409, '이미 다른 경로 변경에 사용된 요청 키입니다.');
        }
        if (existing.status === 'completed') return existing;
        if (existing.status === 'failed') {
            throw pathMigrationError('PATH_MIGRATION_RETRY_REQUIRED', 409, '이전 경로 변경은 실패했습니다. 새 요청으로 처음부터 다시 시도하세요.', {
                migrationId: existing.id
            });
        }
        throw pathMigrationError('PATH_MIGRATION_ACTIVE', 409, '같은 경로 변경 요청이 이미 진행 중입니다.', {
            migrationId: existing.id
        });
    }

    const active = await env.DB.prepare(`
        SELECT id FROM path_migrations
        WHERE entity_type = ? AND entity_key = ?
          AND status IN ('prepared', 'copying', 'committed', 'cleaning')
        LIMIT 1
    `).bind(input.entityType, input.entityKey).first();
    if (active) {
        throw pathMigrationError('PATH_MIGRATION_ACTIVE', 409, '같은 대상의 경로 변경이 이미 진행 중입니다.', {
            migrationId: active.id
        });
    }

    const timestamp = nowIso();
    const id = crypto.randomUUID();
    try {
        await env.DB.prepare(`
            INSERT INTO path_migrations (
                id, idempotency_key, entity_type, entity_key, project_id,
                old_path, new_path, status, manifest_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', '[]', ?, ?)
        `).bind(
            id,
            input.idempotencyKey,
            input.entityType,
            input.entityKey,
            input.projectId,
            input.oldPath,
            input.newPath,
            timestamp,
            timestamp
        ).run();
    } catch (error) {
        const concurrent = await env.DB.prepare(`
            SELECT id FROM path_migrations
            WHERE entity_type = ? AND entity_key = ?
              AND status IN ('prepared', 'copying', 'committed', 'cleaning')
            LIMIT 1
        `).bind(input.entityType, input.entityKey).first().catch(() => null);
        if (concurrent) {
            throw pathMigrationError('PATH_MIGRATION_ACTIVE', 409, '같은 대상의 경로 변경이 이미 진행 중입니다.', {
                migrationId: concurrent.id
            });
        }
        throw error;
    }
    return await env.DB.prepare('SELECT * FROM path_migrations WHERE id = ?').bind(id).first();
}

async function buildCharacterManifest(env, input) {
    const entries = [];
    const destinationPage = await env.imgBucket.list({ prefix: input.newPrefix, limit: 1 });
    const destinationObject = destinationPage.objects?.[0];
    if (destinationObject) {
        throw pathMigrationError('PATH_DESTINATION_EXISTS', 409, '변경할 캐릭터 경로가 이미 존재합니다.', {
            targetKey: destinationObject.key
        });
    }
    const objects = await listAllR2Objects(env.imgBucket, { prefix: input.oldPrefix });
    for (const object of objects) {
        entries.push({
            sourceKey: object.key,
            targetKey: `${input.newPrefix}${object.key.slice(input.oldPrefix.length)}`,
            size: object.size,
            etag: object.etag,
            kind: 'character-prefix'
        });
    }

    const plannerRoot = `${input.projectPrefix}_planner_temp_image/`;
    const oldPlannerPrefix = `${plannerRoot}${safePlannerRef(input.oldCharacterId || input.oldPrefix, 'character')}/`;
    const newPlannerPrefix = `${plannerRoot}${safePlannerRef(input.newCharacterId || input.newPrefix, 'character')}/`;
    if (oldPlannerPrefix !== newPlannerPrefix) {
        const plannerObjects = await listAllR2Objects(env.imgBucket, { prefix: oldPlannerPrefix });
        for (const object of plannerObjects) {
            entries.push({
                sourceKey: object.key,
                targetKey: `${newPlannerPrefix}${object.key.slice(oldPlannerPrefix.length)}`,
                size: object.size,
                etag: object.etag,
                kind: 'planner-temp'
            });
        }
    }


    const oldLegacyRef = legacyPlannerCharacterRef(input.oldCharacterId || input.oldPrefix);
    const newLegacyRef = legacyPlannerCharacterRef(input.newCharacterId || input.newPrefix);
    const oldLegacyKey = `${plannerRoot}plans/${oldLegacyRef}_planner_meta.json`;
    const newLegacyKey = `${plannerRoot}plans/${newLegacyRef}_planner_meta.json`;
    if (oldLegacyKey !== newLegacyKey) {
        const legacyObject = await env.imgBucket.head(oldLegacyKey);
        if (legacyObject) {
            entries.push({
                sourceKey: oldLegacyKey,
                targetKey: newLegacyKey,
                size: legacyObject.size,
                etag: legacyObject.etag,
                kind: 'planner-temp'
            });
        }
    }
    return uniqueManifest(entries);
}

function isDirectSituationImage(projectPrefix, key, oldStorageName) {
    if (!key.startsWith(projectPrefix)) return false;
    const relative = key.slice(projectPrefix.length);
    const parts = relative.split('/').filter(Boolean);
    if (parts.length > 2) return false;
    if (parts.length === 2 && (INTERNAL_PROJECT_FOLDERS.has(parts[0]) || parts[0].startsWith('.'))) return false;
    return replaceExactBasename(key, oldStorageName, oldStorageName, IMAGE_EXTENSIONS) !== null;
}

async function buildSituationManifest(env, input) {
    const entries = [];
    const projectObjects = await listAllR2Objects(env.imgBucket, { prefix: input.projectPrefix });
    for (const object of projectObjects) {
        if (!isDirectSituationImage(input.projectPrefix, object.key, input.oldStorageName)) continue;
        const targetKey = replaceExactBasename(object.key, input.oldStorageName, input.newStorageName, IMAGE_EXTENSIONS);
        if (!targetKey) continue;
        entries.push({
            sourceKey: object.key,
            targetKey,
            size: object.size,
            etag: object.etag,
            kind: 'situation-image'
        });
    }

    const plannerRoot = `${input.projectPrefix}_planner_temp_image/`;
    const oldPlannerPrefix = `${plannerRoot}${input.oldStorageName}/`;
    const newPlannerPrefix = `${plannerRoot}${input.newStorageName}/`;
    const plannerObjects = await listAllR2Objects(env.imgBucket, { prefix: oldPlannerPrefix });
    for (const object of plannerObjects) {
        entries.push({
            sourceKey: object.key,
            targetKey: `${newPlannerPrefix}${object.key.slice(oldPlannerPrefix.length)}`,
            size: object.size,
            etag: object.etag,
            kind: 'planner-temp'
        });
    }
    return uniqueManifest(entries);
}

function makePrefixUpdateSql(column) {
    return `${column} = ? || substr(${column}, length(?) + 1)`;
}

async function commitCharacterD1(env, migration, input, manifest) {
    const timestamp = nowIso();
    const oldFolderName = input.oldPrefix.split('/').filter(Boolean).pop() || '';
    const newFolderName = input.newPrefix.split('/').filter(Boolean).pop() || '';
    const projectName = input.projectPrefix.split('/').filter(Boolean)[0] || '';
    const planner = await prepareCharacterPathPlannerMigration(env, {
        projectId: input.projectId,
        projectPrefix: input.projectPrefix,
        oldCharacterId: input.oldCharacterId,
        newCharacterId: input.newCharacterId,
        oldPrefix: input.oldPrefix,
        newPrefix: input.newPrefix,
        manifest
    });
    const statements = [
        env.DB.prepare(`
            UPDATE json_documents
            SET object_key = ? || substr(object_key, length(?) + 1), updated_at = ?
            WHERE doc_type = 'character_meta'
              AND substr(object_key, 1, length(?)) = ?
        `).bind(input.newPrefix, input.oldPrefix, timestamp, input.oldPrefix, input.oldPrefix),
        env.DB.prepare(`
            UPDATE file_metadata
            SET folder_prefix = ? || substr(folder_prefix, length(?) + 1), updated_at = ?
            WHERE substr(folder_prefix, 1, length(?)) = ?
        `).bind(input.newPrefix, input.oldPrefix, timestamp, input.oldPrefix, input.oldPrefix),
        env.DB.prepare(`
            UPDATE aliases SET target_key = ?, updated_at = ?
            WHERE scope = 'project' AND project_name = ? AND target_key = ?
        `).bind(newFolderName, timestamp, projectName, oldFolderName),
        env.DB.prepare(`
            UPDATE v2_characters SET prefix = ?, updated_at = ?
            WHERE prefix = ? OR prefix = ?
        `).bind(input.newPrefix, timestamp, input.oldPrefix, input.oldPrefix.replace(/\/$/, '')),
        env.DB.prepare(`
            UPDATE v2_assets
            SET ${makePrefixUpdateSql('r2_key')}, updated_at = ?
            WHERE substr(r2_key, 1, length(?)) = ?
        `).bind(input.newPrefix, input.oldPrefix, timestamp, input.oldPrefix, input.oldPrefix),
        env.DB.prepare(`
            UPDATE image_editor_documents SET status = 'stale_path_migration', updated_at = ?
            WHERE status IN ('draft', 'saved')
              AND (
                  substr(source_key, 1, length(?)) = ?
                  OR substr(output_key, 1, length(?)) = ?
                  OR substr(preview_key, 1, length(?)) = ?
              )
        `).bind(
            timestamp,
            input.oldPrefix, input.oldPrefix,
            input.oldPrefix, input.oldPrefix,
            input.oldPrefix, input.oldPrefix
        ),
        ...planner.statements,
        env.DB.prepare(`UPDATE path_migrations SET status = 'committed', updated_at = ? WHERE id = ?`)
            .bind(timestamp, migration.id)
    ];
    await env.DB.batch(statements);
    return planner.summary;
}

function getSituationDocumentKey(projectPrefix) {
    return `${projectPrefix}_situations_meta.json`;
}

function getSituationStorageName(situation = {}) {
    if (situation.storageName !== undefined && situation.storageName !== null && String(situation.storageName) !== '') {
        return String(situation.storageName);
    }
    if (situation.folderName !== undefined && situation.folderName !== null && String(situation.folderName) !== '') {
        return String(situation.folderName);
    }
    return situation.imageNumber !== undefined && situation.imageNumber !== null
        ? String(situation.imageNumber)
        : '';
}

async function readSituationDocument(env, input, migration) {
    const key = getSituationDocumentKey(input.projectPrefix);
    const row = await env.DB.prepare(`
        SELECT data_json, updated_at FROM json_documents
        WHERE doc_type = 'situations_meta' AND object_key = ?
    `).bind(key).first();
    if (!row) throw pathMigrationError('SITUATION_NOT_FOUND', 404, '상황 메타데이터를 찾지 못했습니다.');
    if (input.expectedDocumentUpdatedAt && row.updated_at !== input.expectedDocumentUpdatedAt) {
        throw pathMigrationError('PATH_REVISION_CONFLICT', 409, '다른 화면에서 상황 정보가 변경되었습니다. 새로고침 후 다시 시도하세요.');
    }
    const data = parseJson(row.data_json, {});
    const situations = Array.isArray(data.situations) ? data.situations : [];
    const target = situations.find(situation => String(situation?.id || '') === input.situationId);
    if (!target) throw pathMigrationError('SITUATION_NOT_FOUND', 404, '변경할 상황을 찾지 못했습니다.');
    const currentName = getSituationStorageName(target);
    const alreadyCommitted = ['committed', 'cleaning', 'completed'].includes(migration?.status);
    if (currentName !== input.oldStorageName && !(alreadyCommitted && currentName === input.newStorageName)) {
        throw pathMigrationError('PATH_REVISION_CONFLICT', 409, '상황의 현재 경로가 요청과 다릅니다. 새로고침 후 다시 시도하세요.');
    }
    if (situations.some(situation => situation !== target
        && getSituationStorageName(situation) === input.newStorageName)) {
        throw pathMigrationError('PATH_DESTINATION_EXISTS', 409, '이미 존재하는 상황 경로입니다.');
    }
    return { key, row, data, situations, target };
}

async function commitSituationD1(env, migration, input, manifest, document) {
    const timestamp = nowIso();
    const previousDisplayName = String(document.target.name || '');
    const previousAlias = String(document.target.alias || '');
    const pathDerivedDisplayName = !previousAlias && (
        !previousDisplayName
        || previousDisplayName === input.oldStorageName
        || previousDisplayName === input.situationId
    );
    document.target.storageName = input.newStorageName;
    document.target.folderName = input.newStorageName;
    document.target.imageNumber = input.newStorageName;
    if (pathDerivedDisplayName) document.target.name = input.newStorageName;
    if (previousAlias === input.oldStorageName) document.target.alias = input.newStorageName;
    document.target.updatedAt = Date.now();
    const planner = await prepareSituationPathPlannerMigration(env, {
        projectId: input.projectId,
        situationId: input.situationId,
        oldStorageName: input.oldStorageName,
        newStorageName: input.newStorageName
    });
    const statements = [
        env.DB.prepare(`
            UPDATE json_documents SET data_json = ?, updated_at = ?
            WHERE doc_type = 'situations_meta' AND object_key = ? AND updated_at = ?
        `).bind(JSON.stringify(document.data), timestamp, document.key, document.row.updated_at),
        env.DB.prepare(`
            UPDATE v2_situations
            SET storage_name = ?, image_number = ?,
                name = CASE WHEN name = ? OR name = ? THEN ? ELSE name END,
                updated_at = ?
            WHERE id = ? AND project_id IN (?, ?)
        `).bind(
            input.newStorageName,
            input.newStorageName,
            input.oldStorageName,
            input.situationId,
            input.newStorageName,
            timestamp,
            input.situationId,
            input.projectPrefix,
            input.projectId
        ),
        ...planner.statements
    ];

    const metadataMoves = new Map();
    for (const entry of manifest.filter(item => item.kind === 'situation-image')) {
        const oldPath = splitObjectKey(entry.sourceKey);
        const newPath = splitObjectKey(entry.targetKey);
        const moveKey = `${oldPath.prefix}\u0000${oldPath.fileName}`;
        metadataMoves.set(moveKey, { oldPath, newPath });
        statements.push(env.DB.prepare(`
            UPDATE v2_assets SET r2_key = ?, file_name = ?, updated_at = ? WHERE r2_key = ?
        `).bind(entry.targetKey, newPath.fileName, timestamp, entry.sourceKey));
        statements.push(env.DB.prepare(`
            UPDATE image_editor_documents SET status = 'stale_path_migration', updated_at = ?
            WHERE status IN ('draft', 'saved') AND (source_key = ? OR output_key = ? OR preview_key = ?)
        `).bind(timestamp, entry.sourceKey, entry.sourceKey, entry.sourceKey));
    }
    for (const { oldPath, newPath } of metadataMoves.values()) {
        statements.push(env.DB.prepare(`
            UPDATE file_metadata SET file_name = ?, updated_at = ?
            WHERE folder_prefix = ? AND file_name = ?
        `).bind(newPath.fileName, timestamp, oldPath.prefix, oldPath.fileName));
    }

    const projectName = input.projectPrefix.split('/').filter(Boolean)[0] || '';
    for (const extension of IMAGE_EXTENSIONS) {
        statements.push(env.DB.prepare(`
            UPDATE aliases
            SET target_key = ?,
                alias = CASE WHEN alias = ? THEN ? ELSE alias END,
                updated_at = ?
            WHERE scope = 'project' AND project_name = ? AND target_key = ?
        `).bind(
            `${input.newStorageName}.${extension}`,
            input.oldStorageName,
            input.newStorageName,
            timestamp,
            projectName,
            `${input.oldStorageName}.${extension}`
        ));
    }
    statements.push(env.DB.prepare(`
        UPDATE path_migrations
        SET status = CASE
            WHEN EXISTS (
                SELECT 1 FROM json_documents
                WHERE doc_type = 'situations_meta' AND object_key = ? AND updated_at = ?
            ) THEN 'committed'
            ELSE NULL
        END,
        updated_at = ?
        WHERE id = ?
    `).bind(document.key, timestamp, timestamp, migration.id));
    await env.DB.batch(statements);

    const changed = await env.DB.prepare(`
        SELECT updated_at FROM json_documents
        WHERE doc_type = 'situations_meta' AND object_key = ?
    `).bind(document.key).first();
    if (!changed || changed.updated_at !== timestamp) {
        throw pathMigrationError('PATH_REVISION_CONFLICT', 409, '상황 정보가 동시에 변경되어 저장하지 못했습니다.');
    }
    return { ...planner.summary, documentUpdatedAt: timestamp };
}

async function completeMigration(env, migration, manifest, summary, entity) {
    let deletedCount;
    try {
        deletedCount = await deleteManifestSources(env, migration, manifest);
    } catch (error) {
        throw pathMigrationError(
            'PATH_SOURCE_CLEANUP_FAILED',
            500,
            '경로 정보는 변경되었지만 기존 파일 정리에 실패했습니다. 기존 파일을 수동으로 확인해 주세요.',
            {
                d1Committed: true,
                cause: error?.message || String(error)
            }
        );
    }
    const timestamp = nowIso();
    await updateMigration(env, migration.id, {
        status: 'completed',
        deleted_count: deletedCount,
        completed_at: timestamp,
        error_json: '{}'
    });
    return {
        success: true,
        entity,
        migration: {
            id: migration.id,
            status: 'completed',
            movedObjects: manifest.length,
            deletedObjects: deletedCount,
            ...summary
        }
    };
}

async function runMigration(env, migration, input, buildManifest, commitD1, entityFactory) {
    const deadline = Date.now() + PATH_MIGRATION_TIME_BUDGET_MS;
    const attemptedTargetKeys = new Set();
    let d1CommitStarted = false;
    try {
        let manifest = parseJson(migration.manifest_json, []);
        if (migration.status === 'completed') {
            return {
                success: true,
                entity: entityFactory({}),
                migration: {
                    id: migration.id,
                    status: 'completed',
                    movedObjects: manifest.length,
                    deletedObjects: migration.deleted_count || manifest.length
                }
            };
        }
        if (migration.status !== 'prepared') {
            throw pathMigrationError('PATH_MIGRATION_ACTIVE', 409, '경로 변경 요청이 이미 진행 중입니다.', {
                migrationId: migration.id
            });
        }
        assertMigrationTimeRemaining(deadline);
        manifest = await buildManifest(env, input);
        assertMigrationTimeRemaining(deadline);
        await assertNoDestinationObjects(env.imgBucket, manifest);
        await updateMigration(env, migration.id, { manifest_json: JSON.stringify(manifest) });
        assertMigrationTimeRemaining(deadline);
        await copyManifestObjects(env, migration, manifest, deadline, attemptedTargetKeys);
        assertMigrationTimeRemaining(deadline);
        d1CommitStarted = true;
        const summary = await commitD1(env, migration, input, manifest);
        return await completeMigration(env, migration, manifest, summary, entityFactory(summary));
    } catch (error) {
        error.details = { ...(error?.details || {}), migrationId: migration.id };
        const latest = await env.DB.prepare('SELECT status, copied_count FROM path_migrations WHERE id = ?')
            .bind(migration.id)
            .first()
            .catch(() => null);
        const d1Committed = d1CommitStarted || ['committed', 'cleaning'].includes(latest?.status);
        if (!d1Committed && attemptedTargetKeys.size) {
            try {
                const rolledBackCount = await rollbackCopiedTargets(env, attemptedTargetKeys);
                error.details.rollback = { success: true, deletedTargets: rolledBackCount };
            } catch (rollbackError) {
                error.details.rollback = {
                    success: false,
                    attemptedTargets: attemptedTargetKeys.size,
                    message: rollbackError?.message || String(rollbackError)
                };
            }
        }
        await updateMigration(env, migration.id, {
            status: 'failed',
            copied_count: d1Committed ? (latest?.copied_count || 0) : 0,
            error_json: JSON.stringify({
                code: error?.code || 'PATH_MIGRATION_FAILED',
                message: error?.message || String(error),
                details: error.details
            })
        }).catch(() => null);
        throw error;
    }
}

export async function changeCharacterPath(env, rawInput = {}) {
    if (!env?.DB || !env?.imgBucket) throw pathMigrationError('PATH_BINDING_MISSING', 500, 'DB 또는 R2 binding이 없습니다.');
    const projectPrefix = normalizePrefix(rawInput.projectPrefix);
    const oldPrefix = normalizePrefix(rawInput.oldPrefix);
    const newPrefix = normalizePrefix(rawInput.newPrefix);
    if (!projectPrefix || !oldPrefix.startsWith(projectPrefix) || !newPrefix.startsWith(projectPrefix)) {
        throw pathMigrationError('PATH_INVALID', 400, '캐릭터 경로가 프로젝트 범위를 벗어났습니다.');
    }
    const oldName = assertSafePathSegment(oldPrefix.slice(projectPrefix.length), 'old character path');
    const newName = assertSafePathSegment(newPrefix.slice(projectPrefix.length), 'new character path');
    if (oldName === newName) return { success: true, unchanged: true };
    const projectId = String(rawInput.projectId || projectPrefix);
    const oldCharacterId = String(rawInput.characterId || oldPrefix);
    const newCharacterId = newPrefix;
    const idempotencyKey = String(rawInput.idempotencyKey || '').trim();
    if (!idempotencyKey) throw pathMigrationError('PATH_IDEMPOTENCY_REQUIRED', 400, 'idempotencyKey가 필요합니다.');
    const input = { projectId, projectPrefix, oldPrefix, newPrefix, oldCharacterId, newCharacterId };
    const migration = await createOrResumeMigration(env, {
        idempotencyKey,
        entityType: 'character',
        entityKey: oldCharacterId,
        projectId,
        oldPath: oldPrefix,
        newPath: newPrefix
    });
    return await runMigration(
        env,
        migration,
        input,
        buildCharacterManifest,
        commitCharacterD1,
        () => ({ id: newCharacterId, prefix: newPrefix, folderName: newName })
    );
}

export async function changeSituationPath(env, rawInput = {}) {
    if (!env?.DB || !env?.imgBucket) throw pathMigrationError('PATH_BINDING_MISSING', 500, 'DB 또는 R2 binding이 없습니다.');
    const projectPrefix = normalizePrefix(rawInput.projectPrefix);
    const oldStorageName = assertSafePathSegment(rawInput.oldStorageName, 'old situation path');
    const newStorageName = assertSafePathSegment(rawInput.newStorageName, 'new situation path');
    const situationId = String(rawInput.situationId || '').trim();
    const projectId = String(rawInput.projectId || projectPrefix);
    const idempotencyKey = String(rawInput.idempotencyKey || '').trim();
    if (!projectPrefix || !situationId) throw pathMigrationError('PATH_INVALID', 400, '프로젝트와 상황 정보가 필요합니다.');
    if (!idempotencyKey) throw pathMigrationError('PATH_IDEMPOTENCY_REQUIRED', 400, 'idempotencyKey가 필요합니다.');
    if (oldStorageName === newStorageName) return { success: true, unchanged: true };
    const input = {
        projectId,
        projectPrefix,
        situationId,
        oldStorageName,
        newStorageName,
        expectedDocumentUpdatedAt: String(rawInput.expectedDocumentUpdatedAt || '')
    };
    const migration = await createOrResumeMigration(env, {
        idempotencyKey,
        entityType: 'situation',
        entityKey: `${projectId}:${situationId}`,
        projectId,
        oldPath: oldStorageName,
        newPath: newStorageName
    });
    let document = null;
    if (migration.status !== 'completed') {
        try {
            document = await readSituationDocument(env, input, migration);
        } catch (error) {
            error.details = { ...(error?.details || {}), migrationId: migration.id };
            await updateMigration(env, migration.id, {
                status: ['committed', 'cleaning'].includes(migration.status) ? migration.status : 'failed',
                error_json: JSON.stringify({
                    code: error?.code || 'PATH_MIGRATION_FAILED',
                    message: error?.message || String(error)
                })
            }).catch(() => null);
            throw error;
        }
    }
    return await runMigration(
        env,
        migration,
        input,
        buildSituationManifest,
        (targetEnv, targetMigration, targetInput, manifest) => commitSituationD1(targetEnv, targetMigration, targetInput, manifest, document),
        summary => ({
            id: situationId,
            storageName: newStorageName,
            folderName: newStorageName,
            imageNumber: newStorageName,
            updatedAt: summary.documentUpdatedAt || ''
        })
    );
}

export async function getPathMigration(env, migrationId) {
    const row = await env.DB.prepare('SELECT * FROM path_migrations WHERE id = ?').bind(migrationId).first();
    if (!row) throw pathMigrationError('PATH_MIGRATION_NOT_FOUND', 404, '경로 변경 작업을 찾지 못했습니다.');
    return {
        id: row.id,
        entityType: row.entity_type,
        entityKey: row.entity_key,
        oldPath: row.old_path,
        newPath: row.new_path,
        status: row.status,
        copiedCount: row.copied_count,
        deletedCount: row.deleted_count,
        error: parseJson(row.error_json, {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at
    };
}
