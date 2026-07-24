const IMAGE_CONTENT_TYPES = {
    webp: 'image/webp',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg'
};

const INTERNAL_PATH_PARTS = new Set([
    'logs',
    '_temp_craft',
    '_planner_temp_image',
    'editor_session',
    'editor_sessions',
    '__editor_sessions',
    '__editor_backups',
    '_guest_posts'
]);

const PUBLIC_IMAGE_CACHE_CONTROL = 'public, max-age=300, must-revalidate';
const PRIVATE_IMAGE_CACHE_CONTROL = 'private, no-store';
const NO_STORE_CACHE_CONTROL = 'no-store';

let cachedSecretValue = '';
let cachedSecretDigestPromise = null;

function getCookieValue(cookieHeader, name) {
    for (const cookie of String(cookieHeader || '').split(';')) {
        const separatorIndex = cookie.indexOf('=');
        if (separatorIndex < 0) continue;
        if (cookie.slice(0, separatorIndex).trim() === name) {
            return cookie.slice(separatorIndex + 1);
        }
    }
    return '';
}

async function digestText(value) {
    return new Uint8Array(await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(String(value || ''))
    ));
}

async function getSecretDigest(secret) {
    const normalizedSecret = String(secret || '');
    if (cachedSecretValue !== normalizedSecret || !cachedSecretDigestPromise) {
        cachedSecretValue = normalizedSecret;
        cachedSecretDigestPromise = digestText(normalizedSecret);
    }
    return cachedSecretDigestPromise;
}

async function constantTimeDigestEqual(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) {
        difference |= left[index] ^ right[index];
    }
    return difference === 0;
}

export async function isAdminImageRequest(request, env) {
    const secret = String(env?.secretKey || '');
    const cookieValue = getCookieValue(request.headers.get('Cookie'), 'auth');
    if (!secret || !cookieValue) return false;
    const [cookieDigest, secretDigest] = await Promise.all([
        digestText(cookieValue),
        getSecretDigest(secret)
    ]);
    return constantTimeDigestEqual(cookieDigest, secretDigest);
}

export function normalizeImageObjectKey(rawKey) {
    let decoded;
    try {
        decoded = decodeURIComponent(String(rawKey || '')).replace(/^\/+/, '');
    } catch {
        return '';
    }
    if (!decoded || decoded.includes('\\') || /[\x00-\x1f\x7f]/.test(decoded)) return '';
    const parts = decoded.split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) return '';
    return decoded;
}

export function isImageObjectKey(key) {
    const extension = String(key || '').split('.').pop()?.toLowerCase() || '';
    return Object.prototype.hasOwnProperty.call(IMAGE_CONTENT_TYPES, extension);
}

function isInternalImageKey(key) {
    const parts = String(key || '').split('/').map(part => part.toLowerCase());
    if (parts.some(part => INTERNAL_PATH_PARTS.has(part))) return true;
    const fileName = parts.at(-1) || '';
    return fileName.startsWith('.') || fileName.endsWith('_meta.json');
}

export function isPublicR2ImageObject(key, customMetadata = {}) {
    if (!isImageObjectKey(key) || isInternalImageKey(key)) return false;
    const visibilityWasConfigured = customMetadata?.visibilityconfigured === 'true';
    return customMetadata?.ispublic === 'true' || !visibilityWasConfigured;
}

function noStoreResponse(status = 404, body = 'Not found') {
    return new Response(body, {
        status,
        headers: {
            'Cache-Control': NO_STORE_CACHE_CONTROL,
            'X-Content-Type-Options': 'nosniff'
        }
    });
}

function imageResponse(request, object, isPublic) {
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    const extension = String(object.key || '').split('.').pop()?.toLowerCase() || '';
    const contentType = IMAGE_CONTENT_TYPES[extension];
    if (contentType) headers.set('Content-Type', contentType);
    if (object.httpEtag) headers.set('ETag', object.httpEtag);
    headers.set('Cache-Control', isPublic ? PUBLIC_IMAGE_CACHE_CONTROL : PRIVATE_IMAGE_CACHE_CONTROL);
    headers.set('X-Content-Type-Options', 'nosniff');
    if (isPublic) headers.set('Access-Control-Allow-Origin', '*');

    if (object.httpEtag && request.headers.get('If-None-Match') === object.httpEtag) {
        return new Response(null, { status: 304, headers });
    }
    const body = request.method === 'HEAD' ? null : object.body;
    return new Response(body, { headers });
}

export async function serveR2Image({
    request,
    env,
    rawKey,
    isAdmin
}) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method not allowed', {
            status: 405,
            headers: {
                'Allow': 'GET, HEAD',
                'Cache-Control': NO_STORE_CACHE_CONTROL
            }
        });
    }

    const objectKey = normalizeImageObjectKey(rawKey);
    if (!objectKey || !isImageObjectKey(objectKey)) return noStoreResponse();

    try {
        const object = request.method === 'HEAD'
            ? await env.imgBucket.head(objectKey)
            : await env.imgBucket.get(objectKey);
        if (!object) return noStoreResponse();

        const isPublic = isPublicR2ImageObject(objectKey, object.customMetadata);
        if (isPublic) return imageResponse(request, object, true);

        const hasAdminAccess = typeof isAdmin === 'boolean'
            ? isAdmin
            : await isAdminImageRequest(request, env);
        if (!hasAdminAccess) return noStoreResponse();
        return imageResponse(request, object, false);
    } catch (error) {
        console.error(JSON.stringify({
            event: 'image_serve_error',
            key: objectKey,
            message: error?.message || String(error || 'Unknown error')
        }));
        return noStoreResponse(500, 'Error');
    }
}
