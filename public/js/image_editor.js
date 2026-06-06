import { ImageEditorCore } from './image_editor/core.js';
import { getDefaultEditedKey, isSupportedImageKey } from './image_editor/document.js';
import { createAutosave } from './image_editor/autosave.js';
import { getDocument, listImages } from './image_editor/storage.js';

let editor = null;
let autosave = null;
let currentStatus = '이미지 없음';
let globalListenersBound = false;

const TOOL_ITEMS = [
    ['select', 'mouse-pointer-2', '선택'],
    ['brush', 'paintbrush', '브러시'],
    ['mosaic', 'grid-3x3', '모자이크'],
    ['text', 'type', '텍스트'],
    ['rect', 'square', '사각형'],
    ['ellipse', 'circle', '타원'],
    ['line', 'minus', '선'],
    ['arrow', 'move-up-right', '화살표'],
    ['image', 'image-plus', '이미지 추가']
];

export function renderImageEditor(skipHistory = false, options = {}) {
    const root = document.getElementById('main-image-editor-content');
    if (!root) return;
    root.innerHTML = `
        <div class="image-editor-shell">
            <div class="image-editor-topbar">
                <button id="image-editor-back-btn" class="image-editor-icon-btn" title="탐색기로 돌아가기" aria-label="탐색기로 돌아가기"><i data-lucide="arrow-left"></i></button>
                <div class="image-editor-title">
                    <strong id="image-editor-name">이미지 편집기</strong>
                    <span id="image-editor-dirty">${currentStatus}</span>
                </div>
                <div class="image-editor-top-actions">
                    <button id="image-editor-undo-btn" class="image-editor-icon-btn" title="Undo" aria-label="Undo"><i data-lucide="undo-2"></i></button>
                    <button id="image-editor-redo-btn" class="image-editor-icon-btn" title="Redo" aria-label="Redo"><i data-lucide="redo-2"></i></button>
                    <button id="image-editor-save-btn" class="image-editor-command-btn" disabled><i data-lucide="save"></i><span>저장</span></button>
                    <button id="image-editor-save-as-btn" class="image-editor-command-btn" disabled><i data-lucide="copy-plus"></i><span>다른 이름</span></button>
                    <button id="image-editor-recover-btn" class="image-editor-icon-btn" title="복구" aria-label="복구"><i data-lucide="history"></i></button>
                </div>
            </div>
            <div class="image-editor-body">
                <aside class="image-editor-toolbar">
                    ${TOOL_ITEMS.map(([id, icon, label]) => `
                        <button class="image-editor-tool-btn" data-tool="${id}" title="${label}" aria-label="${label}">
                            <i data-lucide="${icon}"></i>
                        </button>
                    `).join('')}
                    <button id="image-editor-zoom-out-btn" class="image-editor-tool-btn" title="축소" aria-label="축소"><i data-lucide="zoom-out"></i></button>
                    <button id="image-editor-zoom-in-btn" class="image-editor-tool-btn" title="확대" aria-label="확대"><i data-lucide="zoom-in"></i></button>
                </aside>
                <section class="image-editor-stage-wrap">
                    <div id="image-editor-empty" class="image-editor-empty">
                        <i data-lucide="image-plus"></i>
                        <h3>편집할 이미지를 선택하세요</h3>
                        <div class="image-editor-open-row">
                            <input id="image-editor-open-key" type="text" placeholder="R2 key 예: project/character/001.webp">
                            <button id="image-editor-open-btn">열기</button>
                        </div>
                        <div class="image-editor-picker">
                            <div class="image-editor-picker-head">
                                <input id="image-editor-prefix" type="text" placeholder="prefix" value="${window.currentPrefix || ''}">
                                <button id="image-editor-list-btn">목록 조회</button>
                            </div>
                            <div id="image-editor-image-list" class="image-editor-image-list"></div>
                        </div>
                    </div>
                    <div id="image-editor-stage" class="image-editor-stage bg-checkered">
                        <canvas id="image-editor-canvas"></canvas>
                        <canvas id="image-editor-preview-canvas"></canvas>
                        <div id="image-editor-overlay"></div>
                    </div>
                </section>
                <aside class="image-editor-inspector">
                    <div class="image-editor-tabs">
                        <button data-editor-panel="properties" class="active">Properties</button>
                        <button data-editor-panel="layers">Layers</button>
                        <button data-editor-panel="history">History</button>
                    </div>
                    <div id="image-editor-panel"></div>
                </aside>
            </div>
            <div class="image-editor-statusbar">
                <span id="image-editor-zoom">zoom -</span>
                <span id="image-editor-size">size -</span>
                <span id="image-editor-autosave">임시 저장 대기</span>
                <span id="image-editor-output">output -</span>
            </div>
        </div>
    `;
    bindImageEditorUi(options);
    if (!skipHistory) history.pushState({ tab: 'image-editor' }, '', '#image-editor');
    window.lucide?.createIcons();
}

