import { DEFAULT_PLANNER_RESOLUTION, PLANNER_RESOLUTION_OPTIONS, createPromptVariantId, escapeHtml, escapeJsString, getActiveProject, getActiveSituationPromptVariant, getAssetUrl, getFileNameFromKey, getProjectById, getProjectItems, getSituationDisplayName, getSituationFolderNumber, getSituationGeneration, getSituationImageKey, getSituationImageNumber, isInvalidProjectFolderName, loadCharacterFiles, loadProjectCharacters, loadProjectSituations, loadProjects, normalizePlannerV4PromptRows, normalizeProjectFolderName, normalizeSituationPrompt, normalizeSituationPromptVariants, refreshProjectIcons, rememberProjectRoute, renderEmptyState, renderProjectShell, replaceProjectRoute, saveProjectAlias, saveProjectSituations, setProjectRoute } from './shared.js';
import { openProjectSection, renderProjectManage, renderSectionHeader } from './manage.js';
import { findSituationImage, openProjectItemCreateModal, renderCharacterStatusBadge, renderProjectItemCreateModal } from './character.js';

export function getSituationPromptIndicator(situation) {
    const prompt = getSituationPrompt(situation);
    const summary = combinePromptParts(prompt.composition, prompt.expression, prompt.action, prompt.background, prompt.negative);
    return summary || '프롬프트가 아직 없습니다.';
}

export function renderSituationSection(section, state = {}) {
    const project = getActiveProject();
    const situations = getProjectItems(project, 'situations');

    renderProjectShell(`
        ${renderSectionHeader(section.title)}
        <div class="flex-1 overflow-hidden p-4 sm:p-6 min-h-0">
            <section class="h-full min-h-0">
                <div class="h-full min-h-0 flex flex-col">
                    <div class="flex items-center justify-between mb-4 flex-shrink-0">
                        <h3 class="font-bold text-base text-gray-900 dark:text-white">상황 목록</h3>
                        <button type="button" onclick="window.openProjectItemCreateModal('situation')" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition" title="상황 추가" aria-label="상황 추가">
                            <i data-lucide="plus" class="w-5 h-5"></i>
                        </button>
                    </div>
                    ${state.loading ? renderEmptyState('상황을 불러오는 중입니다.') : ''}
                    ${state.error ? renderEmptyState(state.error) : ''}
                    ${!state.loading && !state.error && situations.length ? `
                        <div class="grid min-h-0 flex-1 grid-cols-2 gap-2.5 overflow-y-auto pr-1">
                            ${situations.map(situation => `
                                <button type="button" onclick="window.openSituationDetail('${escapeJsString(project.id)}', '${escapeJsString(situation.id)}')" class="group w-full min-h-[74px] self-start text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3.5 py-3 flex items-center gap-3 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition">
                                    <span class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-900/70 text-[11px] font-extrabold text-gray-500 dark:text-gray-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">${escapeHtml(getSituationImageNumber(project, situation))}</span>
                                    <span class="min-w-0 flex-1">
                                        <span class="block text-sm font-bold text-gray-800 dark:text-gray-100 truncate">${escapeHtml(getSituationDisplayName(situation))}</span>
                                    </span>
                                    <span class="hidden sm:inline-flex flex-shrink-0 items-center text-[11px] font-bold text-gray-300 dark:text-gray-600 group-hover:text-indigo-400 dark:group-hover:text-indigo-500 transition">${escapeHtml(getSituationImageNumber(project, situation))}.webp</span>
                                </button>
                            `).join('')}
                        </div>
                    ` : ''}
                    ${!state.loading && !state.error && !situations.length ? renderEmptyState('등록된 상황이 없습니다.') : ''}
                </div>
            </section>
        </div>
        ${renderProjectItemCreateModal()}
    `);
}

export function getSituationById(project, situationId) {
    const decodedId = decodeURIComponent(situationId || '');
    return getProjectItems(project, 'situations').find(situation =>
        situation.id === decodedId ||
        situation.folderName === decodedId
    );
}

export function getSituationPrompt(situation) {
    return getActiveSituationPromptVariant(situation)?.prompt || normalizeSituationPrompt(situation?.prompt || {});
}

