// functions/[[path]].js
import {
    cancelPlannerBackgroundJob,
    getPlannerBackgroundStatus,
    jsonResponse,
    startPlannerBackgroundJob,
    writeBackgroundErrorLog
} from "../src/planner-background.js";
// Cloudflare Pages Functions - Catch-all 라우터 및 API 서버리스 핸들러

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

function nowIso() {
    return new Date().toISOString();
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

async function writeR2Json(env, key, value) {
    await env.imgBucket.put(key, JSON.stringify(value, null, 2), {
        httpMetadata: { contentType: 'application/json; charset=utf-8' },
        customMetadata: { ispublic: 'false' }
    });
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

    const fallback = fallbackKey ? await readR2Json(env, fallbackKey, fallbackValue) : fallbackValue;
    if (fallback !== null && fallback !== undefined) {
        await putJsonDocument(env, docType, objectKey, fallback, 'r2_import');
    }
    return fallback;
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

function isMigratedR2JsonKey(key) {
    return key === '.imggul_aliases.json'
        || key.endsWith('/.aliases.json')
        || key.endsWith('_character_meta.json')
        || key.endsWith('_situations_meta.json')
        || key.endsWith('_planner_settings.json')
        || key.endsWith('_planner_meta.json')
        || key.endsWith('_meta.json');
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
    const commitVersion = (env.CF_PAGES_COMMIT_SHA || 'ccff5c7').slice(0, 7);

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
          const parts = cookie.split('=');
          cookies[parts[0].trim()] = parts[1];
        });
      }
      return cookies;
    };
    
    const cookies = getCookies(request.headers.get('Cookie'));
    const isAdmin = cookies['auth'] === secret;

    // 1. 로그인 POST 라우팅 처리
    if (path === "/login" && method === "POST") {
        try {
            const body = await request.json();
            if (body.password === secret) {
                return new Response(JSON.stringify({ success: true }), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Set-Cookie': `auth=${body.password}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`
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
            headers: { 'Location': '/', 'Set-Cookie': `auth=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` }
        });
    }

    // 3. API 라우팅 처리
    if (path === "/api/planner/background/start" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            const result = await startPlannerBackgroundJob(env, body);
            return jsonResponse(result);
        } catch (e) {
            await writeBackgroundErrorLog(env, e, {
                route: path,
                method,
                stage: "background_start_api"
            });
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/planner/background/status" && method === "GET") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const jobId = url.searchParams.get('jobId');
            if (!jobId) return jsonResponse({ error: 'jobId is required' }, { status: 400 });
            const result = await getPlannerBackgroundStatus(env, jobId);
            return jsonResponse(result);
        } catch (e) {
            await writeBackgroundErrorLog(env, e, {
                route: path,
                method,
                jobId: url.searchParams.get('jobId') || "",
                stage: "background_status_api"
            });
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/planner/background/cancel" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            if (!body?.jobId) return jsonResponse({ error: 'jobId is required' }, { status: 400 });
            const result = await cancelPlannerBackgroundJob(env, body.jobId);
            return jsonResponse(result);
        } catch (e) {
            await writeBackgroundErrorLog(env, e, {
                route: path,
                method,
                stage: "background_cancel_api"
            });
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
            await putJsonDocument(env, body.type, body.key, body.data || {});
            if (body.fallbackKey) await writeR2Json(env, body.fallbackKey, body.data || {});
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
            await ensureJsonDbSchema(env);
            await env.DB.prepare(
                'DELETE FROM json_documents WHERE doc_type = ? AND object_key = ?'
            ).bind(body.type, body.key).run();
            if (body.fallbackKey) await env.imgBucket.delete(body.fallbackKey).catch(() => null);
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

            const legacy = await readR2Json(env, `${folderPrefix}_meta.json`, {});
            for (const name of names) {
                if (legacy?.[name]) {
                    const timestamp = nowIso();
                    await env.DB.prepare(`
                        INSERT INTO file_metadata (folder_prefix, file_name, metadata_json, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(folder_prefix, file_name) DO UPDATE SET
                            metadata_json = excluded.metadata_json,
                            updated_at = excluded.updated_at
                    `).bind(folderPrefix, name, JSON.stringify(legacy[name]), timestamp, timestamp).run();
                    return jsonResponse({ data: legacy[name] });
                }
            }
            return jsonResponse({ data: null }, { status: 404 });
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

            const metaKey = `${body.folderPrefix}_meta.json`;
            const legacy = await readR2Json(env, metaKey, {});
            legacy[body.fileName] = body.metadata || {};
            await writeR2Json(env, metaKey, legacy);
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

                const metaKey = `${body.folderPrefix}_meta.json`;
                const legacy = await readR2Json(env, metaKey, {});
                fileNames.forEach(name => delete legacy[name]);
                await writeR2Json(env, metaKey, legacy);
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
            if (!metadata) {
                const legacy = await readR2Json(env, `${body.oldPrefix}_meta.json`, {});
                metadata = legacy?.[body.oldName] || null;
            }
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

                const oldLegacy = await readR2Json(env, `${body.oldPrefix}_meta.json`, {});
                delete oldLegacy[body.oldName];
                await writeR2Json(env, `${body.oldPrefix}_meta.json`, oldLegacy);
                const newLegacy = await readR2Json(env, `${body.newPrefix}_meta.json`, {});
                newLegacy[body.newName] = metadata;
                await writeR2Json(env, `${body.newPrefix}_meta.json`, newLegacy);
            }
            return jsonResponse({ success: true });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/db/migrate-r2-json" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            await ensureJsonDbSchema(env);
            const body = await request.json().catch(() => ({}));
            const dryRun = body?.dryRun !== false;
            const prefix = body?.prefix || '';
            const summary = {
                scanned: 0,
                aliases: 0,
                jsonDocuments: 0,
                fileMetadata: 0,
                skipped: 0,
                errors: []
            };

            let truncated = true;
            let cursor = undefined;
            while (truncated) {
                const list = await env.imgBucket.list({ prefix, cursor });
                truncated = list.truncated;
                cursor = list.cursor;
                for (const objectInfo of list.objects || []) {
                    const key = objectInfo.key;
                    if (!key.endsWith('.json')) continue;
                    summary.scanned += 1;
                    try {
                        const data = await readR2Json(env, key, null);
                        if (data === null || data === undefined) {
                            summary.skipped += 1;
                            continue;
                        }

                        if (key === '.imggul_aliases.json') {
                            for (const [targetKey, alias] of Object.entries(data || {})) {
                                summary.aliases += 1;
                                if (!dryRun) await putDbAlias(env, 'global', '', targetKey, alias);
                            }
                            continue;
                        }

                        if (key.endsWith('/.aliases.json')) {
                            const projectName = key.split('/')[0] || '';
                            for (const [targetKey, alias] of Object.entries(data || {})) {
                                summary.aliases += 1;
                                if (!dryRun) await putDbAlias(env, 'project', projectName, targetKey, alias);
                            }
                            continue;
                        }

                        if (key.endsWith('_character_meta.json')) {
                            summary.jsonDocuments += 1;
                            if (!dryRun) await putJsonDocument(env, 'character_meta', key, data, 'r2_migration');
                            continue;
                        }

                        if (key.endsWith('_situations_meta.json')) {
                            summary.jsonDocuments += 1;
                            if (!dryRun) await putJsonDocument(env, 'situations_meta', key, data, 'r2_migration');
                            continue;
                        }

                        if (key.endsWith('_planner_settings.json')) {
                            summary.jsonDocuments += 1;
                            if (!dryRun) await putJsonDocument(env, 'planner_settings', key, data, 'r2_migration');
                            continue;
                        }

                        if (key.endsWith('_planner_meta.json')) {
                            summary.jsonDocuments += 1;
                            if (!dryRun) await putJsonDocument(env, 'planner_meta', key, data, 'r2_migration');
                            continue;
                        }

                        if (key.endsWith('_meta.json')) {
                            const folderPrefix = key.slice(0, -'_meta.json'.length);
                            for (const [fileName, metadata] of Object.entries(data || {})) {
                                summary.fileMetadata += 1;
                                if (!dryRun) {
                                    const timestamp = nowIso();
                                    await env.DB.prepare(`
                                        INSERT INTO file_metadata (folder_prefix, file_name, metadata_json, created_at, updated_at)
                                        VALUES (?, ?, ?, ?, ?)
                                        ON CONFLICT(folder_prefix, file_name) DO UPDATE SET
                                            metadata_json = excluded.metadata_json,
                                            updated_at = excluded.updated_at
                                    `).bind(folderPrefix, fileName, JSON.stringify(metadata || {}), timestamp, timestamp).run();
                                }
                            }
                            continue;
                        }

                        summary.skipped += 1;
                    } catch (e) {
                        summary.errors.push({ key, error: e.message || String(e) });
                    }
                }
            }

            return jsonResponse({ success: true, dryRun, summary });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/db/delete-migrated-r2-json" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json().catch(() => ({}));
            const dryRun = body?.dryRun !== false;
            const prefix = body?.prefix || '';
            const summary = {
                scanned: 0,
                matched: 0,
                deleted: 0,
                skipped: 0,
                keys: [],
                errors: []
            };
            const keysToDelete = [];

            let truncated = true;
            let cursor = undefined;
            while (truncated) {
                const list = await env.imgBucket.list({ prefix, cursor });
                truncated = list.truncated;
                cursor = list.cursor;
                for (const objectInfo of list.objects || []) {
                    const key = objectInfo.key;
                    if (!key.endsWith('.json')) continue;
                    summary.scanned += 1;
                    if (!isMigratedR2JsonKey(key) || key.endsWith('.memos.json')) {
                        summary.skipped += 1;
                        continue;
                    }
                    summary.matched += 1;
                    keysToDelete.push(key);
                    if (summary.keys.length < 50) summary.keys.push(key);
                }
            }

            if (!dryRun && keysToDelete.length) {
                for (let i = 0; i < keysToDelete.length; i += 1000) {
                    const batch = keysToDelete.slice(i, i + 1000);
                    try {
                        await env.imgBucket.delete(batch);
                        summary.deleted += batch.length;
                    } catch (e) {
                        summary.errors.push({ batchStart: i, error: e.message || String(e) });
                    }
                }
            }

            return jsonResponse({ success: true, dryRun, summary });
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/aliases" && method === "GET") {
        const prefix = url.searchParams.get('prefix') || '';
        let globalAliases = {};
        let projectAliases = {};
        
        try {
            globalAliases = await getDbAliases(env, 'global', '');
        } catch(e){}

        try {
            const gObj = await env.imgBucket.get('.imggul_aliases.json');
            if (gObj) globalAliases = { ...(await gObj.json()), ...globalAliases };
        } catch(e){}

        const parts = prefix.split('/').filter(Boolean);
        if (parts.length > 0) {
            const projectName = parts[0];
            try {
                projectAliases = await getDbAliases(env, 'project', projectName);
            } catch(e){}
            try {
                const pObj = await env.imgBucket.get(`${projectName}/.aliases.json`);
                if (pObj) projectAliases = { ...(await pObj.json()), ...projectAliases };
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
                let aliases = {};
                const object = await env.imgBucket.get('.imggul_aliases.json');
                if (object) aliases = await object.json();
                
                if (newAlias) aliases[fullPath] = newAlias;
                else delete aliases[fullPath];
                await putDbAlias(env, 'global', '', fullPath, newAlias);
                
                await env.imgBucket.put('.imggul_aliases.json', JSON.stringify(aliases), {
                    httpMetadata: { contentType: 'application/json' }
                });
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
                
            } else if (parts.length > 1) {
                const projectName = parts[0];
                const targetName = parts[parts.length - 1];
                
                let aliases = {};
                const aliasPath = `${projectName}/.aliases.json`;
                const object = await env.imgBucket.get(aliasPath);
                if (object) aliases = await object.json();
                
                if (newAlias) aliases[targetName] = newAlias;
                else delete aliases[targetName];
                await putDbAlias(env, 'project', projectName, targetName, newAlias);
                
                await env.imgBucket.put(aliasPath, JSON.stringify(aliases), {
                    httpMetadata: { contentType: 'application/json' }
                });
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
                const newMetadata = { ...object.customMetadata, ispublic: isPublic ? 'true' : 'false' };
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
                    const obj = await env.imgBucket.get('.imggul_aliases.json');
                    if (obj) {
                        let aliases = await obj.json();
                        if (aliases[prefix]) {
                            delete aliases[prefix];
                            await env.imgBucket.put('.imggul_aliases.json', JSON.stringify(aliases), {
                                httpMetadata: { contentType: 'application/json' }
                            });
                        }
                    }
                    const parts = prefix.split('/').filter(Boolean);
                    if (parts.length > 1) {
                        const aliasPath = `${parts[0]}/.aliases.json`;
                        const aliasObj = await env.imgBucket.get(aliasPath);
                        if (aliasObj) {
                            let aliases = await aliasObj.json();
                            const targetName = parts[parts.length - 1];
                            if (aliases[targetName]) {
                                delete aliases[targetName];
                                await env.imgBucket.put(aliasPath, JSON.stringify(aliases), {
                                    httpMetadata: { contentType: 'application/json' }
                                });
                            }
                        }
                    }
                } catch(e){}
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
                    const obj = await env.imgBucket.get('.imggul_aliases.json');
                    if (obj) {
                        let aliases = await obj.json();
                        if (aliases[oldPrefix]) {
                            aliases[newPrefix] = aliases[oldPrefix];
                            delete aliases[oldPrefix];
                            await env.imgBucket.put('.imggul_aliases.json', JSON.stringify(aliases), {
                                httpMetadata: { contentType: 'application/json' }
                            });
                        }
                    }
                    const oldParts = oldPrefix.split('/').filter(Boolean);
                    const newParts = newPrefix.split('/').filter(Boolean);
                    if (
                        oldParts.length > 1 &&
                        newParts.length > 1 &&
                        oldParts[0] === newParts[0]
                    ) {
                        const aliasPath = `${oldParts[0]}/.aliases.json`;
                        const aliasObj = await env.imgBucket.get(aliasPath);
                        if (aliasObj) {
                            let aliases = await aliasObj.json();
                            const oldName = oldParts[oldParts.length - 1];
                            const newName = newParts[newParts.length - 1];
                            if (aliases[oldName]) {
                                aliases[newName] = aliases[oldName];
                                delete aliases[oldName];
                                await env.imgBucket.put(aliasPath, JSON.stringify(aliases), {
                                    httpMetadata: { contentType: 'application/json' }
                                });
                            }
                        }
                    }
                } catch(e){}

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
                
                try {
                    await moveAliasPrefix(env, key, newKey).catch(() => null);
                    const obj = await env.imgBucket.get('.imggul_aliases.json');
                    if (obj) {
                        let al = await obj.json();
                        if (al[key]) {
                            al[newKey] = al[key];
                            delete al[key];
                            await env.imgBucket.put('.imggul_aliases.json', JSON.stringify(al), {httpMetadata:{contentType:'application/json'}});
                        }
                    }
                } catch(e){}

                return new Response(JSON.stringify({ success: true, newKey }));
            }

            return new Response('Invalid action', { status: 400 });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    if (path === "/api/list" && method === "GET") {
        const prefix = url.searchParams.get('prefix') || '';
        
        if (!isAdmin && prefix === '') {
             return new Response(JSON.stringify({ folders: [], files: [] }), { headers: { 'Content-Type': 'application/json' } });
        }

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
                            isPublic: o.customMetadata?.ispublic === 'true'
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
            await env.imgBucket.put(finalKey, request.body, {
              httpMetadata: { contentType: request.headers.get('Content-Type') || 'application/octet-stream' },
              customMetadata: { ispublic: 'false' }
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
            objectKey = decodeURIComponent(objectKey);

            if (objectKey.endsWith('_meta.json') && !isAdmin) {
                return new Response("Forbidden: You don't have permission to access this metadata.", { status: 403 });
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
                                return new Response("Access Denied: Private Text File", { status: 403 });
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

                if (!object) return new Response("Not found", { status: 404 });

                if (isReadableTextFile(objectKey)) {
                    const isPublic = object.customMetadata?.ispublic === 'true';
                    if (!isPublic && !isAdmin) {
                        return new Response("Access Denied: Private Text File", { status: 403 });
                    }
                }

                const headers = new Headers();
                object.writeHttpMetadata(headers);
                headers.set('etag', object.httpEtag);
                headers.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=86400');
                if (isReadableTextFile(objectKey) && !headers.get('Content-Type')) {
                    headers.set('Content-Type', 'text/plain; charset=UTF-8');
                }
                return new Response(object.body, { headers });

            } catch (e) { return new Response("Error", { status: 500 }); }
        }
    }

    // 5. 비인증 접속인데 로그인 페이지 또는 루트 요청일 때 처리
    if (!isAdmin && (path === "/login" || path === "/")) {
        const loginRes = await env.ASSETS.fetch(new URL('/login.html', request.url));
        let loginHtmlText = await loginRes.text();
        return new Response(loginHtmlText.replace('{{ERROR_STYLE}}', 'none'), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    // 6. 어드민 / 게스트 뷰 동적 바인딩 및 파라미터 주입 처리
    let initialPath = path === "/" ? "" : path.slice(1);
    if (initialPath && !initialPath.endsWith('/')) initialPath += '/';
    
    let isEmpty = false;

    if (isAdmin) {
        initialPath = ''; 
    } else {
        if (initialPath !== '') {
            const list = await env.imgBucket.list({ prefix: initialPath, limit: 1 });
            isEmpty = list.objects.length === 0;
        }
    }

    const templatePath = isAdmin ? '/app.html' : '/guest.html';
    const templateRes = await env.ASSETS.fetch(new URL(templatePath, request.url));
    let htmlContent = await templateRes.text();

    htmlContent = htmlContent.replace('{{IS_ADMIN}}', isAdmin ? 'true' : 'false');
    htmlContent = htmlContent.replace('{{INITIAL_PATH}}', initialPath);
    htmlContent = htmlContent.replace('{{IS_EMPTY}}', isEmpty ? 'true' : 'false');
    htmlContent = htmlContent.replaceAll('{{APP_VERSION}}', commitVersion);
    
    return new Response(htmlContent, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
}
