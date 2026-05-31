import { PROJECT_PROMPT_FIELDS, PROJECT_SECTIONS, clearProjectCaches, clearRootProjectCache, createProjectFolder, deleteProjectFolder, escapeHtml, escapeJsString, getActiveProject, getCharacterById, getDefaultProjectId, getItemLabel, getProjectBasePrefix, getProjectById, getProjectItems, getProjectPromptFieldConfig, getProjectPromptFieldValues, getProjects, getSelectedPlannerCharacterId, hydrateProjectPromptInput, hydrateProjectStylePromptInput, initProjectPromptMarkdownToggle, initPromptSectionInput, isInvalidProjectFolderName, loadCharacterFiles, loadCharacterMeta, loadProjectCharacters, loadProjectSituations, loadProjectStylePrompt, loadProjects, normalizeProjectFolderName, refreshProjectIcons, rememberProjectRoute, renameProjectFolder, renderEmptyState, renderProjectShell, replaceProjectRoute, saveProjectAlias, setProjectRoute, switchProjectPromptField, uploadProjectMarkdownFile, uploadProjectStylePrompt } from './shared.js';
import { renderCharacterSection } from './character.js';
import { loadPlannerMeta, loadPlannerSettings, normalizePlannerSettings, renderPlannerSection } from './planner.js';
import { renderSituationSection } from './situation.js';

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

export function renderProjectManageShell(projects, state = {}) {
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
                                ${project.alias ? `<span class="block text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">경로: ${escapeHtml(project.folderName)}</span>` : ''}
                            </span>
                            <i data-lucide="chevron-right" class="w-5 h-5 text-gray-400 flex-shrink-0"></i>
                        </button>
                    `).join('') : ''}
                    ${!state.loading && !state.error && !projects.length ? renderEmptyState('프로젝트가 없습니다.') : ''}
                </div>
                ${renderR2JsonMigrationPanel()}
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

export function renderR2JsonMigrationPanel() {
    return `
        <div class="mt-5 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-4">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <h3 class="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <i data-lucide="database" class="w-4 h-4 text-indigo-600 dark:text-indigo-400"></i>
                        R2 JSON DB Migration
                    </h3>
                    <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">R2에 남아 있는 JSON 메타데이터를 D1 DB로 일괄 upsert합니다.</p>
                </div>
                <div class="flex flex-shrink-0 gap-2">
                    <button id="r2-json-migration-dryrun-btn" type="button" onclick="window.runR2JsonMigration(true)" class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200 hover:border-indigo-300 dark:hover:border-indigo-600 transition">
                        Dry run
                    </button>
                    <button id="r2-json-migration-run-btn" type="button" onclick="window.runR2JsonMigration(false)" class="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 transition">
                        Run
                    </button>
                </div>
            </div>
            <div class="mt-3 flex items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-700 pt-3">
                <button id="r2-json-cleanup-dryrun-btn" type="button" onclick="window.runR2JsonCleanup(true)" class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200 hover:border-red-300 dark:hover:border-red-700 transition">
                    Cleanup dry run
                </button>
                <button id="r2-json-cleanup-run-btn" type="button" onclick="window.runR2JsonCleanup(false)" class="px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition">
                    Delete migrated JSON
                </button>
            </div>
            <pre id="r2-json-migration-result" class="mt-3 hidden max-h-48 overflow-auto rounded-md bg-gray-50 dark:bg-gray-900/60 border border-gray-100 dark:border-gray-700 p-3 text-[11px] leading-5 text-gray-700 dark:text-gray-200 whitespace-pre-wrap"></pre>
        </div>
    `;
}

export async function runR2JsonMigration(dryRun = true) {
    const dryRunBtn = document.getElementById('r2-json-migration-dryrun-btn');
    const runBtn = document.getElementById('r2-json-migration-run-btn');
    const resultBox = document.getElementById('r2-json-migration-result');
    if (!resultBox) return;

    if (!dryRun && !confirm('R2 JSON 메타데이터를 DB로 일괄 이관할까요? 기존 DB 행은 같은 key 기준으로 갱신됩니다.')) return;

    const activeBtn = dryRun ? dryRunBtn : runBtn;
    const previousDryRunText = dryRunBtn?.textContent || '';
    const previousRunText = runBtn?.textContent || '';
    if (dryRunBtn) dryRunBtn.disabled = true;
    if (runBtn) runBtn.disabled = true;
    if (activeBtn) activeBtn.textContent = dryRun ? 'Checking...' : 'Running...';
    resultBox.classList.remove('hidden');
    resultBox.textContent = dryRun ? 'Scanning R2 JSON objects...' : 'Migrating R2 JSON objects to DB...';

    try {
        const res = await fetch('/api/db/migrate-r2-json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ dryRun }),
            cache: 'no-store'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Migration failed (${res.status})`);

        const summary = data.summary || {};
        resultBox.textContent = [
            dryRun ? '[DRY RUN]' : '[DONE]',
            `scanned: ${summary.scanned || 0}`,
            `jsonDocuments: ${summary.jsonDocuments || 0}`,
            `fileMetadata: ${summary.fileMetadata || 0}`,
            `aliases: ${summary.aliases || 0}`,
            `skipped: ${summary.skipped || 0}`,
            `errors: ${(summary.errors || []).length}`,
            ...(summary.errors || []).slice(0, 20).map(item => `- ${item.key}: ${item.error}`)
        ].join('\n');
    } catch (err) {
        resultBox.textContent = `[ERROR]\n${err.message || String(err)}`;
    } finally {
        if (dryRunBtn) {
            dryRunBtn.disabled = false;
            dryRunBtn.textContent = previousDryRunText;
        }
        if (runBtn) {
            runBtn.disabled = false;
            runBtn.textContent = previousRunText;
        }
        refreshProjectIcons();
    }
}

