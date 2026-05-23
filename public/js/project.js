const DEFAULT_PROJECTS = [
    {
        id: 'sample-project',
        name: '프로젝트 이름',
        prompts: [],
        characters: [],
        situations: []
    }
];

const PROJECT_SECTIONS = [
    {
        key: 'prompt',
        itemKey: 'prompts',
        title: '프롬프트',
        icon: 'file-text',
        emptyText: '등록된 프롬프트가 없습니다.'
    },
    {
        key: 'character',
        itemKey: 'characters',
        title: '캐릭터',
        icon: 'users',
        emptyText: '등록된 캐릭터가 없습니다.'
    },
    {
        key: 'situation',
        itemKey: 'situations',
        title: '상황',
        icon: 'map',
        emptyText: '등록된 상황이 없습니다.'
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

function getProjects() {
    return Array.isArray(window.PROJECTS) ? window.PROJECTS : DEFAULT_PROJECTS;
}

function getProjectById(projectId) {
    return getProjects().find(project => project.id === projectId) || getProjects()[0];
}

function getActiveProject() {
    return getProjectById(window.PROJECT_ACTIVE_PROJECT_ID);
}

function getProjectItems(project, itemKey) {
    return Array.isArray(project?.[itemKey]) ? project[itemKey] : [];
}

function getDefaultProjectId() {
    return getProjects()[0]?.id || '';
}

function renderEmptyState(message) {
    return `
        <div class="border border-dashed border-gray-200 dark:border-gray-700 rounded-lg bg-white/60 dark:bg-gray-800/40 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center min-h-24">
            ${message}
        </div>
    `;
}

function getItemLabel(item, fallback) {
    if (typeof item === 'string') return item;
    return item?.name || item?.title || item?.content || fallback;
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
    const projects = getProjects();

    renderProjectShell(`
        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <section class="w-full max-w-2xl mx-auto pt-8 sm:pt-14">
                <div class="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center mb-4">
                    <div></div>
                    <h2 class="text-center text-lg font-bold text-gray-900 dark:text-white">프로젝트 목록</h2>
                    <button type="button" class="p-1.5 rounded-lg text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition" title="프로젝트 추가" aria-label="프로젝트 추가">
                        <i data-lucide="plus" class="w-6 h-6"></i>
                    </button>
                </div>

                <div class="max-h-[62vh] overflow-y-auto pr-2 space-y-3">
                    ${projects.length ? projects.map(project => `
                        <button type="button" onclick="window.openProjectDetail('${project.id}')" class="w-full h-16 text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition flex items-center gap-3">
                            <span class="min-w-0 flex-1">
                                <span class="block font-bold text-sm sm:text-base text-gray-900 dark:text-white truncate">${project.name}</span>
                            </span>
                            <i data-lucide="chevron-right" class="w-5 h-5 text-gray-400 flex-shrink-0"></i>
                        </button>
                    `).join('') : renderEmptyState('프로젝트가 없습니다.')}
                </div>
            </section>
        </div>
    `);

    if (!skipHistory) setProjectRoute({ projectView: 'manage' }, '#project');
}

export function openProjectDetail(projectId = getDefaultProjectId(), skipHistory = false) {
    const project = getProjectById(projectId);
    if (!project) {
        renderProjectManage(skipHistory);
        return;
    }

    window.PROJECT_VIEW = 'detail';
    window.PROJECT_ACTIVE_PROJECT_ID = project.id;
    window.PROJECT_ACTIVE_SECTION = null;

    renderProjectShell(`
        <div class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 sm:px-6 bg-white dark:bg-gray-800 flex-shrink-0 gap-3">
            <div class="flex items-center gap-2 min-w-0">
                <button type="button" onclick="window.renderProjectManage(false)" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="프로젝트 목록" aria-label="프로젝트 목록">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <h1 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">${project.name}</h1>
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
                        <span class="flex-1 p-4 block">
                            ${renderProjectPanelItems(project, section)}
                        </span>
                    </button>
                `).join('')}
            </section>
        </div>
    `);

    if (!skipHistory) setProjectRoute({ projectView: 'detail', projectId: project.id }, `#project/${project.id}`);
}

function renderProjectPanelItems(project, section) {
    const items = getProjectItems(project, section.itemKey);
    if (!items.length) {
        return `
            <span class="h-full flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">
                ${section.emptyText}
            </span>
        `;
    }

    return `
        <span class="space-y-2 block">
            ${items.map((item, index) => `
                <span class="block px-3 py-2 rounded-md bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200 truncate">
                    ${getItemLabel(item, `${section.title} ${index + 1}`)}
                </span>
            `).join('')}
        </span>
    `;
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
            { projectView: 'section', projectId: window.PROJECT_ACTIVE_PROJECT_ID, projectSection: section.key },
            `#project/${window.PROJECT_ACTIVE_PROJECT_ID}/${section.key}`
        );
    }
}

function renderSectionHeader(title) {
    const project = getActiveProject() || { id: getDefaultProjectId(), name: '프로젝트 이름' };
    return `
        <div class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center px-4 sm:px-6 bg-white dark:bg-gray-800 flex-shrink-0">
            <div class="flex items-center gap-2 min-w-0">
                <button type="button" onclick="window.openProjectDetail('${project.id}', false)" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="프로젝트로 돌아가기" aria-label="프로젝트로 돌아가기">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <div class="min-w-0">
                    <h1 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">${project.name}</h1>
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
    const project = getActiveProject();
    const characters = getProjectItems(project, 'characters');

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
                ${characters.length ? `
                    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                        ${characters.map(character => `
                            <div class="aspect-[4/5] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 flex items-end">
                                <span class="text-xs font-bold text-gray-700 dark:text-gray-200 truncate">${character.name || '캐릭터 이름'}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : renderEmptyState('등록된 캐릭터가 없습니다.')}
            </section>
        </div>
    `);
}

function renderSituationSection(section) {
    const project = getActiveProject();
    const situations = getProjectItems(project, 'situations');

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
                    ${situations.length ? `
                        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 gap-3 sm:gap-4">
                            ${situations.map(situation => `
                                <div class="aspect-square bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 flex items-end">
                                    <span class="text-xs font-bold text-gray-700 dark:text-gray-200 truncate">${situation.name || '상황 이름'}</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : renderEmptyState('등록된 상황이 없습니다.')}
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
        window.PROJECT_ACTIVE_PROJECT_ID = state.projectId || getDefaultProjectId();
        openProjectSection(state.projectSection, true);
    } else if (state.projectView === 'detail') {
        openProjectDetail(state.projectId || getDefaultProjectId(), true);
    } else {
        renderProjectManage(true);
    }
}
