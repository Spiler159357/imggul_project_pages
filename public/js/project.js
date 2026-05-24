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

const CHARACTER_IMAGE_EXTENSIONS = new Set(['webp', 'png', 'jpg', 'jpeg']);

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

async function createProjectChildFolder(project, folderName) {
    const key = `${project.prefix}${folderName}/.keep`;
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
        throw new Error(data.error || '폴더 생성 실패');
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

function getSituationMetaKey(project) {
    return `${project.prefix}_situations_meta.json`;
}

function getCharacterMetaKey(character) {
    return `${character.prefix}_character_meta.json`;
}

function getCharacterById(project, characterId) {
    const decodedId = decodeURIComponent(characterId || '');
    return getProjectItems(project, 'characters').find(character =>
        character.id === decodedId ||
        character.prefix === decodedId ||
        character.folderName === decodedId
    );
}

function getFileNameFromKey(key) {
    return String(key || '').split('/').pop() || '';
}

function getFileBaseName(fileName) {
    return String(fileName || '').replace(/\.[^/.]+$/, '').toLowerCase();
}

function getFileExtension(fileName) {
    return String(fileName || '').split('.').pop().toLowerCase();
}

function isImageFile(file) {
    return CHARACTER_IMAGE_EXTENSIONS.has(getFileExtension(getFileNameFromKey(file?.key)));
}

async function loadCharacterFiles(character, force = false) {
    if (!character?.prefix) return [];
    if (!force && character.filesLoaded) return Array.isArray(character.files) ? character.files : [];

    const res = await fetch(`/api/list?prefix=${encodeURIComponent(character.prefix)}&_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('캐릭터 이미지 목록을 불러오지 못했습니다.');

    const data = await res.json();
    character.files = (data.files || [])
        .filter(file => isImageFile(file))
        .sort((a, b) => getFileNameFromKey(a.key).localeCompare(getFileNameFromKey(b.key), undefined, { numeric: true }));
    character.filesLoaded = true;
    return character.files;
}

async function loadCharacterMeta(character, force = false) {
    if (!character?.prefix) return {};
    if (!force && character.metaLoaded) return character.meta || {};

    const res = await fetch(`${getAssetUrl(getCharacterMetaKey(character))}?_t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) {
        character.meta = {};
        character.metaLoaded = true;
        return character.meta;
    }
    if (!res.ok) throw new Error('캐릭터 프롬프트를 불러오지 못했습니다.');

    character.meta = await res.json();
    character.metaLoaded = true;
    return character.meta;
}

async function saveCharacterMeta(character, meta) {
    const metaKey = getCharacterMetaKey(character);
    const content = JSON.stringify(meta || {}, null, 2);
    const res = await fetch('/api/upload?_t=' + Date.now(), {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-File-Name': encodeURIComponent('_character_meta.json'),
            'X-Absolute-Path': encodeURIComponent(metaKey)
        },
        body: new Blob([content], { type: 'application/json; charset=utf-8' }),
        cache: 'no-store'
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '캐릭터 프롬프트 저장에 실패했습니다.');
    }

    character.meta = meta || {};
    character.metaLoaded = true;
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

export async function loadProjectSituations(project, force = false) {
    if (!project?.prefix) return [];
    if (!force && project.situationsLoaded) return getProjectItems(project, 'situations');

    const metaKey = getSituationMetaKey(project);
    const res = await fetch(`${getAssetUrl(metaKey)}?_t=${Date.now()}`, { cache: 'no-store' });

    if (res.status === 404) {
        project.situations = [];
        project.situationsLoaded = true;
        return project.situations;
    }

    if (!res.ok) throw new Error('상황 목록을 불러오지 못했습니다.');

    const data = await res.json();
    project.situations = normalizeProjectSituations(Array.isArray(data.situations) ? data.situations : []);
    project.situationsLoaded = true;

    return project.situations;
}

function normalizeProjectSituations(situations) {
    return situations.map((situation, index) => {
        const id = situation?.id || situation?.folderName || `situation-${index + 1}`;
        const alias = situation?.alias || '';
        const name = situation?.name || alias || id;
        return {
            ...situation,
            id,
            folderName: situation?.folderName || id,
            name,
            alias,
            imageNumber: Number(situation?.imageNumber) || index + 1,
            prompt: {
                expression: situation?.prompt?.expression || situation?.expression || '',
                action: situation?.prompt?.action || situation?.action || ''
            },
            createdAt: situation?.createdAt || Date.now()
        };
    });
}

async function saveProjectSituations(project) {
    const metaKey = getSituationMetaKey(project);
    const content = JSON.stringify({ situations: getProjectItems(project, 'situations') }, null, 2);
    const res = await fetch('/api/upload?_t=' + Date.now(), {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-File-Name': encodeURIComponent('_situations_meta.json'),
            'X-Absolute-Path': encodeURIComponent(metaKey)
        },
        body: new Blob([content], { type: 'application/json; charset=utf-8' }),
        cache: 'no-store'
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '상황 저장 실패');
    }
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

function getSituationDisplayName(situation) {
    return situation?.alias || situation?.name || situation?.id || '상황 이름';
}

function getSituationImageNumber(project, situation) {
    const situations = getProjectItems(project, 'situations');
    const index = situations.findIndex(item => item.id === situation?.id);
    return Number(situation?.imageNumber) || (index >= 0 ? index + 1 : situations.length + 1);
}

function getSituationImageKey(project, situation) {
    return `${project.prefix}${getSituationImageNumber(project, situation)}.webp`;
}

function getNextSituationImageNumber(project) {
    const usedNumbers = getProjectItems(project, 'situations')
        .map(situation => Number(situation.imageNumber))
        .filter(number => Number.isFinite(number));
    return usedNumbers.length ? Math.max(...usedNumbers) + 1 : getProjectItems(project, 'situations').length + 1;
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

function initPromptSectionInput() {
    const input = document.getElementById('project-prompt-input');
    const count = document.getElementById('project-prompt-count');
    if (!input || !count) return;

    const updateCount = () => {
        count.textContent = `${Array.from(input.value).length.toLocaleString()}자`;
    };

    input.addEventListener('input', updateCount);
    updateCount();
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

    await Promise.all([
        loadProjectCharacters(project).catch(() => []),
        loadProjectSituations(project).catch(() => [])
    ]);

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
    else {
        const project = getActiveProject();
        renderSituationSection(section, { loading: !!project && !project.situationsLoaded });
        await loadProjectSituations(project).catch(err => {
            if (window.PROJECT_ACTIVE_SECTION === 'situation') renderSituationSection(section, { error: err.message });
        });
        if (window.PROJECT_ACTIVE_SECTION === 'situation') renderSituationSection(section);
    }

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
                    <textarea id="project-prompt-input" class="flex-1 resize-none outline-none bg-transparent text-sm leading-6 text-gray-700 dark:text-gray-200" aria-label="프롬프트 입력"></textarea>
                </div>

                <div class="flex flex-col gap-3">
                    <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-center">
                        <span class="block text-[11px] font-bold text-gray-500 dark:text-gray-400">현재 글자 수</span>
                        <strong id="project-prompt-count" class="block mt-1 text-2xl font-extrabold text-gray-900 dark:text-white">0자</strong>
                    </div>
                    <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 text-center text-sm text-gray-700 dark:text-gray-200">
                        <button type="button" class="inline-flex items-center justify-center gap-1.5 font-bold hover:text-indigo-600 dark:hover:text-indigo-400 transition">
                            <i data-lucide="sparkles" class="w-4 h-4"></i>
                            <span>마크다운/요약</span>
                        </button>
                    </div>
                    <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex-1 min-h-[180px]">
                        <p class="font-bold text-sm text-gray-900 dark:text-white">추가 기능을 위한 공간</p>
                        <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">기능 추가 가능성 높음</p>
                    </div>
                </div>
            </section>
        </div>
    `);
    initPromptSectionInput();
}

function getSituationImageCandidates(situation, index) {
    const values = [String(Number(situation?.imageNumber) || index + 1)];

    return values
        .filter(Boolean)
        .map(value => String(value).trim().toLowerCase())
        .filter(Boolean);
}

function findSituationImage(files, situation, index) {
    const candidates = new Set(getSituationImageCandidates(situation, index));
    return files.find(file => candidates.has(getFileBaseName(getFileNameFromKey(file.key)))) || null;
}

function getSituationRows(character, situations, files) {
    return situations.map((situation, index) => {
        const image = findSituationImage(files, situation, index);
        return {
            index,
            situation,
            image,
            imageUrl: image ? `${getAssetUrl(image.key)}?t=${image.uploaded ? new Date(image.uploaded).getTime() : Date.now()}` : '',
            label: getItemLabel(situation, `상황 ${index + 1}`),
            characterName: character?.name || character?.folderName || '캐릭터'
        };
    });
}

function getCharacterProgress(rows) {
    const total = rows.length;
    const complete = rows.filter(row => row.image).length;
    const missing = Math.max(total - complete, 0);
    const percent = total ? Math.round((complete / total) * 100) : 0;
    return { total, complete, missing, percent };
}

function renderCharacterStatusBadge(isComplete) {
    return isComplete
        ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">완료</span>'
        : '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">미생성</span>';
}

function renderCharacterImageRows(project, character, rows) {
    if (!rows.length) {
        return renderEmptyState('등록된 상황이 없습니다. 상황을 먼저 추가하면 이미지 공정률을 계산할 수 있습니다.');
    }

    return `
        <div class="space-y-2">
            ${rows.map(row => {
                const clickAction = row.image
                    ? `window.openModal('${escapeJsString(row.image.key)}', '${escapeJsString(row.imageUrl)}', true, false, ${row.image.isPublic ? 'true' : 'false'})`
                    : `window.prepareCharacterGeneration('${escapeJsString(project.id)}', '${escapeJsString(character.id)}', ${row.index})`;
                return `
                    <button type="button" onclick="${clickAction}" class="w-full text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 items-center">
                        <span class="aspect-square rounded-md overflow-hidden bg-gray-100 dark:bg-gray-900/60 flex items-center justify-center">
                            ${row.image ? `
                                <img src="${escapeHtml(row.imageUrl)}" alt="${escapeHtml(row.label)}" class="w-full h-full object-cover" loading="lazy">
                            ` : `
                                <i data-lucide="image-plus" class="w-6 h-6 text-gray-300 dark:text-gray-600"></i>
                            `}
                        </span>
                        <span class="min-w-0">
                            <span class="flex items-center justify-between gap-2">
                                <span class="text-xs font-bold text-gray-900 dark:text-white truncate">${escapeHtml(row.label)}</span>
                                ${renderCharacterStatusBadge(!!row.image)}
                            </span>
                            <span class="block mt-1 text-[11px] text-gray-500 dark:text-gray-400 truncate">이름: ${escapeHtml(row.characterName)}</span>
                            <span class="block mt-1 text-[10px] text-gray-400 dark:text-gray-500 truncate">${row.image ? escapeHtml(getFileNameFromKey(row.image.key)) : '클릭하면 생성 화면에 프롬프트를 준비합니다.'}</span>
                        </span>
                    </button>
                `;
            }).join('')}
        </div>
    `;
}

function renderCharacterDetailShell(project, character, state = {}) {
    const situations = getProjectItems(project, 'situations');
    const files = Array.isArray(character.files) ? character.files : [];
    const meta = character.meta || {};
    const rows = getSituationRows(character, situations, files);
    const progress = getCharacterProgress(rows);
    const coverImage = rows.find(row => row.image)?.imageUrl || getAssetUrl(character.coverImage);
    const prompt = meta.prompt || '';

    renderProjectShell(`
        <div class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 sm:px-6 bg-white dark:bg-gray-800 flex-shrink-0 gap-3">
            <div class="flex items-center gap-2 min-w-0">
                <button type="button" onclick="window.openProjectSection('character', false)" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="캐릭터 목록" aria-label="캐릭터 목록">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <div class="min-w-0">
                    <h1 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">${escapeHtml(character.name || character.folderName)}</h1>
                    <p class="text-[11px] text-gray-500 dark:text-gray-400 truncate">${escapeHtml(project.name)} / 캐릭터 상세</p>
                </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
                <button type="button" onclick="window.openCharacterFolder('${escapeJsString(character.prefix)}')" class="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 transition">
                    <i data-lucide="folder-open" class="w-4 h-4"></i>
                    폴더 열기
                </button>
                <div class="relative">
                    <button type="button" onclick="window.toggleCharacterActionMenu(event)" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="더보기" aria-label="더보기">
                        <i data-lucide="more-vertical" class="w-5 h-5"></i>
                    </button>
                    <div id="character-action-menu" class="hidden absolute right-0 top-10 z-20 w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden py-1">
                        <button type="button" onclick="window.renameActiveCharacter()" class="w-full px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">캐릭터 이름 변경</button>
                        <button type="button" onclick="window.openCharacterFolder('${escapeJsString(character.prefix)}')" class="sm:hidden w-full px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">폴더 열기</button>
                        <button type="button" onclick="window.deleteActiveCharacter()" class="w-full px-3 py-2 text-left text-xs font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition">캐릭터 삭제</button>
                    </div>
                </div>
            </div>
        </div>

        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            ${state.loading ? renderEmptyState('캐릭터 상세 정보를 불러오는 중입니다.') : ''}
            ${state.error ? renderEmptyState(state.error) : ''}
            ${!state.loading && !state.error ? `
                <section class="grid grid-cols-1 xl:grid-cols-[minmax(320px,0.95fr)_minmax(420px,1.35fr)] gap-4 sm:gap-6 max-w-7xl mx-auto min-h-full">
                    <div class="min-h-0 flex flex-col gap-4">
                        <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                            <div class="grid grid-cols-[6rem_minmax(0,1fr)] gap-4 items-center">
                                <div class="aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-900/60 relative">
                                    <img src="${escapeHtml(coverImage)}" alt="${escapeHtml(character.name)}" class="absolute inset-0 w-full h-full object-cover" onerror="this.classList.add('hidden'); this.nextElementSibling.classList.remove('hidden');">
                                    <div class="hidden absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-600">
                                        <i data-lucide="image-off" class="w-8 h-8"></i>
                                    </div>
                                </div>
                                <div class="min-w-0">
                                    <h2 class="text-lg font-bold text-gray-900 dark:text-white truncate">${escapeHtml(character.name || character.folderName)}</h2>
                                    ${character.alias ? `<p class="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">${escapeHtml(character.folderName)}</p>` : ''}
                                    <div class="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
                                        <span class="px-2 py-1 rounded bg-gray-100 dark:bg-gray-900/60 text-gray-600 dark:text-gray-300">상황 ${progress.total}</span>
                                        <span class="px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">완료 ${progress.complete}</span>
                                        <span class="px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">미생성 ${progress.missing}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="bg-gray-50 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-700 rounded-lg p-3 flex-1 min-h-[360px]">
                            <div class="flex items-center justify-between mb-3">
                                <h3 class="text-sm font-bold text-gray-900 dark:text-white">상황별 이미지</h3>
                                <span class="text-[11px] font-bold text-gray-500 dark:text-gray-400">${progress.complete}/${progress.total}</span>
                            </div>
                            <div class="max-h-[58vh] overflow-y-auto pr-1">
                                ${renderCharacterImageRows(project, character, rows)}
                            </div>
                        </div>
                    </div>

                    <div class="min-h-0 flex flex-col gap-4">
                        <form id="character-prompt-form" onsubmit="window.saveCharacterPrompt(event)" class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col min-h-[360px]">
                            <div class="flex items-center justify-between gap-3 mb-3">
                                <h3 class="text-sm font-bold text-gray-900 dark:text-white">캐릭터 프롬프트</h3>
                                <button id="character-prompt-save-btn" type="submit" class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 transition">
                                    <i data-lucide="save" class="w-4 h-4"></i>
                                    저장
                                </button>
                            </div>
                            <textarea id="character-prompt-input" class="flex-1 min-h-[260px] resize-none p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-sm leading-6 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="캐릭터의 외형, 분위기, 반복해서 유지해야 하는 특징을 입력하세요.">${escapeHtml(prompt)}</textarea>
                            <p id="character-prompt-save-status" class="mt-2 min-h-4 text-[11px] text-gray-400 dark:text-gray-500"></p>
                        </form>

                        <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                            <div class="flex items-center justify-between gap-3">
                                <div>
                                    <h3 class="text-sm font-bold text-gray-900 dark:text-white">이미지 공정률</h3>
                                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">${progress.total}개 상황 중 ${progress.complete}개 완료</p>
                                </div>
                                <span class="text-2xl font-bold text-indigo-600 dark:text-indigo-400">${progress.percent}%</span>
                            </div>
                            <div class="mt-4 h-2.5 rounded-full bg-gray-100 dark:bg-gray-900 overflow-hidden">
                                <div class="h-full bg-indigo-600 dark:bg-indigo-500 rounded-full transition-all" style="width: ${progress.percent}%"></div>
                            </div>
                            <div class="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
                                <div class="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3">
                                    <p class="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">완료</p>
                                    <p class="mt-1 text-lg font-bold text-emerald-800 dark:text-emerald-200">${progress.complete}</p>
                                </div>
                                <div class="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3">
                                    <p class="text-[11px] font-bold text-amber-700 dark:text-amber-300">미생성</p>
                                    <p class="mt-1 text-lg font-bold text-amber-800 dark:text-amber-200">${progress.missing}</p>
                                </div>
                                <div class="rounded-lg bg-gray-50 dark:bg-gray-900/50 p-3">
                                    <p class="text-[11px] font-bold text-gray-600 dark:text-gray-300">전체</p>
                                    <p class="mt-1 text-lg font-bold text-gray-800 dark:text-gray-100">${progress.total}</p>
                                </div>
                            </div>
                            <div class="mt-4 flex flex-col sm:flex-row gap-2">
                                <button type="button" onclick="window.prepareCharacterGeneration('${escapeJsString(project.id)}', '${escapeJsString(character.id)}')" class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 transition">
                                    <i data-lucide="wand-2" class="w-4 h-4"></i>
                                    누락 이미지 생성 준비
                                </button>
                                <button type="button" onclick="window.openProjectSection('situation', false)" class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-xs font-bold hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 transition">
                                    <i data-lucide="map" class="w-4 h-4"></i>
                                    상황 관리
                                </button>
                            </div>
                        </div>
                    </div>
                </section>
            ` : ''}
        </div>
    `);
}

export async function openCharacterDetail(projectId = window.PROJECT_ACTIVE_PROJECT_ID, characterId = '', skipHistory = false) {
    if (!Array.isArray(window.PROJECTS)) {
        await loadProjects().catch(() => []);
    }

    const project = getProjectById(projectId);
    if (!project) {
        renderProjectManage(skipHistory);
        return;
    }

    await Promise.all([
        loadProjectCharacters(project).catch(() => []),
        loadProjectSituations(project).catch(() => [])
    ]);

    const character = getCharacterById(project, characterId);
    if (!character) {
        await openProjectSection('character', skipHistory);
        return;
    }

    window.PROJECT_VIEW = 'character-detail';
    window.PROJECT_ACTIVE_PROJECT_ID = project.id;
    window.PROJECT_ACTIVE_SECTION = 'character';
    window.PROJECT_ACTIVE_CHARACTER_ID = character.id;

    renderCharacterDetailShell(project, character, { loading: !character.filesLoaded || !character.metaLoaded });

    try {
        await Promise.all([
            loadCharacterFiles(character),
            loadCharacterMeta(character)
        ]);
        if (window.PROJECT_VIEW === 'character-detail' && window.PROJECT_ACTIVE_CHARACTER_ID === character.id) {
            renderCharacterDetailShell(project, character);
        }
    } catch (err) {
        if (window.PROJECT_VIEW === 'character-detail' && window.PROJECT_ACTIVE_CHARACTER_ID === character.id) {
            renderCharacterDetailShell(project, character, { error: err.message });
        }
    }

    if (!skipHistory) {
        setProjectRoute(
            { projectView: 'character-detail', projectId: project.id, characterId: character.id },
            `#project/${project.id}/character/${encodeURIComponent(character.folderName)}`
        );
    }
}

