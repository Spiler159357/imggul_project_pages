import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    buildNovelAiBaseParameters,
    getNovelAiModelProfile,
    normalizeNovelAiModelId
} from '../public/js/nai-models.js';
import {
    calculateNovelAiRepeatedRequestCost,
    calculateNovelAiRequestCost
} from '../public/js/nai-pricing.js';

const activeOpus = {
    available: true,
    active: true,
    tier: 3,
    usage: { percent: 80, isNegative: false, timeUntilNextPercent: 600 }
};
const exhaustedOpus = {
    ...activeOpus,
    usage: { ...activeOpus.usage, percent: 0, isNegative: true }
};

assert.equal(normalizeNovelAiModelId('nai-diffusion-4-5-curated'), 'nai-diffusion-4-5-full');
assert.equal(normalizeNovelAiModelId('nai-diffusion-4-curated-preview'), 'nai-diffusion-4-full');
assert.equal(normalizeNovelAiModelId('unknown-model'), 'nai-diffusion-4-5-full');

const v45 = buildNovelAiBaseParameters({
    model: 'nai-diffusion-4-5-full',
    width: 832,
    height: 1216,
    steps: 28,
    sampler: 'k_euler_ancestral',
    scale: 5,
    seed: 1
});
assert.equal(v45.parameters.params_version, 3);
assert.equal(v45.parameters.noise_schedule, 'native');
assert.equal(v45.parameters.skip_cfg_above_sigma, 58);
assert.equal(v45.parameters.n_samples, 1);
assert.equal('tag_hint_qt' in v45.parameters, false);

const v5 = buildNovelAiBaseParameters({
    model: 'nai-diffusion-5-full',
    width: 832,
    height: 1216,
    steps: 28,
    sampler: 'k_euler_ancestral',
    scale: 7,
    seed: 1
});
assert.equal(v5.parameters.params_version, 4);
assert.equal(v5.parameters.noise_schedule, 'karras');
assert.equal(v5.parameters.tag_hint_qt, 1);
assert.equal(v5.parameters.tag_hint_uc_preset, 2);
assert.equal(v5.parameters.prefer_brownian, true);
assert.equal('skip_cfg_above_sigma' in v5.parameters, false);
assert.equal(getNovelAiModelProfile('nai-diffusion-5-full').defaultSteps, 28);

assert.equal(calculateNovelAiRequestCost({
    model: 'nai-diffusion-5-full',
    parameters: v5.parameters,
    subscription: activeOpus
}).total, 0);

assert.equal(calculateNovelAiRequestCost({
    model: 'nai-diffusion-5-full',
    parameters: v5.parameters,
    subscription: exhaustedOpus
}).total, 30);

const v5At29Steps = buildNovelAiBaseParameters({
    model: 'nai-diffusion-5-full',
    width: 1024,
    height: 1024,
    steps: 29,
    sampler: 'k_euler_ancestral',
    scale: 7,
    seed: 1
});
assert.equal(calculateNovelAiRequestCost({
    model: 'nai-diffusion-5-full',
    parameters: v5At29Steps.parameters,
    subscription: activeOpus
}).total, 32);

const v5Large = buildNovelAiBaseParameters({
    model: 'nai-diffusion-5-full',
    width: 1024,
    height: 1536,
    steps: 28,
    sampler: 'k_euler_ancestral',
    scale: 7,
    seed: 1
});
assert.equal(calculateNovelAiRequestCost({
    model: 'nai-diffusion-5-full',
    parameters: v5Large.parameters,
    subscription: activeOpus
}).total, 45);

assert.equal(calculateNovelAiRequestCost({
    model: 'nai-diffusion-4-5-full',
    parameters: v45.parameters,
    subscription: activeOpus,
    preciseReferenceCount: 2
}).total, 10);

const v5Inpaint = {
    ...v5.parameters,
    image: 'placeholder',
    mask: 'placeholder',
    inpaintImg2ImgStrength: 0.5
};
assert.equal(calculateNovelAiRequestCost({
    model: 'nai-diffusion-5-full',
    parameters: v5Inpaint,
    subscription: activeOpus
}).total, 15);

const unknownPaid = calculateNovelAiRepeatedRequestCost({
    model: 'nai-diffusion-5-full',
    parameters: v5At29Steps.parameters,
    subscription: { available: false },
    requestCount: 1
});
assert.equal(unknownPaid.status, 'paid');
assert.equal(unknownPaid.minimum, 32);
assert.equal(unknownPaid.maximum, 32);

const v5Repeated = calculateNovelAiRepeatedRequestCost({
    model: 'nai-diffusion-5-full',
    parameters: v5.parameters,
    subscription: activeOpus,
    requestCount: 3
});
assert.equal(v5Repeated.status, 'conditional');
assert.equal(v5Repeated.minimum, 0);
assert.equal(v5Repeated.maximum, 90);
assert.equal(v5Repeated.requiresConsent, true);
assert.equal(v5Repeated.requestCount, 3);
assert.equal(v5Repeated.reasons.includes('V5 무료 사용량이 반복 생성 도중 소진될 수 있음'), true);

// 반복 생성 횟수는 NovelAI 배치 크기가 아니다. 각 요청은 계속 n_samples=1이어야 한다.
assert.equal(v5.parameters.n_samples, 1);
const actualMultiSample = {
    ...v5.parameters,
    n_samples: 3
};
assert.equal(calculateNovelAiRequestCost({
    model: 'nai-diffusion-5-full',
    parameters: actualMultiSample,
    subscription: activeOpus
}).total, 90);

const appHtml = readFileSync(new URL('../public/app.html', import.meta.url), 'utf8');
const craftSource = readFileSync(new URL('../public/js/craft.js', import.meta.url), 'utf8');
const plannerSource = readFileSync(new URL('../public/js/project/planner.js', import.meta.url), 'utf8');
assert.equal(appHtml.includes('id="nai-cost-card"'), false);
assert.ok(appHtml.indexOf('id="nai-header-usage"') < appHtml.indexOf('id="theme-toggle-btn"'));
assert.ok(craftSource.includes('async function prepareCurrentNovelAiCost'));
assert.ok(craftSource.includes('export async function estimateNovelAiPlannerCost'));
assert.equal(craftSource.includes('confirmed: window.confirm(buildNovelAiCostConfirmation(disclosure))'), false);
assert.ok(plannerSource.includes('id="planner-cost-estimate"'));
assert.ok(plannerSource.includes('전체 예상 Anlas 사용량'));
assert.equal(plannerSource.includes('window.confirmNovelAiPlannerCost'), false);

console.log('NovelAI V5 model and pricing checks passed.');
