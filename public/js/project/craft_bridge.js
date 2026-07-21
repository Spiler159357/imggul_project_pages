import { getCharacterById, getDefaultProjectId, getProjectByPrefix, getProjectItems, getSituationGeneration, loadCharacterMeta, loadProjectCharacters, loadProjectSituations, loadProjectStylePrompt, loadProjects, normalizeCharacterPromptVariants, normalizePlannerV4PromptRows, normalizeSituationPromptVariants, saveCharacterMeta, saveProjectSituations, uploadProjectStylePrompt } from './shared.js?v=internal-folder-filter-20260721a';
import { openProjectDetail, openProjectSection, renderProjectManage } from './manage.js?v=internal-folder-filter-20260721a';
import { applyCraftPromptValues, openCharacterDetail } from './character.js?v=internal-folder-filter-20260721a';
import { combinePromptParts, getSituationById, getSituationPrompt, openSituationDetail } from './situation.js?v=internal-folder-filter-20260721a';

export function getCraftPromptFields() {
    return {
        style: document.getElementById('prompt-style')?.value.trim() || '',
        composition: document.getElementById('prompt-composition')?.value.trim() || '',
        character: document.getElementById('prompt-character')?.value.trim() || '',
        clothing: document.getElementById('prompt-clothing')?.value.trim() || '',
        expression: document.getElementById('prompt-expression')?.value.trim() || '',
        action: document.getElementById('prompt-action')?.value.trim() || '',
        background: document.getElementById('prompt-background')?.value.trim() || '',
        negative: document.getElementById('nai-negative')?.value.trim() || '',
        res: document.querySelector('input[name="nai-res"]:checked')?.value || ''
    };
}

export function getCraftSelectedPrefix(selectId) {
    return document.getElementById(selectId)?.value || '';
}

export async function getCraftSelectedProject() {
    const projectPrefix = getCraftSelectedPrefix('craft-project-select');
    if (!projectPrefix) throw new Error('먼저 이미지 생성 화면에서 프로젝트를 선택하세요.');

    await loadProjects();
    const project = getProjectByPrefix(projectPrefix);
    if (!project) throw new Error('선택한 프로젝트를 찾지 못했습니다.');
    return project;
}

export function setCraftPromptSaveStatus(message, isError = false) {
    const status = document.getElementById('craft-prompt-save-status');
    if (!status) return;

    status.textContent = message;
    status.classList.toggle('text-red-500', isError);
    status.classList.toggle('dark:text-red-400', isError);
    status.classList.toggle('text-gray-500', !isError);
    status.classList.toggle('dark:text-gray-400', !isError);
}

const CRAFT_UPLOAD_CONTEXT_STORAGE_KEY = 'imggul_craft_upload_context';

function normalizeCraftContextPath(path) {
    return path && !path.endsWith('/') ? `${path}/` : (path || '');
}

function readCraftContextCache() {
    try {
        return JSON.parse(localStorage.getItem(CRAFT_UPLOAD_CONTEXT_STORAGE_KEY) || '{}') || {};
    } catch {
        return {};
    }
}

function writeCraftContextCache(cache) {
    try {
        localStorage.setItem(CRAFT_UPLOAD_CONTEXT_STORAGE_KEY, JSON.stringify(cache || {}));
    } catch {}
}

function cacheCraftPromptSaveLocation({ projectPath, characterPath, situationId, characterVariantId, situationVariantId } = {}) {
    const normalizedProject = normalizeCraftContextPath(projectPath);
    if (!normalizedProject) return;
    const cache = readCraftContextCache();
    cache.projectPath = normalizedProject;
    cache.byProject = cache.byProject || {};
    const projectCache = {
        ...(cache.byProject[normalizedProject] || {})
    };
    if (characterPath !== undefined) projectCache.characterPath = normalizeCraftContextPath(characterPath);
    if (situationId !== undefined) projectCache.situationId = situationId || '';
    if (characterVariantId !== undefined) projectCache.characterVariantId = characterVariantId || '';
    if (situationVariantId !== undefined) projectCache.situationVariantId = situationVariantId || '';
    cache.byProject[normalizedProject] = projectCache;
    writeCraftContextCache(cache);
    if (window.cacheCraftUploadSelection && (characterPath !== undefined || situationId !== undefined)) {
        window.cacheCraftUploadSelection({
            projectPath: normalizedProject,
            characterPath: projectCache.characterPath || '',
            situationId: projectCache.situationId || ''
        });
    }
}

