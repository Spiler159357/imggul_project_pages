import { getDefaultEditedKey } from './document.js';

export function getAssetUrl(key) {
    return `/${String(key || '').split('/').map(part => encodeURIComponent(part)).join('/')}`;
}

export function loadImageFromKey(key) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('이미지 로드 실패'));
        image.src = `${getAssetUrl(key)}?_t=${Date.now()}`;
    });
}

export async function listImages(prefix = '') {
    const res = await fetch(`/api/list?prefix=${encodeURIComponent(prefix)}&_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`이미지 목록 조회 실패 (${res.status})`);
    const data = await res.json();
    return (data.files || []).filter(file => /\.(png|jpe?g|webp)$/i.test(file.key || ''));
}

export async function createOrUpdateDocument(document) {
    const res = await fetch('/api/image-editor/document?_t=' + Date.now(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ document }),
        cache: 'no-store'
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '작업문서 저장 실패');
    return res.json();
}

export async function getDocument(documentId = '', sourceKey = '') {
    const url = new URL('/api/image-editor/document', window.location.origin);
    if (documentId) url.searchParams.set('documentId', documentId);
    if (sourceKey) url.searchParams.set('sourceKey', sourceKey);
    url.searchParams.set('_t', Date.now());
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '작업문서 조회 실패');
    return res.json();
}

export async function saveEditedImage({ blob, sourceKey, outputKey, documentId, document, operationsSummary = [], mode = 'overwrite' }) {
    const endpoint = mode === 'save-as' ? '/api/image-editor/save-as' : '/api/image-editor/save';
    const form = new FormData();
    form.append('file', blob, (outputKey || getDefaultEditedKey(sourceKey)).split('/').pop() || 'edited.webp');
    form.append('sourceKey', sourceKey);
    form.append('outputKey', outputKey || sourceKey);
    form.append('documentId', documentId || '');
    form.append('document', JSON.stringify(document || {}));
    form.append('operationsSummary', JSON.stringify(operationsSummary || []));
    const res = await fetch(`${endpoint}?_t=${Date.now()}`, { method: 'POST', body: form, cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `저장 실패 (${res.status})`);
    return data;
}
