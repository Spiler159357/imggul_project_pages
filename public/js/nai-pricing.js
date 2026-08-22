import { getNovelAiModelProfile, normalizeNovelAiModelId } from './nai-models.js?v=novelai-v5-20260823a';

export const NAI_PRICING_VERSION = 'novelai-web-2026-08-23';

const PRICE_A = 2.951823174884865e-6;
const PRICE_B = 5.753298233447344e-7;
const NORMAL_PIXEL_LIMIT = 1024 * 1024;
const FREE_STEP_LIMIT = 28;

function asPositiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isOpusZeroAnlasEligible(parameters = {}) {
    const pixels = asPositiveNumber(parameters.width, 0) * asPositiveNumber(parameters.height, 0);
    const steps = asPositiveNumber(parameters.steps, 0);
    const nSamples = Math.max(1, Math.floor(asPositiveNumber(parameters.n_samples, 1)));
    const hasBaseImage = !!parameters.image || !!parameters.mask;
    return pixels > 0
        && pixels <= NORMAL_PIXEL_LIMIT
        && steps <= FREE_STEP_LIMIT
        && nSamples >= 1
        && !hasBaseImage;
}

export function calculateNovelAiPaidUnit(parameters = {}, model) {
    const profile = getNovelAiModelProfile(model);
    const pixels = Math.max(
        asPositiveNumber(parameters.width, 0) * asPositiveNumber(parameters.height, 0),
        65_536
    );
    const steps = asPositiveNumber(parameters.steps, profile.defaultSteps);
    const strength = parameters.mask
        ? asPositiveNumber(parameters.inpaintImg2ImgStrength, 1)
        : parameters.image
            ? asPositiveNumber(parameters.strength, 1)
            : 1;

    if (profile.family === 'v4' || profile.family === 'v5') {
        let raw = Math.ceil(PRICE_A * pixels + PRICE_B * pixels * steps);
        if (parameters.sm_dyn) raw *= 1.4;
        else if (parameters.sm) raw *= 1.2;
        if (profile.family === 'v5') raw *= 1.5;
        return Math.max(Math.ceil(raw * strength), 2);
    }

    // V3의 공개 클라이언트는 sampler별 보간표를 사용한다. 이 경로는 기존 UI의
    // 근사값을 유지하되 확정 금액으로 표시하지 않도록 estimated를 함께 반환한다.
    return Math.max(1, Math.ceil((pixels * steps) / 65_536 * 0.15));
}

function hasActiveOpus(subscription) {
    return !!subscription?.available
        && subscription.active === true
        && Number(subscription.tier) >= 3;
}

export function calculateNovelAiRequestCost({
    model,
    parameters = {},
    subscription = null,
    preciseReferenceCount = 0,
    forcePaid = false
} = {}) {
    const normalizedModel = normalizeNovelAiModelId(model);
    const profile = getNovelAiModelProfile(normalizedModel);
    const nSamples = Math.max(1, Math.floor(asPositiveNumber(parameters.n_samples, 1)));
    const eligible = isOpusZeroAnlasEligible(parameters);
    const usageUnavailable = profile.opusUsageLimit
        && (subscription?.usage?.isNegative ?? true);
    const canUseOpusFree = !forcePaid
        && eligible
        && hasActiveOpus(subscription)
        && !usageUnavailable;
    const billableSamples = Math.max(0, nSamples - (canUseOpusFree ? 1 : 0));
    const unitPrice = calculateNovelAiPaidUnit(parameters, normalizedModel);
    const precisePrice = profile.supportsPreciseReference
        ? 5 * Math.max(0, Math.floor(Number(preciseReferenceCount) || 0)) * nSamples
        : 0;
    const total = unitPrice * billableSamples + precisePrice;

    const reasons = [];
    if (precisePrice > 0) reasons.push(`Precise Reference ${precisePrice} Anlas`);
    if (parameters.image || parameters.mask) reasons.push('베이스 이미지 사용');
    if (Number(parameters.width) * Number(parameters.height) > NORMAL_PIXEL_LIMIT) reasons.push('Normal 해상도 초과');
    if (Number(parameters.steps) > FREE_STEP_LIMIT) reasons.push('28 steps 초과');
    if (nSamples > 1) reasons.push('다중 샘플');
    if (profile.opusUsageLimit && subscription?.usage?.isNegative) reasons.push('V5 무료 사용량 소진');
    if (!subscription?.available) reasons.push('구독/사용량 확인 불가');

    return {
        model: normalizedModel,
        profile,
        total,
        unitPrice,
        precisePrice,
        eligible,
        canUseOpusFree,
        usageUnavailable,
        estimated: profile.family === 'v3',
        reasons,
        calculatorVersion: NAI_PRICING_VERSION
    };
}

export function calculateNovelAiBatchCost({
    model,
    parameters = {},
    subscription = null,
    preciseReferenceCount = 0,
    requestCount = 1
} = {}) {
    const count = Math.max(1, Math.floor(asPositiveNumber(requestCount, 1)));
    const current = calculateNovelAiRequestCost({
        model,
        parameters,
        subscription,
        preciseReferenceCount
    });
    const paid = calculateNovelAiRequestCost({
        model,
        parameters,
        subscription,
        preciseReferenceCount,
        forcePaid: true
    });
    const isV5Conditional = current.profile.opusUsageLimit
        && current.canUseOpusFree
        && count > 1;
    const subscriptionUnknown = !subscription?.available;
    const unknownButPotentiallyFree = subscriptionUnknown && current.eligible;
    const minimum = unknownButPotentiallyFree
        ? current.precisePrice * count
        : current.total * count;
    const maximum = (isV5Conditional || subscriptionUnknown)
        ? paid.total * count
        : current.total * count;
    const status = unknownButPotentiallyFree
        ? 'unknown'
        : maximum > minimum
            ? 'conditional'
            : maximum > 0
                ? 'paid'
                : 'free';

    return {
        ...current,
        status,
        requestCount: count,
        perRequest: current.total,
        paidPerRequest: paid.total,
        minimum,
        maximum,
        requiresConsent: status === 'paid' || status === 'conditional' || status === 'unknown'
    };
}