function makeCraftSavePickerItem({ type, label, subLabel = '', active = false, onClick }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.pickerType = type;
    button.dataset.searchText = `${label} ${subLabel}`.toLowerCase();
    button.className = 'w-full flex items-center text-left gap-2 px-2.5 py-2 rounded-md border border-transparent hover:border-indigo-300 dark:hover:border-indigo-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 transition min-w-0';
    button.onclick = onClick;
    button.innerHTML = `
        <span class="min-w-0 flex-1">
            <span class="block text-xs font-bold truncate">${label}</span>
            ${subLabel ? `<span class="block text-[10px] text-gray-500 dark:text-gray-400 truncate">${subLabel}</span>` : ''}
        </span>
        <i data-lucide="check" class="w-3.5 h-3.5 text-indigo-500 ${active ? '' : 'invisible'}"></i>
    `;
    return button;
}

function setCraftSaveListEmpty(id, message) {
    const list = document.getElementById(id);
    if (list) list.innerHTML = `<div class="py-5 text-center text-xs text-gray-500 dark:text-gray-400">${message}</div>`;
}

function getSituationSaveLabel(situation, index) {
    const number = Number.isFinite(Number(situation?.imageNumber)) ? Number(situation.imageNumber) : index;
    const name = situation?.alias || situation?.name || situation?.id || `상황 ${number}`;
    return `${number} - ${name}`;
}

function setCraftSaveVariantSelect(type, variants = [], selectedId = '') {
    const select = document.getElementById(`craft-save-${type}-variant-select`);
    if (!select) return;
    const fallbackMessage = type === 'character' ? '캐릭터를 먼저 선택하세요' : '상황을 먼저 선택하세요';
    select.innerHTML = '';
    if (!variants.length) {
        select.disabled = true;
        select.appendChild(new Option(fallbackMessage, ''));
        return;
    }
    select.disabled = false;
    variants.forEach(variant => {
        const option = new Option(variant.name || variant.id || 'Default', variant.id || 'default');
        select.appendChild(option);
    });
    select.value = variants.some(variant => variant.id === selectedId) ? selectedId : variants[0].id;
}

function getSelectedCraftSaveCharacter(state = window.CRAFT_PROMPT_SAVE_STATE || {}) {
    return (state.characters || []).find(character => character.prefix === state.characterPath) || null;
}

function getSelectedCraftSaveSituation(state = window.CRAFT_PROMPT_SAVE_STATE || {}) {
    return (state.situations || []).find((situation, index) => {
        const id = situation.id || situation.folderName || `situation-${index + 1}`;
        return String(id) === String(state.situationId);
    }) || null;
}

async function loadCraftPromptSaveCharacterVariants(characterPath, restoreCached = false) {
    const state = window.CRAFT_PROMPT_SAVE_STATE || {};
    state.characterPath = normalizeCraftContextPath(characterPath);
    state.characterVariants = [];
    state.characterVariantId = '';
    window.CRAFT_PROMPT_SAVE_STATE = state;
    setCraftSaveVariantSelect('character', []);

    const character = getSelectedCraftSaveCharacter(state);
    if (!character) {
        window.updateCraftPromptSaveSummary();
        return;
    }

    const meta = await loadCharacterMeta(character).catch(() => ({}));
    const variants = normalizeCharacterPromptVariants(meta);
    const cache = readCraftContextCache();
    const projectCache = cache.byProject?.[state.projectPath] || {};
    const cachedId = restoreCached ? projectCache.characterVariantId : '';
    const selectedId = variants.some(variant => variant.id === cachedId)
        ? cachedId
        : (meta.activePromptVariantId || variants[0]?.id || 'default');
    state.characterMeta = meta;
    state.characterVariants = variants;
    state.characterVariantId = selectedId;
    window.CRAFT_PROMPT_SAVE_STATE = state;
    setCraftSaveVariantSelect('character', variants, selectedId);
    window.updateCraftPromptSaveSummary();
}