export async function saveCharacterPrompt(event) {
    if (event) event.preventDefault();

    const project = getActiveProject();
    const character = getCharacterById(project, window.PROJECT_ACTIVE_CHARACTER_ID);
    const input = document.getElementById('character-prompt-input');
    const button = document.getElementById('character-prompt-save-btn');
    const status = document.getElementById('character-prompt-save-status');
    if (!project || !character || !input) return;

    const previousButtonHtml = button?.innerHTML || '';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> 저장 중';
        refreshProjectIcons();
    }
    if (status) status.textContent = '';

    try {
        const meta = await loadCharacterMeta(character).catch(() => ({}));
        await saveCharacterMeta(character, {
            ...meta,
            prompt: input.value.trim(),
            updatedAt: Date.now()
        });
        if (status) status.textContent = '저장되었습니다.';
    } catch (err) {
        if (status) status.textContent = err.message || '저장에 실패했습니다.';
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = previousButtonHtml;
            refreshProjectIcons();
        }
    }
}

export async function prepareCharacterGeneration(projectId = window.PROJECT_ACTIVE_PROJECT_ID, characterId = window.PROJECT_ACTIVE_CHARACTER_ID, situationIndex = null) {
    if (!Array.isArray(window.PROJECTS)) await loadProjects().catch(() => []);

    const project = getProjectById(projectId);
    if (!project) return;
    await Promise.all([
        loadProjectCharacters(project).catch(() => []),
        loadProjectSituations(project).catch(() => [])
    ]);

    const character = getCharacterById(project, characterId);
    if (!character) return;

    const meta = await loadCharacterMeta(character).catch(() => ({}));
    const situations = getProjectItems(project, 'situations');
    const selectedSituation = Number.isInteger(situationIndex) ? situations[situationIndex] : null;
    const situationText = selectedSituation ? getItemLabel(selectedSituation, `상황 ${situationIndex + 1}`) : '';
    const promptParts = [meta.prompt, situationText].filter(Boolean);

    window.switchTab('craft');

    const simpleToggle = document.getElementById('prompt-toggle-simple');
    if (simpleToggle) {
        simpleToggle.checked = true;
        if (window.togglePromptMode) window.togglePromptMode();
    }

    const rawPrompt = document.getElementById('prompt-raw');
    if (rawPrompt) {
        rawPrompt.value = promptParts.join(', ');
        rawPrompt.style.height = 'auto';
        rawPrompt.style.height = rawPrompt.scrollHeight + 'px';
    }

    if (window.saveCraftSettings) window.saveCraftSettings();

    if (window.updateCraftFolderList) await window.updateCraftFolderList();
    const projectSelect = document.getElementById('craft-project-select');
    if (projectSelect) {
        projectSelect.value = project.prefix;
        if (window.onCraftProjectChange) await window.onCraftProjectChange();
    }

    const characterSelect = document.getElementById('craft-char-select');
    if (characterSelect) characterSelect.value = character.prefix;
}

