// 3. ui.js: 공통 UI 조작 및 유틸리티
export function toggleSidebar(forceClose = false) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isMobile = window.innerWidth < 768;
    
    if (!sidebar) return;
    if (isMobile) {
        const isClosed = sidebar.classList.contains('-translate-x-full');
        if (forceClose || !isClosed) {
            sidebar.classList.add('-translate-x-full');
            if (overlay) {
                overlay.classList.remove('opacity-100');
                overlay.classList.add('opacity-0');
                setTimeout(() => { if (sidebar.classList.contains('-translate-x-full')) overlay.classList.add('hidden'); }, 300);
            }
        } else {
            if (overlay) {
                overlay.classList.remove('hidden');
                setTimeout(() => {
                    sidebar.classList.remove('-translate-x-full');
                    overlay.classList.remove('opacity-0');
                    overlay.classList.add('opacity-100');
                }, 10);
            }
        }
    } else {
        let hideClass = 'md:-ml-72';
        if (sidebar.classList.contains('md:w-[380px]')) hideClass = 'md:-ml-[380px]';
        else if (sidebar.classList.contains('md:w-[360px]')) hideClass = 'md:-ml-[360px]';
        else if (sidebar.classList.contains('w-80')) hideClass = 'md:-ml-80';

        const isClosed = sidebar.classList.contains(hideClass);
        if (forceClose || !isClosed) sidebar.classList.add(hideClass);
        else sidebar.classList.remove(hideClass);
    }
}

export function getAliasOnly(path, isFolder) {
    if (window.GLOBAL_ALIASES && window.GLOBAL_ALIASES[path]) return window.GLOBAL_ALIASES[path];
    const parts = path.split('/').filter(Boolean);
    if (parts.length > 0) {
        const targetName = parts[parts.length - 1];
        if (window.PROJECT_ALIASES && window.PROJECT_ALIASES[targetName]) return window.PROJECT_ALIASES[targetName];
    }
    return null;
}

export function getDisplayName(path, isFolder) {
    const alias = window.getAliasOnly(path, isFolder);
    if (alias) return alias;
    const parts = path.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : 'Root';
}

export function initDarkMode() {
    const isDark = localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    window.updateThemeIcon();
}

export function toggleDarkMode() {
    if (document.documentElement.classList.contains('dark')) {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    } else {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    }
    window.updateThemeIcon();
}

export function updateThemeIcon() {
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
        const isDark = document.documentElement.classList.contains('dark');
        btn.innerHTML = `<i data-lucide="${isDark ? 'sun' : 'moon'}" class="w-5 h-5 text-gray-600 dark:text-gray-400"></i>`;
        lucide.createIcons();
    }
}

export function switchTab(tabName, skipHistory = false) {
    const navExplorer = document.getElementById('nav-explorer');
    const navCraft = document.getElementById('nav-craft');
    const tabExplorer = document.getElementById('main-explorer-content');
    const tabCraft = document.getElementById('main-craft-content');
    const sideExplorer = document.getElementById('sidebar-explorer-content');
    const sideCraft = document.getElementById('sidebar-craft-content');

    const activeClass = 'flex-1 py-1.5 text-xs sm:text-sm font-bold rounded-md shadow-sm bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 transition-all flex items-center justify-center';
    const inactiveClass = 'flex-1 py-1.5 text-xs sm:text-sm font-bold rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-all flex items-center justify-center';

    if (tabName === 'explorer') {
        if(navExplorer) navExplorer.className = activeClass;
        if(navCraft) navCraft.className = inactiveClass;
        if(tabExplorer) { tabExplorer.classList.remove('hidden'); tabExplorer.classList.add('flex'); }
        if(tabCraft) { tabCraft.classList.add('hidden'); tabCraft.classList.remove('flex'); }
        if(sideExplorer) { sideExplorer.classList.remove('hidden'); sideExplorer.classList.add('flex'); }
        if(sideCraft) { sideCraft.classList.add('hidden'); sideCraft.classList.remove('flex'); }

        if (document.getElementById('file-grid') && document.getElementById('file-grid').children.length === 0) {
            window.loadPath(window.ROOT_PATH, true);
        }
        if (!skipHistory) history.pushState({ tab: 'explorer', path: window.currentPrefix }, '', '#' + window.currentPrefix);
        
    } else if (tabName === 'craft') {
        if(navCraft) navCraft.className = activeClass;
        if(navExplorer) navExplorer.className = inactiveClass;
        if(tabCraft) { tabCraft.classList.remove('hidden'); tabCraft.classList.add('flex'); }
        if(tabExplorer) { tabExplorer.classList.add('hidden'); tabExplorer.classList.remove('flex'); }
        if(sideCraft) { sideCraft.classList.remove('hidden'); sideCraft.classList.add('flex'); }
        if(sideExplorer) { sideExplorer.classList.add('hidden'); sideExplorer.classList.remove('flex'); }
        
        window.updateCraftFolderList();
        window.loadTempImages();
        window.calculateAnlas();
        
        window.PROMPT_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
        });
        const rawEl = document.getElementById('prompt-raw');
        if (rawEl) { rawEl.style.height = 'auto'; rawEl.style.height = rawEl.scrollHeight + 'px'; }
        const negEl = document.getElementById('nai-negative');
        if (negEl) { negEl.style.height = 'auto'; negEl.style.height = negEl.scrollHeight + 'px'; }

        if (!skipHistory) history.pushState({ tab: 'craft' }, '', '#craft');
    }
}

export async function logErrorToStorage(errContext, error) {
    try {
        const stack = error && error.stack ? error.stack : (error && error.message ? error.message : String(error));
        const logContent = `[${new Date().toISOString()}]\nContext: ${errContext}\n\nStacktrace:\n${stack}\n`;
        const d = new Date();
        const pad = (n) => n.toString().padStart(2, '0');
        const dateString = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const fileName = `logs/error_${dateString}_${Date.now().toString().slice(-4)}.txt`;

        const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
        const buffer = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("FileReader Error")); reader.readAsArrayBuffer(blob);
        });

        await fetch('/api/upload?_t=' + Date.now(), {
            method: 'PUT',
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-File-Name': encodeURIComponent(fileName.split('/').pop()), 'X-Absolute-Path': encodeURIComponent(fileName) },
            body: buffer, cache: 'no-store'
        });
    } catch (e) { console.error("로그 파일 저장 실패:", e); }
}