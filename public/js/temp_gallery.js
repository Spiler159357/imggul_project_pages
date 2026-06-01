// 6. temp_gallery.js: 임시 보관함 및 변환 유예 관리
/**
 * 역할: Vibe 참조 이미지를 초기화하고 관련 미리보기/슬라이더 UI를 숨긴다.
 * 매개변수: 없음.
 * 주요 변수: VIBE_IMAGE_FILE, vibe-image-input, vibe-sliders - 초기화할 상태와 DOM.
 * 반환값: 명시 반환 없음.
 */
export function clearVibeImage() {
    window.VIBE_IMAGE_FILE = null;
    document.getElementById('vibe-image-input').value = '';
    document.getElementById('vibe-image-preview-container').classList.add('hidden');
    document.getElementById('vibe-image-prompt').classList.remove('hidden');
    document.getElementById('vibe-sliders').classList.add('hidden');
    document.getElementById('vibe-sliders').classList.remove('flex');
    window.calculateAnlas();
}

/**
 * 역할: 업로드된 Vibe 참조 이미지를 상태에 저장하고 미리보기를 표시한다.
 * 매개변수: file - 사용자가 선택한 이미지 File 객체.
 * 주요 변수: VIBE_IMAGE_FILE, preview - 저장할 파일과 object URL 표시 대상.
 * 반환값: 명시 반환 없음. 이미지가 아니면 alert 후 종료한다.
 */
export function handleVibeImageUpload(file) {
    if (!file || !file.type.startsWith('image/')) return alert('이미지 파일만 가능합니다.');
    window.VIBE_IMAGE_FILE = file;
    const preview = document.getElementById('vibe-image-preview');
    if(preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(file);
    document.getElementById('vibe-image-preview-container').classList.remove('hidden');
    document.getElementById('vibe-image-prompt').classList.add('hidden');
    document.getElementById('vibe-sliders').classList.remove('hidden');
    document.getElementById('vibe-sliders').classList.add('flex');
    window.calculateAnlas();
}

/**
 * 역할: Precise/Director 참조 이미지를 초기화하고 관련 미리보기/슬라이더 UI를 숨긴다.
 * 매개변수: 없음.
 * 주요 변수: PRECISE_IMAGE_FILE, precise-image-input, precise-sliders - 초기화할 상태와 DOM.
 * 반환값: 명시 반환 없음.
 */
export function clearPreciseImage() {
    window.PRECISE_IMAGE_FILE = null;
    document.getElementById('precise-image-input').value = '';
    document.getElementById('precise-image-preview-container').classList.add('hidden');
    document.getElementById('precise-image-prompt').classList.remove('hidden');
    document.getElementById('precise-sliders').classList.add('hidden');
    document.getElementById('precise-sliders').classList.remove('flex');
    window.calculateAnlas();
}

/**
 * 역할: 업로드된 Precise/Director 참조 이미지를 상태에 저장하고 미리보기를 표시한다.
 * 매개변수: file - 사용자가 선택한 이미지 File 객체.
 * 주요 변수: PRECISE_IMAGE_FILE, preview - 저장할 파일과 object URL 표시 대상.
 * 반환값: 명시 반환 없음. 이미지가 아니면 alert 후 종료한다.
 */
export function handlePreciseImageUpload(file) {
    if (!file || !file.type.startsWith('image/')) return alert('이미지 파일만 가능합니다.');
    window.PRECISE_IMAGE_FILE = file;
    const preview = document.getElementById('precise-image-preview');
    if(preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(file);
    document.getElementById('precise-image-preview-container').classList.remove('hidden');
    document.getElementById('precise-image-prompt').classList.add('hidden');
    document.getElementById('precise-sliders').classList.remove('hidden');
    document.getElementById('precise-sliders').classList.add('flex');
    window.calculateAnlas();
}

/**
 * 역할: 임시 생성 보관함 목록을 서버에서 불러오고 100개 초과 파일을 백그라운드 정리한다.
 * 매개변수: 없음.
 * 주요 변수: res, data, files, toDelete, TEMP_IMAGES - API 응답과 임시 이미지 상태.
 * 반환값: 명시 반환 없음.
 */
function getInpaintCanvas() {
    return document.getElementById('inpaint-mask-canvas');
}

function getInpaintSourceUrl(source) {
    if (!source) return '';
    if (source.type === 'file') return source.objectUrl || '';
    if (source.url) return source.url;
    if (source.key) return '/' + source.key + '?t=' + Date.now();
    return '';
}

function getInpaintCanvasPoint(event) {
    const canvas = getInpaintCanvas();
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((event.clientX - rect.left) / rect.width) * canvas.width,
        y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
}

function getInpaintBrushSize() {
    return 32;
}

function getInpaintGridSize() {
    return 8;
}

function drawInpaintBlock(point) {
    const canvas = getInpaintCanvas();
    if (!canvas || !point) return;
    const ctx = canvas.getContext('2d');
    const brushSize = getInpaintBrushSize();
    const gridSize = getInpaintGridSize();
    const left = Math.floor((point.x - brushSize / 2) / gridSize) * gridSize;
    const top = Math.floor((point.y - brushSize / 2) / gridSize) * gridSize;
    const right = Math.ceil((point.x + brushSize / 2) / gridSize) * gridSize;
    const bottom = Math.ceil((point.y + brushSize / 2) / gridSize) * gridSize;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalCompositeOperation = window.INPAINT_DRAW_MODE === 'eraser' ? 'destination-out' : 'source-over';
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.restore();
}

function drawInpaintLine(from, to) {
    const canvas = getInpaintCanvas();
    if (!canvas || !from || !to) return;
    const gridSize = getInpaintGridSize();
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, gridSize / 2)));
    for (let i = 0; i <= steps; i++) {
        const ratio = i / steps;
        drawInpaintBlock({
            x: from.x + (to.x - from.x) * ratio,
            y: from.y + (to.y - from.y) * ratio
        });
    }
    window.INPAINT_MASK_READY = hasInpaintMaskPixels(canvas);
    updateInpaintSummary();
}

function setInpaintCanvasSize(width, height, keepMask = false) {
    const canvas = getInpaintCanvas();
    if (!canvas) return;
    let previous = null;
    if (keepMask && canvas.width && canvas.height && hasInpaintMaskPixels(canvas)) {
        previous = document.createElement('canvas');
        previous.width = canvas.width;
        previous.height = canvas.height;
        previous.getContext('2d').drawImage(canvas, 0, 0);
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    if (previous) ctx.drawImage(previous, 0, 0, width, height);
    window.INPAINT_MASK_READY = hasInpaintMaskPixels(canvas);
    updateInpaintSummary();
}

function hasInpaintMaskPixels(canvas) {
    if (!canvas || !canvas.width || !canvas.height) return false;
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) return true;
    }
    return false;
}

function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('인페인트 이미지를 불러오지 못했습니다.'));
        img.src = url;
    });
}

function canvasToPngBase64(canvas) {
    return canvas.toDataURL('image/png').split(',')[1];
}

function updateInpaintSummary() {
    const source = window.INPAINT_IMAGE_SOURCE;
    const prompt = document.getElementById('inpaint-image-prompt');
    const summary = document.getElementById('inpaint-selected-summary');
    const thumb = document.getElementById('inpaint-selected-thumb');
    const name = document.getElementById('inpaint-selected-name');
    const status = document.getElementById('inpaint-mask-status');
    if (!source) {
        if (prompt) prompt.classList.remove('hidden');
        if (summary) { summary.classList.add('hidden'); summary.classList.remove('flex'); }
        return;
    }
    if (prompt) prompt.classList.add('hidden');
    if (summary) { summary.classList.remove('hidden'); summary.classList.add('flex'); }
    if (thumb) thumb.src = getInpaintSourceUrl(source);
    if (name) name.textContent = source.name || source.key || '선택된 이미지';
    if (status) {
        if (window.INPAINT_MASK_READY) {
            status.textContent = '마스크 준비됨';
            status.className = 'text-[10px] text-emerald-600 dark:text-emerald-400';
        } else {
            status.textContent = '마스크가 필요합니다';
            status.className = 'text-[10px] text-amber-600 dark:text-amber-400';
        }
    }
}

function setInpaintSource(source) {
    if (window.INPAINT_IMAGE_OBJECT_URL && source.objectUrl !== window.INPAINT_IMAGE_OBJECT_URL) {
        URL.revokeObjectURL(window.INPAINT_IMAGE_OBJECT_URL);
    }
    window.INPAINT_IMAGE_SOURCE = source;
    window.INPAINT_IMAGE_FILE = source.type === 'file' ? source.file : null;
    window.INPAINT_IMAGE_OBJECT_URL = source.type === 'file' ? source.objectUrl : null;
    clearInpaintMask();
    updateInpaintSummary();
    openInpaintEditorModal();
}

export function clearInpaintMask() {
    const canvas = getInpaintCanvas();
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    window.INPAINT_MASK_READY = false;
    updateInpaintSummary();
}

export function clearInpaintImage() {
    window.INPAINT_IMAGE_FILE = null;
    window.INPAINT_IMAGE_SOURCE = null;
    const input = document.getElementById('inpaint-image-input');
    const preview = document.getElementById('inpaint-image-preview');
    const thumb = document.getElementById('inpaint-selected-thumb');
    if (input) input.value = '';
    if (window.INPAINT_IMAGE_OBJECT_URL) URL.revokeObjectURL(window.INPAINT_IMAGE_OBJECT_URL);
    window.INPAINT_IMAGE_OBJECT_URL = null;
    if (preview) preview.src = '';
    if (thumb) thumb.src = '';
    window.clearInpaintMask();
    updateInpaintSummary();
}

