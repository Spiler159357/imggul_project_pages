import { getCharacterById, getDefaultProjectId, getProjectByPrefix, getSituationGeneration, loadCharacterMeta, loadProjectCharacters, loadProjectSituations, loadProjectStylePrompt, loadProjects, normalizeCharacterPromptVariants, normalizePlannerV4PromptRows, normalizeSituationPromptVariants, saveCharacterMeta, saveProjectSituations, uploadProjectStylePrompt } from './shared.js';
import { openProjectDetail, openProjectSection, renderProjectManage } from './manage.js';
import { applyCraftPromptValues, openCharacterDetail } from './character.js';
import { combinePromptParts, getSituationById, getSituationPrompt, openSituationDetail } from './situation.js';

export function getCraftPromptFields() {
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
            expression: fields.expression,
            action: fields.action,
            background: fields.background,
            negative: fields.negative
        };
        const currentGeneration = getSituationGeneration(situation);
        const v4PromptCharacters = window.readCraftV4PromptRows ? normalizePlannerV4PromptRows(window.readCraftV4PromptRows()) : [];
        const generation = {
            ...currentGeneration,
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