export function openCharacterFolder(prefix) {
    if (!prefix || !window.loadPath) return;
    window.switchTab('explorer');
    window.loadPath(prefix);
}

export function toggleCharacterActionMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('character-action-menu');
    if (!menu) return;

    menu.classList.toggle('hidden');
}

function closeCharacterActionMenu() {
    document.getElementById('character-action-menu')?.classList.add('hidden');
}

export async function renameActiveCharacter() {
    closeCharacterActionMenu();

    const project = getActiveProject();
    const character = getCharacterById(project, window.PROJECT_ACTIVE_CHARACTER_ID);
    if (!project || !character) return;

    const nextFolderName = prompt('캐릭터 폴더 이름을 입력하세요.', character.folderName);
    if (nextFolderName === null) return;

    const folderName = normalizeProjectFolderName(nextFolderName);
    if (isInvalidProjectFolderName(folderName)) {
        alert('이름에는 /, \\, 숨김 폴더명, 예약 폴더명을 사용할 수 없습니다.');
        return;
    }

    const nextAlias = prompt('캐릭터 표시 이름을 입력하세요. 비워두면 폴더 이름을 표시합니다.', character.alias || '');
    if (nextAlias === null) return;

    const alias = nextAlias.trim();
    const folderChanged = folderName !== character.folderName;
    const aliasChanged = alias !== (character.alias || '');

    if (!folderChanged && !aliasChanged) return;

    if (folderChanged && getProjectItems(project, 'characters').some(item => item.folderName === folderName)) {
        alert('이미 존재하는 캐릭터 이름입니다.');
        return;
    }

    const oldPrefix = character.prefix;
    const newPrefix = `${project.prefix}${folderName}/`;

    try {
        if (folderChanged) {
            await renameProjectFolder(oldPrefix, newPrefix);
        }

        if (aliasChanged || folderChanged) {
            await saveProjectAlias(newPrefix, alias);
        }

        clearProjectCaches(project.prefix, oldPrefix, newPrefix);
        project.charactersLoaded = false;
        await loadProjectCharacters(project, true);
        await openCharacterDetail(project.id, newPrefix, true);
        history.replaceState(
            { tab: 'project', projectView: 'character-detail', projectId: project.id, characterId: newPrefix },
            '',
            `#project/${project.id}/character/${encodeURIComponent(folderName)}`
        );

        if (window.currentPrefix === project.prefix && window.loadPath) window.loadPath(project.prefix, true);
    } catch (err) {
        alert(err.message || '캐릭터 이름 변경에 실패했습니다.');
    }
}