export async function runR2JsonCleanup(dryRun = true) {
    const dryRunBtn = document.getElementById('r2-json-cleanup-dryrun-btn');
    const runBtn = document.getElementById('r2-json-cleanup-run-btn');
    const resultBox = document.getElementById('r2-json-migration-result');
    if (!resultBox) return;

    if (!dryRun && !confirm('DB로 이관된 R2 JSON 파일을 삭제할까요? .memos.json은 제외됩니다.')) return;

    const activeBtn = dryRun ? dryRunBtn : runBtn;
    const previousDryRunText = dryRunBtn?.textContent || '';
    const previousRunText = runBtn?.textContent || '';
    if (dryRunBtn) dryRunBtn.disabled = true;
    if (runBtn) runBtn.disabled = true;
    if (activeBtn) activeBtn.textContent = dryRun ? 'Checking...' : 'Deleting...';
    resultBox.classList.remove('hidden');
    resultBox.textContent = dryRun ? 'Scanning migrated R2 JSON objects...' : 'Deleting migrated R2 JSON objects...';

    try {
        const res = await fetch('/api/db/delete-migrated-r2-json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ dryRun }),
            cache: 'no-store'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Cleanup failed (${res.status})`);

        const summary = data.summary || {};
        resultBox.textContent = [
            dryRun ? '[CLEANUP DRY RUN]' : '[CLEANUP DONE]',
            `scanned: ${summary.scanned || 0}`,
            `matched: ${summary.matched || 0}`,
            `deleted: ${summary.deleted || 0}`,
            `skipped: ${summary.skipped || 0}`,
            `errors: ${(summary.errors || []).length}`,
            '',
            'sample keys:',
            ...(summary.keys || []).map(key => `- ${key}`),
            ...(summary.errors || []).slice(0, 20).map(item => `- ERROR ${item.batchStart ?? ''}: ${item.error}`)
        ].join('\n');
    } catch (err) {
        resultBox.textContent = `[ERROR]\n${err.message || String(err)}`;
    } finally {
        if (dryRunBtn) {
            dryRunBtn.disabled = false;
            dryRunBtn.textContent = previousDryRunText;
        }
        if (runBtn) {
            runBtn.disabled = false;
            runBtn.textContent = previousRunText;
        }
        refreshProjectIcons();
    }
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
        loadProjectSituations(project).catch(() => []),
        loadPlannerMeta(project).then(meta => { window.PROJECT_PLANNER_META = meta; }).catch(() => { window.PROJECT_PLANNER_META = null; })
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
                <div id="project-action-menu" class="hidden absolute right-0 top-10 z-20 w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl overflow-hidden py-1">
                    <button type="button" onclick="window.renameActiveProject()" class="w-full px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">프로젝트 이름 변경</button>
                    <button type="button" onclick="window.changeActiveProjectPath()" class="w-full px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">프로젝트 경로 변경</button>
                    <button type="button" onclick="window.deleteActiveProject()" class="w-full px-3 py-2 text-left text-xs font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition">프로젝트 삭제</button>
                </div>
            </div>
        </div>

        <div class="flex-1 overflow-y-auto lg:overflow-hidden p-4 sm:p-6 lg:flex lg:items-center">
            <section class="mx-auto grid w-full grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:aspect-video lg:min-h-0" style="max-width: min(100%, calc((100dvh - 10rem) * 16 / 9));">
                ${renderProjectDashboardCard(project, PROJECT_SECTIONS.find(section => section.key === 'prompt'), 'min-h-[220px] lg:min-h-0')}
                <div class="grid grid-rows-2 gap-4 sm:gap-6 min-h-[440px] lg:min-h-0">
                    ${renderProjectDashboardCard(project, PROJECT_SECTIONS.find(section => section.key === 'character'), 'min-h-0')}
                    ${renderProjectDashboardCard(project, PROJECT_SECTIONS.find(section => section.key === 'situation'), 'min-h-0')}
                </div>
                ${renderProjectDashboardCard(project, PROJECT_SECTIONS.find(section => section.key === 'planner'), 'min-h-[220px] lg:min-h-0')}
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

export function closeProjectActionMenu() {
    document.getElementById('project-action-menu')?.classList.add('hidden');
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
        <button type="button" onclick="window.openProjectSection('${escapeJsString(section.key)}')" class="${sizeClass} text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition flex flex-col">
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
    else if (section.key === 'situation') {
        const project = getActiveProject();
        renderSituationSection(section, { loading: !!project && !project.situationsLoaded });
        await loadProjectSituations(project).catch(err => {
            if (window.PROJECT_ACTIVE_SECTION === 'situation') renderSituationSection(section, { error: err.message });
        });
        if (window.PROJECT_ACTIVE_SECTION === 'situation') renderSituationSection(section);
    }
    else {
        const project = getActiveProject();
        renderPlannerSection(section, { loading: !!project && (!project.situationsLoaded || !project.charactersLoaded) });
        await Promise.all([
            loadProjectSituations(project),
            loadProjectCharacters(project),
            loadPlannerSettings(project).catch(() => normalizePlannerSettings())
        ]).catch(err => {
            if (window.PROJECT_ACTIVE_SECTION === 'planner') renderPlannerSection(section, { error: err.message });
        });
        const characterId = getSelectedPlannerCharacterId(project);
        window.PROJECT_PLANNER_SELECTED_CHARACTER_ID = characterId;
        const character = getCharacterById(project, characterId);
        await Promise.all([
            loadPlannerMeta(project, characterId).then(meta => { window.PROJECT_PLANNER_META = meta; }).catch(() => { window.PROJECT_PLANNER_META = null; }),
            loadProjectStylePrompt(project).then(style => { window.PROJECT_PLANNER_PROJECT_STYLE = style || ''; }).catch(() => { window.PROJECT_PLANNER_PROJECT_STYLE = ''; }),
            character ? loadCharacterFiles(character).catch(() => []) : Promise.resolve([]),
            character ? loadCharacterMeta(character).catch(() => ({})) : Promise.resolve({})
        ]);
        if (window.PROJECT_ACTIVE_SECTION === 'planner') renderPlannerSection(section);
    }

    const routeState = { projectView: 'section', projectId: window.PROJECT_ACTIVE_PROJECT_ID, projectSection: section.key };
    const routeHash = `#project/${window.PROJECT_ACTIVE_PROJECT_ID}/${section.key}`;
    if (!skipHistory) setProjectRoute(routeState, routeHash);
    else rememberProjectRoute(routeState, routeHash);
}

export function renderSectionHeader(title) {
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

export function renderPromptSection(section) {
    renderProjectShell(`
        ${renderSectionHeader(section.title)}
        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
            <section class="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(260px,2fr)] gap-4 sm:gap-6 min-h-full">
                <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-col min-h-[360px]">
                    <div class="flex items-start justify-between gap-3 mb-3">
                        <div>
                            <h3 id="project-prompt-field-title" class="font-bold text-sm text-gray-900 dark:text-white">시스템 프롬프트</h3>
                            <p id="project-prompt-field-file" class="mt-0.5 text-[11px] font-mono text-gray-400 dark:text-gray-500">prompt.md</p>
                            <p id="project-prompt-load-status" class="mt-1 min-h-4 text-[11px] text-gray-400 dark:text-gray-500"></p>
                        </div>
                        <button id="project-prompt-preview-toggle" type="button" class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 transition" aria-pressed="false">
                            <i data-lucide="eye" class="w-4 h-4"></i>
                            <span>마크다운 보기</span>
                        </button>
                    </div>
                    <div class="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="프로젝트 프롬프트 입력 종류">
                        ${PROJECT_PROMPT_FIELDS.map(field => `
                            <button type="button" role="tab" data-project-prompt-field="${escapeHtml(field.key)}" onclick="window.switchProjectPromptField('${escapeJsString(field.key)}')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300 hover:border-indigo-300 dark:hover:border-indigo-600 transition" aria-selected="false">
                                <i data-lucide="${field.icon}" class="w-4 h-4"></i>
                                <span>${escapeHtml(field.title)}</span>
                            </button>
                        `).join('')}
                    </div>
                    <textarea id="project-prompt-input" class="flex-1 resize-none outline-none bg-transparent text-sm leading-6 text-gray-700 dark:text-gray-200" aria-label="시스템 프롬프트 입력"></textarea>
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
                                <span id="project-prompt-save-label">시스템 프롬프트 저장</span>
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
