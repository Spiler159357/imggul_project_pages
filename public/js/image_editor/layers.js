import { createId } from './document.js';

function applyLayerAlpha(ctx, layer, draw) {
    if (!layer.visible) return;
    ctx.save();
    ctx.globalAlpha = layer.opacity ?? 1;
    draw();
    ctx.restore();
}

function applyTransform(ctx, layer) {
    const t = layer.transform || {};
    const x = Number(t.x || 0);
    const y = Number(t.y || 0);
    const scaleX = Number(t.scaleX || 1);
    const scaleY = Number(t.scaleY || 1);
    const rotation = Number(t.rotation || 0);
    ctx.translate(x, y);
    if (rotation) ctx.rotate(rotation);
    ctx.scale(scaleX, scaleY);
}

export function createRasterLayer(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return {
        id: createId('layer'),
        type: 'raster',
        name: '브러시 레이어',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'source-over',
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        bounds: { x: 0, y: 0, width, height },
        data: { canvas }
    };
}

export function createMosaicLayer(width, height, options = {}) {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = width;
    maskCanvas.height = height;
    return {
        id: createId('layer'),
        type: 'mosaic',
        name: '모자이크 레이어',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'source-over',
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        bounds: { x: 0, y: 0, width, height },
        data: {
            maskCanvas,
            blockSize: options.blockSize || 12,
            strength: options.strength ?? 1
        }
    };
}

export function createTextLayer(x, y, text, options = {}) {
    const fontSize = Number(options.fontSize || 32);
    return {
        id: createId('layer'),
        type: 'text',
        name: '텍스트',
        visible: true,
        locked: false,
        opacity: options.opacity ?? 1,
        blendMode: 'source-over',
        transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 },
        bounds: { x, y, width: Math.max(160, text.length * fontSize * 0.6), height: fontSize * 1.4 },
        data: {
            text,
            fontFamily: options.fontFamily || 'sans-serif',
            fontSize,
            color: options.color || '#ffffff',
            bold: !!options.bold,
            italic: !!options.italic,
            align: options.align || 'left'
        }
    };
}

export function createShapeLayer(x, y, width, height, options = {}) {
    return {
        id: createId('layer'),
        type: 'shape',
        name: options.type === 'ellipse' ? '타원' : options.type === 'line' ? '선' : options.type === 'arrow' ? '화살표' : '사각형',
        visible: true,
        locked: false,
        opacity: options.opacity ?? 1,
        blendMode: 'source-over',
        transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 },
        bounds: { x, y, width, height },
        data: {
            type: options.type || 'rect',
            strokeColor: options.strokeColor || '#ffffff',
            fillColor: options.fillColor || 'transparent',
            strokeWidth: Number(options.strokeWidth || 4)
        }
    };
}

export function createImageLayer(x, y, image, sourceKey = '') {
    return {
        id: createId('layer'),
        type: 'image',
        name: '추가 이미지',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'source-over',
        transform: { x, y, scaleX: 1, scaleY: 1, rotation: 0 },
        bounds: { x, y, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height },
        data: { image, sourceKey }
    };
}

export function drawLayer(ctx, layer, sourceImage, lowerCanvas = null) {
    if (!layer?.visible) return;
    if (layer.type === 'sourceImage') {
        if (sourceImage) applyLayerAlpha(ctx, layer, () => ctx.drawImage(sourceImage, 0, 0));
        return;
    }
    if (layer.type === 'raster' && layer.data?.canvas) {
        applyLayerAlpha(ctx, layer, () => ctx.drawImage(layer.data.canvas, 0, 0));
        return;
    }
    if (layer.type === 'mosaic' && layer.data?.maskCanvas && lowerCanvas) {
        drawMosaicLayer(ctx, layer, lowerCanvas);
        return;
    }
    if (layer.type === 'text') {
        applyLayerAlpha(ctx, layer, () => {
            ctx.save();
            applyTransform(ctx, layer);
            const d = layer.data || {};
            ctx.fillStyle = d.color || '#ffffff';
            ctx.font = `${d.italic ? 'italic ' : ''}${d.bold ? '700 ' : ''}${Number(d.fontSize || 32)}px ${d.fontFamily || 'sans-serif'}`;
            ctx.textBaseline = 'top';
            ctx.textAlign = d.align || 'left';
            ctx.fillText(d.text || '', 0, 0);
            ctx.restore();
        });
        return;
    }
    if (layer.type === 'shape') {
        applyLayerAlpha(ctx, layer, () => drawShape(ctx, layer));
        return;
    }
    if (layer.type === 'image' && layer.data?.image) {
        applyLayerAlpha(ctx, layer, () => {
            ctx.save();
            applyTransform(ctx, layer);
            ctx.drawImage(layer.data.image, 0, 0, layer.bounds.width, layer.bounds.height);
            ctx.restore();
        });
    }
}

