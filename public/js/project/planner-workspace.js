import { escapeHtml as h, getActiveProject, getCharacterById, getAssetUrl, getVersionedAssetUrl, getFileNameFromKey, getSituationDisplayName, getProjectItems, loadCharacterFiles } from './shared.js?v=planner-workspace-20261106j';

// Presentation state only. Generation, persistence and confirmation stay in planner.js.
const ui = { project: '', filter: 'all', query: '', preview: '', compare: false, reference: null, zoom: 1, picker: null, library: null, operation: 0 };
const button = (text, action, attrs = '') => `<button type="button" class="pw-button" data-pw-action="${action}" ${attrs}>${text}</button>`;
const dialogs = '[data-pw-dialog]';
let restoreFocus = null;
let pendingConfirmation = null;
const drafts = new Map();
const referenceBindings = new Map();
let referenceScope = '';
let referenceContext = null;
let referenceRequest = 0;
let referencePending = false;
let referenceNotice = '';
const referenceStorageKey = scope => `imggul_planner_reference_bindings_v1:${scope}`;

function loadReferenceBindings(project) {
    const scope = project.prefix || project.id;
    if (scope === referenceScope) return;
    referenceScope = scope;
    referenceBindings.clear();
    try {
        const entries = JSON.parse(localStorage.getItem(referenceStorageKey(scope)) || '[]');
        if (!Array.isArray(entries)) return;
        for (const entry of entries) {
            if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
            const rule = entry[1];
            if (rule?.kind === 'situation' && typeof rule.situationId === 'string') referenceBindings.set(entry[0], { kind: 'situation', situationId: rule.situationId });
            else if (rule?.kind === 'file' && typeof rule.characterId === 'string' && typeof rule.key === 'string') referenceBindings.set(entry[0], { kind: 'file', characterId: rule.characterId, key: rule.key });
        }
    } catch { /* Keep the in-memory preferences when storage is unavailable. */ }
}

function saveReferenceBindings() {
    try { localStorage.setItem(referenceStorageKey(referenceScope), JSON.stringify([...referenceBindings])); }
    catch { /* Comparing images must not depend on browser storage availability. */ }
}

export function resetPlannerReviewReferenceContext() {
    referenceRequest++;
    referenceContext = null;
    referencePending = false;
    referenceNotice = '';
    ui.reference = null;
}

