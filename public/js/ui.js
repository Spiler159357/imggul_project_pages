// 3. ui.js: 공통 UI 조작 및 유틸리티

/**
 * 역할: Craft 프롬프트 사이드바의 열림/닫힘 상태와 접근성 속성을 동기화한다.
 * 매개변수: isOpen - 사이드바를 열지 여부.
 * 주요 변수: sidebar, hamburgerBtn, workspace, sidebarWidth - UI 대상과 여백 계산값.
 * 반환값: 명시 반환 없음.
 */
function setPromptSidebarOpen(isOpen) {
    const sidebar = document.getElementById('sidebar');
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const workspace = document.getElementById('craft-workspace');
    if (!sidebar) return;

    sidebar.dataset.open = isOpen ? 'true' : 'false';
    sidebar.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    sidebar.style.width = isOpen ? '' : '0px';
    sidebar.style.opacity = isOpen ? '1' : '0';
    sidebar.style.pointerEvents = isOpen ? 'auto' : 'none';
    if (workspace) {
        const sidebarWidth = window.matchMedia && window.matchMedia('(min-width: 640px)').matches ? '380px' : '320px';
        workspace.style.paddingLeft = isOpen ? sidebarWidth : '0px';
    }

    if (hamburgerBtn) hamburgerBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

export async function logFlowToStorage(flowContext, details = {}) {
    try {
        const getKstDateParts = (date = new Date()) => {
            const kstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
            const pad = (value) => value.toString().padStart(2, '0');
            const padMs = (value) => value.toString().padStart(3, '0');
            return {
                year: kstDate.getUTCFullYear(),
                month: pad(kstDate.getUTCMonth() + 1),
                day: pad(kstDate.getUTCDate()),
                hour: pad(kstDate.getUTCHours()),
                minute: pad(kstDate.getUTCMinutes()),
                second: pad(kstDate.getUTCSeconds()),
                millisecond: padMs(kstDate.getUTCMilliseconds())
            };
        };
        const normalizeValue = (value) => {
            if (value instanceof File) {
                return { kind: 'File', name: value.name || '', type: value.type || '', size: value.size || 0, lastModified: value.lastModified || 0 };
            }
            if (value instanceof Blob) {
                return { kind: 'Blob', type: value.type || '', size: value.size || 0 };
            }
            if (value instanceof Error) {
                return { name: value.name || 'Error', message: value.message || String(value), stack: value.stack || '' };
            }
            return value;
        };
        const safeDetails = JSON.parse(JSON.stringify(details || {}, (_key, value) => normalizeValue(value)));
        const kstParts = getKstDateParts();
        const kstTimestamp = `${kstParts.year}-${kstParts.month}-${kstParts.day}T${kstParts.hour}:${kstParts.minute}:${kstParts.second}.${kstParts.millisecond}+09:00`;
        const dateString = `${kstParts.year}${kstParts.month}${kstParts.day}_${kstParts.hour}${kstParts.minute}${kstParts.second}`;
        const safeFlowName = String(flowContext || 'flow').toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'flow';
        let logContent = `[${kstTimestamp}]\nFlow: ${flowContext}\n\nDetails:\n${JSON.stringify(safeDetails, null, 2)}\n`;
        let fileName = `logs/trace_${safeFlowName}_${dateString}_${Date.now().toString().slice(-4)}.txt`;

        if (safeDetails.attemptId) {
            const safeAttemptId = String(safeDetails.attemptId).toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').slice(0, 120);
            const storageKey = `imggul_trace_attempt_${safeAttemptId}`;
            let events = [];
            try {
                events = JSON.parse(localStorage.getItem(storageKey) || '[]');
                if (!Array.isArray(events)) events = [];
            } catch {
                events = [];
            }
            events.push({ timestamp: kstTimestamp, flow: flowContext, stage: safeDetails.stage || '', details: safeDetails });
            events = events.slice(-80);
            try {
                localStorage.setItem(storageKey, JSON.stringify(events));
            } catch {}
            logContent = `[${kstTimestamp}]\nAttempt: ${safeDetails.attemptId}\nLatest Flow: ${flowContext}\nLatest Stage: ${safeDetails.stage || ''}\n\nEvents:\n${JSON.stringify(events, null, 2)}\n`;
            fileName = `logs/trace_attempt_${safeAttemptId}.txt`;
        }

        const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
        const buffer = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("FileReader Error")); reader.readAsArrayBuffer(blob);
        });

        await fetch('/api/upload?_t=' + Date.now(), {
            method: 'PUT',
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-File-Name': encodeURIComponent(fileName.split('/').pop()), 'X-Absolute-Path': encodeURIComponent(fileName) },
            body: buffer, cache: 'no-store'
        });
    } catch (e) { console.error("trace log save failed:", e); }
}