export function openImageEditorForKey(sourceKey = '') {
    if (!sourceKey || !isSupportedImageKey(sourceKey)) {
        alert('편집할 수 있는 이미지가 아닙니다.');
        return;
    }
    if (window.closeModal) window.closeModal();
    window.IMAGE_EDITOR_NEXT_OPTIONS = { sourceKey };
    window.switchTab('image-editor', true);
    history.pushState({ tab: 'image-editor', sourceKey }, '', '#image-editor');
}

function bindImageEditorUi(options = {}) {
    const canvas = document.getElementById('image-editor-canvas');
    const previewCanvas = document.getElementById('image-editor-preview-canvas');
    const overlay = document.getElementById('image-editor-overlay');
    editor = new ImageEditorCore({
        canvas,
        previewCanvas,
        overlay,
        onChange: () => {
            autosave?.schedule();
            refreshEditorUi();
        }
    });
    autosave = createAutosave(editor, setAutosaveStatus);

    document.getElementById('image-editor-back-btn')?.addEventListener('click', () => {
        if (editor?.state?.dirty && !confirm('저장하지 않은 편집 내용이 있습니다. 이동할까요?')) return;
        window.switchTab('explorer');
    });
    document.getElementById('image-editor-open-btn')?.addEventListener('click', () => openImageFromInput());
    document.getElementById('image-editor-list-btn')?.addEventListener('click', () => loadImagePicker());
    document.getElementById('image-editor-save-btn')?.addEventListener('click', () => saveImage());
    document.getElementById('image-editor-save-as-btn')?.addEventListener('click', () => saveImageAs());
    document.getElementById('image-editor-recover-btn')?.addEventListener('click', () => recoverDraft());
    document.getElementById('image-editor-zoom-in-btn')?.addEventListener('click', () => editor.zoomBy(0.1));
    document.getElementById('image-editor-zoom-out-btn')?.addEventListener('click', () => editor.zoomBy(-0.1));
    document.querySelectorAll('.image-editor-tool-btn[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => editor.setTool(btn.dataset.tool));
    });
    document.querySelectorAll('[data-editor-panel]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-editor-panel]').forEach(item => item.classList.toggle('active', item === btn));
            renderInspector(btn.dataset.editorPanel);
        });
    });
    if (!globalListenersBound) {
        document.addEventListener('keydown', handleEditorShortcut);
        window.addEventListener('beforeunload', handleBeforeUnload);
        globalListenersBound = true;
    }

    if (options.sourceKey) {
        openImage(options.sourceKey, options.documentId || '').catch(err => setStatus(`열기 실패: ${err.message}`));
    } else {
        loadImagePicker().catch(() => null);
    }
}

function handleBeforeUnload(event) {
    if (!editor?.state?.dirty) return;
    event.preventDefault();
    event.returnValue = '';
}

function handleEditorShortcut(event) {
    const root = document.getElementById('main-image-editor-content');
    if (!root || root.classList.contains('hidden')) return;
    editor?.handleShortcut(event);
}

async function openImageFromInput() {
    const key = document.getElementById('image-editor-open-key')?.value.trim();
    if (!key) return setStatus('R2 key를 입력하세요');
    if (!isSupportedImageKey(key)) return setStatus('지원하지 않는 이미지 형식입니다');
    await openImage(key);
}

async function openImage(sourceKey, documentId = '') {
    setStatus('이미지 로딩 중...');
    const draft = documentId ? await getDocument(documentId, '') : null;
    await editor.openSource(sourceKey, draft?.document || null);
    document.getElementById('image-editor-empty')?.classList.add('hidden');
    document.getElementById('image-editor-stage')?.classList.add('loaded');
    setStatus('수정 가능');
    await autosave.flush();
    refreshEditorUi();
}

