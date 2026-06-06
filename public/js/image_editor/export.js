import { drawLayer } from './layers.js';

export function renderDocumentToCanvas(editor) {
    const canvas = document.createElement('canvas');
    canvas.width = editor.state.imageWidth;
    canvas.height = editor.state.imageHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const lowerCanvas = document.createElement('canvas');
    lowerCanvas.width = canvas.width;
    lowerCanvas.height = canvas.height;
    const lowerCtx = lowerCanvas.getContext('2d');

    editor.state.layers.forEach(layer => {
        if (layer.type === 'mosaic') {
            drawLayer(ctx, layer, editor.sourceImage, lowerCanvas);
            lowerCtx.clearRect(0, 0, lowerCanvas.width, lowerCanvas.height);
            lowerCtx.drawImage(canvas, 0, 0);
            return;
        }
        drawLayer(ctx, layer, editor.sourceImage, lowerCanvas);
        lowerCtx.clearRect(0, 0, lowerCanvas.width, lowerCanvas.height);
        lowerCtx.drawImage(canvas, 0, 0);
    });
    return canvas;
}

export function exportWebP(editor, quality = 0.92) {
    const canvas = renderDocumentToCanvas(editor);
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            canvas.width = 0;
            canvas.height = 0;
            if (!blob) reject(new Error('WebP Blob 생성 실패'));
            else resolve(blob);
        }, 'image/webp', quality);
    });
}