function ensureReferenceContext(item, meta) {
    const project = getActiveProject();
    if (!project) return;
    loadReferenceBindings(project);
    const character = getCharacterById(project, meta.characterId || meta.characterPrefix);
    const key = JSON.stringify([project.prefix || project.id, character?.id || meta.characterId, item.situationId]);
    if (referenceContext?.key === key) return;
    resetPlannerReviewReferenceContext();
    const context = { key, project, character, situationId: item.situationId };
    referenceContext = context;
    const rule = referenceBindings.get(item.situationId);
    ui.compare = !!rule;
    if (!rule) return;
    if (!character) { referenceNotice = '현재 캐릭터를 찾을 수 없습니다.'; return; }
    const situations = getProjectItems(project, 'situations');
    const referenceIndex = rule.kind === 'situation' ? situations.findIndex(s => s.id === rule.situationId) : -1;
    const situation = situations[referenceIndex];
    if (rule.kind === 'situation' && !situation) { referenceNotice = '비교 기준 상황이 삭제되었습니다. 비교 이미지를 다시 선택하세요.'; return; }
    if (rule.kind === 'file' && rule.characterId !== character.id) {
        referenceNotice = '상황에 연결되지 않은 비교 파일입니다. 이 캐릭터의 비교 이미지를 선택하세요.';
        return;
    }
    const request = ++referenceRequest;
    referencePending = true;
    const current = () => request === referenceRequest && referenceContext === context && getActiveProject()?.id === project.id;
    void loadCharacterFiles(character, { force: true }).then(files => {
        if (!current()) return;
        const file = situation ? window.getPlannerSituationImage({ ...character, files }, situation, referenceIndex) : files.find(file => file.key === rule.key);
        referencePending = false;
        if (file) {
            ui.reference = { name: `${character.name || character.folderName} / ${situation ? getSituationDisplayName(situation) + ' · ' : ''}${getFileNameFromKey(file.key)}`, url: getVersionedAssetUrl(file) };
        } else {
            referenceNotice = `${character.name || character.folderName} / ${situation ? getSituationDisplayName(situation) : getFileNameFromKey(rule.key)}: 비교 이미지가 없습니다.`;
        }
        window.renderPlannerResultOverlay();
    }).catch(error => {
        if (!current()) return;
        referencePending = false;
        referenceNotice = error.message || '비교 이미지를 불러오지 못했습니다.';
        window.renderPlannerResultOverlay();
    });
}
const draftKey = () => `${getActiveProject()?.id}|${window.PLANNER_PLAN_MODAL_CHARACTER_ID}|${window.PLANNER_PLAN_MODAL_SITUATION_ID}`;
export function capturePlannerEditorDraft() {
    const modal = document.getElementById('planner-situation-plan-modal');
    if (!modal || !window.PLANNER_PLAN_MODAL_SITUATION_ID) return;
    drafts.set(draftKey(), {
        // V4 rows are restored through their structured values: their DOM indices
        // can change after empty rows are normalized or a character is removed.
        values: [...modal.querySelectorAll('input[id],select[id],textarea[id]')].filter(el => !el.id.startsWith('planner-plan-v4-')).map(el => [el.id, el.value, el.checked]),
        variants: [...modal.querySelectorAll('[data-planner-plan-situation-variant]')].map(el => [el.value, el.checked]),
        rows: window.readPlannerPlanV4PromptRows?.() || [],
        dirtyRows: modal.querySelector('#planner-plan-v4-rows')?.dataset.dirty === 'true',
        scroll: modal.querySelector('.pw-editor-body')?.scrollTop || 0
    });
}
export function restorePlannerEditorDraft() {
    const draft = drafts.get(draftKey());
    if (!draft) return;
    window.setPlannerPlanV4PromptRows?.(draft.rows);
    draft.values.forEach(([id, value, checked]) => { const el = document.getElementById(id); if (el) { el.value = value; if (el.type === 'checkbox' || el.type === 'radio') el.checked = checked; } });
    document.querySelectorAll('[data-planner-plan-situation-variant]').forEach(el => el.checked = draft.variants.find(([value]) => value === el.value)?.[1] || false);
    const rows = document.getElementById('planner-plan-v4-rows');
    if (rows) rows.dataset.dirty = String(draft.dirtyRows);
    const body = document.querySelector('.pw-editor-body');
    if (body) body.scrollTop = draft.scroll;
    syncPlannerOptionLabels();
}
export function clearPlannerEditorDraft() { drafts.delete(draftKey()); }

