import { DEFAULT_PLANNER_RESOLUTION, PROJECT_SECTIONS, clearProjectCaches, createProjectChildFolder, createPromptVariantId, deleteProjectFolder, escapeHtml, escapeJsString, getActiveCharacterPromptVariant, getActiveProject, getAssetUrl, getCharacterById, getFileBaseName, getFileNameFromKey, getItemLabel, getNextSituationFolderName, getNextSituationImageNumber, getProjectById, getProjectItems, getSituationDisplayName, getSituationFolderNumber, getSituationGeneration, getSituationImageKey, getSituationImageNumber, isInvalidProjectFolderName, loadCharacterFiles, loadCharacterMeta, loadProjectCharacters, loadProjectSituations, loadProjectStylePrompt, loadProjects, normalizeCharacterPromptParts, normalizeCharacterPromptVariants, normalizeProjectFolderName, refreshProjectIcons, rememberProjectRoute, renameProjectFolder, renderCharacterName, renderEmptyState, renderProjectShell, replaceProjectRoute, saveCharacterMeta, saveProjectAlias, saveProjectSituations, setProjectRoute } from './shared.js';
import { openProjectSection, renderProjectManage, renderSectionHeader } from './manage.js';
import { combinePromptParts, getSituationPrompt, renderSituationSection } from './situation.js';

export function getSituationImageCandidates(situation, index) {
    const imageNumber = Number(situation?.imageNumber);
    const values = [String(Number.isFinite(imageNumber) ? imageNumber : index)];

    return values
        .filter(Boolean)
        .map(value => String(value).trim().toLowerCase())
        .filter(Boolean);
}

export function findSituationImage(files, situation, index) {
    const candidates = new Set(getSituationImageCandidates(situation, index));
    return files.find(file => candidates.has(getFileBaseName(getFileNameFromKey(file.key)))) || null;
}

