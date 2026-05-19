// 4. explorer.js: 탐색기 화면 전용 로직
export async function loadPath(prefix, skipHistory = false) {
    const galleryContent = document.getElementById('gallery-content');
    if (window.currentPrefix !== undefined && window.FOLDER_DATA_CACHE[window.currentPrefix] && galleryContent) {
        window.FOLDER_DATA_CACHE[window.currentPrefix].scrollY = galleryContent.scrollTop;
    }

    window.currentPrefix = prefix;
    const grid = document.getElementById('file-grid');
    const loader = document.getElementById('gallery-loading');
    const emptyState = document.getElementById('gallery-empty');
    if(!grid) return; 

    if (!skipHistory) history.pushState({ tab: 'explorer', path: prefix }, '', '#' + prefix);

    const cached = window.FOLDER_DATA_CACHE[prefix];
    if (cached && (Date.now() - cached.timestamp < 1000 * 60 * 5)) {
        window.updateBreadcrumbs(prefix);
        window.renderFiles(cached.folders, cached.files);
        window.renderSidebarFoldersAndFiles(cached.folders, cached.files);
        grid.classList.remove('hidden');
        loader.classList.add('hidden');
        emptyState.classList.add('hidden');
        if (grid.children.length === 0) emptyState.classList.remove('hidden');
        if (galleryContent && cached.scrollY !== undefined) requestAnimationFrame(() => { galleryContent.scrollTop = cached.scrollY; });
        return;
    }

    grid.innerHTML = ''; grid.classList.add('hidden'); emptyState.classList.add('hidden');
    loader.classList.remove('hidden'); loader.classList.add('flex');

    try {
        const [listRes, aliasRes] = await Promise.all([ fetch(`/api/list?prefix=${encodeURIComponent(prefix)}`), fetch(`/api/aliases?prefix=${encodeURIComponent(prefix)}`) ]);
        if (!listRes.ok) throw new Error('불러오기 실패');
        if (aliasRes.ok) {
            const aliasData = await aliasRes.json();
            window.GLOBAL_ALIASES = aliasData.global || {};
            window.PROJECT_ALIASES = aliasData.project || {};
        }

        const data = await listRes.json();
        window.FOLDER_DATA_CACHE[prefix] = { folders: data.folders, files: data.files, timestamp: Date.now(), scrollY: 0 };
        window.updateBreadcrumbs(prefix);
        window.renderFiles(data.folders, data.files);
        window.renderSidebarFoldersAndFiles(data.folders, data.files);
    } catch (err) {
        alert('파일 목록 로드 실패: ' + err.message);
    } finally {
        loader.classList.add('hidden'); loader.classList.remove('flex');
        if (grid.children.length === 0) emptyState.classList.remove('hidden');
        else grid.classList.remove('hidden');
    }
}