export async function deleteActiveCharacter() {
    closeCharacterActionMenu();

    const project = getActiveProject();
    const character = getCharacterById(project, window.PROJECT_ACTIVE_CHARACTER_ID);
    if (!project || !character) return;

    if (!confirm(`'${character.name || character.folderName}' 캐릭터와 그 안의 모든 파일을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        await deleteProjectFolder(character.prefix);
        clearProjectCaches(project.prefix, character.prefix);
        project.charactersLoaded = false;
        await loadProjectCharacters(project, true);
        await openProjectSection('character', true);
        history.replaceState(
            { tab: 'project', projectView: 'section', projectId: project.id, projectSection: 'character' },
            '',
            `#project/${project.id}/character`
        );

        if (window.currentPrefix === project.prefix && window.loadPath) window.loadPath(project.prefix, true);
    } catch (err) {
        alert(err.message || '캐릭터 삭제에 실패했습니다.');
    }
}

function renderProjectItemCreateModal() {
    return `
        <div id="project-item-create-modal" class="fixed inset-0 z-50 hidden bg-black/60 backdrop-blur-sm items-center justify-center p-4" onclick="window.closeProjectItemCreateModal(event)">
            <div class="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onclick="event.stopPropagation()">
                <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                    <h3 id="project-item-create-title" class="text-sm font-bold text-gray-900 dark:text-white">항목 추가</h3>
                    <button type="button" onclick="window.closeProjectItemCreateModal()" class="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition" aria-label="닫기">
                        <i data-lucide="x" class="w-5 h-5"></i>
                    </button>
                </div>

                <form id="project-item-create-form" class="p-4 sm:p-5 space-y-4" onsubmit="window.submitProjectItemCreate(event)">
                    <input id="project-item-create-type" type="hidden">
                    <div>
                        <label for="project-item-create-name" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">이름</label>
                        <input id="project-item-create-name" type="text" required class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-gray-700 dark:text-white" placeholder="저장 이름">
                        <p id="project-item-create-help" class="mt-1 text-[11px] text-gray-400 dark:text-gray-500"></p>
                    </div>

                    <div>
                        <label for="project-item-create-alias" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">별칭</label>
                        <input id="project-item-create-alias" type="text" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-gray-700 dark:text-white" placeholder="표시 이름">
                    </div>

                    <div id="project-item-create-error" class="hidden text-xs text-red-500"></div>

                    <div class="flex justify-end gap-2 pt-2">
                        <button type="button" onclick="window.closeProjectItemCreateModal()" class="px-4 py-2 text-sm font-bold rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition">취소</button>
                        <button id="project-item-create-submit" type="submit" class="px-4 py-2 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 transition">생성</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

export function openProjectItemCreateModal(type) {
    const modal = document.getElementById('project-item-create-modal');
    const form = document.getElementById('project-item-create-form');
    const typeInput = document.getElementById('project-item-create-type');
    const title = document.getElementById('project-item-create-title');
    const help = document.getElementById('project-item-create-help');
    const error = document.getElementById('project-item-create-error');
    if (!modal || !typeInput) return;

    if (form) form.reset();
    if (error) {
        error.textContent = '';
        error.classList.add('hidden');
    }

    typeInput.value = type;
    if (title) title.textContent = type === 'character' ? '캐릭터 추가' : '상황 추가';
    if (help) {
        help.textContent = type === 'character'
            ? '프로젝트 하위 캐릭터 폴더 이름으로 사용됩니다.'
            : '프로젝트 상황 메타데이터에 저장됩니다.';
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => document.getElementById('project-item-create-name')?.focus(), 0);
}

export function closeProjectItemCreateModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('project-item-create-modal');
    if (!modal) return;

    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function setProjectItemCreateError(message) {
    const error = document.getElementById('project-item-create-error');
    if (!error) return;

    error.textContent = message;
    error.classList.toggle('hidden', !message);
}

export async function submitProjectItemCreate(event) {
    if (event) event.preventDefault();

    const project = getActiveProject();
    const type = document.getElementById('project-item-create-type')?.value;
    const nameInput = document.getElementById('project-item-create-name');
    const aliasInput = document.getElementById('project-item-create-alias');
    const submitBtn = document.getElementById('project-item-create-submit');
    const itemName = normalizeProjectFolderName(nameInput?.value || '');
    const alias = (aliasInput?.value || '').trim();

    if (!project || !['character', 'situation'].includes(type)) return;

    if (isInvalidProjectFolderName(itemName)) {
        setProjectItemCreateError('이름에는 /, \\, 숨김 폴더명, 예약 폴더명을 사용할 수 없습니다.');
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '생성 중...';
    }

    try {
        if (type === 'character') {
            await createCharacter(project, itemName, alias);
            window.closeProjectItemCreateModal();
            renderCharacterSection(PROJECT_SECTIONS.find(section => section.key === 'character'));
        } else {
            await createSituation(project, itemName, alias);
            window.closeProjectItemCreateModal();
            renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
        }
    } catch (err) {
        setProjectItemCreateError(err.message || '생성에 실패했습니다.');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '생성';
        }
    }
}

async function createCharacter(project, folderName, alias) {
    if (!project.charactersLoaded) await loadProjectCharacters(project);
    if (getProjectItems(project, 'characters').some(character => character.folderName === folderName)) {
        throw new Error('이미 존재하는 캐릭터 이름입니다.');
    }

    await createProjectChildFolder(project, folderName);
    if (alias) await saveProjectAlias(`${project.prefix}${folderName}/`, alias);
    if (window.FOLDER_DATA_CACHE) delete window.FOLDER_DATA_CACHE[project.prefix];
    await loadProjectCharacters(project, true);
    if (window.loadPath && window.currentPrefix === project.prefix) window.loadPath(project.prefix, true);
}

async function createSituation(project, situationId, alias) {
    if (!project.situationsLoaded) await loadProjectSituations(project);
    if (getProjectItems(project, 'situations').some(situation => situation.id === situationId)) {
        throw new Error('이미 존재하는 상황 이름입니다.');
    }

    const imageNumber = getNextSituationImageNumber(project);
    const name = alias || situationId;
    const situation = {
        id: situationId,
        folderName: situationId,
        name,
        alias,
        imageNumber,
        prompt: {
            expression: '',
            action: ''
        },
        createdAt: Date.now()
    };

    project.situations = [
        ...getProjectItems(project, 'situations'),
        situation
    ];
    project.situationsLoaded = true;
    await saveProjectSituations(project);
    await saveProjectAlias(getSituationImageKey(project, situation), getSituationDisplayName(situation));
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
                    <button type="button" onclick="window.openProjectItemCreateModal('character')" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition" title="캐릭터 추가" aria-label="캐릭터 추가">
                        <i data-lucide="plus" class="w-5 h-5"></i>
                    </button>
                </div>
                ${state.loading ? renderEmptyState('캐릭터를 불러오는 중입니다.') : ''}
                ${state.error ? renderEmptyState(state.error) : ''}
                ${!state.loading && !state.error && characters.length ? `
                    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                        ${characters.map(character => `
                            <button type="button" onclick="window.openCharacterDetail('${escapeJsString(project.id)}', '${escapeJsString(character.id)}')" class="aspect-[4/5] text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden flex flex-col hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition">
                                <div class="flex-1 min-h-0 bg-gray-100 dark:bg-gray-900/50 relative">
                                    <img src="${escapeHtml(getAssetUrl(character.coverImage))}" alt="${escapeHtml(character.name)}" class="absolute inset-0 w-full h-full object-cover" onerror="this.classList.add('hidden'); this.nextElementSibling.classList.remove('hidden');">
                                    <div class="hidden absolute inset-0 flex items-center justify-center text-gray-300 dark:text-gray-600">
                                        <i data-lucide="image-off" class="w-8 h-8"></i>
                                    </div>
                                </div>
                                <div class="p-3 border-t border-gray-100 dark:border-gray-700 min-h-[58px]">
                                    ${renderCharacterName(character)}
                                </div>
                            </button>
                        `).join('')}
                    </div>
                ` : ''}
                ${!state.loading && !state.error && !characters.length ? renderEmptyState('등록된 캐릭터가 없습니다.') : ''}
            </section>
        </div>
        ${renderProjectItemCreateModal()}
    `);
}