export function combinePromptParts(...values) {
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

export function getSituationCharacterRows(project, situation) {
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

export function renderSituationCharacterProgress(project, situation, state = {}) {
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

export function renderSituationV4PromptRow(row = {}, index = 0) {
    const rowId = index;
    const label = Number.isFinite(Number(index)) && Number(index) < 1000 ? Number(index) + 1 : '새 항목';
    const inputClass = 'w-full p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100';
    return `
        <div data-situation-v4-row="${rowId}" class="rounded-md border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/40 p-2">
            <div class="flex items-center justify-between gap-2 mb-2">
                <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">V4 캐릭터 ${escapeHtml(label)}</span>
                <button type="button" onclick="window.removeSituationV4PromptRow('${rowId}')" class="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="V4 캐릭터 삭제">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input id="situation-v4-${rowId}-subject" value="${escapeHtml(row.subject || '')}" class="${inputClass}" placeholder="캐릭터">
                <input id="situation-v4-${rowId}-clothing" value="${escapeHtml(row.clothing || '')}" class="${inputClass}" placeholder="의상">
                <input id="situation-v4-${rowId}-expression" value="${escapeHtml(row.expression || '')}" class="${inputClass}" placeholder="표정">
                <input id="situation-v4-${rowId}-action" value="${escapeHtml(row.action || '')}" class="${inputClass}" placeholder="행위">
                <input id="situation-v4-${rowId}-negative" value="${escapeHtml(row.negative || '')}" class="${inputClass} md:col-span-2" placeholder="부정 프롬프트">
            </div>
        </div>
    `;
}

export function renderSituationV4PromptSection(situation) {
    const rows = getSituationGeneration(situation).v4PromptCharacters || [];
    return `
        <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <div class="flex items-center justify-between gap-2 mb-2">
                <div>
                    <p class="text-xs font-bold text-gray-700 dark:text-gray-300">V4 Prompt</p>
                    <p class="text-[10px] text-gray-400 dark:text-gray-500">상황별 캐릭터 caption을 추가해 이미지 생성과 플래너 v4_prompt에 사용합니다.</p>
                </div>
                <button type="button" onclick="window.addSituationV4PromptRow()" class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-[10px] font-bold text-gray-700 dark:text-gray-200 hover:border-indigo-400">
                    <i data-lucide="user-plus" class="w-3.5 h-3.5"></i> 캐릭터 추가
                </button>
            </div>
            <div id="situation-v4-rows" class="space-y-2">
                ${rows.map((row, index) => renderSituationV4PromptRow(row, index)).join('')}
            </div>
        </div>
    `;
}

export function readSituationV4PromptRows() {
    const container = document.getElementById('situation-v4-rows');
    if (!container) return [];
    return Array.from(container.querySelectorAll('[data-situation-v4-row]')).map(row => {
        const rowId = row.getAttribute('data-situation-v4-row');
        return {
            subject: document.getElementById(`situation-v4-${rowId}-subject`)?.value.trim() || '',
            clothing: document.getElementById(`situation-v4-${rowId}-clothing`)?.value.trim() || '',
            expression: document.getElementById(`situation-v4-${rowId}-expression`)?.value.trim() || '',
            action: document.getElementById(`situation-v4-${rowId}-action`)?.value.trim() || '',
            negative: document.getElementById(`situation-v4-${rowId}-negative`)?.value.trim() || ''
        };
    }).filter(row => [row.subject, row.clothing, row.expression, row.action, row.negative].some(Boolean));
}

export function addSituationV4PromptRow() {
    const container = document.getElementById('situation-v4-rows');
    if (!container) return;
    const rowId = Date.now();
    container.insertAdjacentHTML('beforeend', renderSituationV4PromptRow({}, rowId));
    refreshProjectIcons();
}

export function removeSituationV4PromptRow(rowId) {
    document.querySelectorAll('[data-situation-v4-row]').forEach(row => {
        if (row.getAttribute('data-situation-v4-row') === String(rowId)) row.remove();
    });
}

export function renderSituationDetailShell(project, situation, state = {}) {
    const prompt = getSituationPrompt(situation);
    const promptVariants = normalizeSituationPromptVariants(situation);
    const activePromptVariant = getActiveSituationPromptVariant(situation);
    const imageNumber = getSituationImageNumber(project, situation);
    const generation = getSituationGeneration(situation);
    const resolution = generation.res || DEFAULT_PLANNER_RESOLUTION;

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
                <div id="situation-action-menu" class="hidden absolute right-0 top-10 z-20 w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden py-1">
                    <button type="button" onclick="window.renameActiveSituation()" class="w-full px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">상황 이름 변경</button>
                    <button type="button" onclick="window.changeActiveSituationPath()" class="w-full px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">상황 경로 변경</button>
                    <button type="button" onclick="window.deleteActiveSituation()" class="w-full px-3 py-2 text-left text-xs font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition">상황 삭제</button>
                </div>
            </div>
        </div>

        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <section class="max-w-7xl mx-auto min-h-full">
                <form id="situation-prompt-form" onsubmit="window.saveActiveSituationPrompt(event)" class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div class="mb-4 flex flex-col md:flex-row md:items-end gap-3">
                        <div class="flex-1 min-w-0">
                            <label for="situation-prompt-variant-select" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">구도</label>
                            <select id="situation-prompt-variant-select" onchange="window.selectSituationPromptVariant(this.value)" class="w-full p-2.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                                ${promptVariants.map(variant => `<option value="${escapeHtml(variant.id)}" ${variant.id === activePromptVariant.id ? 'selected' : ''}>${escapeHtml(variant.name)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="w-full md:w-56">
                        <label for="situation-resolution-input" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">해상도</label>
                        <select id="situation-resolution-input" class="w-full p-2.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            ${PLANNER_RESOLUTION_OPTIONS.map(([value, label]) => `<option value="${escapeHtml(value)}" ${resolution === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
                        </select>
                        </div>
                    </div>
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
                            <textarea id="situation-negative-input" class="w-full min-h-[140px] resize-y p-3 rounded-lg border border-red-300 dark:border-red-800 bg-gray-50 dark:bg-gray-900/50 text-sm leading-6 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="이 상황에서 제외할 태그">${escapeHtml(prompt.negative)}</textarea>
                        </div>
                    </div>
                    ${renderSituationV4PromptSection(situation)}
                    <div class="mt-3 flex flex-wrap items-center justify-end gap-3">
                        <p id="situation-prompt-save-status" class="min-h-4 text-[11px] text-gray-400 dark:text-gray-500"></p>
                        <button type="button" onclick="window.addSituationPromptVariant()" class="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-xs font-bold hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 transition">
                            <i data-lucide="plus" class="w-4 h-4"></i>
                            신규 구도 추가
                        </button>
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

export function closeSituationActionMenu() {
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

export async function changeActiveSituationPath() {
    closeSituationActionMenu();

    const project = getActiveProject();
    const situation = getSituationById(project, window.PROJECT_ACTIVE_SITUATION_ID);
    if (!project || !situation) return;

    const nextPath = prompt('상황 경로를 입력하세요.', situation.folderName || situation.id);
    if (nextPath === null) return;

    const folderName = normalizeProjectFolderName(nextPath);
    if (isInvalidProjectFolderName(folderName)) {
        alert('경로에는 /, \\, 숨김 폴더명, 예약 폴더명을 사용할 수 없습니다.');
        return;
    }

    const oldId = situation.id;
    if (folderName === oldId && folderName === situation.folderName) return;
    if (getProjectItems(project, 'situations').some(item => item !== situation && (item.id === folderName || item.folderName === folderName))) {
        alert('이미 존재하는 상황 경로입니다.');
        return;
    }

    const previousActiveId = window.PROJECT_ACTIVE_SITUATION_ID;
    const previousId = situation.id;
    const previousFolderName = situation.folderName;
    const previousImageNumber = situation.imageNumber;

    try {
        const previousImageKey = getSituationImageKey(project, situation);
        const folderNumber = getSituationFolderNumber(folderName);
        situation.id = folderName;
        situation.folderName = folderName;
        if (Number.isFinite(folderNumber)) situation.imageNumber = folderNumber;
        project.situationsLoaded = true;
        window.PROJECT_ACTIVE_SITUATION_ID = situation.id;

        await saveProjectSituations(project);
        const nextImageKey = getSituationImageKey(project, situation);
        if (previousImageKey !== nextImageKey) {
            const displayName = getSituationDisplayName(situation);
            await saveProjectAlias(previousImageKey, '');
            await saveProjectAlias(nextImageKey, displayName);
        }
        renderSituationDetailShell(project, situation);
        replaceProjectRoute(
            { projectView: 'situation-detail', projectId: project.id, situationId: situation.id },
            `#project/${project.id}/situation/${encodeURIComponent(situation.id)}`
        );
    } catch (err) {
        window.PROJECT_ACTIVE_SITUATION_ID = previousActiveId;
        situation.id = previousId;
        situation.folderName = previousFolderName;
        situation.imageNumber = previousImageNumber;
        alert(err.message || '상황 경로 변경에 실패했습니다.');
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
    const variantSelect = document.getElementById('situation-prompt-variant-select');
    const resolutionInput = document.getElementById('situation-resolution-input');
    const compositionInput = document.getElementById('situation-composition-input');
    const expressionInput = document.getElementById('situation-expression-input');
    const actionInput = document.getElementById('situation-action-input');
    const negativeInput = document.getElementById('situation-negative-input');
    const button = document.getElementById('situation-prompt-save-btn');
    const status = document.getElementById('situation-prompt-save-status');
    if (!project || !situation || !resolutionInput || !compositionInput || !expressionInput || !actionInput || !negativeInput) return;

    const previousButtonHtml = button?.innerHTML || '';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> 저장 중';
        refreshProjectIcons();
    }
    if (status) status.textContent = '';

    try {
        const prompt = {
            ...(situation.prompt || {}),
            composition: compositionInput.value.trim(),
            expression: expressionInput.value.trim(),
            action: actionInput.value.trim(),
            negative: negativeInput.value.trim()
        };
        const currentGeneration = getSituationGeneration(situation);
        const resolution = resolutionInput.value || DEFAULT_PLANNER_RESOLUTION;
        const v4PromptCharacters = normalizePlannerV4PromptRows(readSituationV4PromptRows());
        const generation = {
            ...currentGeneration,
            res: resolution,
            v4PromptCharacters,
            v4_prompt: v4PromptCharacters
        };
        const variants = normalizeSituationPromptVariants(situation);
        const activeVariantId = variantSelect?.value || situation.activePromptVariantId || variants[0]?.id || 'default';
        const nextVariants = variants.map(variant => variant.id === activeVariantId
            ? { ...variant, prompt, generation, updatedAt: Date.now() }
            : variant
        );
        situation.prompt = prompt;
        situation.generation = generation;
        situation.promptVariants = nextVariants;
        situation.activePromptVariantId = activeVariantId;
        situation.resolution = resolution;
        situation.res = resolution;
        situation.v4PromptCharacters = v4PromptCharacters;
        situation.v4_prompt = v4PromptCharacters;
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

export function selectSituationPromptVariant(variantId) {
    const project = getActiveProject();
    const situation = getSituationById(project, window.PROJECT_ACTIVE_SITUATION_ID);
    if (!project || !situation || !variantId) return;

    const variants = normalizeSituationPromptVariants(situation);
    const activeVariant = variants.find(variant => variant.id === variantId) || variants[0];
    situation.prompt = activeVariant.prompt;
    situation.generation = activeVariant.generation;
    situation.promptVariants = variants;
    situation.activePromptVariantId = activeVariant.id;
    situation.resolution = activeVariant.generation.res || DEFAULT_PLANNER_RESOLUTION;
    situation.res = situation.resolution;
    situation.v4PromptCharacters = activeVariant.generation.v4PromptCharacters || [];
    situation.v4_prompt = situation.v4PromptCharacters;
    renderSituationDetailShell(project, situation);
}

export async function addSituationPromptVariant() {
    const project = getActiveProject();
    const situation = getSituationById(project, window.PROJECT_ACTIVE_SITUATION_ID);
    if (!project || !situation) return;

    const name = prompt('새 구도 이름을 입력하세요.', 'New Composition');
    if (name === null) return;
    const variants = normalizeSituationPromptVariants(situation);
    const resolution = document.getElementById('situation-resolution-input')?.value || DEFAULT_PLANNER_RESOLUTION;
    const newVariant = {
        id: createPromptVariantId('composition'),
        name: name.trim() || 'New Composition',
        prompt: normalizeSituationPrompt({}),
        generation: {
            res: resolution,
            v4PromptCharacters: [],
            v4_prompt: []
        },
        updatedAt: Date.now()
    };

    situation.prompt = newVariant.prompt;
    situation.generation = newVariant.generation;
    situation.promptVariants = [...variants, newVariant];
    situation.activePromptVariantId = newVariant.id;
    situation.resolution = resolution;
    situation.res = resolution;
    situation.v4PromptCharacters = [];
    situation.v4_prompt = [];
    situation.updatedAt = Date.now();
    await saveProjectSituations(project);
    renderSituationDetailShell(project, situation);
}
