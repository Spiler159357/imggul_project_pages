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

// [레이아웃 변경 반영] 탭 전환 및 사이드바 가시성 제어 유틸리티 대폭 개편
export function switchTab(tabName, skipHistory = false) {
    const navExplorer = document.getElementById('nav-explorer');
    const navCraft = document.getElementById('nav-craft');
    const navProject = document.getElementById('nav-project'); // 신설 프로젝트 탭 활성화 바인딩

    const tabExplorer = document.getElementById('main-explorer-content');
    const tabCraft = document.getElementById('main-craft-content');
    const tabProject = document.getElementById('main-project-content'); // 신설 프로젝트 컨텐츠 바인딩

    const sidebar = document.getElementById('sidebar');
    const hamburgerBtn = document.getElementById('hamburger-btn');

    // 프리미엄 활성/비활성 탭 공통 버튼 테일윈드 토큰 지정
    const activeClass = 'px-2.5 sm:px-4 py-1.5 text-xs sm:text-sm font-bold rounded-lg shadow-sm bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 transition-all flex items-center justify-center';
    const inactiveClass = 'px-2.5 sm:px-4 py-1.5 text-xs sm:text-sm font-bold rounded-lg text-gray-505 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-all flex items-center justify-center';

    // 탭 버튼 선택 스타일 매핑
    if(navExplorer) navExplorer.className = (tabName === 'explorer') ? activeClass : inactiveClass;
    if(navCraft) navCraft.className = (tabName === 'craft') ? activeClass : inactiveClass;
    if(navProject) navProject.className = (tabName === 'project') ? activeClass : inactiveClass;

    // 메인 본문 영역 뷰 토글
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

    // [요청 반영] 이미지 생성(Craft) 탭에서만 사이드바 및 햄버거 버튼이 보이고, 다른 탭에서는 강제 완전 은닉 처리
    if (sidebar) {
        if (tabName === 'craft') {
            sidebar.classList.remove('hidden');
            sidebar.classList.add('flex');
            
            // 모바일 디바이스인 경우 사이드바 초기 오프셋 설정 적용
            if (window.innerWidth < 768) {
                sidebar.classList.add('-translate-x-full');
            } else {
                sidebar.classList.remove('-translate-x-full');
                sidebar.classList.remove('md:-ml-72', 'md:-ml-[380px]', 'md:-ml-[360px]', 'md:-ml-80');
            }
        } else {
            sidebar.classList.add('hidden');
            sidebar.classList.remove('flex');
        }
    }

    if (hamburgerBtn) {
        if (tabName === 'craft') {
            hamburgerBtn.classList.remove('hidden');
        } else {
            hamburgerBtn.classList.add('hidden');
        }
    }

    // 탭 선택에 따른 서브데이터 비동기 로딩 연동 및 상태 푸시
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