function loadCraftPromptSaveSituationVariants(situationId, restoreCached = false) {
    const state = window.CRAFT_PROMPT_SAVE_STATE || {};
    state.situationId = situationId || '';
    const situation = getSelectedCraftSaveSituation(state);
    const variants = situation ? normalizeSituationPromptVariants(situation) : [];
    const cache = readCraftContextCache();
    const projectCache = cache.byProject?.[state.projectPath] || {};
    const cachedId = restoreCached ? projectCache.situationVariantId : '';
    const selectedId = variants.some(variant => variant.id === cachedId)
        ? cachedId
        : (situation?.activePromptVariantId || variants[0]?.id || 'default');
    state.situationVariants = variants;
    state.situationVariantId = selectedId;
    window.CRAFT_PROMPT_SAVE_STATE = state;
    setCraftSaveVariantSelect('situation', variants, selectedId);
    window.updateCraftPromptSaveSummary();
}

export async function openCraftPromptSaveModal() {
    const modal = document.getElementById('craft-prompt-save-modal');
    if (!modal) return;
    const cache = readCraftContextCache();
    const projectPath = normalizeCraftContextPath(cache.projectPath || getCraftSelectedPrefix('craft-project-select'));
    const projectCache = cache.byProject?.[projectPath] || {};
    window.CRAFT_PROMPT_SAVE_STATE = {
        mode: 'style',
        projects: [],
        characters: [],
        situations: [],
        projectPath,
        characterPath: normalizeCraftContextPath(projectCache.characterPath || getCraftSelectedPrefix('craft-char-select')),
        situationId: projectCache.situationId || getCraftSelectedPrefix('craft-situation-select'),
        characterVariants: [],
        situationVariants: [],
        characterVariantId: projectCache.characterVariantId || '',
        situationVariantId: projectCache.situationVariantId || ''
    };
    modal.classList.remove('hidden');
    window.setCraftPromptSaveMode('style');
    await window.loadCraftPromptSaveProjects();
    if (projectPath) await window.loadCraftPromptSaveTargets(projectPath, true);
    window.updateCraftPromptSaveSummary();
    if (window.lucide) window.lucide.createIcons();
}

export function closeCraftPromptSaveModal(e) {
    if (e && e.target !== e.currentTarget && e.target.id !== 'close-craft-prompt-save-btn') return;
    document.getElementById('craft-prompt-save-modal')?.classList.add('hidden');
}

export function setCraftPromptSaveMode(mode) {
    const state = window.CRAFT_PROMPT_SAVE_STATE || {};
    state.mode = ['style', 'character', 'situation'].includes(mode) ? mode : 'style';
    window.CRAFT_PROMPT_SAVE_STATE = state;
    document.getElementById('craft-save-style-panel')?.classList.toggle('hidden', state.mode !== 'style');
    const characterPanel = document.getElementById('craft-save-character-panel');
    const situationPanel = document.getElementById('craft-save-situation-panel');
    characterPanel?.classList.toggle('hidden', state.mode !== 'character');
    characterPanel?.classList.toggle('flex', state.mode === 'character');
    situationPanel?.classList.toggle('hidden', state.mode !== 'situation');
    situationPanel?.classList.toggle('flex', state.mode === 'situation');
    ['style', 'character', 'situation'].forEach(item => {
        const btn = document.getElementById(`craft-save-mode-${item}`);
        const active = item === state.mode;
        btn?.classList.toggle('border-indigo-500', active);
        btn?.classList.toggle('bg-indigo-50', active);
        btn?.classList.toggle('dark:bg-indigo-900/30', active);
        btn?.classList.toggle('text-indigo-700', active);
        btn?.classList.toggle('dark:text-indigo-300', active);
        btn?.classList.toggle('border-gray-200', !active);
        btn?.classList.toggle('dark:border-gray-700', !active);
    });
    window.updateCraftPromptSaveSummary();
}

