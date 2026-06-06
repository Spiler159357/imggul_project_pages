import { addLayer, cloneLayer, createEditorDocument, createId, deleteLayer, normalizeEditorDocument } from './document.js';
import { exportWebP } from './export.js';
import { canRedo, canUndo, createHistory, pushCommand, redo, undo } from './history.js';
import { createImageLayer, createMosaicLayer, createRasterLayer, createShapeLayer, createTextLayer, drawLayer, hitTestLayer } from './layers.js';
import { loadImageFromKey, saveEditedImage } from './storage.js';

export class ImageEditorCore {
    constructor({ canvas, previewCanvas, overlay, onChange } = {}) {
        this.canvas = canvas;
        this.previewCanvas = previewCanvas;
        this.overlay = overlay;
        this.onChange = onChange;
        this.ctx = canvas?.getContext('2d');
        this.previewCtx = previewCanvas?.getContext('2d');
        this.sourceImage = null;
        this.state = createEditorDocument();
        this.history = createHistory();
        this.drag = null;
        this.textInput = null;
        this.imageInput = null;
        this.bindEvents();
    }

    bindEvents() {
        if (!this.previewCanvas) return;
        this.previewCanvas.addEventListener('pointerdown', event => this.pointerDown(event));
        this.previewCanvas.addEventListener('pointermove', event => this.pointerMove(event));
        this.previewCanvas.addEventListener('pointerup', event => this.pointerUp(event));
        this.previewCanvas.addEventListener('pointercancel', event => this.pointerUp(event));
        window.addEventListener('resize', () => this.render());
    }

    async openSource(sourceKey, existingDocument = null) {
        this.sourceImage = await loadImageFromKey(sourceKey);
        const width = this.sourceImage.naturalWidth || this.sourceImage.width;
        const height = this.sourceImage.naturalHeight || this.sourceImage.height;
        this.state = existingDocument
            ? normalizeEditorDocument({ ...existingDocument, imageWidth: width, imageHeight: height })
            : createEditorDocument({ sourceKey, outputKey: sourceKey, width, height });
        this.hydrateSerializedLayers();
        this.history = createHistory();
        this.resizeCanvases(width, height);
        this.fitToStage();
        this.render();
        this.emitChange();
    }

    hydrateSerializedLayers() {
        this.state.layers.forEach(layer => {
            if (layer.type === 'raster' && layer.data?.dataUrl && !layer.data.canvas) {
                const canvas = document.createElement('canvas');
                canvas.width = this.state.imageWidth;
                canvas.height = this.state.imageHeight;
                const image = new Image();
                image.onload = () => {
                    canvas.getContext('2d').drawImage(image, 0, 0);
                    this.render();
                };
                image.src = layer.data.dataUrl;
                layer.data.canvas = canvas;
            }
            if (layer.type === 'mosaic' && layer.data?.maskDataUrl && !layer.data.maskCanvas) {
                const canvas = document.createElement('canvas');
                canvas.width = this.state.imageWidth;
                canvas.height = this.state.imageHeight;
                const image = new Image();
                image.onload = () => {
                    canvas.getContext('2d').drawImage(image, 0, 0);
                    this.render();
                };
                image.src = layer.data.maskDataUrl;
                layer.data.maskCanvas = canvas;
            }
            if (layer.type === 'image' && layer.data?.sourceKey && !layer.data.image) {
                loadImageFromKey(layer.data.sourceKey).then(image => {
                    layer.data.image = image;
                    this.render();
                }).catch(() => null);
            }
        });
    }

