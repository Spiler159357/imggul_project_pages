const IMAGE_EDITOR_VERSION = 1;

export function createId(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function splitKey(key = '') {
    const parts = String(key || '').split('/');
    const fileName = parts.pop() || '';
    return {
        prefix: parts.length ? `${parts.join('/')}/` : '',
        fileName
    };
}

export function isSupportedImageKey(key = '') {
    return /\.(png|jpe?g|webp)$/i.test(String(key || ''));
}

export function getDefaultEditedKey(sourceKey = '') {
    const { prefix, fileName } = splitKey(sourceKey);
    const baseName = (fileName || 'image').replace(/\.[^/.]+$/, '');
    return `${prefix}${baseName}_edited.webp`;
}

export function createSourceImageLayer(width, height) {
    return {
        id: 'source',
        type: 'sourceImage',
        name: '원본 이미지',
        visible: true,
        locked: true,
        opacity: 1,
        blendMode: 'source-over',
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        bounds: { x: 0, y: 0, width, height },
        data: {}
    };
}

export function createEditorDocument({ sourceKey, outputKey = sourceKey, width = 0, height = 0, documentId = '' } = {}) {
    const { prefix, fileName } = splitKey(sourceKey);
    return {
        documentId: documentId || createId('editor_doc'),
        sourceKey,
        sourcePrefix: prefix,
        sourceFileName: fileName,
        outputKey,
        imageWidth: width,
        imageHeight: height,
        documentVersion: IMAGE_EDITOR_VERSION,
        layers: [createSourceImageLayer(width, height)],
        selectedLayerIds: [],
        zoom: 1,
        panX: 0,
        panY: 0,
        activeTool: 'select',
        toolOptions: {
            brush: { size: 24, color: '#ef4444', opacity: 1, hardness: 1, shape: 'round' },
            mosaic: { size: 48, blockSize: 12, strength: 1 },
            text: { fontFamily: 'sans-serif', fontSize: 32, color: '#ffffff', bold: false, italic: false, opacity: 1, align: 'left' },
            shape: { type: 'rect', strokeColor: '#ffffff', fillColor: 'transparent', strokeWidth: 4, opacity: 1 },
            image: { opacity: 1 }
        },
        dirty: false
    };
}

export function normalizeEditorDocument(doc = {}) {
    const width = Number(doc.imageWidth || 0);
    const height = Number(doc.imageHeight || 0);
    const normalized = {
        ...createEditorDocument({
            sourceKey: doc.sourceKey || '',
            outputKey: doc.outputKey || doc.sourceKey || '',
            width,
            height,
            documentId: doc.documentId || ''
        }),
        ...doc,
        documentVersion: doc.documentVersion || IMAGE_EDITOR_VERSION,
        layers: Array.isArray(doc.layers) ? doc.layers : []
    };
    if (!normalized.layers.some(layer => layer.type === 'sourceImage')) {
        normalized.layers.unshift(createSourceImageLayer(width, height));
    }
    normalized.selectedLayerIds = Array.isArray(doc.selectedLayerIds) ? doc.selectedLayerIds : [];
    normalized.toolOptions = {
        ...createEditorDocument({ sourceKey: normalized.sourceKey, width, height }).toolOptions,
        ...(doc.toolOptions || {})
    };
    return normalized;
}

export function addLayer(doc, layer) {
    doc.layers.push(layer);
    doc.selectedLayerIds = [layer.id];
    doc.dirty = true;
    return layer;
}

export function updateLayer(doc, layerId, patch = {}) {
    const layer = doc.layers.find(item => item.id === layerId);
    if (!layer || layer.locked) return null;
    Object.assign(layer, patch);
    doc.dirty = true;
    return layer;
}

export function deleteLayer(doc, layerId) {
    const layer = doc.layers.find(item => item.id === layerId);
    if (!layer || layer.type === 'sourceImage' || layer.locked) return false;
    doc.layers = doc.layers.filter(item => item.id !== layerId);
    doc.selectedLayerIds = doc.selectedLayerIds.filter(id => id !== layerId);
    doc.dirty = true;
    return true;
}

export function cloneLayer(layer) {
    return JSON.parse(JSON.stringify(layer));
}