export function setInpaintDrawMode(mode) {
    window.INPAINT_DRAW_MODE = mode === 'eraser' ? 'eraser' : 'brush';
    const brushBtn = document.getElementById('inpaint-brush-btn');
    const eraserBtn = document.getElementById('inpaint-eraser-btn');
    const active = ['bg-indigo-600', 'border-indigo-600', 'text-white'];
    const inactive = ['bg-white', 'dark:bg-gray-800', 'border-gray-200', 'dark:border-gray-700', 'text-gray-500', 'dark:text-gray-400'];
    if (brushBtn && eraserBtn) {
        brushBtn.classList.remove(...active, ...inactive);
        eraserBtn.classList.remove(...active, ...inactive);
        if (window.INPAINT_DRAW_MODE === 'brush') {
            brushBtn.classList.add(...active);
            eraserBtn.classList.add(...inactive);
        } else {
            eraserBtn.classList.add(...active);
            brushBtn.classList.add(...inactive);
        }
    }
}

export function handleInpaintPointerDown(event) {
    if (!window.INPAINT_IMAGE_SOURCE) return;
    event.preventDefault();
    const point = getInpaintCanvasPoint(event);
    window.INPAINT_IS_DRAWING = true;
    window.INPAINT_LAST_POINT = point;
    drawInpaintLine(point, point);
    getInpaintCanvas()?.setPointerCapture?.(event.pointerId);
}

export function handleInpaintPointerMove(event) {
    if (!window.INPAINT_IS_DRAWING) return;
    event.preventDefault();
    const point = getInpaintCanvasPoint(event);
    drawInpaintLine(window.INPAINT_LAST_POINT, point);
    window.INPAINT_LAST_POINT = point;
}

export function handleInpaintPointerUp(event) {
    if (!window.INPAINT_IS_DRAWING) return;
    event.preventDefault();
    window.INPAINT_IS_DRAWING = false;
    window.INPAINT_LAST_POINT = null;
    window.INPAINT_MASK_READY = hasInpaintMaskPixels(getInpaintCanvas());
    updateInpaintSummary();
    getInpaintCanvas()?.releasePointerCapture?.(event.pointerId);
}

export function handleInpaintImageUpload(file) {
    if (!file || !file.type.startsWith('image/')) return alert('이미지 파일만 인페인트 기준 이미지로 사용할 수 있습니다.');
    const objectUrl = URL.createObjectURL(file);
    setInpaintSource({ type: 'file', file, objectUrl, name: file.name });
}

export function openInpaintEditorModal() {
    const source = window.INPAINT_IMAGE_SOURCE;
    if (!source) return alert('먼저 인페인트 기준 이미지를 선택해 주세요.');
    const modal = document.getElementById('inpaint-editor-modal');
    const preview = document.getElementById('inpaint-image-preview');
    if (!modal || !preview) return;
    preview.onload = () => setInpaintCanvasSize(preview.naturalWidth, preview.naturalHeight, true);
    preview.src = getInpaintSourceUrl(source);
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setInpaintDrawMode(window.INPAINT_DRAW_MODE);
    if (window.lucide) window.lucide.createIcons();
    history.pushState({ modal: 'inpaint-editor' }, '', '#inpaint-editor');
}

export function closeInpaintEditorModal(e, skipHistory = false) {
    if (e && e.target !== e.currentTarget && e.target.id !== 'close-inpaint-editor-btn') return;
    const modal = document.getElementById('inpaint-editor-modal');
    if (modal && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        window.INPAINT_IS_DRAWING = false;
        window.INPAINT_LAST_POINT = null;
        window.INPAINT_MASK_READY = hasInpaintMaskPixels(getInpaintCanvas());
        updateInpaintSummary();
        if (!skipHistory) history.back();
    }
}

export async function openInpaintLibraryModal(mode = 'main') {
    window.INPAINT_LIBRARY_MODE = mode === 'temp' ? 'temp' : 'main';
    window.INPAINT_LIBRARY_BASE_PREFIX = window.INPAINT_LIBRARY_MODE === 'temp' ? window.TEMP_FOLDER : (window.ROOT_PATH || '');
    const modal = document.getElementById('inpaint-library-modal');
    const title = document.getElementById('inpaint-library-title');
    if (!modal) return;
    if (title) title.textContent = window.INPAINT_LIBRARY_MODE === 'temp' ? '임시 저장소에서 선택' : '메인 저장소에서 선택';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    history.pushState({ modal: 'inpaint-library' }, '', '#inpaint-library');
    await loadInpaintLibraryPath(window.INPAINT_LIBRARY_BASE_PREFIX);
}

export function closeInpaintLibraryModal(e, skipHistory = false) {
    if (e && e.target !== e.currentTarget && e.target.id !== 'close-inpaint-library-btn') return;
    const modal = document.getElementById('inpaint-library-modal');
    if (modal && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        if (window.PLANNER_REFERENCE_TARGET) window.PLANNER_REFERENCE_TARGET = null;
        if (!skipHistory) history.back();
    }
}

export async function loadInpaintLibraryPath(prefix) {
    window.INPAINT_LIBRARY_CURRENT_PREFIX = prefix;
    const pathDisplay = document.getElementById('inpaint-library-path');
    const grid = document.getElementById('inpaint-library-grid');
    const loader = document.getElementById('inpaint-library-loading');
    const emptyState = document.getElementById('inpaint-library-empty');
    if (!grid || !loader || !emptyState) return;
    if (pathDisplay) pathDisplay.textContent = '/' + prefix;
    grid.innerHTML = '';
    grid.classList.add('hidden');
    emptyState.classList.add('hidden');
    emptyState.classList.remove('flex');
    loader.classList.remove('hidden');
    loader.classList.add('flex');

    try {
        const [listRes, aliasRes] = await Promise.all([
            fetch(`/api/list?prefix=${encodeURIComponent(prefix)}&_t=${Date.now()}`),
            fetch(`/api/aliases?prefix=${encodeURIComponent(prefix)}&_t=${Date.now()}`)
        ]);
        if (!listRes.ok) throw new Error('이미지 목록을 불러오지 못했습니다.');
        if (aliasRes.ok) {
            const aliasData = await aliasRes.json();
            window.GLOBAL_ALIASES = aliasData.global || {};
            window.PROJECT_ALIASES = aliasData.project || {};
        }
        const data = await listRes.json();
        const folders = data.folders || [];
        const files = (data.files || [])
            .filter(f => !f.key.endsWith('.keep') && !f.key.endsWith('.txt') && !f.key.endsWith('_meta.json'))
            .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f.key.split('/').pop()))
            .sort((a, b) => b.key.split('/').pop().localeCompare(a.key.split('/').pop()));

        if (prefix !== window.INPAINT_LIBRARY_BASE_PREFIX && prefix.length > window.INPAINT_LIBRARY_BASE_PREFIX.length && prefix.startsWith(window.INPAINT_LIBRARY_BASE_PREFIX)) {
            const parts = prefix.split('/').filter(Boolean);
            parts.pop();
            const parentPrefix = parts.length > 0 ? parts.join('/') + '/' : window.INPAINT_LIBRARY_BASE_PREFIX;
            const div = document.createElement('div');
            div.className = 'relative w-full aspect-[3/4] bg-gray-200 dark:bg-gray-700 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-600 transition border border-gray-300 dark:border-gray-600 shadow-sm';
            div.onclick = () => loadInpaintLibraryPath(parentPrefix);
            div.innerHTML = `<i data-lucide="corner-left-up" class="w-8 h-8 text-gray-500 mb-2"></i><span class="text-xs font-bold text-gray-600 dark:text-gray-300">상위 폴더</span>`;
            grid.appendChild(div);
        }

        folders.forEach(folderPrefix => {
            const folderName = folderPrefix.split('/').filter(Boolean).pop();
            const alias = window.getAliasOnly ? window.getAliasOnly(folderPrefix, true) : '';
            const div = document.createElement('div');
            div.className = 'relative w-full aspect-[3/4] bg-yellow-50 dark:bg-yellow-900/20 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-yellow-100 dark:hover:bg-yellow-900/40 transition border border-yellow-200 dark:border-yellow-700/50 shadow-sm p-2';
            div.onclick = () => loadInpaintLibraryPath(folderPrefix);
            div.innerHTML = `
                <i data-lucide="folder" class="w-10 h-10 text-yellow-500 fill-current mb-2"></i>
                <div class="flex flex-col items-center w-full overflow-hidden px-1">
                    <span class="text-xs font-bold text-yellow-800 dark:text-yellow-200 truncate w-full text-center">${alias || folderName}</span>
                    ${alias ? `<span class="text-[9px] text-yellow-600/70 dark:text-yellow-400/70 truncate w-full text-center">(${folderName})</span>` : ''}
                </div>
            `;
            grid.appendChild(div);
        });

        files.forEach(file => {
            const fileName = file.key.split('/').pop();
            const alias = window.getAliasOnly ? window.getAliasOnly(file.key, false) : '';
            const fileUrl = '/' + file.key + '?t=' + (file.uploaded ? new Date(file.uploaded).getTime() : Date.now());
            const div = document.createElement('div');
            div.className = 'relative w-full aspect-[3/4] bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden shadow-sm border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-indigo-500 hover:ring-2 hover:ring-indigo-500/50 transition-all group';
            div.onclick = () => setInpaintImageFromKey(file.key, file.uploaded);
            div.innerHTML = `
                <img src="${fileUrl}" class="absolute inset-0 object-cover w-full h-full transition-opacity duration-200 opacity-80 group-hover:opacity-100" loading="lazy">
                <div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-2 flex flex-col items-center">
                    <span class="text-[10px] text-white truncate w-full text-center font-medium">${alias || fileName}</span>
                    ${alias ? `<span class="text-[8px] text-gray-300 truncate w-full text-center">(${fileName})</span>` : ''}
                </div>
            `;
            grid.appendChild(div);
        });

        if (grid.children.length === 0) {
            emptyState.classList.remove('hidden');
            emptyState.classList.add('flex');
        } else {
            grid.classList.remove('hidden');
        }
        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        alert(err.message);
        emptyState.classList.remove('hidden');
        emptyState.classList.add('flex');
    } finally {
        loader.classList.add('hidden');
        loader.classList.remove('flex');
    }
}