    serializeDocument() {
        const serializable = JSON.parse(JSON.stringify(this.state, (key, value) => {
            if (key === 'canvas' || key === 'maskCanvas' || key === 'image') return undefined;
            return value;
        }));
        serializable.layers = this.state.layers.map(layer => {
            const item = JSON.parse(JSON.stringify(layer, (key, value) => {
                if (key === 'canvas' || key === 'maskCanvas' || key === 'image') return undefined;
                return value;
            }));
            if (layer.type === 'raster' && layer.data?.canvas) item.data.dataUrl = layer.data.canvas.toDataURL('image/png');
            if (layer.type === 'mosaic' && layer.data?.maskCanvas) item.data.maskDataUrl = layer.data.maskCanvas.toDataURL('image/png');
            return item;
        });
        return serializable;
    }

    resizeCanvases(width, height) {
        [this.canvas, this.previewCanvas].forEach(canvas => {
            canvas.width = width;
            canvas.height = height;
        });
    }

    fitToStage() {
        const stage = this.canvas?.parentElement;
        if (!stage || !this.state.imageWidth || !this.state.imageHeight) return;
        const scaleX = Math.max(0.1, (stage.clientWidth - 48) / this.state.imageWidth);
        const scaleY = Math.max(0.1, (stage.clientHeight - 48) / this.state.imageHeight);
        this.state.zoom = Math.min(1, scaleX, scaleY);
        this.state.panX = Math.max(24, (stage.clientWidth - this.state.imageWidth * this.state.zoom) / 2);
        this.state.panY = Math.max(24, (stage.clientHeight - this.state.imageHeight * this.state.zoom) / 2);
        this.applyCanvasTransform();
    }

    applyCanvasTransform() {
        const transform = `translate(${this.state.panX}px, ${this.state.panY}px) scale(${this.state.zoom})`;
        [this.canvas, this.previewCanvas].forEach(canvas => {
            if (!canvas) return;
            canvas.style.transformOrigin = '0 0';
            canvas.style.transform = transform;
        });
    }

    render() {
        if (!this.ctx || !this.state.imageWidth) return;
        this.applyCanvasTransform();
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.previewCtx?.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
        const lowerCanvas = document.createElement('canvas');
        lowerCanvas.width = this.canvas.width;
        lowerCanvas.height = this.canvas.height;
        const lowerCtx = lowerCanvas.getContext('2d');
        this.state.layers.forEach(layer => {
            drawLayer(this.ctx, layer, this.sourceImage, lowerCanvas);
            lowerCtx.clearRect(0, 0, lowerCanvas.width, lowerCanvas.height);
            lowerCtx.drawImage(this.canvas, 0, 0);
        });
        this.drawSelection();
    }

    drawSelection() {
        if (!this.previewCtx) return;
        const id = this.state.selectedLayerIds[0];
        const layer = this.state.layers.find(item => item.id === id);
        if (!layer || layer.type === 'sourceImage') return;
        const t = layer.transform || {};
        const b = layer.bounds || {};
        this.previewCtx.save();
        this.previewCtx.strokeStyle = '#38bdf8';
        this.previewCtx.lineWidth = Math.max(2 / this.state.zoom, 1);
        this.previewCtx.setLineDash([6 / this.state.zoom, 4 / this.state.zoom]);
        this.previewCtx.strokeRect(t.x || 0, t.y || 0, b.width || 0, b.height || 0);
        this.previewCtx.restore();
    }

    setTool(tool) {
        this.state.activeTool = tool;
        this.emitChange();
    }

    setOption(tool, key, value) {
        if (!this.state.toolOptions[tool]) this.state.toolOptions[tool] = {};
        this.state.toolOptions[tool][key] = value;
        this.state.dirty = true;
        this.emitChange();
    }

