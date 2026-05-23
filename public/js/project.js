const EXCLUDED_PROJECT_FOLDERS = new Set(['logs', '_temp_craft']);

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
    return Array.isArray(window.PROJECTS) ? window.PROJECTS : [];
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

function getProjectBasePrefix() {
    return window.ROOT_PATH || '';
}

function getProjectDisplayName(folderPrefix, folderName) {
    const alias = window.getAliasOnly ? window.getAliasOnly(folderPrefix, true) : null;
    return alias || folderName;
}

function getFolderDisplayName(folderPrefix, folderName) {
    const alias = window.getAliasOnly ? window.getAliasOnly(folderPrefix, true) : null;
    return alias || folderName;
}

function isVisibleProjectChildFolder(folderName) {
    return folderName && !folderName.startsWith('.') && !EXCLUDED_PROJECT_FOLDERS.has(folderName);
}

async function saveProjectAlias(key, alias) {
    const res = await fetch('/api/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, alias })
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '별칭 저장 실패');
    }
}

async function createProjectFolder(folderName) {
    const key = `${getProjectBasePrefix()}${folderName}/.keep`;
    const res = await fetch('/api/upload?_t=' + Date.now(), {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent('.keep'),
            'X-Absolute-Path': encodeURIComponent(key)
        },
        body: new Blob(['']),
        cache: 'no-store'
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '프로젝트 생성 실패');
    }
}

async function renameProjectFolder(oldPrefix, newPrefix) {
    const res = await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename_folder', key: oldPrefix, newKey: newPrefix })
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '프로젝트 이름 변경 실패');
    }
}

async function deleteProjectFolder(prefix) {
    const res = await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_folder', key: prefix })
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '프로젝트 삭제 실패');
    }
}

function clearRootProjectCache() {
    if (window.FOLDER_DATA_CACHE) delete window.FOLDER_DATA_CACHE[getProjectBasePrefix()];
    window.PROJECTS = null;
}

function clearProjectCaches(...prefixes) {
    clearRootProjectCache();
    if (!window.FOLDER_DATA_CACHE) return;
    prefixes.forEach(prefix => {
        if (prefix !== undefined && window.FOLDER_DATA_CACHE[prefix]) delete window.FOLDER_DATA_CACHE[prefix];
    });
}

function normalizeProjectFolderName(value) {
    return value.trim().replace(/^\/+|\/+$/g, '');
}

function isInvalidProjectFolderName(value) {
    return !value || value.includes('/') || value.includes('\\') || value.startsWith('.') || EXCLUDED_PROJECT_FOLDERS.has(value);
}

export async function loadProjects(force = false) {
    if (!force && Array.isArray(window.PROJECTS)) return window.PROJECTS;

    const [listRes, aliasRes] = await Promise.all([
        fetch(`/api/list?prefix=${encodeURIComponent(getProjectBasePrefix())}`),
        fetch(`/api/aliases?prefix=${encodeURIComponent(getProjectBasePrefix())}`)
    ]);

    if (!listRes.ok) throw new Error('프로젝트 목록을 불러오지 못했습니다.');

    if (aliasRes.ok) {
        const aliasData = await aliasRes.json();
        window.GLOBAL_ALIASES = aliasData.global || {};
        window.PROJECT_ALIASES = aliasData.project || {};
    }

    const data = await listRes.json();
    window.PROJECTS = (data.folders || [])
        .map(folderPrefix => {
            const folderName = folderPrefix.split('/').filter(Boolean).pop();
            return {
                id: folderName,
                folderName,
                prefix: folderPrefix,
                name: getProjectDisplayName(folderPrefix, folderName),
                alias: window.getAliasOnly ? window.getAliasOnly(folderPrefix, true) || '' : '',
                prompts: [],
                characters: [],
                situations: []
            };
        })
        .filter(project => project.folderName && !EXCLUDED_PROJECT_FOLDERS.has(project.folderName));

    return window.PROJECTS;
}