export function setInpaintImageFromKey(key, uploaded) {
    if (window.PLANNER_REFERENCE_TARGET && window.setPlannerReferenceImageFromKey) {
        window.setPlannerReferenceImageFromKey(key);
        closeInpaintLibraryModal(null, true);
        return;
    }
    const fileName = key.split('/').pop();
    const url = '/' + key + '?t=' + (uploaded ? new Date(uploaded).getTime() : Date.now());
    closeInpaintLibraryModal(null, true);
    setInpaintSource({ type: 'key', key, url, name: fileName });
}

export async function prepareInpaintPayload(width, height) {
    if (!window.INPAINT_IMAGE_SOURCE) return null;
    const maskCanvas = getInpaintCanvas();
    if (!hasInpaintMaskPixels(maskCanvas)) throw new Error('인페인트 마스크가 비어 있습니다. 편집기에서 재생성할 영역을 칠해 주세요.');

    const sourceImage = await loadImageFromUrl(getInpaintSourceUrl(window.INPAINT_IMAGE_SOURCE));
    const imageCanvas = document.createElement('canvas');
    imageCanvas.width = width;
    imageCanvas.height = height;
    imageCanvas.getContext('2d').drawImage(sourceImage, 0, 0, width, height);

    const scaledMask = document.createElement('canvas');
    scaledMask.width = width;
    scaledMask.height = height;
    const maskCtx = scaledMask.getContext('2d');
    maskCtx.imageSmoothingEnabled = false;
    maskCtx.fillStyle = '#000';
    maskCtx.fillRect(0, 0, width, height);
    maskCtx.drawImage(maskCanvas, 0, 0, width, height);

    const imageData = maskCtx.getImageData(0, 0, width, height);
    for (let i = 0; i < imageData.data.length; i += 4) {
        const masked = imageData.data[i] > 0 || imageData.data[i + 1] > 0 || imageData.data[i + 2] > 0;
        imageData.data[i] = masked ? 255 : 0;
        imageData.data[i + 1] = masked ? 255 : 0;
        imageData.data[i + 2] = masked ? 255 : 0;
        imageData.data[i + 3] = 255;
    }
    maskCtx.putImageData(imageData, 0, 0);

    const strength = parseFloat(document.getElementById('inpaint-strength')?.value) || 1;
    return {
        image: canvasToPngBase64(imageCanvas),
        mask: canvasToPngBase64(scaledMask),
        strength: Math.min(1, Math.max(0.01, strength))
    };
}

export async function loadTempImages() {
    try {
        const res = await fetch(`/api/list?prefix=${encodeURIComponent(window.TEMP_FOLDER)}&_t=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        let files = data.files.filter(f => !f.key.endsWith('.keep') && !f.key.endsWith('.txt') && !f.key.endsWith('_meta.json'));
        files.sort((a, b) => {
            const nameA = a.key.split('/').pop(); const nameB = b.key.split('/').pop(); return nameB.localeCompare(nameA);
        });

        if (files.length > 100) {
            const toDelete = files.slice(100); files = files.slice(0, 100);
            (async () => {
                const namesToDelete = toDelete.map(f => f.key.split('/').pop());
                await window.removeMultipleMetadataFromDB(window.TEMP_FOLDER, namesToDelete);
                for (const f of toDelete) {
                    try {
                        await fetch('/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', key: f.key }) });
                        const txtKey = f.key.replace(/\.[^/.]+$/, "") + ".txt";
                        await fetch('/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', key: txtKey }) });
                        await new Promise(r => setTimeout(r, 50)); 
                    } catch (err) { console.error('초기 로드 임시 파일 삭제 에러:', err); }
                }
            })();
        }
        window.TEMP_IMAGES = files;
        window.renderTempGallery();
        window.processDelayedWebPConversion(); 
    } catch(e) { if (window.logErrorToStorage) window.logErrorToStorage("임시 저장소 로드 실패", e); }
}

/**
 * 역할: 임시 보관함의 모든 이미지와 메타데이터를 삭제하고 UI 상태를 초기화한다.
 * 매개변수: 없음.
 * 주요 변수: btn, oldHtml, keysToDelete, blob, buffer - 삭제 대상과 버튼 상태.
 * 반환값: 명시 반환 없음.
 */
export async function clearTempGallery() {
    if (window.TEMP_IMAGES.length === 0) return alert('임시 보관함이 이미 비어있습니다.');
    if (!confirm(`임시 보관함에 있는 ${window.TEMP_IMAGES.length}개의 이미지를 모두 영구 삭제하시겠습니까?\n(이 작업은 복구할 수 없습니다)`)) return;
    const btn = document.getElementById('craft-clear-temp-btn'); const oldHtml = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i>`; btn.disabled = true;

    try {
        const keysToDelete = window.TEMP_IMAGES.map(img => img.key);
        const res = await fetch('/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_multiple', keys: keysToDelete }) });
        if (!res.ok) throw new Error('파일 삭제 처리 중 서버 오류가 발생했습니다.');
        
        await window.removeMultipleMetadataFromDB(window.TEMP_FOLDER, keysToDelete.map(key => key.split('/').pop())).catch(() => null);
        
        window.TEMP_IMAGES = []; window.CRAFT_ACTIVE_INDEX = null; window.renderTempGallery();
        alert('임시 보관함이 성공적으로 완전히 비워졌습니다!');
    } catch (err) { alert('오류 발생: ' + err.message); if (window.logErrorToStorage) window.logErrorToStorage('임시 보관함 일괄 삭제 에러', err); } 
    finally { btn.innerHTML = oldHtml; btn.disabled = false; lucide.createIcons(); }
}

/**
 * 역할: Craft 히스토리 패널을 확장/축소 상태로 전환한다.
 * 매개변수: 없음.
 * 주요 변수: CRAFT_HISTORY_EXPANDED, historyPanel, tempGrid, overlay - 패널 상태와 레이아웃 대상.
 * 반환값: 명시 반환 없음.
 */
export function toggleCraftHistoryExpanded() {
    if (window.CRAFT_HISTORY_COLLAPSED) window.setCraftHistoryCollapsed(false);
    window.CRAFT_HISTORY_EXPANDED = !window.CRAFT_HISTORY_EXPANDED;
    const historyPanel = document.getElementById('craft-history-panel'); const historyIcon = document.getElementById('craft-history-icon');
    const tempGrid = document.getElementById('craft-temp-grid'); const overlay = document.getElementById('craft-history-overlay');
    if (!historyPanel || !historyIcon || !tempGrid) return;
    historyPanel.style.width = '';
    if (window.CRAFT_HISTORY_EXPANDED) {
        historyPanel.classList.remove('w-[90px]', 'sm:w-[140px]', 'md:w-[240px]', 'lg:w-[280px]'); historyPanel.classList.add('w-[85%]', 'sm:w-[360px]', 'md:w-[480px]', 'lg:w-[640px]');
        tempGrid.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4';
        if (overlay) { overlay.classList.remove('hidden'); overlay.classList.add('flex'); }
        historyIcon.setAttribute('data-lucide', 'shrink');
    } else {
        historyPanel.classList.remove('w-[85%]', 'sm:w-[360px]', 'md:w-[480px]', 'lg:w-[640px]'); historyPanel.classList.add('w-[90px]', 'sm:w-[140px]', 'md:w-[240px]', 'lg:w-[280px]');
        tempGrid.className = 'grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3';
        if (overlay) { overlay.classList.remove('flex'); overlay.classList.add('hidden'); }
        historyIcon.setAttribute('data-lucide', 'expand');
    }
    lucide.createIcons();
}

/**
 * 역할: Craft 히스토리 패널을 좁은 접힘 상태 또는 기본 상태로 설정한다.
 * 매개변수: collapsed - 접힘 상태 여부.
 * 주요 변수: historyPanel, toggleIcon, title, expandBtn, body - 표시를 바꿀 DOM 요소.
 * 반환값: 명시 반환 없음.
 */
export function setCraftHistoryCollapsed(collapsed) {
    window.CRAFT_HISTORY_COLLAPSED = collapsed;
    const historyPanel = document.getElementById('craft-history-panel');
    const toggleIcon = document.getElementById('craft-history-toggle-icon');
    const title = document.getElementById('craft-history-title');
    const expandBtn = document.getElementById('craft-history-expand-btn');
    const body = document.getElementById('craft-history-body');
    if (!historyPanel) return;

    historyPanel.style.width = collapsed ? '48px' : '';
    historyPanel.style.opacity = '1';
    historyPanel.style.pointerEvents = 'auto';
    historyPanel.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    if (title) title.classList.toggle('hidden', collapsed);
    if (expandBtn) expandBtn.classList.toggle('hidden', collapsed);
    if (body) body.classList.toggle('hidden', collapsed);

    if (toggleIcon) {
        toggleIcon.setAttribute('data-lucide', collapsed ? 'panel-right-open' : 'panel-right-close');
    }
    if (window.lucide) window.lucide.createIcons();
}

