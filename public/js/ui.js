// 3. ui.js: 공통 UI 조작 및 유틸리티

// [버그 해결] 데스크탑 및 모바일에서 햄버거 토글이 완전히 동작하도록 오프캔버스(Overlay) 방식으로 통일했습니다.
export function toggleSidebar(forceClose = false) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar) return;

    const isClosed = sidebar.classList.contains('-translate-x-full');
    
    if (forceClose || !isClosed) {
        // 사이드바 닫기
        sidebar.classList.add('-translate-x-full');
        if (overlay) {
            overlay.classList.remove('opacity-100');
            overlay.classList.add('opacity-0');
            setTimeout(() => { 
                if (sidebar.classList.contains('-translate-x-full')) {
                    overlay.classList.add('hidden'); 
                }
            }, 300);
        }
    } else {
        // 사이드바 열기
        sidebar.classList.remove('hidden'); 
        if (overlay) {
            overlay.classList.remove('hidden');
            // 브라우저 렌더링 강제 유발(리플로우)하여 opacity 트랜지션이 작동하게 함
            void overlay.offsetWidth; 
            
            sidebar.classList.remove('-translate-x-full');
            overlay.classList.remove('opacity-0');
            overlay.classList.add('opacity-100');
        } else {
            sidebar.classList.remove('-translate-x-full');
        }
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

// [버그 해결] 무식하게 전체 클래스를 덮어써서 발생하던 UI 크기 변경(Shifting) 현상을 해결했습니다.
export function switchTab(tabName, skipHistory = false) {
    const tabs = ['explorer', 'craft', 'project'];
    
    tabs.forEach(tab => {
        const btn = document.getElementById(`nav-${tab}`);
        const content = document.getElementById(`main-${tab}-content`);
        if (!btn || !content) return;

        if (tab === tabName) {
            // 버튼 활성화 스타일 (크기나 레이아웃 변경 없음)
            btn.classList.add('shadow-sm', 'bg-white', 'dark:bg-gray-700', 'text-indigo-600', 'dark:text-indigo-400');
            btn.classList.remove('text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-200');
            
            // 메인 뷰 노출
            content.classList.remove('hidden');
            content.classList.add('flex');
        } else {
            // 버튼 비활성화 스타일
            btn.classList.remove('shadow-sm', 'bg-white', 'dark:bg-gray-700', 'text-indigo-600', 'dark:text-indigo-400');
            btn.classList.add('text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-200');
            
            // 메인 뷰 숨김
            content.classList.add('hidden');
            content.classList.remove('flex');
        }
    });

    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        if (tabName === 'craft') {
            // 이미지 생성 탭에 진입하면, 사이드바를 DOM에 띄우되 화면 밖에 숨겨둡니다 (-translate-x-full)
            sidebar.classList.remove('hidden');
            sidebar.classList.add('flex');
            sidebar.classList.add('-translate-x-full');
        } else {
            // 다른 탭 진입 시 사이드바를 완전히 제거하고 열려있다면 닫아줍니다
            sidebar.classList.add('hidden');
            sidebar.classList.remove('flex');
            window.toggleSidebar(true);
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

    // 변경된 뷰에 맞춰 아이콘 재배치
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