async function loadImagePicker() {
    const prefix = document.getElementById('image-editor-prefix')?.value || window.currentPrefix || '';
    const listEl = document.getElementById('image-editor-image-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="image-editor-picker-status">목록 조회 중...</div>';
    try {
        const images = await listImages(prefix);
        if (!images.length) {
            listEl.innerHTML = '<div class="image-editor-picker-status">이미지가 없습니다.</div>';
            return;
        }
        listEl.innerHTML = images.map(file => `
            <button type="button" data-key="${escapeHtml(file.key)}" title="${escapeHtml(file.key)}">
                <img src="/${file.key.split('/').map(encodeURIComponent).join('/')}">
                <span>${escapeHtml(file.key.split('/').pop())}</span>
            </button>
        `).join('');
        listEl.querySelectorAll('button[data-key]').forEach(btn => {
            btn.addEventListener('click', () => openImage(btn.dataset.key));
        });
    } catch (err) {
        listEl.innerHTML = `<div class="image-editor-picker-status">${escapeHtml(err.message)}</div>`;
    }
}

async function recoverDraft() {
    if (!editor?.state?.sourceKey) return setStatus('먼저 원본 이미지를 여세요');
    const result = await getDocument('', editor.state.sourceKey);
    if (!result?.document) return setStatus('복구 가능한 작업이 없습니다');
    if (!confirm('가장 최근 임시 저장 작업을 복구할까요?')) return;
    await openImage(editor.state.sourceKey, result.document.documentId);
}

async function saveImage() {
    if (!editor?.sourceImage) return;
    if (!confirm('원본 이미지를 덮어씁니다. 저장 전 원본과 metadata 백업을 생성합니다.')) return;
    await runSave('overwrite');
}

async function saveImageAs() {
    if (!editor?.sourceImage) return;
    const defaultKey = getDefaultEditedKey(editor.state.sourceKey);
    const outputKey = prompt('다른 이름으로 저장할 R2 key', defaultKey);
    if (!outputKey) return;
    await runSave('save-as', outputKey);
}

async function runSave(mode, outputKey = '') {
    setStatus('저장 중...');
    try {
        const result = await editor.save(mode, outputKey);
        setStatus(`저장됨: ${result.outputKey}`);
        await autosave.flush();
        if (window.refreshGallery) window.refreshGallery();
    } catch (err) {
        setStatus(`저장 실패: ${err.message}`);
    }
}

function refreshEditorUi() {
    if (!editor) return;
    const state = editor.state;
    const active = state.activeTool;
    document.querySelectorAll('.image-editor-tool-btn[data-tool]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === active);
    });
    const name = document.getElementById('image-editor-name');
    if (name) name.textContent = state.sourceFileName || '이미지 편집기';
    const dirty = document.getElementById('image-editor-dirty');
    if (dirty) dirty.textContent = state.dirty ? '수정됨' : currentStatus;
    const saveBtn = document.getElementById('image-editor-save-btn');
    const saveAsBtn = document.getElementById('image-editor-save-as-btn');
    if (saveBtn) saveBtn.disabled = !editor.sourceImage || !state.dirty;
    if (saveAsBtn) saveAsBtn.disabled = !editor.sourceImage;
    const status = editor.getStatus();
    const undoBtn = document.getElementById('image-editor-undo-btn');
    const redoBtn = document.getElementById('image-editor-redo-btn');
    if (undoBtn) undoBtn.disabled = !status.canUndo;
    if (redoBtn) redoBtn.disabled = !status.canRedo;
    document.getElementById('image-editor-zoom').textContent = `zoom ${Math.round((state.zoom || 1) * 100)}%`;
    document.getElementById('image-editor-size').textContent = state.imageWidth ? `${state.imageWidth} x ${state.imageHeight}` : 'size -';
    document.getElementById('image-editor-output').textContent = state.outputKey || 'output -';
    const activePanel = document.querySelector('[data-editor-panel].active')?.dataset.editorPanel || 'properties';
    renderInspector(activePanel);
    window.lucide?.createIcons();
}

function renderInspector(panel = 'properties') {
    const target = document.getElementById('image-editor-panel');
    if (!target || !editor) return;
    if (panel === 'layers') return renderLayersPanel(target);
    if (panel === 'history') return renderHistoryPanel(target);
    renderPropertiesPanel(target);
}