/**
 * 역할: 현재 접힘 상태의 반대로 Craft 히스토리 패널을 전환한다.
 * 매개변수: 없음.
 * 주요 변수: CRAFT_HISTORY_COLLAPSED - 현재 패널 접힘 상태.
 * 반환값: 명시 반환 없음.
 */
export function toggleCraftHistoryPanel() {
    window.setCraftHistoryCollapsed(!window.CRAFT_HISTORY_COLLAPSED);
}

/**
 * 역할: 임시 이미지 목록, 활성 이미지 미리보기, 액션 버튼 상태를 렌더링한다.
 * 매개변수: 없음.
 * 주요 변수: grid, countSpan, activeData, deleteBtn, uploadBtn, importBtn - 렌더링 대상과 활성 상태.
 * 반환값: 명시 반환 없음.
 */
export function renderTempGallery() {
    const grid = document.getElementById('craft-temp-grid'); const countSpan = document.getElementById('craft-history-count');
    const activeEmpty = document.getElementById('craft-active-empty'); const activeContainer = document.getElementById('craft-active-container');
    const activeImage = document.getElementById('craft-active-image');
    const deleteBtn = document.getElementById('craft-action-delete'); const downloadBtn = document.getElementById('craft-action-download'); const uploadBtn = document.getElementById('craft-action-upload');
    if (!grid) return; grid.innerHTML = '';
    if (countSpan) countSpan.innerText = `${window.TEMP_IMAGES.length}/100`;

    if (uploadBtn && !document.getElementById('craft-action-import')) {
        const actionBar = uploadBtn.parentNode; actionBar.classList.add('flex-nowrap', 'whitespace-nowrap', 'w-max');
        [deleteBtn, downloadBtn, uploadBtn].forEach(btn => { if (btn) { btn.classList.add('flex-shrink-0'); const icon = btn.querySelector('i'); if (icon) { icon.classList.remove('mr-1'); icon.classList.add('sm:mr-1'); } const span = btn.querySelector('span'); if (span) span.className = 'hidden sm:inline'; } });
        const sep = document.createElement('div'); sep.className = 'w-px h-5 sm:h-6 bg-gray-300 dark:bg-gray-600 flex-shrink-0'; actionBar.appendChild(sep);
        const importBtn = document.createElement('button'); importBtn.id = 'craft-action-import'; importBtn.className = 'flex items-center text-xs sm:text-sm font-bold text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 transition px-2 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0'; importBtn.innerHTML = `<i data-lucide="import" class="w-4 h-4 sm:w-5 sm:h-5 sm:mr-1"></i> <span class="hidden sm:inline">불러오기</span>`; importBtn.onclick = window.importTempImageMetadata;
        actionBar.appendChild(importBtn); lucide.createIcons();
    }
    const importBtn = document.getElementById('craft-action-import');

    if (window.TEMP_IMAGES.length === 0) {
        window.CRAFT_ACTIVE_INDEX = null;
        if(activeEmpty) { activeEmpty.classList.remove('hidden'); activeEmpty.classList.add('flex'); }
        if(activeContainer) { activeContainer.classList.add('hidden'); activeContainer.classList.remove('flex'); }
        if(deleteBtn) deleteBtn.disabled = true; if(downloadBtn) downloadBtn.disabled = true; if(uploadBtn) uploadBtn.disabled = true; if(importBtn) importBtn.disabled = true;
    } else {
        if (window.CRAFT_ACTIVE_INDEX === null || window.CRAFT_ACTIVE_INDEX >= window.TEMP_IMAGES.length) window.CRAFT_ACTIVE_INDEX = 0;
        const activeData = window.TEMP_IMAGES[window.CRAFT_ACTIVE_INDEX];
        if(activeImage) activeImage.src = `/${activeData.key}?t=${new Date(activeData.uploaded).getTime()}`;
        if(activeEmpty) { activeEmpty.classList.add('hidden'); activeEmpty.classList.remove('flex'); }
        if(activeContainer) { activeContainer.classList.remove('hidden'); activeContainer.classList.add('flex'); }
        if(deleteBtn) deleteBtn.disabled = false; if(downloadBtn) downloadBtn.disabled = false; if(uploadBtn) uploadBtn.disabled = false; if(importBtn) importBtn.disabled = false;
    }

    window.TEMP_IMAGES.forEach((imgData, index) => {
        const isActive = (index === window.CRAFT_ACTIVE_INDEX);
        const url = `/${imgData.key}?t=${new Date(imgData.uploaded).getTime()}`;
        const div = document.createElement('div');
        div.className = `relative w-full aspect-[3/4] bg-gray-100 dark:bg-gray-900 group rounded-lg overflow-hidden shadow-sm border-2 cursor-pointer transition-all ${isActive ? 'border-indigo-500 scale-[0.98] ring-2 ring-indigo-500/50' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700'}`;
        div.tabIndex = 0;
        div.setAttribute('role', 'button');
        div.setAttribute('aria-label', `Temporary image ${index + 1}`);
        div.onclick = () => {
            window.CRAFT_ACTIVE_INDEX = index;
            window.renderTempGallery();
            document.getElementById('craft-temp-grid')?.children[index]?.focus({ preventScroll: true });
        };
        div.onkeydown = (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                window.CRAFT_ACTIVE_INDEX = index;
                window.renderTempGallery();
                document.getElementById('craft-temp-grid')?.children[index]?.focus({ preventScroll: true });
            }
        };
        div.innerHTML = `<img src="${url}" class="absolute inset-0 object-cover w-full h-full transition-opacity duration-200 ${isActive ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}">${isActive ? `<div class="absolute inset-0 border-4 border-indigo-500 rounded-lg pointer-events-none"></div>` : ''}`;
        grid.appendChild(div);
    });
    lucide.createIcons();
}

/**
 * 역할: 현재 선택된 임시 이미지를 다운로드하고 WebP는 PNG로 변환해 내려받는다.
 * 매개변수: 없음.
 * 주요 변수: imgData, downloadUrl, downloadName, blob, canvas, pngBlob - 다운로드/변환 데이터.
 * 반환값: 명시 반환 없음.
 */
export async function downloadActiveTempImage() {
    if (window.CRAFT_ACTIVE_INDEX === null) return;
    const imgData = window.TEMP_IMAGES[window.CRAFT_ACTIVE_INDEX];
    if (!imgData) return;

    let downloadUrl = `/${imgData.key}?t=${new Date(imgData.uploaded).getTime()}`;
    let downloadName = imgData.key.split('/').pop() || `nai_${Date.now()}.png`;

    if (imgData.key.endsWith('.webp')) {
        try {
            const res = await fetch(downloadUrl); if (!res.ok) throw new Error("이미지 패치 실패");
            const blob = await res.blob();
            const img = new Image(); const objectUrl = URL.createObjectURL(blob);
            await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = objectUrl; });
            const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
            canvas.getContext('2d').drawImage(img, 0, 0);
            const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            downloadUrl = URL.createObjectURL(pngBlob); downloadName = downloadName.replace('.webp', '.png'); URL.revokeObjectURL(objectUrl);
        } catch (error) { console.error("PNG 변환 다운로드 실패", error); }
    }
    const a = document.createElement('a'); a.href = downloadUrl; a.download = downloadName; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    if (downloadUrl.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

/**
 * 역할: 현재 선택된 임시 이미지를 서버와 로컬 목록에서 제거한다.
 * 매개변수: 없음.
 * 주요 변수: imgData, CRAFT_ACTIVE_INDEX, TEMP_IMAGES - 삭제 대상과 활성 인덱스.
 * 반환값: 명시 반환 없음.
 */
export async function removeActiveTempImage() {
    if (window.CRAFT_ACTIVE_INDEX === null) return;
    if (!confirm('임시 보관소에서 이 이미지를 영구 삭제하시겠습니까?')) return;
    const imgData = window.TEMP_IMAGES[window.CRAFT_ACTIVE_INDEX];
    fetch('/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', key: imgData.key }) });
    window.removeMetadataFromDB(window.TEMP_FOLDER, imgData.key.split('/').pop());
    window.TEMP_IMAGES.splice(window.CRAFT_ACTIVE_INDEX, 1);
    if (window.CRAFT_ACTIVE_INDEX >= window.TEMP_IMAGES.length) window.CRAFT_ACTIVE_INDEX = window.TEMP_IMAGES.length - 1;
    if (window.CRAFT_ACTIVE_INDEX < 0) window.CRAFT_ACTIVE_INDEX = null;
    window.renderTempGallery();
}

function normalizeUploadPath(path) {
    return path && !path.endsWith('/') ? path + '/' : path;
}

function getStructuredUploadContextFromSourceKey(key) {
    const parts = String(key || '').split('/').filter(Boolean);
    if (parts.length < 3) return null;
    const fileName = parts[parts.length - 1] || '';
    const imageNumber = fileName.replace(/\.[^/.]+$/, '');
    if (!imageNumber) return null;

    return {
        projectPath: normalizeUploadPath(parts[0]),
        characterPath: normalizeUploadPath(parts.slice(0, -1).join('/')),
        imageNumber
    };
}

function findUploadSituationByImageNumber(situations = [], imageNumber = '') {
    const normalized = String(imageNumber || '').trim();
    return situations.find((situation, index) => {
        const id = situation?.id || situation?.folderName || `situation-${index + 1}`;
        return getCraftUploadSituationImageNumber(situation, id) === normalized;
    }) || null;
}

