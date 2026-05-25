// 4. explorer.js: 탐색기 화면 전용 로직
const EXPLORER_HIDDEN_FOLDER_NAMES = new Set(['_planner_temp_image']);
const EXPLORER_HIDDEN_FILE_NAMES = new Set(['prompt.md', 'style_prompt.md']);

function isExplorerVisibleFolder(folderPrefix) {
    const folderName = String(folderPrefix || '').split('/').filter(Boolean).pop();
    return folderName && !EXPLORER_HIDDEN_FOLDER_NAMES.has(folderName);
}

function isExplorerVisibleFile(file) {
    const fileName = String(file?.key || '').split('/').pop();
    return fileName && !EXPLORER_HIDDEN_FILE_NAMES.has(fileName);
}

/**
 * 역할: 지정한 폴더 prefix의 목록과 별칭을 불러와 갤러리/사이드바를 렌더링한다.
 * 매개변수: prefix - 로드할 폴더 경로, skipHistory - 브라우저 history push 생략 여부.
 * 주요 변수: galleryContent, grid, loader, cached, listRes, aliasRes - 스크롤 저장, 캐시, API 응답.
 * 반환값: 명시 반환 없음. 캐시가 유효하면 API 호출 없이 종료한다.
 */
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
        const visibleFolders = (data.folders || []).filter(isExplorerVisibleFolder);
        const visibleFiles = (data.files || []).filter(isExplorerVisibleFile);
        window.FOLDER_DATA_CACHE[prefix] = { folders: visibleFolders, files: visibleFiles, timestamp: Date.now(), scrollY: 0 };
        window.updateBreadcrumbs(prefix);
        window.renderFiles(visibleFolders, visibleFiles);
        window.renderSidebarFoldersAndFiles(visibleFolders, visibleFiles);
    } catch (err) {
        alert('파일 목록 로드 실패: ' + err.message);
    } finally {
        loader.classList.add('hidden'); loader.classList.remove('flex');
        if (grid.children.length === 0) emptyState.classList.remove('hidden');
        else grid.classList.remove('hidden');
    }
}

/**
 * 역할: 폴더와 파일 목록을 카드 형태로 파일 그리드에 렌더링한다.
 * 매개변수: folders - 폴더 prefix 배열, files - 파일 메타데이터 배열.
 * 주요 변수: grid, folderPrefix, fileName, alias, isText, isImage, fileUrl - 렌더링 대상과 표시 정보.
 * 반환값: 명시 반환 없음.
 */
