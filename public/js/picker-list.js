// Shared presentation for project/character/situation lists. Callers own selection state and actions.
export function createPickerListItem({ type, label, subLabel = '', active = false, onClick, trackSelection = false }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.pickerType = type;
    if (trackSelection) button.dataset.pickerSelected = active ? 'true' : 'false';
    button.dataset.searchText = `${label} ${subLabel}`.toLowerCase();
    button.className = 'w-full flex items-center text-left gap-2 px-2.5 py-2 rounded-md border border-transparent hover:border-indigo-300 dark:hover:border-indigo-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 transition min-w-0';
    button.onclick = onClick;

    const text = document.createElement('span');
    text.className = 'min-w-0 flex-1';
    const title = document.createElement('span');
    title.className = 'block text-xs font-bold truncate';
    title.textContent = label;
    text.appendChild(title);
    if (subLabel) {
        const subtitle = document.createElement('span');
        subtitle.className = 'block text-[10px] text-gray-500 dark:text-gray-400 truncate';
        subtitle.textContent = subLabel;
        text.appendChild(subtitle);
    }
    const check = document.createElement('i');
    check.dataset.lucide = 'check';
    check.className = `w-3.5 h-3.5 text-indigo-500 ${active ? '' : 'invisible'}`;
    button.append(text, check);
    return button;
}

export function setPickerListMessage(id, message) {
    const list = document.getElementById(id);
    if (!list) return;
    const status = document.createElement('div');
    status.className = 'py-5 text-center text-xs text-gray-500 dark:text-gray-400';
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
