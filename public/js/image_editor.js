import { ImageEditorCore } from './image_editor/core.js?v=image-editor-brush-20260607a';
import { getDefaultEditedKey, isSupportedImageKey } from './image_editor/document.js?v=image-editor-brush-20260607a';
import { createOrUpdateDocument, deleteEditorDocument, getDocument, listEditorDocuments } from './image_editor/storage.js?v=image-editor-brush-20260607a';

let editor = null;
let currentStatus = '이미지 없음';
let globalListenersBound = false;
let editorProjectPrefix = '';
let editorLibraryBasePrefix = '';
let editorLibraryCurrentPrefix = '';
let editorLibraryMode = 'image';
let workDirty = false;
let savedWorkRevision = 0;
const editorSessionCache = new Map();

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
    const root = document.getElementById(options.rootId || 'main-image-editor-content');
    if (!root) return;
    rememberCurrentEditorSession();
    root.innerHTML = `
        <div class="image-editor-shell">
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
                        <button id="image-editor-empty-open-btn" type="button" class="image-editor-primary-btn">
                            <i data-lucide="folder-open"></i>
                            <span>이미지 불러오기</span>
                        </button>
                    </div>
                    <div id="image-editor-stage" class="image-editor-stage bg-checkered">
                        <canvas id="image-editor-canvas"></canvas>
                        <canvas id="image-editor-preview-canvas"></canvas>
                        <div id="image-editor-overlay"></div>
                    </div>
                </section>
                <aside class="image-editor-inspector">
                    <div id="image-editor-panel"></div>
                </aside>
            </div>
            <div class="image-editor-statusbar">
                <span id="image-editor-zoom">zoom -</span>
                <span id="image-editor-size">size -</span>
                <span id="image-editor-autosave">작업 저장 안 됨</span>
                <span id="image-editor-output">output -</span>
            </div>
        </div>
    `;
    bindImageEditorUi(options);
    if (!skipHistory && !options.rootId) history.pushState({ tab: 'image-editor' }, '', '#image-editor');
    window.lucide?.createIcons();
}

export function openImageEditorForKey(sourceKey = '') {
    if (!sourceKey || !isSupportedImageKey(sourceKey)) {
        alert('편집할 수 있는 이미지가 아닙니다.');
        return;
    }
    if (window.closeModal) window.closeModal();
    window.PROJECT_IMAGE_EDITOR_NEXT_OPTIONS = { sourceKey };
    window.switchTab?.('project', true);
    const openSection = () => window.openProjectSection?.('image-editor');
    const project = getProjectForImageKey(sourceKey);
    if (project && window.openProjectDetail) {
        window.PROJECT_ACTIVE_PROJECT_ID = project.id;
        window.openProjectDetail(project.id, true).then(openSection);
    } else {
        openSection();
    }
}

function bindImageEditorUi(options = {}) {
    editorProjectPrefix = options.projectPrefix || window.currentPrefix || '';
    editorLibraryBasePrefix = editorProjectPrefix || window.ROOT_PATH || '';
    workDirty = false;
    savedWorkRevision = 0;
    const canvas = document.getElementById('image-editor-canvas');
    const previewCanvas = document.getElementById('image-editor-preview-canvas');
    const overlay = document.getElementById('image-editor-overlay');
    editor = new ImageEditorCore({
        canvas,
        previewCanvas,
        overlay,
        onChange: () => {
            workDirty = !!editor?.sourceImage && editor.workRevision > savedWorkRevision;
            setWorkStatus(workDirty ? '작업 저장 필요' : '작업 저장 안 됨');
            refreshEditorUi();
        }
    });

    document.getElementById('image-editor-back-btn')?.addEventListener('click', async () => {
        if (!await confirmUnsavedWorkBeforeLeave()) return;
        const projectId = window.PROJECT_ACTIVE_PROJECT_ID || '';
        if (projectId && window.openProjectDetail) window.openProjectDetail(projectId, false);
        else window.switchTab('project');
    });
    document.getElementById('image-editor-open-library-btn')?.addEventListener('click', () => openImageEditorLibraryModal());
    document.getElementById('image-editor-empty-open-btn')?.addEventListener('click', () => openImageEditorLibraryModal());
    document.getElementById('image-editor-save-work-btn')?.addEventListener('click', () => saveWorkDocument());
    document.getElementById('image-editor-save-btn')?.addEventListener('click', () => saveImage());
    document.getElementById('image-editor-save-as-btn')?.addEventListener('click', () => saveImageAs());
    document.getElementById('image-editor-zoom-in-btn')?.addEventListener('click', () => editor.zoomBy(0.1));
    document.getElementById('image-editor-zoom-out-btn')?.addEventListener('click', () => editor.zoomBy(-0.1));
    document.querySelectorAll('.image-editor-tool-btn[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => editor.setTool(btn.dataset.tool));
    });
    if (!globalListenersBound) {
        document.addEventListener('keydown', handleEditorShortcut);
        window.addEventListener('beforeunload', handleBeforeUnload);
        globalListenersBound = true;
    }

    if (options.sourceKey) {
        openImage(options.sourceKey, options.documentId || '').catch(err => setStatus(`열기 실패: ${err.message}`));
    } else {
        restoreCachedEditorSession().catch(err => setStatus(`작업물 복원 실패: ${err.message}`));
    }
}

