const RESERVED_PATH_SEGMENTS = new Set([
    '_planner_temp_image',
    '_guest_posts',
    '__editor_sessions',
    '__editor_backups',
    'logs'
]);

export function normalizePathSegment(value = '') {
    return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

export function isSafePathSegment(value = '') {
    const normalized = normalizePathSegment(value);
    return Boolean(
        normalized
        && !normalized.includes('/')
        && !normalized.includes('\\')
        && !normalized.includes('..')
        && !normalized.startsWith('.')
        && !/[\x00-\x1f\x7f]/.test(normalized)
        && !RESERVED_PATH_SEGMENTS.has(normalized)
    );
}

export function assertSafePathSegment(value = '', label = 'path') {
    const normalized = normalizePathSegment(value);
    if (!isSafePathSegment(normalized)) {
        const error = new Error(`Invalid ${label}`);
        error.code = 'PATH_INVALID';
        error.status = 400;
        throw error;
    }
    return normalized;
}

export function normalizePrefix(value = '') {
    const normalized = String(value || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/{2,}/g, '/')
        .trim();
    return normalized && !normalized.endsWith('/') ? `${normalized}/` : normalized;
}

export function splitObjectKey(key = '') {
    const normalized = String(key || '').replace(/\\/g, '/');
    const slashIndex = normalized.lastIndexOf('/');
    return slashIndex >= 0
        ? { prefix: normalized.slice(0, slashIndex + 1), fileName: normalized.slice(slashIndex + 1) }
        : { prefix: '', fileName: normalized };
}

export function getFileBaseName(fileName = '') {
    return String(fileName || '').replace(/\.[^/.]+$/, '');
}

export function replaceExactBasename(key, oldName, newName, extensions = null) {
    const { prefix, fileName } = splitObjectKey(key);
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex <= 0) return null;
    const baseName = fileName.slice(0, dotIndex);
    const extension = fileName.slice(dotIndex + 1).toLowerCase();
    if (baseName !== oldName || (extensions && !extensions.has(extension))) return null;
    return `${prefix}${newName}.${fileName.slice(dotIndex + 1)}`;
}