export async function loadProjectCharacters(project, force = false) {
    if (!project?.prefix) return [];
    if (!force && project.charactersLoaded) return getProjectItems(project, 'characters');

    const [listRes, aliasRes] = await Promise.all([
        fetch(`/api/list?prefix=${encodeURIComponent(project.prefix)}`),
        fetch(`/api/aliases?prefix=${encodeURIComponent(project.prefix)}`)
    ]);

    if (!listRes.ok) throw new Error('캐릭터 목록을 불러오지 못했습니다.');

    if (aliasRes.ok) {
        const aliasData = await aliasRes.json();
        window.GLOBAL_ALIASES = aliasData.global || {};
        window.PROJECT_ALIASES = aliasData.project || {};
    }

    const data = await listRes.json();
    project.characters = (data.folders || [])
        .map(folderPrefix => {
            const folderName = folderPrefix.split('/').filter(Boolean).pop();
            return {
                id: folderPrefix,
                folderName,
                prefix: folderPrefix,
                name: getFolderDisplayName(folderPrefix, folderName),
                alias: window.getAliasOnly ? window.getAliasOnly(folderPrefix, true) || '' : '',
                coverImage: `${folderPrefix}0.webp`
            };
        })
        .filter(character => isVisibleProjectChildFolder(character.folderName));
    project.charactersLoaded = true;

    return project.characters;
}

function renderEmptyState(message) {
    return `
        <div class="border border-dashed border-gray-200 dark:border-gray-700 rounded-lg bg-white/60 dark:bg-gray-800/40 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center min-h-24">
            ${escapeHtml(message)}
        </div>
    `;
}