async function getTempImageInpaintSourceKey(imgData) {
    if (imgData?.inpaintSourceKey) return imgData.inpaintSourceKey;
    const tempFileName = String(imgData?.key || '').split('/').pop();
    if (tempFileName && window.loadMetadataFromDB) {
        const metadata = await window.loadMetadataFromDB(window.TEMP_FOLDER, tempFileName).catch(() => null);
        if (metadata?.['Inpaint Source Key']) return metadata['Inpaint Source Key'];
    }
    if (window.INPAINT_IMAGE_SOURCE?.key) return window.INPAINT_IMAGE_SOURCE.key;
    if (window.CRAFT_UPLOAD_INPAINT_SOURCE_KEY) return window.CRAFT_UPLOAD_INPAINT_SOURCE_KEY;
    try {
        return localStorage.getItem('imggul_inpaint_upload_source_key') || '';
    } catch {
        return '';
    }
}

async function applyInpaintSourceUploadContext(sourceKey) {
    const context = getStructuredUploadContextFromSourceKey(sourceKey);
    if (!context) return false;

    await window.loadCraftUploadDependentLists(context.projectPath);
    const state = window.CRAFT_UPLOAD_PICKER_STATE || {};
    const situation = findUploadSituationByImageNumber(state.situations || [], context.imageNumber);
    const situationId = situation
        ? String(situation.id || situation.folderName || context.imageNumber)
        : '';

    state.mode = 'structured';
    state.projectPath = context.projectPath;
    state.characterPath = (state.characters || []).includes(context.characterPath) ? context.characterPath : '';
    state.situationId = situationId;
    window.CRAFT_UPLOAD_PICKER_STATE = state;

    window.renderCraftUploadPickerList('project');
    window.renderCraftUploadPickerList('character');
    window.renderCraftUploadPickerList('situation');
    window.setCraftUploadMode('structured');
    window.updateCraftUploadTargetSummary();
    return !!(state.projectPath && state.characterPath && state.situationId);
}

const CRAFT_UPLOAD_CONTEXT_STORAGE_KEY = 'imggul_craft_upload_context';
const CRAFT_UPLOAD_EXCLUDED_FOLDERS = new Set(['logs', '_temp_craft', '_planner_temp_image']);

function readCraftUploadContextCache() {
    try {
        return JSON.parse(localStorage.getItem(CRAFT_UPLOAD_CONTEXT_STORAGE_KEY) || '{}') || {};
    } catch {
        return {};
    }
}

function writeCraftUploadContextCache(cache) {
    try {
        localStorage.setItem(CRAFT_UPLOAD_CONTEXT_STORAGE_KEY, JSON.stringify(cache || {}));
    } catch {}
}

function cacheCraftUploadLocation({ projectPath, characterPath, situationId, directPath } = {}) {
    const normalizedProject = normalizeUploadPath(projectPath || '');
    const normalizedCharacter = normalizeUploadPath(characterPath || '');
    const cache = readCraftUploadContextCache();
    if (normalizedProject) {
        cache.projectPath = normalizedProject;
        cache.byProject = cache.byProject || {};
        cache.byProject[normalizedProject] = {
            ...(cache.byProject[normalizedProject] || {}),
            characterPath: normalizedCharacter,
            situationId: situationId || ''
        };
    }
    if (directPath) cache.directPath = normalizeUploadPath(directPath);
    writeCraftUploadContextCache(cache);
    if (window.cacheCraftUploadSelection && normalizedProject) {
        window.cacheCraftUploadSelection({ projectPath: normalizedProject, characterPath: normalizedCharacter, situationId });
    }
}

function isVisibleUploadFolder(folderPrefix) {
    const folderName = String(folderPrefix || '').split('/').filter(Boolean).pop();
    return folderName && !folderName.startsWith('.') && !CRAFT_UPLOAD_EXCLUDED_FOLDERS.has(folderName);
}

function getSituationUploadLabel(situation, index) {
    const imageNumber = Number.isFinite(Number(situation?.imageNumber)) ? Number(situation.imageNumber) : index;
    const name = situation?.alias || situation?.name || situation?.id || `상황 ${imageNumber}`;
    return `${imageNumber} - ${name}`;
}

function makeUploadPickerItem({ type, label, subLabel = '', active = false, onClick }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.pickerType = type;
    button.dataset.searchText = `${label} ${subLabel}`.toLowerCase();
    button.className = 'w-full flex items-center text-left gap-2 px-2.5 py-2 rounded-md border border-transparent hover:border-indigo-300 dark:hover:border-indigo-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 transition min-w-0';
    button.onclick = onClick;
    button.innerHTML = `
        <span class="min-w-0 flex-1">
            <span class="block text-xs font-bold truncate">${label}</span>
            ${subLabel ? `<span class="block text-[10px] text-gray-500 dark:text-gray-400 truncate">${subLabel}</span>` : ''}
        </span>
        <i data-lucide="check" class="w-3.5 h-3.5 text-indigo-500 ${active ? '' : 'invisible'}"></i>
    `;
    return button;
}

function setUploadListLoading(id) {
    const list = document.getElementById(id);
    if (!list) return;
    list.innerHTML = '<div class="flex items-center justify-center py-5 text-xs text-gray-500 dark:text-gray-400"><i data-lucide="loader" class="w-3.5 h-3.5 mr-1.5 animate-spin"></i>불러오는 중...</div>';
    if (window.lucide) window.lucide.createIcons();
}

function setUploadListEmpty(id, message) {
    const list = document.getElementById(id);
    if (!list) return;
    list.innerHTML = `<div class="py-5 text-center text-xs text-gray-500 dark:text-gray-400">${message}</div>`;
}

function getUploadItemId(item, index) {
    return item?.id || item?.folderName || `situation-${index + 1}`;
}