export function getSituationRows(character, situations, files) {
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

export function getCharacterProgress(rows) {
    const total = rows.length;
    const complete = rows.filter(row => row.image).length;
    const missing = Math.max(total - complete, 0);
    const percent = total ? Math.round((complete / total) * 100) : 0;
    return { total, complete, missing, percent };
}

export function renderCharacterStatusBadge(isComplete) {
    return isComplete
        ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">완료</span>'
        : '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">미생성</span>';
}

export function renderCharacterImageRows(project, character, rows) {
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
                    <div role="button" tabindex="0" onclick="${clickAction}" onkeydown="if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); ${clickAction}; }" class="w-full cursor-pointer text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 hover:border-indigo-300 dark:hover:border-indigo-600 hover:shadow-sm transition grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 items-center">
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
                            <button type="button" onclick="event.stopPropagation(); window.openCharacterImageUploadPicker('${escapeJsString(project.id)}', '${escapeJsString(character.id)}', ${row.index})" class="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-[11px] font-bold text-gray-600 dark:text-gray-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition">
                                <i data-lucide="upload" class="w-3.5 h-3.5"></i>
                                <span>업로드</span>
                            </button>
                        </span>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

export function renderCharacterDetailShell(project, character, state = {}) {
    const situations = getProjectItems(project, 'situations');
    const files = Array.isArray(character.files) ? character.files : [];
    const meta = character.meta || {};
    const rows = getSituationRows(character, situations, files);
    const progress = getCharacterProgress(rows);
    const coverImage = rows.find(row => row.image)?.imageUrl || getAssetUrl(character.coverImage);
    const promptVariants = normalizeCharacterPromptVariants(meta);
    const activePromptVariant = getActiveCharacterPromptVariant(meta);
    const promptParts = activePromptVariant.parts || {};
    const characterPrompt = promptParts.character || activePromptVariant.prompt || '';
    const clothingPrompt = promptParts.clothing || '';
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
                        <button type="button" onclick="window.changeActiveCharacterPath()" class="w-full px-3 py-2 text-left text-xs font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition">캐릭터 경로 변경</button>
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
                                    ${character.alias ? `<p class="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">경로: ${escapeHtml(character.folderName)}</p>` : ''}
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
                                <div class="flex flex-wrap items-center justify-end gap-2">
                                    <button type="button" onclick="window.addCharacterPromptVariant()" class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-xs font-bold hover:border-indigo-300 dark:hover:border-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 transition">
                                        <i data-lucide="plus" class="w-4 h-4"></i>
                                        신규 의상 추가
                                    </button>
                                    <button id="character-prompt-save-btn" type="submit" class="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-600 transition">
                                    <i data-lucide="save" class="w-4 h-4"></i>
                                    저장
                                    </button>
                                </div>
                            </div>
                            <div class="mb-3">
                                <label for="character-prompt-variant-select" class="block mb-1 text-xs font-bold text-gray-700 dark:text-gray-300">의상 / 헤어스타일</label>
                                <select id="character-prompt-variant-select" onchange="window.selectCharacterPromptVariant(this.value)" class="w-full p-2.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                                    ${promptVariants.map(variant => `<option value="${escapeHtml(variant.id)}" ${variant.id === activePromptVariant.id ? 'selected' : ''}>${escapeHtml(variant.name)}</option>`).join('')}
                                </select>
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
                                    <span class="block mb-1 text-xs font-bold text-gray-700 dark:text-gray-300">부정 프롬프트</span>
                                    <textarea id="character-prompt-negative-input" class="w-full min-h-[80px] resize-y p-3 rounded-lg border border-red-300 dark:border-red-800 bg-gray-50 dark:bg-gray-900/50 text-sm leading-6 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="이 캐릭터에 반복 적용할 제외 태그">${escapeHtml(negativePrompt)}</textarea>
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

export function openCharacterImageUploadPicker(projectId = window.PROJECT_ACTIVE_PROJECT_ID, characterId = window.PROJECT_ACTIVE_CHARACTER_ID, situationIndex = 0) {
    let input = document.getElementById('character-image-upload-input');
    if (!input) {
        input = document.createElement('input');
        input.id = 'character-image-upload-input';
        input.type = 'file';
        input.accept = 'image/*';
        input.className = 'hidden';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            const payload = input.dataset.payload ? JSON.parse(input.dataset.payload) : {};
            input.value = '';
            input.dataset.payload = '';
            if (file) window.uploadCharacterSituationImage(file, payload.projectId, payload.characterId, Number(payload.situationIndex));
        });
        document.body.appendChild(input);
    }

    input.dataset.payload = JSON.stringify({ projectId, characterId, situationIndex });
    input.click();
}

export async function uploadCharacterSituationImage(file, projectId = window.PROJECT_ACTIVE_PROJECT_ID, characterId = window.PROJECT_ACTIVE_CHARACTER_ID, situationIndex = 0) {
    if (!file || !file.type?.startsWith('image/')) return alert('이미지 파일을 선택해주세요.');

    const project = getProjectById(projectId);
    const character = getCharacterById(project, characterId);
    const situation = getProjectItems(project, 'situations')[situationIndex];
    if (!project || !character || !situation) return alert('업로드할 캐릭터 또는 상황을 찾지 못했습니다.');

    const imageNumber = getSituationImageNumber(project, situation);
    const fileName = `${imageNumber}.webp`;
    const finalPath = `${character.prefix}${fileName}`;

    try {
        let uploadFile = file;
        let metadata = null;
        if (window.extractMetadata) metadata = await window.extractMetadata(file).catch(() => null);
        if (file.type !== 'image/webp') {
            if (!window.convertToWebP) throw new Error('WebP 변환 함수를 찾을 수 없습니다.');
            uploadFile = await window.convertToWebP(file);
        }

        const buffer = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
            reader.readAsArrayBuffer(uploadFile);
        });
        const res = await fetch('/api/upload?_t=' + Date.now(), {
            method: 'PUT',
            headers: {
                'X-File-Name': encodeURIComponent(fileName),
                'Content-Type': 'image/webp',
                'X-Absolute-Path': encodeURIComponent(finalPath)
            },
            body: buffer,
            cache: 'no-store'
        });
        if (!res.ok) throw new Error(`서버 응답 오류 (${res.status})`);
        if (metadata && window.saveMetadataToDB) await window.saveMetadataToDB(character.prefix, fileName, metadata);

        clearProjectCaches(character.prefix);
        character.filesLoaded = false;
        await loadCharacterFiles(character, true).catch(() => []);
        alert(`${fileName}로 업로드했습니다.`);
        await openCharacterDetail(project.id, character.id, true);
    } catch (err) {
        alert('업로드 실패: ' + (err.message || err));
    }
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
    const variantSelect = document.getElementById('character-prompt-variant-select');
    const characterInput = document.getElementById('character-prompt-character-input');
    const clothingInput = document.getElementById('character-prompt-clothing-input');
    const negativeInput = document.getElementById('character-prompt-negative-input');
    const button = document.getElementById('character-prompt-save-btn');
    const status = document.getElementById('character-prompt-save-status');
    if (!project || !character || !characterInput || !clothingInput || !negativeInput) return;

    const previousButtonHtml = button?.innerHTML || '';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> 저장 중';
        refreshProjectIcons();
    }
    if (status) status.textContent = '';

    try {
        const meta = await loadCharacterMeta(character).catch(() => ({}));
        const variants = normalizeCharacterPromptVariants(meta);
        const activeVariantId = variantSelect?.value || meta.activePromptVariantId || variants[0]?.id || 'default';
        const remainingParts = { ...(meta.parts || {}) };
        delete remainingParts.expression;
        const parts = {
            ...remainingParts,
            character: characterInput.value.trim(),
            clothing: clothingInput.value.trim(),
            negative: negativeInput.value.trim()
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

export async function selectCharacterPromptVariant(variantId) {
    const project = getActiveProject();
    const character = getCharacterById(project, window.PROJECT_ACTIVE_CHARACTER_ID);
    if (!project || !character || !variantId) return;

    const meta = await loadCharacterMeta(character).catch(() => character.meta || {});
    const variants = normalizeCharacterPromptVariants(meta);
    const activeVariant = variants.find(variant => variant.id === variantId) || variants[0];
    const parts = activeVariant.parts || {};
    character.meta = {
        ...meta,
        prompt: parts.character || '',
        parts,
        promptVariants: variants,
        activePromptVariantId: activeVariant.id
    };
    renderCharacterDetailShell(project, character);
}

export async function addCharacterPromptVariant() {
    const project = getActiveProject();
    const character = getCharacterById(project, window.PROJECT_ACTIVE_CHARACTER_ID);
    if (!project || !character) return;

    const name = prompt('새 의상/헤어스타일 이름을 입력하세요.', 'New Outfit');
    if (name === null) return;
    const meta = await loadCharacterMeta(character).catch(() => character.meta || {});
    const variants = normalizeCharacterPromptVariants(meta);
    const newVariant = {
        id: createPromptVariantId('outfit'),
        name: name.trim() || 'New Outfit',
        prompt: '',
        parts: normalizeCharacterPromptParts({}),
        updatedAt: Date.now()
    };
    const nextMeta = {
        ...meta,
        prompt: '',
        parts: newVariant.parts,
        promptVariants: [...variants, newVariant],
        activePromptVariantId: newVariant.id,
        updatedAt: Date.now()
    };

    await saveCharacterMeta(character, nextMeta);
    renderCharacterDetailShell(project, character);
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
        'prompt-expression': situationPrompt.expression || '',
        'prompt-action': situationPrompt.action || '',
        'prompt-background': situationPrompt.background || ''
    };
    window.switchTab('craft');
    applyCraftPromptValues(promptValues, combinedNegativePrompt);
    if (window.setCraftV4PromptRows) window.setCraftV4PromptRows(getSituationGeneration(selectedSituation).v4PromptCharacters || []);

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

export function applyCraftPromptValues(promptValues = {}, negativePromptValue = '', options = {}) {
    const clearMissing = options.clearMissing !== false;
    const applyNegative = options.applyNegative !== false;
    const resizePromptInput = (id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
    };

    const simpleToggle = document.getElementById('prompt-toggle-simple');
    if (simpleToggle) {
        simpleToggle.checked = false;
        if (window.togglePromptMode) window.togglePromptMode();
    }

    const rawPrompt = document.getElementById('prompt-raw');
    if (rawPrompt && (clearMissing || Object.prototype.hasOwnProperty.call(promptValues, 'prompt-raw'))) {
        rawPrompt.value = promptValues['prompt-raw'] || '';
        resizePromptInput('prompt-raw');
    }

    window.PROMPT_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (!clearMissing && !Object.prototype.hasOwnProperty.call(promptValues, id)) return;
        el.value = promptValues[id] || '';
        resizePromptInput(id);
    });

    const negativePrompt = document.getElementById('nai-negative');
    if (negativePrompt && applyNegative) {
        negativePrompt.value = negativePromptValue || '';
        resizePromptInput('nai-negative');
    }

    if (window.refreshNaiPromptWeightPreviews) window.refreshNaiPromptWeightPreviews();
    if (window.saveCraftSettings) window.saveCraftSettings();
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

export function closeCharacterActionMenu() {
    document.getElementById('character-action-menu')?.classList.add('hidden');
}

export async function renameActiveCharacter() {
    closeCharacterActionMenu();

    const project = getActiveProject();
    const character = getCharacterById(project, window.PROJECT_ACTIVE_CHARACTER_ID);
    if (!project || !character) return;

    const nextAlias = prompt('캐릭터 이름을 입력하세요. 비워두면 경로를 표시합니다.', character.alias || '');
    if (nextAlias === null) return;

    const alias = nextAlias.trim();
    const aliasChanged = alias !== (character.alias || '');

    if (!aliasChanged) return;

    try {
        await saveProjectAlias(character.prefix, alias);
        clearProjectCaches(project.prefix, character.prefix);
        project.charactersLoaded = false;
        await loadProjectCharacters(project, true);
        await openCharacterDetail(project.id, character.prefix, true);

        if (window.currentPrefix === project.prefix && window.loadPath) window.loadPath(project.prefix, true);
    } catch (err) {
        alert(err.message || '캐릭터 이름 변경에 실패했습니다.');
    }
}

export async function changeActiveCharacterPath() {
    closeCharacterActionMenu();

    const project = getActiveProject();
    const character = getCharacterById(project, window.PROJECT_ACTIVE_CHARACTER_ID);
    if (!project || !character) return;

    const nextFolderName = prompt('캐릭터 경로를 입력하세요.', character.folderName);
    if (nextFolderName === null) return;

    const folderName = normalizeProjectFolderName(nextFolderName);
    if (isInvalidProjectFolderName(folderName)) {
        alert('경로에는 /, \\, 숨김 폴더명, 예약 폴더명을 사용할 수 없습니다.');
        return;
    }

    const folderChanged = folderName !== character.folderName;

    if (!folderChanged) return;

    if (folderChanged && getProjectItems(project, 'characters').some(item => item.folderName === folderName)) {
        alert('이미 존재하는 캐릭터 경로입니다.');
        return;
    }

    const oldPrefix = character.prefix;
    const newPrefix = `${project.prefix}${folderName}/`;

    try {
        if (folderChanged) {
            await renameProjectFolder(oldPrefix, newPrefix);
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
        alert(err.message || '캐릭터 경로 변경에 실패했습니다.');
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

export function renderProjectItemCreateModal() {
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
                        <label for="project-item-create-name" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">경로</label>
                        <input id="project-item-create-name" type="text" required class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-gray-700 dark:text-white" placeholder="저장 경로">
                        <p id="project-item-create-help" class="mt-1 text-[11px] text-gray-400 dark:text-gray-500"></p>
                    </div>

                    <div>
                        <label for="project-item-create-alias" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">이름</label>
                        <input id="project-item-create-alias" type="text" class="w-full p-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-gray-700 dark:text-white" placeholder="이름">
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

export async function openProjectItemCreateModal(type) {
    const project = getActiveProject();
    const modal = document.getElementById('project-item-create-modal');
    const form = document.getElementById('project-item-create-form');
    const typeInput = document.getElementById('project-item-create-type');
    const nameInput = document.getElementById('project-item-create-name');
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
            ? '프로젝트 하위 캐릭터 폴더 경로로 사용됩니다.'
            : '프로젝트 상황 경로로 사용됩니다.';
    }

    if (type === 'situation' && project) {
        if (!project.situationsLoaded) await loadProjectSituations(project).catch(() => []);
        if (nameInput) nameInput.value = getNextSituationFolderName(project);
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        const input = document.getElementById('project-item-create-name');
        input?.focus();
        if (type === 'situation') input?.select();
    }, 0);
}

export function closeProjectItemCreateModal(event) {
    if (event && event.target !== event.currentTarget) return;
    const modal = document.getElementById('project-item-create-modal');
    if (!modal) return;

    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

export function setProjectItemCreateError(message) {
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
        setProjectItemCreateError('경로에는 /, \\, 숨김 폴더명, 예약 폴더명을 사용할 수 없습니다.');
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

export async function createCharacter(project, folderName, alias) {
    if (!project.charactersLoaded) await loadProjectCharacters(project);
    if (getProjectItems(project, 'characters').some(character => character.folderName === folderName)) {
        throw new Error('이미 존재하는 캐릭터 경로입니다.');
    }

    await createProjectChildFolder(project, folderName);
    if (alias) await saveProjectAlias(`${project.prefix}${folderName}/`, alias);
    if (window.FOLDER_DATA_CACHE) delete window.FOLDER_DATA_CACHE[project.prefix];
    await loadProjectCharacters(project, true);
    if (window.loadPath && window.currentPrefix === project.prefix) window.loadPath(project.prefix, true);
}

export async function createSituation(project, situationId, alias) {
    if (!project.situationsLoaded) await loadProjectSituations(project);
    if (getProjectItems(project, 'situations').some(situation => situation.id === situationId)) {
        throw new Error('이미 존재하는 상황 경로입니다.');
    }

    const folderNumber = getSituationFolderNumber(situationId);
    const imageNumber = Number.isFinite(folderNumber) ? folderNumber : getNextSituationImageNumber(project);
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
        generation: {
            res: DEFAULT_PLANNER_RESOLUTION,
            v4PromptCharacters: [],
            v4_prompt: []
        },
        resolution: DEFAULT_PLANNER_RESOLUTION,
        v4PromptCharacters: [],
        v4_prompt: [],
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

export function renderCharacterSection(section, state = {}) {
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
