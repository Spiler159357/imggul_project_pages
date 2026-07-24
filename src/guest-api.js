import { jsonResponse } from './worker-utils.js';

const IMAGE_EXTENSIONS = new Set(['webp', 'png', 'jpg', 'jpeg']);
const IMAGE_MIME_TYPES = new Set(['image/webp', 'image/png', 'image/jpeg']);
const RESERVED_PROJECT_PATHS = new Set([
    'api', 'login', 'logout', 'js', 'css', 'images', 'assets', 'favicon.ico',
    'app.html', 'guest.html', 'login.html', 'access-error.html', 'style.css'
]);
const INTERNAL_PATH_PARTS = new Set([
    'logs', '_temp_craft', '_planner_temp_image', 'editor_session',
    'editor_sessions', '__editor_sessions', '__editor_backups', '_guest_posts'
]);

const MAX_TITLE_LENGTH = 100;
const MAX_POST_BODY_LENGTH = 10000;
const MAX_AUTHOR_LENGTH = 30;
const MAX_COMMENT_BODY_LENGTH = 2000;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_IMAGE_BYTES + 128 * 1024;
const COMMENT_RATE_WINDOW_MS = 60 * 1000;
const COMMENT_RATE_LIMIT = 5;
const COMMENT_PASSWORD_SCHEME = 'sha256-v1';

class GuestApiError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function nowKstIso(date = new Date()) {
    const kstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
    const pad = value => String(value).padStart(2, '0');
    const padMs = value => String(value).padStart(3, '0');
    return `${kstDate.getUTCFullYear()}-${pad(kstDate.getUTCMonth() + 1)}-${pad(kstDate.getUTCDate())}`
        + `T${pad(kstDate.getUTCHours())}:${pad(kstDate.getUTCMinutes())}:${pad(kstDate.getUTCSeconds())}`
        + `.${padMs(kstDate.getUTCMilliseconds())}+09:00`;
}

