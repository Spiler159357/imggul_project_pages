import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Source contracts only: no DOM, browser, network, generation or database execution.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf8');
const planner = read('public/js/project/planner.js');
const workspace = read('public/js/project/planner-workspace.js');
const css = read('public/planner-workspace.css');
const app = read('public/app.html');

for (const name of ['renderPlannerResultList', 'renderPlannerImages', 'renderPlannerImagePreviewModal', 'PLANNER_IMAGE_PREVIEW_CONTEXT', 'readPlannerEditsFromDom', 'clearPlannerDraftDirty', 'savePlannerDraft', 'renderPlannerV4PromptSection']) {
    assert(!planner.includes(name), `Retired planner UI remains: ${name}`);
}
assert(!/<select\b|<details\b/.test(planner), 'Planner templates must route option controls through the shared renderer');
assert(!/<details\b/.test(workspace), 'Core prompts must not be collapsed');
assert(workspace.includes("const dropdownIds = ['planner-plan-character-variant', 'planner-plan-res', 'planner-plan-background-variant', 'planner-setting-model', 'planner-setting-sampler', 'planner-setting-precise-type']"), 'Only approved prompt options and settings model, sampler and reference type may use dropdowns');
assert(workspace.includes('input[id],select[id],textarea[id]'), 'Draft restoration must include dropdown values');
assert(css.includes('aspect-ratio:1 / 1'), 'Candidate thumbnails must remain square');
assert(workspace.includes('pw-review-stage') && workspace.includes('pw-thumbnail-check'), 'Candidate rail and selection marker must be present');
const cardRenderer = workspace.slice(workspace.indexOf('export function renderPlannerWorkspaceCard('), workspace.indexOf('export function renderPlannerOption('));
assert(!cardRenderer.includes('images[0]'), 'Unselected candidates must not become overview thumbnails');
assert(!cardRenderer.includes('getVersionedAssetUrl(src)'), 'Candidate key strings must not use the file-object URL API');
assert(!planner.includes("modeButton('result'"), 'Separate results tab must be retired');
assert(planner.includes("item?.images?.length"), 'Entry routing must inspect generated candidates');
assert(planner.includes('renderPlannerSituationPlanOverlay();\n    const savedStatus'), 'Save must keep the editor open');
assert(workspace.includes("['all', '전체'], ['missing', '미작성'], ['review', '검토']"));
const createdEntries = planner.slice(planner.indexOf('function getPlannerCreatedPlanEntries('), planner.indexOf('function renderPlannerCreatedPlanGrid('));
assert(createdEntries.includes('(meta?.items || []).flatMap(item =>'), 'All view must enumerate saved items rather than possible combinations');
assert(createdEntries.includes('situationById.get(item.situationId)') && createdEntries.includes('seen.has(item.situationId)'), 'Saved items must resolve valid situations without duplicate cards');
assert(createdEntries.includes('plannerMultiScopeState.metas.has(character.id)'), 'Empty shared runs must override stale queue metadata');
assert(createdEntries.includes('.sort((a, b) => a.index - b.index)'), 'All view must preserve situation order within character order');
assert(planner.includes("['character', 'situation', 'all'].includes(scope)"), 'Scope normalization must retain all view when saving and restoring');
assert(planner.includes("scopeButton('all', '생성된 플랜 전체')"));
assert(planner.includes('subtitle: getSituationDisplayName(situation)'), 'All cards must show the situation alongside the character');
assert(workspace.includes('`${title} ${subtitle}`.toLocaleLowerCase()'), 'Search must include both character and situation names');
assert(workspace.includes("scope === 'all' && ui.filter === 'missing'") && workspace.includes("scope !== 'all' || key !== 'missing'"), 'All view must clear and hide the missing filter');
assert(workspace.includes('[data-pw-board-empty]') && workspace.includes('[data-pw-plan]:not([hidden])'), 'Filtered all view must expose its empty state');
const batchConfirmation = planner.slice(planner.indexOf('async function confirmPlannerBatchAction('), planner.indexOf('export async function deletePlannerItem('));
assert(batchConfirmation.includes("if (scope === 'all') return null;"), 'All view must reject both batch operations before confirmation');
assert(planner.includes("planScope === 'all' ? '' : `<div class=\"flex flex-wrap gap-2\""), 'All view must hide batch operation buttons');
assert(planner.includes("getPlannerPlanScope(project) !== 'character'") && read('public/js/project/manage.js').includes("if (getPlannerPlanScope(project) !== 'character') await loadPlannerMultiScopeData({ force: true });"), 'Refresh, return and initial navigation must load all view');
assert(planner.includes('Math.min(4, characters.length)'), 'Multi-character reads must have bounded concurrency');
assert(planner.includes('if (needsDetails || meta?.items?.length)'), 'All view must avoid loading images for characters without plans');
assert(planner.includes('operationId !== plannerMultiScopeState.operationId || project.id !== getActiveProject()?.id'), 'Late shared loads must not replace a newer context');
assert(planner.includes('plannerMultiScopeState.metas.get(character.id) !== snapshots.get(character.id)'), 'A delayed board read must preserve saves, deletions and generation updates completed during loading');
assert(planner.includes('일부 정보 조회 실패') && planner.includes('if (!planFailed) updatePlannerQueueMetaCache'), 'Partial failures must be reported without clearing unknown queue runs');
assert(workspace.includes('loadCharacterFiles(character,'), 'Comparison images must come from the opened character folder');
for (const removed of ['loadProjects', 'library-project', 'data-pw-reference-file', 'createObjectURL', 'uploadUrl']) {
    assert(!workspace.includes(removed), `Removed comparison upload/project navigation remains: ${removed}`);
}
assert(workspace.includes("getProjectItems(project, 'characters')"), 'Comparison explorer must be limited to the active project');
for (const removed of ['browsePlannerTargetFolder', 'folderCharacterId', '이 캐릭터 선택', 'target-folder', 'target-root']) {
    assert(!(planner + workspace).includes(removed), `Target selection must not require folder navigation: ${removed}`);
}
const characterPicker = planner.slice(planner.indexOf('function renderPlannerCharacterPickerCards('), planner.indexOf('function renderPlannerSituationPickerCards('));
const situationPicker = planner.slice(planner.indexOf('function renderPlannerSituationPickerCards('), planner.indexOf('export function renderPlannerTargetPickerModal('));
assert(characterPicker.includes('window.applyPlannerTargetPickerSelection'), 'Character cards must select directly');
assert(situationPicker.includes('window.applyPlannerTargetPickerSelection'), 'Situation cards must select directly');
assert(workspace.includes('referenceBindings.get(item.situationId)'), 'Comparison preferences must be scoped to the plan situation');
assert(workspace.includes('window.getPlannerSituationImage({ ...character, files }, situation, referenceIndex)'), 'Automatic references must resolve the situation in the active character folder');
assert(workspace.includes('referenceContext === context'), 'A late reference request must not overwrite another plan');
assert(planner.includes("if (!item) { resetPlannerReviewReferenceContext(); return ''; }"), 'Closing review must cancel its reference context');
assert(workspace.includes("document.addEventListener('click'"));
assert(workspace.includes('}, true);'), 'Option actions must survive legacy modal stopPropagation handlers');
assert(css.includes('.pw-refresh{margin-left:auto'), 'Refresh must remain right aligned');
assert(css.includes('.pw-thumbnails') && css.includes('overflow:auto'), 'Candidates need a bounded scroll area');
assert(app.includes('/planner-workspace.css?v=planner-workspace-20261108a'));

