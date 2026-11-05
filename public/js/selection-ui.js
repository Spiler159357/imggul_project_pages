// Shared visual structure; callers supply navigation and selection actions.
const html = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

export function renderSelectionCard({ title, subtitle = '', image = '', placeholder = '이미지 없음', selected = false, badge = '', attributes = '' }) {
    return `<button type="button" class="selection-card" aria-pressed="${selected}" data-selection-card data-search="${html(`${title} ${subtitle}`.toLocaleLowerCase())}" ${attributes}>
        <span class="selection-card-media">${image ? `<img src="${html(image)}" alt="" loading="lazy" draggable="false" data-selection-image>` : ''}<span class="selection-card-placeholder" ${image ? 'hidden' : ''}>${html(placeholder)}</span>${selected ? '<span class="selection-card-check" aria-label="선택됨">✓</span>' : ''}</span>
        <span class="selection-card-copy"><strong>${html(title)}</strong><small>${html(subtitle)}</small>${badge ? `<span class="selection-card-badge">${html(badge)}</span>` : ''}</span></button>`;
}

export function createSelectionCard(options) {
    const template = document.createElement('template');
    template.innerHTML = renderSelectionCard(options);
    return template.content.firstElementChild;
}

export function getSelectionFolderImage(prefix) {
    const project = (window.PROJECTS || []).find(project => prefix.startsWith(project.prefix) && prefix !== project.prefix && !prefix.slice(project.prefix.length).replace(/\/$/, '').includes('/'));
    if (!project) return '';
    const character = (project.characters || []).find(character => character.prefix === prefix);
    const key = character?.coverImage || `${prefix}0.webp`;
    return window.getAssetUrl ? window.getAssetUrl(key) : '/' + key.split('/').map(encodeURIComponent).join('/');
}

export function getSelectionFileAlias(key) {
    const project = (window.PROJECTS || []).find(project => key.startsWith(project.prefix));
    const basename = key.split('/').pop().replace(/\.[^.]+$/, '');
    const situation = (project?.situations || []).find((situation, index) => String(situation.storageName || situation.folderName || (situation.imageNumber ?? index)) === basename);
    return situation ? (window.getSituationDisplayName?.(situation) || situation.alias || situation.name || '') : (window.getAliasOnly?.(key, false) || '');
}

export function renderSelectionSearch({ target, value = '', attributes = '' }) {
    return `<label class="selection-search"><span>검색</span><input type="search" data-selection-search="${html(target)}" value="${html(value)}" placeholder="이름 · 별칭 · 번호 검색" aria-label="선택 항목 검색" ${attributes}></label>`;
}

export function prepareSelectionLibrary(modal, gridId) {
    const panel = modal?.querySelector('.selection-dialog');
    if (!panel) return;
    let toolbar = panel.querySelector('[data-selection-library-toolbar]');
    if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.className = 'selection-toolbar';
        toolbar.dataset.selectionLibraryToolbar = '';
        toolbar.innerHTML = renderSelectionSearch({ target: gridId });
        panel.querySelector('.selection-content')?.before(toolbar);
    }
    toolbar.querySelector('input').value = '';
    const grid = document.getElementById(gridId);
    if (grid && !grid.parentElement.querySelector('[data-selection-empty]')) {
        const empty = document.createElement('p');
        empty.className = 'selection-status';
        empty.dataset.selectionEmpty = '';
        empty.hidden = true;
        empty.textContent = '검색 결과가 없습니다.';
        grid.after(empty);
    }
    filterSelectionGrid(gridId);
}

export function renderSelectionDialog({ id = '', title, description = '항목을 클릭하면 바로 선택됩니다.', context = '', toolbar = '', body, closeAttributes, backdropAttributes = '', panelAttributes = '' }) {
    return `<div ${id ? `id="${html(id)}"` : ''} class="pw-backdrop selection-backdrop" ${backdropAttributes}><section class="pw-dialog selection-dialog" role="dialog" aria-modal="true" aria-label="${html(title)}" ${panelAttributes}>
        <header class="pw-dialog-header selection-header"><div><h3>${html(title)}</h3><p>${html(description)}</p></div><button type="button" class="pw-button selection-close" aria-label="닫기" ${closeAttributes}>닫기</button></header>
        <div class="selection-toolbar">${context ? `<nav class="selection-context" aria-label="현재 위치">${context}</nav>` : ''}${toolbar}</div>
        <div class="selection-content">${body}</div></section></div>`;
}

export function filterSelectionGrid(id, value = '') {
    const grid = document.getElementById(id);
    if (!grid) return;
    const query = String(value).trim().toLocaleLowerCase();
    let visible = 0;
    grid.querySelectorAll('[data-selection-card]').forEach(card => {
        card.hidden = !card.dataset.search.includes(query);
        if (!card.hidden) visible++;
    });
    const empty = grid.parentElement?.querySelector('[data-selection-empty]');
    if (empty) empty.hidden = visible > 0 || !query;
}

document.addEventListener('input', event => {
    const target = event.target.dataset?.selectionSearch;
    if (target) filterSelectionGrid(target, event.target.value);
});
document.addEventListener('error', event => {
    if (!event.target.matches?.('[data-selection-image]')) return;
    const placeholder = event.target.parentElement.querySelector('.selection-card-placeholder');
    event.target.remove();
    if (placeholder) placeholder.hidden = false;
}, true);