function apiError(error) {
    if (error instanceof GuestApiError) {
        return jsonResponse({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    console.error(JSON.stringify({
        event: 'guest_api_error',
        message: error?.message || String(error || 'Unknown error')
    }));
    return jsonResponse({
        error: { code: 'INTERNAL_ERROR', message: '요청을 처리하는 중 오류가 발생했습니다.' }
    }, { status: 500 });
}

function publicJson(data, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set('Content-Type', 'application/json; charset=utf-8');
    headers.set('Cache-Control', 'public, max-age=30, must-revalidate');
    return new Response(JSON.stringify({ data }), { ...init, headers });
}

function success(data, init = {}) {
    return jsonResponse({ data }, init);
}

function decodeSegment(value) {
    try {
        return decodeURIComponent(String(value || ''));
    } catch {
        throw new GuestApiError(400, 'INVALID_PATH', '올바르지 않은 경로입니다.');
    }
}

export function normalizeGuestProjectPath(value) {
    let decoded;
    try {
        decoded = decodeURIComponent(String(value || '')).trim().replace(/^\/+|\/+$/g, '');
    } catch {
        return '';
    }
    const lower = decoded.toLowerCase();
    if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) return '';
    if (decoded.startsWith('.') || RESERVED_PROJECT_PATHS.has(lower)) return '';
    return decoded;
}

function normalizeRelativeFilePath(value) {
    const decoded = decodeSegment(value).trim().replace(/^\/+/, '');
    if (!decoded || decoded.includes('\\') || decoded.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new GuestApiError(400, 'INVALID_ASSET_PATH', '올바르지 않은 이미지 경로입니다.');
    }
    return decoded;
}

function getExtension(value) {
    return String(value || '').split('.').pop().toLowerCase();
}

function isGuestImageRelativePath(relativePath) {
    const parts = String(relativePath || '').split('/').filter(Boolean);
    if (!parts.length || parts.some(part => part.startsWith('.') || INTERNAL_PATH_PARTS.has(part))) return false;
    return IMAGE_EXTENSIONS.has(getExtension(parts[parts.length - 1]));
}

async function listAllObjects(bucket, options, maximum = 5000) {
    const objects = [];
    const prefixes = new Set();
    let cursor;
    do {
        const page = await bucket.list({ ...options, cursor, limit: Math.min(1000, maximum - objects.length) });
        for (const object of page.objects || []) objects.push(object);
        for (const prefix of page.delimitedPrefixes || []) prefixes.add(prefix);
        cursor = page.truncated && objects.length < maximum ? page.cursor : undefined;
    } while (cursor);
    return { objects, prefixes: [...prefixes] };
}

async function projectPrefixExists(env, prefix) {
    const result = await env.imgBucket.list({ prefix, limit: 1 });
    return (result.objects?.length || 0) > 0 || (result.delimitedPrefixes?.length || 0) > 0;
}

export async function resolveGuestProject(env, rawProjectPath) {
    const projectPath = normalizeGuestProjectPath(rawProjectPath);
    if (!projectPath) return null;
    const prefix = `${projectPath}/`;
    const row = await env.DB.prepare(`
        SELECT id, name, prefix
        FROM v2_projects
        WHERE prefix = ? OR prefix = ?
        LIMIT 1
    `).bind(prefix, projectPath).first();
    if (row) return { id: row.id, name: row.name || projectPath, prefix, path: projectPath };
    if (!await projectPrefixExists(env, prefix)) return null;
    return { id: projectPath, name: projectPath, prefix, path: projectPath, legacy: true };
}

async function ensureAdminProject(env, rawProjectId) {
    const decodedId = decodeSegment(rawProjectId).trim();
    if (!decodedId) throw new GuestApiError(404, 'PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.');

    let row = await env.DB.prepare(`
        SELECT id, name, prefix FROM v2_projects
        WHERE id = ? OR prefix = ? OR prefix = ?
        LIMIT 1
    `).bind(decodedId, decodedId, `${decodedId.replace(/\/+$/g, '')}/`).first();
    if (row) {
        const path = String(row.prefix || decodedId).replace(/\/+$/g, '');
        return { id: row.id, name: row.name || path, prefix: `${path}/`, path };
    }

    const projectPath = normalizeGuestProjectPath(decodedId);
    if (!projectPath || !await projectPrefixExists(env, `${projectPath}/`)) {
        throw new GuestApiError(404, 'PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
    }

    const timestamp = nowKstIso();
    await env.DB.prepare(`
        INSERT INTO v2_projects (id, name, prefix, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET prefix = excluded.prefix, updated_at = excluded.updated_at
    `).bind(projectPath, projectPath, `${projectPath}/`, timestamp, timestamp).run();
    row = { id: projectPath, name: projectPath, prefix: `${projectPath}/` };
    return { ...row, path: projectPath };
}

function normalizeCharacterPrefix(projectPrefix, characterPrefix) {
    const cleaned = String(characterPrefix || '').replace(/^\/+|\/+$/g, '');
    const projectClean = projectPrefix.replace(/\/+$/g, '');
    if (!cleaned) return '';
    if (cleaned === projectClean || cleaned.startsWith(`${projectClean}/`)) return `${cleaned}/`;
    return `${projectPrefix}${cleaned}/`;
}

function folderNameFromPrefix(prefix) {
    const parts = String(prefix || '').split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
}

async function getProjectAliases(env, project) {
    const projectName = String(project.prefix || project.path || '').split('/').filter(Boolean)[0] || '';
    if (!projectName) return {};
    try {
        const rows = (await env.DB.prepare(`
            SELECT target_key, alias
            FROM aliases
            WHERE scope = 'project' AND project_name = ?
        `).bind(projectName).all()).results || [];
        return Object.fromEntries(rows.map(row => [row.target_key, row.alias]));
    } catch {
        return {};
    }
}

async function getProjectSituations(env, project) {
    try {
        const rows = (await env.DB.prepare(`
            SELECT id, name, image_number
            FROM v2_situations
            WHERE project_id = ?
            ORDER BY sort_order ASC, image_number ASC
        `).bind(project.id).all()).results || [];
        const byImageNumber = new Map();
        const byId = new Map();
        for (const row of rows) {
            const situation = { id: String(row.id || ''), name: row.name || row.id || '', imageNumber: String(row.image_number ?? '') };
            if (situation.imageNumber) byImageNumber.set(situation.imageNumber, situation);
            if (situation.id) byId.set(situation.id, situation);
        }
        return { byImageNumber, byId };
    } catch {
        return { byImageNumber: new Map(), byId: new Map() };
    }
}

async function getProjectCharacters(env, project, aliases = {}) {
    const dbRows = (await env.DB.prepare(`
        SELECT id, name, prefix, sort_order
        FROM v2_characters
        WHERE project_id = ?
        ORDER BY sort_order ASC, name ASC
    `).bind(project.id).all()).results || [];
    const byFolder = new Map();
    for (const row of dbRows) {
        const prefix = normalizeCharacterPrefix(project.prefix, row.prefix);
        const folderName = folderNameFromPrefix(prefix);
        if (!folderName || INTERNAL_PATH_PARTS.has(folderName) || folderName.startsWith('.')) continue;
        byFolder.set(folderName, { id: row.id, name: aliases[folderName] || row.name || folderName, prefix, folderName, sortOrder: row.sort_order || 0 });
    }

    const listing = await listAllObjects(env.imgBucket, { prefix: project.prefix, delimiter: '/' }, 1000);
    for (const prefix of listing.prefixes) {
        const folderName = folderNameFromPrefix(prefix);
        if (!folderName || INTERNAL_PATH_PARTS.has(folderName) || folderName.startsWith('.')) continue;
        if (!byFolder.has(folderName)) {
            byFolder.set(folderName, { id: folderName, name: aliases[folderName] || folderName, prefix, folderName, sortOrder: Number.MAX_SAFE_INTEGER });
        }
    }

    return [...byFolder.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ko'));
}

async function getCharacterImages(env, character, situations = { byImageNumber: new Map(), byId: new Map() }, aliases = {}) {
    const listing = await listAllObjects(env.imgBucket, { prefix: character.prefix }, 5000);
    return listing.objects
        .map(object => ({ object, relativePath: object.key.slice(character.prefix.length) }))
        .filter(item => isGuestImageRelativePath(item.relativePath))
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'ko', { numeric: true }))
        .map(item => {
            const pathParts = item.relativePath.split('/').filter(Boolean);
            const fileName = pathParts.pop() || item.relativePath;
            const fileStem = fileName.replace(/\.[^.]+$/, '');
            const folderKey = pathParts[pathParts.length - 1] || '';
            const situation = situations.byImageNumber.get(fileStem)
                || situations.byId.get(folderKey)
                || situations.byId.get(fileStem);
            return {
                fileName,
                name: aliases[fileName] || aliases[folderKey] || aliases[fileStem] || situation?.name || fileName,
                situationId: situation?.id || folderKey || fileStem,
                path: item.relativePath,
                size: item.object.size,
                uploadedAt: item.object.uploaded?.toISOString?.() || null
            };
        });
}

function projectApiBase(project) {
    return `/api/guest/projects/${encodeURIComponent(project.path)}`;
}

async function getGuestProjectSummary(env, project) {
    const [aliases, situations] = await Promise.all([
        getProjectAliases(env, project),
        getProjectSituations(env, project)
    ]);
    const characters = await getProjectCharacters(env, project, aliases);
    const summaries = await Promise.all(characters.map(async character => {
        const images = await getCharacterImages(env, character, situations, aliases);
        const base = `${projectApiBase(project)}/characters/${encodeURIComponent(character.folderName)}/image`;
        return {
            id: character.folderName,
            name: character.name,
            path: character.folderName,
            imageCount: images.length,
            coverUrl: images[0] ? `${base}?file=${encodeURIComponent(images[0].path)}` : null
        };
    }));
    return { id: project.id, name: project.name, path: project.path, characters: summaries };
}

async function getCharacterByPath(env, project, rawCharacterPath, aliases = {}) {
    const characterPath = normalizeGuestProjectPath(rawCharacterPath);
    if (!characterPath) throw new GuestApiError(404, 'CHARACTER_NOT_FOUND', '캐릭터를 찾을 수 없습니다.');
    const characters = await getProjectCharacters(env, project, aliases);
    const character = characters.find(item => item.folderName === characterPath);
    if (!character) throw new GuestApiError(404, 'CHARACTER_NOT_FOUND', '캐릭터를 찾을 수 없습니다.');
    return character;
}

function objectResponse(object, {
    cacheControl = 'public, max-age=300, must-revalidate',
    method = 'GET',
    isPublic = true
} = {}) {
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    const mimeByExtension = {
        webp: 'image/webp',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg'
    };
    const safeContentType = mimeByExtension[getExtension(object.key)];
    if (safeContentType) headers.set('Content-Type', safeContentType);
    if (object.httpEtag) headers.set('ETag', object.httpEtag);
    headers.set('Cache-Control', cacheControl);
    headers.set('X-Content-Type-Options', 'nosniff');
    if (isPublic) headers.set('Access-Control-Allow-Origin', '*');
    return new Response(method === 'HEAD' ? null : object.body, { headers });
}

async function serveCharacterImage(request, env, project, rawCharacterPath) {
    const character = await getCharacterByPath(env, project, rawCharacterPath);
    const url = new URL(request.url);
    const relativePath = normalizeRelativeFilePath(url.searchParams.get('file') || '');
    if (!isGuestImageRelativePath(relativePath)) throw new GuestApiError(404, 'ASSET_NOT_FOUND', '이미지를 찾을 수 없습니다.');
    const key = `${character.prefix}${relativePath}`;
    if (!key.startsWith(character.prefix)) throw new GuestApiError(404, 'ASSET_NOT_FOUND', '이미지를 찾을 수 없습니다.');
    const object = await env.imgBucket.get(key);
    if (!object) throw new GuestApiError(404, 'ASSET_NOT_FOUND', '이미지를 찾을 수 없습니다.');
    return objectResponse(object, { method: request.method });
}

function validateText(value, label, maximum, { required = true } = {}) {
    const text = String(value ?? '').trim();
    if (required && !text) throw new GuestApiError(400, 'VALIDATION_ERROR', `${label}을(를) 입력하세요.`);
    if (text.length > maximum) throw new GuestApiError(400, 'VALIDATION_ERROR', `${label}은(는) ${maximum}자 이하여야 합니다.`);
    return text;
}

function validatePassword(value) {
    const password = String(value ?? '');
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
        throw new GuestApiError(400, 'VALIDATION_ERROR', `비밀번호는 ${MIN_PASSWORD_LENGTH}~${MAX_PASSWORD_LENGTH}자로 입력하세요.`);
    }
    return password;
}

function assertJsonRequest(request) {
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.toLowerCase().startsWith('application/json')) {
        throw new GuestApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON 요청만 허용됩니다.');
    }
}