function getItemLabel(item, fallback) {
    if (typeof item === 'string') return item;
    if (item?.alias && item?.folderName) return `${item.name} (${item.folderName})`;
    return item?.name || item?.title || item?.content || fallback;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function escapeJsString(value) {
    return String(value ?? '').replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function getAssetUrl(key) {
    return `/${encodeURI(key)}`;
}

function renderCharacterName(character) {
    if (character.alias) {
        return `
            <span class="block text-xs font-bold text-gray-800 dark:text-gray-100 truncate">${escapeHtml(character.name)}</span>
            <span class="block text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">${escapeHtml(character.folderName)}</span>
        `;
    }

    return `<span class="block text-xs font-bold text-gray-800 dark:text-gray-100 truncate">${escapeHtml(character.folderName || character.name || '캐릭터 이름')}</span>`;
}

function renderProjectShell(content) {
    const root = getProjectRoot();
    if (!root) return;

    root.className = 'flex flex-col absolute inset-0 w-full h-full bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100';
    root.innerHTML = content;
    refreshProjectIcons();
}

export async function renderProjectManage(skipHistory = true) {
    window.PROJECT_VIEW = 'manage';
    window.PROJECT_ACTIVE_SECTION = null;
    renderProjectManageShell(getProjects(), { loading: !Array.isArray(window.PROJECTS) });

    try {
        const projects = await loadProjects();
        if (window.PROJECT_VIEW === 'manage') renderProjectManageShell(projects);
    } catch (err) {
        if (window.PROJECT_VIEW === 'manage') renderProjectManageShell([], { error: err.message });
    }

    if (!skipHistory) setProjectRoute({ projectView: 'manage' }, '#project');
}

function renderProjectManageShell(projects, state = {}) {
    renderProjectShell(`
        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <section class="w-full max-w-2xl mx-auto pt-8 sm:pt-14">
                <div class="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center mb-4">
                    <div></div>
                    <h2 class="text-center text-lg font-bold text-gray-900 dark:text-white">프로젝트 목록</h2>
                    <button type="button" onclick="window.openProjectCreateModal()" class="p-1.5 rounded-lg text-gray-600 dark:text-gray-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition" title="프로젝트 추가" aria-label="프로젝트 추가">
                        <i data-lucide="plus" class="w-6 h-6"></i>
                    </button>
                </div>

                <div class="max-h-[62vh] overflow-y-auto pr-2 space-y-3">
                    ${state.loading ? renderEmptyState('프로젝트를 불러오는 중입니다.') : ''}
                    ${state.error ? renderEmptyState(state.error) : ''}
                    ${!state.loading && !state.error && projects.length ? projects.map(project => `
                        <button type="button" onclick="window.openProjectDetail('${escapeJsString(project.id)}')" class="w-full h-16 text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-4 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition flex items-center gap-3">
                            <span class="min-w-0 flex-1">
                                <span class="block font-bold text-sm sm:text-base text-gray-900 dark:text-white truncate">${escapeHtml(project.name)}</span>
                                ${project.alias ? `<span class="block text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">${escapeHtml(project.folderName)}</span>` : ''}
                            </span>
                            <i data-lucide="chevron-right" class="w-5 h-5 text-gray-400 flex-shrink-0"></i>
                        </button>
                    `).join('') : ''}
                    ${!state.loading && !state.error && !projects.length ? renderEmptyState('프로젝트가 없습니다.') : ''}
                </div>
            </section>
        </div>

        ${renderProjectCreateModal()}
    `);
}

function renderProjectCreateModal() {
    return `
        <div id="project-create-modal" class="fixed inset-0 z-50 hidden bg-black/60 backdrop-blur-sm items-center justify-center p-4" onclick="window.closeProjectCreateModal(event)">
            <div class="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onclick="event.stopPropagation()">
                <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                    <h3 class="text-sm font-bold text-gray-900 dark:text-white">프로젝트 추가</h3>
                    <button type="button" onclick="window.closeProjectCreateModal()" class="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition" aria-label="닫기">
                        <i data-lucide="x" class="w-5 h-5"></i>
                    </button>
                </div>

                <form id="project-create-form" class="p-4 sm:p-5 space-y-4" onsubmit="window.submitProjectCreate(event)">
                    <div>
                        <label for="project-create-name" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">이름</label>
                        <input id="project-create-name" type="text" required class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-gray-700 dark:text-white" placeholder="실제 폴더 이름">
                        <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">탐색기 최상위 폴더 이름으로 사용됩니다.</p>
                    </div>

                    <div>
                        <label for="project-create-alias" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">별칭</label>
                        <input id="project-create-alias" type="text" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-gray-700 dark:text-white" placeholder="표시 이름">
                    </div>

                    <div id="project-create-error" class="hidden text-xs text-red-500"></div>

                    <div class="flex justify-end gap-2 pt-2">
                        <button type="button" onclick="window.closeProjectCreateModal()" class="px-4 py-2 text-sm font-bold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition">취소</button>
                        <button id="project-create-submit" type="submit" class="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 transition">생성</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

export function openProjectCreateModal() {
    const modal = document.getElementById('project-create-modal');
    const form = document.getElementById('project-create-form');
    const error = document.getElementById('project-create-error');
    if (!modal) return;

    if (form) form.reset();
    if (error) {
        error.textContent = '';
        error.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => document.getElementById('project-create-name')?.focus(), 0);
}

export function closeProjectCreateModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('project-create-modal');
    if (!modal) return;

    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function setProjectCreateError(message) {
    const error = document.getElementById('project-create-error');
    if (!error) return;

    error.textContent = message;
    error.classList.toggle('hidden', !message);
}

export async function submitProjectCreate(event) {
    if (event) event.preventDefault();

    const nameInput = document.getElementById('project-create-name');
    const aliasInput = document.getElementById('project-create-alias');
    const submitBtn = document.getElementById('project-create-submit');
    const folderName = normalizeProjectFolderName(nameInput?.value || '');
    const alias = (aliasInput?.value || '').trim();

    if (isInvalidProjectFolderName(folderName)) {
        setProjectCreateError('이름에는 /, \\, 숨김 폴더명, 예약 폴더명을 사용할 수 없습니다.');
        return;
    }

    if (getProjects().some(project => project.folderName === folderName)) {
        setProjectCreateError('이미 존재하는 프로젝트 이름입니다.');
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '생성 중...';
    }

    try {
        await createProjectFolder(folderName);
        if (alias) await saveProjectAlias(`${getProjectBasePrefix()}${folderName}/`, alias);
        clearRootProjectCache();
        await loadProjects(true);
        window.closeProjectCreateModal();
        await window.renderProjectManage(true);
        if (window.loadPath && window.currentPrefix === getProjectBasePrefix()) window.loadPath(getProjectBasePrefix(), true);
    } catch (err) {
        setProjectCreateError(err.message || '프로젝트 생성에 실패했습니다.');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '생성';
        }
    }
}

export async function openProjectDetail(projectId = getDefaultProjectId(), skipHistory = false) {
    if (!Array.isArray(window.PROJECTS)) {
        await loadProjects().catch(() => []);
    }

    const project = getProjectById(projectId);
    if (!project) {
        renderProjectManage(skipHistory);
        return;
    }

    await loadProjectCharacters(project).catch(() => []);

    window.PROJECT_VIEW = 'detail';
    window.PROJECT_ACTIVE_PROJECT_ID = project.id;
    window.PROJECT_ACTIVE_SECTION = null;

    renderProjectShell(`
        <div class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 sm:px-6 bg-white dark:bg-gray-800 flex-shrink-0 gap-3">
            <div class="flex items-center gap-2 min-w-0">
                <button type="button" onclick="window.renderProjectManage(false)" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="프로젝트 목록" aria-label="프로젝트 목록">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <h1 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">${escapeHtml(project.name)}</h1>
            </div>
            <div class="relative flex-shrink-0">
                <button type="button" onclick="window.toggleProjectActionMenu(event)" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="더보기" aria-label="더보기">
                    <i data-lucide="more-vertical" class="w-5 h-5"></i>
                </button>
                <div id="project-action-menu" class="hidden absolute right-0 top-10 z-20 w-40 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden py-1">
                    <button type="button" onclick="window.renameActiveProject()" class="w-full px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">프로젝트 이름 변경</button>
                    <button type="button" onclick="window.deleteActiveProject()" class="w-full px-3 py-2 text-left text-xs font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition">프로젝트 삭제</button>
                </div>
            </div>
        </div>

        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <section class="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 min-h-full">
                ${PROJECT_SECTIONS.map(section => `
                    <button type="button" onclick="window.openProjectSection('${escapeJsString(section.key)}')" class="min-h-[220px] text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition flex flex-col">
                        <span class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                            <i data-lucide="${section.icon}" class="w-4 h-4 text-indigo-600 dark:text-indigo-400"></i>
                            ${escapeHtml(section.title)}
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

export function toggleProjectActionMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('project-action-menu');
    if (!menu) return;

    menu.classList.toggle('hidden');
}

function closeProjectActionMenu() {
    document.getElementById('project-action-menu')?.classList.add('hidden');
}

export async function renameActiveProject() {
    closeProjectActionMenu();
    const project = getActiveProject();
    if (!project) return;

    const nextName = prompt('새 프로젝트 이름을 입력하세요.', project.folderName);
    if (nextName === null) return;

    const folderName = normalizeProjectFolderName(nextName);
    if (isInvalidProjectFolderName(folderName)) {
        alert('이름에는 /, \\, 숨김 폴더명, 예약 폴더명을 사용할 수 없습니다.');
        return;
    }

    if (folderName === project.folderName) return;
    if (getProjects().some(item => item.folderName === folderName)) {
        alert('이미 존재하는 프로젝트 이름입니다.');
        return;
    }

    const oldPrefix = project.prefix;
    const newPrefix = `${getProjectBasePrefix()}${folderName}/`;

    try {
        await renameProjectFolder(oldPrefix, newPrefix);
        clearProjectCaches(oldPrefix, newPrefix);
        await loadProjects(true);
        await openProjectDetail(folderName, true);
        history.replaceState({ tab: 'project', projectView: 'detail', projectId: folderName }, '', `#project/${folderName}`);
        if (window.currentPrefix === getProjectBasePrefix() && window.loadPath) window.loadPath(getProjectBasePrefix(), true);
    } catch (err) {
        alert(err.message || '프로젝트 이름 변경 실패');
    }
}

export async function deleteActiveProject() {
    closeProjectActionMenu();
    const project = getActiveProject();
    if (!project) return;

    if (!confirm(`'${project.name}' 프로젝트와 그 안의 모든 파일을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        await deleteProjectFolder(project.prefix);
        clearProjectCaches(project.prefix);
        await loadProjects(true);
        await renderProjectManage(true);
        history.replaceState({ tab: 'project', projectView: 'manage' }, '', '#project');
        if (window.currentPrefix === getProjectBasePrefix() && window.loadPath) window.loadPath(getProjectBasePrefix(), true);
    } catch (err) {
        alert(err.message || '프로젝트 삭제 실패');
    }
}

function renderProjectPanelItems(project, section) {
    const items = getProjectItems(project, section.itemKey);
    if (!items.length) {
        return `
            <span class="h-full flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">
                ${escapeHtml(section.emptyText)}
            </span>
        `;
    }

    return `
        <span class="space-y-2 block">
            ${items.map((item, index) => `
                <span class="block px-3 py-2 rounded-md bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200 truncate">
                    ${escapeHtml(getItemLabel(item, `${section.title} ${index + 1}`))}
                </span>
            `).join('')}
        </span>
    `;
}

export async function openProjectSection(sectionKey, skipHistory = false) {
    if (!Array.isArray(window.PROJECTS)) {
        await loadProjects().catch(() => []);
    }

    const section = PROJECT_SECTIONS.find(item => item.key === sectionKey) || PROJECT_SECTIONS[0];
    window.PROJECT_VIEW = 'section';
    window.PROJECT_ACTIVE_SECTION = section.key;

    if (section.key === 'prompt') renderPromptSection(section);
    else if (section.key === 'character') {
        const project = getActiveProject();
        renderCharacterSection(section, { loading: !!project && !project.charactersLoaded });
        await loadProjectCharacters(project).catch(err => {
            if (window.PROJECT_ACTIVE_SECTION === 'character') renderCharacterSection(section, { error: err.message });
        });
        if (window.PROJECT_ACTIVE_SECTION === 'character') renderCharacterSection(section);
    }
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
                <button type="button" onclick="window.openProjectDetail('${escapeJsString(project.id)}', false)" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="프로젝트로 돌아가기" aria-label="프로젝트로 돌아가기">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <div class="min-w-0">
                    <h1 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">${escapeHtml(project.name)}</h1>
                    <p class="text-[11px] text-gray-500 dark:text-gray-400 truncate">${escapeHtml(title)}</p>
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

function renderCharacterSection(section, state = {}) {
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
                ${state.loading ? renderEmptyState('캐릭터를 불러오는 중입니다.') : ''}
                ${state.error ? renderEmptyState(state.error) : ''}
                ${!state.loading && !state.error && characters.length ? `
                    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                        ${characters.map(character => `
                            <div class="aspect-[4/5] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden flex flex-col">
                                <div class="flex-1 min-h-0 bg-gray-100 dark:bg-gray-900/50 relative">
                                    <img src="${escapeHtml(getAssetUrl(character.coverImage))}" alt="${escapeHtml(character.name)}" class="absolute inset-0 w-full h-full object-cover" onerror="this.classList.add('hidden'); this.nextElementSibling.classList.remove('hidden');">
                                    <div class="hidden absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-600">
                                        <i data-lucide="image-off" class="w-8 h-8"></i>
                                    </div>
                                </div>
                                <div class="p-3 border-t border-gray-100 dark:border-gray-700 min-h-[58px]">
                                    ${renderCharacterName(character)}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                ${!state.loading && !state.error && !characters.length ? renderEmptyState('등록된 캐릭터가 없습니다.') : ''}
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
                                    <span class="text-xs font-bold text-gray-700 dark:text-gray-200 truncate">${escapeHtml(getItemLabel(situation, '상황 이름'))}</span>
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

export async function restoreProjectState(state = {}) {
    if (state.projectView === 'section' && state.projectSection) {
        window.PROJECT_ACTIVE_PROJECT_ID = state.projectId || getDefaultProjectId();
        await openProjectSection(state.projectSection, true);
    } else if (state.projectView === 'detail') {
        await openProjectDetail(state.projectId || getDefaultProjectId(), true);
    } else {
        await renderProjectManage(true);
    }
}