// Catch misspelled module boundaries without evaluating browser modules.
for (const file of ['public/js/project/planner.js', 'public/js/project/planner-workspace.js']) {
    const source = read(file);
    for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
        const dependency = resolve(dirname(resolve(root, file)), match[2].split('?')[0]);
        assert(existsSync(dependency), `Missing dependency ${dependency}`);
        const exports = readFileSync(dependency, 'utf8');
        for (const specifier of match[1].split(',')) {
            const name = specifier.trim().split(/\s+as\s+/)[0];
            assert(new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let|class)\\s+${name}\\b`).test(exports), `Missing export ${name} imported by ${file}`);
        }
    }
}
for (const file of ['public/js/project.js', ...['character', 'craft_bridge', 'manage', 'planner', 'posts', 'situation', 'planner-workspace'].map(name => `public/js/project/${name}.js`)]) {
    const source = read(file);
    for (const match of source.matchAll(/(?:\.\/project\/|\.\/)(?:shared|manage|character|planner|situation|craft_bridge|posts|planner-workspace)\.js\?v=([^'"\s]+)/g)) {
        assert.equal(match[1], 'planner-workspace-20261108a', `Mixed project module version in ${file}`);
    }
}
for (const file of ['public/app.html', 'public/js/main.js', 'public/js/project.js', 'public/js/project/planner.js', 'public/js/project/planner-workspace.js', 'public/planner-workspace.css']) {
    const bytes = readFileSync(resolve(root, file));
    assert(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), `UTF-8 BOM in ${file}`);
}
console.log('Planner workspace source contracts, module exports, cache versions and BOM checks passed.');