const dismiss = {
    review: () => window.closePlannerResultModal(), auxiliary: closeAuxiliary,
    editor: () => window.closePlannerSituationPlanModal(), settings: () => window.closePlannerSettingsModal(),
    execution: () => window.closePlannerRunConfirmModal()
};
const dialogFocus = new WeakMap();
const returnFocus = new Map();
function topDialog() {
    return [...document.querySelectorAll(`${dialogs} [role="dialog"]`)]
        .filter(el => el.getClientRects().length)
        .sort((a, b) => (parseInt(getComputedStyle(a.closest(dialogs)).zIndex, 10) || 0) - (parseInt(getComputedStyle(b.closest(dialogs)).zIndex, 10) || 0)).at(-1);
}
export function releasePlannerWorkspaceDialog(type) {
    const target = returnFocus.get(type);
    returnFocus.delete(type);
    document.querySelectorAll(`[data-pw-dialog="${type}"]`).forEach(el => dialogFocus.delete(el));
    requestAnimationFrame(() => {
        const next = topDialog();
        if (next) next.querySelector('button:not([disabled]),input:not([type="hidden"])')?.focus({ preventScroll: true });
        else if (target?.isConnected) target.focus({ preventScroll: true });
        else document.querySelector('[data-pw-plan], .pw-panel-tabs button')?.focus({ preventScroll: true });
    });
}
export function enhancePlannerWorkspaceDialogs() {
    for (const [id, type] of [['planner-situation-plan-modal', 'editor'], ['planner-settings-modal', 'settings'], ['planner-run-confirm-modal', 'execution']]) {
        const backdrop = document.getElementById(id);
        if (!backdrop) continue;
        backdrop.dataset.pwDialog = type;
        const panel = backdrop.firstElementChild;
        if (panel) { panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', type === 'editor' ? '플랜 편집' : type === 'settings' ? '공통 설정' : '실행 확인'); }
    }
    document.querySelectorAll('[data-pw-dialog]').forEach(backdrop => {
        if (!backdrop.getClientRects().length || dialogFocus.has(backdrop)) return;
        if (!returnFocus.has(backdrop.dataset.pwDialog)) returnFocus.set(backdrop.dataset.pwDialog, document.activeElement);
        dialogFocus.set(backdrop, document.activeElement);
        backdrop.querySelector('button:not([disabled]),input:not([type="hidden"])')?.focus({ preventScroll: true });
    });
}

export function resetPlannerWorkspace(project) {
    if (ui.project === project?.id) return;
    ui.project = project?.id || '';
    ui.filter = 'all'; ui.query = ''; ui.preview = ''; ui.reference = null; ui.compare = false;
    resetPlannerReviewReferenceContext();
    ui.operation++; drafts.clear();
    closeAuxiliary();
}

export function renderPlannerWorkspaceFilters() {
    return `<div class="pw-board-tools"><input type="search" aria-label="플랜 검색" placeholder="이름으로 검색" value="${h(ui.query)}" data-pw-search>${[['all', '전체'], ['missing', '미작성'], ['review', '검토']].map(([key, label]) => button(label, 'filter', `data-filter="${key}" aria-pressed="${ui.filter === key}"`)).join('')}</div>`;
}

export function renderPlannerWorkspaceCard({ image, item, title, fallbackText, situationId, characterId, error = '' }) {
    const images = Array.isArray(item?.images) ? item.images : [];
    const selectedKey = typeof item?.selectedImage === 'string' && images.includes(item.selectedImage) ? item.selectedImage : '';
    const state = !item ? (image ? '최종 이미지 있음' : '미작성') : error ? '확인 필요' : selectedKey ? '후보 선택됨' : images.length ? '검토 대기' : '실행 대기';
    const missing = !item && !image;
    const visible = title.toLocaleLowerCase().includes(ui.query.toLocaleLowerCase()) && (ui.filter === 'all' || (ui.filter === 'missing' ? missing : !!item && images.length > 0));
    // Candidates are storage keys; finalized images are versioned file objects.
    // Unreviewed candidates must not become a representative image implicitly.
    const src = selectedKey ? getAssetUrl(selectedKey) : image?.key ? getVersionedAssetUrl(image) : '';
    return `<button type="button" class="pw-plan-card" data-pw-plan data-has-plan="${!!item}" data-title="${h(title.toLocaleLowerCase())}" data-missing="${missing}" data-review="${!!item && images.length > 0}" ${visible ? '' : 'hidden'} data-pw-action="open" data-situation="${h(situationId)}" data-character="${h(characterId)}">
        ${src ? `<img src="${h(src)}" alt="" loading="lazy" data-pw-cover>` : ''}<span class="pw-plan-placeholder" data-pw-cover-placeholder ${src ? 'hidden' : ''}>${h(fallbackText)}</span>
        <strong>${h(title)}</strong><span>${h(state)} · ${images.length}장</span>${error ? `<small>${h(error)}</small>` : ''}</button>`;
}

export function renderPlannerOption(id, label, value, options, attrs = '') {
    const selected = options.find(([v]) => String(v) === String(value));
    const dropdownIds = ['planner-plan-character-variant', 'planner-plan-res', 'planner-plan-background-variant'];
    if (dropdownIds.includes(id)) {
        return `<label class="pw-option"><span>${h(label)}</span><select id="${h(id)}" class="pw-select" ${attrs}>${options.map(([optionValue, optionLabel]) => `<option value="${h(optionValue)}" ${String(optionValue) === String(value) ? 'selected' : ''}>${h(optionLabel)}</option>`).join('')}</select></label>`;
    }
    return `<div class="pw-option"><span>${h(label)}</span><input type="hidden" id="${h(id)}" value="${h(value)}" ${attrs}>
        <button type="button" class="pw-button" data-pw-action="options" data-input="${h(id)}" data-options="${h(JSON.stringify(options))}" aria-haspopup="dialog">${h(selected?.[1] || value)}</button></div>`;
}

export function syncPlannerOptionLabels() {
    document.querySelectorAll('[data-pw-action="options"]').forEach(button => {
        const input = document.getElementById(button.dataset.input);
        const options = JSON.parse(button.dataset.options);
        button.textContent = options.find(([v]) => String(v) === input?.value)?.[1] || input?.value || '';
    });
}

export function renderPlannerWorkspaceReview(item, meta, blocked) {
    ensureReferenceContext(item, meta);
    const images = item.images || [];
    if (!images.includes(ui.preview)) ui.preview = item.selectedImage || images[0] || '';
    const index = images.indexOf(ui.preview);
    const image = ui.preview ? getAssetUrl(ui.preview) : '';
    const reference = ui.reference;
    return `<div id="planner-result-modal" class="pw-backdrop" data-pw-dialog="review" data-pw-plan-context="${h(meta.characterId)}|${h(item.situationId)}"><section class="pw-dialog pw-review" role="dialog" aria-modal="true" aria-label="후보 검수">
        <header class="pw-dialog-header"><div><h3>${h(item.situationName || item.situationId)}</h3><p id="planner-result-selected-label" aria-live="polite">확대 ${index + 1} / ${images.length} · 선택 ${item.selectedImage ? images.indexOf(item.selectedImage) + 1 : '없음'}</p></div>${button('닫기', 'close-review')}</header>
        <div class="pw-review-tools">${button('‹ 플랜', 'previous-plan', 'aria-label="이전 플랜"')}${button('플랜 ›', 'next-plan', 'aria-label="다음 플랜"')}${button('프롬프트 수정', 'edit', `data-situation="${h(item.situationId)}" data-character="${h(meta.characterId)}"`)}
        ${button(ui.compare ? '후보만 보기' : '나란히 비교', ui.compare ? 'solo' : 'pair')}${button(reference || referenceBindings.has(item.situationId) ? '비교 이미지 변경' : '비교 이미지 선택', 'reference')}${reference || referenceBindings.has(item.situationId) ? button('비교 해제', 'clear-reference') : ''}
        ${button('−', 'zoom-out', 'aria-label="축소"')}<span data-pw-zoom>${Math.round(ui.zoom * 100)}%</span>${button('+', 'zoom-in', 'aria-label="확대"')}</div>
        <div class="pw-review-stage"><div class="pw-images ${ui.compare ? 'pw-pair' : ''}" style="--pw-zoom:${ui.zoom}">
        ${ui.compare ? `<figure aria-busy="${referencePending}"><figcaption>${h(reference?.name || (referencePending ? '비교 이미지를 불러오는 중입니다.' : referenceNotice || '비교 이미지 미선택'))}</figcaption>${reference ? `<img src="${h(reference.url)}" alt="선택한 비교 이미지" data-pw-reference-image>` : button('비교 이미지 선택', 'reference')}</figure>` : ''}
        <figure><figcaption>후보 ${index + 1}${item.selectedImage === ui.preview ? ' · 선택됨' : ''}</figcaption>${image ? `<img src="${h(image)}" alt="확대 후보 ${index + 1}" draggable="false">` : '<p>생성된 이미지가 없습니다.</p>'}</figure></div>
        <div class="pw-thumbnails" aria-label="전체 후보 이미지">${images.map((key, i) => `<button type="button" data-pw-action="preview" data-key="${h(key)}" aria-label="후보 ${i + 1} 확대${item.selectedImage === key ? ' · 선택됨' : ''}" aria-pressed="${ui.preview === key}" class="${item.selectedImage === key ? 'pw-picked' : ''}"><img src="${h(getAssetUrl(key))}" alt="" loading="lazy" draggable="false">${item.selectedImage === key ? '<span class="pw-thumbnail-check" aria-hidden="true">✓</span>' : ''}</button>`).join('')}</div></div>
        <footer class="pw-review-footer"><div>${button('‹ 이전', 'previous', index <= 0 ? 'disabled' : '')}${button('다음 ›', 'next', index >= images.length - 1 ? 'disabled' : '')}<label>번호 <input data-pw-jump type="number" min="1" max="${images.length}" value="${index + 1}"></label>${button('이동', 'jump')}</div>
        <div>${button('다시 생성', 'regenerate', `data-situation="${h(item.situationId)}"`)}${button('이 후보 선택', 'select', !ui.preview || item.selectedImage === ui.preview ? 'disabled' : '')}<button id="planner-result-confirm-button" type="button" class="pw-button pw-primary" data-pw-action="confirm" data-situation="${h(item.situationId)}" ${!item.selectedImage || blocked ? 'disabled' : ''}>최종 선택 완료</button></div></footer>
    </section></div>`;
}

function auxiliary(title, body, canClose = true) {
    let root = document.getElementById('planner-workspace-auxiliary');
    if (!root) { root = document.createElement('div'); root.id = 'planner-workspace-auxiliary'; document.body.append(root); }
    if (!root.childElementCount) restoreFocus = document.activeElement;
    root.innerHTML = `<div class="pw-backdrop" data-pw-dialog="auxiliary"><section class="pw-dialog ${pendingConfirmation ? 'pw-confirm-dialog' : ''}" role="dialog" aria-modal="true" aria-label="${h(title)}"><header class="pw-dialog-header"><h3>${h(title)}</h3>${canClose ? button('닫기', 'close-auxiliary') : ''}</header><div class="pw-dialog-body">${body}</div></section></div>`;
    root.querySelector('button')?.focus();
    window.lucide?.createIcons();
}

function closeAuxiliary() {
    if (pendingConfirmation) { const resolve = pendingConfirmation; pendingConfirmation = null; resolve(false); }
    ui.operation++;
    document.getElementById('planner-workspace-auxiliary')?.replaceChildren();
    ui.picker = null; ui.library = null;
    const target = restoreFocus?.isConnected ? restoreFocus : topDialog()?.querySelector('button:not([disabled])');
    target?.focus({ preventScroll: true });
    restoreFocus = null;
}

export function confirmPlannerWorkspaceAction(message) {
    closeAuxiliary();
    return new Promise(resolve => {
        pendingConfirmation = resolve;
        auxiliary('작업 확인', `<p class="pw-confirm-message">${h(message)}</p><div class="pw-review-tools">${button('취소', 'close-auxiliary')}${button('계속', 'accept-action')}</div>`, false);
    });
}

function renderPlannerExplorerFolder(character) {
    const name = character.name || character.alias || character.folderName;
    return `<button type="button" class="image-editor-library-folder-card pw-explorer-folder" data-pw-action="library-folder" data-character="${h(character.id)}" data-search="${h((name + ' ' + character.folderName).toLocaleLowerCase())}"><i data-lucide="folder" aria-hidden="true"></i><span>${h(name)}</span><small>${h(character.folderName || '')}</small></button>`;
}

function renderLibrary() {
    const library = ui.library;
    if (!library || library.project.id !== getActiveProject()?.id) return;
    const character = library.characters.find(c => c.id === library.characterId);
    const root = button(h(library.project.name || library.project.folderName), 'library-root');
    const up = character ? button('상위 폴더', 'library-root') : '';
    const content = character
        ? library.files.map(file => `<button type="button" class="image-editor-library-image-card" data-pw-action="library-image" data-key="${h(file.key)}" data-search="${h(getFileNameFromKey(file.key).toLocaleLowerCase())}"><img src="${h(getVersionedAssetUrl(file))}" loading="lazy" alt=""><span>${h(getFileNameFromKey(file.key))}</span></button>`).join('')
        : library.characters.map(c => renderPlannerExplorerFolder(c)).join('');
    auxiliary('비교 이미지 선택', `<nav class="pw-explorer-breadcrumb" aria-label="현재 폴더">${root}${character ? `<span>/ ${h(character.name || character.folderName)}</span>` : ''}${up}</nav><p class="pw-explorer-path">/${h(character?.prefix || library.project.prefix)}</p>
        <div class="pw-library-tools"><input type="search" data-pw-library-search placeholder="현재 폴더에서 검색" aria-label="현재 폴더에서 검색"></div>
        ${library.loading ? '<p role="status">이미지를 불러오는 중입니다.</p>' : ''}${library.error ? `<p role="alert">${h(library.error)}</p>${button('다시 불러오기', 'library-retry')}` : ''}
        <div class="pw-explorer-grid">${content}</div>${!library.loading && !library.error && !content ? '<p>이 폴더에 표시할 항목이 없습니다.</p>' : ''}`);
}

async function loadLibraryFolder(characterId) {
    const library = ui.library;
    if (!library || library.project.id !== getActiveProject()?.id) return;
    const character = library.characters.find(c => c.id === characterId);
    if (!character) return;
    const operation = ++ui.operation;
    library.characterId = characterId; library.loading = true; library.error = ''; library.files = [];
    renderLibrary();
    try {
        const files = await loadCharacterFiles(character, { force: true });
        if (operation !== ui.operation || library !== ui.library || getActiveProject()?.id !== library.project.id) return;
        library.files = files;
    } catch (error) {
        if (operation !== ui.operation || library !== ui.library) return;
        library.error = error.message || '이미지 목록을 불러오지 못했습니다.';
    }
    if (operation !== ui.operation || library !== ui.library) return;
    library.loading = false; renderLibrary();
}

export function plannerWorkspacePreviewKey() { return ui.preview; }

function updatePreview(key) {
    ui.preview = key; ui.zoom = 1;
    const strip = document.querySelector('.pw-thumbnails');
    const scroll = strip?.scrollTop || 0;
    window.renderPlannerResultOverlay();
    const next = document.querySelector('.pw-thumbnails');
    if (next) {
        next.scrollTop = scroll;
        const active = next.querySelector('[aria-pressed="true"]');
        if (active) {
            const a = active.getBoundingClientRect(), b = next.getBoundingClientRect();
            if (a.top < b.top || a.bottom > b.bottom) next.scrollTop += a.top - b.top;
        }
    }
}

async function dispatch(button) {
    const { pwAction: action } = button.dataset;
    if (action === 'open') return window.openPlannerWorkspaceItem(button.dataset.situation, button.dataset.character);
    if (action === 'filter') {
        ui.filter = button.dataset.filter;
        document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === ui.filter)));
        filterCards(); return;
    }
    if (action === 'options') {
        ui.picker = { id: button.dataset.input, options: JSON.parse(button.dataset.options) };
        auxiliary('옵션 선택', `<div class="pw-option-grid">${ui.picker.options.map(([value, label], index) => buttonMarkup(label, index, value)).join('')}</div>`); return;
    }
    if (action === 'option') {
        const input = document.getElementById(ui.picker?.id);
        if (input) { input.value = ui.picker.options[Number(button.dataset.index)][0]; input.dispatchEvent(new Event('change', { bubbles: true })); }
        closeAuxiliary(); syncPlannerOptionLabels(); return;
    }
    if (action === 'close-auxiliary') return closeAuxiliary();
    if (action === 'accept-action') { const resolve = pendingConfirmation; pendingConfirmation = null; closeAuxiliary(); resolve?.(true); return; }
    if (action === 'close-review') return window.closePlannerResultModal();
    if (action === 'edit') { window.closePlannerResultModal(); return window.openPlannerSituationPlanModal(button.dataset.situation, button.dataset.character); }
    if (action === 'preview') return updatePreview(button.dataset.key);
    const thumbs = [...document.querySelectorAll('.pw-thumbnails [data-key]')];
    if (['previous', 'next', 'jump'].includes(action)) {
        const index = thumbs.findIndex(b => b.dataset.key === ui.preview);
        const target = action === 'jump' ? Number(document.querySelector('[data-pw-jump]')?.value) - 1 : index + (action === 'next' ? 1 : -1);
        if (Number.isInteger(target) && thumbs[target]) updatePreview(thumbs[target].dataset.key);
        return;
    }
    if (action === 'select') { await window.selectPlannerImage(ui.preview); window.renderPlannerResultOverlay(); return; }
    if (action === 'confirm') {
        const situation = button.dataset.situation;
        if (await confirmPlannerWorkspaceAction('선택한 후보를 최종 이미지로 반영하고 임시 플랜과 후보를 정리하시겠습니까?')) return window.confirmPlannerSelection(situation);
        return;
    }
    if (action === 'previous-plan' || action === 'next-plan') return window.navigatePlannerWorkspaceItem(action === 'next-plan' ? 1 : -1);
    if (action === 'review-from-editor') { window.closePlannerSituationPlanModal(); return window.openPlannerResultModal(button.dataset.situation, button.dataset.character); }
    if (action === 'regenerate') return window.startPlannerResultGeneration(button.dataset.situation);
    if (action === 'solo' || action === 'pair') { ui.compare = action === 'pair'; window.renderPlannerResultOverlay(); return; }
    if (action === 'zoom-in' || action === 'zoom-out') { ui.zoom = Math.max(1, Math.min(3, ui.zoom + (action === 'zoom-in' ? .25 : -.25))); document.querySelector('.pw-images')?.style.setProperty('--pw-zoom', ui.zoom); const label = document.querySelector('[data-pw-zoom]'); if (label) label.textContent = `${Math.round(ui.zoom * 100)}%`; return; }
    if (action === 'clear-reference') {
        if (referenceContext) referenceBindings.delete(referenceContext.situationId);
        saveReferenceBindings();
        referenceRequest++; referencePending = false; referenceNotice = '';
        ui.reference = null; ui.compare = false;
        window.renderPlannerResultOverlay(); return;
    }
    if (action === 'reference') {
        const project = getActiveProject();
        if (!project) return;
        ui.operation++;
        ui.library = { project, characters: getProjectItems(project, 'characters'), characterId: '', files: [], loading: false, error: '' };
        renderLibrary();
        return;
    }
    if (action === 'library-folder') return loadLibraryFolder(button.dataset.character);
    if (action === 'library-retry') return loadLibraryFolder(ui.library?.characterId);
    if (action === 'library-root') {
        if (!ui.library) return;
        ui.operation++;
        Object.assign(ui.library, { characterId: '', files: [], loading: false, error: '' });
        renderLibrary(); return;
    }
    if (action === 'library-image') {
        const library = ui.library;
        if (!library || library.project.id !== getActiveProject()?.id) return;
        if (!referenceContext || referenceContext.project.id !== library.project.id) return;
        const file = library.files.find(file => file.key === button.dataset.key);
        if (!file) return;
        const character = library.characters.find(c => c.id === library.characterId);
        if (!character) return;
        const situations = getProjectItems(library.project, 'situations');
        const situation = situations.find((situation, index) => window.getPlannerSituationImage({ ...character, files: [file] }, situation, index));
        referenceBindings.set(referenceContext.situationId, situation
            ? { kind: 'situation', situationId: situation.id }
            : { kind: 'file', characterId: character.id, key: file.key });
        saveReferenceBindings();
        referenceRequest++; referencePending = false; referenceNotice = '';
        ui.reference = { name: `${character?.name || character?.folderName || ''} / ${getFileNameFromKey(file.key)}`, url: getVersionedAssetUrl(file) }; ui.compare = true;
        closeAuxiliary(); window.renderPlannerResultOverlay();
    }
}