export async function loadCraftPromptSaveProjects() {
    const list = document.getElementById('craft-save-project-list');
    if (list) list.innerHTML = '<div class="py-5 text-center text-xs text-gray-500 dark:text-gray-400">불러오는 중...</div>';
    try {
        const state = window.CRAFT_PROMPT_SAVE_STATE || {};
        state.projects = await loadProjects();
        window.CRAFT_PROMPT_SAVE_STATE = state;
        window.renderCraftPromptSaveList('project');
    } catch (err) {
        setCraftSaveListEmpty('craft-save-project-list', err.message || '프로젝트 목록을 불러오지 못했습니다.');
    }
}

export async function loadCraftPromptSaveTargets(projectPath, restoreCached = false) {
    const state = window.CRAFT_PROMPT_SAVE_STATE || {};
    state.projectPath = normalizeCraftContextPath(projectPath);
    if (!restoreCached) {
        state.characterPath = '';
        state.situationId = '';
        state.characterVariantId = '';
        state.situationVariantId = '';
    }
    state.characterVariants = [];
    state.situationVariants = [];
    window.CRAFT_PROMPT_SAVE_STATE = state;
    setCraftSaveVariantSelect('character', []);
    setCraftSaveVariantSelect('situation', []);
    try {
        const project = getProjectByPrefix(state.projectPath);
        if (!project) throw new Error('선택한 프로젝트를 찾을 수 없습니다.');
        const cache = readCraftContextCache();
        const projectCache = cache.byProject?.[state.projectPath] || {};
        await Promise.all([
            loadProjectCharacters(project, true),
            loadProjectSituations(project, true)
        ]);
        state.characters = getProjectItems(project, 'characters');
        state.situations = getProjectItems(project, 'situations');
        if (restoreCached && projectCache.characterPath && state.characters.some(item => item.prefix === projectCache.characterPath)) state.characterPath = projectCache.characterPath;
        if (restoreCached && projectCache.situationId && state.situations.some(item => String(item.id || item.folderName) === String(projectCache.situationId))) state.situationId = projectCache.situationId;
        window.CRAFT_PROMPT_SAVE_STATE = state;
        window.renderCraftPromptSaveList('project');
        window.renderCraftPromptSaveList('character');
        window.renderCraftPromptSaveList('situation');
        if (state.characterPath) await loadCraftPromptSaveCharacterVariants(state.characterPath, restoreCached);
        if (state.situationId) loadCraftPromptSaveSituationVariants(state.situationId, restoreCached);
        window.updateCraftPromptSaveSummary();
    } catch (err) {
        setCraftSaveListEmpty('craft-save-character-list', err.message || '캐릭터 목록을 불러오지 못했습니다.');
        setCraftSaveListEmpty('craft-save-situation-list', err.message || '상황 목록을 불러오지 못했습니다.');
    }
}