async function readJson(request) {
    assertJsonRequest(request);
    try {
        return await request.json();
    } catch {
        throw new GuestApiError(400, 'INVALID_JSON', 'JSON 요청 본문이 올바르지 않습니다.');
    }
}

async function readPostForm(request) {
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
        throw new GuestApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'multipart/form-data 요청만 허용됩니다.');
    }
    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength > MAX_FORM_BYTES) throw new GuestApiError(413, 'PAYLOAD_TOO_LARGE', '업로드 크기가 너무 큽니다.');
    let form;
    try {
        form = await request.formData();
    } catch {
        throw new GuestApiError(400, 'INVALID_FORM', '게시글 요청 본문이 올바르지 않습니다.');
    }
    const title = validateText(form.get('title'), '제목', MAX_TITLE_LENGTH);
    const body = validateText(form.get('body'), '본문', MAX_POST_BODY_LENGTH, { required: false });
    const image = form.get('image');
    if (image && typeof image.arrayBuffer === 'function' && image.size > 0) {
        if (image.size > MAX_IMAGE_BYTES) throw new GuestApiError(413, 'IMAGE_TOO_LARGE', '이미지는 10MiB 이하여야 합니다.');
        if (!IMAGE_MIME_TYPES.has(String(image.type || '').toLowerCase()) || !IMAGE_EXTENSIONS.has(getExtension(image.name))) {
            throw new GuestApiError(400, 'INVALID_IMAGE', 'WebP, PNG, JPG 이미지만 업로드할 수 있습니다.');
        }
    }
    return {
        title,
        body,
        image: image && typeof image.arrayBuffer === 'function' && image.size > 0 ? image : null,
        removeImage: String(form.get('removeImage') || '') === 'true'
    };
}