function renderSituationSection(section, state = {}) {
    const project = getActiveProject();
    const situations = getProjectItems(project, 'situations');

    renderProjectShell(`
        ${renderSectionHeader(section.title)}
        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <section class="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6 min-h-full">
                <div class="min-h-[360px]">
                    <div class="flex items-center justify-between mb-4">
                        <h3 class="font-bold text-base text-gray-900 dark:text-white">상황 목록</h3>
                        <button type="button" onclick="window.openProjectItemCreateModal('situation')" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition" title="상황 추가" aria-label="상황 추가">
                            <i data-lucide="plus" class="w-5 h-5"></i>
                        </button>
                    </div>
                    ${state.loading ? renderEmptyState('상황을 불러오는 중입니다.') : ''}
                    ${state.error ? renderEmptyState(state.error) : ''}
                    ${!state.loading && !state.error && situations.length ? `
                        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 gap-3 sm:gap-4">
                            ${situations.map(situation => `
                                <button type="button" onclick="window.openSituationDetail('${escapeJsString(project.id)}', '${escapeJsString(situation.id)}')" class="aspect-square text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 flex flex-col justify-between hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition">
                                    <span class="text-[11px] font-bold text-gray-400 dark:text-gray-500">${escapeHtml(getSituationImageNumber(project, situation))}.webp</span>
                                    <span class="text-xs font-bold text-gray-700 dark:text-gray-200 truncate">${escapeHtml(getSituationDisplayName(situation))}</span>
                                </button>
                            `).join('')}
                        </div>
                    ` : ''}
                    ${!state.loading && !state.error && !situations.length ? renderEmptyState('등록된 상황이 없습니다.') : ''}
                </div>

                <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 min-h-[360px] flex flex-col">
                    <h3 class="font-bold text-sm text-gray-900 dark:text-white mb-4">액션 생성 플래너</h3>
                    <div class="flex-1 flex items-start justify-center pt-10 text-sm font-bold text-gray-500 dark:text-gray-400 text-center">
                        기능 및 상세 레이아웃은 추후 구현
                    </div>
                </div>
            </section>
        </div>
        ${renderProjectItemCreateModal()}
    `);
}