export function renderFiles(folders, files) {
    const grid = document.getElementById('file-grid');
    if(!grid) return;
    grid.innerHTML = '';

    folders.forEach(folderPrefix => {
        const parts = folderPrefix.split('/');
        const folderName = parts[parts.length - 2];
        const alias = window.getAliasOnly(folderPrefix, true);
        const div = document.createElement('div');
        div.className = 'relative group flex flex-col items-center p-3 sm:p-4 rounded-lg hover:bg-indigo-50 dark:hover:bg-gray-700 cursor-pointer transition border border-transparent hover:border-indigo-100 dark:border-gray-600';
        div.onclick = (e) => { if (!e.target.closest('.delete-btn')) window.loadPath(folderPrefix); };
        
        let deleteBtnHtml = window.IS_ADMIN ? `<button class="delete-btn absolute top-1 right-1 p-1 bg-white dark:bg-gray-800 rounded-full shadow hover:bg-red-100 dark:hover:bg-red-900 hidden group-hover:block transition" onclick="window.deleteFolder('${folderPrefix}')"><i data-lucide="trash-2" class="w-4 h-4 text-red-500"></i></button>` : '';

        const nameHtml = alias 
            ? `<div class="flex flex-col items-center w-full overflow-hidden mt-1"><span class="text-xs sm:text-sm font-bold text-gray-800 dark:text-gray-200 truncate w-full text-center group-hover:text-indigo-700 dark:group-hover:text-indigo-400" title="별칭">${alias}</span><span class="text-[9px] sm:text-[10px] text-gray-500 dark:text-gray-400 truncate w-full text-center" title="원본 경로명">(${folderName})</span></div>`
            : `<span class="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 truncate w-full text-center group-hover:text-indigo-700 dark:group-hover:text-indigo-400 mt-1">${folderName}</span>`;

        div.innerHTML = `<div class="relative w-20 h-20 sm:w-28 sm:h-28 mb-2"><div class="absolute inset-0 bg-yellow-100 dark:bg-yellow-900/30 rounded-xl flex items-center justify-center group-hover:bg-yellow-200 dark:group-hover:bg-yellow-900/50 transition"><i data-lucide="folder" class="w-10 h-10 sm:w-12 sm:h-12 text-yellow-500 fill-current"></i></div><img src="/${folderPrefix}0.webp" class="absolute inset-0 w-20 h-20 sm:w-28 sm:h-28 object-cover rounded-xl border border-gray-200 dark:border-gray-600 shadow-sm z-10 bg-white dark:bg-gray-800 transition-opacity" onerror="this.style.display='none'" loading="lazy"></div>${nameHtml}${deleteBtnHtml}`;
        grid.appendChild(div);
    });

    files.forEach(file => {
        const fileName = file.key.split('/').pop();
        if(fileName === '.keep' || fileName === '_meta.json') return;

        const alias = window.getAliasOnly(file.key, false);
        const isText = fileName.toLowerCase().endsWith('.txt');
        const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(fileName);
        const timestamp = file.uploaded ? new Date(file.uploaded).getTime() : Date.now();
        const fileUrl = window.location.origin + '/' + file.key + '?t=' + timestamp;

        const div = document.createElement('div');
        div.className = 'flex flex-col items-center p-2 sm:p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition group border border-gray-100 dark:border-gray-700 hover:border-indigo-200 dark:hover:border-indigo-500 relative w-full overflow-hidden';
        div.dataset.key = file.key; div.dataset.public = file.isPublic; 
        div.onclick = () => window.openModal(file.key, fileUrl, isImage, isText, file.isPublic);
        
        let iconHtml = isImage ? `<img src="/${file.key}?t=${timestamp}" class="w-full h-24 sm:h-32 object-cover rounded mb-2 border border-gray-200 dark:border-gray-600 shadow-sm" loading="lazy">` : (isText ? `<div class="w-full h-24 sm:h-32 bg-gray-100 dark:bg-gray-800 rounded mb-2 flex items-center justify-center border border-gray-200 dark:border-gray-600 shadow-sm"><i data-lucide="file-text" class="w-8 h-8 sm:w-10 sm:h-10 text-gray-500 dark:text-gray-400"></i></div>` : `<div class="w-full h-24 sm:h-32 bg-gray-100 dark:bg-gray-800 rounded mb-2 flex items-center justify-center border border-gray-200 dark:border-gray-600 shadow-sm"><i data-lucide="file" class="w-8 h-8 sm:w-10 sm:h-10 text-gray-400 dark:text-gray-500"></i></div>`);
        let statusIcon = isText ? (file.isPublic ? `<div class="absolute top-1 right-1 sm:top-2 sm:right-2 z-10 bg-white/90 dark:bg-gray-800/90 rounded-full p-1 shadow-sm border border-green-200 dark:border-green-900" title="공개됨"><i data-lucide="eye" class="w-3 h-3 sm:w-3.5 sm:h-3.5 text-green-600 dark:text-green-400"></i></div>` : `<div class="absolute top-1 right-1 sm:top-2 sm:right-2 z-10 bg-white/90 dark:bg-gray-800/90 rounded-full p-1 shadow-sm border border-red-200 dark:border-red-900" title="비공개"><i data-lucide="lock" class="w-3 h-3 sm:w-3.5 sm:h-3.5 text-red-600 dark:text-red-400"></i></div>`) : '';
        const nameHtml = alias ? `<div class="flex flex-col items-center w-full overflow-hidden mt-1"><span class="text-xs sm:text-sm font-bold text-gray-800 dark:text-gray-200 truncate w-full text-center group-hover:text-black dark:group-hover:text-white" title="별칭">${alias}</span><span class="text-[9px] sm:text-[10px] text-gray-500 dark:text-gray-400 truncate w-full text-center" title="원본 파일명">(${fileName})</span></div>` : `<span class="text-[10px] sm:text-xs text-gray-600 dark:text-gray-400 truncate w-full text-center group-hover:text-black dark:group-hover:text-white mt-1">${fileName}</span>`;

        div.innerHTML = `${statusIcon}${iconHtml}${nameHtml}`; grid.appendChild(div);
    });
    lucide.createIcons();
}

