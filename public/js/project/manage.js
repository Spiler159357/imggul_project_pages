import { PROJECT_PROMPT_FIELDS, PROJECT_SECTIONS, clearProjectCaches, clearRootProjectCache, createProjectFolder, createPromptVariantId, deleteProjectFolder, escapeHtml, escapeJsString, getActiveProject, getCharacterById, getDefaultProjectId, getItemLabel, getProjectBackgroundPromptData, getProjectBasePrefix, getProjectById, getProjectItems, getProjectPromptFieldConfig, getProjectPromptFieldValues, getProjects, getSelectedPlannerCharacterId, hydrateProjectPromptInput, hydrateProjectStylePromptInput, initProjectPromptMarkdownToggle, initPromptSectionInput, isInvalidProjectFolderName, loadCharacterFiles, loadCharacterMeta, loadProjectBackgroundPrompts, loadProjectCharacters, loadProjectSituations, loadProjectStylePrompt, loadProjects, normalizeProjectBackgroundPrompts, normalizeProjectFolderName, refreshProjectIcons, rememberProjectRoute, renameProjectFolder, renderEmptyState, renderProjectShell, replaceProjectRoute, saveProjectAlias, saveProjectBackgroundPrompts, setProjectRoute, switchProjectPromptField, uploadProjectMarkdownFile, uploadProjectStylePrompt } from './shared.js?v=prompt-tab-20261005a';
import { renderCharacterSection } from './character.js?v=global-posts-20261005a';
import { loadPlannerMeta, loadPlannerQueueMetas, loadPlannerSettings, normalizePlannerSettings, refreshPlannerBackgroundStatus, renderPlannerSection } from './planner.js?v=project-dashboard-20261006a';
import { renderSituationSection } from './situation.js?v=global-posts-20261005a';
import { renderImageEditor } from '../image_editor.js';