function getSituationById(project, situationId) {
    const decodedId = decodeURIComponent(situationId || '');
    return getProjectItems(project, 'situations').find(situation =>
        situation.id === decodedId ||
        situation.folderName === decodedId
    );
}

function getSituationPrompt(situation) {
    return {
        expression: situation?.prompt?.expression || '',
        action: situation?.prompt?.action || ''
    };
}

function getSituationCharacterRows(project, situation) {
    const imageIndex = getSituationImageNumber(project, situation) - 1;
    return getProjectItems(project, 'characters').map(character => {
        const files = Array.isArray(character.files) ? character.files : [];
        const image = findSituationImage(files, situation, imageIndex);
        return {
            character,
            image,
            imageUrl: image ? `${getAssetUrl(image.key)}?t=${image.uploaded ? new Date(image.uploaded).getTime() : Date.now()}` : ''
        };
    });
}

function renderSituationCharacterProgress(project, situation, state = {}) {
    if (state.loading) return renderEmptyState('캐릭터별 이미지 공정률을 불러오는 중입니다.');
    if (state.error) return renderEmptyState(state.error);

    const rows = getSituationCharacterRows(project, situation);
    if (!rows.length) return renderEmptyState('등록된 캐릭터가 없습니다. 캐릭터를 먼저 추가하면 공정률을 표시할 수 있습니다.');

    const complete = rows.filter(row => row.image).length;
    const total = rows.length;
    const percent = total ? Math.round((complete / total) * 100) : 0;

    return `
        <div class="space-y-3">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <h3 class="text-sm font-bold text-gray-900 dark:text-white">캐릭터별 공정률</h3>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">${complete}/${total} 완료</p>
                </div>
                <span class="text-2xl font-bold text-indigo-600 dark:text-indigo-400">${percent}%</span>
            </div>
            <div class="h-2.5 rounded-full bg-gray-100 dark:bg-gray-900 overflow-hidden">
                <div class="h-full bg-indigo-600 dark:bg-indigo-500 rounded-full transition-all" style="width: ${percent}%"></div>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                ${rows.map(row => `
                    <div class="bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-700 rounded-lg p-2.5 flex items-center gap-3 min-w-0">
                        <div class="w-12 h-12 flex-shrink-0 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-900/60 flex items-center justify-center">
                            ${row.image ? `
                                <img src="${escapeHtml(row.imageUrl)}" alt="${escapeHtml(row.character.name)}" class="w-full h-full object-cover" loading="lazy">
                            ` : `
                                <i data-lucide="image-plus" class="w-5 h-5 text-gray-300 dark:text-gray-600"></i>
                            `}
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center justify-between gap-2">
                                <span class="text-xs font-bold text-gray-900 dark:text-white truncate">${escapeHtml(row.character.name || row.character.folderName)}</span>
                                ${renderCharacterStatusBadge(!!row.image)}
                            </div>
                            <p class="mt-1 text-[10px] text-gray-400 dark:text-gray-500 truncate">${row.image ? escapeHtml(getFileNameFromKey(row.image.key)) : `${escapeHtml(getSituationImageNumber(project, situation))}.webp 미생성`}</p>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderSituationDetailShell(project, situation, state = {}) {
    const prompt = getSituationPrompt(situation);
    const imageNumber = getSituationImageNumber(project, situation);

    renderProjectShell(`
        <div class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 sm:px-6 bg-white dark:bg-gray-800 flex-shrink-0 gap-3">
            <div class="flex items-center gap-2 min-w-0">
                <button type="button" onclick="window.openProjectSection('situation', false)" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="상황 목록" aria-label="상황 목록">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <div class="min-w-0">
                    <h1 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">${escapeHtml(getSituationDisplayName(situation))}</h1>
                    <p class="text-[11px] text-gray-500 dark:text-gray-400 truncate">${escapeHtml(project.name)} / 상황 상세 / ${escapeHtml(imageNumber)}.webp</p>
                </div>
            </div>
            <div class="relative flex-shrink-0">
                <button type="button" onclick="window.toggleSituationActionMenu(event)" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="더보기" aria-label="더보기">
                    <i data-lucide="more-vertical" class="w-5 h-5"></i>
                </button>
                <div id="situation-action-menu" class="hidden absolute right-0 top-10 z-20 w-40 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden py-1">
                    <button type="button" onclick="window.renameActiveSituation()" class="w-full px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">상황 이름 변경</button>
                    <button type="button" onclick="window.deleteActiveSituation()" class="w-full px-3 py-2 text-left text-xs font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition">상황 삭제</button>
                </div>
            </div>
        </div>

        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <section class="max-w-7xl mx-auto min-h-full">
                <form id="situation-prompt-form" onsubmit="window.saveActiveSituationPrompt(event)" class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div>
                            <label for="situation-expression-input" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">표정</label>
                            <textarea id="situation-expression-input" class="w-full min-h-[140px] resize-y p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-sm leading-6 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="상황에 필요한 표정 프롬프트">${escapeHtml(prompt.expression)}</textarea>
                        </div>
                        <div>
                            <label for="situation-action-input" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">행위</label>
                            <textarea id="situation-action-input" class="w-full min-h-[140px] resize-y p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-sm leading-6 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="상황에 필요한 행위 프롬프트">${escapeHtml(prompt.action)}</textarea>
                        </div>
                    </div>
                    <div class="mt-3 flex items-center justify-end gap-3">
                        <p id="situation-prompt-save-status" class="min-h-4 text-[11px] text-gray-400 dark:text-gray-500"></p>
                        <button id="situation-prompt-save-btn" type="submit" class="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 transition">
                            <i data-lucide="save" class="w-4 h-4"></i>
                            저장
                        </button>
                    </div>
                </form>

                <div class="mt-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 min-h-[280px]">
                    ${renderSituationCharacterProgress(project, situation, state)}
                </div>
            </section>
        </div>
    `);
}

export async function openSituationDetail(projectId = window.PROJECT_ACTIVE_PROJECT_ID, situationId = '', skipHistory = false) {
    if (!Array.isArray(window.PROJECTS)) {
        await loadProjects().catch(() => []);
    }

    const project = getProjectById(projectId);
    if (!project) {
        renderProjectManage(skipHistory);
        return;
    }

    await Promise.all([
        loadProjectCharacters(project).catch(() => []),
        loadProjectSituations(project).catch(() => [])
    ]);

    const situation = getSituationById(project, situationId);
    if (!situation) {
        await openProjectSection('situation', skipHistory);
        return;
    }

    window.PROJECT_VIEW = 'situation-detail';
    window.PROJECT_ACTIVE_PROJECT_ID = project.id;
    window.PROJECT_ACTIVE_SECTION = 'situation';
    window.PROJECT_ACTIVE_SITUATION_ID = situation.id;

    renderSituationDetailShell(project, situation, { loading: getProjectItems(project, 'characters').some(character => !character.filesLoaded) });

    try {
        await Promise.all(getProjectItems(project, 'characters').map(character => loadCharacterFiles(character).catch(() => [])));
        if (window.PROJECT_VIEW === 'situation-detail' && window.PROJECT_ACTIVE_SITUATION_ID === situation.id) {
            renderSituationDetailShell(project, situation);
        }
    } catch (err) {
        if (window.PROJECT_VIEW === 'situation-detail' && window.PROJECT_ACTIVE_SITUATION_ID === situation.id) {
            renderSituationDetailShell(project, situation, { error: err.message });
        }
    }

    if (!skipHistory) {
        setProjectRoute(
            { projectView: 'situation-detail', projectId: project.id, situationId: situation.id },
            `#project/${project.id}/situation/${encodeURIComponent(situation.id)}`
        );
    }
}

export function toggleSituationActionMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('situation-action-menu');
    if (!menu) return;

    menu.classList.toggle('hidden');
}