export function renderSidebarFoldersAndFiles(folders, files) {
    const list = document.getElementById('sidebar-folder-list');
    if (!list) return;
    list.innerHTML = '';
    
    if (window.currentPrefix !== window.ROOT_PATH) {
        const parts = window.currentPrefix.split('/').filter(Boolean); parts.pop();
        const parentPrefix = parts.length > 0 ? parts.join('/') + '/' : window.ROOT_PATH;
        const li = document.createElement('li');
        li.innerHTML = `<button class="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center text-gray-600 dark:text-gray-400 transition-colors"><i data-lucide="corner-left-up" class="w-4 h-4 mr-3 text-gray-500"></i> 상위 폴더로</button>`;
        li.onclick = () => { window.loadPath(parentPrefix); if (window.innerWidth < 768) window.toggleSidebar(true); };
        list.appendChild(li);
    }

    folders.forEach(folderPrefix => {
        const folderName = folderPrefix.split('/').filter(Boolean).pop();
        const alias = window.getAliasOnly(folderPrefix, true);
        const li = document.createElement('li');
        li.innerHTML = `<button class="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center text-gray-700 dark:text-gray-300 transition-colors"><i data-lucide="folder" class="w-4 h-4 mr-3 text-yellow-500 fill-current flex-shrink-0"></i> <div class="flex items-center overflow-hidden w-full"><span class="truncate ${alias ? 'font-bold text-gray-900 dark:text-gray-100' : ''}">${alias || folderName}</span>${alias ? `<span class="truncate text-[10px] sm:text-[11px] text-gray-400 dark:text-gray-500 ml-1.5 flex-shrink-0">(${folderName})</span>` : ''}</div></button>`;
        li.onclick = () => { window.loadPath(folderPrefix); if (window.innerWidth < 768) window.toggleSidebar(true); };
        list.appendChild(li);
    });

    files.forEach(file => {
        const fileName = file.key.split('/').pop();
        if(fileName === '.keep' || fileName === '_meta.json') return;
        const alias = window.getAliasOnly(file.key, false);
        const isText = fileName.toLowerCase().endsWith('.txt');
        const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(fileName);
        const fileUrl = window.location.origin + '/' + file.key + '?t=' + (file.uploaded ? new Date(file.uploaded).getTime() : Date.now());
        const icon = isImage ? 'image' : (isText ? 'file-text' : 'file');
        const iconColor = isImage ? 'text-indigo-500' : (isText ? 'text-green-500' : 'text-gray-500');

        const li = document.createElement('li');
        li.innerHTML = `<button class="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center text-gray-600 dark:text-gray-400 transition-colors"><i data-lucide="${icon}" class="w-4 h-4 mr-3 flex-shrink-0 ${iconColor}"></i> <div class="flex items-center overflow-hidden w-full"><span class="truncate text-xs ${alias ? 'font-bold text-gray-800 dark:text-gray-200' : ''}">${alias || fileName}</span>${alias ? `<span class="truncate text-[9px] sm:text-[10px] text-gray-400 dark:text-gray-500 ml-1.5 flex-shrink-0">(${fileName})</span>` : ''}</div></button>`;
        li.onclick = () => { window.openModal(file.key, fileUrl, isImage, isText, file.isPublic); if (window.innerWidth < 768) window.toggleSidebar(true); };
        list.appendChild(li);
    });
    lucide.createIcons();
}

