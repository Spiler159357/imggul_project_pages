const SAMPLE_PROJECT = {
    id: 'sample-project',
    name: '프로젝트 이름'
};

const PROJECT_SECTIONS = [
    {
        key: 'prompt',
        title: '프롬프트',
        icon: 'file-text',
        description: '프로젝트의 기본 프롬프트를 정리하는 공간입니다.'
    },
    {
        key: 'character',
        title: '캐릭터',
        icon: 'users',
        description: '프로젝트에 사용할 캐릭터 목록을 보는 공간입니다.'
    },
    {
        key: 'situation',
        title: '상황',
        icon: 'map',
        description: '장면과 상황 구성을 정리하는 공간입니다.'
    }
];

function getProjectRoot() {
    return document.getElementById('main-project-content');
}

function setProjectRoute(state, hash) {
    history.pushState({ tab: 'project', ...state }, '', hash);
}

function refreshProjectIcons() {
    if (window.lucide) window.lucide.createIcons();
}

function renderProjectShell(content) {
    const root = getProjectRoot();
    if (!root) return;

    root.className = 'flex flex-col absolute inset-0 w-full h-full bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100';
    root.innerHTML = content;
    refreshProjectIcons();
}

export function renderProjectManage(skipHistory = true) {
    window.PROJECT_VIEW = 'manage';
    window.PROJECT_ACTIVE_SECTION = null;

    renderProjectShell(`
        <div class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 sm:px-6 bg-white dark:bg-gray-800 flex-shrink-0">
            <div class="min-w-0">
                <h2 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white">프로젝트 목록</h2>
                <p class="text-[11px] sm:text-xs text-gray-500 dark:text-gray-400 mt-0.5">작업할 프로젝트를 선택하세요.</p>
            </div>
            <button type="button" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="프로젝트 추가" aria-label="프로젝트 추가">
                <i data-lucide="plus" class="w-5 h-5"></i>
            </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <section class="max-w-3xl mx-auto space-y-3">
                <button type="button" onclick="window.openProjectDetail('${SAMPLE_PROJECT.id}')" class="w-full text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition flex items-center gap-3">
                    <span class="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center flex-shrink-0">
                        <i data-lucide="kanban" class="w-5 h-5"></i>
                    </span>
                    <span class="min-w-0 flex-1">
                        <span class="block font-bold text-sm sm:text-base text-gray-900 dark:text-white truncate">${SAMPLE_PROJECT.name}</span>
                        <span class="block text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">프롬프트, 캐릭터, 상황을 한 곳에서 관리합니다.</span>
                    </span>
                    <i data-lucide="chevron-right" class="w-5 h-5 text-gray-400 flex-shrink-0"></i>
                </button>

                <div class="h-16 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg bg-white/60 dark:bg-gray-800/40"></div>
                <div class="flex flex-col items-center gap-2 pt-6 text-gray-300 dark:text-gray-600" aria-hidden="true">
                    <span class="w-1 h-1 rounded-full bg-current"></span>
                    <span class="w-1 h-1 rounded-full bg-current"></span>
                    <span class="w-1 h-1 rounded-full bg-current"></span>
                </div>
            </section>
        </div>
    `);

    if (!skipHistory) setProjectRoute({ projectView: 'manage' }, '#project');
}

export function openProjectDetail(projectId = SAMPLE_PROJECT.id, skipHistory = false) {
    window.PROJECT_VIEW = 'detail';
    window.PROJECT_ACTIVE_PROJECT_ID = projectId;
    window.PROJECT_ACTIVE_SECTION = null;

    renderProjectShell(`
        <div class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 sm:px-6 bg-white dark:bg-gray-800 flex-shrink-0 gap-3">
            <div class="flex items-center gap-2 min-w-0">
                <button type="button" onclick="window.renderProjectManage(false)" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="프로젝트 목록" aria-label="프로젝트 목록">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <h1 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">${SAMPLE_PROJECT.name}</h1>
            </div>
            <button type="button" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="더보기" aria-label="더보기">
                <i data-lucide="more-vertical" class="w-5 h-5"></i>
            </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <section class="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 min-h-full">
                ${PROJECT_SECTIONS.map(section => `
                    <button type="button" onclick="window.openProjectSection('${section.key}')" class="min-h-[220px] text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition flex flex-col">
                        <span class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                            <i data-lucide="${section.icon}" class="w-4 h-4 text-indigo-600 dark:text-indigo-400"></i>
                            ${section.title}
                        </span>
                        <span class="flex-1 p-4 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">
                            ${section.description}
                        </span>
                    </button>
                `).join('')}
            </section>
        </div>
    `);

    if (!skipHistory) setProjectRoute({ projectView: 'detail', projectId }, `#project/${projectId}`);
}

