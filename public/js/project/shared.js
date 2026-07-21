import { loadPlannerForSelectedCharacter } from './planner.js?v=internal-folder-filter-20260721a';

export const EXCLUDED_PROJECT_FOLDERS = new Set([
    'logs',
    '_temp_craft',
    '_planner_temp_image',
    'editor_session',
    'editor_sessions',
    '__editor_sessions',
    '__editor_backups',
    '_guest_posts'
]);

export const PROJECT_SECTIONS = [
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
    },
    {
        key: 'planner',
        title: '플래너',
        icon: 'calendar-check',
        emptyText: '생성된 플랜이 없습니다.'
    },
    {
        key: 'image-editor',
        title: '편집기',
        icon: 'scissors',
        emptyText: '편집할 이미지를 선택하세요.'
    },
    {
        key: 'posts',
        itemKey: 'posts',
        title: '게시글',
        icon: 'newspaper',
        emptyText: '등록된 게시글이 없습니다.'
    }
];

export const PROJECT_PROMPT_FIELDS = [
    {
        key: 'system',
        title: '시스템 프롬프트',
        fileName: 'prompt.md',
        icon: 'square-terminal',
        placeholder: '프로젝트 전체에 적용할 시스템 프롬프트를 입력하세요.'
    },
    {
        key: 'start',
        title: '시작 상황',
        fileName: 'start_situation.md',
        icon: 'circle-play',
        placeholder: '이 프로젝트의 시작 상황을 입력하세요.'
    },
    {
        key: 'description',
        title: '프로젝트 설명',
        fileName: 'project_description.md',
        icon: 'info',
        placeholder: '프로젝트 설명, 배경, 목표 등을 입력하세요.'
    }
];

export const CHARACTER_IMAGE_EXTENSIONS = new Set(['webp', 'png', 'jpg', 'jpeg']);
export const MAX_V4_PROMPT_CHARACTERS = 6;

export function getProjectRoot() {
    return document.getElementById('main-project-content');
}

export function getProjectSectionScrollCache() {
    if (!window.PROJECT_SECTION_SCROLL_CACHE || typeof window.PROJECT_SECTION_SCROLL_CACHE !== 'object') {
        window.PROJECT_SECTION_SCROLL_CACHE = {};
    }
    return window.PROJECT_SECTION_SCROLL_CACHE;
}

export function getProjectSectionScrollKey(projectId, sectionKey) {
    return `${projectId || getDefaultProjectId()}:${sectionKey || ''}`;
}

export function rememberProjectSectionScroll(projectId, sectionKey, elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;

    getProjectSectionScrollCache()[getProjectSectionScrollKey(projectId, sectionKey)] = element.scrollTop || 0;
}

export function getRememberedProjectSectionScroll(projectId, sectionKey) {
    const value = getProjectSectionScrollCache()[getProjectSectionScrollKey(projectId, sectionKey)];
    return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function rememberProjectRoute(state, hash) {
    window.PROJECT_LAST_STATE = { tab: 'project', ...state };
    window.PROJECT_LAST_HASH = hash || '#project';
}

export function setProjectRoute(state, hash) {
    rememberProjectRoute(state, hash);
    history.pushState(window.PROJECT_LAST_STATE, '', window.PROJECT_LAST_HASH);
}

export function replaceProjectRoute(state, hash) {
    rememberProjectRoute(state, hash);
    history.replaceState(window.PROJECT_LAST_STATE, '', window.PROJECT_LAST_HASH);
}

export function refreshProjectIcons() {
    if (window.lucide) window.lucide.createIcons();
}

export function getProjects() {
    return Array.isArray(window.PROJECTS) ? window.PROJECTS : [];
}

export function getProjectById(projectId) {
    return getProjects().find(project => project.id === projectId) || getProjects()[0];
}

export function getProjectByPrefix(projectPrefix) {
    const decodedPrefix = decodeURIComponent(projectPrefix || '');
    return getProjects().find(project => project.prefix === decodedPrefix);
}

export function getActiveProject() {
    return getProjectById(window.PROJECT_ACTIVE_PROJECT_ID);
}

export function getProjectItems(project, itemKey) {
    return Array.isArray(project?.[itemKey]) ? project[itemKey] : [];
}

export function getDefaultProjectId() {
    return getProjects()[0]?.id || '';
}

export function getProjectBasePrefix() {
    return window.ROOT_PATH || '';
}

export function getProjectDisplayName(folderPrefix, folderName) {
    const alias = window.getAliasOnly ? window.getAliasOnly(folderPrefix, true) : null;
    return alias || folderName;
}

export function getFolderDisplayName(folderPrefix, folderName) {
    const alias = window.getAliasOnly ? window.getAliasOnly(folderPrefix, true) : null;
    return alias || folderName;
}

export function isVisibleProjectChildFolder(folderName) {
    return folderName && !folderName.startsWith('.') && !EXCLUDED_PROJECT_FOLDERS.has(folderName);
}

export async function saveProjectAlias(key, alias) {
    const res = await fetch('/api/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, alias })
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '이름 저장 실패');
    }
}

export async function createProjectFolder(folderName) {
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

export async function createProjectChildFolder(project, folderName) {
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

export async function renameProjectFolder(oldPrefix, newPrefix) {
    const res = await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename_folder', key: oldPrefix, newKey: newPrefix })
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '프로젝트 경로 변경 실패');
    }
}