async function loadUploadProjects() {
    const res = await fetch('/api/list?prefix=&_t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('프로젝트 목록을 불러오지 못했습니다.');
    const data = await res.json();
    return (data.folders || []).filter(folder => !folder.startsWith(window.TEMP_FOLDER) && isVisibleUploadFolder(folder));
}

async function loadUploadCharacters(projectPath) {
    if (!projectPath) return [];
    const [listRes, aliasRes] = await Promise.all([
        fetch(`/api/list?prefix=${encodeURIComponent(projectPath)}&_t=${Date.now()}`, { cache: 'no-store' }),
        fetch(`/api/aliases?prefix=${encodeURIComponent(projectPath)}&_t=${Date.now()}`, { cache: 'no-store' }).catch(() => null)
    ]);
    if (aliasRes?.ok) {
        const aliasData = await aliasRes.json();
        window.GLOBAL_ALIASES = Object.assign(window.GLOBAL_ALIASES || {}, aliasData.global || {});
        window.PROJECT_ALIASES = Object.assign(window.PROJECT_ALIASES || {}, aliasData.project || {});
    }
    if (!listRes.ok) throw new Error('캐릭터 목록을 불러오지 못했습니다.');
    const data = await listRes.json();
    return (data.folders || []).filter(isVisibleUploadFolder);
}

async function getCraftUploadSituations(projectPath) {
    if (!projectPath) return [];
    const key = `${projectPath}_situations_meta.json`;
    const res = await fetch(`/api/db/json-document?type=situations_meta&key=${encodeURIComponent(key)}&fallbackKey=${encodeURIComponent(key)}&_t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error('상황 목록을 불러오지 못했습니다.');
    const payload = await res.json().catch(() => ({}));
    const data = payload.data || {};
    return Array.isArray(data.situations) ? data.situations : [];
}

function getCraftUploadSelectedContext() {
    return {
        projectPath: normalizeUploadPath(document.getElementById('craft-project-select')?.value || ''),
        characterPath: normalizeUploadPath(document.getElementById('craft-char-select')?.value || ''),
        situationId: document.getElementById('craft-situation-select')?.value || ''
    };
}

async function getCraftUploadSituation(projectPath, situationId) {
    if (!projectPath || !situationId) return null;
    const key = `${projectPath}_situations_meta.json`;
    const res = await fetch(`/api/db/json-document?type=situations_meta&key=${encodeURIComponent(key)}&fallbackKey=${encodeURIComponent(key)}&_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;

    const payload = await res.json().catch(() => ({}));
    const data = payload.data || {};
    const situations = Array.isArray(data.situations) ? data.situations : [];
    return situations.find(situation => situation?.id === situationId || situation?.folderName === situationId) || null;
}

function getCraftUploadSituationImageNumber(situation, fallbackId) {
    const imageNumber = Number(situation?.imageNumber);
    if (Number.isFinite(imageNumber)) return String(imageNumber);

    const fallbackNumber = Number(fallbackId);
    return Number.isFinite(fallbackNumber) ? String(fallbackNumber) : '';
}

/**
 * 역할: 현재 선택된 임시 이미지를 프로젝트 폴더로 업로드하기 위한 모달을 준비한다.
 * 매개변수: 없음.
 * 주요 변수: index, imgData, selectedProject, projectPath, modal, uploadFileNameInput - 업로드 대상 설정값.
 * 반환값: 명시 반환 없음.
 */
export async function prepareUploadActiveTempImage() {
    if (window.CRAFT_ACTIVE_INDEX === null) return;
    const index = window.CRAFT_ACTIVE_INDEX; const imgData = window.TEMP_IMAGES[index]; if (!imgData) return;
    const inpaintSourceKey = await getTempImageInpaintSourceKey(imgData);

    window.CRAFT_UPLOAD_ACTIVE_INDEX = index;
    window.CRAFT_UPLOAD_TARGET_PATH = '';
    window.CRAFT_UPLOAD_SELECTED_SITUATION = null;

    const uploadModal = document.getElementById('craft-upload-modal');
    const uploadPreview = document.getElementById('craft-upload-preview');
    const uploadProjectLabel = document.getElementById('craft-upload-project-label');
    const uploadNameInput = document.getElementById('craft-upload-filename');
    if (!uploadModal || !uploadNameInput) return;

    if (uploadPreview) uploadPreview.src = `/${imgData.key}?t=${new Date(imgData.uploaded).getTime()}`;
    if (uploadProjectLabel) uploadProjectLabel.textContent = '업로드 위치를 선택하세요';
    uploadNameInput.value = 'nai_' + Date.now();
    uploadModal.classList.remove('hidden');
    await window.initCraftUploadPicker();
    if (inpaintSourceKey) await applyInpaintSourceUploadContext(inpaintSourceKey);
    if (window.lucide) window.lucide.createIcons();
    return;

    const selectedProjectEl = document.getElementById('craft-project-select');
    const selectedProject = selectedProjectEl ? selectedProjectEl.value : '';
    if (!selectedProject) return alert('상단에서 업로드할 프로젝트를 먼저 선택해주세요.');

    const uploadContext = getCraftUploadSelectedContext();
    let projectPath = uploadContext.projectPath || selectedProject;
    if (projectPath && !projectPath.endsWith('/')) projectPath += '/';
    const selectedSituation = uploadContext.situationId
        ? await getCraftUploadSituation(projectPath, uploadContext.situationId)
        : null;
    const selectedSituationImageNumber = getCraftUploadSituationImageNumber(selectedSituation, uploadContext.situationId);
    const defaultTargetPath = uploadContext.characterPath && selectedSituationImageNumber
        ? uploadContext.characterPath
        : projectPath;
    window.CRAFT_UPLOAD_ACTIVE_INDEX = index;
    window.CRAFT_UPLOAD_TARGET_PATH = defaultTargetPath;
    window.CRAFT_UPLOAD_SELECTED_SITUATION = selectedSituation ? {
        ...selectedSituation,
        imageNumber: selectedSituationImageNumber
    } : null;

    const modal = document.getElementById('craft-upload-modal');
    const preview = document.getElementById('craft-upload-preview');
    const projectLabel = document.getElementById('craft-upload-project-label');
    const uploadFileNameInput = document.getElementById('craft-upload-filename');
    if (!modal || !uploadFileNameInput) return;

    if (preview) preview.src = `/${imgData.key}?t=${new Date(imgData.uploaded).getTime()}`;
    if (projectLabel) projectLabel.textContent = window.getDisplayName(defaultTargetPath, true);
    uploadFileNameInput.value = selectedSituationImageNumber || ('nai_' + Date.now());
    modal.classList.remove('hidden');
    await window.loadCraftUploadTargets(projectPath);
    if (window.lucide) window.lucide.createIcons();
}

/**
 * 역할: Craft 업로드 모달을 닫고 미리보기 이미지를 초기화한다.
 * 매개변수: e - 닫기 이벤트 객체.
 * 주요 변수: modal, preview - 닫을 모달과 초기화할 이미지.
 * 반환값: 명시 반환 없음.
 */
export function closeCraftUploadModal(e) {
    if (e && e.target !== e.currentTarget && e.target.id !== 'close-craft-upload-btn') return;
    const modal = document.getElementById('craft-upload-modal');
    if (modal) modal.classList.add('hidden');
    const preview = document.getElementById('craft-upload-preview');
    if (preview) preview.src = '';
}

export async function initCraftUploadPicker() {
    const cache = readCraftUploadContextCache();
    const projectPath = normalizeUploadPath(cache.projectPath || document.getElementById('craft-project-select')?.value || '');
    const projectCache = cache.byProject?.[projectPath] || {};
    window.CRAFT_UPLOAD_PICKER_STATE = {
        mode: 'structured',
        projects: [],
        characters: [],
        situations: [],
        projectPath,
        characterPath: normalizeUploadPath(projectCache.characterPath || document.getElementById('craft-char-select')?.value || ''),
        situationId: projectCache.situationId || document.getElementById('craft-situation-select')?.value || '',
        directPath: normalizeUploadPath(cache.directPath || projectPath || '')
    };
    const directInput = document.getElementById('craft-upload-direct-path');
    if (directInput) directInput.value = window.CRAFT_UPLOAD_PICKER_STATE.directPath;
    window.setCraftUploadMode('structured');
    await window.loadCraftUploadProjectList();
    if (window.CRAFT_UPLOAD_PICKER_STATE.projectPath) {
        await window.loadCraftUploadDependentLists(window.CRAFT_UPLOAD_PICKER_STATE.projectPath, true);
    }
    window.updateCraftUploadTargetSummary();
}

export function setCraftUploadMode(mode) {
    const state = window.CRAFT_UPLOAD_PICKER_STATE || {};
    state.mode = mode === 'direct' ? 'direct' : 'structured';
    window.CRAFT_UPLOAD_PICKER_STATE = state;
    document.getElementById('craft-upload-structured-panel')?.classList.toggle('hidden', state.mode !== 'structured');
    const directPanel = document.getElementById('craft-upload-direct-panel');
    if (directPanel) {
        directPanel.classList.toggle('hidden', state.mode !== 'direct');
        directPanel.classList.toggle('flex', state.mode === 'direct');
    }
    ['structured', 'direct'].forEach(item => {
        const btn = document.getElementById(`craft-upload-mode-${item}`);
        const active = item === state.mode;
        btn?.classList.toggle('border-indigo-500', active);
        btn?.classList.toggle('bg-indigo-50', active);
        btn?.classList.toggle('dark:bg-indigo-900/30', active);
        btn?.classList.toggle('text-indigo-700', active);
        btn?.classList.toggle('dark:text-indigo-300', active);
        btn?.classList.toggle('border-gray-200', !active);
        btn?.classList.toggle('dark:border-gray-700', !active);
    });
    if (state.mode === 'direct') {
        window.loadCraftUploadDirectPath(state.directBrowserPath || state.directPath || '');
    }
    window.updateCraftUploadTargetSummary();
}

export async function loadCraftUploadProjectList() {
    setUploadListLoading('craft-upload-project-list');
    try {
        const state = window.CRAFT_UPLOAD_PICKER_STATE || {};
        state.projects = await loadUploadProjects();
        window.CRAFT_UPLOAD_PICKER_STATE = state;
        window.renderCraftUploadPickerList('project');
    } catch (err) {
        setUploadListEmpty('craft-upload-project-list', err.message || '프로젝트 목록을 불러오지 못했습니다.');
    }
}

export async function loadCraftUploadDependentLists(projectPath, restoreCached = false) {
    const state = window.CRAFT_UPLOAD_PICKER_STATE || {};
    state.projectPath = normalizeUploadPath(projectPath);
    if (!restoreCached) {
        state.characterPath = '';
        state.situationId = '';
    }
    state.characters = [];
    state.situations = [];
    window.CRAFT_UPLOAD_PICKER_STATE = state;
    setUploadListLoading('craft-upload-character-list');
    setUploadListLoading('craft-upload-situation-list');

    try {
        const cache = readCraftUploadContextCache();
        const projectCache = cache.byProject?.[state.projectPath] || {};
        const [characters, situations] = await Promise.all([
            loadUploadCharacters(state.projectPath),
            getCraftUploadSituations(state.projectPath)
        ]);
        state.characters = characters;
        state.situations = situations;
        if (restoreCached && projectCache.characterPath && characters.includes(projectCache.characterPath)) {
            state.characterPath = projectCache.characterPath;
        }
        if (restoreCached && projectCache.situationId && situations.some((item, index) => String(item?.id || item?.folderName || `situation-${index + 1}`) === String(projectCache.situationId))) {
            state.situationId = projectCache.situationId;
        }
        window.CRAFT_UPLOAD_PICKER_STATE = state;
        window.renderCraftUploadPickerList('project');
        window.renderCraftUploadPickerList('character');
        window.renderCraftUploadPickerList('situation');
        window.updateCraftUploadTargetSummary();
    } catch (err) {
        setUploadListEmpty('craft-upload-character-list', err.message || '캐릭터 목록을 불러오지 못했습니다.');
        setUploadListEmpty('craft-upload-situation-list', err.message || '상황 목록을 불러오지 못했습니다.');
    }
}

export function renderCraftUploadPickerList(type) {
    const state = window.CRAFT_UPLOAD_PICKER_STATE || {};
    const list = document.getElementById(`craft-upload-${type}-list`);
    if (!list) return;
    list.innerHTML = '';
    if (type === 'project') {
        (state.projects || []).forEach(projectPath => {
            const label = window.getDisplayName(projectPath, true) || projectPath.split('/').filter(Boolean).pop();
            list.appendChild(makeUploadPickerItem({
                type,
                label,
                subLabel: projectPath,
                active: normalizeUploadPath(projectPath) === state.projectPath,
                onClick: async () => window.loadCraftUploadDependentLists(projectPath)
            }));
        });
    } else if (type === 'character') {
        (state.characters || []).forEach(characterPath => {
            const label = window.getDisplayName(characterPath, true) || characterPath.split('/').filter(Boolean).pop();
            list.appendChild(makeUploadPickerItem({
                type,
                label,
                subLabel: characterPath,
                active: normalizeUploadPath(characterPath) === state.characterPath,
                onClick: () => {
                    state.characterPath = normalizeUploadPath(characterPath);
                    window.CRAFT_UPLOAD_PICKER_STATE = state;
                    window.renderCraftUploadPickerList('character');
                    window.updateCraftUploadTargetSummary();
                }
            }));
        });
    } else if (type === 'situation') {
        (state.situations || []).forEach((situation, index) => {
            const id = getUploadItemId(situation, index);
            list.appendChild(makeUploadPickerItem({
                type,
                label: getSituationUploadLabel(situation, index),
                subLabel: String(id),
                active: String(id) === String(state.situationId),
                onClick: () => {
                    state.situationId = String(id);
                    window.CRAFT_UPLOAD_PICKER_STATE = state;
                    window.renderCraftUploadPickerList('situation');
                    window.updateCraftUploadTargetSummary();
                }
            }));
        });
    }
    if (!list.children.length) setUploadListEmpty(list.id, '선택 가능한 항목이 없습니다.');
    if (window.lucide) window.lucide.createIcons();
}

export function filterCraftUploadList(type, value = '') {
    const q = String(value || '').trim().toLowerCase();
    document.querySelectorAll(`#craft-upload-${type}-list [data-picker-type="${type}"]`).forEach(item => {
        item.classList.toggle('hidden', q && !item.dataset.searchText.includes(q));
    });
}

export function updateCraftUploadTargetFromDirectPath() {
    const state = window.CRAFT_UPLOAD_PICKER_STATE || {};
    state.directPath = normalizeUploadPath(document.getElementById('craft-upload-direct-path')?.value.trim() || '');
    state.directBrowserPath = state.directPath;
    window.CRAFT_UPLOAD_PICKER_STATE = state;
    window.updateCraftUploadTargetSummary();
}

export function updateCraftUploadTargetSummary() {
    const state = window.CRAFT_UPLOAD_PICKER_STATE || {};
    const selectedPath = document.getElementById('craft-upload-selected-path');
    const projectLabel = document.getElementById('craft-upload-project-label');
    const fileInput = document.getElementById('craft-upload-filename');
    const fileNamePanel = document.getElementById('craft-upload-filename-panel');
    const autoFileNamePanel = document.getElementById('craft-upload-auto-filename-panel');
    const autoFileName = document.getElementById('craft-upload-auto-filename');
    const submitBtn = document.getElementById('craft-upload-submit-btn');
    let targetPath = '';
    let imageNumber = '';
    let valid = false;

    if (fileNamePanel) fileNamePanel.classList.toggle('hidden', state.mode !== 'direct');
    if (autoFileNamePanel) autoFileNamePanel.classList.toggle('hidden', state.mode === 'direct');

    if (state.mode === 'direct') {
        targetPath = normalizeUploadPath(state.directPath || '');
        valid = !!targetPath;
    } else {
        const situation = (state.situations || []).find((item, index) => {
            const id = getUploadItemId(item, index);
            return String(id) === String(state.situationId);
        });
        imageNumber = getCraftUploadSituationImageNumber(situation, state.situationId);
        targetPath = state.projectPath && state.characterPath && state.situationId ? state.characterPath : '';
        valid = !!(state.projectPath && state.characterPath && state.situationId && targetPath);
        window.CRAFT_UPLOAD_SELECTED_SITUATION = situation ? { ...situation, imageNumber } : null;
        if (valid && fileInput) fileInput.value = imageNumber || '';
    }

    window.CRAFT_UPLOAD_TARGET_PATH = targetPath;
    if (autoFileName) autoFileName.textContent = valid && state.mode !== 'direct' && imageNumber ? `${imageNumber}.webp` : '-';
    if (selectedPath) selectedPath.textContent = targetPath ? '/' + targetPath : '프로젝트, 캐릭터, 상황을 모두 선택하세요';
    if (projectLabel) {
        projectLabel.textContent = state.mode === 'direct'
            ? (targetPath || '직접 경로를 입력하세요')
            : [state.projectPath, state.characterPath, state.situationId].filter(Boolean).join(' · ') || '업로드 위치를 선택하세요';
    }
    if (submitBtn) submitBtn.disabled = !valid;
}

export async function loadCraftUploadDirectPath(prefix = '') {
    const state = window.CRAFT_UPLOAD_PICKER_STATE || {};
    const normalized = normalizeUploadPath(prefix || '');
    state.directBrowserPath = normalized;
    state.directPath = normalized;
    window.CRAFT_UPLOAD_PICKER_STATE = state;

    const input = document.getElementById('craft-upload-direct-path');
    const current = document.getElementById('craft-upload-direct-current');
    const list = document.getElementById('craft-upload-direct-folders');
    if (input) input.value = normalized;
    if (current) current.textContent = '/' + normalized;
    if (!list) {
        window.updateCraftUploadTargetSummary();
        return;
    }

    list.innerHTML = '<div class="col-span-full py-6 text-center text-xs text-gray-500 dark:text-gray-400"><i data-lucide="loader" class="inline w-3.5 h-3.5 mr-1 animate-spin"></i>불러오는 중...</div>';
    if (window.lucide) window.lucide.createIcons();

    try {
        const res = await fetch(`/api/list?prefix=${encodeURIComponent(normalized)}&_t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error('폴더 목록을 불러오지 못했습니다.');
        const data = await res.json();
        const folders = (data.folders || []).filter(isVisibleUploadFolder);
        list.innerHTML = '';

        if (normalized) {
            const parts = normalized.split('/').filter(Boolean);
            parts.pop();
            const parent = parts.length ? normalizeUploadPath(parts.join('/')) : '';
            list.appendChild(makeDirectPathButton({ label: '상위 폴더', subLabel: '/' + parent, icon: 'corner-left-up', onClick: () => window.loadCraftUploadDirectPath(parent) }));
        }

        folders.forEach(folderPrefix => {
            const folderName = folderPrefix.split('/').filter(Boolean).pop() || folderPrefix;
            const alias = window.getAliasOnly ? window.getAliasOnly(folderPrefix, true) : '';
            list.appendChild(makeDirectPathButton({
                label: alias || folderName,
                subLabel: alias ? folderName : '/' + folderPrefix,
                icon: 'folder',
                onClick: () => window.loadCraftUploadDirectPath(folderPrefix)
            }));
        });

        if (!list.children.length) list.innerHTML = '<div class="col-span-full py-6 text-center text-xs text-gray-500 dark:text-gray-400">하위 폴더가 없습니다. 현재 경로에 업로드합니다.</div>';
    } catch (err) {
        list.innerHTML = `<div class="col-span-full py-6 text-center text-xs text-red-500">${err.message || '폴더 목록을 불러오지 못했습니다.'}</div>`;
    } finally {
        window.updateCraftUploadTargetSummary();
        if (window.lucide) window.lucide.createIcons();
    }
}

function makeDirectPathButton({ label, subLabel = '', icon = 'folder', onClick }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'flex items-center text-left gap-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-2 hover:border-indigo-400 dark:hover:border-indigo-600 transition min-w-0';
    button.onclick = onClick;
    button.innerHTML = `
        <i data-lucide="${icon}" class="w-4 h-4 text-indigo-500 flex-shrink-0"></i>
        <span class="min-w-0">
            <span class="block text-xs font-bold text-gray-800 dark:text-gray-100 truncate">${label}</span>
            ${subLabel ? `<span class="block text-[10px] text-gray-500 dark:text-gray-400 truncate">${subLabel}</span>` : ''}
        </span>
    `;
    return button;
}

/**
 * 역할: 프로젝트 루트와 하위 폴더를 업로드 대상 버튼 목록으로 렌더링한다.
 * 매개변수: projectPath - 기준 프로젝트 경로.
 * 주요 변수: list, empty, normalizedProjectPath, targets, data - 대상 목록과 렌더링 데이터.
 * 반환값: 명시 반환 없음.
 */
export async function loadCraftUploadTargets(projectPath) {
    const list = document.getElementById('craft-upload-target-list');
    const empty = document.getElementById('craft-upload-target-empty');
    if (!list) return;

    list.innerHTML = '<div class="col-span-full flex items-center justify-center py-8 text-sm text-gray-500 dark:text-gray-400"><i data-lucide="loader" class="w-4 h-4 mr-2 animate-spin"></i> 불러오는 중...</div>';
    if (empty) empty.classList.add('hidden');
    if (window.lucide) window.lucide.createIcons();

    const normalizedProjectPath = projectPath.endsWith('/') ? projectPath : projectPath + '/';
    const targets = [{ path: normalizedProjectPath, label: '프로젝트 루트', subLabel: window.getDisplayName(normalizedProjectPath, true), icon: 'folder' }];

    try {
        const uploadContext = getCraftUploadSelectedContext();
        const selectedSituation = window.CRAFT_UPLOAD_SELECTED_SITUATION;
        if (uploadContext.characterPath && selectedSituation?.imageNumber) {
            const situationName = selectedSituation.alias || selectedSituation.name || selectedSituation.id || uploadContext.situationId;
            targets.push({
                path: uploadContext.characterPath,
                label: `${selectedSituation.imageNumber}.webp / ${situationName}`,
                subLabel: `${window.getDisplayName(uploadContext.characterPath, true)} 상황 이미지`,
                icon: 'image'
            });
        }

        const res = await fetch(`/api/list?prefix=${encodeURIComponent(normalizedProjectPath)}&_t=${Date.now()}`);
        if (res.ok) {
            const data = await res.json();
            (data.folders || []).forEach(folderPrefix => {
                const parts = folderPrefix.split('/').filter(Boolean);
                const folderName = parts[parts.length - 1] || folderPrefix;
                const alias = window.getAliasOnly(folderPrefix, true);
                targets.push({ path: folderPrefix, label: alias || folderName, subLabel: alias ? folderName : folderPrefix, icon: 'folder' });
            });
        }
    } catch (e) {
        if (window.logErrorToStorage) window.logErrorToStorage('업로드 위치 목록 로드 실패', e);
    }

    list.innerHTML = '';
    targets.forEach(target => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.path = target.path.endsWith('/') ? target.path : target.path + '/';
        btn.className = 'craft-upload-target flex items-center text-left gap-2 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-indigo-400 dark:hover:border-indigo-500 transition min-w-0';
        btn.onclick = () => window.selectCraftUploadTarget(btn.dataset.path);

        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', target.icon);
        icon.className = 'w-4 h-4 text-indigo-500 flex-shrink-0';

        const text = document.createElement('span');
        text.className = 'min-w-0';

        const label = document.createElement('span');
        label.className = 'block text-sm font-semibold text-gray-800 dark:text-gray-100 truncate';
        label.textContent = target.label;

        const subLabel = document.createElement('span');
        subLabel.className = 'block text-[11px] text-gray-500 dark:text-gray-400 truncate';
        subLabel.textContent = target.subLabel;

        text.appendChild(label);
        text.appendChild(subLabel);
        btn.appendChild(icon);
        btn.appendChild(text);
        list.appendChild(btn);
    });

    if (empty) empty.classList.toggle('hidden', targets.length > 0);
    window.selectCraftUploadTarget(window.CRAFT_UPLOAD_TARGET_PATH || normalizedProjectPath);
    if (window.lucide) window.lucide.createIcons();
}

/**
 * 역할: 업로드 대상 경로를 선택하고 대상 버튼의 활성 스타일을 갱신한다.
 * 매개변수: targetPath - 선택할 업로드 폴더 경로.
 * 주요 변수: CRAFT_UPLOAD_TARGET_PATH, selectedPath, active - 선택 상태와 표시 대상.
 * 반환값: 명시 반환 없음.
 */
export function selectCraftUploadTarget(targetPath) {
    window.CRAFT_UPLOAD_TARGET_PATH = targetPath.endsWith('/') ? targetPath : targetPath + '/';
    const selectedPath = document.getElementById('craft-upload-selected-path');
    if (selectedPath) selectedPath.textContent = '/' + window.CRAFT_UPLOAD_TARGET_PATH;
    document.querySelectorAll('.craft-upload-target').forEach(btn => {
        const active = btn.dataset.path === window.CRAFT_UPLOAD_TARGET_PATH;
        btn.classList.toggle('border-indigo-500', active);
        btn.classList.toggle('ring-2', active);
        btn.classList.toggle('ring-indigo-500/40', active);
        btn.classList.toggle('bg-indigo-50', active);
        btn.classList.toggle('dark:bg-indigo-900/20', active);
    });
}

/**
 * 역할: 업로드 모달 입력값을 검증하고 선택 임시 이미지를 대상 폴더로 업로드한다.
 * 매개변수: 없음.
 * 주요 변수: input, fileNameInput, CRAFT_UPLOAD_TARGET_PATH - 파일명과 대상 경로.
 * 반환값: 명시 반환 없음.
 */
export async function submitCraftUploadModal() {
    const input = document.getElementById('craft-upload-filename');
    const uploadState = window.CRAFT_UPLOAD_PICKER_STATE || {};
    if (uploadState.mode !== 'direct' && !(uploadState.projectPath && uploadState.characterPath && uploadState.situationId)) {
        return alert('프로젝트, 캐릭터, 상황을 모두 선택해야 업로드할 수 있습니다.');
    }
    if (!window.CRAFT_UPLOAD_TARGET_PATH) return alert('업로드 위치를 선택해주세요.');
    let fileNameInput = '';
    if (uploadState.mode === 'direct') {
        fileNameInput = (input ? input.value.trim() : '').replace(/\.[^/.]+$/, '') || ('nai_' + Date.now());
    } else {
        fileNameInput = window.CRAFT_UPLOAD_SELECTED_SITUATION?.imageNumber || '';
        if (!fileNameInput) return alert('선택한 상황의 이미지 번호를 찾지 못했습니다.');
    }
    await uploadActiveTempImageToTarget(window.CRAFT_UPLOAD_TARGET_PATH, fileNameInput);
}

/**
 * 역할: 선택된 임시 이미지를 WebP로 변환해 목표 폴더에 저장하고 기존 임시 파일/메타데이터를 정리한다.
 * 매개변수: targetPath - 업로드 대상 폴더, fileNameInput - 확장자 없는 새 파일명.
 * 주요 변수: imgData, extractedMetadata, originalFile, finalFile, finalPath, buffer - 이동할 파일과 메타데이터.
 * 반환값: 명시 반환 없음.
 */
async function uploadActiveTempImageToTarget(targetPath, fileNameInput) {
    if (window.CRAFT_UPLOAD_ACTIVE_INDEX === null || window.CRAFT_UPLOAD_ACTIVE_INDEX === undefined) return;
    const index = window.CRAFT_UPLOAD_ACTIVE_INDEX; const imgData = window.TEMP_IMAGES[index]; if (!imgData) return;
    if (targetPath && !targetPath.endsWith('/')) targetPath += '/';

    const btn = document.getElementById('craft-action-upload'); const oldText = btn ? btn.innerHTML : '';
    const submitBtn = document.getElementById('craft-upload-submit-btn'); const oldSubmitText = submitBtn ? submitBtn.innerHTML : '';
    if (btn) { btn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin mr-1.5"></i> 처리 중...'; btn.disabled = true; }
    if (submitBtn) { submitBtn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 inline mr-1.5 animate-spin"></i> 업로드 중...'; submitBtn.disabled = true; }
    if (window.lucide) window.lucide.createIcons();

    try {
        const tempFileName = imgData.key.split('/').pop();
        const extractedMetadata = await window.loadMetadataFromDB(window.TEMP_FOLDER, tempFileName);
        if (!extractedMetadata) {
            throw new Error('임시 저장소의 _meta.json에서 이 이미지와 연결된 메타데이터를 찾지 못했습니다. 업로드를 중단합니다.');
        }

        const fetchRes = await fetch(`/${imgData.key}`);
        if(!fetchRes.ok) throw new Error('임시 파일을 불러오지 못했습니다.');

        const originalBlob = await fetchRes.blob();
        const originalFile = new File([originalBlob], tempFileName, { type: originalBlob.type });

        let finalFile = originalFile;
        if (originalFile.type !== 'image/webp') finalFile = await window.convertToWebP(originalFile);

        const fileName = `${fileNameInput}.webp`;
        const finalPath = targetPath + fileName;
        const headers = { 'X-File-Name': encodeURIComponent(fileName), 'Content-Type': finalFile.type || 'application/octet-stream', 'X-Absolute-Path': encodeURIComponent(finalPath) };
        const buffer = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('FileReader 오류')); r.readAsArrayBuffer(finalFile); });
        const res = await fetch('/api/upload?_t=' + Date.now(), { method: 'PUT', headers, body: buffer, cache: 'no-store' });
        if (!res.ok) throw new Error(`서버 응답 오류 (${res.status})`);

        await window.saveMetadataToDB(targetPath, fileName, extractedMetadata);
        const uploadState = window.CRAFT_UPLOAD_PICKER_STATE || {};
        if (uploadState.mode === 'direct') {
            cacheCraftUploadLocation({ directPath: targetPath });
        } else {
            cacheCraftUploadLocation({
                projectPath: uploadState.projectPath,
                characterPath: uploadState.characterPath,
                situationId: uploadState.situationId
            });
        }
        await fetch('/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', key: imgData.key }) });
        await window.removeMetadataFromDB(window.TEMP_FOLDER, tempFileName);

        alert('성공적으로 업로드했습니다.');
        window.TEMP_IMAGES.splice(index, 1);
        if (window.CRAFT_ACTIVE_INDEX >= window.TEMP_IMAGES.length) window.CRAFT_ACTIVE_INDEX = window.TEMP_IMAGES.length - 1;
        if (window.CRAFT_ACTIVE_INDEX < 0) window.CRAFT_ACTIVE_INDEX = null;
        window.closeCraftUploadModal();
        window.renderTempGallery();
    } catch (err) {
        alert('업로드 실패: ' + err.message);
        if (window.logErrorToStorage) window.logErrorToStorage('임시 이미지 업로드 오류', err);
    } finally {
        if (btn) { btn.innerHTML = oldText; btn.disabled = false; }
        if (submitBtn) { submitBtn.innerHTML = oldSubmitText; submitBtn.disabled = false; }
        if (window.lucide) window.lucide.createIcons();
    }
}

/**
 * 역할: 임시 보관함에 PNG가 많이 쌓이면 오래된 항목을 WebP로 지연 변환한다.
 * 매개변수: 없음.
 * 주요 변수: pngFiles, filesToConvert, webpFile, webpKey, index - 변환 대상과 결과 경로.
 * 반환값: 명시 반환 없음.
 */
export async function processDelayedWebPConversion() {
    const pngFiles = window.TEMP_IMAGES.filter(img => img.key.endsWith('.png'));
    if (pngFiles.length > 5) {
        const filesToConvert = pngFiles.slice(5); 
        for (const fileToConvert of filesToConvert) {
            try {
                const res = await fetch(`/${fileToConvert.key}`); if (!res.ok) continue;
                const blob = await res.blob(); const file = new File([blob], fileToConvert.key.split('/').pop(), { type: blob.type });
                const webpFile = await window.convertToWebP(file); const webpKey = fileToConvert.key.replace('.png', '.webp');
                const buffer = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsArrayBuffer(webpFile); });
                await fetch('/api/upload?_t=' + Date.now(), { method: 'PUT', headers: { 'X-File-Name': encodeURIComponent(webpKey.split('/').pop()), 'Content-Type': 'image/webp', 'X-Absolute-Path': encodeURIComponent(webpKey) }, body: buffer, cache: 'no-store' });
                await fetch('/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', key: fileToConvert.key }) });
                const index = window.TEMP_IMAGES.findIndex(img => img.key === fileToConvert.key);
                if (index !== -1) window.TEMP_IMAGES[index].key = webpKey;
                await window.moveMetadataInDB(window.TEMP_FOLDER, fileToConvert.key.split('/').pop(), window.TEMP_FOLDER, webpKey.split('/').pop());
            } catch (error) { console.error("Delayed WebP conversion error", error); }
        }
        window.renderTempGallery();
    }
}