export function renderCraftPromptSaveList(type) {
    const state = window.CRAFT_PROMPT_SAVE_STATE || {};
    const list = document.getElementById(`craft-save-${type}-list`);
    if (!list) return;
    list.innerHTML = '';
    if (type === 'project') {
        (state.projects || []).forEach(project => {
            list.appendChild(makeCraftSavePickerItem({
                type,
                label: project.name || project.folderName,
                subLabel: project.prefix,
                active: project.prefix === state.projectPath,
                onClick: async () => window.loadCraftPromptSaveTargets(project.prefix)
            }));
        });
    } else if (type === 'character') {
        (state.characters || []).forEach(character => {
            list.appendChild(makeCraftSavePickerItem({
                type,
                label: character.name || character.alias || character.folderName || character.id,
                subLabel: character.prefix,
                active: character.prefix === state.characterPath,
                onClick: async () => {
                    state.characterPath = character.prefix;
                    state.characterVariantId = '';
                    window.CRAFT_PROMPT_SAVE_STATE = state;
                    window.renderCraftPromptSaveList('character');
                    await loadCraftPromptSaveCharacterVariants(character.prefix);
                    window.updateCraftPromptSaveSummary();
                }
            }));
        });
    } else if (type === 'situation') {
        (state.situations || []).forEach((situation, index) => {
            const id = situation.id || situation.folderName || `situation-${index + 1}`;
            list.appendChild(makeCraftSavePickerItem({
                type,
                label: getSituationSaveLabel(situation, index),
                subLabel: String(id),
                active: String(id) === String(state.situationId),
                onClick: () => {
                    state.situationId = String(id);
                    state.situationVariantId = '';
                    window.CRAFT_PROMPT_SAVE_STATE = state;
                    window.renderCraftPromptSaveList('situation');
                    loadCraftPromptSaveSituationVariants(String(id));
                    window.updateCraftPromptSaveSummary();
                }
            }));
        });
    }
    if (!list.children.length) setCraftSaveListEmpty(list.id, '선택 가능한 항목이 없습니다.');
    if (window.lucide) window.lucide.createIcons();
}

export function selectCraftPromptSaveVariant(type, value = '') {
    const state = window.CRAFT_PROMPT_SAVE_STATE || {};
    if (type === 'character') state.characterVariantId = value || '';
    if (type === 'situation') state.situationVariantId = value || '';
    window.CRAFT_PROMPT_SAVE_STATE = state;
    window.updateCraftPromptSaveSummary();
}

export function filterCraftPromptSaveList(type, value = '') {
    const q = String(value || '').trim().toLowerCase();
    document.querySelectorAll(`#craft-save-${type}-list [data-picker-type="${type}"]`).forEach(item => {
        item.classList.toggle('hidden', q && !item.dataset.searchText.includes(q));
    });
}

export function updateCraftPromptSaveSummary() {
    const state = window.CRAFT_PROMPT_SAVE_STATE || {};
    const summary = document.getElementById('craft-save-target-summary');
    const submit = document.getElementById('craft-prompt-save-submit-btn');
    let valid = !!state.projectPath;
    if (state.mode === 'character') valid = valid && !!state.characterPath && !!state.characterVariantId;
    if (state.mode === 'situation') valid = valid && !!state.situationId && !!state.situationVariantId;
    if (summary) {
        const characterVariant = (state.characterVariants || []).find(variant => variant.id === state.characterVariantId);
        const situationVariant = (state.situationVariants || []).find(variant => variant.id === state.situationVariantId);
        summary.textContent = [
            state.mode,
            state.projectPath,
            state.mode === 'character' ? state.characterPath : '',
            state.mode === 'character' ? (characterVariant?.name || state.characterVariantId || '') : '',
            state.mode === 'situation' ? state.situationId : '',
            state.mode === 'situation' ? (situationVariant?.name || state.situationVariantId || '') : ''
        ]
            .filter(Boolean)
            .join(' · ') || '-';
    }
    if (submit) submit.disabled = !valid;
}