function closeSituationActionMenu() {
    document.getElementById('situation-action-menu')?.classList.add('hidden');
}

export async function renameActiveSituation() {
    closeSituationActionMenu();

    const project = getActiveProject();
    const situation = getSituationById(project, window.PROJECT_ACTIVE_SITUATION_ID);
    if (!project || !situation) return;

    const nextName = prompt('상황 이름을 입력하세요.', getSituationDisplayName(situation));
    if (nextName === null) return;

    const name = nextName.trim();
    if (!name) {
        alert('상황 이름을 입력하세요.');
        return;
    }

    situation.name = name;
    situation.alias = name;

    try {
        await saveProjectSituations(project);
        await saveProjectAlias(getSituationImageKey(project, situation), name);
        renderSituationDetailShell(project, situation);
    } catch (err) {
        alert(err.message || '상황 이름 변경에 실패했습니다.');
    }
}

export async function deleteActiveSituation() {
    closeSituationActionMenu();

    const project = getActiveProject();
    const situation = getSituationById(project, window.PROJECT_ACTIVE_SITUATION_ID);
    if (!project || !situation) return;

    if (!confirm(`'${getSituationDisplayName(situation)}' 상황을 삭제하시겠습니까?\n이미 생성된 이미지는 삭제하지 않습니다.`)) return;

    try {
        const imageKey = getSituationImageKey(project, situation);
        project.situations = getProjectItems(project, 'situations').filter(item => item.id !== situation.id);
        project.situationsLoaded = true;
        await saveProjectSituations(project);
        await saveProjectAlias(imageKey, '');
        await openProjectSection('situation', true);
        history.replaceState(
            { tab: 'project', projectView: 'section', projectId: project.id, projectSection: 'situation' },
            '',
            `#project/${project.id}/situation`
        );
    } catch (err) {
        alert(err.message || '상황 삭제에 실패했습니다.');
    }
}