/**
 * 역할: 현재 사이드바 상태를 기준으로 열거나 강제로 닫는다.
 * 매개변수: forceClose - true면 현재 상태와 무관하게 닫는다.
 * 주요 변수: sidebar, isOpen - 현재 DOM 상태와 열림 여부.
 * 반환값: 명시 반환 없음.
 */
export function toggleSidebar(forceClose = false) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    const isOpen = sidebar.dataset.open === 'true';
    setPromptSidebarOpen(!forceClose && !isOpen);
}

/**
 * 역할: 햄버거 버튼 클릭 이벤트를 처리해 사이드바 토글만 수행되도록 한다.
 * 매개변수: event - 클릭 이벤트 객체.
 * 주요 변수: event - 기본 동작과 버블링 차단에 사용한다.
 * 반환값: 명시 반환 없음.
 */
export function handleHamburgerClick(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    window.toggleSidebar(false);
}

/**
 * 역할: 사이드바 토글 버튼에 초기 접근성 속성과 중복 바인딩 방지 플래그를 설정한다.
 * 매개변수: 없음.
 * 주요 변수: hamburgerBtn - 초기화 대상 버튼.
 * 반환값: 명시 반환 없음.
 */
export function initSidebarControls() {
    const hamburgerBtn = document.getElementById('hamburger-btn');
    if (!hamburgerBtn || hamburgerBtn.dataset.sidebarBound === 'true') return;

    hamburgerBtn.dataset.sidebarBound = 'true';
    hamburgerBtn.setAttribute('aria-controls', 'sidebar');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
}

/**
 * 역할: 경로에 연결된 이름 문자열만 찾아 반환한다.
 * 매개변수: path - 파일/폴더 경로, isFolder - 폴더 여부.
 * 주요 변수: GLOBAL_ALIASES, PROJECT_ALIASES, parts, targetName - 이름 조회 대상.
 * 반환값: 이름 문자열 또는 null.
 */
export function getAliasOnly(path, isFolder) {
    if (window.GLOBAL_ALIASES && window.GLOBAL_ALIASES[path]) return window.GLOBAL_ALIASES[path];
    const parts = path.split('/').filter(Boolean);
    if (parts.length > 0) {
        const targetName = parts[parts.length - 1];
        if (window.PROJECT_ALIASES && window.PROJECT_ALIASES[targetName]) return window.PROJECT_ALIASES[targetName];
    }
    return null;
}

/**
 * 역할: 이름이 있으면 이름을, 없으면 경로 마지막 조각이나 Root를 표시 이름으로 만든다.
 * 매개변수: path - 파일/폴더 경로, isFolder - 폴더 여부.
 * 주요 변수: alias, parts - 표시명 결정에 쓰는 이름과 경로 조각.
 * 반환값: UI에 표시할 이름 문자열.
 */
export function getDisplayName(path, isFolder) {
    const alias = window.getAliasOnly(path, isFolder);
    if (alias) return alias;
    const parts = path.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : 'Root';
}