export async function deleteProjectFolder(prefix) {
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

export function clearRootProjectCache() {
    if (window.FOLDER_DATA_CACHE) delete window.FOLDER_DATA_CACHE[getProjectBasePrefix()];
    window.PROJECTS = null;
}

export function clearProjectCaches(...prefixes) {
    clearRootProjectCache();
    if (!window.FOLDER_DATA_CACHE) return;
    prefixes.forEach(prefix => {
        if (prefix !== undefined && window.FOLDER_DATA_CACHE[prefix]) delete window.FOLDER_DATA_CACHE[prefix];
    });
}

export function clearFolderDataCaches(...prefixes) {
    if (!window.FOLDER_DATA_CACHE) return;
    prefixes.forEach(prefix => {
        if (prefix !== undefined && window.FOLDER_DATA_CACHE[prefix]) delete window.FOLDER_DATA_CACHE[prefix];
    });
}

export function normalizeProjectFolderName(value) {
    return value.trim().replace(/^\/+|\/+$/g, '');
}

export function isInvalidProjectFolderName(value) {
    return !value || value.includes('/') || value.includes('\\') || value.startsWith('.') || EXCLUDED_PROJECT_FOLDERS.has(value);
}

export function getSituationMetaKey(project) {
    return `${project.prefix}_situations_meta.json`;
}

export function getCharacterMetaKey(character) {
    return `${character.prefix}_character_meta.json`;
}

export function getPlannerPrefix(project) {
    return `${project.prefix}_planner_temp_image/`;
}

export function getPlannerMetaKey(project, characterId = '') {
    const normalizedCharacterId = String(characterId || '').trim().replace(/[\\/]+/g, '_');
    return normalizedCharacterId
        ? `${getPlannerPrefix(project)}plans/${normalizedCharacterId}_planner_meta.json`
        : `${getPlannerPrefix(project)}_planner_meta.json`;
}

export function getPlannerSettingsKey(project) {
    return `${getPlannerPrefix(project)}_planner_settings.json`;
}

export function getProjectBackgroundPromptsKey(project) {
    return `${project.prefix}_background_prompts.json`;
}

export const DEFAULT_PLANNER_RESOLUTION = '832x1216';
export const PLANNER_CHARACTER_CACHE_KEY = 'imggul_planner_selected_characters';
export const SITUATION_RATING_CACHE_KEY = 'imggul_situation_selected_ratings';

export const DEFAULT_PLANNER_SETTINGS = {
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

export const PLANNER_MODEL_OPTIONS = [
    ['nai-diffusion-4-5-full', 'NAI Diffusion Anime V4.5 (Full)'],
    ['nai-diffusion-4-5-curated', 'NAI Diffusion Anime V4.5 (Curated)'],
    ['nai-diffusion-4-full', 'NAI Diffusion Anime V4.0 (Full)'],
    ['nai-diffusion-4-curated-preview', 'NAI Diffusion Anime V4.0 (Curated Preview)'],
    ['nai-diffusion-3', 'NAI Diffusion Anime V3'],
    ['nai-diffusion-furry-3', 'NAI Diffusion Furry V3']
];

export const PLANNER_RESOLUTION_OPTIONS = [
    ['832x1216', '세로형 832x1216'],
    ['1024x1024', '정방형 1024x1024'],
    ['1216x832', '가로형 1216x832']
];

export const PLANNER_SAMPLER_OPTIONS = [
    ['k_euler_ancestral', 'Euler Ancestral'],
    ['k_euler', 'Euler'],
    ['k_dpmpp_2s_ancestral', 'DPM++ 2S Ancestral'],
    ['k_dpmpp_2m', 'DPM++ 2M'],
    ['k_dpmpp_sde', 'DPM++ SDE']
];

export function getCharacterById(project, characterId) {
    const decodedId = decodeURIComponent(characterId || '');
    return getProjectItems(project, 'characters').find(character =>
        character.id === decodedId ||
        character.prefix === decodedId ||
        character.folderName === decodedId
    );
}

export function getFileNameFromKey(key) {
    return String(key || '').split('/').pop() || '';
}

export function getFileBaseName(fileName) {
    return String(fileName || '').replace(/\.[^/.]+$/, '').toLowerCase();
}

export function getFileExtension(fileName) {
    return String(fileName || '').split('.').pop().toLowerCase();
}

export function normalizePlannerV4PromptRows(rows = []) {
    return Array.isArray(rows)
        ? rows.map(row => ({
            subject: String(row?.subject || '').trim(),
            clothing: String(row?.clothing || '').trim(),
            expression: String(row?.expression || '').trim(),
            action: String(row?.action || '').trim(),
            negative: String(row?.negative || '').trim()
        })).filter(row => [row.subject, row.clothing, row.expression, row.action, row.negative].some(Boolean)).slice(0, MAX_V4_PROMPT_CHARACTERS)
        : [];
}

export function createPromptVariantId(prefix = 'variant') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultBackgroundPrompt() {
    return {
        id: 'default',
        name: 'White background',
        prompt: 'white background',
        updatedAt: Date.now()
    };
}

export function normalizeProjectBackgroundPrompts(data = {}) {
    const source = Array.isArray(data?.backgrounds) ? data.backgrounds : [];
    const backgrounds = source.map((background, index) => ({
        id: String(background?.id || createPromptVariantId('background')),
        name: String(background?.name || background?.label || `Background ${index + 1}`).trim() || `Background ${index + 1}`,
        prompt: String(background?.prompt || '').trim(),
        updatedAt: background?.updatedAt || Date.now()
    })).filter(background => background.name || background.prompt);

    const activeBackgroundId = backgrounds.some(background => background.id === data?.activeBackgroundId)
        ? data.activeBackgroundId
        : backgrounds[0]?.id || '';

    return {
        backgrounds,
        activeBackgroundId
    };
}

export function getProjectBackgroundPrompts(project) {
    return Array.isArray(project?.backgroundPrompts) ? project.backgroundPrompts : [];
}

export function getProjectBackgroundPromptData(project) {
    return normalizeProjectBackgroundPrompts({
        backgrounds: getProjectBackgroundPrompts(project),
        activeBackgroundId: project?.activeBackgroundPromptId || ''
    });
}

export function getActiveProjectBackgroundPrompt(data = {}) {
    const normalized = normalizeProjectBackgroundPrompts(data);
    return normalized.backgrounds.find(background => background.id === normalized.activeBackgroundId)
        || normalized.backgrounds[0]
        || null;
}

export function getDefaultPlannerBackgroundPrompt(project) {
    const data = getProjectBackgroundPromptData(project);
    return getActiveProjectBackgroundPrompt(data)?.prompt || createDefaultBackgroundPrompt().prompt;
}

export function normalizeCharacterPromptParts(parts = {}, fallbackPrompt = '') {
    return {
        ...(parts || {}),
        character: String(parts?.character || fallbackPrompt || '').trim(),
        clothing: String(parts?.clothing || '').trim(),
        negative: String(parts?.negative || '').trim()
    };
}

export function normalizeCharacterPromptVariants(meta = {}) {
    const source = Array.isArray(meta.promptVariants) ? meta.promptVariants : [];
    const variants = source.map((variant, index) => {
        const parts = normalizeCharacterPromptParts(variant?.parts || {}, variant?.prompt || '');
        return {
            id: String(variant?.id || `outfit-${index + 1}`),
            name: String(variant?.name || variant?.label || `Outfit ${index + 1}`),
            prompt: parts.character,
            parts,
            updatedAt: variant?.updatedAt || meta.updatedAt || Date.now()
        };
    });

    if (!variants.length) {
        const parts = normalizeCharacterPromptParts(meta.parts || {}, meta.prompt || '');
        variants.push({
            id: 'default',
            name: 'Default',
            prompt: parts.character,
            parts,
            updatedAt: meta.updatedAt || Date.now()
        });
    }

    return variants;
}

export function getActiveCharacterPromptVariant(meta = {}) {
    const variants = normalizeCharacterPromptVariants(meta);
    return variants.find(variant => variant.id === meta.activePromptVariantId) || variants[0];
}

export function normalizeSituationPrompt(prompt = {}) {
    return {
        composition: String(prompt?.composition || '').trim(),
        clothing: String(prompt?.clothing || '').trim(),
        expression: String(prompt?.expression || '').trim(),
        action: String(prompt?.action || '').trim(),
        background: String(prompt?.background || '').trim(),
        negative: String(prompt?.negative || '').trim()
    };
}

export function getSituationRating(situation = {}) {
    return String(situation?.rating || situation?.type || 'sfw').toLowerCase() === 'nsfw' ? 'nsfw' : 'sfw';
}

export function normalizeSituationPromptVariants(situation = {}) {
    const source = Array.isArray(situation.promptVariants) ? situation.promptVariants : [];
    const variants = source.map((variant, index) => {
        const prompt = normalizeSituationPrompt(variant?.prompt || {});
        const generation = variant?.generation || {};
        const v4PromptCharacters = normalizePlannerV4PromptRows(
            generation.v4PromptCharacters || generation.v4_prompt || variant?.v4PromptCharacters || variant?.v4_prompt || []
        );
        return {
            id: String(variant?.id || `composition-${index + 1}`),
            name: String(variant?.name || variant?.label || `Composition ${index + 1}`),
            prompt,
            generation: {
                res: generation.res || variant?.resolution || variant?.res || situation.resolution || situation.res || DEFAULT_PLANNER_RESOLUTION,
                v4PromptCharacters,
                v4_prompt: v4PromptCharacters
            },
            updatedAt: variant?.updatedAt || situation.updatedAt || Date.now()
        };
    });

    if (!variants.length) {
        const prompt = normalizeSituationPrompt(situation.prompt || {});
        const generation = situation.generation || {};
        const v4PromptCharacters = normalizePlannerV4PromptRows(
            generation.v4PromptCharacters || generation.v4_prompt || situation.v4PromptCharacters || situation.v4_prompt || []
        );
        variants.push({
            id: 'default',
            name: 'Default',
            prompt,
            generation: {
                res: generation.res || situation.resolution || situation.res || DEFAULT_PLANNER_RESOLUTION,
                v4PromptCharacters,
                v4_prompt: v4PromptCharacters
            },
            updatedAt: situation.updatedAt || Date.now()
        });
    }

    return variants;
}

export function getActiveSituationPromptVariant(situation = {}) {
    const variants = normalizeSituationPromptVariants(situation);
    return variants.find(variant => variant.id === situation.activePromptVariantId) || variants[0];
}

export function getSituationGeneration(situation = {}) {
    const activeVariant = getActiveSituationPromptVariant(situation);
    if (activeVariant) return activeVariant.generation;

    const generation = situation.generation || {};
    const v4PromptCharacters = normalizePlannerV4PromptRows(
        generation.v4PromptCharacters || generation.v4_prompt || situation.v4PromptCharacters || situation.v4_prompt || []
    );
    return {
        res: generation.res || situation.resolution || situation.res || DEFAULT_PLANNER_RESOLUTION,
        v4PromptCharacters,
        v4_prompt: v4PromptCharacters
    };
}

export function sortPlannerItems(items = []) {
    return [...items].sort((a, b) => {
        const aIndex = Number.isFinite(Number(a?.situationIndex)) ? Number(a.situationIndex) : Number.MAX_SAFE_INTEGER;
        const bIndex = Number.isFinite(Number(b?.situationIndex)) ? Number(b.situationIndex) : Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
        const aNumber = Number.isFinite(Number(a?.imageNumber)) ? Number(a.imageNumber) : Number.MAX_SAFE_INTEGER;
        const bNumber = Number.isFinite(Number(b?.imageNumber)) ? Number(b.imageNumber) : Number.MAX_SAFE_INTEGER;
        if (aNumber !== bNumber) return aNumber - bNumber;
        return String(a?.situationId || '').localeCompare(String(b?.situationId || ''));
    });
}

export function normalizePlannerMeta(meta) {
    if (!meta || typeof meta !== 'object') return meta;
    if (Array.isArray(meta.items)) meta.items = sortPlannerItems(meta.items);
    return meta;
}

export function readPlannerCharacterCache() {
    try {
        return JSON.parse(localStorage.getItem(PLANNER_CHARACTER_CACHE_KEY) || '{}') || {};
    } catch {
        return {};
    }
}

export function getCachedPlannerCharacterId(project) {
    return project?.id ? readPlannerCharacterCache()[project.id] || '' : '';
}

export function getSelectedPlannerCharacterId(project = getActiveProject()) {
    return document.getElementById('planner-character-select')?.value
        || window.PROJECT_PLANNER_SELECTED_CHARACTER_ID
        || getCachedPlannerCharacterId(project)
        || window.PROJECT_PLANNER_META?.characterId
        || getProjectItems(project, 'characters')[0]?.id
        || '';
}

export function setCachedPlannerCharacterId(project, characterId) {
    if (!project?.id || !characterId) return;
    const cache = readPlannerCharacterCache();
    cache[project.id] = characterId;
    try {
        localStorage.setItem(PLANNER_CHARACTER_CACHE_KEY, JSON.stringify(cache));
    } catch {}
}

export function cachePlannerCharacterSelection() {
    const project = getActiveProject();
    const characterId = document.getElementById('planner-character-select')?.value || '';
    setCachedPlannerCharacterId(project, characterId);
    window.PROJECT_PLANNER_SELECTED_CHARACTER_ID = characterId;
    window.loadPlannerForSelectedCharacter?.();
}

export function readSituationRatingCache() {
    try {
        return JSON.parse(localStorage.getItem(SITUATION_RATING_CACHE_KEY) || '{}') || {};
    } catch {
        return {};
    }
}

export function getCachedSituationRating(project) {
    return project?.id ? getSituationRating({ rating: readSituationRatingCache()[project.id] }) : 'sfw';
}

export function setCachedSituationRating(project, rating) {
    if (!project?.id) return;
    const cache = readSituationRatingCache();
    cache[project.id] = getSituationRating({ rating });
    try {
        localStorage.setItem(SITUATION_RATING_CACHE_KEY, JSON.stringify(cache));
    } catch {}
}

export function isImageFile(file) {
    return CHARACTER_IMAGE_EXTENSIONS.has(getFileExtension(getFileNameFromKey(file?.key)));
}

export function normalizeLoadOptions(options = {}) {
    return typeof options === 'boolean' ? { force: options } : (options || {});
}

export async function loadCharacterFiles(character, options = {}) {
    const { force = false, signal } = normalizeLoadOptions(options);
    if (!character?.prefix) return [];
    if (!force && character.filesLoaded) return Array.isArray(character.files) ? character.files : [];

    const res = await fetch(`/api/list?prefix=${encodeURIComponent(character.prefix)}&_t=${Date.now()}`, {
        cache: 'no-store',
        signal
    });
    if (!res.ok) throw new Error('캐릭터 이미지 목록을 불러오지 못했습니다.');

    const data = await res.json();
    character.files = (data.files || [])
        .filter(file => isImageFile(file))
        .sort((a, b) => getFileNameFromKey(a.key).localeCompare(getFileNameFromKey(b.key), undefined, { numeric: true }));
    character.filesLoaded = true;
    return character.files;
}

export async function loadCharacterMeta(character, options = {}) {
    const { force = false, signal } = normalizeLoadOptions(options);
    if (!character?.prefix) return {};
    if (!force && character.metaLoaded) return character.meta || {};

    const metaKey = getCharacterMetaKey(character);
    const res = await fetch(`/api/db/json-document?type=character_meta&key=${encodeURIComponent(metaKey)}&_t=${Date.now()}`, {
        cache: 'no-store',
        signal
    });
    if (res.status === 404) {
        character.meta = {};
        character.metaLoaded = true;
        return character.meta;
    }
    if (!res.ok) throw new Error('캐릭터 프롬프트를 불러오지 못했습니다.');

    const payload = await res.json();
    character.meta = payload.data || {};
    character.metaLoaded = true;
    return character.meta;
}

export async function saveCharacterMeta(character, meta) {
    const metaKey = getCharacterMetaKey(character);
    const res = await fetch('/api/db/json-document?_t=' + Date.now(), {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({ type: 'character_meta', key: metaKey, data: meta || {} }),
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
                situations: [],
                posts: []
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
    const res = await fetch(`/api/db/json-document?type=situations_meta&key=${encodeURIComponent(metaKey)}&_t=${Date.now()}`, { cache: 'no-store' });

    if (res.status === 404) {
        project.situations = [];
        project.situationsLoaded = true;
        return project.situations;
    }

    if (!res.ok) throw new Error('상황 목록을 불러오지 못했습니다.');

    const payload = await res.json();
    const data = payload.data || {};
    project.situations = normalizeProjectSituations(Array.isArray(data.situations) ? data.situations : []);
    project.situationsLoaded = true;

    return project.situations;
}

export function normalizeProjectSituations(situations) {
    return situations.map((situation, index) => {
        const id = situation?.id || situation?.folderName || `situation-${index + 1}`;
        const alias = situation?.alias || '';
        const name = situation?.name || alias || id;
        const generation = getSituationGeneration(situation);
        const prompt = normalizeSituationPrompt({
            ...(situation?.prompt || {}),
            composition: situation?.prompt?.composition || situation?.composition || '',
            clothing: situation?.prompt?.clothing || situation?.clothing || '',
            expression: situation?.prompt?.expression || situation?.expression || '',
            action: situation?.prompt?.action || situation?.action || '',
            background: situation?.prompt?.background || situation?.background || '',
            negative: situation?.prompt?.negative || situation?.negative || ''
        });
        return {
            ...situation,
            id,
            folderName: situation?.folderName || id,
            name,
            alias,
            rating: getSituationRating(situation),
            imageNumber: Number.isFinite(Number(situation?.imageNumber)) ? Number(situation.imageNumber) : index,
            prompt,
            promptVariants: normalizeSituationPromptVariants({ ...situation, prompt }),
            generation,
            resolution: generation.res,
            v4PromptCharacters: generation.v4PromptCharacters,
            v4_prompt: generation.v4PromptCharacters,
            createdAt: situation?.createdAt || Date.now()
        };
    });
}

export async function saveProjectSituations(project) {
    const metaKey = getSituationMetaKey(project);
    const res = await fetch('/api/db/json-document?_t=' + Date.now(), {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
            type: 'situations_meta',
            key: metaKey,
            data: { situations: getProjectItems(project, 'situations') }
        }),
        cache: 'no-store'
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '상황 저장 실패');
    }
}

export async function loadProjectBackgroundPrompts(project, options = {}) {
    const { force = false, signal } = normalizeLoadOptions(options);
    if (!project?.prefix) return normalizeProjectBackgroundPrompts();
    if (!force && project.backgroundPromptsLoaded) return getProjectBackgroundPromptData(project);

    const key = getProjectBackgroundPromptsKey(project);
    const res = await fetch(`/api/db/json-document?type=background_prompts&key=${encodeURIComponent(key)}&_t=${Date.now()}`, {
        cache: 'no-store',
        signal
    });

    if (res.status === 404) {
        const data = normalizeProjectBackgroundPrompts();
        project.backgroundPrompts = data.backgrounds;
        project.activeBackgroundPromptId = data.activeBackgroundId;
        project.backgroundPromptsLoaded = true;
        return data;
    }

    if (!res.ok) throw new Error('배경 프롬프트 목록을 불러오지 못했습니다.');

    const payload = await res.json();
    const data = normalizeProjectBackgroundPrompts(payload.data || {});
    project.backgroundPrompts = data.backgrounds;
    project.activeBackgroundPromptId = data.activeBackgroundId;
    project.backgroundPromptsLoaded = true;

    return data;
}

export async function saveProjectBackgroundPrompts(project, data = {}) {
    if (!project?.prefix) throw new Error('프로젝트 경로를 찾을 수 없습니다.');

    const normalized = normalizeProjectBackgroundPrompts(data);
    const key = getProjectBackgroundPromptsKey(project);
    const res = await fetch('/api/db/json-document?_t=' + Date.now(), {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
            type: 'background_prompts',
            key,
            data: normalized
        }),
        cache: 'no-store'
    });

    if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || '배경 프롬프트 저장에 실패했습니다.');
    }

    project.backgroundPrompts = normalized.backgrounds;
    project.activeBackgroundPromptId = normalized.activeBackgroundId;
    project.backgroundPromptsLoaded = true;
    return normalized;
}