async function putPostImage(env, project, postId, image) {
    if (!image) return null;
    const extension = getExtension(image.name) === 'jpeg' ? 'jpg' : getExtension(image.name);
    const key = `${project.prefix}_guest_posts/${postId}/image-${crypto.randomUUID()}.${extension}`;
    await env.imgBucket.put(key, await image.arrayBuffer(), {
        httpMetadata: { contentType: image.type },
        customMetadata: { ispublic: 'false', kind: 'guest-post', projectid: String(project.id), postid: postId }
    });
    return key;
}

function runCleanup(context, promise, details) {
    const guarded = promise.catch(error => {
        console.error(JSON.stringify({ event: 'guest_asset_cleanup_failed', ...details, message: error?.message || String(error) }));
    });
    if (context?.waitUntil) context.waitUntil(guarded);
    else return guarded;
    return undefined;
}

function serializeComment(row) {
    return {
        id: row.id,
        authorName: row.author_name,
        body: row.body,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        edited: row.updated_at !== row.created_at
    };
}

function serializePost(row, projectPath, { detail = false, comments = [] } = {}) {
    const imageVersion = row.image_key ? String(row.image_key).split('/').pop() : '';
    const post = {
        id: row.id,
        title: row.title,
        body: detail ? row.body : row.body.slice(0, 220),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        edited: row.updated_at !== row.created_at,
        commentCount: Number(row.comment_count || comments.length || 0),
        imageUrl: row.image_key
            ? `/api/guest/projects/${encodeURIComponent(projectPath)}/posts/${encodeURIComponent(row.id)}/image?v=${encodeURIComponent(imageVersion)}`
            : null
    };
    if (detail) post.comments = comments.map(serializeComment);
    return post;
}