function drawShape(ctx, layer) {
    const d = layer.data || {};
    const width = layer.bounds?.width || 0;
    const height = layer.bounds?.height || 0;
    ctx.save();
    applyTransform(ctx, layer);
    ctx.lineWidth = Number(d.strokeWidth || 4);
    ctx.strokeStyle = d.strokeColor || '#ffffff';
    ctx.fillStyle = d.fillColor || 'transparent';
    ctx.beginPath();
    if (d.type === 'ellipse') {
        ctx.ellipse(width / 2, height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2);
    } else if (d.type === 'line' || d.type === 'arrow') {
        ctx.moveTo(0, 0);
        ctx.lineTo(width, height);
    } else {
        ctx.rect(0, 0, width, height);
    }
    if (d.fillColor && d.fillColor !== 'transparent' && d.type !== 'line' && d.type !== 'arrow') ctx.fill();
    ctx.stroke();
    if (d.type === 'arrow') drawArrowHead(ctx, width, height);
    ctx.restore();
}

function drawArrowHead(ctx, x, y) {
    const angle = Math.atan2(y, x);
    const size = 14;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
}

function drawMosaicLayer(ctx, layer, lowerCanvas) {
    const blockSize = Math.max(2, Number(layer.data.blockSize || 12));
    const strength = Math.max(0, Math.min(1, Number(layer.data.strength ?? 1)));
    const maskCanvas = layer.data.maskCanvas;
    const temp = document.createElement('canvas');
    temp.width = lowerCanvas.width;
    temp.height = lowerCanvas.height;
    const tempCtx = temp.getContext('2d');
    tempCtx.drawImage(lowerCanvas, 0, 0);
    const imageData = tempCtx.getImageData(0, 0, temp.width, temp.height);
    const maskData = maskCanvas.getContext('2d').getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    const data = imageData.data;
    const mask = maskData.data;
    for (let y = 0; y < temp.height; y += blockSize) {
        for (let x = 0; x < temp.width; x += blockSize) {
            const sampleIndex = (y * temp.width + x) * 4;
            const r = data[sampleIndex];
            const g = data[sampleIndex + 1];
            const b = data[sampleIndex + 2];
            for (let yy = y; yy < Math.min(y + blockSize, temp.height); yy += 1) {
                for (let xx = x; xx < Math.min(x + blockSize, temp.width); xx += 1) {
                    const idx = (yy * temp.width + xx) * 4;
                    if (mask[idx + 3] === 0) continue;
                    data[idx] = data[idx] * (1 - strength) + r * strength;
                    data[idx + 1] = data[idx + 1] * (1 - strength) + g * strength;
                    data[idx + 2] = data[idx + 2] * (1 - strength) + b * strength;
                }
            }
        }
    }
    tempCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(temp, 0, 0);
}

export function hitTestLayer(layer, x, y) {
    if (!layer?.visible || layer.type === 'sourceImage') return false;
    const t = layer.transform || {};
    const bounds = layer.bounds || {};
    const lx = x - Number(t.x || 0);
    const ly = y - Number(t.y || 0);
    return lx >= 0 && ly >= 0 && lx <= Math.abs(bounds.width || 0) && ly <= Math.abs(bounds.height || 0);
}