export function renderFiles(folders, files) {
    const grid = document.getElementById('file-grid');
    if(!grid) return;
    grid.innerHTML = '';

    folders.filter(isExplorerVisibleFolder).forEach(folderPrefix => {
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

    files.filter(isExplorerVisibleFile).forEach(file => {
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

/**
 * 역할: 현재 폴더의 하위 폴더/파일을 사이드바 목록으로 렌더링한다.
 * 매개변수: folders - 폴더 prefix 배열, files - 파일 메타데이터 배열.
 * 주요 변수: list, parentPrefix, folderName, alias, fileUrl, icon - 사이드바 항목 구성값.
 * 반환값: 명시 반환 없음.
 */
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

    folders.filter(isExplorerVisibleFolder).forEach(folderPrefix => {
        const folderName = folderPrefix.split('/').filter(Boolean).pop();
        const alias = window.getAliasOnly(folderPrefix, true);
        const li = document.createElement('li');
        li.innerHTML = `<button class="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 flex items-center text-gray-700 dark:text-gray-300 transition-colors"><i data-lucide="folder" class="w-4 h-4 mr-3 text-yellow-500 fill-current flex-shrink-0"></i> <div class="flex items-center overflow-hidden w-full"><span class="truncate ${alias ? 'font-bold text-gray-900 dark:text-gray-100' : ''}">${alias || folderName}</span>${alias ? `<span class="truncate text-[10px] sm:text-[11px] text-gray-400 dark:text-gray-500 ml-1.5 flex-shrink-0">(${folderName})</span>` : ''}</div></button>`;
        li.onclick = () => { window.loadPath(folderPrefix); if (window.innerWidth < 768) window.toggleSidebar(true); };
        list.appendChild(li);
    });

    files.filter(isExplorerVisibleFile).forEach(file => {
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

/**
 * 역할: 현재 prefix를 기준으로 상단 breadcrumb 버튼들을 갱신한다.
 * 매개변수: prefix - 현재 폴더 경로.
 * 주요 변수: container, relativePath, rootLabel, parts, accum - breadcrumb 경로 계산값.
 * 반환값: 명시 반환 없음.
 */
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

/**
 * 역할: 현재 폴더 캐시를 비우고 갤러리를 다시 로드한다.
 * 매개변수: 없음.
 * 주요 변수: FOLDER_DATA_CACHE, currentPrefix - 삭제할 캐시와 재로드 대상 경로.
 * 반환값: 명시 반환 없음.
 */
export function refreshGallery() { 
    if (window.FOLDER_DATA_CACHE && window.FOLDER_DATA_CACHE[window.currentPrefix]) delete window.FOLDER_DATA_CACHE[window.currentPrefix];
    window.loadPath(window.currentPrefix, true); 
}

function splitFileKey(key) {
    const parts = key.split('/');
    const fileName = parts.pop();
    return {
        prefix: parts.length > 0 ? parts.join('/') + '/' : '',
        fileName
    };
}

function normalizeFolderPrefix(value) {
    let prefix = (value || '').trim().replace(/^\/+/, '');
    if (prefix && !prefix.endsWith('/')) prefix += '/';
    return prefix;
}

function clearFolderCache(...prefixes) {
    if (!window.FOLDER_DATA_CACHE) return;
    prefixes.forEach(prefix => {
        if (prefix !== undefined && window.FOLDER_DATA_CACHE[prefix]) delete window.FOLDER_DATA_CACHE[prefix];
    });
}

function usesSameProjectAliasKey(oldKey, newKey) {
    const oldParts = oldKey.split('/').filter(Boolean);
    const newParts = newKey.split('/').filter(Boolean);
    return oldParts.length > 1
        && newParts.length > 1
        && oldParts[0] === newParts[0]
        && oldParts[oldParts.length - 1] === newParts[newParts.length - 1];
}

async function saveAlias(key, alias) {
    const res = await fetch('/api/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, alias })
    });
    if (!res.ok) {
        let message = '별칭 저장에 실패했습니다.';
        try {
            const data = await res.json();
            if (data && data.error) message = data.error;
        } catch(e) {}
        throw new Error(message);
    }
}

async function moveFileKey(oldKey, newKey) {
    const res = await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', key: oldKey, newKey })
    });
    if (!res.ok) {
        let message = '파일 이동에 실패했습니다.';
        try {
            const data = await res.json();
            if (data && data.error) message = data.error;
        } catch(e) {}
        throw new Error(message);
    }
}

/**
 * 역할: 사용자 입력으로 새 폴더용 .keep 파일을 업로드해 폴더를 생성한다.
 * 매개변수: 없음.
 * 주요 변수: folderName, fullPath, file - 생성할 폴더 이름과 업로드할 placeholder 파일.
 * 반환값: 명시 반환 없음.
 */
export function createNewFolder() {
    const folderName = prompt("생성할 폴더명을 입력하세요:");
    if (!folderName) return;
    const fullPath = (window.currentPrefix + folderName.trim() + '/.keep');
    const file = new File([""], ".keep", { type: 'application/octet-stream' });
    window.uploadFileWithKey(fullPath, file, true);
}

/**
 * 역할: 확인 후 지정 폴더와 내부 파일들을 서버 관리 API로 삭제한다.
 * 매개변수: folderPrefix - 삭제할 폴더 prefix.
 * 주요 변수: res - delete_folder API 응답.
 * 반환값: 명시 반환 없음. 성공 시 갤러리를 새로고침한다.
 */
export async function deleteFolder(folderPrefix) {
    if (!confirm(`'${folderPrefix}' 폴더와 그 안의 모든 파일을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    try {
        const res = await fetch('/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_folder', key: folderPrefix }) });
        if (!res.ok) throw new Error('폴더 삭제 실패');
        alert('폴더가 삭제되었습니다.'); window.refreshGallery();
    } catch (err) { alert(err.message); }
}

export async function setCurrentFolderAlias() {
    if (!window.currentPrefix && window.currentPrefix !== '') return;

    const currentAlias = window.getAliasOnly(window.currentPrefix, true) || '';
    const folderName = window.currentPrefix
        ? window.currentPrefix.split('/').filter(Boolean).pop()
        : 'Root';
    const nextAlias = prompt(`'${folderName}' 폴더의 별칭을 입력하세요.\n비워두면 별칭이 삭제됩니다.`, currentAlias);
    if (nextAlias === null) return;

    try {
        await saveAlias(window.currentPrefix, nextAlias.trim());
        clearFolderCache(window.currentPrefix);
        await window.loadPath(window.currentPrefix, true);
        alert(nextAlias.trim() ? '별칭이 저장되었습니다.' : '별칭이 삭제되었습니다.');
    } catch (err) {
        alert(err.message);
    }
}

export async function setModalFileAlias() {
    if (!window.currentFileKey) return alert('선택된 파일이 없습니다.');

    const currentAlias = window.getAliasOnly(window.currentFileKey, false) || '';
    const fileName = window.currentFileKey.split('/').pop();
    const nextAlias = prompt(`'${fileName}' 파일의 별칭을 입력하세요.\n비워두면 별칭이 삭제됩니다.`, currentAlias);
    if (nextAlias === null) return;

    try {
        await saveAlias(window.currentFileKey, nextAlias.trim());
        clearFolderCache(window.currentPrefix);
        await window.loadPath(window.currentPrefix, true);

        const rawUrl = document.getElementById('modal-url')?.value || `/${window.currentFileKey}`;
        const isText = fileName.toLowerCase().endsWith('.txt');
        const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(fileName);
        const isPublic = document.getElementById('modal-public-check')?.checked || false;
        await window.openModal(window.currentFileKey, rawUrl.split('?')[0] + '?t=' + Date.now(), isImage, isText, isPublic, true);
        alert(nextAlias.trim() ? '별칭이 저장되었습니다.' : '별칭이 삭제되었습니다.');
    } catch (err) {
        alert(err.message);
    }
}

export async function renameCurrentFileOnly() {
    if (!window.currentFileKey) return alert('선택된 파일이 없습니다.');

    const { prefix, fileName } = splitFileKey(window.currentFileKey);
    const nextName = prompt('새 파일명을 입력하세요.', fileName);
    if (nextName === null) return;

    const cleanName = nextName.trim().replace(/^\/+/, '');
    if (!cleanName) return alert('파일명을 입력하세요.');
    if (cleanName.includes('/')) return alert('파일명에는 경로 구분자(/)를 넣을 수 없습니다.');
    if (cleanName === fileName) return;

    const oldKey = window.currentFileKey;
    const newKey = prefix + cleanName;

    try {
        const alias = window.getAliasOnly(oldKey, false) || '';
        await moveFileKey(oldKey, newKey);
        await window.moveMetadataInDB(prefix, fileName, prefix, cleanName);
        if (alias) {
            await saveAlias(newKey, alias);
            if (!usesSameProjectAliasKey(oldKey, newKey)) await saveAlias(oldKey, '');
        }

        window.currentFileKey = newKey;
        clearFolderCache(prefix, window.currentPrefix);
        await window.loadPath(window.currentPrefix, true);
        window.closeModal(null, true);
        alert('파일명이 변경되었습니다.');
    } catch (err) {
        alert(err.message);
    }
}

export async function moveCurrentFile() {
    if (!window.currentFileKey) return alert('선택된 파일이 없습니다.');

    const { prefix: oldPrefix, fileName } = splitFileKey(window.currentFileKey);
    const destinationInput = prompt('이동할 폴더 경로를 입력하세요.', oldPrefix);
    if (destinationInput === null) return;

    const newPrefix = normalizeFolderPrefix(destinationInput);
    const oldKey = window.currentFileKey;
    const newKey = newPrefix + fileName;
    if (newKey === oldKey) return;

    try {
        const alias = window.getAliasOnly(oldKey, false) || '';
        await moveFileKey(oldKey, newKey);
        await window.moveMetadataInDB(oldPrefix, fileName, newPrefix, fileName);
        if (alias) {
            await saveAlias(newKey, alias);
            if (!usesSameProjectAliasKey(oldKey, newKey)) await saveAlias(oldKey, '');
        }

        window.currentFileKey = newKey;
        clearFolderCache(oldPrefix, newPrefix, window.currentPrefix);
        await window.loadPath(window.currentPrefix, true);
        window.closeModal(null, true);
        alert('파일이 이동되었습니다.');
    } catch (err) {
        alert(err.message);
    }
}

/**
 * 역할: 현재 미리보기 중인 파일을 삭제하고 연결 메타데이터를 제거한다.
 * 매개변수: 없음.
 * 주요 변수: currentFileKey, parts, fileName, prefix, res - 삭제 대상과 API 응답.
 * 반환값: 명시 반환 없음. 성공 시 모달을 닫고 갤러리를 새로고침한다.
 */
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