function buttonMarkup(label, index, value) { return button(h(label), 'option', `data-index="${index}" aria-pressed="${String(value) === document.getElementById(ui.picker.id)?.value}"`); }
function filterCards() {
    document.querySelectorAll('[data-pw-plan]').forEach(card => {
        card.hidden = !card.dataset.title.includes(ui.query.toLocaleLowerCase()) || (ui.filter === 'missing' && card.dataset.missing !== 'true') || (ui.filter === 'review' && card.dataset.review !== 'true');
    });
}

document.addEventListener('error', event => {
    if (event.target.matches?.('img[data-pw-reference-image]') && event.target.getAttribute('src') === ui.reference?.url) {
        ui.reference = null;
        referenceNotice = '비교 이미지를 불러오지 못했습니다. 비교 이미지를 다시 선택하세요.';
        window.renderPlannerResultOverlay();
        return;
    }
    if (!event.target.matches?.('img[data-pw-cover]')) return;
    const placeholder = event.target.parentElement?.querySelector('[data-pw-cover-placeholder]');
    event.target.remove();
    if (placeholder) placeholder.hidden = false;
}, true);
document.addEventListener('click', event => {
    const button = event.target.closest('[data-pw-action]');
    if (button && !button.disabled) dispatch(button).catch(error => {
        const message = error.message || '요청 처리에 실패했습니다.';
        window.setPlannerStatus?.(message);
        const status = document.getElementById('planner-result-selected-label');
        if (status) status.textContent = message;
    });
    if (event.target.matches('[data-pw-dialog]')) dismiss[event.target.dataset.pwDialog]?.();
}, true);
document.addEventListener('input', event => {
    if (event.target.matches('[data-pw-search]')) { ui.query = event.target.value; filterCards(); }
    if (event.target.matches('[data-pw-library-search]')) document.querySelectorAll('#planner-workspace-auxiliary .pw-explorer-grid [data-search]').forEach(card => card.hidden = !card.dataset.search.includes(event.target.value.toLocaleLowerCase()));
});
document.addEventListener('keydown', event => {
    const modal = topDialog();
    if (!modal) return;
    if (event.key === 'Escape') { event.preventDefault(); dismiss[modal.closest(dialogs)?.dataset.pwDialog]?.(); return; }
    if (event.key === 'Tab') {
        const focusable = [...modal.querySelectorAll('button,input,select,textarea,a[href]')].filter(el => !el.disabled && el.getClientRects().length);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (modal.closest('[data-pw-dialog="review"]') && !event.target.matches('input,textarea') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault(); modal.querySelector(`[data-pw-action="${event.key === 'ArrowRight' ? 'next' : 'previous'}"]`)?.click();
    }
});
let touch = null;
document.addEventListener('touchstart', event => { if (event.target.closest('.pw-images')) touch = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }, { passive: true });
document.addEventListener('touchend', event => {
    if (!touch || !event.target.closest('.pw-images')) return;
    const dx = event.changedTouches[0].clientX - touch.x, dy = event.changedTouches[0].clientY - touch.y; touch = null;
    if (Math.abs(dx) > 55 && Math.abs(dy) < 45) document.querySelector(`[data-pw-action="${dx < 0 ? 'next' : 'previous'}"]`)?.click();
}, { passive: true });