    getCanvasPoint(event) {
        const rect = this.previewCanvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left) / this.state.zoom,
            y: (event.clientY - rect.top) / this.state.zoom
        };
    }

    pointerDown(event) {
        if (!this.sourceImage) return;
        const point = this.getCanvasPoint(event);
        const tool = this.state.activeTool;
        if (tool === 'brush') return this.startBrush(point);
        if (tool === 'mosaic') return this.startMosaic(point);
        if (['rect', 'ellipse', 'line', 'arrow'].includes(tool)) return this.startShape(point, tool);
        if (tool === 'text') return this.startText(point);
        if (tool === 'image') return this.openImagePicker(point);
        return this.startSelect(point);
    }

    pointerMove(event) {
        if (!this.drag) return;
        const point = this.getCanvasPoint(event);
        if (this.drag.kind === 'brush') this.drawBrush(point);
        if (this.drag.kind === 'mosaic') this.drawMosaic(point);
        if (this.drag.kind === 'move') this.moveLayer(point);
        this.render();
        if (this.drag?.kind === 'shape') this.previewShape(point);
    }

    pointerUp(event) {
        if (!this.drag) return;
        const point = this.getCanvasPoint(event);
        const drag = this.drag;
        this.drag = null;
        if (drag.kind === 'shape') this.commitShape(point, drag);
        if (drag.kind === 'brush') this.commitBitmapCommand('Brush stroke', drag.layer, drag.before, 'canvas');
        if (drag.kind === 'mosaic') this.commitBitmapCommand('Mosaic stroke', drag.layer, drag.before, 'maskCanvas');
        if (drag.kind === 'move') this.commitMoveCommand(drag.layer, drag.before);
        if (['brush', 'mosaic', 'shape', 'move'].includes(drag.kind)) {
            this.state.dirty = true;
            this.emitChange();
        }
        this.render();
    }

    startBrush(point) {
        let layer = this.state.layers.find(item => item.type === 'raster' && !item.locked);
        if (!layer) layer = addLayer(this.state, createRasterLayer(this.state.imageWidth, this.state.imageHeight));
        const before = layer.data.canvas.getContext('2d').getImageData(0, 0, layer.data.canvas.width, layer.data.canvas.height);
        this.drag = { kind: 'brush', layer, last: point, before };
        this.drawBrush(point);
    }

    drawBrush(point) {
        const { layer, last } = this.drag;
        const options = this.state.toolOptions.brush;
        const ctx = layer.data.canvas.getContext('2d');
        ctx.save();
        ctx.globalAlpha = Number(options.opacity || 1);
        ctx.strokeStyle = options.color || '#ef4444';
        ctx.lineWidth = Number(options.size || 24);
        ctx.lineCap = options.shape === 'square' ? 'butt' : 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
        ctx.restore();
        this.drag.last = point;
    }

    startMosaic(point) {
        let layer = this.state.layers.find(item => item.type === 'mosaic' && !item.locked);
        if (!layer) layer = addLayer(this.state, createMosaicLayer(this.state.imageWidth, this.state.imageHeight, this.state.toolOptions.mosaic));
        layer.data.blockSize = Number(this.state.toolOptions.mosaic.blockSize || 12);
        layer.data.strength = Number(this.state.toolOptions.mosaic.strength ?? 1);
        const before = layer.data.maskCanvas.getContext('2d').getImageData(0, 0, layer.data.maskCanvas.width, layer.data.maskCanvas.height);
        this.drag = { kind: 'mosaic', layer, last: point, before };
        this.drawMosaic(point);
    }

    drawMosaic(point) {
        const options = this.state.toolOptions.mosaic;
        const ctx = this.drag.layer.data.maskCanvas.getContext('2d');
        ctx.save();
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(point.x, point.y, Number(options.size || 48) / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    startShape(point, type) {
        this.drag = { kind: 'shape', type, start: point };
    }

    previewShape(point) {
        if (!this.previewCtx) return;
        this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
        this.drawSelection();
        const start = this.drag.start;
        this.previewCtx.save();
        this.previewCtx.strokeStyle = this.state.toolOptions.shape.strokeColor || '#ffffff';
        this.previewCtx.lineWidth = Number(this.state.toolOptions.shape.strokeWidth || 4);
        this.previewCtx.strokeRect(start.x, start.y, point.x - start.x, point.y - start.y);
        this.previewCtx.restore();
    }

    commitShape(point, drag) {
        const x = Math.min(drag.start.x, point.x);
        const y = Math.min(drag.start.y, point.y);
        const width = Math.max(8, Math.abs(point.x - drag.start.x));
        const height = Math.max(8, Math.abs(point.y - drag.start.y));
        const layer = createShapeLayer(x, y, width, height, { ...this.state.toolOptions.shape, type: drag.type });
        addLayer(this.state, layer);
        this.pushLayerCommand('Add shape layer', layer);
    }

    startText(point) {
        if (!this.overlay || this.textInput) return;
        const input = document.createElement('textarea');
        input.className = 'image-editor-text-input';
        input.style.left = `${this.state.panX + point.x * this.state.zoom}px`;
        input.style.top = `${this.state.panY + point.y * this.state.zoom}px`;
        input.style.fontSize = `${Math.max(14, this.state.toolOptions.text.fontSize * this.state.zoom)}px`;
        input.placeholder = '텍스트';
        this.overlay.appendChild(input);
        this.textInput = input;
        input.focus();
        const commit = () => {
            if (!this.textInput) return;
            const value = this.textInput.value.trim();
            this.textInput.remove();
            this.textInput = null;
            if (!value) return;
            const layer = createTextLayer(point.x, point.y, value, this.state.toolOptions.text);
            addLayer(this.state, layer);
            this.pushLayerCommand('Add text layer', layer);
            this.render();
            this.emitChange();
        };
        input.addEventListener('keydown', event => {
            if (event.isComposing) return;
            if (event.key === 'Escape') {
                input.remove();
                this.textInput = null;
            }
            if (event.key === 'Enter' && event.ctrlKey) commit();
        });
        input.addEventListener('blur', commit);
    }

    openImagePicker(point) {
        if (!this.imageInput) {
            this.imageInput = document.createElement('input');
            this.imageInput.type = 'file';
            this.imageInput.accept = 'image/*';
            this.imageInput.className = 'hidden';
            document.body.appendChild(this.imageInput);
        }
        this.imageInput.onchange = () => {
            const file = this.imageInput.files?.[0];
            if (!file) return;
            const image = new Image();
            const url = URL.createObjectURL(file);
            image.onload = () => {
                URL.revokeObjectURL(url);
                const layer = createImageLayer(point.x, point.y, image, '');
                addLayer(this.state, layer);
                this.pushLayerCommand('Add image layer', layer);
                this.render();
                this.emitChange();
            };
            image.src = url;
        };
        this.imageInput.click();
    }

    startSelect(point) {
        const layers = [...this.state.layers].reverse();
        const layer = layers.find(item => hitTestLayer(item, point.x, point.y));
        this.state.selectedLayerIds = layer ? [layer.id] : [];
        if (layer && !layer.locked) {
            this.drag = { kind: 'move', layer, start: point, before: cloneLayer(layer), x: layer.transform.x || 0, y: layer.transform.y || 0 };
        }
        this.emitChange();
        this.render();
    }

    moveLayer(point) {
        const { layer, start, x, y } = this.drag;
        layer.transform.x = x + point.x - start.x;
        layer.transform.y = y + point.y - start.y;
        layer.bounds.x = layer.transform.x;
        layer.bounds.y = layer.transform.y;
    }

    commitBitmapCommand(label, layer, before, canvasKey = 'canvas') {
        const target = layer.data[canvasKey];
        const after = target.getContext('2d').getImageData(0, 0, target.width, target.height);
        pushCommand(this.history, {
            label,
            targetLayerId: layer.id,
            apply: () => target.getContext('2d').putImageData(after, 0, 0),
            revert: () => target.getContext('2d').putImageData(before, 0, 0)
        });
    }

    commitMoveCommand(layer, before) {
        const after = cloneLayer(layer);
        pushCommand(this.history, {
            label: 'Move layer',
            targetLayerId: layer.id,
            apply: editor => Object.assign(editor.state.layers.find(item => item.id === layer.id) || {}, after),
            revert: editor => Object.assign(editor.state.layers.find(item => item.id === layer.id) || {}, before)
        });
    }

    pushLayerCommand(label, layer) {
        pushCommand(this.history, {
            label,
            targetLayerId: layer.id,
            apply: editor => {
                if (!editor.state.layers.some(item => item.id === layer.id)) editor.state.layers.push(layer);
            },
            revert: editor => {
                editor.state.layers = editor.state.layers.filter(item => item.id !== layer.id);
            }
        });
    }

    deleteSelectedLayer() {
        const layerId = this.state.selectedLayerIds[0];
        if (!layerId) return;
        const layer = this.state.layers.find(item => item.id === layerId);
        if (!layer || layer.type === 'sourceImage' || layer.locked) return;
        const snapshot = cloneLayer(layer);
        if (deleteLayer(this.state, layerId)) {
            pushCommand(this.history, {
                label: 'Delete layer',
                targetLayerId: layerId,
                apply: editor => { editor.state.layers = editor.state.layers.filter(item => item.id !== layerId); },
                revert: editor => { editor.state.layers.push(snapshot); }
            });
            this.render();
            this.emitChange();
        }
    }

    setLayerPatch(layerId, patch) {
        const layer = this.state.layers.find(item => item.id === layerId);
        if (!layer || (layer.locked && !('visible' in patch) && !('locked' in patch))) return;
        const before = cloneLayer(layer);
        Object.assign(layer, patch);
        const after = cloneLayer(layer);
        pushCommand(this.history, {
            label: 'Update layer',
            targetLayerId: layerId,
            apply: editor => Object.assign(editor.state.layers.find(item => item.id === layerId) || {}, after),
            revert: editor => Object.assign(editor.state.layers.find(item => item.id === layerId) || {}, before)
        });
        this.state.dirty = true;
        this.render();
        this.emitChange();
    }

    async save(mode = 'overwrite', outputKey = this.state.outputKey) {
        const blob = await exportWebP(this);
        const operationsSummary = [...new Set(this.state.layers.map(layer => layer.type).filter(type => type !== 'sourceImage'))];
        const result = await saveEditedImage({
            blob,
            sourceKey: this.state.sourceKey,
            outputKey: mode === 'save-as' ? outputKey : this.state.sourceKey,
            documentId: this.state.documentId,
            document: this.serializeDocument(),
            operationsSummary,
            mode: mode === 'save-as' ? 'save-as' : 'overwrite'
        });
        this.state.outputKey = result.outputKey || outputKey || this.state.sourceKey;
        this.state.dirty = false;
        this.emitChange();
        return result;
    }

    zoomBy(delta) {
        this.state.zoom = Math.max(0.1, Math.min(6, this.state.zoom + delta));
        this.applyCanvasTransform();
        this.emitChange();
    }

    handleShortcut(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return false;
        if (event.ctrlKey && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            undo(this.history, this);
            this.render();
            this.emitChange();
            return true;
        }
        if (event.ctrlKey && ['y', 'r'].includes(event.key.toLowerCase())) {
            event.preventDefault();
            redo(this.history, this);
            this.render();
            this.emitChange();
            return true;
        }
        if (event.key === 'Delete') {
            event.preventDefault();
            this.deleteSelectedLayer();
            return true;
        }
        const map = { v: 'select', b: 'brush', m: 'mosaic', t: 'text' };
        const tool = map[event.key.toLowerCase()];
        if (tool) {
            event.preventDefault();
            this.setTool(tool);
            return true;
        }
        return false;
    }

    getStatus() {
        return {
            canUndo: canUndo(this.history),
            canRedo: canRedo(this.history)
        };
    }

    emitChange() {
        this.onChange?.(this);
    }
}