function handleBeforeUnload(event) {
    if (!hasUnsavedWork()) return;
    event.preventDefault();
    event.returnValue = '';
}

function handleEditorShortcut(event) {
    const root = document.querySelector('.image-editor-shell');
    if (!root || root.closest('.hidden')) return;
    editor?.handleShortcut(event);
}

async function openImage(sourceKey, documentId = '') {
    setStatus('이미지 로딩 중...');
    const draft = documentId ? await getDocument(documentId, '') : null;
    await openEditorDocument(sourceKey, draft?.document || null, documentId ? '작업물 불러옴' : '수정 가능', documentId ? '작업물 불러옴' : '작업 저장 안 됨');
}

async function openEditorDocument(sourceKey, editorDocument = null, statusMessage = '수정 가능', workStatusMessage = '작업 저장 안 됨') {
    await editor.openSource(sourceKey, editorDocument);
    document.getElementById('image-editor-empty')?.classList.add('hidden');
    document.getElementById('image-editor-stage')?.classList.add('loaded');
    workDirty = false;
    savedWorkRevision = editor.workRevision || 0;
    setStatus(statusMessage);
    setWorkStatus(workStatusMessage);
    refreshEditorUi();
}

export async function openImageEditorLibraryModal(mode = 'image') {
    ensureImageEditorLibraryModal();
    const modal = document.getElementById('image-editor-library-modal');
    if (!modal) return;
    setImageEditorLibraryMode(mode);
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (editorLibraryMode === 'work') await loadImageEditorWorkList();
    else await loadImageEditorLibraryPath(editorLibraryBasePrefix);
}