function encodeCursor(row) {
    return btoa(JSON.stringify([row.created_at, row.id])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(value) {
    if (!value) return null;
    try {
        const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)));
        if (!Array.isArray(decoded) || decoded.length !== 2) throw new Error('invalid');
        return decoded.map(String);
    } catch {
        throw new GuestApiError(400, 'INVALID_CURSOR', '목록 커서가 올바르지 않습니다.');
    }
}

async function listPosts(env, project, cursorValue, limitValue = 20) {
    const limit = Math.min(Math.max(Number(limitValue) || 20, 1), 50);
    const cursor = decodeCursor(cursorValue);
    const whereCursor = cursor ? 'AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))' : '';
    const bindings = cursor ? [project.id, cursor[0], cursor[0], cursor[1], limit + 1] : [project.id, limit + 1];
    const rows = (await env.DB.prepare(`
        SELECT p.id, p.title, p.body, p.image_key, p.created_at, p.updated_at,
               COUNT(c.id) AS comment_count
        FROM guest_posts p
        LEFT JOIN guest_comments c ON c.post_id = p.id
        WHERE p.project_id = ? ${whereCursor}
        GROUP BY p.id
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ?
    `).bind(...bindings).all()).results || [];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
        items: page.map(row => serializePost(row, project.path)),
        nextCursor: hasMore && page.length ? encodeCursor(page[page.length - 1]) : null
    };
}