export function updateBreadcrumbs(prefix) {
    const container = document.getElementById('breadcrumbs');
    if(!container) return;
    let relativePath = prefix;
    if (window.ROOT_PATH && prefix.startsWith(window.ROOT_PATH)) relativePath = prefix.slice(window.ROOT_PATH.length);
    let rootLabel = window.getDisplayName(window.ROOT_PATH, true);
    if (rootLabel === 'Root' && window.ROOT_PATH) rootLabel = window.ROOT_PATH.slice(0, -1);

    container.innerHTML = `<button onclick="window.loadPath('${window.ROOT_PATH}')" class="flex-shrink-0 flex items-center hover:text-indigo-600 dark:hover:text-indigo-400 font-bold px-2 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition dark:text-gray-200"><i data-lucide="home" class="w-4 h-4 mr-1.5"></i> <span class="truncate max-w-[120px] sm:max-w-[200px] text-sm">${rootLabel}</span></button>`;
    if (!relativePath) { lucide.createIcons(); return; }
    
    const parts = relativePath.split('/').filter(p => p);
    let accum = window.ROOT_PATH;
    parts.forEach((part, idx) => {
        accum += part + '/'; const currentPath = accum; 
        const alias = window.getAliasOnly(currentPath, true);
        const displayHtml = alias ? `<span class="font-bold">${alias}</span> <span class="text-[10px] sm:text-xs font-normal opacity-70 ml-1">(${part})</span>` : part;
        const sep = document.createElement('span'); sep.className = 'flex-shrink-0 mx-0.5 sm:mx-1 text-gray-400 dark:text-gray-500'; sep.innerText = '>'; container.appendChild(sep);
        const btn = document.createElement('button');
        btn.className = 'flex-shrink-0 hover:text-indigo-600 dark:hover:text-indigo-400 px-2 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition flex items-center max-w-[120px] sm:max-w-[150px] dark:text-gray-300';
        btn.innerHTML = `<span class="truncate block text-xs sm:text-sm font-medium">${displayHtml}</span>`;
        btn.title = `실제 경로: ${currentPath}`;
        if (idx < parts.length) btn.onclick = () => window.loadPath(currentPath);
        container.appendChild(btn);
    });
    setTimeout(() => { container.scrollLeft = container.scrollWidth; }, 50);
    lucide.createIcons();
}

export function refreshGallery() { 
    if (window.FOLDER_DATA_CACHE && window.FOLDER_DATA_CACHE[window.currentPrefix]) delete window.FOLDER_DATA_CACHE[window.currentPrefix];
    window.loadPath(window.currentPrefix, true); 
}

export function createNewFolder() {
    const folderName = prompt("생성할 폴더명을 입력하세요:");
    if (!folderName) return;
    const fullPath = (window.currentPrefix + folderName.trim() + '/.keep');
    const file = new File([""], ".keep", { type: 'application/octet-stream' });
    window.uploadFileWithKey(fullPath, file, true);
}

export async function deleteFolder(folderPrefix) {
    if (!confirm(`'${folderPrefix}' 폴더와 그 안의 모든 파일을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    try {
        const res = await fetch('/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_folder', key: folderPrefix }) });
        if (!res.ok) throw new Error('폴더 삭제 실패');
        alert('폴더가 삭제되었습니다.'); window.refreshGallery();
    } catch (err) { alert(err.message); }
}

export async function deleteCurrentFile() {
    if (!confirm('정말 삭제하시겠습니까? 복구할 수 없습니다.')) return;
    try {
        const res = await fetch('/api/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete', key: window.currentFileKey })
        });
        if (!res.ok) throw new Error('삭제 실패');
        
        const parts = window.currentFileKey.split('/');
        const fileName = parts.pop();
        const prefix = parts.length > 0 ? parts.join('/') + '/' : '';
        await window.removeMetadataFromDB(prefix, fileName);
        
        alert('삭제되었습니다.');
        document.getElementById('preview-modal').classList.add('hidden');
        window.refreshGallery();
    } catch (err) { alert(err.message); }
}