export function renderEmptyState(message) {
    return `
        <div class="border border-dashed border-gray-200 dark:border-gray-700 rounded-lg bg-white/60 dark:bg-gray-800/40 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center min-h-24">
            ${escapeHtml(message)}
        </div>
    `;
}

export function getItemLabel(item, fallback) {
    if (typeof item === 'string') return item;
    if (item?.alias && item?.folderName) return `${item.name} (${item.folderName})`;
    return item?.name || item?.title || item?.content || fallback;
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function escapeJsString(value) {
    return String(value ?? '').replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

export function getAssetUrl(key) {
    return `/${encodeURI(key)}`;
}

export function getAssetVersion(file) {
    if (file?.etag) return String(file.etag).replaceAll('"', '');
    if (file?.uploaded) {
        const timestamp = new Date(file.uploaded).getTime();
        if (Number.isFinite(timestamp)) return String(timestamp);
    }
    return '';
}

export function getVersionedAssetUrl(file) {
    if (!file?.key) return '';
    const baseUrl = getAssetUrl(file.key);
    const version = getAssetVersion(file);
    return version ? `${baseUrl}?v=${encodeURIComponent(version)}` : baseUrl;
}

export function getSituationDisplayName(situation) {
    return situation?.alias || situation?.name || situation?.id || '상황 이름';
}

export function getSituationImageNumber(project, situation) {
    const situations = getProjectItems(project, 'situations');
    const index = situations.findIndex(item => item.id === situation?.id);
    const imageNumber = Number(situation?.imageNumber);
    return Number.isFinite(imageNumber) ? imageNumber : (index >= 0 ? index : situations.length);
}

export function getSituationImageKey(project, situation) {
    return `${project.prefix}${getSituationImageNumber(project, situation)}.webp`;
}

export function getNextSituationImageNumber(project) {
    const usedNumbers = getProjectItems(project, 'situations')
        .map(situation => Number(situation.imageNumber))
        .filter(number => Number.isFinite(number));
    return usedNumbers.length ? Math.max(...usedNumbers) + 1 : getProjectItems(project, 'situations').length;
}

export function getNextSituationFolderName(project) {
    const usedNumbers = getProjectItems(project, 'situations')
        .map(situation => String(situation.folderName || situation.id || '').trim())
        .filter(value => /^\d+$/.test(value))
        .map(value => Number.parseInt(value, 10))
        .filter(number => Number.isFinite(number));
    const nextNumber = usedNumbers.length ? Math.max(...usedNumbers) + 1 : getProjectItems(project, 'situations').length;
    return String(nextNumber);
}

export function getSituationFolderNumber(value) {
    const normalized = String(value || '').trim();
    return /^\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : null;
}

export function renderCharacterName(character) {
    if (character.alias) {
        return `
            <span class="block text-xs font-bold text-gray-800 dark:text-gray-100 truncate">${escapeHtml(character.name)}</span>
            <span class="block text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">경로: ${escapeHtml(character.folderName)}</span>
        `;
    }

    return `<span class="block text-xs font-bold text-gray-800 dark:text-gray-100 truncate">${escapeHtml(character.folderName || character.name || '캐릭터 이름')}</span>`;
}

export function renderProjectShell(content) {
    const root = getProjectRoot();
    if (!root) return;

    root.className = 'flex flex-col absolute inset-0 w-full h-full bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100';
    root.innerHTML = content;
    refreshProjectIcons();
}

export function initPromptSectionInput() {
    const input = document.getElementById('project-prompt-input');
    const count = document.getElementById('project-prompt-count');
    if (!input || !count) return;

    const updateCount = () => {
        count.textContent = `${Array.from(input.value).length.toLocaleString()}자`;
    };

    input.addEventListener('input', () => {
        const values = getProjectPromptFieldValues();
        values[getProjectPromptFieldConfig().key] = input.value;
        updateCount();
    });
    updateCount();
}

export async function loadProjectPromptMarkdown(project) {
    return await loadProjectMarkdownFile(project, 'prompt.md');
}

export async function loadProjectStylePrompt(project, options = {}) {
    return await loadProjectMarkdownFile(project, 'style_prompt.md', options);
}

export async function loadProjectMarkdownFile(project, fileName, options = {}) {
    const { signal } = normalizeLoadOptions(options);
    if (!project?.prefix) return '';

    const key = `${project.prefix}${fileName}`;
    const res = await fetch(`${getAssetUrl(key)}?_t=${Date.now()}`, {
        cache: 'no-store',
        signal
    });
    if (res.status === 404) return '';
    if (!res.ok) throw new Error(`${fileName}를 불러오지 못했습니다.`);

    return await res.text();
}

export function getProjectPromptFieldConfig(fieldKey = window.PROJECT_ACTIVE_PROMPT_FIELD) {
    return PROJECT_PROMPT_FIELDS.find(field => field.key === fieldKey) || PROJECT_PROMPT_FIELDS[0];
}

export function getProjectPromptFieldValues() {
    if (!window.PROJECT_PROMPT_FIELD_VALUES || typeof window.PROJECT_PROMPT_FIELD_VALUES !== 'object') {
        window.PROJECT_PROMPT_FIELD_VALUES = {};
    }
    return window.PROJECT_PROMPT_FIELD_VALUES;
}

export function isSafeMarkdownUrl(value) {
    const url = String(value || '').trim();
    if (!url) return false;
    return /^(https?:\/\/|\/(?!\/)|\.{0,2}\/|#|[^:]+$)/i.test(url);
}

export function renderInlineMarkdown(value) {
    const placeholders = [];
    const stash = (html) => {
        placeholders.push(html);
        return `\u0000${placeholders.length - 1}\u0000`;
    };

    let html = escapeHtml(value);
    html = html.replace(/`([^`]+)`/g, (_, code) => stash(`<code>${code}</code>`));
    html = html
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, src) => {
            if (!isSafeMarkdownUrl(src)) return match;
            return `<img src="${src}" alt="${alt}" loading="lazy">`;
        })
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
            if (!isSafeMarkdownUrl(href)) return match;
            return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        })
        .replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')
        .replace(/(\*|_)([^*_]+?)\1/g, '<em>$2</em>')
        .replace(/~~(.+?)~~/g, '<del>$1</del>');

    return html.replace(/\u0000(\d+)\u0000/g, (_, index) => placeholders[Number(index)] || '');
}

export function splitMarkdownTableRow(line) {
    const trimmed = String(line || '').trim();
    const content = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
    const withoutTrailingPipe = content.endsWith('|') ? content.slice(0, -1) : content;
    const cells = [];
    let cell = '';
    let escaped = false;

    for (const char of withoutTrailingPipe) {
        if (escaped) {
            cell += char;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === '|') {
            cells.push(cell.trim());
            cell = '';
            continue;
        }
        cell += char;
    }
    cells.push(cell.trim());
    return cells;
}

export function parseMarkdownTableSeparator(line) {
    const cells = splitMarkdownTableRow(line);
    if (cells.length < 2 || cells.some(cell => !/^:?-{3,}:?$/.test(cell))) return null;
    return cells.map(cell => {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        return 'left';
    });
}

export function isMarkdownTableStart(lines, index) {
    if (!lines[index] || !lines[index + 1] || !lines[index].includes('|')) return false;
    const headers = splitMarkdownTableRow(lines[index]);
    const alignments = parseMarkdownTableSeparator(lines[index + 1]);
    return Boolean(alignments && headers.length === alignments.length);
}

export function renderMarkdownTable(lines, startIndex) {
    const headers = splitMarkdownTableRow(lines[startIndex]);
    const alignments = parseMarkdownTableSeparator(lines[startIndex + 1]);
    const rows = [];
    let index = startIndex + 2;

    while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        const cells = splitMarkdownTableRow(lines[index]);
        rows.push(cells);
        index += 1;
    }

    const alignAttr = (cellIndex) => ` style="text-align:${alignments[cellIndex] || 'left'}"`;
    const head = headers
        .map((cell, cellIndex) => `<th${alignAttr(cellIndex)}>${renderInlineMarkdown(cell)}</th>`)
        .join('');
    const body = rows
        .map(row => `<tr>${headers.map((_, cellIndex) => `<td${alignAttr(cellIndex)}>${renderInlineMarkdown(row[cellIndex] || '')}</td>`).join('')}</tr>`)
        .join('');

    return {
        html: `<div class="markdown-table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
        nextIndex: index
    };
}

export function renderMarkdownPreview(markdown) {
    const lines = String(markdown || '').split(/\r?\n/);
    const html = [];
    let unorderedListOpen = false;
    let orderedListOpen = false;
    let blockquoteOpen = false;

    const closeBlocks = () => {
        if (unorderedListOpen) {
            html.push('</ul>');
            unorderedListOpen = false;
        }
        if (orderedListOpen) {
            html.push('</ol>');
            orderedListOpen = false;
        }
        if (blockquoteOpen) {
            html.push('</blockquote>');
            blockquoteOpen = false;
        }
    };

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const fencedCode = line.match(/^```(.*)$/);
        if (fencedCode) {
            closeBlocks();
            const language = escapeHtml(fencedCode[1].trim());
            const codeLines = [];
            index += 1;
            while (index < lines.length && !/^```$/.test(lines[index].trim())) {
                codeLines.push(lines[index]);
                index += 1;
            }
            const languageClass = language ? ` class="language-${language}"` : '';
            html.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        const listItem = line.match(/^\s*[-*]\s+(.+)$/);
        const orderedListItem = line.match(/^\s*\d+[.)]\s+(.+)$/);
        const blockquote = line.match(/^\s*>\s?(.*)$/);

        if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
            closeBlocks();
            html.push('<hr>');
            continue;
        }

        if (isMarkdownTableStart(lines, index)) {
            closeBlocks();
            const table = renderMarkdownTable(lines, index);
            html.push(table.html);
            index = table.nextIndex - 1;
            continue;
        }

        if (heading) {
            closeBlocks();
            const level = heading[1].length;
            html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
            continue;
        }

        if (listItem) {
            if (orderedListOpen) {
                html.push('</ol>');
                orderedListOpen = false;
            }
            if (!unorderedListOpen) {
                html.push('<ul>');
                unorderedListOpen = true;
            }
            html.push(`<li>${renderInlineMarkdown(listItem[1])}</li>`);
            continue;
        }

        if (orderedListItem) {
            if (unorderedListOpen) {
                html.push('</ul>');
                unorderedListOpen = false;
            }
            if (!orderedListOpen) {
                html.push('<ol>');
                orderedListOpen = true;
            }
            html.push(`<li>${renderInlineMarkdown(orderedListItem[1])}</li>`);
            continue;
        }

        if (blockquote) {
            if (unorderedListOpen) {
                html.push('</ul>');
                unorderedListOpen = false;
            }
            if (orderedListOpen) {
                html.push('</ol>');
                orderedListOpen = false;
            }
            if (!blockquoteOpen) {
                html.push('<blockquote>');
                blockquoteOpen = true;
            }
            html.push(blockquote[1] ? `<p>${renderInlineMarkdown(blockquote[1])}</p>` : '<br>');
            continue;
        }

        closeBlocks();
        html.push(line.trim() ? `<p>${renderInlineMarkdown(line)}</p>` : '<br>');
    }

    closeBlocks();
    return html.join('');
}

