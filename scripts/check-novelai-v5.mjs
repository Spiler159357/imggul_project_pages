import assert from 'node:assert/strict';
import {
    buildNovelAiBaseParameters,
    getNovelAiModelProfile,
    normalizeNovelAiModelId
} from '../public/js/nai-models.js';
import {
    calculateNovelAiBatchCost,
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

const unknownPaid = calculateNovelAiBatchCost({
    model: 'nai-diffusion-5-full',
    parameters: v5At29Steps.parameters,
    subscription: { available: false },
    requestCount: 1
});
assert.equal(unknownPaid.status, 'paid');
assert.equal(unknownPaid.minimum, 32);
assert.equal(unknownPaid.maximum, 32);

const v5Batch = calculateNovelAiBatchCost({
    model: 'nai-diffusion-5-full',
    parameters: v5.parameters,
    subscription: activeOpus,
    requestCount: 3
});
assert.equal(v5Batch.status, 'conditional');
assert.equal(v5Batch.minimum, 0);
assert.equal(v5Batch.maximum, 90);
assert.equal(v5Batch.requiresConsent, true);

console.log('NovelAI V5 model and pricing checks passed.');
