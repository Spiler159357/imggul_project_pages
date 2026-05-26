const EXCLUDED_PROJECT_FOLDERS = new Set(['logs', '_temp_craft', '_planner_temp_image']);

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

function rememberProjectRoute(state, hash) {
    window.PROJECT_LAST_STATE = { tab: 'project', ...state };
    window.PROJECT_LAST_HASH = hash || '#project';
}

function setProjectRoute(state, hash) {
    rememberProjectRoute(state, hash);
    history.pushState(window.PROJECT_LAST_STATE, '', window.PROJECT_LAST_HASH);
}

function replaceProjectRoute(state, hash) {
    rememberProjectRoute(state, hash);
    history.replaceState(window.PROJECT_LAST_STATE, '', window.PROJECT_LAST_HASH);
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

function getProjectByPrefix(projectPrefix) {
    const decodedPrefix = decodeURIComponent(projectPrefix || '');
    return getProjects().find(project => project.prefix === decodedPrefix);
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

function getPlannerPrefix(project) {
    return `${project.prefix}_planner_temp_image/`;
}

function getPlannerMetaKey(project) {
    return `${getPlannerPrefix(project)}_planner_meta.json`;
}

function getPlannerSettingsKey(project) {
    return `${getPlannerPrefix(project)}_planner_settings.json`;
}

const DEFAULT_PLANNER_SETTINGS = {
    model: 'nai-diffusion-4-5-full',
    steps: '28',
    scale: '5.0',
    sampler: 'k_euler_ancestral',
    sm: false,
    sm_dyn: false,
    vibeStrength: '0.6',
    vibeInfo: '1.0',
    preciseStrength: '1.0',
    preciseFidelity: '0.5',
    preciseType: 'character&style',
    vibeImageKey: '',
    preciseImageKey: ''
};

const PLANNER_MODEL_OPTIONS = [
    ['nai-diffusion-4-5-full', 'NAI Diffusion Anime V4.5 (Full)'],
    ['nai-diffusion-4-5-curated', 'NAI Diffusion Anime V4.5 (Curated)'],
    ['nai-diffusion-4-full', 'NAI Diffusion Anime V4.0 (Full)'],
    ['nai-diffusion-4-curated-preview', 'NAI Diffusion Anime V4.0 (Curated Preview)'],
    ['nai-diffusion-3', 'NAI Diffusion Anime V3'],
    ['nai-diffusion-furry-3', 'NAI Diffusion Furry V3']
];

const PLANNER_RESOLUTION_OPTIONS = [
    ['832x1216', '세로형 832x1216'],
    ['1024x1024', '정방형 1024x1024'],
    ['1216x832', '가로형 1216x832']
];

const PLANNER_SAMPLER_OPTIONS = [
    ['k_euler_ancestral', 'Euler Ancestral'],
    ['k_euler', 'Euler'],
    ['k_dpmpp_2s_ancestral', 'DPM++ 2S Ancestral'],
    ['k_dpmpp_2m', 'DPM++ 2M'],
    ['k_dpmpp_sde', 'DPM++ SDE']
];

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
            imageNumber: Number.isFinite(Number(situation?.imageNumber)) ? Number(situation.imageNumber) : index,
            prompt: {
                composition: situation?.prompt?.composition || situation?.composition || '',
                expression: situation?.prompt?.expression || situation?.expression || '',
                action: situation?.prompt?.action || situation?.action || '',
                background: situation?.prompt?.background || situation?.background || '',
                negative: situation?.prompt?.negative || situation?.negative || ''
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
    const imageNumber = Number(situation?.imageNumber);
    return Number.isFinite(imageNumber) ? imageNumber : (index >= 0 ? index : situations.length);
}

function getSituationImageKey(project, situation) {
    return `${project.prefix}${getSituationImageNumber(project, situation)}.webp`;
}

function getNextSituationImageNumber(project) {
    const usedNumbers = getProjectItems(project, 'situations')
        .map(situation => Number(situation.imageNumber))
        .filter(number => Number.isFinite(number));
    return usedNumbers.length ? Math.max(...usedNumbers) + 1 : getProjectItems(project, 'situations').length;
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

async function loadProjectPromptMarkdown(project) {
    if (!project?.prefix) return '';

    const key = `${project.prefix}prompt.md`;
    const res = await fetch(`${getAssetUrl(key)}?_t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) return '';
    if (!res.ok) throw new Error('prompt.md를 불러오지 못했습니다.');

    return await res.text();
}

async function loadProjectStylePrompt(project) {
    if (!project?.prefix) return '';

    const key = `${project.prefix}style_prompt.md`;
    const res = await fetch(`${getAssetUrl(key)}?_t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) return '';
    if (!res.ok) throw new Error('그림체 프롬프트를 불러오지 못했습니다.');

    return await res.text();
}

function renderInlineMarkdown(value) {
    return escapeHtml(value)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function renderMarkdownPreview(markdown) {
    const lines = String(markdown || '').split(/\r?\n/);
    const html = [];
    let listOpen = false;

    const closeList = () => {
        if (listOpen) {
            html.push('</ul>');
            listOpen = false;
        }
    };

    lines.forEach(line => {
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        const listItem = line.match(/^\s*[-*]\s+(.+)$/);

        if (heading) {
            closeList();
            const level = heading[1].length;
            html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
            return;
        }

        if (listItem) {
            if (!listOpen) {
                html.push('<ul>');
                listOpen = true;
            }
            html.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`);
            return;
        }

        closeList();
        html.push(line.trim() ? `<p>${renderInlineMarkdown(line)}</p>` : '<br>');
    });

    closeList();
    return html.join('');
}

function syncProjectPromptPreview() {
    const input = document.getElementById('project-prompt-input');
    const preview = document.getElementById('project-prompt-preview');
    if (!input || !preview) return;

    preview.innerHTML = renderMarkdownPreview(input.value);
}

async function hydrateProjectPromptInput() {
    const project = getActiveProject();
    const input = document.getElementById('project-prompt-input');
    const status = document.getElementById('project-prompt-load-status');
    if (!project || !input) return;

    if (status) status.textContent = 'prompt.md를 불러오는 중입니다.';

    try {
        input.value = await loadProjectPromptMarkdown(project);
        input.dispatchEvent(new Event('input'));
        syncProjectPromptPreview();
        if (status) status.textContent = input.value ? 'prompt.md를 불러왔습니다.' : '';
    } catch (err) {
        if (status) status.textContent = err.message || 'prompt.md를 불러오지 못했습니다.';
    }
}

async function hydrateProjectStylePromptInput() {
    const project = getActiveProject();
    const input = document.getElementById('project-style-prompt-input');
    const status = document.getElementById('project-style-prompt-status');
    if (!project || !input) return;

    if (status) status.textContent = '그림체 프롬프트를 불러오는 중입니다.';

    try {
        input.value = await loadProjectStylePrompt(project);
        if (status) status.textContent = input.value ? 'style_prompt.md를 불러왔습니다.' : '';
    } catch (err) {
        if (status) status.textContent = err.message || '그림체 프롬프트를 불러오지 못했습니다.';
    }
}

function initProjectPromptMarkdownToggle() {
    const input = document.getElementById('project-prompt-input');
    const preview = document.getElementById('project-prompt-preview');
    const toggle = document.getElementById('project-prompt-preview-toggle');
    if (!input || !preview || !toggle) return;

    const setPreviewMode = (enabled) => {
        input.classList.toggle('hidden', enabled);
        preview.classList.toggle('hidden', !enabled);
        input.readOnly = enabled;
        toggle.setAttribute('aria-pressed', String(enabled));
        toggle.classList.toggle('bg-indigo-600', enabled);
        toggle.classList.toggle('text-white', enabled);
        toggle.classList.toggle('border-indigo-600', enabled);
        toggle.classList.toggle('border-gray-200', !enabled);
        toggle.classList.toggle('dark:border-gray-700', !enabled);
        toggle.classList.toggle('text-gray-600', !enabled);
        toggle.classList.toggle('dark:text-gray-300', !enabled);
        if (enabled) syncProjectPromptPreview();
    };

    input.addEventListener('input', syncProjectPromptPreview);
    toggle.addEventListener('click', () => {
        setPreviewMode(toggle.getAttribute('aria-pressed') !== 'true');
    });
    setPreviewMode(false);
}

async function uploadProjectPromptMarkdown(project, content) {
    if (!project?.prefix) throw new Error('프로젝트 경로를 찾을 수 없습니다.');

    const key = `${project.prefix}prompt.md`;
    const res = await fetch('/api/upload?_t=' + Date.now(), {
        method: 'PUT',
        headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'X-File-Name': encodeURIComponent('prompt.md'),
            'X-Absolute-Path': encodeURIComponent(key)
        },
        body: new Blob([content], { type: 'text/markdown; charset=utf-8' }),
        cache: 'no-store'
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '프롬프트 저장에 실패했습니다.');
    }

    return key;
}

async function uploadProjectStylePrompt(project, content) {
    if (!project?.prefix) throw new Error('프로젝트 경로를 찾을 수 없습니다.');

    const key = `${project.prefix}style_prompt.md`;
    const res = await fetch('/api/upload?_t=' + Date.now(), {
        method: 'PUT',
        headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'X-File-Name': encodeURIComponent('style_prompt.md'),
            'X-Absolute-Path': encodeURIComponent(key)
        },
        body: new Blob([content], { type: 'text/markdown; charset=utf-8' }),
        cache: 'no-store'
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '그림체 프롬프트 저장에 실패했습니다.');
    }

    return key;
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

    const routeState = { projectView: 'manage' };
    if (!skipHistory) setProjectRoute(routeState, '#project');
    else rememberProjectRoute(routeState, '#project');
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

    const routeState = { projectView: 'detail', projectId: project.id };
    const routeHash = `#project/${project.id}`;
    if (!skipHistory) setProjectRoute(routeState, routeHash);
    else rememberProjectRoute(routeState, routeHash);
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
        replaceProjectRoute({ projectView: 'detail', projectId: folderName }, `#project/${folderName}`);
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
        replaceProjectRoute({ projectView: 'manage' }, '#project');
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
        await Promise.all([
            loadProjectSituations(project),
            loadProjectCharacters(project),
            loadPlannerSettings(project).catch(() => normalizePlannerSettings()),
            loadPlannerMeta(project).then(meta => { window.PROJECT_PLANNER_META = meta; })
        ]).catch(err => {
            if (window.PROJECT_ACTIVE_SECTION === 'situation') renderSituationSection(section, { error: err.message });
        });
        if (window.PROJECT_ACTIVE_SECTION === 'situation') renderSituationSection(section);
    }

    const routeState = { projectView: 'section', projectId: window.PROJECT_ACTIVE_PROJECT_ID, projectSection: section.key };
    const routeHash = `#project/${window.PROJECT_ACTIVE_PROJECT_ID}/${section.key}`;
    if (!skipHistory) setProjectRoute(routeState, routeHash);
    else rememberProjectRoute(routeState, routeHash);
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
                    <div class="flex items-start justify-between gap-3 mb-3">
                        <div>
                            <h3 class="font-bold text-sm text-gray-900 dark:text-white">입력 공간</h3>
                            <p id="project-prompt-load-status" class="mt-1 min-h-4 text-[11px] text-gray-400 dark:text-gray-500"></p>
                        </div>
                        <button id="project-prompt-preview-toggle" type="button" class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 transition" aria-pressed="false">
                            <i data-lucide="eye" class="w-4 h-4"></i>
                            <span>마크다운 보기</span>
                        </button>
                    </div>
                    <textarea id="project-prompt-input" class="flex-1 resize-none outline-none bg-transparent text-sm leading-6 text-gray-700 dark:text-gray-200" aria-label="프롬프트 입력"></textarea>
                    <div id="project-prompt-preview" class="hidden flex-1 overflow-y-auto text-sm leading-6 text-gray-700 dark:text-gray-200 prose-like" aria-label="마크다운 미리보기"></div>
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
                    <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex-1 min-h-[180px] flex flex-col">
                        <div>
                            <p class="font-bold text-sm text-gray-900 dark:text-white">추가 기능을 위한 공간</p>
                            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">기능 추가 가능성 높음</p>
                        </div>
                        <label class="mt-4 block flex-1 min-h-[120px]">
                            <span class="block mb-1 text-xs font-bold text-gray-700 dark:text-gray-300">그림체 프롬프트</span>
                            <textarea id="project-style-prompt-input" class="w-full min-h-[120px] resize-y p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="플래너의 그림체 항목으로 가져올 프롬프트"></textarea>
                        </label>
                        <div class="mt-3 flex items-center justify-end gap-3">
                            <p id="project-style-prompt-status" class="min-h-4 text-[11px] text-gray-400 dark:text-gray-500"></p>
                            <button id="project-style-prompt-save-btn" type="button" onclick="window.saveProjectStylePrompt()" class="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-xs font-bold hover:border-indigo-400 transition">
                                <i data-lucide="save" class="w-4 h-4"></i>
                                <span>그림체 저장</span>
                            </button>
                        </div>
                        <div class="mt-auto pt-4 flex items-center justify-end gap-3">
                            <p id="project-prompt-save-status" class="min-h-4 text-[11px] text-gray-400 dark:text-gray-500"></p>
                            <button id="project-prompt-save-btn" type="button" onclick="window.saveProjectPromptMarkdown()" class="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 transition">
                                <i data-lucide="save" class="w-4 h-4"></i>
                                <span>저장</span>
                            </button>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    `);
    initPromptSectionInput();
    initProjectPromptMarkdownToggle();
    hydrateProjectPromptInput();
    hydrateProjectStylePromptInput();
}

export async function saveProjectPromptMarkdown() {
    const project = getActiveProject();
    const input = document.getElementById('project-prompt-input');
    const button = document.getElementById('project-prompt-save-btn');
    const status = document.getElementById('project-prompt-save-status');
    if (!project || !input) return;

    const previousButtonHtml = button?.innerHTML || '';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>저장 중</span>';
        refreshProjectIcons();
    }
    if (status) status.textContent = '';

    try {
        await uploadProjectPromptMarkdown(project, input.value);
        if (status) status.textContent = 'prompt.md로 저장되었습니다.';
        if (window.currentPrefix === project.prefix && window.loadPath) window.loadPath(project.prefix, true);
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

export async function saveProjectStylePrompt() {
    const project = getActiveProject();
    const input = document.getElementById('project-style-prompt-input');
    const button = document.getElementById('project-style-prompt-save-btn');
    const status = document.getElementById('project-style-prompt-status');
    if (!project || !input) return;

    const previousButtonHtml = button?.innerHTML || '';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>저장 중</span>';
        refreshProjectIcons();
    }
    if (status) status.textContent = '';

    try {
        await uploadProjectStylePrompt(project, input.value);
        if (status) status.textContent = 'style_prompt.md로 저장되었습니다.';
        if (window.currentPrefix === project.prefix && window.loadPath) window.loadPath(project.prefix, true);
    } catch (err) {
        if (status) status.textContent = err.message || '그림체 프롬프트 저장에 실패했습니다.';
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = previousButtonHtml;
            refreshProjectIcons();
        }
    }
}

function getSituationImageCandidates(situation, index) {
    const imageNumber = Number(situation?.imageNumber);
    const values = [String(Number.isFinite(imageNumber) ? imageNumber : index)];

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
    const promptParts = meta.parts || {};
    const characterPrompt = promptParts.character || meta.prompt || '';
    const clothingPrompt = promptParts.clothing || '';
    const expressionPrompt = promptParts.expression || '';
    const negativePrompt = promptParts.negative || '';

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
                            <div class="flex-1 grid grid-cols-1 gap-3">
                                <label class="block">
                                    <span class="block mb-1 text-xs font-bold text-gray-700 dark:text-gray-300">캐릭터</span>
                                    <textarea id="character-prompt-character-input" class="w-full min-h-[130px] resize-y p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-sm leading-6 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="외형, 얼굴, 신체 특징 등">${escapeHtml(characterPrompt)}</textarea>
                                </label>
                                <label class="block">
                                    <span class="block mb-1 text-xs font-bold text-gray-700 dark:text-gray-300">의상</span>
                                    <textarea id="character-prompt-clothing-input" class="w-full min-h-[100px] resize-y p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-sm leading-6 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="기본 의상, 장신구, 소품 등">${escapeHtml(clothingPrompt)}</textarea>
                                </label>
                                <label class="block">
                                    <span class="block mb-1 text-xs font-bold text-gray-700 dark:text-gray-300">표정</span>
                                    <textarea id="character-prompt-expression-input" class="w-full min-h-[80px] resize-y p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-sm leading-6 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="이 캐릭터의 기본 표정, 눈매, 분위기 등">${escapeHtml(expressionPrompt)}</textarea>
                                </label>
                                <label class="block">
                                    <span class="block mb-1 text-xs font-bold text-gray-700 dark:text-gray-300">부정 프롬프트</span>
                                    <textarea id="character-prompt-negative-input" class="w-full min-h-[80px] resize-y p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-900/10 text-sm leading-6 text-red-700 dark:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="이 캐릭터에 반복 적용할 제외 태그">${escapeHtml(negativePrompt)}</textarea>
                                </label>
                            </div>
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

    const routeState = { projectView: 'character-detail', projectId: project.id, characterId: character.id };
    const routeHash = `#project/${project.id}/character/${encodeURIComponent(character.folderName)}`;
    if (!skipHistory) setProjectRoute(routeState, routeHash);
    else rememberProjectRoute(routeState, routeHash);
}

export async function saveCharacterPrompt(event) {
    if (event) event.preventDefault();

    const project = getActiveProject();
    const character = getCharacterById(project, window.PROJECT_ACTIVE_CHARACTER_ID);
    const characterInput = document.getElementById('character-prompt-character-input');
    const clothingInput = document.getElementById('character-prompt-clothing-input');
    const expressionInput = document.getElementById('character-prompt-expression-input');
    const negativeInput = document.getElementById('character-prompt-negative-input');
    const button = document.getElementById('character-prompt-save-btn');
    const status = document.getElementById('character-prompt-save-status');
    if (!project || !character || !characterInput || !clothingInput || !expressionInput || !negativeInput) return;

    const previousButtonHtml = button?.innerHTML || '';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> 저장 중';
        refreshProjectIcons();
    }
    if (status) status.textContent = '';

    try {
        const meta = await loadCharacterMeta(character).catch(() => ({}));
        const parts = {
            ...(meta.parts || {}),
            character: characterInput.value.trim(),
            clothing: clothingInput.value.trim(),
            expression: expressionInput.value.trim(),
            negative: negativeInput.value.trim()
        };
        await saveCharacterMeta(character, {
            ...meta,
            prompt: parts.character,
            parts,
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
    const projectStyle = await loadProjectStylePrompt(project).catch(() => '');
    const situationPrompt = getSituationPrompt(selectedSituation);
    const characterParts = meta.parts || {};
    const combinedNegativePrompt = combinePromptParts(characterParts.negative, situationPrompt.negative);
    const promptValues = {
        'prompt-style': projectStyle,
        'prompt-composition': situationPrompt.composition || '',
        'prompt-character': characterParts.character || meta.prompt || '',
        'prompt-clothing': characterParts.clothing || '',
        'prompt-expression': combinePromptParts(characterParts.expression, situationPrompt.expression),
        'prompt-action': situationPrompt.action || '',
        'prompt-background': situationPrompt.background || ''
    };
    const resizePromptInput = (id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
    };

    window.switchTab('craft');

    const simpleToggle = document.getElementById('prompt-toggle-simple');
    if (simpleToggle) {
        simpleToggle.checked = false;
        if (window.togglePromptMode) window.togglePromptMode();
    }

    const rawPrompt = document.getElementById('prompt-raw');
    if (rawPrompt) {
        rawPrompt.value = '';
        resizePromptInput('prompt-raw');
    }

    Object.entries(promptValues).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = value || '';
        resizePromptInput(id);
    });

    const negativePrompt = document.getElementById('nai-negative');
    if (negativePrompt) {
        negativePrompt.value = combinedNegativePrompt;
        resizePromptInput('nai-negative');
    }

    if (window.refreshNaiPromptWeightPreviews) window.refreshNaiPromptWeightPreviews();
    if (window.saveCraftSettings) window.saveCraftSettings();

    if (window.updateCraftFolderList) await window.updateCraftFolderList();
    const projectSelect = document.getElementById('craft-project-select');
    if (projectSelect) {
        projectSelect.value = project.prefix;
        if (window.onCraftProjectChange) await window.onCraftProjectChange();
    }

    const characterSelect = document.getElementById('craft-char-select');
    if (characterSelect) characterSelect.value = character.prefix;

    const situationSelect = document.getElementById('craft-situation-select');
    if (situationSelect && selectedSituation) situationSelect.value = selectedSituation.id || selectedSituation.folderName || '';
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
        replaceProjectRoute(
            { projectView: 'character-detail', projectId: project.id, characterId: newPrefix },
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
        replaceProjectRoute(
            { projectView: 'section', projectId: project.id, projectSection: 'character' },
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
            composition: '',
            expression: '',
            action: '',
            background: '',
            negative: ''
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

async function loadPlannerMeta(project) {
    if (!project?.prefix) return null;
    const res = await fetch(`${getAssetUrl(getPlannerMetaKey(project))}?_t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('플래너 메타데이터를 불러오지 못했습니다.');
    return await res.json();
}

async function savePlannerMeta(project, meta) {
    const key = getPlannerMetaKey(project);
    const res = await fetch('/api/upload?_t=' + Date.now(), {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-File-Name': encodeURIComponent('_planner_meta.json'),
            'X-Absolute-Path': encodeURIComponent(key)
        },
        body: new Blob([JSON.stringify(meta || {}, null, 2)], { type: 'application/json; charset=utf-8' }),
        cache: 'no-store'
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '플래너 메타데이터 저장에 실패했습니다.');
    }
}

function getPlannerImagePrefix(project, imageNumber) {
    return `${getPlannerPrefix(project)}${imageNumber}/`;
}

function normalizePlannerSettings(settings = {}) {
    return {
        model: settings.model || DEFAULT_PLANNER_SETTINGS.model,
        steps: String(settings.steps || DEFAULT_PLANNER_SETTINGS.steps),
        scale: String(settings.scale || DEFAULT_PLANNER_SETTINGS.scale),
        sampler: settings.sampler || DEFAULT_PLANNER_SETTINGS.sampler,
        sm: !!settings.sm,
        sm_dyn: !!settings.sm_dyn,
        vibeStrength: String(settings.vibeStrength || DEFAULT_PLANNER_SETTINGS.vibeStrength),
        vibeInfo: String(settings.vibeInfo || DEFAULT_PLANNER_SETTINGS.vibeInfo),
        preciseStrength: String(settings.preciseStrength || DEFAULT_PLANNER_SETTINGS.preciseStrength),
        preciseFidelity: String(settings.preciseFidelity || DEFAULT_PLANNER_SETTINGS.preciseFidelity),
        preciseType: settings.preciseType || DEFAULT_PLANNER_SETTINGS.preciseType,
        vibeImageKey: settings.vibeImageKey || '',
        preciseImageKey: settings.preciseImageKey || ''
    };
}

async function loadPlannerSettings(project, force = false) {
    if (!project?.prefix) return normalizePlannerSettings();
    if (!force && window.PROJECT_PLANNER_SETTINGS?.projectId === project.id) return window.PROJECT_PLANNER_SETTINGS;

    const res = await fetch(`${getAssetUrl(getPlannerSettingsKey(project))}?_t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) {
        window.PROJECT_PLANNER_SETTINGS = { projectId: project.id, ...normalizePlannerSettings() };
        return window.PROJECT_PLANNER_SETTINGS;
    }
    if (!res.ok) throw new Error('플래너 설정을 불러오지 못했습니다.');

    const settings = normalizePlannerSettings(await res.json());
    window.PROJECT_PLANNER_SETTINGS = { projectId: project.id, ...settings };
    return window.PROJECT_PLANNER_SETTINGS;
}

async function savePlannerSettings(project, settings) {
    const normalized = normalizePlannerSettings(settings);
    const key = getPlannerSettingsKey(project);
    const res = await fetch('/api/upload?_t=' + Date.now(), {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-File-Name': encodeURIComponent('_planner_settings.json'),
            'X-Absolute-Path': encodeURIComponent(key)
        },
        body: new Blob([JSON.stringify(normalized, null, 2)], { type: 'application/json; charset=utf-8' }),
        cache: 'no-store'
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '플래너 설정 저장에 실패했습니다.');
    }
    window.PROJECT_PLANNER_SETTINGS = { projectId: project.id, ...normalized };
    return window.PROJECT_PLANNER_SETTINGS;
}

function applyPlannerSettingsToGeneration(generation, settings) {
    const normalized = normalizePlannerSettings(settings);
    generation.model = normalized.model;
    generation.steps = normalized.steps;
    generation.scale = normalized.scale;
    generation.sampler = normalized.sampler;
    generation.sm = normalized.sm;
    generation.sm_dyn = normalized.sm_dyn;
    generation.vibeStrength = normalized.vibeStrength;
    generation.vibeInfo = normalized.vibeInfo;
    generation.preciseStrength = normalized.preciseStrength;
    generation.preciseFidelity = normalized.preciseFidelity;
    generation.preciseType = normalized.preciseType;
    generation.vibeImageKey = normalized.vibeImageKey;
    generation.preciseImageKey = normalized.preciseImageKey;
    return generation;
}

async function loadPlannerReferenceFile(key) {
    if (!key) return null;
    const res = await fetch(`${getAssetUrl(key)}?_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`참조 이미지를 불러오지 못했습니다: ${key}`);
    const blob = await res.blob();
    const fileName = getFileNameFromKey(key) || 'planner-reference.webp';
    return new File([blob], fileName, { type: blob.type || 'image/webp', lastModified: Date.now() });
}

async function applyPlannerReferenceFiles(generation) {
    window.VIBE_IMAGE_FILE = await loadPlannerReferenceFile(generation.vibeImageKey);
    window.PRECISE_IMAGE_FILE = await loadPlannerReferenceFile(generation.preciseImageKey);
}

function getPlannerField(item, key) {
    return item?.generation?.fields?.[key] || '';
}

function getPlannerStatusLabel(status) {
    const labels = {
        draft: '초안',
        queued: '대기 중',
        pending: '대기',
        running: '생성 중',
        paused: '중지됨',
        completed: '생성 완료',
        partial_failed: '일부 실패',
        cancel_requested: '취소 요청됨',
        cancelled: '취소됨',
        confirmed: '확정 완료',
        failed: '실패',
        done: '완료'
    };
    return labels[status] || status || '초안 없음';
}

function getPlannerStageLabel(stage) {
    const labels = {
        queued: '대기열 대기',
        running: '생성 준비',
        novelai_request: 'NovelAI 요청 중',
        novelai_response: 'NovelAI 응답 수신',
        zip_extract: '결과 압축 해제',
        webp_encode: 'WebP 변환',
        r2_put: 'R2 저장',
        metadata_put: '메타데이터 저장',
        rollup: '상태 갱신',
        completed: '완료',
        failed: '실패',
        cancelled: '취소됨'
    };
    return labels[stage] || stage || '';
}

function setPlannerStatus(message) {
    const el = document.getElementById('planner-status');
    if (el) el.textContent = message || '';
}

function isPlannerPanelVisible() {
    const projectContent = document.getElementById('main-project-content');
    return !!projectContent
        && !projectContent.classList.contains('hidden')
        && window.PROJECT_VIEW === 'section'
        && window.PROJECT_ACTIVE_SECTION === 'situation';
}

function renderPlannerIfVisible() {
    if (!isPlannerPanelVisible()) return false;
    renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
    return true;
}

function readPlannerEditsFromDom(meta) {
    if (!meta?.items) return meta;
    meta.items.forEach(item => {
        const fields = item.generation.fields;
        ['style', 'composition', 'character', 'clothing', 'expression', 'action', 'background', 'negative'].forEach(key => {
            const input = document.getElementById(`planner-${item.imageNumber}-${key}`);
            if (input) fields[key] = input.value.trim();
        });
        const countInput = document.getElementById(`planner-${item.imageNumber}-count`);
        if (countInput) item.count = Math.max(1, parseInt(countInput.value) || 1);
        const generationInputs = {
            res: document.getElementById(`planner-${item.imageNumber}-res`)?.value
        };
        Object.entries(generationInputs).forEach(([key, value]) => {
            if (value !== undefined) item.generation[key] = value;
        });
        item.generation.v4PromptCharacters = readPlannerV4PromptRows(item.imageNumber);
        item.generation.batchCount = String(item.count);
        item.generation.negative = fields.negative;
        item.generation.prompts = {
            ...item.generation.prompts,
            'prompt-style': fields.style,
            'prompt-composition': fields.composition,
            'prompt-character': fields.character,
            'prompt-clothing': fields.clothing,
            'prompt-expression': fields.expression,
            'prompt-action': fields.action,
            'prompt-background': fields.background,
            'prompt-raw': ''
        };
        applyPlannerSettingsToGeneration(item.generation, window.PROJECT_PLANNER_SETTINGS || DEFAULT_PLANNER_SETTINGS);
    });
    meta.updatedAt = Date.now();
    return meta;
}

async function listPlannerImages(project, imageNumber) {
    const prefix = getPlannerImagePrefix(project, imageNumber);
    const res = await fetch(`/api/list?prefix=${encodeURIComponent(prefix)}&_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.files || []).filter(file => /\.(png|webp|jpe?g)$/i.test(file.key || '')).map(file => file.key);
}

function renderPlannerField(item, key, label, rows = 2) {
    return `
        <label class="block min-w-0">
            <span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">${label}</span>
            <textarea id="planner-${escapeHtml(item.imageNumber)}-${key}" rows="${rows}" class="w-full resize-y p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500">${escapeHtml(getPlannerField(item, key))}</textarea>
        </label>
    `;
}

function renderPlannerSelect(id, label, value, options) {
    return `
        <label class="block min-w-0">
            <span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">${label}</span>
            <select id="${escapeHtml(id)}" class="w-full p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100">
                ${options.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${value === optionValue ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>`).join('')}
            </select>
        </label>
    `;
}

function renderPlannerNumberInput(id, label, value, attrs = '') {
    return `
        <label class="block min-w-0">
            <span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">${label}</span>
            <input id="${escapeHtml(id)}" value="${escapeHtml(value)}" ${attrs} class="w-full p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100">
        </label>
    `;
}

function renderPlannerCheckbox(id, label, checked) {
    return `
        <label class="inline-flex items-center gap-1.5 text-[10px] font-bold text-gray-600 dark:text-gray-300">
            <input id="${escapeHtml(id)}" type="checkbox" ${checked ? 'checked' : ''} class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
            ${label}
        </label>
    `;
}

function getPlannerV4PromptRows(item) {
    return Array.isArray(item?.generation?.v4PromptCharacters) ? item.generation.v4PromptCharacters : [];
}

function readPlannerV4PromptRows(imageNumber) {
    const container = document.getElementById(`planner-${imageNumber}-v4-rows`);
    if (!container) return [];
    return Array.from(container.querySelectorAll('[data-planner-v4-row]')).map(row => {
        const rowId = row.getAttribute('data-planner-v4-row');
        return {
            subject: document.getElementById(`planner-${imageNumber}-v4-${rowId}-subject`)?.value.trim() || '',
            clothing: document.getElementById(`planner-${imageNumber}-v4-${rowId}-clothing`)?.value.trim() || '',
            expression: document.getElementById(`planner-${imageNumber}-v4-${rowId}-expression`)?.value.trim() || '',
            action: document.getElementById(`planner-${imageNumber}-v4-${rowId}-action`)?.value.trim() || '',
            negative: document.getElementById(`planner-${imageNumber}-v4-${rowId}-negative`)?.value.trim() || ''
        };
    }).filter(row => [row.subject, row.clothing, row.expression, row.action, row.negative].some(Boolean));
}

function renderPlannerV4PromptRow(imageNumber, row, index) {
    const rowId = index;
    const inputClass = 'w-full p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100';
    return `
        <div data-planner-v4-row="${rowId}" class="rounded-md border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 p-2">
            <div class="flex items-center justify-between gap-2 mb-2">
                <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">V4 캐릭터 ${index + 1}</span>
                <button type="button" onclick="window.removePlannerV4Prompt('${escapeJsString(imageNumber)}', ${index})" class="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="V4 캐릭터 삭제">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input id="planner-${escapeHtml(imageNumber)}-v4-${rowId}-subject" value="${escapeHtml(row.subject || '')}" class="${inputClass}" placeholder="캐릭터">
                <input id="planner-${escapeHtml(imageNumber)}-v4-${rowId}-clothing" value="${escapeHtml(row.clothing || '')}" class="${inputClass}" placeholder="의상">
                <input id="planner-${escapeHtml(imageNumber)}-v4-${rowId}-expression" value="${escapeHtml(row.expression || '')}" class="${inputClass}" placeholder="표정">
                <input id="planner-${escapeHtml(imageNumber)}-v4-${rowId}-action" value="${escapeHtml(row.action || '')}" class="${inputClass}" placeholder="행위">
                <input id="planner-${escapeHtml(imageNumber)}-v4-${rowId}-negative" value="${escapeHtml(row.negative || '')}" class="${inputClass} md:col-span-2" placeholder="부정 프롬프트">
            </div>
        </div>
    `;
}

function renderPlannerV4PromptSection(item) {
    const rows = getPlannerV4PromptRows(item);
    return `
        <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <div class="flex items-center justify-between gap-2 mb-2">
                <div>
                    <p class="text-[10px] font-bold text-gray-500 dark:text-gray-400">V4 Prompt</p>
                    <p class="text-[10px] text-gray-400 dark:text-gray-500">필요할 때 캐릭터를 추가해 v4_prompt char_captions로 전달합니다.</p>
                </div>
                <button type="button" onclick="window.addPlannerV4Prompt('${escapeJsString(item.imageNumber)}')" class="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-[10px] font-bold text-gray-700 dark:text-gray-200 hover:border-indigo-400">
                    <i data-lucide="user-plus" class="w-3.5 h-3.5"></i> 캐릭터 추가
                </button>
            </div>
            <div id="planner-${escapeHtml(item.imageNumber)}-v4-rows" class="space-y-2">
                ${rows.map((row, index) => renderPlannerV4PromptRow(item.imageNumber, row, index)).join('')}
            </div>
        </div>
    `;
}

function renderPlannerReferencePicker(target, label, key) {
    const inputId = `planner-setting-${target}-key`;
    const fileId = `planner-setting-${target}-file`;
    return `
        <div>
            <span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">${label}</span>
            <div class="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-3"
                ondragover="event.preventDefault(); this.classList.add('border-indigo-400')"
                ondragleave="this.classList.remove('border-indigo-400')"
                ondrop="window.handlePlannerReferenceDrop(event, '${target}')">
                <input id="${fileId}" type="file" accept="image/*" class="hidden" onchange="window.handlePlannerReferenceFileInput(event, '${target}')">
                <div class="flex flex-col sm:flex-row sm:items-center gap-2">
                    <input id="${inputId}" value="${escapeHtml(key || '')}" class="flex-1 min-w-0 p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100" placeholder="이미지를 드롭하거나 선택하세요">
                    <button type="button" onclick="document.getElementById('${fileId}')?.click()" class="px-2.5 py-2 rounded-md border border-gray-200 dark:border-gray-700 text-[10px] font-bold text-gray-700 dark:text-gray-200 hover:border-indigo-400">업로드</button>
                    <button type="button" onclick="window.openPlannerReferenceLibrary('${target}')" class="px-2.5 py-2 rounded-md border border-gray-200 dark:border-gray-700 text-[10px] font-bold text-gray-700 dark:text-gray-200 hover:border-indigo-400">보관함</button>
                </div>
                <p class="mt-1 text-[10px] text-gray-400 dark:text-gray-500">로컬 이미지는 _planner_temp_image/references/에 저장됩니다.</p>
            </div>
        </div>
    `;
}

function renderPlannerGenerationFields(item) {
    const generation = item.generation || {};
    const id = `planner-${item.imageNumber}`;

    return `
        <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                ${renderPlannerSelect(`${id}-res`, '해상도', generation.res || '832x1216', PLANNER_RESOLUTION_OPTIONS)}
            </div>
        </div>
        ${renderPlannerV4PromptSection(item)}
    `;
}

function renderPlannerSettingsModal(settings) {
    return `
        <div id="planner-settings-modal" class="fixed inset-0 z-50 hidden bg-black/60 backdrop-blur-sm items-center justify-center p-4" onclick="window.closePlannerSettingsModal(event)">
            <div class="w-full max-w-2xl rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden" onclick="event.stopPropagation()">
                <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <h3 class="text-sm font-bold text-gray-900 dark:text-white">플래너 공통 설정</h3>
                    <button type="button" onclick="window.closePlannerSettingsModal()" class="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>
                <div class="p-4 space-y-3 max-h-[76vh] overflow-y-auto">
                    ${renderPlannerSelect('planner-setting-model', 'Model', settings.model, PLANNER_MODEL_OPTIONS)}
                    ${renderPlannerNumberInput('planner-setting-steps', 'Steps', settings.steps, 'type="number" min="1" max="50"')}
                    ${renderPlannerNumberInput('planner-setting-scale', 'CFG Scale', settings.scale, 'type="number" min="1" max="10" step="0.1"')}
                    ${renderPlannerSelect('planner-setting-sampler', 'Sampler', settings.sampler, PLANNER_SAMPLER_OPTIONS)}
                    <div class="flex flex-wrap gap-3">
                        ${renderPlannerCheckbox('planner-setting-sm', 'SMEA', settings.sm)}
                        ${renderPlannerCheckbox('planner-setting-sm-dyn', 'DYN', settings.sm_dyn)}
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        ${renderPlannerNumberInput('planner-setting-vibe-strength', 'Vibe Strength', settings.vibeStrength, 'type="number" min="0" max="1" step="0.1"')}
                        ${renderPlannerNumberInput('planner-setting-vibe-info', 'Vibe Info', settings.vibeInfo, 'type="number" min="0" max="1" step="0.1"')}
                        ${renderPlannerNumberInput('planner-setting-precise-strength', 'Reference Strength', settings.preciseStrength, 'type="number" min="0" max="1" step="0.1"')}
                        ${renderPlannerNumberInput('planner-setting-precise-fidelity', 'Reference Fidelity', settings.preciseFidelity, 'type="number" min="0" max="1" step="0.1"')}
                    </div>
                    ${renderPlannerSelect('planner-setting-precise-type', 'Reference 타입', settings.preciseType, [
                        ['character&style', '캐릭터+그림체'],
                        ['character', '캐릭터'],
                        ['style', '그림체']
                    ])}
                    ${renderPlannerReferencePicker('vibe', 'Vibe 이미지', settings.vibeImageKey)}
                    ${renderPlannerReferencePicker('precise', 'Reference 이미지', settings.preciseImageKey)}
                    <p id="planner-settings-status" class="min-h-4 text-[11px] text-gray-400 dark:text-gray-500"></p>
                </div>
                <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
                    <button type="button" onclick="window.closePlannerSettingsModal()" class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200">취소</button>
                    <button type="button" onclick="window.savePlannerSettingsFromModal()" class="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700">저장</button>
                </div>
            </div>
        </div>
    `;
}

// TODO(planner): 각 플랜별 결과 확인 전용 화면은 별도 레이아웃 검토 후 구현한다.

function renderPlannerImages(item) {
    if (!Array.isArray(item.images) || !item.images.length) {
        return '<div class="text-[11px] text-gray-400 dark:text-gray-500 py-3">아직 생성된 임시 이미지가 없습니다.</div>';
    }

    return `
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            ${item.images.map(key => {
                const selected = item.selectedImage === key;
                return `
                    <div class="relative aspect-square rounded-md overflow-hidden border ${selected ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700'} bg-gray-100 dark:bg-gray-900">
                        <button type="button" onclick="window.selectPlannerImage('${escapeJsString(key)}')" class="absolute inset-0">
                            <img src="${escapeHtml(getAssetUrl(key))}?t=${Date.now()}" alt="" class="w-full h-full object-cover" loading="lazy">
                        </button>
                        ${selected ? '<span class="absolute left-1 top-1 px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-bold">선택됨</span>' : ''}
                        <button type="button" onclick="window.deletePlannerImage('${escapeJsString(key)}')" class="absolute right-1 top-1 p-1 rounded bg-black/60 text-white hover:bg-red-600 transition" title="임시 이미지 삭제" aria-label="임시 이미지 삭제">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function getPlannerItemBySituationId(meta, situationId) {
    const decodedId = decodeURIComponent(situationId || '');
    return meta?.items?.find(item => item.situationId === decodedId) || null;
}

function renderPlannerResultList(meta) {
    if (!meta?.items?.length) {
        return renderEmptyState('실행 화면에서 이미지를 생성하면 결과가 표시됩니다.');
    }

    return `
        <div class="space-y-2">
            ${meta.items.map(item => {
                const generatedCount = Array.isArray(item.images) ? item.images.length : 0;
                const selected = !!item.selectedImage;
                return `
                    <div role="button" tabindex="0" onclick="window.openPlannerResultModal('${escapeJsString(item.situationId)}')" onkeydown="if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.openPlannerResultModal('${escapeJsString(item.situationId)}'); }" class="w-full cursor-pointer rounded-lg border ${selected ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/60 dark:bg-indigo-950/20' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30'} p-3 text-left hover:border-indigo-400 transition">
                        <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
                            <div class="min-w-0">
                                <p class="text-xs font-bold text-gray-900 dark:text-white truncate">${escapeHtml(item.situationName || item.situationId)}</p>
                                <p class="mt-1 text-[10px] text-gray-400 dark:text-gray-500 truncate">${escapeHtml(item.imageNumber)}.webp · ${selected ? '선택됨' : '미선택'}</p>
                            </div>
                            <div class="flex items-center gap-2 flex-shrink-0">
                                <span class="px-2 py-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[10px] font-bold text-gray-600 dark:text-gray-300">목표 ${escapeHtml(item.count || 1)}</span>
                                <span class="px-2 py-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[10px] font-bold text-gray-600 dark:text-gray-300">생성 ${generatedCount}</span>
                                <button type="button" onclick="event.stopPropagation(); window.deletePlannerItem('${escapeJsString(item.situationId)}')" class="inline-flex p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition" title="플랜 삭제" aria-label="플랜 삭제">
                                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderPlannerResultModal(meta) {
    const item = getPlannerItemBySituationId(meta, window.PLANNER_RESULT_MODAL_SITUATION_ID);
    if (!item) return '';

    const images = Array.isArray(item.images) ? item.images : [];
    return `
        <div id="planner-result-modal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div class="w-full max-w-5xl max-h-[88vh] rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden flex flex-col">
                <div class="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <div class="min-w-0">
                        <h3 class="text-sm font-bold text-gray-900 dark:text-white truncate">${escapeHtml(item.situationName || item.situationId)}</h3>
                        <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">목표 ${escapeHtml(item.count || 1)}장 · 생성 ${images.length}장 · ${item.selectedImage ? '선택됨' : '미선택'}</p>
                    </div>
                    <button type="button" onclick="window.closePlannerResultModal()" class="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition" title="닫기" aria-label="닫기">
                        <i data-lucide="x" class="w-5 h-5"></i>
                    </button>
                </div>
                <div class="flex-1 min-h-0 overflow-y-auto p-4">
                    ${images.length ? `
                        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            ${images.map(key => {
                                const selected = item.selectedImage === key;
                                return `
                                    <button type="button" data-planner-image-key="${escapeHtml(key)}" onclick="window.openPlannerImagePreview('${escapeJsString(key)}')" class="relative aspect-square rounded-lg overflow-hidden border ${selected ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700'} bg-gray-100 dark:bg-gray-800 hover:border-indigo-400 transition">
                                        <img src="${escapeHtml(getAssetUrl(key))}?t=${Date.now()}" alt="" class="w-full h-full object-cover" loading="lazy">
                                        ${selected ? '<span data-planner-selected-badge class="absolute left-2 top-2 px-2 py-1 rounded bg-indigo-600 text-white text-[10px] font-bold">선택됨</span>' : ''}
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    ` : renderEmptyState('아직 생성된 이미지가 없습니다.')}
                </div>
                <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
                    <p id="planner-result-selected-label" class="text-[11px] text-gray-500 dark:text-gray-400 truncate">${item.selectedImage ? `선택 이미지: ${getFileNameFromKey(item.selectedImage)}` : '이미지를 클릭해 선택하세요.'}</p>
                    <div class="flex items-center gap-2">
                        <button type="button" onclick="window.closePlannerResultModal()" class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200">닫기</button>
                        <button type="button" onclick="window.startPlannerGeneration('${escapeJsString(item.situationId)}')" class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200 hover:border-indigo-400">다시 생성</button>
                        <button id="planner-result-confirm-button" type="button" onclick="window.confirmPlannerSelection('${escapeJsString(item.situationId)}')" ${item.selectedImage ? '' : 'disabled'} class="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">최종 선택 완료</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderPlannerImagePreviewModal() {
    const key = window.PLANNER_IMAGE_PREVIEW_KEY;
    if (!key) return '';

    return `
        <div id="planner-image-preview-modal" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onclick="window.closePlannerImagePreview(event)">
            <div class="w-full max-w-4xl max-h-[90vh] rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden flex flex-col" onclick="event.stopPropagation()">
                <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <h3 class="text-sm font-bold text-gray-900 dark:text-white truncate">${escapeHtml(getFileNameFromKey(key))}</h3>
                    <button type="button" onclick="window.closePlannerImagePreview()" class="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition" title="닫기" aria-label="닫기">
                        <i data-lucide="x" class="w-5 h-5"></i>
                    </button>
                </div>
                <div class="flex-1 min-h-0 bg-gray-100 dark:bg-gray-950 flex items-center justify-center p-4">
                    <img src="${escapeHtml(getAssetUrl(key))}?t=${Date.now()}" alt="" class="max-w-full max-h-[68vh] object-contain rounded-lg shadow">
                </div>
                <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p class="text-xs font-bold text-gray-700 dark:text-gray-200">이 이미지를 선택하시겠습니까?</p>
                    <div class="flex items-center gap-2 justify-end">
                        <button type="button" onclick="window.closePlannerImagePreview()" class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200">취소</button>
                        <button type="button" onclick="window.selectPlannerImageFromPreview('${escapeJsString(key)}')" class="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700">선택</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function ensurePlannerOverlayRoot(id) {
    let root = document.getElementById(id);
    if (!root) {
        root = document.createElement('div');
        root.id = id;
        document.body.appendChild(root);
    }
    return root;
}

function renderPlannerResultOverlay() {
    const root = ensurePlannerOverlayRoot('planner-result-overlay-root');
    root.innerHTML = renderPlannerResultModal(window.PROJECT_PLANNER_META || null);
    if (window.lucide) lucide.createIcons();
}

function renderPlannerPreviewOverlay() {
    const root = ensurePlannerOverlayRoot('planner-preview-overlay-root');
    root.innerHTML = renderPlannerImagePreviewModal();
    if (window.lucide) lucide.createIcons();
}

function syncPlannerResultModalSelection(item) {
    const modal = document.getElementById('planner-result-modal');
    if (!modal || !item) return;

    modal.querySelectorAll('[data-planner-image-key]').forEach(button => {
        const selected = button.dataset.plannerImageKey === item.selectedImage;
        button.classList.toggle('border-indigo-500', selected);
        button.classList.toggle('ring-2', selected);
        button.classList.toggle('ring-indigo-500', selected);
        button.classList.toggle('border-gray-200', !selected);
        button.classList.toggle('dark:border-gray-700', !selected);

        let badge = button.querySelector('[data-planner-selected-badge]');
        if (selected && !badge) {
            badge = document.createElement('span');
            badge.dataset.plannerSelectedBadge = 'true';
            badge.className = 'absolute left-2 top-2 px-2 py-1 rounded bg-indigo-600 text-white text-[10px] font-bold';
            badge.textContent = '선택됨';
            button.appendChild(badge);
        } else if (!selected && badge) {
            badge.remove();
        }
    });

    const label = document.getElementById('planner-result-selected-label');
    if (label) label.textContent = item.selectedImage ? `선택 이미지: ${getFileNameFromKey(item.selectedImage)}` : '이미지를 클릭해 선택하세요.';
    const confirmButton = document.getElementById('planner-result-confirm-button');
    if (confirmButton) confirmButton.disabled = !item.selectedImage;
}

function renderPlannerProgressPanel(meta) {
    if (!meta?.items?.length || !['queued', 'running', 'cancel_requested'].includes(meta.status)) return '';

    const activeIds = Array.isArray(meta.runningSituationIds) && meta.runningSituationIds.length
        ? new Set(meta.runningSituationIds)
        : null;
    const progressItems = activeIds ? meta.items.filter(item => activeIds.has(item.situationId)) : meta.items;
    const total = progressItems.length;
    const doneCount = progressItems.filter(item => ['done', 'completed', 'confirmed'].includes(item.status)).length;
    const failedCount = progressItems.filter(item => ['failed', 'partial_failed', 'cancelled'].includes(item.status)).length;
    const runningItem = progressItems.find(item => ['queued', 'running', 'cancel_requested'].includes(item.status));
    const runningIndex = runningItem ? progressItems.findIndex(item => item.situationId === runningItem.situationId) + 1 : doneCount + failedCount + 1;
    const progressCount = Math.min(total, doneCount + failedCount);
    const percent = total ? Math.round((progressCount / total) * 100) : 0;

    return `
        <div class="mb-4 rounded-xl border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/80 dark:bg-indigo-950/30 p-4">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="min-w-0">
                    <p class="inline-flex items-center gap-2 text-sm font-bold text-indigo-800 dark:text-indigo-200">
                        <i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>
                        ${meta.status === 'queued' ? '생성 대기 중' : meta.status === 'cancel_requested' ? '취소 요청 중' : '생성 진행 중'}
                    </p>
                    <p class="mt-1 text-xs text-indigo-700/80 dark:text-indigo-300/80 truncate">
                        ${runningItem ? `${escapeHtml(runningItem.imageNumber)}.webp / ${escapeHtml(runningItem.situationName || runningItem.situationId)} · ${escapeHtml(getPlannerStageLabel(runningItem.stage) || getPlannerStatusLabel(runningItem.status))}` : '다음 플랜을 준비 중입니다.'}
                    </p>
                </div>
                <div class="flex items-center gap-2 text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                    <span>${Math.min(runningIndex, total)} / ${total}</span>
                    <span>완료 ${doneCount}</span>
                    <span>실패 ${failedCount}</span>
                </div>
            </div>
            <div class="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white dark:bg-gray-900 border border-indigo-100 dark:border-indigo-900/70">
                <div class="h-full rounded-full bg-indigo-600 transition-all duration-500" style="width: ${percent}%"></div>
            </div>
            <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                ${progressItems.map(item => `
                    <div class="rounded-lg border ${['queued', 'running', 'cancel_requested'].includes(item.status) ? 'border-indigo-400 bg-white dark:bg-indigo-950/50' : 'border-indigo-100 dark:border-indigo-900/50 bg-white/70 dark:bg-gray-900/50'} px-3 py-2">
                        <div class="flex items-center justify-between gap-2">
                            <p class="min-w-0 truncate text-[11px] font-bold text-gray-800 dark:text-gray-100">${escapeHtml(item.situationName || item.situationId)}</p>
                            <span class="flex-shrink-0 text-[10px] font-bold ${['queued', 'running', 'cancel_requested'].includes(item.status) ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}">${escapeHtml(getPlannerStatusLabel(item.status || 'pending'))}</span>
                        </div>
                        <p class="mt-1 text-[10px] text-gray-500 dark:text-gray-400">후보 ${item.images?.length || 0}장 / 목표 ${escapeHtml(item.count || 1)}장</p>
                        ${item.stage ? `<p class="mt-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-300">${escapeHtml(getPlannerStageLabel(item.stage))}</p>` : ''}
                        ${item.errorMessage ? `<p class="mt-1 text-[10px] text-red-500 truncate">${escapeHtml(item.errorMessage)}</p>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderPlannerPanel(project, situations) {
    const characters = getProjectItems(project, 'characters');
    const meta = window.PROJECT_PLANNER_META || null;
    const activeCharacter = characters.find(character => character.id === meta?.characterId || character.prefix === meta?.characterId) || characters[0];
    const activeCharacterName = activeCharacter ? (activeCharacter.name || activeCharacter.alias || activeCharacter.folderName || activeCharacter.id) : '선택된 캐릭터 없음';
    const selectedSituationId = meta?.lastSituationId || situations[0]?.id || '';
    const view = window.PROJECT_PLANNER_VIEW || 'plan';
    const settings = normalizePlannerSettings(window.PROJECT_PLANNER_SETTINGS || {});

    const modeButton = (mode, label, icon) => `
        <button type="button" onclick="window.setPlannerView('${mode}')" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition ${view === mode ? 'bg-indigo-600 text-white' : 'border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-indigo-400'}">
            <i data-lucide="${icon}" class="w-4 h-4"></i>
            ${label}
        </button>
    `;

    const planRows = meta?.items?.length ? `
        <div class="space-y-3 overflow-y-auto pr-1">
            ${meta.items.map(item => `
                <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3">
                    <div class="flex items-center justify-between gap-3 mb-3">
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-gray-900 dark:text-white truncate">${escapeHtml(item.imageNumber)}.webp / ${escapeHtml(item.situationName || item.situationId)}</p>
                            <p class="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">${escapeHtml(getPlannerStatusLabel(item.status || 'pending'))} · 생성 ${escapeHtml(item.count || 1)}장</p>
                        </div>
                        <div class="flex items-center gap-2 flex-shrink-0">
                            <input id="planner-${escapeHtml(item.imageNumber)}-count" type="number" min="1" max="12" value="${escapeHtml(item.count || 1)}" class="w-16 p-1.5 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100">
                            <button type="button" onclick="window.deletePlannerItem('${escapeJsString(item.situationId)}')" class="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition" title="플랜 삭제" aria-label="플랜 삭제">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                        ${renderPlannerField(item, 'style', '그림체')}
                        ${renderPlannerField(item, 'composition', '구도', 1)}
                        ${renderPlannerField(item, 'character', '캐릭터')}
                        ${renderPlannerField(item, 'clothing', '의상')}
                        ${renderPlannerField(item, 'expression', '표정', 1)}
                        ${renderPlannerField(item, 'action', '행위', 1)}
                        ${renderPlannerField(item, 'background', '배경', 1)}
                        ${renderPlannerField(item, 'negative', '부정 프롬프트', 1)}
                    </div>
                    ${renderPlannerGenerationFields(item)}
                </div>
            `).join('')}
        </div>
    ` : '<div class="flex-1 flex items-center justify-center text-sm font-bold text-gray-500 dark:text-gray-400 text-center">캐릭터와 상황을 선택한 뒤 추가하기를 눌러 플랜 작성안을 만드세요.</div>';

    const planView = `
        <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem] gap-2 mb-3">
            <label class="block min-w-0">
                <span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">캐릭터</span>
                <select id="planner-character-select" class="w-full p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100">
                    ${characters.map(character => `<option value="${escapeHtml(character.id)}" ${activeCharacter?.id === character.id ? 'selected' : ''}>${escapeHtml(character.name || character.folderName)}</option>`).join('')}
                </select>
            </label>
            <label class="block min-w-0">
                <span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">상황</span>
                <select id="planner-situation-select" class="w-full p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100">
                    ${situations.map(situation => `<option value="${escapeHtml(situation.id)}" ${selectedSituationId === situation.id ? 'selected' : ''}>${escapeHtml(getSituationImageNumber(project, situation))}.webp / ${escapeHtml(getSituationDisplayName(situation))}</option>`).join('')}
                </select>
            </label>
            <label class="block">
                <span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">생성 수</span>
                <input id="planner-default-count" type="number" min="1" max="12" value="${escapeHtml(meta?.defaultCount || 2)}" class="w-full p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100">
            </label>
        </div>
        <div class="flex flex-wrap gap-2 mb-4">
            <button type="button" onclick="window.addPlannerDraftItem()" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700">
                <i data-lucide="plus" class="w-4 h-4"></i> 추가하기
            </button>
            <button type="button" onclick="window.savePlannerDraft()" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-xs font-bold hover:border-indigo-400">
                <i data-lucide="save" class="w-4 h-4"></i> 플랜 저장하기
            </button>
        </div>
        ${!characters.length ? renderEmptyState('플랜을 작성하려면 먼저 캐릭터를 추가하세요.') : ''}
        ${!situations.length ? renderEmptyState('플랜을 작성하려면 먼저 상황을 추가하세요.') : ''}
        ${planRows}
    `;

    const runView = `
        <div class="flex items-center justify-between gap-3 mb-4">
            <div>
                <p class="text-xs font-bold text-gray-900 dark:text-white">저장된 플랜 실행</p>
                <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">${meta?.items?.length || 0}개 플랜 항목</p>
            </div>
            <button type="button" onclick="window.startPlannerGeneration()" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700">
                <i data-lucide="play" class="w-4 h-4"></i> 실행 시작
            </button>
        </div>
        <div class="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <p class="text-[11px] font-bold text-gray-700 dark:text-gray-200">실행 방식</p>
                    <p class="mt-1 text-[10px] text-gray-400 dark:text-gray-500">${window.PROJECT_PLANNER_GENERATION_MODE === 'background' ? '서버 작업으로 등록하고 상태를 조회합니다.' : '현재 브라우저에서 기존 방식으로 생성합니다.'}</p>
                </div>
                <div class="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1">
                    <button type="button" onclick="window.setPlannerGenerationMode('browser')" class="px-3 py-1.5 rounded-md text-[11px] font-bold ${window.PROJECT_PLANNER_GENERATION_MODE !== 'background' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}">브라우저</button>
                    <button type="button" onclick="window.setPlannerGenerationMode('background')" class="px-3 py-1.5 rounded-md text-[11px] font-bold ${window.PROJECT_PLANNER_GENERATION_MODE === 'background' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}">백그라운드</button>
                </div>
            </div>
            ${meta?.backgroundJobId && ['queued', 'running', 'cancel_requested'].includes(meta.status) ? `
                <div class="mt-3 flex items-center gap-2">
                    <button type="button" onclick="window.refreshPlannerBackgroundStatus('${escapeJsString(meta.backgroundJobId)}')" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-[10px] font-bold text-gray-700 dark:text-gray-200 hover:border-indigo-400">
                        <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> 상태 갱신
                    </button>
                    <button type="button" onclick="window.cancelPlannerBackgroundGeneration('${escapeJsString(meta.backgroundJobId)}')" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-red-200 dark:border-red-900 text-[10px] font-bold text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20">
                        <i data-lucide="square" class="w-3.5 h-3.5"></i> 취소 요청
                    </button>
                </div>
            ` : ''}
        </div>
        ${renderPlannerProgressPanel(meta)}
        ${meta?.items?.length ? `
            <div class="space-y-2">
                ${meta.items.map(item => `
                    <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3 flex items-center justify-between gap-3">
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-gray-900 dark:text-white truncate">${escapeHtml(item.imageNumber)}.webp / ${escapeHtml(item.situationName || item.situationId)}</p>
                            <p class="mt-1 text-[10px] text-gray-400 dark:text-gray-500">${escapeHtml(getPlannerStatusLabel(item.status || 'pending'))} · 후보 ${item.images?.length || 0}장</p>
                        </div>
                        <div class="flex items-center gap-2 flex-shrink-0">
                            <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">${escapeHtml(item.count || 1)}장</span>
                            <button type="button" onclick="window.deletePlannerItem('${escapeJsString(item.situationId)}')" class="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition" title="플랜 삭제" aria-label="플랜 삭제">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        ` : renderEmptyState('플랜짜기 화면에서 플랜을 저장하면 실행 목록이 표시됩니다.')}
    `;

    const resultView = `
        <div class="flex items-center justify-between gap-3 mb-4">
            <div>
                <p class="text-xs font-bold text-gray-900 dark:text-white">결과 확인</p>
                <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">상황별 결과 목록을 열어 이미지를 확인하고 선택합니다.</p>
            </div>
        </div>
        ${renderPlannerResultList(meta)}
    `;

    return `
        <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 min-h-[360px] flex flex-col">
            <div class="flex items-start justify-between gap-3 mb-4">
                <div>
                    <h3 class="font-bold text-sm text-gray-900 dark:text-white">플래너 데모</h3>
                    <p id="planner-status" class="mt-1 min-h-4 text-[11px] text-gray-400 dark:text-gray-500">${escapeHtml(getPlannerStatusLabel(meta?.status))}</p>
                    <p class="mt-1 inline-flex items-center gap-1.5 max-w-full rounded-full border border-indigo-100 dark:border-indigo-900/60 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-1 text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                        <i data-lucide="user" class="w-3.5 h-3.5 flex-shrink-0"></i>
                        <span class="truncate">대상 캐릭터: ${escapeHtml(activeCharacterName)}</span>
                    </p>
                </div>
                <div class="flex items-center gap-1">
                    <button type="button" onclick="window.openPlannerSettingsModal()" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" title="플래너 설정">
                        <i data-lucide="settings" class="w-4 h-4"></i>
                    </button>
                    <button type="button" onclick="window.refreshPlannerPanel()" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" title="새로고침">
                        <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
            <div class="flex flex-wrap gap-2 mb-4">
                ${modeButton('plan', '플랜짜기', 'list-plus')}
                ${modeButton('run', '실행 화면', 'play')}
                ${modeButton('result', '결과 확인', 'images')}
            </div>
            ${view === 'plan' ? planView : view === 'run' ? runView : resultView}
            ${renderPlannerSettingsModal(settings)}
        </div>
    `;
}

export async function refreshPlannerPanel() {
    const project = getActiveProject();
    if (!project) return;
    const [meta] = await Promise.all([
        loadPlannerMeta(project).catch(() => null),
        loadPlannerSettings(project, true).catch(() => normalizePlannerSettings())
    ]);
    window.PROJECT_PLANNER_META = meta;
    if (meta?.backgroundJobId && ['queued', 'running', 'cancel_requested'].includes(meta.status)) {
        startPlannerBackgroundPolling(meta.backgroundJobId);
    }
    renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
}

export function setPlannerView(view = 'plan') {
    window.PROJECT_PLANNER_VIEW = ['plan', 'run', 'result'].includes(view) ? view : 'plan';
    renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
}

export function setPlannerGenerationMode(mode = 'browser') {
    window.PROJECT_PLANNER_GENERATION_MODE = mode === 'background' ? 'background' : 'browser';
    localStorage.setItem('imggul_planner_generation_mode', window.PROJECT_PLANNER_GENERATION_MODE);
    renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
}

export function openPlannerResultModal(situationId) {
    window.PLANNER_RESULT_MODAL_SITUATION_ID = situationId;
    window.PLANNER_IMAGE_PREVIEW_KEY = null;
    renderPlannerResultOverlay();
    renderPlannerPreviewOverlay();
}

export function closePlannerResultModal() {
    window.PLANNER_RESULT_MODAL_SITUATION_ID = null;
    window.PLANNER_IMAGE_PREVIEW_KEY = null;
    renderPlannerResultOverlay();
    renderPlannerPreviewOverlay();
}

export function openPlannerImagePreview(key) {
    window.PLANNER_IMAGE_PREVIEW_KEY = key;
    renderPlannerPreviewOverlay();
}

export function closePlannerImagePreview(event) {
    if (event && event.target?.id !== 'planner-image-preview-modal') return;
    window.PLANNER_IMAGE_PREVIEW_KEY = null;
    renderPlannerPreviewOverlay();
}

export function openPlannerSettingsModal() {
    const modal = document.getElementById('planner-settings-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    refreshProjectIcons();
}

export function closePlannerSettingsModal(event) {
    if (event && event.target?.id !== 'planner-settings-modal') return;
    const modal = document.getElementById('planner-settings-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

export async function savePlannerSettingsFromModal() {
    const project = getActiveProject();
    if (!project) return;
    const status = document.getElementById('planner-settings-status');
    if (status) status.textContent = '저장 중...';

    try {
        const settings = await savePlannerSettings(project, {
            model: document.getElementById('planner-setting-model')?.value,
            steps: document.getElementById('planner-setting-steps')?.value,
            scale: document.getElementById('planner-setting-scale')?.value,
            sampler: document.getElementById('planner-setting-sampler')?.value,
            sm: document.getElementById('planner-setting-sm')?.checked,
            sm_dyn: document.getElementById('planner-setting-sm-dyn')?.checked,
            vibeStrength: document.getElementById('planner-setting-vibe-strength')?.value,
            vibeInfo: document.getElementById('planner-setting-vibe-info')?.value,
            preciseStrength: document.getElementById('planner-setting-precise-strength')?.value,
            preciseFidelity: document.getElementById('planner-setting-precise-fidelity')?.value,
            preciseType: document.getElementById('planner-setting-precise-type')?.value,
            vibeImageKey: document.getElementById('planner-setting-vibe-key')?.value.trim(),
            preciseImageKey: document.getElementById('planner-setting-precise-key')?.value.trim()
        });
        let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
        if (meta?.items?.length) {
            meta.items.forEach(item => applyPlannerSettingsToGeneration(item.generation, settings));
            meta.updatedAt = Date.now();
            await savePlannerMeta(project, meta);
            window.PROJECT_PLANNER_META = meta;
        }
        if (status) status.textContent = '저장되었습니다.';
        setTimeout(() => {
            closePlannerSettingsModal();
            renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
        }, 250);
    } catch (err) {
        if (status) status.textContent = err.message || '저장에 실패했습니다.';
    }
}

export function openPlannerReferenceLibrary(target) {
    window.PLANNER_REFERENCE_TARGET = target === 'precise' ? 'precise' : 'vibe';
    if (window.openInpaintLibraryModal) window.openInpaintLibraryModal('main');
}

export function setPlannerReferenceImageFromKey(key) {
    const target = window.PLANNER_REFERENCE_TARGET === 'precise' ? 'precise' : 'vibe';
    const input = document.getElementById(`planner-setting-${target}-key`);
    if (input) input.value = key || '';
    window.PLANNER_REFERENCE_TARGET = null;
}

async function uploadPlannerReferenceFile(target, file) {
    const project = getActiveProject();
    if (!project || !file) return;
    const normalizedTarget = target === 'precise' ? 'precise' : 'vibe';
    const status = document.getElementById('planner-settings-status');
    if (status) status.textContent = '참조 이미지 업로드 중...';

    let uploadFile = file;
    if (window.convertToWebP && file.type !== 'image/webp') uploadFile = await window.convertToWebP(file);
    const ext = uploadFile.name.split('.').pop() || 'webp';
    const fileName = `${normalizedTarget}_${Date.now()}.${ext}`;
    const key = `${getPlannerPrefix(project)}references/${fileName}`;
    const buffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('참조 이미지 읽기에 실패했습니다.'));
        reader.readAsArrayBuffer(uploadFile);
    });
    const res = await fetch('/api/upload?_t=' + Date.now(), {
        method: 'PUT',
        headers: {
            'Content-Type': uploadFile.type || 'image/webp',
            'X-File-Name': encodeURIComponent(fileName),
            'X-Absolute-Path': encodeURIComponent(key)
        },
        body: buffer,
        cache: 'no-store'
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '참조 이미지 업로드에 실패했습니다.');
    }
    const input = document.getElementById(`planner-setting-${normalizedTarget}-key`);
    if (input) input.value = key;
    if (status) status.textContent = '참조 이미지가 업로드되었습니다.';
}

export async function handlePlannerReferenceFileInput(event, target) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    try {
        await uploadPlannerReferenceFile(target, file);
    } catch (err) {
        const status = document.getElementById('planner-settings-status');
        if (status) status.textContent = err.message || '참조 이미지 업로드에 실패했습니다.';
    } finally {
        if (event?.target) event.target.value = '';
    }
}

export async function handlePlannerReferenceDrop(event, target) {
    event.preventDefault();
    event.currentTarget?.classList.remove('border-indigo-400');
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    try {
        await uploadPlannerReferenceFile(target, file);
    } catch (err) {
        const status = document.getElementById('planner-settings-status');
        if (status) status.textContent = err.message || '참조 이미지 업로드에 실패했습니다.';
    }
}

export async function addPlannerV4Prompt(imageNumber) {
    const project = getActiveProject();
    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!meta?.items?.length) return;
    meta = readPlannerEditsFromDom(meta);
    const item = meta.items.find(entry => String(entry.imageNumber) === String(imageNumber));
    if (!item) return;
    item.generation.v4PromptCharacters = [
        ...(item.generation.v4PromptCharacters || []),
        { subject: '', clothing: '', expression: '', action: '', negative: '' }
    ];
    window.PROJECT_PLANNER_META = meta;
    renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
}

export async function removePlannerV4Prompt(imageNumber, index) {
    const project = getActiveProject();
    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!meta?.items?.length) return;
    meta = readPlannerEditsFromDom(meta);
    const item = meta.items.find(entry => String(entry.imageNumber) === String(imageNumber));
    if (!item) return;
    item.generation.v4PromptCharacters = (item.generation.v4PromptCharacters || []).filter((_, rowIndex) => rowIndex !== index);
    window.PROJECT_PLANNER_META = meta;
    renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
}

export async function addPlannerDraftItem() {
    const project = getActiveProject();
    if (!project) return;
    await Promise.all([
        loadProjectCharacters(project).catch(() => []),
        loadProjectSituations(project).catch(() => [])
    ]);

    const characterId = document.getElementById('planner-character-select')?.value || getProjectItems(project, 'characters')[0]?.id || '';
    const character = getCharacterById(project, characterId);
    if (!character) {
        setPlannerStatus('먼저 캐릭터를 선택하세요.');
        return;
    }

    const situationId = document.getElementById('planner-situation-select')?.value || '';
    const situation = getSituationById(project, situationId);
    if (!situation) {
        setPlannerStatus('먼저 상황을 선택하세요.');
        return;
    }

    const defaultCount = Math.max(1, parseInt(document.getElementById('planner-default-count')?.value) || 2);
    const characterMeta = await loadCharacterMeta(character).catch(() => ({}));
    const projectStyle = await loadProjectStylePrompt(project).catch(() => '');
    const plannerSettings = await loadPlannerSettings(project).catch(() => normalizePlannerSettings());
    const currentSettings = window.readCraftSettings ? window.readCraftSettings() : {};
    const stylePrompt = projectStyle || currentSettings.prompts?.['prompt-style'] || '';

    const prompt = getSituationPrompt(situation);
    const expressionPrompt = combinePromptParts(characterMeta.parts?.expression, prompt.expression) || currentSettings.prompts?.['prompt-expression'] || '';
    const negativePrompt = combinePromptParts(characterMeta.parts?.negative, prompt.negative) || currentSettings.negative || '';
    const imageNumber = getSituationImageNumber(project, situation);
    const fields = {
        style: stylePrompt,
        composition: prompt.composition || currentSettings.prompts?.['prompt-composition'] || 'straight-on',
        character: characterMeta.parts?.character || characterMeta.prompt || '',
        clothing: characterMeta.parts?.clothing || currentSettings.prompts?.['prompt-clothing'] || '',
        expression: expressionPrompt,
        action: prompt.action || currentSettings.prompts?.['prompt-action'] || '',
        background: prompt.background || currentSettings.prompts?.['prompt-background'] || 'white background',
        negative: negativePrompt
    };
    const generation = applyPlannerSettingsToGeneration({
        ...currentSettings,
        simpleMode: false,
        batchCount: String(defaultCount),
        negative: fields.negative,
        prompts: {
            ...(currentSettings.prompts || {}),
            'prompt-style': fields.style,
            'prompt-composition': fields.composition,
            'prompt-character': fields.character,
            'prompt-clothing': fields.clothing,
            'prompt-expression': fields.expression,
            'prompt-action': fields.action,
            'prompt-background': fields.background,
            'prompt-raw': ''
        },
        fields
    }, plannerSettings);

    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!meta || meta.characterId !== character.id) {
        meta = {
            projectId: project.id,
            characterId: character.id,
            characterPrefix: character.prefix,
            status: 'draft',
            defaultCount,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            items: []
        };
    }

    const existingIndex = meta.items.findIndex(item => item.situationId === situation.id);
    const item = {
        situationId: situation.id,
        situationName: getSituationDisplayName(situation),
        situationIndex: getProjectItems(project, 'situations').findIndex(entry => entry.id === situation.id),
        imageNumber,
        count: defaultCount,
        status: 'pending',
        generation,
        images: existingIndex >= 0 ? meta.items[existingIndex].images || [] : [],
        selectedImage: existingIndex >= 0 ? meta.items[existingIndex].selectedImage || null : null
    };

    if (existingIndex >= 0) meta.items[existingIndex] = item;
    else meta.items.push(item);
    meta.defaultCount = defaultCount;
    meta.lastSituationId = situation.id;
    meta.updatedAt = Date.now();
    window.PROJECT_PLANNER_META = meta;
    renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
}

export async function savePlannerDraft() {
    const project = getActiveProject();
    if (!project) return;

    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!meta?.items?.length) {
        setPlannerStatus('저장할 플랜 작성안이 없습니다.');
        return;
    }

    meta = readPlannerEditsFromDom(meta);
    meta.status = 'draft';
    await savePlannerMeta(project, meta);
    window.PROJECT_PLANNER_META = meta;
    setPlannerStatus('플랜이 저장되었습니다.');
}

export async function createPlannerDraft() {
    await addPlannerDraftItem();
}

export async function deletePlannerItem(situationId) {
    const project = getActiveProject();
    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!project || !meta?.items?.length) return;

    const item = meta.items.find(entry => entry.situationId === situationId);
    if (!item) return;
    if (!confirm(`'${item.situationName || item.situationId}' 플랜을 삭제하시겠습니까?\n이 플랜의 임시 이미지도 함께 삭제됩니다.`)) return;

    if (window.PLANNER_RESULT_MODAL_SITUATION_ID === situationId) {
        window.PLANNER_RESULT_MODAL_SITUATION_ID = null;
        window.PLANNER_IMAGE_PREVIEW_KEY = null;
    }

    await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_folder', key: getPlannerImagePrefix(project, item.imageNumber) })
    }).catch(() => null);

    meta.items = meta.items.filter(entry => entry.situationId !== situationId);
    meta.updatedAt = Date.now();
    if (meta.items.length) {
        await savePlannerMeta(project, meta);
        window.PROJECT_PLANNER_META = meta;
    } else {
        await fetch('/api/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete_folder', key: getPlannerPrefix(project) })
        }).catch(() => null);
        window.PROJECT_PLANNER_META = null;
    }
    renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
}

export async function deletePlannerImage(key) {
    const project = getActiveProject();
    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!project || !meta?.items?.length || !key) return;

    const item = meta.items.find(entry => Array.isArray(entry.images) && entry.images.includes(key));
    if (!item) return;
    if (!confirm('이 임시 이미지를 삭제하시겠습니까?')) return;

    const res = await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', key })
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPlannerStatus(data.error || '임시 이미지 삭제에 실패했습니다.');
        return;
    }

    const prefix = key.slice(0, key.lastIndexOf('/') + 1);
    await window.removeMetadataFromDB(prefix, getFileNameFromKey(key)).catch(() => null);
    item.images = item.images.filter(imageKey => imageKey !== key);
    if (item.selectedImage === key) item.selectedImage = null;
    item.status = item.images.length ? item.status : 'pending';
    meta.updatedAt = Date.now();
    await savePlannerMeta(project, meta);
    window.PROJECT_PLANNER_META = meta;
    renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
}

async function waitForPlannerQueueComplete() {
    return await new Promise(resolve => {
        const handler = (event) => {
            window.removeEventListener('imggul:generation-queue-complete', handler);
            resolve(event.detail || {});
        };
        window.addEventListener('imggul:generation-queue-complete', handler);
    });
}

async function clearPlannerItemImages(project, item) {
    const prefix = getPlannerImagePrefix(project, item.imageNumber);
    const imageKeys = Array.isArray(item.images) ? [...item.images] : [];
    await Promise.all(imageKeys.map(key =>
        window.removeMetadataFromDB(prefix, getFileNameFromKey(key)).catch(() => null)
    ));
    await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_folder', key: prefix })
    }).catch(() => null);
    item.images = [];
    item.selectedImage = null;
    item.status = 'pending';
}

