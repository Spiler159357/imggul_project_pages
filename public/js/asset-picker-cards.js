// Cards shared by the Import and inpaint browsers. URL policy and selection actions stay with callers.
export function createAssetParentCard(onClick, { group = false } = {}) {
    const card = document.createElement('div');
    card.className = 'relative w-full aspect-[3/4] bg-gray-200 dark:bg-gray-700 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-600 transition' + (group ? ' group' : '') + ' border border-gray-300 dark:border-gray-600 shadow-sm';
    card.onclick = onClick;
    card.innerHTML = '<i data-lucide="corner-left-up" class="w-8 h-8 text-gray-500 mb-2"></i><span class="text-xs font-bold text-gray-600 dark:text-gray-300">상위 폴더</span>';
    return card;
}

export function createAssetFolderCard({ folderName, alias, onClick }) {
    const card = document.createElement('div');
    card.className = 'relative w-full aspect-[3/4] bg-yellow-50 dark:bg-yellow-900/20 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-yellow-100 dark:hover:bg-yellow-900/40 transition border border-yellow-200 dark:border-yellow-700/50 shadow-sm p-2';
    card.onclick = onClick;
    card.innerHTML = '<i data-lucide="folder" class="w-10 h-10 text-yellow-500 fill-current mb-2"></i><div class="flex flex-col items-center w-full overflow-hidden px-1"></div>';
    appendLabel(card.lastElementChild, alias || folderName, 'text-xs font-bold text-yellow-800 dark:text-yellow-200 truncate w-full text-center');
    if (alias) appendLabel(card.lastElementChild, `(${folderName})`, 'text-[9px] text-yellow-600/70 dark:text-yellow-400/70 truncate w-full text-center');
    return card;
}

export function createAssetImageCard({ fileName, alias, fileUrl, onClick }) {
    const card = document.createElement('div');
    card.className = 'relative w-full aspect-[3/4] bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden shadow-sm border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-indigo-500 hover:ring-2 hover:ring-indigo-500/50 transition-all group';
    card.onclick = onClick;
    const image = document.createElement('img');
    image.src = fileUrl;
    image.className = 'absolute inset-0 object-cover w-full h-full transition-opacity duration-200 opacity-80 group-hover:opacity-100';
    image.loading = 'lazy';
    const caption = document.createElement('div');
    caption.className = 'absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-2 flex flex-col items-center';
    appendLabel(caption, alias || fileName, 'text-[10px] text-white truncate w-full text-center font-medium');
    if (alias) appendLabel(caption, `(${fileName})`, 'text-[8px] text-gray-300 truncate w-full text-center');
    card.append(image, caption);
    return card;
}

function appendLabel(parent, text, className) {
    const label = document.createElement('span');
    label.className = className;
    label.textContent = text;
    parent.appendChild(label);
}