export function closeImageEditorLibraryModal(event) {
    if (event && event.target !== event.currentTarget && event.target.id !== 'close-image-editor-library-btn') return;
    const modal = document.getElementById('image-editor-library-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function loadImageEditorLibraryPath(prefix = '') {
    setImageEditorLibraryMode('image');
    editorLibraryCurrentPrefix = prefix;
    const pathDisplay = document.getElementById('image-editor-library-path');
    const grid = document.getElementById('image-editor-library-grid');
    const loader = document.getElementById('image-editor-library-loading');
    const empty = document.getElementById('image-editor-library-empty');
    if (!grid || !loader || !empty) return;

    if (pathDisplay) pathDisplay.textContent = `/${prefix}`;
    grid.innerHTML = '';
    grid.classList.add('hidden');
    loader.classList.remove('hidden');
    loader.classList.add('flex');
    empty.classList.add('hidden');
    empty.classList.remove('flex');

    try {
        const [listRes, aliasRes] = await Promise.all([
            fetch(`/api/list?prefix=${encodeURIComponent(prefix)}&_t=${Date.now()}`, { cache: 'no-store' }),
            fetch(`/api/aliases?prefix=${encodeURIComponent(prefix)}&_t=${Date.now()}`, { cache: 'no-store' }).catch(() => null)
        ]);
        if (!listRes.ok) throw new Error('이미지 목록을 불러오지 못했습니다.');
        const data = await listRes.json();
        if (aliasRes?.ok) {
            const aliases = await aliasRes.json().catch(() => null);
            if (aliases) {
                window.GLOBAL_ALIASES = aliases.global || window.GLOBAL_ALIASES || {};
                window.PROJECT_ALIASES = aliases.project || window.PROJECT_ALIASES || {};
            }
        }

        const folders = data.folders || [];
        const files = (data.files || []).filter(file => isSupportedImageKey(file.key || ''));
        if (prefix !== editorLibraryBasePrefix) {
            const parts = prefix.split('/').filter(Boolean);
            parts.pop();
            const parentPrefix = parts.length ? `${parts.join('/')}/` : editorLibraryBasePrefix;
            grid.appendChild(createLibraryFolderCard({
                label: '상위 폴더',
                icon: 'corner-left-up',
                kind: 'parent',
                onClick: () => loadImageEditorLibraryPath(parentPrefix)
            }));
        }
        folders.forEach(folderPrefix => {
            const folderName = folderPrefix.split('/').filter(Boolean).pop() || folderPrefix;
            const alias = window.getAliasOnly ? window.getAliasOnly(folderPrefix, true) : '';
            grid.appendChild(createLibraryFolderCard({
                label: alias || folderName,
                subLabel: alias ? folderName : '',
                icon: 'folder',
                kind: 'folder',
                onClick: () => loadImageEditorLibraryPath(folderPrefix)
            }));
        });
        files.forEach(file => grid.appendChild(createLibraryImageCard(file)));
        loader.classList.add('hidden');
        loader.classList.remove('flex');
        if (!grid.children.length) {
            empty.classList.remove('hidden');
            empty.classList.add('flex');
        } else {
            grid.classList.remove('hidden');
        }
        window.lucide?.createIcons();
    } catch (err) {
        loader.classList.add('hidden');
        loader.classList.remove('flex');
        empty.textContent = err.message || '이미지 목록을 불러오지 못했습니다.';
        empty.classList.remove('hidden');
        empty.classList.add('flex');
    }
}

async function loadImageEditorWorkList() {
    setImageEditorLibraryMode('work');
    const pathDisplay = document.getElementById('image-editor-library-path');
    const grid = document.getElementById('image-editor-library-grid');
    const loader = document.getElementById('image-editor-library-loading');
    const empty = document.getElementById('image-editor-library-empty');
    if (!grid || !loader || !empty) return;

    if (pathDisplay) pathDisplay.textContent = editorLibraryBasePrefix ? `/${editorLibraryBasePrefix}` : '/';
    grid.innerHTML = '';
    grid.classList.add('hidden');
    loader.classList.remove('hidden');
    loader.classList.add('flex');
    empty.classList.add('hidden');
    empty.classList.remove('flex');

    try {
        const documents = await listEditorDocuments(editorLibraryBasePrefix);
        documents.forEach(row => grid.appendChild(createLibraryWorkCard(row)));
        loader.classList.add('hidden');
        loader.classList.remove('flex');
        if (!grid.children.length) {
            empty.textContent = '저장된 작업물이 없습니다.';
            empty.classList.remove('hidden');
            empty.classList.add('flex');
        } else {
            grid.classList.remove('hidden');
        }
        window.lucide?.createIcons();
    } catch (err) {
        loader.classList.add('hidden');
        loader.classList.remove('flex');
        empty.textContent = err.message || '작업물 목록을 불러오지 못했습니다.';
        empty.classList.remove('hidden');
        empty.classList.add('flex');
    }
}

function createLibraryFolderCard({ label, subLabel = '', icon = 'folder', kind = 'folder', onClick }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = kind === 'folder'
        ? 'image-editor-library-folder-card'
        : 'image-editor-library-parent-card';
    button.onclick = onClick;
    button.innerHTML = `
        <i data-lucide="${icon}"></i>
        <span>${escapeHtml(label)}</span>
        ${subLabel ? `<small>${escapeHtml(subLabel)}</small>` : ''}
    `;
    return button;
}

function createLibraryImageCard(file) {
    const fileName = file.key.split('/').pop() || file.key;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'image-editor-library-image-card';
    button.title = file.key;
    button.innerHTML = `
        <img src="/${file.key.split('/').map(encodeURIComponent).join('/')}" alt="">
        <span>${escapeHtml(fileName)}</span>
    `;
    button.onclick = async () => {
        if (!await confirmUnsavedWorkBeforeReplace()) return;
        closeImageEditorLibraryModal();
        await openImage(file.key);
    };
    return button;
}

function createLibraryWorkCard(row) {
    const sourceName = String(row.source_key || '').split('/').pop() || row.id || '작업물';
    const updatedAt = row.updated_at ? new Date(row.updated_at).toLocaleString() : '';
    const card = document.createElement('div');
    card.className = 'image-editor-library-work-card';
    card.role = 'button';
    card.tabIndex = 0;
    card.title = row.source_key || row.id || '';
    card.innerHTML = `
        <i data-lucide="file-stack"></i>
        <span class="image-editor-library-work-name">${escapeHtml(sourceName)}</span>
        <small>${escapeHtml(updatedAt)}</small>
        <button type="button" class="image-editor-library-work-delete" title="작업물 삭제" aria-label="작업물 삭제">
            <i data-lucide="trash-2"></i>
        </button>
    `;
    const open = async () => {
        if (!await confirmUnsavedWorkBeforeReplace()) return;
        closeImageEditorLibraryModal();
        await openWorkDocument(row.id);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', event => {
        if (!['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        open();
    });
    card.querySelector('.image-editor-library-work-delete')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        deleteWorkDocument(row);
    });
    return card;
}

