import { createSelectionCard } from './selection-ui.js?v=selection-ui-20261106b';
// Shared presentation for project/character/situation lists. Callers own selection state and actions.
export function createPickerListItem({ type, label, subLabel = '', active = false, onClick, trackSelection = false, image = '' }) {
    const button = createSelectionCard({
        title: label, subtitle: subLabel, selected: active, image,
        placeholder: type === 'character' ? '캐릭터' : type === 'situation' ? '상황' : '프로젝트'
    });
    button.classList.add('selection-row');
    button.dataset.pickerType = type;
    if (trackSelection) button.dataset.pickerSelected = active ? 'true' : 'false';
    button.dataset.searchText = `${label} ${subLabel}`.toLowerCase();
    button.onclick = onClick;
    return button;
}

export function setPickerListMessage(id, message) {
    const list = document.getElementById(id);
    if (!list) return;
    const status = document.createElement('div');
    status.className = 'selection-status';
    status.textContent = message;
    list.replaceChildren(status);
}

export function filterPickerList(listId, type, value = '') {
    const q = String(value || '').trim().toLowerCase();
    document.getElementById(listId)?.querySelectorAll('[data-picker-type]').forEach(item => {
        if (item.dataset.pickerType !== type) return;
        item.classList.toggle('hidden', !!q && !item.dataset.searchText.includes(q));
    });
}

export function getPickerSituationLabel(situation, index) {
    const storageName = String(situation?.storageName || situation?.folderName || (situation?.imageNumber ?? index));
    const name = situation?.alias || situation?.name || situation?.id || `상황 ${storageName}`;
    return `${storageName} - ${name}`;
}
