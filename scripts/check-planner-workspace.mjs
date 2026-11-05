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

for (const name of ['renderPlannerResultList', 'renderPlannerImages', 'renderPlannerImagePreviewModal', 'PLANNER_IMAGE_PREVIEW_CONTEXT', 'readPlannerEditsFromDom', 'savePlannerDraft', 'renderPlannerV4PromptSection']) {
    assert(!planner.includes(name), `Retired planner UI remains: ${name}`);
}
assert(!/<select\b|<details\b/.test(planner + workspace), 'Planner controls must not use dropdowns or collapsed prompts');
assert(!planner.includes("modeButton('result'"), 'Separate results tab must be retired');
assert(planner.includes("item?.images?.length"), 'Entry routing must inspect generated candidates');
assert(planner.includes('renderPlannerSituationPlanOverlay();\n    const savedStatus'), 'Save must keep the editor open');
assert(workspace.includes("['all', '전체'], ['missing', '미작성'], ['review', '검토']"));
assert(workspace.includes('loadCharacterFiles(character)'), 'Comparison images must come from real project files');
assert(workspace.includes('URL.revokeObjectURL'), 'Uploaded comparison URLs need lifecycle cleanup');
assert(workspace.includes("document.addEventListener('click'"));
assert(workspace.includes('}, true);'), 'Option actions must survive legacy modal stopPropagation handlers');
assert(css.includes('.pw-refresh{margin-left:auto'), 'Refresh must remain right aligned');
assert(css.includes('.pw-thumbnails') && css.includes('overflow:auto'), 'Candidates need a bounded scroll area');
assert(app.includes('/planner-workspace.css?v=planner-workspace-20261106a'));

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
        assert.equal(match[1], 'planner-workspace-20261106a', `Mixed project module version in ${file}`);
    }
}
for (const file of ['public/app.html', 'public/js/main.js', 'public/js/project.js', 'public/js/project/planner.js', 'public/js/project/planner-workspace.js', 'public/planner-workspace.css']) {
    const bytes = readFileSync(resolve(root, file));
    assert(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), `UTF-8 BOM in ${file}`);
}
console.log('Planner workspace source contracts, module exports, cache versions and BOM checks passed.');