async function getPostForProject(env, project, postId) {
    const row = await env.DB.prepare(`
        SELECT p.*, (SELECT COUNT(*) FROM guest_comments c WHERE c.post_id = p.id) AS comment_count
        FROM guest_posts p
        WHERE p.id = ? AND p.project_id = ?
        LIMIT 1
    `).bind(decodeSegment(postId), project.id).first();
    if (!row) throw new GuestApiError(404, 'POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
    return row;
}

async function getGuestPostDetail(env, project, postId) {
    const post = await getPostForProject(env, project, postId);
    const comments = (await env.DB.prepare(`
        SELECT id, author_name, body, created_at, updated_at
        FROM guest_comments
        WHERE post_id = ?
        ORDER BY created_at ASC, id ASC
        LIMIT 500
    `).bind(post.id).all()).results || [];
    return serializePost(post, project.path, { detail: true, comments });
}

async function servePostImage(request, env, project, postId, isAdmin = false) {
    const post = await getPostForProject(env, project, postId);
    if (!post.image_key) throw new GuestApiError(404, 'ASSET_NOT_FOUND', '이미지를 찾을 수 없습니다.');
    const expectedPrefix = `${project.prefix}_guest_posts/${post.id}/`;
    if (!String(post.image_key).startsWith(expectedPrefix)) {
        throw new GuestApiError(404, 'ASSET_NOT_FOUND', '이미지를 찾을 수 없습니다.');
    }
    const object = await env.imgBucket.get(post.image_key);
    if (!object) throw new GuestApiError(404, 'ASSET_NOT_FOUND', '이미지를 찾을 수 없습니다.');
    return objectResponse(object, {
        cacheControl: isAdmin ? 'private, no-store' : undefined,
        method: request.method,
        isPublic: !isAdmin
    });
}

async function createPost(request, env, project) {
    const form = await readPostForm(request);
    const id = crypto.randomUUID();
    const timestamp = nowKstIso();
    let imageKey = null;
    try {
        imageKey = await putPostImage(env, project, id, form.image);
        await env.DB.prepare(`
            INSERT INTO guest_posts (id, project_id, title, body, image_key, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(id, project.id, form.title, form.body, imageKey, timestamp, timestamp).run();
    } catch (error) {
        if (imageKey) await env.imgBucket.delete(imageKey).catch(() => {});
        throw error;
    }
    const row = await getPostForProject(env, project, id);
    return serializePost(row, project.path, { detail: true, comments: [] });
}

async function updatePost(request, env, project, postId, context) {
    const existing = await getPostForProject(env, project, postId);
    const form = await readPostForm(request);
    let nextImageKey = existing.image_key;
    let uploadedKey = null;
    if (form.image) {
        uploadedKey = await putPostImage(env, project, existing.id, form.image);
        nextImageKey = uploadedKey;
    } else if (form.removeImage) {
        nextImageKey = null;
    }

    try {
        await env.DB.prepare(`
            UPDATE guest_posts
            SET title = ?, body = ?, image_key = ?, updated_at = ?
            WHERE id = ? AND project_id = ?
        `).bind(form.title, form.body, nextImageKey, nowKstIso(), existing.id, project.id).run();
    } catch (error) {
        if (uploadedKey && uploadedKey !== existing.image_key) await env.imgBucket.delete(uploadedKey).catch(() => {});
        throw error;
    }

    if (existing.image_key && existing.image_key !== nextImageKey) {
        runCleanup(context, env.imgBucket.delete(existing.image_key), { postId: existing.id, key: existing.image_key });
    }
    return getGuestPostDetail(env, project, existing.id);
}

async function deletePost(env, project, postId, context) {
    const existing = await getPostForProject(env, project, postId);
    await env.DB.prepare('DELETE FROM guest_posts WHERE id = ? AND project_id = ?').bind(existing.id, project.id).run();
    if (existing.image_key) runCleanup(context, env.imgBucket.delete(existing.image_key), { postId: existing.id, key: existing.image_key });
    return { id: existing.id };
}

function bytesToBase64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

async function hashPassword(password) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    return { salt: COMMENT_PASSWORD_SCHEME, hash: bytesToBase64(new Uint8Array(digest)) };
}

async function verifyPassword(password, encodedSalt, encodedHash) {
    if (encodedSalt !== COMMENT_PASSWORD_SCHEME) return false;
    const actual = await hashPassword(password);
    if (actual.hash.length !== encodedHash.length) return false;
    let difference = 0;
    for (let index = 0; index < actual.hash.length; index += 1) {
        difference |= actual.hash.charCodeAt(index) ^ encodedHash.charCodeAt(index);
    }
    return difference === 0;
}

async function hashRateLimitKey(request, projectId) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${projectId}:${ip}`));
    return bytesToBase64(new Uint8Array(digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function enforceCommentRateLimit(request, env, projectId) {
    const bucketKey = await hashRateLimitKey(request, projectId);
    const now = new Date();
    const timestamp = nowKstIso(now);
    const cutoff = nowKstIso(new Date(now.getTime() - COMMENT_RATE_WINDOW_MS));
    await env.DB.prepare(`
        INSERT INTO guest_comment_rate_limits (bucket_key, window_started_at, request_count, updated_at)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(bucket_key) DO UPDATE SET
            window_started_at = CASE WHEN window_started_at < ? THEN excluded.window_started_at ELSE window_started_at END,
            request_count = CASE WHEN window_started_at < ? THEN 1 ELSE request_count + 1 END,
            updated_at = excluded.updated_at
    `).bind(bucketKey, timestamp, timestamp, cutoff, cutoff).run();
    const row = await env.DB.prepare('SELECT request_count FROM guest_comment_rate_limits WHERE bucket_key = ?').bind(bucketKey).first();
    if (Number(row?.request_count || 0) > COMMENT_RATE_LIMIT) {
        throw new GuestApiError(429, 'RATE_LIMITED', '댓글 요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
    }
}

async function getCommentWithPost(env, commentId) {
    const row = await env.DB.prepare(`
        SELECT c.*, p.project_id
        FROM guest_comments c
        JOIN guest_posts p ON p.id = c.post_id
        WHERE c.id = ?
        LIMIT 1
    `).bind(decodeSegment(commentId)).first();
    if (!row) throw new GuestApiError(404, 'COMMENT_NOT_FOUND', '댓글을 찾을 수 없습니다.');
    return row;
}

async function createComment(request, env, project, postId) {
    const post = await getPostForProject(env, project, postId);
    const body = await readJson(request);
    const authorName = validateText(body.authorName, '이름', MAX_AUTHOR_LENGTH);
    const commentBody = validateText(body.body, '댓글', MAX_COMMENT_BODY_LENGTH);
    const password = validatePassword(body.password);
    const requestKey = validateText(body.requestId, '요청 식별자', 80);

    const duplicate = await env.DB.prepare(`
        SELECT id, author_name, body, created_at, updated_at
        FROM guest_comments WHERE post_id = ? AND request_key = ? LIMIT 1
    `).bind(post.id, requestKey).first();
    if (duplicate) return serializeComment(duplicate);

    await enforceCommentRateLimit(request, env, project.id);
    const credentials = await hashPassword(password);
    const timestamp = nowKstIso();
    const id = crypto.randomUUID();
    try {
        await env.DB.prepare(`
            INSERT INTO guest_comments (
                id, post_id, author_name, body, password_hash, password_salt,
                request_key, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(id, post.id, authorName, commentBody, credentials.hash, credentials.salt, requestKey, timestamp, timestamp).run();
    } catch (error) {
        const existing = await env.DB.prepare(`
            SELECT id, author_name, body, created_at, updated_at
            FROM guest_comments WHERE post_id = ? AND request_key = ? LIMIT 1
        `).bind(post.id, requestKey).first();
        if (existing) return serializeComment(existing);
        throw error;
    }
    return serializeComment({ id, author_name: authorName, body: commentBody, created_at: timestamp, updated_at: timestamp });
}

async function updateComment(request, env, commentId) {
    const existing = await getCommentWithPost(env, commentId);
    const body = await readJson(request);
    const password = validatePassword(body.password);
    if (!await verifyPassword(password, existing.password_salt, existing.password_hash)) {
        throw new GuestApiError(403, 'INVALID_COMMENT_PASSWORD', '댓글 비밀번호가 올바르지 않습니다.');
    }
    const authorName = validateText(body.authorName, '이름', MAX_AUTHOR_LENGTH);
    const commentBody = validateText(body.body, '댓글', MAX_COMMENT_BODY_LENGTH);
    const timestamp = nowKstIso();
    await env.DB.prepare(`
        UPDATE guest_comments SET author_name = ?, body = ?, updated_at = ?
        WHERE id = ? AND post_id = ?
    `).bind(authorName, commentBody, timestamp, existing.id, existing.post_id).run();
    return serializeComment({ ...existing, author_name: authorName, body: commentBody, updated_at: timestamp });
}

async function deleteComment(request, env, commentId, isAdmin) {
    const existing = await getCommentWithPost(env, commentId);
    if (!isAdmin) {
        const body = await readJson(request);
        const password = validatePassword(body.password);
        if (!await verifyPassword(password, existing.password_salt, existing.password_hash)) {
            throw new GuestApiError(403, 'INVALID_COMMENT_PASSWORD', '댓글 비밀번호가 올바르지 않습니다.');
        }
    }
    await env.DB.prepare('DELETE FROM guest_comments WHERE id = ? AND post_id = ?').bind(existing.id, existing.post_id).run();
    return { id: existing.id };
}

async function getAdminPostContext(env, rawPostId) {
    const row = await env.DB.prepare(`
        SELECT p.*, pr.name AS project_name, pr.prefix AS project_prefix
        FROM guest_posts p
        JOIN v2_projects pr ON pr.id = p.project_id
        WHERE p.id = ?
        LIMIT 1
    `).bind(decodeSegment(rawPostId)).first();
    if (!row) throw new GuestApiError(404, 'POST_NOT_FOUND', '게시글을 찾을 수 없습니다.');
    const path = String(row.project_prefix || '').replace(/\/+$/g, '');
    return { project: { id: row.project_id, name: row.project_name || path, prefix: `${path}/`, path }, post: row };
}

async function handleGuestProjectRoute(request, env, match) {
    const project = await resolveGuestProject(env, match[1]);
    if (!project) throw new GuestApiError(404, 'PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
    return publicJson(await getGuestProjectSummary(env, project));
}

export async function handleGuestApi(request, env, isAdmin, context) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    let match;

    try {
        match = path.match(/^\/api\/guest\/projects\/([^/]+)$/);
        if (match && method === 'GET') return await handleGuestProjectRoute(request, env, match);

        match = path.match(/^\/api\/guest\/projects\/([^/]+)\/characters\/([^/]+)$/);
        if (match && method === 'GET') {
            const project = await resolveGuestProject(env, match[1]);
            if (!project) throw new GuestApiError(404, 'PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
            const [aliases, situations] = await Promise.all([
                getProjectAliases(env, project),
                getProjectSituations(env, project)
            ]);
            const character = await getCharacterByPath(env, project, match[2], aliases);
            const images = await getCharacterImages(env, character, situations, aliases);
            const base = `${projectApiBase(project)}/characters/${encodeURIComponent(character.folderName)}/image`;
            return publicJson({
                id: character.folderName,
                name: character.name,
                path: character.folderName,
                images: images.map(image => ({ ...image, url: `${base}?file=${encodeURIComponent(image.path)}` }))
            });
        }

        match = path.match(/^\/api\/guest\/projects\/([^/]+)\/characters\/([^/]+)\/image$/);
        if (match && (method === 'GET' || method === 'HEAD')) {
            const project = await resolveGuestProject(env, match[1]);
            if (!project) throw new GuestApiError(404, 'PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
            return await serveCharacterImage(request, env, project, match[2]);
        }

        match = path.match(/^\/api\/guest\/projects\/([^/]+)\/posts$/);
        if (match && method === 'GET') {
            const project = await resolveGuestProject(env, match[1]);
            if (!project) throw new GuestApiError(404, 'PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
            return publicJson(await listPosts(env, project, url.searchParams.get('cursor'), url.searchParams.get('limit')));
        }

        match = path.match(/^\/api\/guest\/projects\/([^/]+)\/posts\/([^/]+)$/);
        if (match && method === 'GET') {
            const project = await resolveGuestProject(env, match[1]);
            if (!project) throw new GuestApiError(404, 'PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
            return publicJson(await getGuestPostDetail(env, project, match[2]));
        }

        match = path.match(/^\/api\/guest\/projects\/([^/]+)\/posts\/([^/]+)\/image$/);
        if (match && (method === 'GET' || method === 'HEAD')) {
            const project = await resolveGuestProject(env, match[1]);
            if (!project) throw new GuestApiError(404, 'PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
            return await servePostImage(request, env, project, match[2]);
        }

        match = path.match(/^\/api\/guest\/projects\/([^/]+)\/posts\/([^/]+)\/comments$/);
        if (match && method === 'POST') {
            const project = await resolveGuestProject(env, match[1]);
            if (!project) throw new GuestApiError(404, 'PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
            return success(await createComment(request, env, project, match[2]), { status: 201 });
        }

        match = path.match(/^\/api\/guest\/comments\/([^/]+)$/);
        if (match && method === 'PATCH') return success(await updateComment(request, env, match[1]));
        if (match && method === 'DELETE') return success(await deleteComment(request, env, match[1], isAdmin));

        match = path.match(/^\/api\/admin\/projects\/([^/]+)\/posts$/);
        if (match) {
            if (!isAdmin) throw new GuestApiError(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
            const project = await ensureAdminProject(env, match[1]);
            if (method === 'GET') return success(await listPosts(env, project, url.searchParams.get('cursor'), url.searchParams.get('limit')));
            if (method === 'POST') return success(await createPost(request, env, project), { status: 201 });
        }

        match = path.match(/^\/api\/admin\/posts\/([^/]+)\/image$/);
        if (match && (method === 'GET' || method === 'HEAD')) {
            if (!isAdmin) throw new GuestApiError(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
            const { project } = await getAdminPostContext(env, match[1]);
            return await servePostImage(request, env, project, match[1], true);
        }

        match = path.match(/^\/api\/admin\/posts\/([^/]+)$/);
        if (match) {
            if (!isAdmin) throw new GuestApiError(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
            const { project } = await getAdminPostContext(env, match[1]);
            if (method === 'GET') return success(await getGuestPostDetail(env, project, match[1]));
            if (method === 'PATCH') return success(await updatePost(request, env, project, match[1], context));
            if (method === 'DELETE') return success(await deletePost(env, project, match[1], context));
        }

        if (path.startsWith('/api/guest/') || /^\/api\/admin\/(?:projects\/[^/]+\/posts|posts(?:\/|$))/.test(path)) {
            throw new GuestApiError(404, 'API_NOT_FOUND', '요청한 API를 찾을 수 없습니다.');
        }
        return null;
    } catch (error) {
        return apiError(error);
    }
}
