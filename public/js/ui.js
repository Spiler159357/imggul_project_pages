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
    const navProject = document.getElementById('nav-project');

    const tabExplorer = document.getElementById('main-explorer-content');
    const tabCraft = document.getElementById('main-craft-content');
    const tabProject = document.getElementById('main-project-content');

    const sidebar = document.getElementById('sidebar');

    // [버그 수정] 가로 폭 크기에 맞춰 줄바꿈이나 자잘한 너비 Shifting이 없도록 w-24, w-28, w-36 등 완벽히 대칭되는 고정 폭과 flex-shrink-0 설정을 적용하였습니다.
    const activeClass = 'w-20 xs:w-28 sm:w-36 py-1.5 text-xs sm:text-sm font-bold rounded-lg shadow-sm bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 transition-all flex items-center justify-center whitespace-nowrap flex-shrink-0';
    const inactiveClass = 'w-20 xs:w-28 sm:w-36 py-1.5 text-xs sm:text-sm font-bold rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-all flex items-center justify-center whitespace-nowrap flex-shrink-0';

    if (navExplorer) navExplorer.className = (tabName === 'explorer') ? activeClass : inactiveClass;
    if (navCraft) navCraft.className = (tabName === 'craft') ? activeClass : inactiveClass;
    if (navProject) navProject.className = (tabName === 'project') ? activeClass : inactiveClass;

    if (tabExplorer) {
        if (tabName === 'explorer') { tabExplorer.classList.remove('hidden'); tabExplorer.classList.add('flex'); }
        else { tabExplorer.classList.add('hidden'); tabExplorer.classList.remove('flex'); }
    }
    if (tabCraft) {
        if (tabName === 'craft') { tabCraft.classList.remove('hidden'); tabCraft.classList.add('flex'); }
        else { tabCraft.classList.add('hidden'); tabCraft.classList.remove('flex'); }
    }
    if (tabProject) {
        if (tabName === 'project') { tabProject.classList.remove('hidden'); tabProject.classList.add('flex'); }
        else { tabProject.classList.add('hidden'); tabProject.classList.remove('flex'); }
    }

    // [버그 해결] 이미지 생성(craft) 탭에서만 사이드바가 노출되고, 모바일/데스크톱 햄버거 토글이 완전히 살아나도록 hidden 및 오프셋 클래스들을 똑똑하게 초기화/제어합니다.
    if (sidebar) {
        if (tabName === 'craft') {
            sidebar.classList.remove('hidden');
            sidebar.classList.add('flex');
            
            if (window.innerWidth < 768) {
                sidebar.classList.add('-translate-x-full'); // 모바일은 일단 닫힘 상태로 시작
            } else {
                sidebar.classList.remove('-translate-x-full');
                sidebar.classList.remove('md:-ml-72', 'md:-ml-[380px]', 'md:-ml-[360px]', 'md:-ml-80');
            }
        } else {
            sidebar.classList.add('hidden');
            sidebar.classList.remove('flex');
        }
    }

    if (tabName === 'explorer') {
        if (document.getElementById('file-grid') && document.getElementById('file-grid').children.length === 0) {
            window.loadPath(window.ROOT_PATH, true);
        }
        if (!skipHistory) history.pushState({ tab: 'explorer', path: window.currentPrefix }, '', '#' + window.currentPrefix);
        
    } else if (tabName === 'craft') {
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
    } else if (tabName === 'project') {
        if (!skipHistory) history.pushState({ tab: 'project' }, '', '#project');
    }

    // 아이콘들이 깨지지 않도록 Lucide를 재바인딩해 줍니다.
    if (window.lucide) {
        window.lucide.createIcons();
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