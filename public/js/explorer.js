// 4. explorer.js: 탐색기 화면 전용 로직
import { compareNumberedFileNames } from './file-name-sort.js';

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

function updateLogToolsVisibility(prefix) {
    const clearLogsButton = document.getElementById('clear-logs-btn');
    if (!clearLogsButton) return;
    const normalizedPrefix = String(prefix || '');
    const isLogsPath = normalizedPrefix === 'logs/' || normalizedPrefix.startsWith('logs/');
    clearLogsButton.classList.toggle('hidden', !isLogsPath);
}

/**
 * 역할: 지정한 폴더 prefix의 목록과 이름을 불러와 갤러리/사이드바를 렌더링한다.
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
    updateLogToolsVisibility(prefix);
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
        const visibleFiles = (data.files || [])
            .filter(isExplorerVisibleFile)
            .sort((left, right) => compareNumberedFileNames(left.key, right.key));
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
            ? `<div class="flex flex-col items-center w-full overflow-hidden mt-1"><span class="text-xs sm:text-sm font-bold text-gray-800 dark:text-gray-200 truncate w-full text-center group-hover:text-indigo-700 dark:group-hover:text-indigo-400" title="이름">${alias}</span><span class="text-[9px] sm:text-[10px] text-gray-500 dark:text-gray-400 truncate w-full text-center" title="경로">(${folderName})</span></div>`
            : `<span class="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 truncate w-full text-center group-hover:text-indigo-700 dark:group-hover:text-indigo-400 mt-1">${folderName}</span>`;

        div.innerHTML = `<div class="relative w-20 h-20 sm:w-28 sm:h-28 mb-2"><div class="absolute inset-0 bg-yellow-100 dark:bg-yellow-900/30 rounded-xl flex items-center justify-center group-hover:bg-yellow-200 dark:group-hover:bg-yellow-900/50 transition"><i data-lucide="folder" class="w-10 h-10 sm:w-12 sm:h-12 text-yellow-500 fill-current"></i></div><img src="/i/${folderPrefix}0.webp" class="absolute inset-0 w-20 h-20 sm:w-28 sm:h-28 object-cover rounded-xl border border-gray-200 dark:border-gray-600 shadow-sm z-10 bg-white dark:bg-gray-800 transition-opacity" onerror="this.style.display='none'" loading="lazy"></div>${nameHtml}${deleteBtnHtml}`;
        grid.appendChild(div);
    });

    files.filter(isExplorerVisibleFile).forEach(file => {
        const fileName = file.key.split('/').pop();
        if(fileName === '.keep' || fileName === '_meta.json') return;

        const alias = window.getAliasOnly(file.key, false);
        const isText = /\.(txt|log)$/i.test(fileName);
        const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(fileName);
        const timestamp = file.uploaded ? new Date(file.uploaded).getTime() : Date.now();
        const assetPath = /\.(png|jpe?g|webp)$/i.test(fileName) ? '/i/' : '/';
        const fileUrl = window.location.origin + assetPath + file.key + '?t=' + timestamp;

        const div = document.createElement('div');
        div.className = 'flex flex-col items-center p-2 sm:p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition group border border-gray-100 dark:border-gray-700 hover:border-indigo-200 dark:hover:border-indigo-500 relative w-full overflow-hidden';
        div.dataset.key = file.key; div.dataset.public = file.isPublic; 
        div.onclick = () => window.openModal(file.key, fileUrl, isImage, isText, file.isPublic);
        
        let iconHtml = isImage ? `<img src="${assetPath}${file.key}?t=${timestamp}" class="w-full h-24 sm:h-32 object-cover rounded mb-2 border border-gray-200 dark:border-gray-600 shadow-sm" loading="lazy">` : (isText ? `<div class="w-full h-24 sm:h-32 bg-gray-100 dark:bg-gray-800 rounded mb-2 flex items-center justify-center border border-gray-200 dark:border-gray-600 shadow-sm"><i data-lucide="file-text" class="w-8 h-8 sm:w-10 sm:h-10 text-gray-500 dark:text-gray-400"></i></div>` : `<div class="w-full h-24 sm:h-32 bg-gray-100 dark:bg-gray-800 rounded mb-2 flex items-center justify-center border border-gray-200 dark:border-gray-600 shadow-sm"><i data-lucide="file" class="w-8 h-8 sm:w-10 sm:h-10 text-gray-400 dark:text-gray-500"></i></div>`);
        let statusIcon = (isText || /\.(png|jpe?g|webp)$/i.test(fileName)) ? (file.isPublic ? `<div class="absolute top-1 right-1 sm:top-2 sm:right-2 z-10 bg-white/90 dark:bg-gray-800/90 rounded-full p-1 shadow-sm border border-green-200 dark:border-green-900" title="공개됨"><i data-lucide="eye" class="w-3 h-3 sm:w-3.5 sm:h-3.5 text-green-600 dark:text-green-400"></i></div>` : `<div class="absolute top-1 right-1 sm:top-2 sm:right-2 z-10 bg-white/90 dark:bg-gray-800/90 rounded-full p-1 shadow-sm border border-red-200 dark:border-red-900" title="비공개"><i data-lucide="lock" class="w-3 h-3 sm:w-3.5 sm:h-3.5 text-red-600 dark:text-red-400"></i></div>`) : '';
        const nameHtml = alias ? `<div class="flex flex-col items-center w-full overflow-hidden mt-1"><span class="text-xs sm:text-sm font-bold text-gray-800 dark:text-gray-200 truncate w-full text-center group-hover:text-black dark:group-hover:text-white" title="이름">${alias}</span><span class="text-[9px] sm:text-[10px] text-gray-500 dark:text-gray-400 truncate w-full text-center" title="파일 경로">(${fileName})</span></div>` : `<span class="text-[10px] sm:text-xs text-gray-600 dark:text-gray-400 truncate w-full text-center group-hover:text-black dark:group-hover:text-white mt-1">${fileName}</span>`;

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
        const isText = /\.(txt|log)$/i.test(fileName);
        const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(fileName);
        const assetPath = /\.(png|jpe?g|webp)$/i.test(fileName) ? '/i/' : '/';
        const fileUrl = window.location.origin + assetPath + file.key + '?t=' + (file.uploaded ? new Date(file.uploaded).getTime() : Date.now());
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
        btn.title = `경로: ${currentPath}`;
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

function clearFolderCacheByPrefix(prefix) {
    if (!window.FOLDER_DATA_CACHE) return;
    Object.keys(window.FOLDER_DATA_CACHE).forEach(cacheKey => {
        if (cacheKey === prefix || cacheKey.startsWith(prefix)) delete window.FOLDER_DATA_CACHE[cacheKey];
    });
}

async function saveAlias(key, alias) {
    const res = await fetch('/api/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, alias })
    });
    if (!res.ok) {
        let message = '이름 저장에 실패했습니다.';
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
        let message = res.status === 409 ? '대상 폴더에 같은 이름의 파일이 있습니다.' : '파일 이동에 실패했습니다.';
        try {
            const data = await res.json();
            if (data && data.error && res.status !== 409) message = data.error;
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

export async function clearLogs() {
    if (!confirm('logs/ 폴더의 모든 로그 파일을 삭제할까요?\n이 작업은 되돌릴 수 없습니다.')) return;
    try {
        const res = await fetch('/api/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'clear_logs' })
        });
        if (!res.ok) {
            let message = '로그 삭제에 실패했습니다.';
            try {
                const data = await res.json();
                if (data && data.error) message = data.error;
            } catch(e) {}
            throw new Error(message);
        }

        clearFolderCacheByPrefix('logs/');
        clearFolderCache(window.currentPrefix);
        if (window.currentPrefix === 'logs/' || String(window.currentPrefix || '').startsWith('logs/')) {
            await window.loadPath(window.currentPrefix, true);
        }
        alert('로그가 삭제되었습니다.');
    } catch (err) {
        alert(err.message || '로그 삭제에 실패했습니다.');
    }
}

export async function setCurrentFolderAlias() {
    if (!window.currentPrefix && window.currentPrefix !== '') return;

    const currentAlias = window.getAliasOnly(window.currentPrefix, true) || '';
    const folderName = window.currentPrefix
        ? window.currentPrefix.split('/').filter(Boolean).pop()
        : 'Root';
    const nextAlias = prompt(`'${folderName}' 폴더의 이름을 입력하세요.\n비워두면 이름이 삭제됩니다.`, currentAlias);
    if (nextAlias === null) return;

    try {
        await saveAlias(window.currentPrefix, nextAlias.trim());
        clearFolderCache(window.currentPrefix);
        await window.loadPath(window.currentPrefix, true);
        alert(nextAlias.trim() ? '이름이 저장되었습니다.' : '이름이 삭제되었습니다.');
    } catch (err) {
        alert(err.message);
    }
}

export async function setModalFileAlias() {
    if (!window.currentFileKey) return alert('선택된 파일이 없습니다.');

    const currentAlias = window.getAliasOnly(window.currentFileKey, false) || '';
    const fileName = window.currentFileKey.split('/').pop();
    const nextAlias = prompt(`'${fileName}' 파일의 이름을 입력하세요.\n비워두면 이름이 삭제됩니다.`, currentAlias);
    if (nextAlias === null) return;

    try {
        await saveAlias(window.currentFileKey, nextAlias.trim());
        clearFolderCache(window.currentPrefix);
        await window.loadPath(window.currentPrefix, true);

        const rawUrl = document.getElementById('modal-url')?.value || `/${window.currentFileKey}`;
        const isText = /\.(txt|log)$/i.test(fileName);
        const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(fileName);
        const isPublic = document.getElementById('modal-public-check')?.checked || false;
        await window.openModal(window.currentFileKey, rawUrl.split('?')[0] + '?t=' + Date.now(), isImage, isText, isPublic, true);
        alert(nextAlias.trim() ? '이름이 저장되었습니다.' : '이름이 삭제되었습니다.');
    } catch (err) {
        alert(err.message);
    }
}

const filePathChangeState = {
    open: false,
    busy: false,
    loading: false,
    loadError: false,
    requestId: 0,
    oldKey: '',
    oldPrefix: '',
    oldFileName: '',
    rootPrefix: '',
    browsePrefix: '',
    folders: [],
    files: [],
    validation: null
};

function isPrefixInsideFilePathRoot(prefix) {
    const normalized = normalizeFolderPrefix(prefix);
    const root = filePathChangeState.rootPrefix;
    return !root || normalized === root || normalized.startsWith(root);
}

function getProjectRelativePath(key) {
    const root = filePathChangeState.rootPrefix;
    const relative = root && key.startsWith(root) ? key.slice(root.length) : key;
    return '/' + relative.replace(/^\/+/, '');
}

function getFileExtension(fileName) {
    const dotIndex = String(fileName || '').lastIndexOf('.');
    return dotIndex > 0 ? fileName.slice(dotIndex).toLowerCase() : '';
}

function getFilePathProjectRoot(key) {
    const configuredRoot = normalizeFolderPrefix(window.ROOT_PATH || '');
    if (configuredRoot) return configuredRoot;
    const parts = String(key || '').split('/').filter(Boolean);
    return parts.length > 1 ? parts[0] + '/' : '';
}

function setFilePathFolderStatus(message, type = 'info') {
    const status = document.getElementById('file-path-change-folder-status');
    if (!status) return;
    status.textContent = message || '';
    status.className = message
        ? `px-4 py-2 text-xs ${type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`
        : 'hidden px-4 py-2 text-xs';
}

function createFilePathFolderButton(prefix, label, options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = options.parent
        ? 'col-span-full flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-3 text-left text-sm text-gray-700 transition hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30'
        : 'group flex min-w-0 items-center gap-3 overflow-hidden rounded-lg border border-gray-200 bg-white p-2 text-left text-sm text-gray-700 transition hover:border-indigo-300 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/30';
    if (options.parent) {
        button.innerHTML = '<i data-lucide="corner-left-up" class="h-5 w-5 flex-shrink-0 text-gray-500"></i>';
    } else {
        const thumbnail = document.createElement('div');
        thumbnail.className = 'relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-yellow-50 dark:border-gray-700 dark:bg-yellow-950/30';
        thumbnail.innerHTML = '<span class="absolute inset-0 flex items-center justify-center"><i data-lucide="folder" class="h-7 w-7 fill-current text-yellow-500"></i></span>';
        const image = document.createElement('img');
        image.src = getFilePathAssetUrl(prefix + '0.webp');
        image.alt = '';
        image.loading = 'lazy';
        image.className = 'absolute inset-0 h-full w-full object-cover';
        image.addEventListener('error', () => image.remove());
        thumbnail.appendChild(image);
        button.appendChild(thumbnail);
    }
    const text = document.createElement('span');
    text.className = 'min-w-0 truncate font-medium';
    text.textContent = label;
    button.appendChild(text);
    button.title = getProjectRelativePath(prefix);
    button.addEventListener('click', () => loadFilePathChangeFolder(prefix));
    return button;
}

function getFilePathAssetUrl(key) {
    const encodedKey = String(key || '').split('/').map(part => encodeURIComponent(part)).join('/');
    const basePath = /\.(png|jpe?g|webp)$/i.test(key) ? '/i/' : '/';
    return basePath + encodedKey;
}

function isFilePathPreviewImage(file) {
    const fileName = String(file?.key || '').split('/').pop();
    return /\.(png|jpe?g|webp|gif|svg)$/i.test(fileName);
}

function isFilePathDisplayFile(file) {
    const fileName = String(file?.key || '').split('/').pop();
    return fileName && fileName !== '.keep' && fileName !== '_meta.json';
}

function getFilePathFilePresentation(fileName) {
    const rawExtension = String(fileName || '').includes('.')
        ? String(fileName).split('.').pop().toLowerCase()
        : '';
    const extension = /^[a-z0-9]+$/i.test(rawExtension) ? rawExtension : '';
    if (/^(png|jpe?g|webp|gif|svg)$/.test(extension)) return { icon: 'image', label: extension.toUpperCase(), color: 'text-indigo-500' };
    if (extension === 'json') return { icon: 'braces', label: 'JSON', color: 'text-amber-600 dark:text-amber-400' };
    if (/^(txt|log|md|csv|tsv)$/.test(extension)) return { icon: 'file-text', label: extension.toUpperCase(), color: 'text-emerald-600 dark:text-emerald-400' };
    if (/^(zip|rar|7z|tar|gz)$/.test(extension)) return { icon: 'archive', label: extension.toUpperCase(), color: 'text-orange-600 dark:text-orange-400' };
    if (/^(mp4|webm|mov|avi)$/.test(extension)) return { icon: 'file-video', label: extension.toUpperCase(), color: 'text-purple-600 dark:text-purple-400' };
    if (/^(mp3|wav|ogg|flac)$/.test(extension)) return { icon: 'file-audio', label: extension.toUpperCase(), color: 'text-pink-600 dark:text-pink-400' };
    return { icon: 'file', label: extension ? extension.toUpperCase() : 'FILE', color: 'text-gray-500 dark:text-gray-400' };
}

function createFilePathSectionLabel(label, count) {
    const heading = document.createElement('div');
    heading.className = 'col-span-full flex items-center justify-between pt-1 text-[11px] font-bold text-gray-500 dark:text-gray-400';
    const title = document.createElement('span');
    title.textContent = label;
    const badge = document.createElement('span');
    badge.className = 'rounded-full bg-gray-200 px-2 py-0.5 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-300';
    badge.textContent = String(count);
    heading.append(title, badge);
    return heading;
}

function createFilePathEmptyMessage(message) {
    const empty = document.createElement('div');
    empty.className = 'col-span-full rounded-lg border border-dashed border-gray-300 px-4 py-5 text-center text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400';
    empty.textContent = message;
    return empty;
}

function createFilePathFileCard(file) {
    const fileName = file.key.split('/').pop();
    const alias = window.getAliasOnly(file.key, false);
    const presentation = getFilePathFilePresentation(fileName);
    const isImage = isFilePathPreviewImage(file);
    const card = document.createElement('div');
    card.className = 'relative flex min-w-0 items-center gap-3 overflow-hidden rounded-lg border border-gray-200 bg-white p-2 text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200';
    card.title = getProjectRelativePath(file.key);

    const thumbnail = document.createElement('div');
    thumbnail.className = `relative flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-gray-200 ${isImage ? 'bg-checkered' : 'bg-gray-50 dark:bg-gray-800'} dark:border-gray-700`;
    thumbnail.innerHTML = `<i data-lucide="${presentation.icon}" class="h-6 w-6 ${presentation.color}"></i><span class="text-[9px] font-bold text-gray-500 dark:text-gray-400">${presentation.label}</span>`;
    if (isImage) {
        const image = document.createElement('img');
        image.src = getFilePathAssetUrl(file.key) + (file.uploaded ? `?t=${new Date(file.uploaded).getTime()}` : '');
        image.alt = '';
        image.loading = 'lazy';
        image.className = 'absolute inset-0 h-full w-full object-cover';
        image.addEventListener('error', () => image.remove());
        thumbnail.appendChild(image);
    }

    const names = document.createElement('div');
    names.className = 'min-w-0';
    const primary = document.createElement('p');
    primary.className = 'truncate text-xs font-bold text-gray-800 dark:text-gray-100';
    primary.textContent = alias || fileName;
    names.appendChild(primary);
    if (alias) {
        const secondary = document.createElement('p');
        secondary.className = 'mt-0.5 truncate font-mono text-[10px] text-gray-500 dark:text-gray-400';
        secondary.textContent = fileName;
        names.appendChild(secondary);
    }

    card.append(thumbnail, names);
    if (file.key === filePathChangeState.oldKey) {
        const currentBadge = document.createElement('span');
        currentBadge.className = 'absolute right-1.5 top-1.5 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[9px] font-bold text-white';
        currentBadge.textContent = '현재';
        card.appendChild(currentBadge);
    }
    return card;
}

function renderFilePathChangeBreadcrumbs() {
    const container = document.getElementById('file-path-change-breadcrumbs');
    if (!container) return;
    container.innerHTML = '';

    const rootButton = document.createElement('button');
    rootButton.type = 'button';
    rootButton.className = 'inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1.5 font-bold text-gray-700 hover:bg-gray-100 hover:text-indigo-600 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-indigo-400';
    rootButton.innerHTML = '<i data-lucide="home" class="h-3.5 w-3.5"></i>';
    const rootText = document.createElement('span');
    const rootName = filePathChangeState.rootPrefix.split('/').filter(Boolean).pop();
    rootText.textContent = window.getAliasOnly(filePathChangeState.rootPrefix, true) || rootName || '프로젝트';
    rootButton.appendChild(rootText);
    rootButton.addEventListener('click', () => loadFilePathChangeFolder(filePathChangeState.rootPrefix));
    container.appendChild(rootButton);

    const relative = filePathChangeState.browsePrefix.slice(filePathChangeState.rootPrefix.length);
    const parts = relative.split('/').filter(Boolean);
    let accumulated = filePathChangeState.rootPrefix;
    parts.forEach(part => {
        const separator = document.createElement('span');
        separator.className = 'flex-shrink-0 text-gray-400';
        separator.textContent = '›';
        container.appendChild(separator);

        accumulated += part + '/';
        const targetPrefix = accumulated;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'max-w-40 flex-shrink-0 truncate rounded-md px-2 py-1.5 text-gray-600 hover:bg-gray-100 hover:text-indigo-600 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-indigo-400';
        button.textContent = window.getAliasOnly(targetPrefix, true) || part;
        button.title = part;
        button.addEventListener('click', () => loadFilePathChangeFolder(targetPrefix));
        container.appendChild(button);
    });

    requestAnimationFrame(() => { container.scrollLeft = container.scrollWidth; });
    if (window.lucide) window.lucide.createIcons();
}

function renderFilePathChangeFolders() {
    const list = document.getElementById('file-path-change-folder-list');
    if (!list) return;
    list.innerHTML = '';

    if (filePathChangeState.browsePrefix !== filePathChangeState.rootPrefix) {
        const parts = filePathChangeState.browsePrefix.split('/').filter(Boolean);
        parts.pop();
        const parentPrefix = normalizeFolderPrefix(parts.join('/'));
        list.appendChild(createFilePathFolderButton(
            isPrefixInsideFilePathRoot(parentPrefix) ? parentPrefix : filePathChangeState.rootPrefix,
            '상위 폴더',
            { parent: true }
        ));
    }

    const folders = filePathChangeState.folders;
    const files = filePathChangeState.files.filter(isFilePathDisplayFile);

    list.appendChild(createFilePathSectionLabel('하위 폴더', folders.length));
    folders.forEach(folderPrefix => {
        const folderName = folderPrefix.split('/').filter(Boolean).pop();
        const alias = window.getAliasOnly(folderPrefix, true);
        const label = alias ? `${alias} (${folderName})` : folderName;
        list.appendChild(createFilePathFolderButton(folderPrefix, label));
    });
    if (!folders.length) list.appendChild(createFilePathEmptyMessage('하위 폴더가 없습니다. 현재 폴더가 이동 대상으로 선택되어 있습니다.'));

    list.appendChild(createFilePathSectionLabel('현재 폴더 파일', files.length));
    files.forEach(file => list.appendChild(createFilePathFileCard(file)));
    if (!files.length) list.appendChild(createFilePathEmptyMessage('현재 폴더에 표시할 파일이 없습니다.'));
    if (window.lucide) window.lucide.createIcons();
}

async function loadFilePathChangeFolder(prefix) {
    const normalized = normalizeFolderPrefix(prefix);
    if (!filePathChangeState.open || !isPrefixInsideFilePathRoot(normalized)) return;

    filePathChangeState.browsePrefix = normalized;
    filePathChangeState.loading = true;
    filePathChangeState.loadError = false;
    filePathChangeState.folders = [];
    filePathChangeState.files = [];
    const requestId = ++filePathChangeState.requestId;
    renderFilePathChangeBreadcrumbs();
    setFilePathFolderStatus('폴더 목록을 불러오는 중입니다.');
    const list = document.getElementById('file-path-change-folder-list');
    if (list) list.innerHTML = '<div class="col-span-full flex min-h-48 items-center justify-center text-sm text-gray-500 dark:text-gray-400"><i data-lucide="loader" class="mr-2 h-5 w-5 animate-spin"></i>불러오는 중...</div>';
    if (window.lucide) window.lucide.createIcons();
    updateFilePathChangePreview();

    try {
        const [listRes, aliasRes] = await Promise.all([
            fetch(`/api/list?prefix=${encodeURIComponent(normalized)}`),
            fetch(`/api/aliases?prefix=${encodeURIComponent(normalized)}`)
        ]);
        if (!listRes.ok) throw new Error('폴더 목록을 불러오지 못했습니다.');
        if (requestId !== filePathChangeState.requestId || !filePathChangeState.open) return;

        if (aliasRes.ok) {
            const aliasData = await aliasRes.json();
            window.GLOBAL_ALIASES = Object.assign(window.GLOBAL_ALIASES || {}, aliasData.global || {});
            window.PROJECT_ALIASES = Object.assign(window.PROJECT_ALIASES || {}, aliasData.project || {});
        }
        const data = await listRes.json();
        filePathChangeState.folders = (data.folders || [])
            .filter(isExplorerVisibleFolder)
            .filter(isPrefixInsideFilePathRoot);
        filePathChangeState.files = (data.files || [])
            .filter(isExplorerVisibleFile)
            .sort((left, right) => compareNumberedFileNames(left.key, right.key));
        filePathChangeState.loading = false;
        filePathChangeState.loadError = false;
        const fileCount = filePathChangeState.files.filter(isFilePathDisplayFile).length;
        setFilePathFolderStatus(`하위 폴더 ${filePathChangeState.folders.length}개 · 파일 ${fileCount}개`);
        renderFilePathChangeBreadcrumbs();
        renderFilePathChangeFolders();
        updateFilePathChangePreview();
    } catch (error) {
        if (requestId !== filePathChangeState.requestId || !filePathChangeState.open) return;
        filePathChangeState.loading = false;
        filePathChangeState.loadError = true;
        filePathChangeState.files = [];
        setFilePathFolderStatus(error.message || '폴더 목록을 불러오지 못했습니다.', 'error');
        if (list) list.innerHTML = '<div class="col-span-full flex min-h-48 items-center justify-center text-center text-xs text-red-600 dark:text-red-400">목록을 다시 불러오려면 breadcrumb의 폴더를 선택하세요.</div>';
        updateFilePathChangePreview();
    }
}

function validateFilePathChange() {
    const input = document.getElementById('file-path-change-name');
    const fileName = String(input?.value || '').trim();
    let error = '';
    if (!fileName) error = '파일명을 입력하세요.';
    else if (fileName === '.' || fileName === '..') error = '사용할 수 없는 파일명입니다.';
    else if (/[\\/]/.test(fileName)) error = '파일명에는 경로 구분자를 넣을 수 없습니다.';
    else if (/[\u0000-\u001f\u007f]/.test(fileName)) error = '파일명에는 제어문자를 넣을 수 없습니다.';
    else if (getFileExtension(fileName) !== getFileExtension(filePathChangeState.oldFileName)) error = '파일 확장자는 변경할 수 없습니다.';

    const newKey = filePathChangeState.browsePrefix + fileName;
    if (!error && !isPrefixInsideFilePathRoot(filePathChangeState.browsePrefix)) error = '프로젝트 밖으로 이동할 수 없습니다.';
    if (!error && !filePathChangeState.loading && newKey !== filePathChangeState.oldKey) {
        const conflict = filePathChangeState.files.some(file => file.key === newKey);
        if (conflict) error = '대상 폴더에 같은 이름의 파일이 있습니다.';
    }

    return {
        fileName,
        newKey,
        error,
        folderChanged: filePathChangeState.browsePrefix !== filePathChangeState.oldPrefix,
        nameChanged: fileName !== filePathChangeState.oldFileName,
        changed: newKey !== filePathChangeState.oldKey
    };
}

export function updateFilePathChangePreview() {
    if (!filePathChangeState.open) return;
    const validation = validateFilePathChange();
    filePathChangeState.validation = validation;

    const error = document.getElementById('file-path-change-name-error');
    const nextPath = document.getElementById('file-path-change-next-path');
    const summary = document.getElementById('file-path-change-summary');
    const submit = document.getElementById('file-path-change-submit');
    if (error) error.textContent = validation.error;
    if (nextPath) nextPath.textContent = getProjectRelativePath(validation.newKey);
    if (summary) {
        if (!validation.changed) summary.textContent = '현재 경로와 같습니다.';
        else if (validation.folderChanged && validation.nameChanged) summary.textContent = '폴더 이동과 파일명 변경을 함께 적용합니다.';
        else if (validation.folderChanged) summary.textContent = '선택한 폴더로 파일을 이동합니다.';
        else summary.textContent = '현재 폴더에서 파일명을 변경합니다.';
    }
    if (submit) submit.disabled = Boolean(validation.error) || !validation.changed || filePathChangeState.loading || filePathChangeState.loadError || filePathChangeState.busy;
}

export function openFilePathChangeModal() {
    if (!window.currentFileKey) return alert('선택된 파일이 없습니다.');
    const modal = document.getElementById('file-path-change-modal');
    if (!modal) return;

    const { prefix, fileName } = splitFileKey(window.currentFileKey);
    filePathChangeState.open = true;
    filePathChangeState.busy = false;
    filePathChangeState.loading = false;
    filePathChangeState.loadError = false;
    filePathChangeState.oldKey = window.currentFileKey;
    filePathChangeState.oldPrefix = normalizeFolderPrefix(prefix);
    filePathChangeState.oldFileName = fileName;
    filePathChangeState.rootPrefix = getFilePathProjectRoot(window.currentFileKey);
    filePathChangeState.browsePrefix = filePathChangeState.oldPrefix;
    filePathChangeState.folders = [];
    filePathChangeState.files = [];

    if (!isPrefixInsideFilePathRoot(filePathChangeState.oldPrefix)) {
        filePathChangeState.open = false;
        return alert('현재 파일이 프로젝트 경로 밖에 있어 변경할 수 없습니다.');
    }

    const nameInput = document.getElementById('file-path-change-name');
    const alias = window.getAliasOnly(filePathChangeState.oldKey, false);
    const previewImage = document.getElementById('modal-img');
    const thumbnail = document.getElementById('file-path-change-thumbnail');
    const fileIcon = document.getElementById('file-path-change-file-icon');
    if (nameInput) nameInput.value = fileName;
    const displayName = document.getElementById('file-path-change-display-name');
    const currentName = document.getElementById('file-path-change-current-name');
    const currentPath = document.getElementById('file-path-change-current-path');
    const submitError = document.getElementById('file-path-change-submit-error');
    if (displayName) displayName.textContent = alias || fileName;
    if (currentName) currentName.textContent = fileName;
    if (currentPath) currentPath.textContent = getProjectRelativePath(filePathChangeState.oldKey);
    if (submitError) submitError.textContent = '';
    const currentFileIsImage = isFilePathPreviewImage({ key: filePathChangeState.oldKey });
    if (thumbnail) {
        thumbnail.classList.toggle('hidden', !currentFileIsImage);
        thumbnail.src = currentFileIsImage ? (previewImage?.src || getFilePathAssetUrl(filePathChangeState.oldKey)) : '';
    }
    if (fileIcon) {
        const presentation = getFilePathFilePresentation(fileName);
        fileIcon.classList.toggle('hidden', currentFileIsImage);
        fileIcon.classList.toggle('flex', !currentFileIsImage);
        fileIcon.innerHTML = currentFileIsImage ? '' : `<i data-lucide="${presentation.icon}" class="h-7 w-7 ${presentation.color}"></i><span class="text-[9px] font-bold">${presentation.label}</span>`;
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    void loadFilePathChangeFolder(filePathChangeState.oldPrefix);
    setTimeout(() => {
        nameInput?.focus({ preventScroll: true });
        nameInput?.select();
    }, 0);
    if (window.lucide) window.lucide.createIcons();
}

export function closeFilePathChangeModal(event) {
    const modal = document.getElementById('file-path-change-modal');
    if (!modal || !filePathChangeState.open || filePathChangeState.busy) return;
    if (event && event.target !== modal) return;
    filePathChangeState.open = false;
    filePathChangeState.requestId += 1;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.getElementById('modal-path-change-btn')?.focus({ preventScroll: true });
}

export function handleFilePathChangeModalKeydown(event) {
    if (!filePathChangeState.open) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeFilePathChangeModal();
        return;
    }
    if (event.key !== 'Tab') return;
    const modal = document.getElementById('file-path-change-modal');
    const focusable = Array.from(modal?.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex="0"]') || [])
        .filter(element => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

export async function applyFilePathChange() {
    if (!filePathChangeState.open || filePathChangeState.busy || filePathChangeState.loading || filePathChangeState.loadError) return;
    updateFilePathChangePreview();
    const validation = filePathChangeState.validation;
    if (!validation || validation.error || !validation.changed) return;

    const submit = document.getElementById('file-path-change-submit');
    const submitLabel = submit?.querySelector('span');
    const submitError = document.getElementById('file-path-change-submit-error');
    filePathChangeState.busy = true;
    if (submit) submit.disabled = true;
    if (submitLabel) submitLabel.textContent = '변경 중...';
    if (submitError) submitError.textContent = '';

    const oldKey = filePathChangeState.oldKey;
    const oldPrefix = filePathChangeState.oldPrefix;
    const oldFileName = filePathChangeState.oldFileName;
    const newKey = validation.newKey;
    const newPrefix = filePathChangeState.browsePrefix;

    try {
        await moveFileKey(oldKey, newKey);
        try {
            await window.moveMetadataInDB(oldPrefix, oldFileName, newPrefix, validation.fileName, { throwOnError: true });
        } catch (metadataError) {
            try {
                await moveFileKey(newKey, oldKey);
            } catch (rollbackError) {
                throw new Error(`파일은 이동되었지만 메타데이터 갱신과 자동 복구에 실패했습니다. 새 경로: ${getProjectRelativePath(newKey)}`);
            }
            throw new Error('메타데이터 갱신에 실패하여 파일 이동을 취소했습니다. 다시 시도해 주세요.');
        }

        window.currentFileKey = newKey;
        clearFolderCache(oldPrefix, newPrefix, window.currentPrefix);
        await window.loadPath(window.currentPrefix, true);
        filePathChangeState.busy = false;
        closeFilePathChangeModal();
        window.closeModal(null, true);
        alert(validation.folderChanged && validation.nameChanged
            ? '파일 이동과 파일명 변경이 완료되었습니다.'
            : validation.folderChanged ? '파일 이동이 완료되었습니다.' : '파일명 변경이 완료되었습니다.');
    } catch (error) {
        filePathChangeState.busy = false;
        if (submitError) submitError.textContent = error.message || '경로 변경에 실패했습니다.';
        updateFilePathChangePreview();
    } finally {
        if (submitLabel) submitLabel.textContent = '변경 적용';
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