export async function renderProjectManage(skipHistory = true) {
    if (window.PROJECT_PLANNER_TARGET_PICKER?.open) window.closePlannerTargetPicker?.(null, false);
    window.PROJECT_VIEW = 'manage';
    window.PROJECT_ACTIVE_SECTION = null;
    window.syncPlannerBackgroundPolling?.();
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

export function renderProjectManageShell(projects, state = {}) {
    renderProjectShell(`
        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <section class="w-full max-w-3xl mx-auto pt-8 sm:pt-12">
                <button type="button" onclick="window.openGlobalPostsSection()" class="mb-8 flex w-full items-center gap-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-left shadow-sm transition hover:border-indigo-400 hover:shadow-md dark:border-indigo-900/70 dark:bg-indigo-950/30 dark:hover:border-indigo-700 sm:p-5">
                    <span class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white dark:bg-indigo-500">
                        <i data-lucide="newspaper" class="h-5 w-5"></i>
                    </span>
                    <span class="min-w-0 flex-1">
                        <span class="block text-sm font-bold text-gray-900 dark:text-white sm:text-base">게시글 관리</span>
                        <span class="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">모든 공개 프로젝트에 공통으로 표시되는 게시글과 댓글을 관리합니다.</span>
                    </span>
                    <i data-lucide="chevron-right" class="h-5 w-5 flex-shrink-0 text-indigo-500"></i>
                </button>
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
                                ${project.alias ? `<span class="block text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">경로: ${escapeHtml(project.folderName)}</span>` : ''}
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

export function renderProjectCreateModal() {
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
                        <label for="project-create-name" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">경로</label>
                        <input id="project-create-name" type="text" required class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-gray-700 dark:text-white" placeholder="실제 폴더 경로">
                        <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">탐색기 최상위 폴더 경로로 사용됩니다.</p>
                    </div>

                    <div>
                        <label for="project-create-alias" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">이름</label>
                        <input id="project-create-alias" type="text" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-gray-700 dark:text-white" placeholder="이름">
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

export function setProjectCreateError(message) {
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
        setProjectCreateError('경로에는 /, \\, 숨김 폴더명, 예약 폴더명을 사용할 수 없습니다.');
        return;
    }

    if (getProjects().some(project => project.folderName === folderName)) {
        setProjectCreateError('이미 존재하는 프로젝트 경로입니다.');
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
    if (window.PROJECT_PLANNER_TARGET_PICKER?.open) window.closePlannerTargetPicker?.(null, false);
    if (!Array.isArray(window.PROJECTS)) {
        await loadProjects().catch(() => []);
    }

    const project = getProjectById(projectId);
    if (!project) {
        renderProjectManage(skipHistory);
        return;
    }

    window.stopPlannerBackgroundPolling?.();
    window.PROJECT_VIEW = 'detail-loading';
    window.PROJECT_ACTIVE_SECTION = null;
    window.PROJECT_ACTIVE_PROJECT_ID = project.id;
    const [characters] = await Promise.all([
        loadProjectCharacters(project).catch(() => []),
        loadProjectSituations(project).catch(() => [])
    ]);
    const queueMetas = await loadPlannerQueueMetas(project, characters, { force: true }).catch(() => []);
    window.PROJECT_PLANNER_QUEUE_METAS = queueMetas;
    const selectedCharacterId = getSelectedPlannerCharacterId(project);
    window.PROJECT_PLANNER_META = queueMetas.find(entry => (
        entry.meta?.characterId === selectedCharacterId || entry.character?.id === selectedCharacterId
    ))?.meta || null;

    const activeRunKeys = queueMetas
        .filter(entry => isPlannerDashboardMetaActive(entry.meta))
        .map(entry => entry.meta?.runKey || entry.meta?.backgroundJobId)
        .filter(Boolean);
    await Promise.allSettled(activeRunKeys.map(runKey => (
        refreshPlannerBackgroundStatus(runKey, { render: false })
    )));

    window.PROJECT_VIEW = 'detail';
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
                <div id="project-action-menu" class="hidden absolute right-0 top-10 z-20 w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden py-1">
                    <button type="button" onclick="window.renameActiveProject()" class="w-full px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">프로젝트 이름 변경</button>
                    <button type="button" onclick="window.changeActiveProjectPath()" class="w-full px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">프로젝트 경로 변경</button>
                    <button type="button" onclick="window.deleteActiveProject()" class="w-full px-3 py-2 text-left text-xs font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition">프로젝트 삭제</button>
                </div>
            </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
            <section class="mx-auto grid min-h-full w-full max-w-[1480px] grid-cols-1 gap-4 lg:h-full lg:grid-cols-[minmax(0,3.2fr)_minmax(260px,1fr)] lg:gap-5">
                ${renderPlannerDashboard(project)}
                <aside class="flex min-h-0 flex-col gap-4">
                    ${renderProjectVisibilityCard(project)}
                    ${renderProjectMenuCard(project)}
                </aside>
            </section>
        </div>
    `);
    window.syncPlannerBackgroundPolling?.();

    const routeState = { projectView: 'detail', projectId: project.id };
    const routeHash = `#project/${project.id}`;
    if (!skipHistory) setProjectRoute(routeState, routeHash);
    else rememberProjectRoute(routeState, routeHash);
}

function getPlannerDashboardStatus(status) {
    const statuses = {
        draft: { label: '초안', tone: 'neutral' },
        pending: { label: '대기', tone: 'neutral' },
        queued: { label: '대기 중', tone: 'active' },
        running: { label: '생성 중', tone: 'active' },
        paused: { label: '중지됨', tone: 'neutral' },
        cancel_requested: { label: '취소 중', tone: 'active' },
        done: { label: '완료', tone: 'complete' },
        complete: { label: '완료', tone: 'complete' },
        completed: { label: '완료', tone: 'complete' },
        confirmed: { label: '확정 완료', tone: 'complete' },
        partial_failed: { label: '일부 실패', tone: 'error' },
        failed: { label: '실패', tone: 'error' },
        cancelled: { label: '취소됨', tone: 'neutral' }
    };
    return statuses[status] || { label: status || '대기', tone: 'neutral' };
}

function getPlannerDashboardStatusClass(tone) {
    if (tone === 'active') return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
    if (tone === 'complete') return 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300';
    if (tone === 'error') return 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300';
    return 'border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-600 dark:bg-gray-900/50 dark:text-gray-300';
}

function isPlannerDashboardMetaActive(meta) {
    const activeStatuses = new Set(['queued', 'running', 'cancel_requested']);
    return activeStatuses.has(meta?.status) || activeStatuses.has(meta?.backgroundStatus?.status);
}

function getPlannerDashboardItemProgress(item = {}) {
    const variantTargetCount = Array.isArray(item.variantGenerations)
        ? item.variantGenerations.reduce((sum, variant) => {
            const count = Number(variant?.count);
            return sum + (Number.isFinite(count) && count > 0 ? count : 0);
        }, 0)
        : 0;
    const targetCount = Math.max(1, variantTargetCount || Number(item.count) || 1);
    const generatedCount = Math.max(
        Array.isArray(item.images) ? item.images.length : 0,
        Number(item.completedCount) || 0
    );
    const failedCount = Math.max(0, Number(item.failedCount) || 0);
    const displayStatus = generatedCount >= targetCount && failedCount === 0
        ? 'done'
        : (item.status || 'pending');

    return {
        displayStatus,
        generatedCount,
        targetCount,
        percent: Math.min(100, Math.round((generatedCount / targetCount) * 100))
    };
}

function getPlannerDashboardEntries(project) {
    const queueMetas = Array.isArray(window.PROJECT_PLANNER_QUEUE_METAS)
        ? window.PROJECT_PLANNER_QUEUE_METAS
        : [];
    const fallbackMeta = window.PROJECT_PLANNER_META;
    const entries = queueMetas.length
        ? queueMetas
        : (fallbackMeta?.items?.length ? [{
            character: getCharacterById(project, fallbackMeta.characterId),
            meta: fallbackMeta
        }] : []);
    const statusRank = status => {
        if (['queued', 'running', 'cancel_requested'].includes(status)) return 0;
        if (['paused', 'partial_failed', 'failed'].includes(status)) return 1;
        if (['done', 'complete', 'completed', 'confirmed'].includes(status)) return 3;
        return 2;
    };

    return entries.flatMap((entry, characterIndex) => {
        const characterName = entry.character?.name
            || entry.character?.alias
            || entry.character?.folderName
            || entry.meta?.characterId
            || '캐릭터';
        return (entry.meta?.items || []).map((item, itemIndex) => ({
            characterIndex,
            itemIndex,
            characterName,
            item,
            progress: getPlannerDashboardItemProgress(item)
        }));
    }).sort((a, b) => (
        statusRank(a.progress.displayStatus) - statusRank(b.progress.displayStatus)
        || a.characterIndex - b.characterIndex
        || a.itemIndex - b.itemIndex
    ));
}

function renderPlannerDashboard(project) {
    const entries = getPlannerDashboardEntries(project);
    const activeStatuses = new Set(['queued', 'running', 'cancel_requested']);
    const completedStatuses = new Set(['done', 'complete', 'completed', 'confirmed']);
    const activeCount = entries.filter(entry => activeStatuses.has(entry.progress.displayStatus)).length;
    const completedCount = entries.filter(entry => completedStatuses.has(entry.progress.displayStatus)).length;
    const totalImageCount = entries.reduce((sum, entry) => sum + entry.progress.targetCount, 0);
    const completedImageCount = entries.reduce((sum, entry) => (
        sum + Math.min(entry.progress.generatedCount, entry.progress.targetCount)
    ), 0);

    return `
        <section id="project-planner-dashboard" role="button" tabindex="0" aria-label="플래너 열기" onclick="window.openProjectSection('planner')" onkeydown="if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.openProjectSection('planner'); }" class="group flex h-[68dvh] min-h-[380px] max-h-[620px] cursor-pointer flex-col overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-600 lg:h-full lg:min-h-0 lg:max-h-none">
            <div class="flex flex-col gap-3 border-b border-gray-200 px-4 py-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div class="flex items-center gap-3">
                    <i data-lucide="calendar-check" class="h-5 w-5 text-indigo-600 dark:text-indigo-400"></i>
                    <h2 class="text-lg font-bold text-gray-900 dark:text-white">플래너</h2>
                </div>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-bold text-gray-500 dark:text-gray-400">
                    <span class="text-[10px] font-extrabold uppercase tracking-wide text-gray-400 dark:text-gray-500">플랜</span>
                    <span>전체 <strong class="ml-1 text-gray-900 dark:text-white">${entries.length}</strong></span>
                    <span>진행 중 <strong class="ml-1 text-emerald-600 dark:text-emerald-400">${activeCount}</strong></span>
                    <span>완료 <strong class="ml-1 text-indigo-600 dark:text-indigo-400">${completedCount}</strong></span>
                    <span class="hidden h-4 w-px bg-gray-200 dark:bg-gray-700 sm:block"></span>
                    <span class="text-[10px] font-extrabold uppercase tracking-wide text-gray-400 dark:text-gray-500">이미지</span>
                    <span>전체 <strong class="ml-1 text-gray-900 dark:text-white">${totalImageCount}</strong></span>
                    <span>완료 <strong class="ml-1 text-indigo-600 dark:text-indigo-400">${completedImageCount}</strong></span>
                    <i data-lucide="chevron-right" class="h-4 w-4 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-indigo-500"></i>
                </div>
            </div>
            <div class="grid grid-cols-[minmax(0,1fr)_90px_90px] gap-3 border-b border-gray-200 px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:border-gray-700 dark:text-gray-500 sm:grid-cols-[52px_minmax(0,1fr)_120px_140px] sm:px-5">
                <span class="hidden sm:block">#</span>
                <span>장면</span>
                <span>상태</span>
                <span>진행도</span>
            </div>
            <div id="project-planner-dashboard-scroll" class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1 sm:px-3">
                ${entries.length ? entries.map((entry, index) => {
                    const item = entry.item;
                    const { displayStatus, generatedCount, targetCount, percent } = entry.progress;
                    const status = getPlannerDashboardStatus(displayStatus);
                    const itemNumber = item?.imageNumber ?? index + 1;
                    const itemName = item?.situationName || item?.situationId || `장면 ${index + 1}`;
                    return `
                        <span class="grid min-h-16 grid-cols-[minmax(0,1fr)_90px_90px] items-center gap-3 border-b border-gray-100 px-2 py-3 text-sm dark:border-gray-700/80 sm:grid-cols-[52px_minmax(0,1fr)_120px_140px]">
                            <span class="hidden font-bold text-gray-400 dark:text-gray-500 sm:block">${escapeHtml(itemNumber)}</span>
                            <span class="min-w-0">
                                <span class="block truncate font-bold text-gray-800 transition group-hover:text-indigo-700 dark:text-gray-100 dark:group-hover:text-indigo-300">${escapeHtml(itemName)}</span>
                                <span class="mt-0.5 block truncate text-[11px] font-medium text-gray-400 dark:text-gray-500">${escapeHtml(entry.characterName)}</span>
                            </span>
                            <span class="inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-[11px] font-bold ${getPlannerDashboardStatusClass(status.tone)}">${escapeHtml(status.label)}</span>
                            <span class="min-w-0">
                                <span class="block text-xs font-bold text-gray-600 dark:text-gray-300">${generatedCount} / ${targetCount}</span>
                                <span class="mt-1 block h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                                    <span class="block h-full rounded-full bg-indigo-500" style="width:${percent}%"></span>
                                </span>
                            </span>
                        </span>
                    `;
                }).join('') : `
                    <span class="flex h-full min-h-80 flex-col items-center justify-center px-6 text-center">
                        <i data-lucide="calendar-check" class="mb-3 h-8 w-8 text-indigo-500"></i>
                        <span class="text-sm font-bold text-gray-700 dark:text-gray-200">생성된 플랜이 없습니다.</span>
                        <span class="mt-1 text-xs text-gray-400 dark:text-gray-500">플래너를 열어 이미지 생성 계획을 만들어보세요.</span>
                    </span>
                `}
            </div>
        </section>
    `;
}

export function renderProjectPlannerDashboard() {
    if (window.PROJECT_VIEW !== 'detail') return false;
    const current = document.getElementById('project-planner-dashboard');
    const project = getActiveProject();
    if (!current || !project) return false;

    const scrollTop = document.getElementById('project-planner-dashboard-scroll')?.scrollTop || 0;
    current.outerHTML = renderPlannerDashboard(project);
    const nextScroll = document.getElementById('project-planner-dashboard-scroll');
    if (nextScroll) nextScroll.scrollTop = scrollTop;
    refreshProjectIcons();
    return true;
}

function renderProjectVisibilityCard(project) {
    return `
        <section class="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div class="flex items-center gap-2 border-b border-gray-200 px-4 py-3.5 dark:border-gray-700">
                <i data-lucide="settings" class="h-5 w-5 text-indigo-600 dark:text-indigo-400"></i>
                <h2 class="font-bold text-gray-900 dark:text-white">프로젝트 공개 설정</h2>
            </div>
            <label class="flex cursor-pointer items-center justify-between gap-4 px-4 py-5">
                <span class="min-w-0">
                    <span class="block text-sm font-bold text-gray-800 dark:text-gray-100">공개 프로젝트</span>
                    <span class="mt-1 block text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">링크를 통해 누구나 볼 수 있습니다.</span>
                </span>
                <span class="relative inline-flex h-6 w-11 flex-shrink-0 items-center">
                    <input id="project-visibility-checkbox" type="checkbox" class="peer sr-only" onchange="window.toggleActiveProjectVisibility(event)" ${project.isPublic ? 'checked' : ''}>
                    <span class="absolute inset-0 rounded-full bg-gray-300 transition peer-checked:bg-indigo-600 peer-disabled:opacity-50 dark:bg-gray-600"></span>
                    <span class="absolute left-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5"></span>
                </span>
            </label>
        </section>
    `;
}

function renderProjectMenuCard(project) {
    const menuItems = [
        { key: 'character', title: '캐릭터', meta: `${getProjectItems(project, 'characters').length}명`, icon: 'users' },
        { key: 'situation', title: '상황', meta: `${getProjectItems(project, 'situations').length}개`, icon: 'map' },
        { key: 'prompt', title: '프롬프트 설정', meta: '', icon: 'file-text' },
        { key: 'image-editor', title: '편집기', meta: '이미지 편집', icon: 'image' }
    ];

    return `
        <section class="min-h-0 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div class="flex items-center gap-2 border-b border-gray-200 px-4 py-3.5 dark:border-gray-700">
                <i data-lucide="folder" class="h-5 w-5 text-indigo-600 dark:text-indigo-400"></i>
                <h2 class="font-bold text-gray-900 dark:text-white">프로젝트 메뉴</h2>
            </div>
            <div class="divide-y divide-gray-200 px-3 dark:divide-gray-700">
                ${menuItems.map(item => `
                    <button type="button" onclick="window.openProjectSection('${escapeJsString(item.key)}')" class="group/menu flex w-full items-center gap-3 px-1 py-4 text-left transition hover:text-indigo-600 dark:hover:text-indigo-400">
                        <span class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-indigo-600 dark:text-indigo-400">
                            <i data-lucide="${item.icon}" class="h-5 w-5"></i>
                        </span>
                        <span class="min-w-0 flex-1">
                            <span class="block text-sm font-bold text-gray-800 transition group-hover/menu:text-indigo-600 dark:text-gray-100 dark:group-hover/menu:text-indigo-400">${escapeHtml(item.title)}</span>
                            ${item.meta ? `<span class="mt-0.5 block truncate text-[11px] text-gray-400 dark:text-gray-500">${escapeHtml(item.meta)}</span>` : ''}
                        </span>
                        <i data-lucide="chevron-right" class="h-4 w-4 flex-shrink-0 text-gray-400 transition group-hover/menu:translate-x-0.5 group-hover/menu:text-indigo-500"></i>
                    </button>
                `).join('')}
            </div>
        </section>
    `;
}

export function toggleProjectActionMenu(event) {
    if (event) event.stopPropagation();
    const menu = document.getElementById('project-action-menu');
    if (!menu) return;

    menu.classList.toggle('hidden');
}

export function closeProjectActionMenu() {
    document.getElementById('project-action-menu')?.classList.add('hidden');
}

export async function toggleActiveProjectVisibility(event) {
    const project = getActiveProject();
    const checkbox = event?.currentTarget;
    if (!project || !checkbox) return;

    const previousValue = project.isPublic === true;
    const nextValue = checkbox.checked === true;
    checkbox.disabled = true;

    try {
        const res = await fetch(`/api/admin/projects/${encodeURIComponent(project.id)}/visibility`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isPublic: nextValue }),
            cache: 'no-store'
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(payload.error?.message || payload.error || '프로젝트 공개 상태 저장에 실패했습니다.');
        }
        project.isPublic = payload.data?.isPublic === true;
        checkbox.checked = project.isPublic;
    } catch (err) {
        project.isPublic = previousValue;
        checkbox.checked = previousValue;
        alert(err.message || '프로젝트 공개 상태 저장에 실패했습니다.');
    } finally {
        checkbox.disabled = false;
    }
}