function renderPropertiesPanel(target) {
    const tool = editor.state.activeTool;
    const selectedLayer = editor.state.layers.find(layer => layer.id === editor.state.selectedLayerIds[0]);
    if (selectedLayer && selectedLayer.type !== 'sourceImage') {
        target.innerHTML = `
            <div class="image-editor-panel-section">
                <h4>선택 레이어</h4>
                <label>이름 <input data-layer-field="name" value="${escapeHtml(selectedLayer.name || '')}"></label>
                <label>Opacity <input data-layer-field="opacity" type="range" min="0" max="1" step="0.05" value="${selectedLayer.opacity ?? 1}"></label>
                <button id="image-editor-delete-layer" class="image-editor-danger-btn"><i data-lucide="trash-2"></i><span>삭제</span></button>
            </div>
        `;
        target.querySelectorAll('[data-layer-field]').forEach(input => {
            input.addEventListener('change', () => {
                const value = input.type === 'range' ? Number(input.value) : input.value;
                editor.setLayerPatch(selectedLayer.id, { [input.dataset.layerField]: value });
            });
        });
        target.querySelector('#image-editor-delete-layer')?.addEventListener('click', () => editor.deleteSelectedLayer());
        return;
    }
    if (tool === 'brush') {
        const o = editor.state.toolOptions.brush;
        target.innerHTML = optionHtml('브러시', [
            ['size', '크기', 'range', 1, 120, 1, o.size],
            ['color', '색상', 'color', null, null, null, o.color],
            ['opacity', 'Opacity', 'range', 0, 1, 0.05, o.opacity]
        ], 'brush');
    } else if (tool === 'mosaic') {
        const o = editor.state.toolOptions.mosaic;
        target.innerHTML = optionHtml('모자이크', [
            ['size', '브러시 크기', 'range', 8, 180, 1, o.size],
            ['blockSize', '블록 크기', 'range', 2, 64, 1, o.blockSize],
            ['strength', '강도', 'range', 0, 1, 0.05, o.strength]
        ], 'mosaic');
    } else if (tool === 'text') {
        const o = editor.state.toolOptions.text;
        target.innerHTML = optionHtml('텍스트', [
            ['fontSize', '크기', 'number', 8, 160, 1, o.fontSize],
            ['color', '색상', 'color', null, null, null, o.color],
            ['opacity', 'Opacity', 'range', 0, 1, 0.05, o.opacity]
        ], 'text');
    } else {
        const o = editor.state.toolOptions.shape;
        target.innerHTML = optionHtml('도형', [
            ['strokeColor', '선 색상', 'color', null, null, null, o.strokeColor],
            ['fillColor', '채우기', 'text', null, null, null, o.fillColor],
            ['strokeWidth', '선 굵기', 'range', 1, 32, 1, o.strokeWidth],
            ['opacity', 'Opacity', 'range', 0, 1, 0.05, o.opacity]
        ], 'shape');
    }
    target.querySelectorAll('[data-option-tool]').forEach(input => {
        input.addEventListener('input', () => {
            const value = input.type === 'range' || input.type === 'number' ? Number(input.value) : input.value;
            editor.setOption(input.dataset.optionTool, input.dataset.optionKey, value);
        });
    });
}

function optionHtml(title, rows, tool) {
    return `
        <div class="image-editor-panel-section">
            <h4>${title}</h4>
            ${rows.map(([key, label, type, min, max, step, value]) => `
                <label>${label}
                    <input data-option-tool="${tool}" data-option-key="${key}" type="${type}" ${min !== null ? `min="${min}"` : ''} ${max !== null ? `max="${max}"` : ''} ${step !== null ? `step="${step}"` : ''} value="${escapeHtml(String(value ?? ''))}">
                </label>
            `).join('')}
        </div>
    `;
}

function renderLayersPanel(target) {
    target.innerHTML = `
        <div class="image-editor-layer-list">
            ${[...editor.state.layers].reverse().map(layer => `
                <div class="image-editor-layer-item ${editor.state.selectedLayerIds.includes(layer.id) ? 'active' : ''}" data-layer-id="${layer.id}">
                    <button data-layer-visible="${layer.id}" title="표시" aria-label="표시"><i data-lucide="${layer.visible ? 'eye' : 'eye-off'}"></i></button>
                    <button data-layer-lock="${layer.id}" title="잠금" aria-label="잠금"><i data-lucide="${layer.locked ? 'lock' : 'unlock'}"></i></button>
                    <span>${escapeHtml(layer.name || layer.type)}</span>
                    <small>${escapeHtml(layer.type)}</small>
                </div>
            `).join('')}
        </div>
    `;
    target.querySelectorAll('.image-editor-layer-item').forEach(item => {
        item.addEventListener('click', event => {
            if (event.target.closest('button')) return;
            editor.state.selectedLayerIds = [item.dataset.layerId];
            editor.render();
            editor.emitChange();
        });
    });
    target.querySelectorAll('[data-layer-visible]').forEach(btn => {
        btn.addEventListener('click', () => {
            const layer = editor.state.layers.find(item => item.id === btn.dataset.layerVisible);
            editor.setLayerPatch(layer.id, { visible: !layer.visible });
        });
    });
    target.querySelectorAll('[data-layer-lock]').forEach(btn => {
        btn.addEventListener('click', () => {
            const layer = editor.state.layers.find(item => item.id === btn.dataset.layerLock);
            if (layer.type !== 'sourceImage') editor.setLayerPatch(layer.id, { locked: !layer.locked });
        });
    });
}

function renderHistoryPanel(target) {
    target.innerHTML = `
        <div class="image-editor-history-list">
            ${editor.history.stack.map((cmd, index) => `
                <div class="${index === editor.history.index ? 'active' : ''}">
                    <span>${escapeHtml(cmd.label || '작업')}</span>
                    <small>${new Date(cmd.createdAt).toLocaleTimeString()}</small>
                </div>
            `).join('') || '<p class="image-editor-empty-note">작업 내역 없음</p>'}
        </div>
    `;
}

function setStatus(message) {
    currentStatus = message;
    refreshEditorUi();
}

function setAutosaveStatus(message) {
    const el = document.getElementById('image-editor-autosave');
    if (el) el.textContent = message;
}

function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