export async function saveActiveSituationPrompt(event) {
    if (event) event.preventDefault();

    const project = getActiveProject();
    const situation = getSituationById(project, window.PROJECT_ACTIVE_SITUATION_ID);
    const expressionInput = document.getElementById('situation-expression-input');
    const actionInput = document.getElementById('situation-action-input');
    const button = document.getElementById('situation-prompt-save-btn');
    const status = document.getElementById('situation-prompt-save-status');
    if (!project || !situation || !expressionInput || !actionInput) return;

    const previousButtonHtml = button?.innerHTML || '';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> 저장 중';
        refreshProjectIcons();
    }
    if (status) status.textContent = '';

    try {
        situation.prompt = {
            expression: expressionInput.value.trim(),
            action: actionInput.value.trim()
        };
        situation.updatedAt = Date.now();
        await saveProjectSituations(project);
        if (status) status.textContent = '저장되었습니다.';
    } catch (err) {
        if (status) status.textContent = err.message || '저장에 실패했습니다.';
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = previousButtonHtml;
            refreshProjectIcons();
        }
    }
}

export async function restoreProjectState(state = {}) {
    if (state.projectView === 'section' && state.projectSection) {
        window.PROJECT_ACTIVE_PROJECT_ID = state.projectId || getDefaultProjectId();
        await openProjectSection(state.projectSection, true);
    } else if (state.projectView === 'character-detail') {
        await openCharacterDetail(state.projectId || getDefaultProjectId(), state.characterId || '', true);
    } else if (state.projectView === 'situation-detail') {
        await openSituationDetail(state.projectId || getDefaultProjectId(), state.situationId || '', true);
    } else if (state.projectView === 'detail') {
        await openProjectDetail(state.projectId || getDefaultProjectId(), true);
    } else {
        await renderProjectManage(true);
    }
}