function startPlannerBackgroundPolling(jobId) {
    if (!jobId) return;
    if (window.PLANNER_BACKGROUND_POLL_TIMER) clearInterval(window.PLANNER_BACKGROUND_POLL_TIMER);
    window.PLANNER_BACKGROUND_POLL_TIMER = setInterval(() => {
        window.refreshPlannerBackgroundStatus(jobId).catch(() => null);
    }, 5000);
}

function stopPlannerBackgroundPolling() {
    if (!window.PLANNER_BACKGROUND_POLL_TIMER) return;
    clearInterval(window.PLANNER_BACKGROUND_POLL_TIMER);
    window.PLANNER_BACKGROUND_POLL_TIMER = null;
}

export async function refreshPlannerBackgroundStatus(jobId = null) {
    const project = getActiveProject();
    const meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    const targetJobId = jobId || meta?.backgroundJobId;
    if (!project || !targetJobId) return null;

    const res = await fetch(`/api/planner/background/status?jobId=${encodeURIComponent(targetJobId)}&_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPlannerStatus(data.error || '백그라운드 상태 조회에 실패했습니다.');
        return null;
    }

    const status = await res.json();
    const nextMeta = await loadPlannerMeta(project).catch(() => window.PROJECT_PLANNER_META);
    if (nextMeta) {
        nextMeta.backgroundStatus = status;
        nextMeta.status = status.status || nextMeta.status;
        nextMeta.backgroundJobId = status.jobId || nextMeta.backgroundJobId;
        if (Array.isArray(status.items) && Array.isArray(nextMeta.items)) {
            nextMeta.items = nextMeta.items.map(item => {
                const statusItem = status.items.find(entry => entry.situationId === item.situationId);
                if (!statusItem) return item;
                return {
                    ...item,
                    status: statusItem.status === 'completed' ? 'done' : statusItem.status,
                    stage: statusItem.stage || item.stage || '',
                    stageLabel: statusItem.stageLabel || item.stageLabel || '',
                    images: statusItem.resultKeys || item.images || [],
                    errorMessage: statusItem.errorMessage || item.errorMessage || ''
                };
            });
        }
        window.PROJECT_PLANNER_META = nextMeta;
    }
    if (!['queued', 'running', 'cancel_requested'].includes(status.status)) stopPlannerBackgroundPolling();
    renderPlannerIfVisible();
    return status;
}

export async function cancelPlannerBackgroundGeneration(jobId = null) {
    const project = getActiveProject();
    const meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    const targetJobId = jobId || meta?.backgroundJobId;
    if (!targetJobId) return;

    if (meta) {
        meta.status = 'cancel_requested';
        meta.stage = 'cancelled';
        meta.stageLabel = getPlannerStageLabel('cancelled');
        if (Array.isArray(meta.items)) {
            meta.items = meta.items.map(item => ['queued', 'running', 'cancel_requested'].includes(item.status)
                ? { ...item, status: 'cancel_requested', stage: 'cancelled', stageLabel: getPlannerStageLabel('cancelled') }
                : item
            );
        }
        window.PROJECT_PLANNER_META = meta;
        renderPlannerIfVisible();
    }

    const res = await fetch('/api/planner/background/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: targetJobId })
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPlannerStatus(data.error || '백그라운드 취소 요청에 실패했습니다.');
        return;
    }
    setPlannerStatus('백그라운드 취소를 요청했습니다.');
    const result = await res.json().catch(() => ({}));
    if (meta) {
        meta.status = result.status || 'cancelled';
        meta.stage = 'cancelled';
        meta.stageLabel = getPlannerStageLabel('cancelled');
        delete meta.runningSituationIds;
        if (Array.isArray(meta.items)) {
            meta.items = meta.items.map(item => ['queued', 'running', 'cancel_requested'].includes(item.status)
                ? { ...item, status: 'cancelled', stage: 'cancelled', stageLabel: getPlannerStageLabel('cancelled') }
                : item
            );
        }
        meta.updatedAt = Date.now();
        await savePlannerMeta(project, meta).catch(() => null);
        window.PROJECT_PLANNER_META = meta;
    }
    setPlannerStatus('취소되었습니다.');
    stopPlannerBackgroundPolling();
    renderPlannerIfVisible();
    await refreshPlannerBackgroundStatus(targetJobId);
}

async function startPlannerBackgroundGeneration(situationId = null) {
    const project = getActiveProject();
    if (!project) return;

    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!meta?.items?.length) {
        setPlannerStatus('먼저 플래너 초안을 생성하세요.');
        return;
    }

    meta = readPlannerEditsFromDom(meta);
    const targetItems = situationId
        ? meta.items.filter(item => item.situationId === situationId)
        : meta.items;
    if (!targetItems.length) {
        setPlannerStatus('실행할 플랜을 찾을 수 없습니다.');
        return;
    }

    const unsupportedReference = targetItems.some(item => item.generation?.vibeImageKey || item.generation?.preciseImageKey);
    if (unsupportedReference) {
        setPlannerStatus('백그라운드 생성은 아직 참조 이미지를 지원하지 않습니다. 브라우저 모드를 사용하세요.');
        return;
    }

    for (const item of targetItems) {
        if (item.images?.length || item.selectedImage) await clearPlannerItemImages(project, item);
        item.status = 'queued';
        item.stage = 'queued';
        item.images = [];
        item.selectedImage = null;
    }

    meta.status = 'queued';
    meta.runningSituationIds = targetItems.map(item => item.situationId);
    meta.updatedAt = Date.now();
    window.PROJECT_PLANNER_VIEW = 'run';
    await savePlannerMeta(project, meta);
    window.PROJECT_PLANNER_META = meta;
    renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));

    const res = await fetch('/api/planner/background/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            projectId: project.id,
            projectPrefix: project.prefix,
            targetSituationId: situationId || null,
            plannerMeta: meta
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        console.error('Background planner start failed', data);
        setPlannerStatus(data.error || '백그라운드 생성 등록에 실패했습니다.');
        meta.status = 'failed';
        meta.updatedAt = Date.now();
        await savePlannerMeta(project, meta).catch(() => null);
        window.PROJECT_PLANNER_META = meta;
        renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
        return;
    }

    meta.backgroundJobId = data.jobId;
    meta.status = data.status || 'queued';
    meta.updatedAt = Date.now();
    await savePlannerMeta(project, meta);
    window.PROJECT_PLANNER_META = meta;
    setPlannerStatus('백그라운드 생성 작업을 등록했습니다.');
    startPlannerBackgroundPolling(data.jobId);
    await refreshPlannerBackgroundStatus(data.jobId);
}

export async function startPlannerGeneration(situationId = null) {
    if (window.PROJECT_PLANNER_GENERATION_MODE === 'background') {
        await startPlannerBackgroundGeneration(situationId);
        return;
    }

    const project = getActiveProject();
    if (!project || window.IS_GENERATING) {
        setPlannerStatus(window.IS_GENERATING ? '이미 생성 작업이 진행 중입니다.' : '');
        return;
    }

    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!meta?.items?.length) {
        setPlannerStatus('먼저 플래너 초안을 생성하세요.');
        return;
    }

    meta = readPlannerEditsFromDom(meta);
    const targetItems = situationId
        ? meta.items.filter(item => item.situationId === situationId)
        : meta.items;
    if (!targetItems.length) {
        setPlannerStatus('실행할 플랜을 찾을 수 없습니다.');
        return;
    }
    meta.status = 'running';
    meta.runningSituationIds = targetItems.map(item => item.situationId);
    window.PROJECT_PLANNER_VIEW = 'run';
    if (situationId) {
        window.PLANNER_RESULT_MODAL_SITUATION_ID = null;
        window.PLANNER_IMAGE_PREVIEW_KEY = null;
    }
    await savePlannerMeta(project, meta);
    window.PROJECT_PLANNER_META = meta;
    renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));

    const previousSettings = window.readCraftSettings ? window.readCraftSettings() : null;
    const previousVibeFile = window.VIBE_IMAGE_FILE || null;
    const previousPreciseFile = window.PRECISE_IMAGE_FILE || null;
    const plannerSettings = await loadPlannerSettings(project).catch(() => normalizePlannerSettings());
    try {
        for (const item of targetItems) {
            if (item.images?.length || item.selectedImage) {
                await clearPlannerItemImages(project, item);
            }
            item.status = 'running';
            item.generation.batchCount = String(item.count || meta.defaultCount || 1);
            applyPlannerSettingsToGeneration(item.generation, plannerSettings);
            await savePlannerMeta(project, meta);
            window.PROJECT_PLANNER_META = meta;
            renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
            setPlannerStatus(`${item.imageNumber}.webp 생성 중...`);

            if (window.applyCraftSettings) window.applyCraftSettings(item.generation);
            await applyPlannerReferenceFiles(item.generation);
            window.generateNaiImage({
                outputPrefix: getPlannerImagePrefix(project, item.imageNumber),
                v4PromptCharacters: item.generation.v4PromptCharacters || [],
                planner: {
                    projectId: project.id,
                    situationId: item.situationId,
                    imageNumber: item.imageNumber
                }
            });

            const result = await waitForPlannerQueueComplete();
            item.images = await listPlannerImages(project, item.imageNumber);
            item.status = result.cancelled ? 'paused' : (item.images.length ? 'done' : 'failed');
            meta.updatedAt = Date.now();
            await savePlannerMeta(project, meta);
            window.PROJECT_PLANNER_META = meta;
            renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
            if (result.cancelled) {
                meta.status = 'paused';
                break;
            }
        }

        if (meta.status !== 'paused') meta.status = targetItems.every(item => item.status === 'done') ? 'completed' : 'failed';
        delete meta.runningSituationIds;
        meta.updatedAt = Date.now();
        await savePlannerMeta(project, meta);
        window.PROJECT_PLANNER_META = meta;
        setPlannerStatus(meta.status);
    } finally {
        window.VIBE_IMAGE_FILE = previousVibeFile;
        window.PRECISE_IMAGE_FILE = previousPreciseFile;
        if (previousSettings && window.applyCraftSettings) window.applyCraftSettings(previousSettings);
        renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
    }
}

export async function selectPlannerImage(key) {
    const project = getActiveProject();
    const meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!project || !meta?.items) return;
    const item = meta.items.find(entry => Array.isArray(entry.images) && entry.images.includes(key));
    if (!item) return;
    item.selectedImage = key;
    meta.updatedAt = Date.now();
    await savePlannerMeta(project, meta);
    window.PROJECT_PLANNER_META = meta;
    renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
}

export async function selectPlannerImageFromPreview(key) {
    const project = getActiveProject();
    const meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!project || !meta?.items) return;
    const item = meta.items.find(entry => Array.isArray(entry.images) && entry.images.includes(key));
    if (!item) return;
    item.selectedImage = key;
    meta.updatedAt = Date.now();
    window.PLANNER_IMAGE_PREVIEW_KEY = null;
    await savePlannerMeta(project, meta);
    window.PROJECT_PLANNER_META = meta;
    syncPlannerResultModalSelection(item);
    renderPlannerPreviewOverlay();
}

export async function confirmPlannerSelection(situationId = null) {
    const project = getActiveProject();
    const meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!project || !meta?.items?.length) return;

    const character = getCharacterById(project, meta.characterId) || getCharacterById(project, meta.characterPrefix);
    if (!character) {
        setPlannerStatus('플래너 캐릭터를 찾을 수 없습니다.');
        return;
    }

    const selectedItems = meta.items.filter(item =>
        item.selectedImage && (!situationId || item.situationId === situationId)
    );
    if (!selectedItems.length) {
        setPlannerStatus('확정 전에 상황별 이미지를 하나 이상 선택하세요.');
        return;
    }

    for (const item of selectedItems) {
        const newKey = `${character.prefix}${item.imageNumber}.webp`;
        const imageRes = await fetch(getAssetUrl(item.selectedImage), { cache: 'no-store' });
        if (!imageRes.ok) throw new Error(`${item.selectedImage} 이미지를 읽지 못했습니다.`);
        const blob = await imageRes.blob();
        const sourceFile = new File([blob], getFileNameFromKey(item.selectedImage), { type: blob.type || 'image/png' });
        const finalFile = sourceFile.type === 'image/webp' ? sourceFile : await window.convertToWebP(sourceFile);
        const buffer = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('FileReader error'));
            reader.readAsArrayBuffer(finalFile);
        });
        const uploadRes = await fetch('/api/upload?_t=' + Date.now(), {
            method: 'PUT',
            headers: {
                'X-File-Name': encodeURIComponent(`${item.imageNumber}.webp`),
                'Content-Type': 'image/webp',
                'X-Absolute-Path': encodeURIComponent(newKey)
            },
            body: buffer,
            cache: 'no-store'
        });
        if (!uploadRes.ok) {
            const data = await uploadRes.json().catch(() => ({}));
            throw new Error(data.error || `${item.imageNumber}.webp 확정에 실패했습니다.`);
        }
        item.finalImage = newKey;
        item.status = 'confirmed';
    }

    await Promise.all(selectedItems.map(item => fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_folder', key: getPlannerImagePrefix(project, item.imageNumber) })
    }).catch(() => null)));

    const selectedIds = new Set(selectedItems.map(item => item.situationId));
    meta.items = meta.items.filter(item => !selectedIds.has(item.situationId));
    meta.status = meta.items.length ? 'draft' : 'confirmed';
    meta.updatedAt = Date.now();
    if (situationId) {
        window.PLANNER_RESULT_MODAL_SITUATION_ID = null;
        window.PLANNER_IMAGE_PREVIEW_KEY = null;
    }
    if (meta.items.length) {
        await savePlannerMeta(project, meta);
        window.PROJECT_PLANNER_META = meta;
        setPlannerStatus(`${selectedItems.length}개 플랜을 확정했습니다. 선택하지 않은 플랜은 남아 있습니다.`);
    } else {
        await fetch('/api/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'delete_folder', key: getPlannerPrefix(project) })
        }).catch(() => null);
        window.PROJECT_PLANNER_META = null;
        setPlannerStatus('선택한 플랜이 모두 확정되었습니다.');
    }
    clearProjectCaches(project.prefix, character.prefix, getPlannerPrefix(project));
    character.filesLoaded = false;
    await loadCharacterFiles(character, true).catch(() => []);
    renderSituationSection(PROJECT_SECTIONS.find(section => section.key === 'situation'));
}

function getSituationPromptIndicator(situation) {
    const prompt = getSituationPrompt(situation);
    const summary = combinePromptParts(prompt.composition, prompt.expression, prompt.action, prompt.background, prompt.negative);
    return summary || '프롬프트가 아직 없습니다.';
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
                        <div class="flex flex-col gap-2.5">
                            ${situations.map(situation => `
                                <button type="button" onclick="window.openSituationDetail('${escapeJsString(project.id)}', '${escapeJsString(situation.id)}')" class="group w-full min-h-[74px] text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3.5 py-3 flex items-center gap-3 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition">
                                    <span class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-900/70 text-[11px] font-extrabold text-gray-500 dark:text-gray-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">${escapeHtml(getSituationImageNumber(project, situation))}</span>
                                    <span class="min-w-0 flex-1">
                                        <span class="block text-sm font-bold text-gray-800 dark:text-gray-100 truncate">${escapeHtml(getSituationDisplayName(situation))}</span>
                                        <span class="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400 line-clamp-2">${escapeHtml(getSituationPromptIndicator(situation))}</span>
                                    </span>
                                    <span class="hidden sm:inline-flex flex-shrink-0 items-center text-[11px] font-bold text-gray-300 dark:text-gray-600 group-hover:text-indigo-400 dark:group-hover:text-indigo-500 transition">${escapeHtml(getSituationImageNumber(project, situation))}.webp</span>
                                </button>
                            `).join('')}
                        </div>
                    ` : ''}
                    ${!state.loading && !state.error && !situations.length ? renderEmptyState('등록된 상황이 없습니다.') : ''}
                </div>

                ${renderPlannerPanel(project, situations)}
                <div class="hidden">
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
        composition: situation?.prompt?.composition || '',
        expression: situation?.prompt?.expression || '',
        action: situation?.prompt?.action || '',
        background: situation?.prompt?.background || '',
        negative: situation?.prompt?.negative || ''
    };
}