export async function submitCraftPromptSaveModal() {
    const state = window.CRAFT_PROMPT_SAVE_STATE || {};
    try {
        if (!state.projectPath) throw new Error('프로젝트를 선택하세요.');
        const project = getProjectByPrefix(state.projectPath);
        if (!project) throw new Error('선택한 프로젝트를 찾을 수 없습니다.');
        const fields = getCraftPromptFields();

        if (state.mode === 'style') {
            await uploadProjectStylePrompt(project, fields.style);
            cacheCraftPromptSaveLocation({ projectPath: project.prefix });
            setCraftPromptSaveStatus('프로젝트 그림체 저장 완료');
        } else if (state.mode === 'character') {
            if (!state.characterPath) throw new Error('캐릭터를 선택하세요.');
            await loadProjectCharacters(project, true);
            const character = getCharacterById(project, state.characterPath);
            if (!character) throw new Error('선택한 캐릭터를 찾을 수 없습니다.');
            const meta = await loadCharacterMeta(character).catch(() => ({}));
            const variants = normalizeCharacterPromptVariants(meta);
            const targetVariantId = variants.some(variant => variant.id === state.characterVariantId)
                ? state.characterVariantId
                : (meta.activePromptVariantId || variants[0]?.id || 'default');
            const baseVariant = variants.find(variant => variant.id === targetVariantId) || variants[0] || {};
            const parts = {
                ...(baseVariant.parts || meta.parts || {}),
                character: fields.character,
                clothing: fields.clothing,
                expression: fields.expression,
                negative: fields.negative
            };
            const nextVariants = variants.map(variant => variant.id === targetVariantId
                ? { ...variant, prompt: parts.character, parts, updatedAt: Date.now() }
                : variant
            );
            await saveCharacterMeta(character, {
                ...meta,
                prompt: parts.character,
                parts,
                promptVariants: nextVariants,
                activePromptVariantId: targetVariantId,
                updatedAt: Date.now()
            });
            cacheCraftPromptSaveLocation({ projectPath: project.prefix, characterPath: character.prefix, characterVariantId: targetVariantId });
            setCraftPromptSaveStatus('캐릭터 프롬프트 저장 완료');
        } else {
            if (!state.situationId) throw new Error('상황을 선택하세요.');
            await loadProjectSituations(project, true);
            const situation = getSituationById(project, state.situationId);
            if (!situation) throw new Error('선택한 상황을 찾을 수 없습니다.');
            const variants = normalizeSituationPromptVariants(situation);
            const targetVariantId = variants.some(variant => variant.id === state.situationVariantId)
                ? state.situationVariantId
                : (situation.activePromptVariantId || variants[0]?.id || 'default');
            const baseVariant = variants.find(variant => variant.id === targetVariantId) || variants[0] || {};
            const prompt = {
                ...(baseVariant.prompt || situation.prompt || {}),
                composition: fields.composition,
                clothing: fields.clothing,
                expression: fields.expression,
                action: fields.action,
                background: fields.background,
                negative: baseVariant.prompt?.negative || situation.prompt?.negative || ''
            };
            const currentGeneration = baseVariant.generation || getSituationGeneration(situation);
            const v4PromptCharacters = window.readCraftV4PromptRows ? normalizePlannerV4PromptRows(window.readCraftV4PromptRows()) : [];
            const generation = { ...currentGeneration, res: fields.res || currentGeneration.res, v4PromptCharacters, v4_prompt: v4PromptCharacters };
            const nextVariants = variants.map(variant => variant.id === targetVariantId
                ? { ...variant, prompt, generation, updatedAt: Date.now() }
                : variant
            );
            situation.prompt = prompt;
            situation.generation = generation;
            situation.resolution = generation.res;
            situation.promptVariants = nextVariants;
            situation.activePromptVariantId = targetVariantId;
            situation.v4PromptCharacters = v4PromptCharacters;
            situation.v4_prompt = v4PromptCharacters;
            situation.updatedAt = Date.now();
            await saveProjectSituations(project);
            cacheCraftPromptSaveLocation({ projectPath: project.prefix, situationId: state.situationId, situationVariantId: targetVariantId });
            setCraftPromptSaveStatus('상황 프롬프트 저장 완료');
        }

        if (window.currentPrefix === project.prefix && window.loadPath) window.loadPath(project.prefix, true);
        window.closeCraftPromptSaveModal(null);
    } catch (err) {
        setCraftPromptSaveStatus(err.message || '프롬프트 저장 실패', true);
        alert(err.message || '프롬프트 저장 실패');
    }
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

export async function loadCraftPromptFromSelection() {
    if (window.openImportModal) {
        await window.openImportModal();
        return;
    }

    setCraftPromptSaveStatus('불러오는 중...');

    try {
        const project = await getCraftSelectedProject();
        await Promise.all([
            loadProjectCharacters(project).catch(() => []),
            loadProjectSituations(project, true).catch(() => [])
        ]);

        const characterPrefix = getCraftSelectedPrefix('craft-char-select');
        const situationId = getCraftSelectedPrefix('craft-situation-select');
        const character = characterPrefix ? getCharacterById(project, characterPrefix) : null;
        const situation = situationId ? getSituationById(project, situationId) : null;
        const [projectStyle, characterMeta] = await Promise.all([
            loadProjectStylePrompt(project).catch(() => ''),
            character ? loadCharacterMeta(character).catch(() => ({})) : Promise.resolve({})
        ]);

        const characterParts = characterMeta.parts || {};
        const situationPrompt = getSituationPrompt(situation);
        const situationGeneration = getSituationGeneration(situation);
        applyCraftPromptValues({
            'prompt-style': projectStyle || '',
            'prompt-composition': situationPrompt.composition || '',
            'prompt-character': characterParts.character || characterMeta.prompt || '',
            'prompt-clothing': characterParts.clothing || '',
            'prompt-expression': situationPrompt.expression || '',
            'prompt-action': situationPrompt.action || '',
            'prompt-background': situationPrompt.background || ''
        }, combinePromptParts(characterParts.negative, situationPrompt.negative));
        if (window.setCraftV4PromptRows) window.setCraftV4PromptRows(situationGeneration.v4PromptCharacters || []);

        setCraftPromptSaveStatus('프롬프트 불러오기 완료');
    } catch (err) {
        setCraftPromptSaveStatus(err.message || '프롬프트 불러오기 실패', true);
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
        const variants = normalizeCharacterPromptVariants(meta);
        const activeVariantId = meta.activePromptVariantId || variants[0]?.id || 'default';
        const parts = {
            ...(meta.parts || {}),
            character: fields.character,
            clothing: fields.clothing,
            expression: fields.expression,
            negative: fields.negative
        };
        const nextVariants = variants.map(variant => variant.id === activeVariantId
            ? { ...variant, prompt: parts.character, parts, updatedAt: Date.now() }
            : variant
        );

        await saveCharacterMeta(character, {
            ...meta,
            prompt: parts.character,
            parts,
            promptVariants: nextVariants,
            activePromptVariantId: activeVariantId,
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
        const prompt = {
            ...(situation.prompt || {}),
            composition: fields.composition,
            clothing: fields.clothing,
            expression: fields.expression,
            action: fields.action,
            background: fields.background,
            negative: situation.prompt?.negative || ''
        };
        const currentGeneration = getSituationGeneration(situation);
        const v4PromptCharacters = window.readCraftV4PromptRows ? normalizePlannerV4PromptRows(window.readCraftV4PromptRows()) : [];
        const generation = {
            ...currentGeneration,
            res: fields.res || currentGeneration.res,
            v4PromptCharacters,
            v4_prompt: v4PromptCharacters
        };
        const variants = normalizeSituationPromptVariants(situation);
        const activeVariantId = situation.activePromptVariantId || variants[0]?.id || 'default';
        const nextVariants = variants.map(variant => variant.id === activeVariantId
            ? { ...variant, prompt, generation, updatedAt: Date.now() }
            : variant
        );
        situation.prompt = prompt;
        situation.generation = generation;
        situation.resolution = generation.res;
        situation.promptVariants = nextVariants;
        situation.activePromptVariantId = activeVariantId;
        situation.v4PromptCharacters = v4PromptCharacters;
        situation.v4_prompt = v4PromptCharacters;
        situation.updatedAt = Date.now();

        await saveProjectSituations(project);
        setCraftPromptSaveStatus('상황 프롬프트 저장 완료');
    } catch (err) {
        setCraftPromptSaveStatus(err.message || '상황 프롬프트 저장 실패', true);
    }
}

export async function restoreProjectState(state = {}) {
    if (state.projectView === 'post-detail' && state.projectPostId) {
        window.PROJECT_ACTIVE_PROJECT_ID = state.projectId || getDefaultProjectId();
        await openProjectSection('posts', true);
        await window.openAdminPost?.(state.projectPostId, true);
    } else if (state.projectView === 'section' && state.projectSection) {
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