export function syncProjectPromptPreview() {
    const input = document.getElementById('project-prompt-input');
    const preview = document.getElementById('project-prompt-preview');
    if (!input || !preview) return;

    preview.innerHTML = renderMarkdownPreview(input.value);
}

export function updateProjectPromptFieldTabs() {
    const activeField = getProjectPromptFieldConfig();
    PROJECT_PROMPT_FIELDS.forEach(field => {
        const tab = document.querySelector(`[data-project-prompt-field="${field.key}"]`);
        if (!tab) return;

        const active = field.key === activeField.key;
        tab.setAttribute('aria-selected', String(active));
        tab.classList.toggle('bg-indigo-600', active);
        tab.classList.toggle('text-white', active);
        tab.classList.toggle('border-indigo-600', active);
        tab.classList.toggle('border-gray-200', !active);
        tab.classList.toggle('dark:border-gray-700', !active);
        tab.classList.toggle('text-gray-600', !active);
        tab.classList.toggle('dark:text-gray-300', !active);
    });
}

export function renderActiveProjectPromptField() {
    const input = document.getElementById('project-prompt-input');
    const title = document.getElementById('project-prompt-field-title');
    const file = document.getElementById('project-prompt-field-file');
    const saveLabel = document.getElementById('project-prompt-save-label');
    if (!input) return;

    const field = getProjectPromptFieldConfig();
    const values = getProjectPromptFieldValues();
    input.value = values[field.key] || '';
    input.placeholder = field.placeholder || '';
    input.setAttribute('aria-label', `${field.title} 입력`);
    if (title) title.textContent = field.title;
    if (file) file.textContent = field.fileName;
    if (saveLabel) saveLabel.textContent = `${field.title} 저장`;
    input.dispatchEvent(new Event('input'));
    syncProjectPromptPreview();
    updateProjectPromptFieldTabs();
}