export async function renameActiveProject() {
    closeProjectActionMenu();
    const project = getActiveProject();
    if (!project) return;

    const nextName = prompt('새 프로젝트 이름을 입력하세요. 비워두면 경로를 표시합니다.', project.alias || '');
    if (nextName === null) return;

    const alias = nextName.trim();
    if (alias === (project.alias || '')) return;

    try {
        await saveProjectAlias(project.prefix, alias);
        clearProjectCaches(project.prefix);
        await loadProjects(true);
        await openProjectDetail(project.id, true);
        if (window.currentPrefix === getProjectBasePrefix() && window.loadPath) window.loadPath(getProjectBasePrefix(), true);
    } catch (err) {
        alert(err.message || '프로젝트 이름 변경 실패');
    }
}

export async function changeActiveProjectPath() {
    closeProjectActionMenu();
    const project = getActiveProject();
    if (!project) return;

    const nextPath = prompt('새 프로젝트 경로를 입력하세요.', project.folderName);
    if (nextPath === null) return;

    const folderName = normalizeProjectFolderName(nextPath);
    if (isInvalidProjectFolderName(folderName)) {
        alert('경로에는 /, \\, 숨김 폴더명, 예약 폴더명을 사용할 수 없습니다.');
        return;
    }

    if (folderName === project.folderName) return;
    if (getProjects().some(item => item.folderName === folderName)) {
        alert('이미 존재하는 프로젝트 경로입니다.');
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
        alert(err.message || '프로젝트 경로 변경 실패');
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

export function renderProjectDashboardCard(project, section, sizeClass = 'min-h-[220px]') {
    if (!section) return '';

    return `
        <button type="button" onclick="window.openProjectSection('${escapeJsString(section.key)}')" class="${sizeClass} min-w-0 text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition flex flex-col">
            <span class="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                <i data-lucide="${section.icon}" class="w-4 h-4 text-indigo-600 dark:text-indigo-400"></i>
                ${escapeHtml(section.title)}
            </span>
            <span class="flex-1 min-h-0 p-4 block overflow-y-auto">
                ${renderProjectPanelItems(project, section)}
            </span>
        </button>
    `;
}

export function renderProjectPanelItems(project, section) {
    if (section.key === 'planner') {
        const meta = window.PROJECT_PLANNER_META || null;
        const count = Array.isArray(meta?.items) ? meta.items.length : 0;
        return `
            <span class="h-full flex flex-col items-center justify-center text-center text-xs text-gray-500 dark:text-gray-400">
                <i data-lucide="calendar-check" class="w-8 h-8 mb-2 text-indigo-500"></i>
                <span class="font-bold text-gray-700 dark:text-gray-200">${count ? `${count}개 플랜 작성 중` : section.emptyText}</span>
                <span class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">상황 이미지 생성 계획을 여기에서 관리합니다.</span>
            </span>
        `;
    }

    if (section.key === 'image-editor') {
        return `
            <span class="h-full flex flex-col items-center justify-center text-center text-xs text-gray-500 dark:text-gray-400">
                <i data-lucide="scissors" class="w-8 h-8 mb-2 text-indigo-500"></i>
                <span class="font-bold text-gray-700 dark:text-gray-200">${escapeHtml(section.emptyText)}</span>
                <span class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">프로젝트 이미지의 간단한 보정과 저장을 관리합니다.</span>
            </span>
        `;
    }

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
    if (window.PROJECT_PLANNER_TARGET_PICKER?.open) window.closePlannerTargetPicker?.(null, false);
    if (!Array.isArray(window.PROJECTS)) {
        await loadProjects().catch(() => []);
    }

    const section = PROJECT_SECTIONS.find(item => item.key === sectionKey) || PROJECT_SECTIONS[0];
    window.PROJECT_VIEW = 'section';
    window.PROJECT_ACTIVE_SECTION = section.key;
    window.syncPlannerBackgroundPolling?.();

    if (section.key === 'prompt') renderPromptSection(section);
    else if (section.key === 'character') {
        const project = getActiveProject();
        renderCharacterSection(section, { loading: !!project && !project.charactersLoaded });
        await loadProjectCharacters(project).catch(err => {
            if (window.PROJECT_ACTIVE_SECTION === 'character') renderCharacterSection(section, { error: err.message });
        });
        if (window.PROJECT_ACTIVE_SECTION === 'character') renderCharacterSection(section);
    }
    else if (section.key === 'situation') {
        const project = getActiveProject();
        renderSituationSection(section, { loading: !!project && !project.situationsLoaded });
        await loadProjectSituations(project).catch(err => {
            if (window.PROJECT_ACTIVE_SECTION === 'situation') renderSituationSection(section, { error: err.message });
        });
        if (window.PROJECT_ACTIVE_SECTION === 'situation') renderSituationSection(section);
    }
    else if (section.key === 'planner') {
        const project = getActiveProject();
        renderPlannerSection(section, { loading: !!project && (!project.situationsLoaded || !project.charactersLoaded) });
        await Promise.all([
            loadProjectSituations(project),
            loadProjectCharacters(project),
            loadProjectBackgroundPrompts(project).catch(() => normalizeProjectBackgroundPrompts()),
            loadPlannerSettings(project).catch(() => normalizePlannerSettings())
        ]).catch(err => {
            if (window.PROJECT_ACTIVE_SECTION === 'planner') renderPlannerSection(section, { error: err.message });
        });
        const characterId = getSelectedPlannerCharacterId(project);
        window.PROJECT_PLANNER_SELECTED_CHARACTER_ID = characterId;
        const character = getCharacterById(project, characterId);
        await Promise.all([
            loadPlannerMeta(project, characterId, { force: true }).then(meta => { window.PROJECT_PLANNER_META = meta; }).catch(() => { window.PROJECT_PLANNER_META = null; }),
            loadProjectStylePrompt(project).then(style => { window.PROJECT_PLANNER_PROJECT_STYLE = style || ''; }).catch(() => { window.PROJECT_PLANNER_PROJECT_STYLE = ''; }),
            character ? loadCharacterFiles(character).catch(() => []) : Promise.resolve([]),
            character ? loadCharacterMeta(character).catch(() => ({})) : Promise.resolve({})
        ]);
        window.PROJECT_PLANNER_QUEUE_METAS = await loadPlannerQueueMetas(project, getProjectItems(project, 'characters'), { force: true }).catch(() => []);
        if (window.PROJECT_ACTIVE_SECTION === 'planner') {
            renderPlannerSection(section);
            window.syncPlannerBackgroundPolling?.({
                immediate: window.PROJECT_PLANNER_VIEW === 'run'
            });
        }
    }
    else if (section.key === 'image-editor') {
        const project = getActiveProject();
        renderProjectShell(`
            ${renderSectionHeader(section.title, {
                backButtonId: 'image-editor-back-btn',
                backOnClick: '',
                actionsHtml: `
                    <div class="hidden sm:flex min-w-0 flex-col items-end mr-1">
                        <span id="image-editor-name" class="max-w-48 truncate text-xs font-bold text-gray-700 dark:text-gray-200">이미지 편집기</span>
                        <span id="image-editor-dirty" class="max-w-48 truncate text-[11px] text-gray-500 dark:text-gray-400">이미지 없음</span>
                    </div>
                    <button id="image-editor-open-library-btn" type="button" class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-bold hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 transition" title="이미지 열기">
                        <i data-lucide="folder-open" class="w-4 h-4"></i><span class="hidden sm:inline">열기</span>
                    </button>
                    <button id="image-editor-save-work-btn" type="button" class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-bold hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed transition" disabled title="작업 저장">
                        <i data-lucide="file-check" class="w-4 h-4"></i><span class="hidden sm:inline">작업 저장</span>
                    </button>
                    <button id="image-editor-undo-btn" type="button" class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed transition" title="되돌리기" aria-label="되돌리기">
                        <i data-lucide="undo-2" class="w-4 h-4"></i>
                    </button>
                    <button id="image-editor-redo-btn" type="button" class="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed transition" title="다시 실행" aria-label="다시 실행">
                        <i data-lucide="redo-2" class="w-4 h-4"></i>
                    </button>
                    <button id="image-editor-save-btn" type="button" class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition" disabled title="저장">
                        <i data-lucide="save" class="w-4 h-4"></i><span class="hidden sm:inline">저장</span>
                    </button>
                    <button id="image-editor-save-as-btn" type="button" class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 text-xs font-bold hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed transition" disabled title="다른 이름으로 저장">
                        <i data-lucide="copy-plus" class="w-4 h-4"></i><span class="hidden sm:inline">다른 이름</span>
                    </button>
                `
            })}
            <div id="project-image-editor-content" class="flex-1 min-h-0 bg-gray-100 dark:bg-gray-900"></div>
        `);
        renderImageEditor(true, {
            rootId: 'project-image-editor-content',
            projectPrefix: project?.prefix || '',
            ...(window.PROJECT_IMAGE_EDITOR_NEXT_OPTIONS || {})
        });
        window.PROJECT_IMAGE_EDITOR_NEXT_OPTIONS = null;
    }
    const routeState = { projectView: 'section', projectId: window.PROJECT_ACTIVE_PROJECT_ID, projectSection: section.key };
    const routeHash = `#project/${window.PROJECT_ACTIVE_PROJECT_ID}/${section.key}`;
    if (!skipHistory) setProjectRoute(routeState, routeHash);
    else rememberProjectRoute(routeState, routeHash);
}

export function renderSectionHeader(title, options = {}) {
    const project = getActiveProject() || { id: getDefaultProjectId(), name: '프로젝트 이름' };
    const backButtonId = options.backButtonId ? ` id="${escapeHtml(options.backButtonId)}"` : '';
    const backOnClick = options.backOnClick !== undefined
        ? options.backOnClick
        : `window.openProjectDetail('${escapeJsString(project.id)}', false)`;
    const backOnClickAttr = backOnClick ? ` onclick="${backOnClick}"` : '';
    const actionsHtml = options.actionsHtml || '';
    return `
        <div class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 sm:px-6 bg-white dark:bg-gray-800 flex-shrink-0 gap-3">
            <div class="flex items-center gap-2 min-w-0">
                <button${backButtonId} type="button"${backOnClickAttr} class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="프로젝트로 돌아가기" aria-label="프로젝트로 돌아가기">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <div class="min-w-0">
                    <h1 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">${escapeHtml(project.name)}</h1>
                    <p class="text-[11px] text-gray-500 dark:text-gray-400 truncate">${escapeHtml(title)}</p>
                </div>
            </div>
            ${actionsHtml ? `<div class="flex items-center justify-end gap-1.5 min-w-0 flex-shrink-0">${actionsHtml}</div>` : ''}
        </div>
    `;
}

export function renderPromptSection(section) {
    renderProjectShell(`
        ${renderSectionHeader(section.title)}
        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <section class="grid grid-cols-1 xl:grid-cols-[minmax(0,7fr)_minmax(360px,3fr)] gap-4 sm:gap-5 min-h-full">
                <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl flex flex-col min-h-[660px] overflow-hidden">
                    <div class="flex items-start justify-between gap-3 px-4 sm:px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                        <div>
                            <h2 class="font-bold text-sm text-gray-900 dark:text-white">프로젝트 텍스트</h2>
                            <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">챗봇 동작, 시작 상황, 소개 페이지 내용을 각각 관리합니다.</p>
                        </div>
                        <button id="project-prompt-preview-toggle" type="button" class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 transition" aria-pressed="false">
                            <i data-lucide="eye" class="w-4 h-4"></i>
                            <span>마크다운 미리보기</span>
                        </button>
                    </div>

                    <div class="px-4 sm:px-5 py-3 flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/30" role="tablist" aria-label="프로젝트 프롬프트 입력 종류">
                        ${PROJECT_PROMPT_FIELDS.map(field => `
                            <button type="button" role="tab" data-project-prompt-field="${escapeHtml(field.key)}" onclick="window.switchProjectPromptField('${escapeJsString(field.key)}')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-600 transition" aria-selected="false">
                                <i data-lucide="${field.icon}" class="w-4 h-4"></i>
                                <span>${escapeHtml(field.title)}</span>
                                ${field.key === 'start' ? '<span class="font-normal opacity-70">최대 3개</span>' : ''}
                            </button>
                        `).join('')}
                    </div>

                    <div id="project-start-situation-tabs" class="hidden px-4 sm:px-5 py-2.5 flex flex-wrap items-center gap-2 border-b border-gray-200 dark:border-gray-700" role="tablist" aria-label="시작 상황 선택">
                        ${[0, 1, 2].map(index => `
                            <button type="button" role="tab" data-project-start-situation="${index}" onclick="window.switchProjectStartSituation(${index})" class="px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-[11px] font-bold text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-600 transition" aria-selected="false">상황 ${index + 1}</button>
                        `).join('')}
                        <span class="ml-auto text-[10px] text-gray-400 dark:text-gray-500">최대 3개</span>
                    </div>

                    <div id="project-description-format-tabs" class="hidden px-4 sm:px-5 py-2.5 flex flex-wrap items-center gap-2 border-b border-gray-200 dark:border-gray-700" role="tablist" aria-label="프로젝트 설명 편집 형식">
                        <span class="text-[10px] font-bold text-gray-400 dark:text-gray-500 mr-1">편집 형식</span>
                        <button type="button" role="tab" data-project-description-format="markdown" onclick="window.switchProjectDescriptionFormat('markdown')" class="px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-[11px] font-bold text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-600 transition" aria-selected="false">Markdown</button>
                        <button type="button" role="tab" data-project-description-format="html" onclick="window.switchProjectDescriptionFormat('html')" class="px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-[11px] font-bold text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-600 transition" aria-selected="false">HTML · CSS</button>
                    </div>

                    <div class="m-4 sm:m-5 mt-4 flex-1 min-h-[430px] flex flex-col rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/40 dark:bg-gray-900/30 overflow-hidden">
                        <div class="flex items-center gap-2 px-3.5 py-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                            <h3 id="project-prompt-field-title" class="font-bold text-xs text-gray-900 dark:text-white">시스템 프롬프트</h3>
                            <span id="project-prompt-field-file" class="text-[10px] font-mono text-gray-400 dark:text-gray-500">prompt.md</span>
                            <span class="ml-auto text-[10px] font-bold text-gray-500 dark:text-gray-400">현재 <strong id="project-prompt-count" class="text-xs text-gray-900 dark:text-white">0자</strong></span>
                        </div>
                        <textarea id="project-prompt-input" class="flex-1 min-h-[360px] resize-none outline-none bg-transparent p-4 text-sm leading-6 text-gray-700 dark:text-gray-200 font-mono" aria-label="시스템 프롬프트 입력"></textarea>
                        <div id="project-prompt-preview" class="hidden flex-1 min-h-[360px] overflow-y-auto p-4 text-sm leading-6 text-gray-700 dark:text-gray-200 prose-like" aria-label="마크다운 미리보기"></div>
                        <iframe id="project-prompt-html-preview" class="hidden flex-1 min-h-[360px] w-full border-0 bg-white" sandbox="" title="HTML/CSS 미리보기"></iframe>
                        <div class="min-h-9 px-3.5 py-2 flex items-center gap-2 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-400 dark:text-gray-500">
                            <p id="project-prompt-load-status" class="min-h-4"></p>
                            <span class="ml-auto">현재 문서만 독립적으로 저장됩니다.</span>
                        </div>
                    </div>

                    <div class="px-4 sm:px-5 pb-4 flex flex-wrap items-center justify-end gap-3">
                        <p id="project-prompt-save-status" class="mr-auto min-h-4 text-[11px] text-gray-400 dark:text-gray-500"></p>
                        <button id="project-prompt-save-btn" type="button" onclick="window.saveProjectPromptMarkdown()" class="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 transition">
                            <i data-lucide="save" class="w-4 h-4"></i>
                            <span id="project-prompt-save-label">시스템 프롬프트 저장</span>
                        </button>
                    </div>
                </div>

                <div class="flex flex-col gap-4 min-h-[660px]">
                    <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl flex flex-col min-h-[250px] overflow-hidden">
                        <div class="px-4 py-3.5 flex items-start justify-between gap-3 border-b border-gray-200 dark:border-gray-700">
                            <div>
                                <h3 class="font-bold text-sm text-gray-900 dark:text-white">그림체 프롬프트</h3>
                                <p class="mt-1 text-[10px] text-gray-500 dark:text-gray-400">프로젝트 이미지의 기본 스타일</p>
                            </div>
                            <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 text-[10px] font-bold text-emerald-600 dark:text-emerald-400"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>사용 중</span>
                        </div>
                        <label class="m-3 mb-2 block flex-1 min-h-[120px]">
                            <span class="sr-only">그림체 프롬프트</span>
                            <textarea id="project-style-prompt-input" class="w-full min-h-[120px] resize-y p-3 text-xs leading-5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="플래너의 그림체 항목으로 가져올 프롬프트"></textarea>
                        </label>
                        <div class="px-3 pb-3 flex flex-wrap items-center justify-end gap-2">
                            <p id="project-style-prompt-status" class="mr-auto min-h-4 text-[10px] text-gray-400 dark:text-gray-500"></p>
                            <button id="project-style-prompt-save-btn" type="button" onclick="window.saveProjectStylePrompt()" class="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition">
                                <i data-lucide="save" class="w-4 h-4"></i>
                                <span>그림체 저장</span>
                            </button>
                        </div>
                    </section>

                    <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl flex-1 min-h-[390px] flex flex-col overflow-hidden">
                        <div class="px-4 py-3.5 flex items-start justify-between gap-3 border-b border-gray-200 dark:border-gray-700">
                            <div>
                                <h3 class="font-bold text-sm text-gray-900 dark:text-white">배경 프롬프트</h3>
                                <p class="mt-1 text-[10px] text-gray-500 dark:text-gray-400">배경마다 이름과 프롬프트를 개별 관리합니다.</p>
                            </div>
                            <button type="button" onclick="window.addProjectBackgroundPrompt()" class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-[10px] font-bold text-gray-700 dark:text-gray-200 hover:border-indigo-400">
                                <i data-lucide="plus" class="w-3.5 h-3.5"></i>신규 배경
                            </button>
                        </div>
                        <div class="grid grid-cols-[110px_minmax(0,1fr)] flex-1 min-h-0">
                            <div id="project-background-prompt-list" class="p-2 space-y-1 border-r border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/30" role="tablist" aria-label="배경 프롬프트 목록"></div>
                            <div class="min-w-0 p-3 flex flex-col">
                                <select id="project-background-prompt-select" onchange="window.selectProjectBackgroundPrompt(this.value)" class="hidden" aria-hidden="true"><option value="">배경을 불러오는 중입니다.</option></select>
                                <label class="block">
                                    <span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">배경 이름</span>
                                    <input id="project-background-prompt-name" class="w-full p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100" placeholder="배경 이름">
                                </label>
                                <label class="mt-2 block flex-1 min-h-[150px]">
                                    <span class="sr-only">배경 프롬프트</span>
                                    <textarea id="project-background-prompt-input" class="w-full min-h-[150px] resize-y p-3 text-xs leading-5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="플래너의 배경 항목으로 가져올 프롬프트"></textarea>
                                </label>
                                <div class="mt-2 flex flex-wrap items-center justify-end gap-2">
                                    <p id="project-background-prompt-status" class="mr-auto min-h-4 text-[10px] text-gray-400 dark:text-gray-500"></p>
                                    <button id="project-background-prompt-delete-btn" type="button" onclick="window.deleteProjectBackgroundPrompt()" class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-900/20 transition disabled:opacity-40">
                                        <i data-lucide="trash-2" class="w-4 h-4"></i><span>삭제</span>
                                    </button>
                                    <button id="project-background-prompt-save-btn" type="button" onclick="window.saveProjectBackgroundPrompt()" class="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition">
                                        <i data-lucide="save" class="w-4 h-4"></i><span>배경 저장</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </section>
        </div>
    `);
    initPromptSectionInput();
    initProjectPromptMarkdownToggle();
    hydrateProjectPromptInput();
    hydrateProjectStylePromptInput();
    hydrateProjectBackgroundPromptInputs();
}

export async function saveProjectPromptMarkdown() {
    const project = getActiveProject();
    const input = document.getElementById('project-prompt-input');
    const button = document.getElementById('project-prompt-save-btn');
    const status = document.getElementById('project-prompt-save-status');
    if (!project || !input) return;
    const field = getProjectPromptFieldConfig();
    getProjectPromptFieldValues()[field.key] = input.value;

    const previousButtonHtml = button?.innerHTML || '';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>저장 중</span>';
        refreshProjectIcons();
    }
    if (status) status.textContent = '';

    try {
        await uploadProjectMarkdownFile(project, field.fileName, input.value);
        if (status) status.textContent = `${field.fileName}로 저장되었습니다.`;
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

export function renderProjectBackgroundPromptInputs(data = {}) {
    const select = document.getElementById('project-background-prompt-select');
    const list = document.getElementById('project-background-prompt-list');
    const nameInput = document.getElementById('project-background-prompt-name');
    const promptInput = document.getElementById('project-background-prompt-input');
    const deleteButton = document.getElementById('project-background-prompt-delete-btn');
    if (!select || !nameInput || !promptInput) return;

    const normalized = normalizeProjectBackgroundPrompts(data);
    const activeBackground = normalized.backgrounds.find(background => background.id === normalized.activeBackgroundId)
        || normalized.backgrounds[0]
        || null;

    select.innerHTML = normalized.backgrounds.length
        ? normalized.backgrounds.map(background => `<option value="${escapeHtml(background.id)}" ${background.id === activeBackground?.id ? 'selected' : ''}>${escapeHtml(background.name)}</option>`).join('')
        : '<option value="">등록된 배경이 없습니다.</option>';
    if (list) {
        list.innerHTML = normalized.backgrounds.length
            ? normalized.backgrounds.map(background => {
                const active = background.id === activeBackground?.id;
                return `
                    <button type="button" role="tab" aria-selected="${active}" onclick="window.selectProjectBackgroundPrompt('${escapeJsString(background.id)}')" class="w-full px-2.5 py-2 rounded-md border text-left text-[11px] font-bold truncate transition ${active
                        ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                        : 'border-transparent text-gray-500 dark:text-gray-400 hover:border-gray-200 dark:hover:border-gray-700'}">
                        ${escapeHtml(background.name)}
                    </button>
                `;
            }).join('')
            : '<p class="px-2 py-3 text-[10px] leading-4 text-gray-400 dark:text-gray-500">등록된 배경이 없습니다.</p>';
    }
    select.disabled = !normalized.backgrounds.length;
    nameInput.value = activeBackground?.name || '';
    promptInput.value = activeBackground?.prompt || '';
    nameInput.disabled = !activeBackground;
    promptInput.disabled = !activeBackground;
    if (deleteButton) deleteButton.disabled = normalized.backgrounds.length <= 1;
    window.refreshNaiPromptWeightPreviews?.();
}

export async function hydrateProjectBackgroundPromptInputs() {
    const project = getActiveProject();
    const status = document.getElementById('project-background-prompt-status');
    if (!project) return;
    if (status) status.textContent = '배경 프롬프트를 불러오는 중입니다.';

    try {
        const data = await loadProjectBackgroundPrompts(project);
        renderProjectBackgroundPromptInputs(data);
        if (status) status.textContent = data.backgrounds.length ? '배경 프롬프트를 불러왔습니다.' : '';
    } catch (err) {
        if (status) status.textContent = err.message || '배경 프롬프트를 불러오지 못했습니다.';
    }
}

export function readProjectBackgroundPromptInputs() {
    const project = getActiveProject();
    const data = getProjectBackgroundPromptData(project);
    const selectedId = document.getElementById('project-background-prompt-select')?.value || data.activeBackgroundId;
    const name = document.getElementById('project-background-prompt-name')?.value.trim() || '';
    const prompt = document.getElementById('project-background-prompt-input')?.value.trim() || '';

    return normalizeProjectBackgroundPrompts({
        backgrounds: data.backgrounds.map(background => background.id === selectedId
            ? {
                ...background,
                name: name || background.name,
                prompt,
                updatedAt: Date.now()
            }
            : background
        ),
        activeBackgroundId: selectedId
    });
}

export async function selectProjectBackgroundPrompt(backgroundId) {
    const project = getActiveProject();
    if (!project) return;
    const currentData = readProjectBackgroundPromptInputs();
    const nextData = normalizeProjectBackgroundPrompts({
        backgrounds: currentData.backgrounds,
        activeBackgroundId: backgroundId
    });
    project.backgroundPrompts = nextData.backgrounds;
    project.activeBackgroundPromptId = nextData.activeBackgroundId;
    renderProjectBackgroundPromptInputs(nextData);
}

export async function addProjectBackgroundPrompt() {
    const project = getActiveProject();
    if (!project) return;
    const status = document.getElementById('project-background-prompt-status');
    const currentData = readProjectBackgroundPromptInputs();
    const newBackground = {
        id: createPromptVariantId('background'),
        name: `Background ${currentData.backgrounds.length + 1}`,
        prompt: '',
        updatedAt: Date.now()
    };
    const nextData = normalizeProjectBackgroundPrompts({
        backgrounds: [...currentData.backgrounds, newBackground],
        activeBackgroundId: newBackground.id
    });
    project.backgroundPrompts = nextData.backgrounds;
    project.activeBackgroundPromptId = nextData.activeBackgroundId;
    renderProjectBackgroundPromptInputs(nextData);
    if (status) status.textContent = '새 배경을 추가했습니다. 내용을 입력한 뒤 저장하세요.';
    refreshProjectIcons();
}

export async function saveProjectBackgroundPrompt() {
    const project = getActiveProject();
    const button = document.getElementById('project-background-prompt-save-btn');
    const status = document.getElementById('project-background-prompt-status');
    if (!project) return;

    const data = readProjectBackgroundPromptInputs();
    if (!data.backgrounds.length) {
        if (status) status.textContent = '저장할 배경이 없습니다.';
        return;
    }

    const activeBackground = data.backgrounds.find(background => background.id === data.activeBackgroundId);
    if (activeBackground && !activeBackground.name.trim()) {
        if (status) status.textContent = '배경 이름을 입력하세요.';
        return;
    }

    const previousButtonHtml = button?.innerHTML || '';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>저장 중</span>';
        refreshProjectIcons();
    }
    if (status) status.textContent = '';

    try {
        const savedData = await saveProjectBackgroundPrompts(project, data);
        renderProjectBackgroundPromptInputs(savedData);
        if (status) status.textContent = '배경 프롬프트를 저장했습니다.';
    } catch (err) {
        if (status) status.textContent = err.message || '배경 프롬프트 저장에 실패했습니다.';
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = previousButtonHtml;
            refreshProjectIcons();
        }
    }
}

export async function deleteProjectBackgroundPrompt() {
    const project = getActiveProject();
    const status = document.getElementById('project-background-prompt-status');
    if (!project) return;

    const currentData = readProjectBackgroundPromptInputs();
    if (currentData.backgrounds.length <= 1) {
        if (status) status.textContent = '배경은 최소 1개 이상 남겨야 합니다.';
        return;
    }

    const targetId = currentData.activeBackgroundId;
    const target = currentData.backgrounds.find(background => background.id === targetId);
    if (!target) return;
    if (!confirm(`'${target.name}' 배경을 삭제하시겠습니까?`)) return;

    const nextBackgrounds = currentData.backgrounds.filter(background => background.id !== targetId);
    const nextData = normalizeProjectBackgroundPrompts({
        backgrounds: nextBackgrounds,
        activeBackgroundId: nextBackgrounds[0]?.id || ''
    });

    try {
        const savedData = await saveProjectBackgroundPrompts(project, nextData);
        renderProjectBackgroundPromptInputs(savedData);
        if (status) status.textContent = '배경을 삭제했습니다.';
    } catch (err) {
        if (status) status.textContent = err.message || '배경 삭제에 실패했습니다.';
    }
}
