// 3. ui.js: 공통 UI 조작 및 유틸리티

function setPromptSidebarOpen(isOpen) {
    const sidebar = document.getElementById('sidebar');
    const hamburgerBtn = document.getElementById('hamburger-btn');
    if (!sidebar) return;

    sidebar.dataset.open = isOpen ? 'true' : 'false';
    sidebar.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    sidebar.style.width = isOpen ? '' : '0px';
    sidebar.style.opacity = isOpen ? '1' : '0';
    sidebar.style.pointerEvents = isOpen ? 'auto' : 'none';

    if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function ensurePromptSidebarLayout() {
    const sidebar = document.getElementById('sidebar');
    const workspace = document.getElementById('craft-workspace');
    const previewPanel = document.getElementById('craft-preview-panel');
    if (!sidebar || !workspace || !previewPanel) return;

    if (sidebar.parentElement !== workspace) {
        workspace.insertBefore(sidebar, previewPanel);
    }
}

export function toggleSidebar(forceClose = false) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    const isOpen = sidebar.dataset.open === 'true';
    setPromptSidebarOpen(!forceClose && !isOpen);
}

export function handleHamburgerClick(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    window.toggleSidebar(false);
}

export function initSidebarControls() {
    const hamburgerBtn = document.getElementById('hamburger-btn');
    if (!hamburgerBtn || hamburgerBtn.dataset.sidebarBound === 'true') return;

    hamburgerBtn.dataset.sidebarBound = 'true';
    hamburgerBtn.setAttribute('aria-controls', 'sidebar');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
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

const NAV_BUTTON_ACTIVE_CLASSES = ['shadow-sm', 'bg-white', 'dark:bg-gray-700', 'text-indigo-600', 'dark:text-indigo-400'];
const NAV_BUTTON_INACTIVE_CLASSES = ['text-gray-500', 'hover:text-gray-700', 'dark:text-gray-400', 'dark:hover:text-gray-200'];

export function switchTab(tabName, skipHistory = false) {
    const tabs = ['explorer', 'craft', 'project'];
    
    // [버그 해결] 크기와 레이아웃을 고정해둔 HTML 클래스를 파괴하지 않고 색상(텍스트, 배경, 그림자) 클래스만 섬세하게 토글합니다.
    tabs.forEach(tab => {
        const btn = document.getElementById(`nav-${tab}`);
        const content = document.getElementById(`main-${tab}-content`);
        if (!btn || !content) return;

        if (tab === tabName) {
            // 버튼 활성화 (배경, 그림자, 텍스트 색상 추가)
            btn.classList.remove(...NAV_BUTTON_INACTIVE_CLASSES);
            btn.classList.add(...NAV_BUTTON_ACTIVE_CLASSES);
            // 비활성화 색상 제거
            
            // 메인 콘텐츠 뷰 노출
            content.classList.remove('hidden');
            content.classList.add('flex');
        } else {
            // 버튼 비활성화 (기본 회색 텍스트 추가)
            btn.classList.remove(...NAV_BUTTON_ACTIVE_CLASSES);
            btn.classList.add(...NAV_BUTTON_INACTIVE_CLASSES);
            // 활성화 색상 제거
            
            // 메인 콘텐츠 뷰 숨김
            content.classList.add('hidden');
            content.classList.remove('flex');
        }
    });

    // 햄버거 버튼과 프롬프트 패널 제어 (craft 탭에서만 보임)
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const promptSidebar = document.getElementById('sidebar');
    if (hamburgerBtn) {
        if (tabName === 'craft') {
            hamburgerBtn.classList.remove('hidden');
        } else {
            hamburgerBtn.classList.add('hidden');
        }
    }

    if (promptSidebar) {
        if (tabName === 'craft') {
            ensurePromptSidebarLayout();
            promptSidebar.classList.remove('hidden');
            setPromptSidebarOpen(true);
        } else {
            setPromptSidebarOpen(false);
            promptSidebar.classList.add('hidden');
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

    if (window.lucide) window.lucide.createIcons();
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