export function switchProjectPromptField(fieldKey) {
    const input = document.getElementById('project-prompt-input');
    const values = getProjectPromptFieldValues();
    if (input) values[getProjectPromptFieldConfig().key] = input.value;

    window.PROJECT_ACTIVE_PROMPT_FIELD = getProjectPromptFieldConfig(fieldKey).key;
    renderActiveProjectPromptField();
}

export async function hydrateProjectPromptInput() {
    const project = getActiveProject();
    const input = document.getElementById('project-prompt-input');
    const status = document.getElementById('project-prompt-load-status');
    window.PROJECT_ACTIVE_PROMPT_FIELD = getProjectPromptFieldConfig(window.PROJECT_ACTIVE_PROMPT_FIELD).key;
    window.PROJECT_PROMPT_FIELD_VALUES = {};
    if (!project || !input) return;

    if (status) status.textContent = '프로젝트 프롬프트를 불러오는 중입니다.';

    try {
        const entries = await Promise.all(PROJECT_PROMPT_FIELDS.map(async field => {
            const value = await loadProjectMarkdownFile(project, field.fileName);
            return [field.key, value];
        }));
        window.PROJECT_PROMPT_FIELD_VALUES = Object.fromEntries(entries);
        renderActiveProjectPromptField();
        if (status) status.textContent = entries.some(([, value]) => value) ? '프로젝트 프롬프트를 불러왔습니다.' : '';
    } catch (err) {
        if (status) status.textContent = err.message || '프로젝트 프롬프트를 불러오지 못했습니다.';
    }
}

export async function hydrateProjectStylePromptInput() {
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

export function initProjectPromptMarkdownToggle() {
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

export async function uploadProjectPromptMarkdown(project, content) {
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

export async function uploadProjectStylePrompt(project, content) {
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

export async function uploadProjectMarkdownFile(project, fileName, content) {
    if (!project?.prefix) throw new Error('프로젝트 경로를 찾을 수 없습니다.');

    const key = `${project.prefix}${fileName}`;
    const res = await fetch('/api/upload?_t=' + Date.now(), {
        method: 'PUT',
        headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'X-File-Name': encodeURIComponent(fileName),
            'X-Absolute-Path': encodeURIComponent(key)
        },
        body: new Blob([content], { type: 'text/markdown; charset=utf-8' }),
        cache: 'no-store'
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `${fileName} 저장에 실패했습니다.`);
    }

    return key;
}