/**
 * 역할: 저장된 테마 또는 시스템 설정을 기준으로 초기 다크 모드 클래스를 적용한다.
 * 매개변수: 없음.
 * 주요 변수: isDark - 적용할 다크 모드 여부.
 * 반환값: 명시 반환 없음.
 */
export function initDarkMode() {
    const isDark = localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    window.updateThemeIcon();
}

/**
 * 역할: 현재 테마를 light/dark로 전환하고 localStorage에 저장한다.
 * 매개변수: 없음.
 * 주요 변수: documentElement, localStorage - 테마 클래스와 저장소.
 * 반환값: 명시 반환 없음.
 */
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

/**
 * 역할: 현재 테마에 맞춰 테마 토글 버튼의 lucide 아이콘을 갱신한다.
 * 매개변수: 없음.
 * 주요 변수: btn, isDark - 아이콘 렌더링 대상과 테마 상태.
 * 반환값: 명시 반환 없음.
 */
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

/**
 * 역할: 메인 탭 화면을 전환하고 탭별 초기 로딩, 히스토리, 사이드바 상태를 갱신한다.
 * 매개변수: tabName - explorer/craft/project 중 대상 탭, skipHistory - history push 생략 여부.
 * 주요 변수: tabs, hamburgerBtn, promptSidebar - 탭 버튼/콘텐츠와 사이드바 제어 대상.
 * 반환값: 명시 반환 없음.
 */
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
        if (window.refreshNaiPromptWeightPreviews) window.refreshNaiPromptWeightPreviews();

        if (!skipHistory) history.pushState({ tab: 'craft' }, '', '#craft');
    } else if (tabName === 'project') {
        if (!skipHistory) {
            const projectState = window.PROJECT_LAST_STATE || { tab: 'project', projectView: 'manage' };
            const projectHash = window.PROJECT_LAST_HASH || '#project';

            if (window.restoreProjectState) window.restoreProjectState(projectState);
            else if (window.renderProjectManage) window.renderProjectManage(true);

            history.pushState(projectState, '', projectHash);
        }
    }

    if (window.lucide) window.lucide.createIcons();
}

/**
 * 역할: 발생한 오류 정보를 텍스트 파일로 만들어 서버 업로드 API에 저장한다.
 * 매개변수: errContext - 오류 상황 설명, error - Error 객체 또는 문자열.
 * 주요 변수: stack, logContent, dateString, fileName, buffer - 로그 내용과 업로드 데이터.
 * 반환값: 명시 반환 없음. 저장 실패는 콘솔에만 기록한다.
 */
export async function logErrorToStorage(errContext, error) {
    try {
        const stack = error && error.stack ? error.stack : (error && error.message ? error.message : String(error));
        const getKstDateParts = (date = new Date()) => {
            const kstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
            const pad = (value) => value.toString().padStart(2, '0');
            const padMs = (value) => value.toString().padStart(3, '0');
            return {
                year: kstDate.getUTCFullYear(),
                month: pad(kstDate.getUTCMonth() + 1),
                day: pad(kstDate.getUTCDate()),
                hour: pad(kstDate.getUTCHours()),
                minute: pad(kstDate.getUTCMinutes()),
                second: pad(kstDate.getUTCSeconds()),
                millisecond: padMs(kstDate.getUTCMilliseconds())
            };
        };
        const kstParts = getKstDateParts();
        const kstTimestamp = `${kstParts.year}-${kstParts.month}-${kstParts.day}T${kstParts.hour}:${kstParts.minute}:${kstParts.second}.${kstParts.millisecond}+09:00`;
        const logContent = `[${kstTimestamp}]\nContext: ${errContext}\n\nStacktrace:\n${stack}\n`;
        const dateString = `${kstParts.year}${kstParts.month}${kstParts.day}_${kstParts.hour}${kstParts.minute}${kstParts.second}`;
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