export function openProjectSection(sectionKey, skipHistory = false) {
    const section = PROJECT_SECTIONS.find(item => item.key === sectionKey) || PROJECT_SECTIONS[0];
    window.PROJECT_VIEW = 'section';
    window.PROJECT_ACTIVE_SECTION = section.key;

    if (section.key === 'prompt') renderPromptSection(section);
    else if (section.key === 'character') renderCharacterSection(section);
    else renderSituationSection(section);

    if (!skipHistory) {
        setProjectRoute(
            { projectView: 'section', projectId: SAMPLE_PROJECT.id, projectSection: section.key },
            `#project/${SAMPLE_PROJECT.id}/${section.key}`
        );
    }
}

function renderSectionHeader(title) {
    return `
        <div class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 sm:px-6 bg-white dark:bg-gray-800 flex-shrink-0">
            <div class="flex items-center gap-2 min-w-0">
                <button type="button" onclick="window.openProjectDetail('${SAMPLE_PROJECT.id}', false)" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="프로젝트로 돌아가기" aria-label="프로젝트로 돌아가기">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <div class="min-w-0">
                    <h1 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">${SAMPLE_PROJECT.name}</h1>
                    <p class="text-[11px] text-gray-500 dark:text-gray-400 truncate">${title}</p>
                </div>
            </div>
        </div>
    `;
}

function renderPromptSection(section) {
    renderProjectShell(`
        ${renderSectionHeader(section.title)}
        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <section class="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(260px,2fr)] gap-4 sm:gap-6 min-h-full">
                <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col min-h-[360px]">
                    <h3 class="font-bold text-sm text-gray-900 dark:text-white mb-3">입력 공간</h3>
                    <textarea class="flex-1 resize-none outline-none bg-transparent text-sm text-gray-700 dark:text-gray-200" aria-label="프롬프트 입력"></textarea>
                </div>

                <div class="flex flex-col gap-3">
                    <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-center font-bold text-sm text-gray-700 dark:text-gray-200">현재 글자 수</div>
                    <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-center text-sm text-gray-700 dark:text-gray-200">
                        <button type="button" class="font-bold hover:text-indigo-600 dark:hover:text-indigo-400">마크다운</button>
                        <span class="mx-2 text-gray-300 dark:text-gray-600">|</span>
                        <button type="button" class="font-bold hover:text-indigo-600 dark:hover:text-indigo-400">요약</button>
                    </div>
                    <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex-1 min-h-[180px]">
                        <p class="font-bold text-sm text-gray-900 dark:text-white">추가 기능을 위한 공간</p>
                        <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">기능 추가 가능성 높음</p>
                    </div>
                </div>
            </section>
        </div>
    `);
}

function renderCharacterSection(section) {
    renderProjectShell(`
        ${renderSectionHeader(section.title)}
        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <section class="max-w-6xl mx-auto">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="font-bold text-base text-gray-900 dark:text-white">캐릭터 목록</h3>
                    <button type="button" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition" title="캐릭터 추가" aria-label="캐릭터 추가">
                        <i data-lucide="plus" class="w-5 h-5"></i>
                    </button>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                    ${Array.from({ length: 5 }).map(() => `
                        <div class="aspect-[4/5] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"></div>
                    `).join('')}
                </div>
            </section>
        </div>
    `);
}

function renderSituationSection(section) {
    renderProjectShell(`
        ${renderSectionHeader(section.title)}
        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <section class="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6 min-h-full">
                <div class="min-h-[360px]">
                    <div class="flex items-center justify-between mb-4">
                        <h3 class="font-bold text-base text-gray-900 dark:text-white">상황 목록</h3>
                        <button type="button" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition" title="상황 추가" aria-label="상황 추가">
                            <i data-lucide="plus" class="w-5 h-5"></i>
                        </button>
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 gap-3 sm:gap-4">
                        ${Array.from({ length: 5 }).map(() => `
                            <div class="aspect-square bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"></div>
                        `).join('')}
                    </div>
                </div>

                <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 min-h-[360px] flex flex-col">
                    <h3 class="font-bold text-sm text-gray-900 dark:text-white mb-4">액션 생성 플래너</h3>
                    <div class="flex-1 flex items-start justify-center pt-10 text-sm font-bold text-gray-500 dark:text-gray-400 text-center">
                        기능 및 상세 레이아웃은 추후 구현
                    </div>
                </div>
            </section>
        </div>
    `);
}

export function restoreProjectState(state = {}) {
    if (state.projectView === 'section' && state.projectSection) {
        openProjectSection(state.projectSection, true);
    } else if (state.projectView === 'detail') {
        openProjectDetail(state.projectId || SAMPLE_PROJECT.id, true);
    } else {
        renderProjectManage(true);
    }
}
