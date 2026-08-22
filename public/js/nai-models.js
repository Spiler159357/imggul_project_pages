export const SAFE_FALLBACK_NAI_MODEL = 'nai-diffusion-4-5-full';

const CURATED_MODEL_MIGRATIONS = Object.freeze({
    'nai-diffusion-4-5-curated': 'nai-diffusion-4-5-full',
    'nai-diffusion-4-curated-preview': 'nai-diffusion-4-full'
});

export const NAI_MODEL_PROFILES = Object.freeze({
    'nai-diffusion-5-full': Object.freeze({
        label: 'NAI Diffusion Anime V5 (Full)',
        family: 'v5',
        inpaintModel: 'nai-diffusion-5-full-inpainting',
        paramsVersion: 4,
        defaultSteps: 28,
        defaultScale: 7.0,
        defaultSampler: 'k_euler_ancestral',
        noiseSchedule: 'karras',
        maxCharacters: 6,
        supportsStructuredPrompt: true,
        supportsVibeTransfer: false,
        supportsPreciseReference: false,
        supportsSmea: false,
        opusUsageLimit: true
    }),
    'nai-diffusion-4-5-full': Object.freeze({
        label: 'NAI Diffusion Anime V4.5 (Full)',
        family: 'v4',
        inpaintModel: 'nai-diffusion-4-5-full-inpainting',
        paramsVersion: 3,
        defaultSteps: 28,
        defaultScale: 5.0,
        defaultSampler: 'k_euler_ancestral',
        noiseSchedule: 'native',
        maxCharacters: 6,
        supportsStructuredPrompt: true,
        supportsVibeTransfer: true,
        supportsPreciseReference: true,
        supportsSmea: false,
        opusUsageLimit: false
    }),
    'nai-diffusion-4-full': Object.freeze({
        label: 'NAI Diffusion Anime V4.0 (Full)',
        family: 'v4',
        inpaintModel: 'nai-diffusion-4-full-inpainting',
        paramsVersion: 3,
        defaultSteps: 28,
        defaultScale: 5.0,
        defaultSampler: 'k_euler_ancestral',
        noiseSchedule: 'native',
        maxCharacters: 6,
        supportsStructuredPrompt: true,
        supportsVibeTransfer: true,
        supportsPreciseReference: false,
        supportsSmea: false,
        opusUsageLimit: false
    }),
    'nai-diffusion-3': Object.freeze({
        label: 'NAI Diffusion Anime V3',
        family: 'v3',
        inpaintModel: 'nai-diffusion-3-inpainting',
        paramsVersion: 3,
        defaultSteps: 28,
        defaultScale: 5.0,
        defaultSampler: 'k_euler_ancestral',
        noiseSchedule: 'native',
        maxCharacters: 0,
        supportsStructuredPrompt: false,
        supportsVibeTransfer: true,
        supportsPreciseReference: false,
        supportsSmea: true,
        opusUsageLimit: false
    }),
    'nai-diffusion-furry-3': Object.freeze({
        label: 'NAI Diffusion Furry V3',
        family: 'v3',
        inpaintModel: 'nai-diffusion-furry-3-inpainting',
        paramsVersion: 3,
        defaultSteps: 28,
        defaultScale: 5.0,
        defaultSampler: 'k_euler_ancestral',
        noiseSchedule: 'native',
        maxCharacters: 0,
        supportsStructuredPrompt: false,
        supportsVibeTransfer: true,
        supportsPreciseReference: false,
        supportsSmea: true,
        opusUsageLimit: false
    })
});

export function normalizeNovelAiModelId(model) {
    const requested = String(model || '').trim();
    const migrated = CURATED_MODEL_MIGRATIONS[requested] || requested;
    return NAI_MODEL_PROFILES[migrated] ? migrated : SAFE_FALLBACK_NAI_MODEL;
}

export function getNovelAiModelProfile(model) {
    return NAI_MODEL_PROFILES[normalizeNovelAiModelId(model)];
}

export function getNovelAiInpaintModel(model) {
    return getNovelAiModelProfile(model).inpaintModel;
}

export function buildNovelAiBaseParameters({
    model,
    width,
    height,
    steps,
    sampler,
    scale,
    negativePrompt = '',
    seed,
    sm = false,
    smDyn = false
}) {
    const normalizedModel = normalizeNovelAiModelId(model);
    const profile = getNovelAiModelProfile(normalizedModel);
    const parameters = {
        params_version: profile.paramsVersion,
        width: Number(width),
        height: Number(height),
        steps: Number(steps),
        sampler: sampler || profile.defaultSampler,
        scale: Number(scale),
        cfg_rescale: 0.0,
        negative_prompt: String(negativePrompt || ''),
        seed: Number(seed),
        n_samples: 1,
        noise_schedule: profile.noiseSchedule,
        legacy_v3_extend: false
    };

    if (profile.family === 'v5') {
        Object.assign(parameters, {
            dynamic_thresholding: false,
            deliberate_euler_ancestral_bug: false,
            prefer_brownian: true,
            tag_hint_qt: 1,
            tag_hint_uc_preset: 2
        });
    } else {
        parameters.skip_cfg_above_sigma = 58.0;
    }

    if (profile.supportsSmea) {
        parameters.sm = !!sm;
        parameters.sm_dyn = !!smDyn;
    }

    return { model: normalizedModel, profile, parameters };
}