function ensureImageEditorLibraryModal() {
    if (document.getElementById('image-editor-library-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'image-editor-library-modal';
    modal.className = 'fixed inset-0 bg-black/70 z-[70] hidden items-center justify-center p-3 sm:p-6';
    modal.onclick = event => closeImageEditorLibraryModal(event);
    modal.innerHTML = `
        <div class="bg-white dark:bg-gray-900 w-full max-w-5xl max-h-[88vh] rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden" onclick="event.stopPropagation()">
            <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <div class="min-w-0">
                    <h3 class="text-sm font-bold text-gray-900 dark:text-white">편집할 이미지 선택</h3>
                    <p id="image-editor-library-path" class="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[70vw]">/</p>
                </div>
                <button id="close-image-editor-library-btn" type="button" class="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition" aria-label="닫기">
                    <i data-lucide="x" class="w-5 h-5"></i>
                </button>
            </div>
            <div class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70">
                <div class="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-1">
                    <button id="image-editor-library-image-mode" type="button" class="image-editor-library-mode-btn active">
                        <i data-lucide="image"></i><span>이미지 불러오기</span>
                    </button>
                    <button id="image-editor-library-work-mode" type="button" class="image-editor-library-mode-btn">
                        <i data-lucide="file-stack"></i><span>작업 불러오기</span>
                    </button>
                </div>
            </div>
            <div class="flex-1 min-h-0 overflow-auto p-4">
                <div id="image-editor-library-loading" class="hidden items-center justify-center py-12 text-gray-500 text-sm">
                    <i data-lucide="loader" class="w-5 h-5 mr-2 animate-spin"></i> 이미지를 불러오는 중...
                </div>
                <div id="image-editor-library-empty" class="hidden items-center justify-center py-12 text-gray-500 text-sm">선택할 수 있는 이미지가 없습니다.</div>
                <div id="image-editor-library-grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"></div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('close-image-editor-library-btn')?.addEventListener('click', () => closeImageEditorLibraryModal());
    document.getElementById('image-editor-library-image-mode')?.addEventListener('click', () => loadImageEditorLibraryPath(editorLibraryCurrentPrefix || editorLibraryBasePrefix));
    document.getElementById('image-editor-library-work-mode')?.addEventListener('click', () => loadImageEditorWorkList());
    window.lucide?.createIcons();
}

function setImageEditorLibraryMode(mode = 'image') {
    editorLibraryMode = mode === 'work' ? 'work' : 'image';
    const title = document.querySelector('#image-editor-library-modal h3');
    const loader = document.getElementById('image-editor-library-loading');
    const empty = document.getElementById('image-editor-library-empty');
    if (title) title.textContent = editorLibraryMode === 'work' ? '작업 불러오기' : '이미지 불러오기';
    if (loader) loader.innerHTML = editorLibraryMode === 'work'
        ? '<i data-lucide="loader" class="w-5 h-5 mr-2 animate-spin"></i> 작업물을 불러오는 중...'
        : '<i data-lucide="loader" class="w-5 h-5 mr-2 animate-spin"></i> 이미지를 불러오는 중...';
    if (empty) empty.textContent = editorLibraryMode === 'work' ? '저장된 작업물이 없습니다.' : '선택할 수 있는 이미지가 없습니다.';
    document.getElementById('image-editor-library-image-mode')?.classList.toggle('active', editorLibraryMode === 'image');
    document.getElementById('image-editor-library-work-mode')?.classList.toggle('active', editorLibraryMode === 'work');
    window.lucide?.createIcons();
}

async function openWorkDocument(documentId = '') {
    if (!documentId) return;
    setStatus('작업물 로딩 중...');
    const result = await getDocument(documentId, '');
    if (!result?.document?.sourceKey) throw new Error('작업물을 불러오지 못했습니다.');
    await openEditorDocument(result.document.sourceKey, result.document, '작업물 불러옴', '작업물 불러옴');
}

async function saveWorkDocument() {
    if (!editor?.sourceImage) return setStatus('먼저 이미지를 여세요');
    setWorkStatus('작업 저장 중...');
    try {
        const result = await createOrUpdateDocument(editor.serializeDocument());
        workDirty = false;
        savedWorkRevision = editor.workRevision || 0;
        setWorkStatus('작업 저장됨');
        setStatus(`작업물 저장됨: ${result.documentId}`);
        rememberCurrentEditorSession();
        refreshEditorUi();
    } catch (err) {
        setWorkStatus(`작업 저장 실패: ${err.message}`);
        setStatus(`작업 저장 실패: ${err.message}`);
    }
}

async function deleteWorkDocument(row) {
    const sourceName = String(row?.source_key || '').split('/').pop() || row?.id || '작업물';
    if (!row?.id) return;
    if (!confirm(`'${sourceName}' 작업물을 삭제하시겠습니까?\n삭제한 작업물은 불러올 수 없습니다.`)) return;
    setStatus('작업물 삭제 중...');
    try {
        await deleteEditorDocument(row.id);
        setStatus('작업물 삭제됨');
        removeCachedEditorSession(row.id);
        await loadImageEditorWorkList();
    } catch (err) {
        setStatus(`작업물 삭제 실패: ${err.message}`);
        alert(err.message || '작업물 삭제 실패');
    }
}

function getEditorSessionCacheKey(prefix = editorProjectPrefix) {
    return prefix || 'global';
}

function rememberCurrentEditorSession() {
    if (!editor?.sourceImage || !editor.state?.sourceKey) return;
    try {
        editorSessionCache.set(getEditorSessionCacheKey(), {
            document: editor.serializeDocument(),
            status: currentStatus,
            workRevision: editor.workRevision || 0,
            savedWorkRevision,
            workDirty
        });
    } catch (err) {
        console.warn('image editor session cache failed', err);
    }
}

async function restoreCachedEditorSession() {
    const cached = editorSessionCache.get(getEditorSessionCacheKey());
    if (!cached?.document?.sourceKey) return;
    await openEditorDocument(
        cached.document.sourceKey,
        cached.document,
        cached.status || '작업물 복원됨',
        cached.workDirty ? '작업 저장 필요' : '작업물 복원됨'
    );
    editor.workRevision = cached.workRevision || 0;
    savedWorkRevision = cached.savedWorkRevision || 0;
    workDirty = !!cached.workDirty && editor.workRevision > savedWorkRevision;
    setWorkStatus(workDirty ? '작업 저장 필요' : '작업물 복원됨');
    refreshEditorUi();
}

function removeCachedEditorSession(documentId = '') {
    const cached = editorSessionCache.get(getEditorSessionCacheKey());
    if (!cached?.document) return;
    if (!documentId || cached.document.documentId === documentId) {
        editorSessionCache.delete(getEditorSessionCacheKey());
    }
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
    const saveWorkBtn = document.getElementById('image-editor-save-work-btn');
    if (saveWorkBtn) saveWorkBtn.disabled = !editor.sourceImage;
    const status = editor.getStatus();
    const undoBtn = document.getElementById('image-editor-undo-btn');
    const redoBtn = document.getElementById('image-editor-redo-btn');
    if (undoBtn) undoBtn.disabled = !status.canUndo;
    if (redoBtn) redoBtn.disabled = !status.canRedo;
    document.getElementById('image-editor-zoom').textContent = `zoom ${Math.round((state.zoom || 1) * 100)}%`;
    document.getElementById('image-editor-size').textContent = state.imageWidth ? `${state.imageWidth} x ${state.imageHeight}` : 'size -';
    document.getElementById('image-editor-output').textContent = state.outputKey || 'output -';
    renderInspector();
    window.lucide?.createIcons();
}

function renderInspector() {
    const target = document.getElementById('image-editor-panel');
    if (!target || !editor) return;
    target.innerHTML = `
        <section class="image-editor-inspector-section">
            <h3>Properties</h3>
            <div id="image-editor-properties-panel"></div>
        </section>
        <section class="image-editor-inspector-section">
            <h3>Layers</h3>
            <div id="image-editor-layers-panel"></div>
        </section>
        <section class="image-editor-inspector-section">
            <h3>History</h3>
            <div id="image-editor-history-panel"></div>
        </section>
    `;
    renderPropertiesPanel(document.getElementById('image-editor-properties-panel'));
    renderLayersPanel(document.getElementById('image-editor-layers-panel'));
    renderHistoryPanel(document.getElementById('image-editor-history-panel'));
}

function renderPropertiesPanel(target) {
    if (!target) return;
    const tool = editor.state.activeTool;
    const selectedLayer = editor.state.layers.find(layer => layer.id === editor.state.selectedLayerIds[0]);
    if (selectedLayer && selectedLayer.type !== 'sourceImage') {
        const optionBlock = selectedLayer.type === 'raster'
            ? brushOptionHtml()
            : selectedLayer.type === 'mosaic'
                ? mosaicOptionHtml()
                : '';
        target.innerHTML = `${layerOptionHtml(selectedLayer)}${optionBlock}`;
        bindLayerOptions(target, selectedLayer);
        bindToolOptions(target);
        return;
    }
    if (tool === 'brush') {
        target.innerHTML = brushOptionHtml();
    } else if (tool === 'mosaic') {
        target.innerHTML = mosaicOptionHtml();
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
    bindToolOptions(target);
}

function optionHtml(title, rows, tool) {
    return `
        <div class="image-editor-panel-section">
            <h4>${title}</h4>
            ${rows.map(([key, label, type, min, max, step, value]) => `
                <label>${label}
                    <input data-option-tool="${tool}" data-option-key="${key}" type="${type}" ${type === 'checkbox' && value ? 'checked' : ''} ${min !== null ? `min="${min}"` : ''} ${max !== null ? `max="${max}"` : ''} ${step !== null ? `step="${step}"` : ''} ${type !== 'checkbox' ? `value="${escapeHtml(String(value ?? ''))}"` : ''}>
                </label>
            `).join('')}
        </div>
    `;
}

function layerOptionHtml(layer) {
    return `
        <div class="image-editor-panel-section">
            <h4>선택 레이어</h4>
            <label>이름 <input data-layer-field="name" value="${escapeHtml(layer.name || '')}"></label>
            <label>Opacity <input data-layer-field="opacity" type="range" min="0" max="1" step="0.05" value="${layer.opacity ?? 1}"></label>
            <button id="image-editor-delete-layer" class="image-editor-danger-btn" ${layer.locked ? 'disabled' : ''}><i data-lucide="trash-2"></i><span>삭제</span></button>
        </div>
    `;
}

function brushOptionHtml() {
    const o = editor.state.toolOptions.brush;
    return optionHtml('브러시', [
        ['size', '크기', 'range', 1, 120, 1, o.size],
        ['color', '색상', 'color', null, null, null, o.color],
        ['opacity', 'Opacity', 'range', 0, 1, 0.05, o.opacity],
        ['erase', '지우기', 'checkbox', null, null, null, !!o.erase]
    ], 'brush');
}

function mosaicOptionHtml() {
    const o = editor.state.toolOptions.mosaic;
    return optionHtml('모자이크', [
        ['size', '브러시 크기', 'range', 8, 180, 1, o.size],
        ['blockSize', '블록 크기', 'range', 2, 64, 1, o.blockSize],
        ['strength', '강도', 'range', 0, 1, 0.05, o.strength]
    ], 'mosaic');
}

function bindLayerOptions(target, selectedLayer) {
    target.querySelectorAll('[data-layer-field]').forEach(input => {
        input.addEventListener('change', () => {
            const value = input.type === 'range' ? Number(input.value) : input.value;
            editor.setLayerPatch(selectedLayer.id, { [input.dataset.layerField]: value });
        });
    });
    target.querySelector('#image-editor-delete-layer')?.addEventListener('click', () => editor.deleteSelectedLayer());
}

function bindToolOptions(target) {
    target.querySelectorAll('[data-option-tool]').forEach(input => {
        const eventName = input.type === 'checkbox' ? 'change' : 'input';
        input.addEventListener(eventName, () => {
            const value = input.type === 'checkbox'
                ? input.checked
                : input.type === 'range' || input.type === 'number'
                    ? Number(input.value)
                    : input.value;
            editor.setOption(input.dataset.optionTool, input.dataset.optionKey, value);
        });
    });
}

function renderLayersPanel(target) {
    if (!target) return;
    target.innerHTML = `
        <div class="image-editor-layer-list">
            ${[...editor.state.layers].reverse().map(layer => `
                <div class="image-editor-layer-item ${editor.state.selectedLayerIds.includes(layer.id) ? 'active' : ''}" data-layer-id="${layer.id}">
                    <button data-layer-visible="${layer.id}" title="표시" aria-label="표시"><i data-lucide="${layer.visible ? 'eye' : 'eye-off'}"></i></button>
                    <button data-layer-lock="${layer.id}" title="잠금" aria-label="잠금"><i data-lucide="${layer.locked ? 'lock' : 'unlock'}"></i></button>
                    <span>${escapeHtml(layer.name || layer.type)}</span>
                    <small>${escapeHtml(layer.type)}</small>
                    <button data-layer-delete="${layer.id}" title="삭제" aria-label="삭제" ${layer.type === 'sourceImage' || layer.locked ? 'disabled' : ''}><i data-lucide="trash-2"></i></button>
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
    target.querySelectorAll('[data-layer-delete]').forEach(btn => {
        btn.addEventListener('click', () => {
            const layer = editor.state.layers.find(item => item.id === btn.dataset.layerDelete);
            if (!layer || layer.type === 'sourceImage') return;
            editor.state.selectedLayerIds = [layer.id];
            editor.deleteSelectedLayer();
        });
    });
}

function renderHistoryPanel(target) {
    if (!target) return;
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

function setWorkStatus(message) {
    const el = document.getElementById('image-editor-autosave');
    if (el) el.textContent = message;
}

function hasUnsavedWork() {
    return !!editor?.sourceImage && workDirty;
}

async function confirmUnsavedWorkBeforeLeave() {
    if (!hasUnsavedWork()) return true;
    if (confirm('저장하지 않은 작업물이 있습니다. 작업물을 저장한 뒤 이동할까요?')) {
        await saveWorkDocument();
        return true;
    }
    return confirm('작업물을 저장하지 않고 이동할까요?');
}

async function confirmUnsavedWorkBeforeReplace() {
    if (!hasUnsavedWork()) return true;
    if (confirm('현재 작업물을 먼저 저장할까요?')) {
        await saveWorkDocument();
        return true;
    }
    return confirm('현재 작업물을 저장하지 않고 다른 작업을 불러올까요?');
}

function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function getProjectForImageKey(sourceKey = '') {
    const projects = Array.isArray(window.PROJECTS) ? window.PROJECTS : [];
    return projects
        .filter(project => project?.prefix && sourceKey.startsWith(project.prefix))
        .sort((a, b) => b.prefix.length - a.prefix.length)[0] || null;
}