function combinePromptParts(...values) {
    const seen = new Set();
    return values
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .filter(value => {
            const key = value.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .join(', ');
}

function getSituationCharacterRows(project, situation) {
    const imageIndex = getProjectItems(project, 'situations').findIndex(item => item.id === situation?.id);
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
                            <label for="situation-composition-input" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">구도</label>
                            <textarea id="situation-composition-input" class="w-full min-h-[140px] resize-y p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-sm leading-6 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="상황에 필요한 구도 프롬프트">${escapeHtml(prompt.composition)}</textarea>
                        </div>
                        <div>
                            <label for="situation-expression-input" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">표정</label>
                            <textarea id="situation-expression-input" class="w-full min-h-[140px] resize-y p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-sm leading-6 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="상황에 필요한 표정 프롬프트">${escapeHtml(prompt.expression)}</textarea>
                        </div>
                        <div>
                            <label for="situation-action-input" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">행위</label>
                            <textarea id="situation-action-input" class="w-full min-h-[140px] resize-y p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-sm leading-6 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="상황에 필요한 행위 프롬프트">${escapeHtml(prompt.action)}</textarea>
                        </div>
                        <div>
                            <label for="situation-negative-input" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">부정 프롬프트</label>
                            <textarea id="situation-negative-input" class="w-full min-h-[140px] resize-y p-3 rounded-lg border border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-900/10 text-sm leading-6 text-red-700 dark:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="이 상황에서 제외할 태그">${escapeHtml(prompt.negative)}</textarea>
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

    const routeState = { projectView: 'situation-detail', projectId: project.id, situationId: situation.id };
    const routeHash = `#project/${project.id}/situation/${encodeURIComponent(situation.id)}`;
    if (!skipHistory) setProjectRoute(routeState, routeHash);
    else rememberProjectRoute(routeState, routeHash);
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
        replaceProjectRoute(
            { projectView: 'section', projectId: project.id, projectSection: 'situation' },
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
    const compositionInput = document.getElementById('situation-composition-input');
    const expressionInput = document.getElementById('situation-expression-input');
    const actionInput = document.getElementById('situation-action-input');
    const negativeInput = document.getElementById('situation-negative-input');
    const button = document.getElementById('situation-prompt-save-btn');
    const status = document.getElementById('situation-prompt-save-status');
    if (!project || !situation || !compositionInput || !expressionInput || !actionInput || !negativeInput) return;

    const previousButtonHtml = button?.innerHTML || '';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> 저장 중';
        refreshProjectIcons();
    }
    if (status) status.textContent = '';

    try {
        situation.prompt = {
            ...(situation.prompt || {}),
            composition: compositionInput.value.trim(),
            expression: expressionInput.value.trim(),
            action: actionInput.value.trim(),
            negative: negativeInput.value.trim()
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

function getCraftPromptFields() {
    return {
        style: document.getElementById('prompt-style')?.value.trim() || '',
        composition: document.getElementById('prompt-composition')?.value.trim() || '',
        character: document.getElementById('prompt-character')?.value.trim() || '',
        clothing: document.getElementById('prompt-clothing')?.value.trim() || '',
        expression: document.getElementById('prompt-expression')?.value.trim() || '',
        action: document.getElementById('prompt-action')?.value.trim() || '',
        background: document.getElementById('prompt-background')?.value.trim() || '',
        negative: document.getElementById('nai-negative')?.value.trim() || ''
    };
}

function getCraftSelectedPrefix(selectId) {
    return document.getElementById(selectId)?.value || '';
}

async function getCraftSelectedProject() {
    const projectPrefix = getCraftSelectedPrefix('craft-project-select');
    if (!projectPrefix) throw new Error('먼저 이미지 생성 화면에서 프로젝트를 선택하세요.');

    await loadProjects();
    const project = getProjectByPrefix(projectPrefix);
    if (!project) throw new Error('선택한 프로젝트를 찾지 못했습니다.');
    return project;
}

function setCraftPromptSaveStatus(message, isError = false) {
    const status = document.getElementById('craft-prompt-save-status');
    if (!status) return;

    status.textContent = message;
    status.classList.toggle('text-red-500', isError);
    status.classList.toggle('dark:text-red-400', isError);
    status.classList.toggle('text-gray-500', !isError);
    status.classList.toggle('dark:text-gray-400', !isError);
}

export async function saveCraftPromptToProjectStyle() {
    setCraftPromptSaveStatus('저장 중...');

    try {
        const project = await getCraftSelectedProject();
        const fields = getCraftPromptFields();
        await uploadProjectStylePrompt(project, fields.style);
        setCraftPromptSaveStatus('프로젝트 그림체 저장 완료');
        if (window.currentPrefix === project.prefix && window.loadPath) window.loadPath(project.prefix, true);
    } catch (err) {
        setCraftPromptSaveStatus(err.message || '프로젝트 그림체 저장 실패', true);
    }
}

export async function saveCraftPromptToCharacterParts() {
    setCraftPromptSaveStatus('저장 중...');

    try {
        const project = await getCraftSelectedProject();
        const characterPrefix = getCraftSelectedPrefix('craft-char-select');
        if (!characterPrefix) throw new Error('저장할 캐릭터를 선택하세요.');

        await loadProjectCharacters(project, true);
        const character = getCharacterById(project, characterPrefix) || {
            id: characterPrefix,
            prefix: characterPrefix,
            folderName: characterPrefix.split('/').filter(Boolean).pop()
        };
        const meta = await loadCharacterMeta(character).catch(() => ({}));
        const fields = getCraftPromptFields();
        const parts = {
            ...(meta.parts || {}),
            character: fields.character,
            clothing: fields.clothing,
            expression: fields.expression,
            negative: fields.negative
        };

        await saveCharacterMeta(character, {
            ...meta,
            prompt: parts.character,
            parts,
            updatedAt: Date.now()
        });
        setCraftPromptSaveStatus('캐릭터 프롬프트 저장 완료');
    } catch (err) {
        setCraftPromptSaveStatus(err.message || '캐릭터 프롬프트 저장 실패', true);
    }
}

export async function saveCraftPromptToSituation() {
    setCraftPromptSaveStatus('저장 중...');

    try {
        const project = await getCraftSelectedProject();
        const situationId = getCraftSelectedPrefix('craft-situation-select');
        if (!situationId) throw new Error('저장할 상황을 선택하세요.');

        await loadProjectSituations(project, true);
        const situation = getSituationById(project, situationId);
        if (!situation) throw new Error('선택한 상황을 찾지 못했습니다.');

        const fields = getCraftPromptFields();
        situation.prompt = {
            ...(situation.prompt || {}),
            composition: fields.composition,
            expression: fields.expression,
            action: fields.action,
            background: fields.background,
            negative: fields.negative
        };
        situation.updatedAt = Date.now();

        await saveProjectSituations(project);
        setCraftPromptSaveStatus('상황 프롬프트 저장 완료');
    } catch (err) {
        setCraftPromptSaveStatus(err.message || '상황 프롬프트 저장 실패', true);
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
