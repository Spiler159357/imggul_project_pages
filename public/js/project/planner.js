import { DEFAULT_PLANNER_RESOLUTION, DEFAULT_PLANNER_SETTINGS, MAX_V4_PROMPT_CHARACTERS, PLANNER_MODEL_OPTIONS, PLANNER_RESOLUTION_OPTIONS, PLANNER_SAMPLER_OPTIONS, PROJECT_SECTIONS, cachePlannerCharacterSelection, clearFolderDataCaches, createDefaultBackgroundPrompt, escapeHtml, escapeJsString, getActiveProject, getAssetUrl, getCachedPlannerCharacterId, getCharacterById, getFileNameFromKey, getPlannerMetaKey, getPlannerPrefix, getPlannerSettingsKey, getProjectBackgroundPromptData, getProjectItems, getSelectedPlannerCharacterId, getSituationDisplayName, getSituationGeneration, getSituationImageNumber, getSituationRating, loadCharacterFiles, loadCharacterMeta, loadProjectBackgroundPrompts, loadProjectCharacters, loadProjectSituations, loadProjectStylePrompt, normalizeCharacterPromptVariants, normalizePlannerMeta, normalizePlannerV4PromptRows, normalizeProjectBackgroundPrompts, normalizeSituationPromptVariants, refreshProjectIcons, renderEmptyState, renderProjectShell, saveProjectSituations, setCachedPlannerCharacterId, sortPlannerItems } from './shared.js';
import { renderSectionHeader } from './manage.js';
import { findSituationImage, renderProjectItemCreateModal } from './character.js';
import { combinePromptParts, getSituationById } from './situation.js';

const PLANNER_DEFAULT_IMAGE_COUNT = 20;
const PLANNER_MIN_IMAGE_COUNT = 1;
const PLANNER_MAX_IMAGE_COUNT = 100;
const PLANNER_META_CACHE_TTL_MS = 3000;
const PLANNER_BACKGROUND_ETA_STORAGE_KEY = 'imggul_planner_background_eta';
const PLANNER_BACKGROUND_FALLBACK_AVERAGE_MS = 10000;
const PLANNER_BACKGROUND_ETA_SAMPLE_LIMIT = 100;
const DEFAULT_PLANNER_QUALITY_TAGS = 'masterpiece, best quality, very aesthetic, no text';
const plannerMetaMemoryCache = new Map();

function clonePlannerMetaValue(meta) {
    if (!meta) return meta;
    try {
        return structuredClone(meta);
    } catch {
        return JSON.parse(JSON.stringify(meta));
    }
}

function getPlannerMetaCacheKey(project, characterId = '') {
    if (!project?.prefix) return '';
    return getPlannerMetaKey(project, characterId || getSelectedPlannerCharacterId(project));
}

function readPlannerMetaCache(key) {
    const cached = plannerMetaMemoryCache.get(key);
    if (!cached || Date.now() - cached.timestamp > PLANNER_META_CACHE_TTL_MS) return null;
    return clonePlannerMetaValue(cached.meta);
}

function writePlannerMetaCache(key, meta) {
    if (!key) return;
    if (!meta) {
        plannerMetaMemoryCache.delete(key);
        return;
    }
    plannerMetaMemoryCache.set(key, { meta: clonePlannerMetaValue(meta), timestamp: Date.now() });
}

function deletePlannerMetaCache(key) {
    if (key) plannerMetaMemoryCache.delete(key);
}

function setPlannerPendingAction(action) {
    const token = `${action}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    window.PROJECT_PLANNER_PENDING_ACTION = { action, token };
    renderPlannerIfVisible();
    return token;
}

function clearPlannerPendingAction(token) {
    if (!token || window.PROJECT_PLANNER_PENDING_ACTION?.token !== token) return;
    window.PROJECT_PLANNER_PENDING_ACTION = null;
    renderPlannerIfVisible();
}

function getPlannerPendingActionLabel(action) {
    return {
        start: '시작 중',
        pause: '일시정지 중',
        resume: '재개 중',
        cancel: '취소 중'
    }[action] || '처리 중';
}

function derivePlannerStoredMetaStatus(meta) {
    const items = Array.isArray(meta?.items) ? meta.items : [];
    if (!items.length) return meta?.status || 'draft';
    const statuses = items.map(item => getPlannerStoredItemStatus(item, meta));
    if (statuses.every(status => status === 'confirmed')) return 'confirmed';
    if (statuses.every(status => status === 'done' || status === 'confirmed')) return 'completed';
    if (statuses.every(status => status === 'failed')) return 'failed';
    if (statuses.some(status => status === 'failed' || status === 'partial_failed')) return 'partial_failed';
    return 'draft';
}

function normalizePlannerStoredMeta(meta = {}, options = {}) {
    const normalized = normalizePlannerMeta(meta || {});
    const hasBackgroundJob = !!normalized.backgroundJobId;
    const staleActiveMeta = isPlannerActiveStatus(normalized.status) && !hasBackgroundJob;
    const staleActiveBackground = isPlannerActiveStatus(normalized.backgroundStatus?.status) && !hasBackgroundJob;
    if (!options.preserveActiveStatus && (staleActiveMeta || staleActiveBackground)) {
        delete normalized.backgroundStatus;
        delete normalized.runningSituationIds;
        normalized.stage = '';
        normalized.stageLabel = '';
        normalized.items = (normalized.items || []).map(item => {
            if (!isPlannerActiveStatus(item.status) && item.status !== 'paused') return item;
            return {
                ...item,
                status: getPlannerStoredItemStatus(item, normalized),
                stage: '',
                stageLabel: ''
            };
        });
        normalized.status = derivePlannerStoredMetaStatus(normalized);
    } else if (!hasBackgroundJob && isPlannerTerminalStatus(normalized.status)) {
        delete normalized.backgroundStatus;
        delete normalized.runningSituationIds;
    }
    return normalized;
}

function clampPlannerImageCount(value, fallback = PLANNER_DEFAULT_IMAGE_COUNT) {
    const parsed = parseInt(value, 10);
    const count = Number.isFinite(parsed) ? parsed : fallback;
    return Math.min(PLANNER_MAX_IMAGE_COUNT, Math.max(PLANNER_MIN_IMAGE_COUNT, count));
}

export function buildPlannerSplitPrompts(generation = {}) {
    const fields = generation.fields || {};
    const prompts = generation.prompts || {};
    const splitPrompts = {
        style: fields.style || prompts['prompt-style'] || '',
        composition: fields.composition || prompts['prompt-composition'] || '',
        character: fields.character || prompts['prompt-character'] || '',
        clothing: fields.clothing || prompts['prompt-clothing'] || '',
        expression: fields.expression || prompts['prompt-expression'] || '',
        action: fields.action || prompts['prompt-action'] || '',
        background: fields.background || prompts['prompt-background'] || ''
    };
    Object.keys(splitPrompts).forEach(key => {
        if (!splitPrompts[key]) delete splitPrompts[key];
    });
    return splitPrompts;
}

export function mergePlannerSplitMetadata(item, metadata = {}, imageKey = '') {
    const source = metadata && typeof metadata === 'object' ? metadata : {};
    const snapshot = imageKey && item?.imagePromptSnapshots?.[imageKey]
        ? item.imagePromptSnapshots[imageKey]
        : null;
    const fallback = buildPlannerMetadataFallback(item);
    const splitPrompts = snapshot?.['Split Prompts'] || source['Split Prompts'] || fallback?.['Split Prompts'] || {};
    const merged = {
        ...source,
        ...(snapshot || {})
    };
    Object.entries(fallback || {}).forEach(([key, value]) => {
        if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
            merged[key] = value;
        }
    });
    if (Object.keys(splitPrompts).length) {
        merged['Split Prompts'] = splitPrompts;
        delete merged.Prompt;
    }
    return merged;
}

export async function loadPlannerMeta(project, characterId = '', options = {}) {
    if (!project?.prefix) return null;
    const targetCharacterId = characterId || getSelectedPlannerCharacterId(project);
    const targetKey = getPlannerMetaKey(project, targetCharacterId);
    if (!options.force) {
        const cached = readPlannerMetaCache(targetKey);
        if (cached !== null) return cached;
    }
    let res = await fetch(`/api/planner/v3/run?projectId=${encodeURIComponent(project.id || '')}&characterId=${encodeURIComponent(targetCharacterId)}&_t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('플래너 메타데이터를 불러오지 못했습니다.');
    const payload = await res.json();
    if (!payload.data) return null;
    const meta = normalizePlannerStoredMeta(payload.data);
    if (targetCharacterId && meta?.characterId && meta.characterId !== targetCharacterId) return null;
    writePlannerMetaCache(targetKey, meta);
    return meta;
}

export async function loadPlannerQueueMetas(project, characters = getProjectItems(project, 'characters'), options = {}) {
    const selectedCharacterId = getSelectedPlannerCharacterId(project);
    const metas = await Promise.all(characters.map(async character => {
        const meta = await loadPlannerMeta(project, character.id, options).catch(() => null);
        if (meta && !meta.characterId && characters.length > 1 && character.id !== selectedCharacterId) return null;
        return meta?.items?.length ? { character, meta } : null;
    }));
    return metas.filter(Boolean);
}

export async function savePlannerMeta(project, meta, options = {}) {
    const key = getPlannerMetaKey(project, meta?.characterId || getSelectedPlannerCharacterId(project));
    const normalized = normalizePlannerStoredMeta(meta || {}, options);
    normalized.projectId = normalized.projectId || project?.id || '';
    normalized.projectPrefix = normalized.projectPrefix || project?.prefix || '';
    const res = await fetch('/api/planner/v3/run?_t=' + Date.now(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
            data: normalized
        }),
        cache: 'no-store'
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '플래너 메타데이터 저장에 실패했습니다.');
    }
    writePlannerMetaCache(key, normalized);
}

export async function savePlannerItem(project, meta, item) {
    const key = getPlannerMetaKey(project, meta?.characterId || getSelectedPlannerCharacterId(project));
    const normalized = normalizePlannerStoredMeta(meta || {});
    normalized.projectId = normalized.projectId || project?.id || '';
    normalized.projectPrefix = normalized.projectPrefix || project?.prefix || '';
    const res = await fetch('/api/planner/v3/item?_t=' + Date.now(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
            meta: normalized,
            item
        }),
        cache: 'no-store'
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '플래너 항목 저장에 실패했습니다.');
    }
    const payload = await res.json().catch(() => ({}));
    if (payload?.data?.runId) normalized.id = payload.data.runId;
    if (payload?.data?.itemId && item) item.id = payload.data.itemId;
    writePlannerMetaCache(key, normalized);
    return payload.data || {};
}

export async function deletePlannerMeta(project, characterId = '') {
    if (!project?.prefix) return;
    const key = getPlannerMetaKey(project, characterId || getSelectedPlannerCharacterId(project));
    const meta = await loadPlannerMeta(project, characterId, { force: true }).catch(() => null);
    if (meta?.id) {
        await fetch(`/api/planner/v3/run/${encodeURIComponent(meta.id)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        }).catch(() => null);
    }
    deletePlannerMetaCache(key);
    deletePlannerMetaCache(getPlannerMetaKey(project));
}

export function getPlannerImagePrefix(project, imageNumber) {
    return `${getPlannerPrefix(project)}${imageNumber}/`;
}

export function normalizePlannerSettings(settings = {}) {
    return {
        model: settings.model || DEFAULT_PLANNER_SETTINGS.model,
        steps: String(settings.steps || DEFAULT_PLANNER_SETTINGS.steps),
        scale: String(settings.scale || DEFAULT_PLANNER_SETTINGS.scale),
        sampler: settings.sampler || DEFAULT_PLANNER_SETTINGS.sampler,
        sm: !!settings.sm,
        sm_dyn: !!settings.sm_dyn,
        vibeStrength: String(settings.vibeStrength || DEFAULT_PLANNER_SETTINGS.vibeStrength),
        vibeInfo: String(settings.vibeInfo || DEFAULT_PLANNER_SETTINGS.vibeInfo),
        preciseStrength: String(settings.preciseStrength || DEFAULT_PLANNER_SETTINGS.preciseStrength),
        preciseFidelity: String(settings.preciseFidelity || DEFAULT_PLANNER_SETTINGS.preciseFidelity),
        preciseType: settings.preciseType || DEFAULT_PLANNER_SETTINGS.preciseType,
        vibeImageKey: settings.vibeImageKey || '',
        preciseImageKey: settings.preciseImageKey || ''
    };
}

export async function loadPlannerSettings(project, force = false) {
    if (!project?.prefix) return normalizePlannerSettings();
    if (!force && window.PROJECT_PLANNER_SETTINGS?.projectId === project.id) return window.PROJECT_PLANNER_SETTINGS;

    const res = await fetch(`/api/planner/v3/settings?projectId=${encodeURIComponent(project.id || '')}&_t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) {
        window.PROJECT_PLANNER_SETTINGS = { projectId: project.id, ...normalizePlannerSettings() };
        return window.PROJECT_PLANNER_SETTINGS;
    }
    if (!res.ok) throw new Error('플래너 설정을 불러오지 못했습니다.');

    const payload = await res.json();
    const settings = normalizePlannerSettings(payload.data || {});
    window.PROJECT_PLANNER_SETTINGS = { projectId: project.id, ...settings };
    return window.PROJECT_PLANNER_SETTINGS;
}

export async function savePlannerSettings(project, settings) {
    const normalized = normalizePlannerSettings(settings);
    const res = await fetch('/api/planner/v3/settings?_t=' + Date.now(), {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
            projectId: project.id || '',
            projectPrefix: project.prefix || '',
            ...normalized
        }),
        cache: 'no-store'
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '플래너 설정 저장에 실패했습니다.');
    }
    window.PROJECT_PLANNER_SETTINGS = { projectId: project.id, ...normalized };
    return window.PROJECT_PLANNER_SETTINGS;
}

export function applyPlannerSettingsToGeneration(generation, settings) {
    const normalized = normalizePlannerSettings(settings);
    generation.model = normalized.model;
    generation.steps = normalized.steps;
    generation.scale = normalized.scale;
    generation.sampler = normalized.sampler;
    generation.sm = normalized.sm;
    generation.sm_dyn = normalized.sm_dyn;
    generation.vibeStrength = normalized.vibeStrength;
    generation.vibeInfo = normalized.vibeInfo;
    generation.preciseStrength = normalized.preciseStrength;
    generation.preciseFidelity = normalized.preciseFidelity;
    generation.preciseType = normalized.preciseType;
    generation.vibeImageKey = normalized.vibeImageKey;
    generation.preciseImageKey = normalized.preciseImageKey;
    return generation;
}

export async function loadPlannerReferenceFile(key) {
    if (!key) return null;
    const res = await fetch(`${getAssetUrl(key)}?_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`참조 이미지를 불러오지 못했습니다: ${key}`);
    const blob = await res.blob();
    const fileName = getFileNameFromKey(key) || 'planner-reference.webp';
    return new File([blob], fileName, { type: blob.type || 'image/webp', lastModified: Date.now() });
}

export async function applyPlannerReferenceFiles(generation) {
    window.VIBE_IMAGE_FILE = await loadPlannerReferenceFile(generation.vibeImageKey);
    window.PRECISE_IMAGE_FILE = await loadPlannerReferenceFile(generation.preciseImageKey);
}

export function getPlannerField(item, key) {
    return item?.generation?.fields?.[key] || '';
}

export function getPlannerStatusLabel(status) {
    const labels = {
        draft: '초안',
        queued: '대기 중',
        pending: '대기',
        running: '생성 중',
        paused: '중지됨',
        completed: '생성 완료',
        partial_failed: '일부 실패',
        cancel_requested: '취소 요청됨',
        expired: '만료됨',
        confirmed: '확정 완료',
        failed: '실패',
        done: '완료'
    };
    return labels[status] || status || '초안 없음';
}

export function getPlannerStageLabel(stage) {
    const labels = {
        queued: '대기열 대기',
        running: '생성 준비',
        novelai_request: 'NovelAI 요청 중',
        novelai_response: 'NovelAI 응답 수신',
        zip_extract: '결과 압축 해제',
        webp_encode: 'WebP 변환',
        r2_put: 'R2 저장',
        metadata_put: '메타데이터 저장',
        rollup: '상태 갱신',
        completed: '완료',
        failed: '실패',
        paused: '일시정지됨',
        expired: '만료됨'
    };
    return labels[stage] || stage || '';
}

function isPlannerActiveStatus(status) {
    return ['queued', 'running', 'cancel_requested'].includes(status);
}

function isPlannerTerminalStatus(status) {
    return ['completed', 'done', 'failed', 'partial_failed', 'confirmed'].includes(status);
}

function isPlannerConfirmBlocked(meta = {}, item = null) {
    if (!item) return false;
    const itemActive = ['running', 'cancel_requested'].includes(item.status);
    const backgroundJobId = meta.backgroundJobId || meta.backgroundStatus?.jobId || item.backgroundJobId;
    if (isPlannerTerminalStatus(meta.status) || isPlannerTerminalStatus(meta.backgroundStatus?.status)) {
        return itemActive && !!backgroundJobId;
    }
    if (window.PROJECT_PLANNER_GENERATION_MODE === 'background') {
        const metaActive = !!backgroundJobId && isPlannerActiveStatus(meta.status);
        const backgroundActive = !!backgroundJobId && isPlannerActiveStatus(meta.backgroundStatus?.status);
        if (metaActive || backgroundActive) return true;
    } else {
        const browserRun = window.PROJECT_PLANNER_BROWSER_RUN;
        if (browserRun?.status === 'running' && (browserRun.runningSituationIds || []).includes(item.situationId)) return true;
    }
    return itemActive && !!backgroundJobId;
}

function isPlannerResumableStatus(status) {
    return status === 'paused';
}

function getPlannerQueueItems(queueMetas = []) {
    return queueMetas.flatMap(entry => (entry.meta.items || []).map(item => ({
        character: entry.character,
        meta: entry.meta,
        item
    })));
}

function getPlannerItemFailedCount(item = {}) {
    const failedCount = Number(item.failedCount ?? item.failed_count ?? 0);
    if (Number.isFinite(failedCount) && failedCount > 0) return failedCount;
    return ['failed', 'partial_failed'].includes(item.status) ? 1 : 0;
}

function getPlannerQueueSummary(queueMetas = []) {
    const entries = getPlannerQueueItems(queueMetas);
    const totalImages = entries.reduce((sum, entry) => sum + clampPlannerImageCount(entry.item.count), 0);
    const completedImages = entries.reduce((sum, entry) => sum + (Array.isArray(entry.item.images) ? entry.item.images.length : 0), 0);
    const active = queueMetas.some(entry => isPlannerActiveStatus(entry.meta.status));
    const paused = !active && queueMetas.some(entry => isPlannerResumableStatus(entry.meta.status));
    const failed = entries.reduce((sum, entry) => sum + getPlannerItemFailedCount(entry.item), 0);
    return {
        entries,
        totalItems: entries.length,
        totalImages,
        completedImages,
        failed,
        active,
        paused,
        status: active ? 'running' : paused ? 'paused' : (queueMetas[0]?.meta?.status || 'draft')
    };
}

function getPlannerQueueEta(queueMetas = []) {
    return queueMetas
        .map(entry => entry.meta?.backgroundStatus?.eta || entry.meta?.eta || null)
        .find(eta => eta && Number(eta.remainingMs) >= 0 && eta.remainingText);
}

function renderPlannerEtaBadge(eta) {
    if (!eta?.remainingText) return '';
    const basisLabel = eta.basis === 'completed_average'
        ? `최근 ${eta.sampleCount || 0}장 기준`
        : '기본 추정';
    return `
        <span class="inline-flex items-center gap-1 rounded-full border border-indigo-200 dark:border-indigo-800 bg-white/80 dark:bg-indigo-950/40 px-2 py-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
            <i data-lucide="clock-3" class="w-3 h-3"></i>
            예상 ${escapeHtml(eta.remainingText)} 남음 · ${escapeHtml(basisLabel)}
        </span>
    `;
}

function formatPlannerDuration(ms) {
    const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
    if (seconds < 60) return `${seconds}초`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes}분 ${rest}초` : `${minutes}분`;
}

function readPlannerBackgroundEtaStore() {
    try {
        return JSON.parse(localStorage.getItem(PLANNER_BACKGROUND_ETA_STORAGE_KEY) || '{}') || {};
    } catch {
        return {};
    }
}

function writePlannerBackgroundEtaStore(store) {
    try {
        localStorage.setItem(PLANNER_BACKGROUND_ETA_STORAGE_KEY, JSON.stringify(store || {}));
    } catch {}
}

function getPlannerBackgroundEtaSamples(store) {
    return (Array.isArray(store.samples) ? store.samples : [])
        .map(value => Number(value))
        .filter(value => Number.isFinite(value) && value >= 1000 && value <= 10 * 60 * 1000)
        .slice(-PLANNER_BACKGROUND_ETA_SAMPLE_LIMIT);
}

function getPlannerBackgroundEtaAverage(samples, fallbackAverageMs = 0) {
    if (samples.length) {
        return Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length);
    }
    const fallback = Number(fallbackAverageMs || 0);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : PLANNER_BACKGROUND_FALLBACK_AVERAGE_MS;
}

function prunePlannerBackgroundEtaJobs(jobs = {}) {
    return Object.fromEntries(
        Object.entries(jobs)
            .sort(([, a], [, b]) => Number(b?.observedAt || 0) - Number(a?.observedAt || 0))
            .slice(0, PLANNER_BACKGROUND_ETA_SAMPLE_LIMIT)
    );
}

function updatePlannerBackgroundEta(jobId, status = {}) {
    if (!jobId || status.mode !== 'background' || !isPlannerActiveStatus(status.status)) return null;
    const now = Date.now();
    const completed = Number(status.completedCount || 0);
    const failed = Number(status.failedCount || 0);
    const total = Number(status.totalCount || 0);
    const remainingCount = Math.max(0, total - completed - failed);
    const store = readPlannerBackgroundEtaStore();
    const jobs = store.jobs || {};
    const previous = jobs[jobId] || {};
    let samples = getPlannerBackgroundEtaSamples(store);
    const canRecordSample = status.status === 'running';
    const previousCompleted = Number(previous.completedCount);
    const hasPreviousCompleted = Number.isFinite(previousCompleted);
    const completedChanged = hasPreviousCompleted && completed !== previousCompleted;
    const completedIncreased = hasPreviousCompleted && completed > previousCompleted;

    if (canRecordSample && previous.sampleReady && completedIncreased && previous.observedAt) {
        const deltaCount = completed - previousCompleted;
        const observedMs = Math.max(0, now - Number(previous.observedAt || now));
        const observedAverageMs = observedMs / deltaCount;
        if (Number.isFinite(observedAverageMs) && observedAverageMs >= 1000 && observedAverageMs <= 10 * 60 * 1000) {
            samples = samples.concat(Array.from({ length: deltaCount }, () => Math.round(observedAverageMs)))
                .slice(-PLANNER_BACKGROUND_ETA_SAMPLE_LIMIT);
        }
    }
    const averageMs = getPlannerBackgroundEtaAverage(samples, store.averageMs);
    const sampleCount = samples.length;

    if (!hasPreviousCompleted || completedChanged) {
        jobs[jobId] = {
            completedCount: completed,
            observedAt: canRecordSample ? now : previous.observedAt,
            sampleReady: canRecordSample && completed > 0,
            status: status.status
        };
    } else {
        jobs[jobId] = {
            ...previous,
            status: status.status,
            sampleReady: Boolean(previous.sampleReady) && canRecordSample && completed > 0
        };
    }
    writePlannerBackgroundEtaStore({
        ...store,
        averageMs,
        sampleCount,
        samples,
        updatedAt: new Date(now).toISOString(),
        jobs: prunePlannerBackgroundEtaJobs(jobs)
    });

    const remainingMs = Math.round(remainingCount * averageMs);
    return {
        source: 'browser_observed_background_status',
        basis: sampleCount ? 'completed_average' : 'fallback',
        averageMs,
        sampleCount,
        remainingCount,
        remainingMs,
        remainingText: formatPlannerDuration(remainingMs),
        generatedAt: new Date(now).toISOString()
    };
}

function withoutPlannerVolatileEta(status = {}) {
    if (!status?.eta) return status;
    const { eta, ...rest } = status;
    return rest;
}

function updatePlannerQueueMetaCache(project, meta) {
    if (!project || !meta) return;
    const character = getCharacterById(project, meta.characterId)
        || getCharacterById(project, meta.characterPrefix)
        || getCharacterById(project, getSelectedPlannerCharacterId(project));
    if (!character) return;
    const queueMetas = Array.isArray(window.PROJECT_PLANNER_QUEUE_METAS) ? [...window.PROJECT_PLANNER_QUEUE_METAS] : [];
    const index = queueMetas.findIndex(entry =>
        entry.meta?.characterId === meta.characterId
        || entry.character?.id === character.id
    );
    const entry = { character, meta };
    if (index >= 0) queueMetas[index] = entry;
    else if (meta.items?.length) queueMetas.push(entry);
    window.PROJECT_PLANNER_QUEUE_METAS = queueMetas.filter(entry => entry.meta?.items?.length);
}

function getPlannerQueueMetaEntry(project, characterId = '') {
    if (!project) return null;
    const targetCharacterId = String(characterId || '').trim();
    const queueMetas = Array.isArray(window.PROJECT_PLANNER_QUEUE_METAS) ? window.PROJECT_PLANNER_QUEUE_METAS : [];
    return queueMetas.find(entry =>
        (targetCharacterId && (entry.meta?.characterId === targetCharacterId || entry.character?.id === targetCharacterId))
        || (!targetCharacterId && entry.meta?.characterId === window.PROJECT_PLANNER_META?.characterId)
    ) || null;
}

function getPlannerMetaForCharacter(project, characterId = '') {
    const targetCharacterId = String(characterId || '').trim();
    const entry = getPlannerQueueMetaEntry(project, targetCharacterId);
    if (entry?.meta) return entry.meta;
    const activeMeta = window.PROJECT_PLANNER_META || null;
    if (!targetCharacterId || activeMeta?.characterId === targetCharacterId) return activeMeta;
    return null;
}

function setPlannerMetaForCharacter(project, meta) {
    if (!project || !meta) return;
    updatePlannerQueueMetaCache(project, meta);
    if (getSelectedPlannerCharacterId(project) === meta.characterId) {
        window.PROJECT_PLANNER_META = meta;
    }
}

function getPlannerResultModalCharacterId(project = getActiveProject()) {
    return window.PLANNER_RESULT_MODAL_CHARACTER_ID
        || getSelectedPlannerCharacterId(project)
        || window.PROJECT_PLANNER_META?.characterId
        || '';
}

function getPlannerResultModalMeta(project = getActiveProject()) {
    return getPlannerMetaForCharacter(project, getPlannerResultModalCharacterId(project));
}

function findPlannerMetaByImageKey(project, key = '') {
    const modalMeta = getPlannerResultModalMeta(project);
    if (modalMeta?.items?.some(item => Array.isArray(item.images) && item.images.includes(key))) return modalMeta;
    const queueMetas = Array.isArray(window.PROJECT_PLANNER_QUEUE_METAS) ? window.PROJECT_PLANNER_QUEUE_METAS : [];
    const entry = queueMetas.find(queueEntry =>
        queueEntry.meta?.items?.some(item => Array.isArray(item.images) && item.images.includes(key))
    );
    if (entry?.meta) return entry.meta;
    const activeMeta = window.PROJECT_PLANNER_META || null;
    if (activeMeta?.items?.some(item => Array.isArray(item.images) && item.images.includes(key))) return activeMeta;
    return null;
}

function resetPlannerMetaAfterCancel(meta) {
    if (!meta) return meta;
    meta.status = 'draft';
    meta.stage = '';
    meta.stageLabel = '';
    delete meta.backgroundJobId;
    delete meta.backgroundStatus;
    delete meta.runningSituationIds;
    if (Array.isArray(meta.items)) {
        meta.items = meta.items.map(item => ['queued', 'running', 'paused', 'pending', 'cancel_requested'].includes(item.status)
            ? { ...item, status: 'pending', stage: '', stageLabel: '' }
            : item
        );
    }
    meta.updatedAt = Date.now();
    return meta;
}

function getPlannerStoredItemStatus(item, meta = {}) {
    if (!item) return 'pending';
    if (item.status === 'done' || item.status === 'completed') return 'done';
    if (item.status === 'failed' || item.status === 'partial_failed' || item.status === 'confirmed') return item.status;
    return isPlannerItemTargetComplete(item, meta) ? 'done' : 'pending';
}

function buildPlannerBrowserStoredMeta(meta) {
    const stored = {
        ...(meta || {}),
        status: 'draft',
        stage: '',
        stageLabel: '',
        updatedAt: Date.now()
    };
    delete stored.backgroundJobId;
    delete stored.backgroundStatus;
    delete stored.runningSituationIds;
    stored.items = (stored.items || []).map(item => ({
        ...item,
        status: getPlannerStoredItemStatus(item, stored),
        stage: '',
        stageLabel: ''
    }));
    if (stored.items.length && stored.items.every(item => item.status === 'done' || item.status === 'confirmed')) {
        stored.status = 'completed';
    }
    return stored;
}

async function savePlannerBrowserStoredMeta(project, meta) {
    const stored = buildPlannerBrowserStoredMeta(meta);
    await savePlannerMeta(project, stored);
    return stored;
}

function setPlannerBrowserRunState(patch = null) {
    window.PROJECT_PLANNER_BROWSER_RUN = patch
        ? { ...(window.PROJECT_PLANNER_BROWSER_RUN || {}), ...patch, updatedAt: Date.now() }
        : null;
    return window.PROJECT_PLANNER_BROWSER_RUN;
}

function isPlannerBrowserRunActive() {
    return ['running', 'paused'].includes(window.PROJECT_PLANNER_BROWSER_RUN?.status);
}

function getPlannerBrowserResumeEntries(project, fallbackMeta = null) {
    const queueEntries = Array.isArray(window.PROJECT_PLANNER_QUEUE_METAS) ? window.PROJECT_PLANNER_QUEUE_METAS : [];
    const entries = [...queueEntries];
    if (fallbackMeta?.items?.length && !entries.some(entry => entry.meta === fallbackMeta || entry.meta?.characterId === fallbackMeta.characterId)) {
        const character = getCharacterById(project, fallbackMeta.characterId)
            || getCharacterById(project, fallbackMeta.characterPrefix)
            || getCharacterById(project, getSelectedPlannerCharacterId(project));
        entries.push({ character, meta: fallbackMeta });
    }
    const hasPausedItem = entry =>
        entry.meta?.items?.some(item => item.status === 'paused' && !isPlannerItemTargetComplete(item, entry.meta));
    const hasPausedRunRemainder = entry =>
        entry.meta?.status === 'paused'
        && entry.meta?.items?.some(item => isPlannerRunnableItem(item, entry.meta, true));
    return [
        ...entries.filter(hasPausedItem),
        ...entries.filter(entry => !hasPausedItem(entry) && hasPausedRunRemainder(entry))
    ];
}

function getPlannerItemGeneratedCount(item) {
    return Array.isArray(item?.images) ? item.images.length : 0;
}

function getPlannerItemTargetCount(item, meta = {}) {
    if (Array.isArray(item?.variantGenerations) && item.variantGenerations.length) {
        return item.variantGenerations.reduce((sum, variantRun) => sum + clampPlannerImageCount(variantRun.count || item.count || meta.defaultCount), 0);
    }
    return clampPlannerImageCount(item?.count || meta.defaultCount);
}

function isPlannerItemTargetComplete(item, meta = {}) {
    return getPlannerItemGeneratedCount(item) >= getPlannerItemTargetCount(item, meta);
}

function isPlannerRunnableItem(item, meta = {}, resumeOnly = false) {
    if (!item || item.status === 'confirmed') return false;
    if (isPlannerItemTargetComplete(item, meta)) return false;
    if (resumeOnly) return ['paused', 'queued', 'running', 'pending'].includes(item.status || 'pending');
    return true;
}

function isPlannerRestartableItem(item) {
    return !!item && item.status !== 'confirmed';
}

function hasPlannerGeneratedImages(item = {}) {
    return (Array.isArray(item.images) && item.images.length > 0)
        || (Array.isArray(item.generatedImages) && item.generatedImages.length > 0)
        || !!item.selectedImage
        || Number(item.completedCount || 0) > 0;
}

function buildPlannerRunGenerations(item, meta = {}, resumeRun = false) {
    const runs = Array.isArray(item.variantGenerations) && item.variantGenerations.length
        ? item.variantGenerations
        : [{ count: clampPlannerImageCount(item.count || meta.defaultCount), generation: item.generation }];
    if (!resumeRun) return runs;

    let generated = Math.max(0, getPlannerItemGeneratedCount(item));
    const resumedRuns = [];
    for (const run of runs) {
        const originalCount = clampPlannerImageCount(run.count || item.count || meta.defaultCount);
        if (generated >= originalCount) {
            generated -= originalCount;
            continue;
        }
        const count = originalCount - generated;
        generated = 0;
        if (count > 0) resumedRuns.push({ ...run, count });
    }
    return resumedRuns;
}

export function setPlannerStatus(message) {
    const el = document.getElementById('planner-status');
    if (el) el.textContent = message || '';
}

export function isPlannerPanelVisible() {
    const projectContent = document.getElementById('main-project-content');
    return !!projectContent
        && !projectContent.classList.contains('hidden')
        && window.PROJECT_VIEW === 'section'
        && window.PROJECT_ACTIVE_SECTION === 'planner';
}

export function renderPlannerIfVisible() {
    if (!isPlannerPanelVisible()) return false;
    renderPlannerSectionByState({ preserveScroll: true });
    return true;
}

function getPlannerScrollElement() {
    return document.querySelector('[data-planner-scroll="main"]');
}

function capturePlannerScrollState() {
    const main = getPlannerScrollElement();
    const shell = document.querySelector('#main-project-content .overflow-y-auto');
    return {
        mainTop: main?.scrollTop || 0,
        shellTop: shell?.scrollTop || 0,
        view: window.PROJECT_PLANNER_VIEW || 'plan'
    };
}

function restorePlannerScrollState(state) {
    if (!state || state.view !== (window.PROJECT_PLANNER_VIEW || 'plan')) return;
    requestAnimationFrame(() => {
        const main = getPlannerScrollElement();
        const shell = document.querySelector('#main-project-content .overflow-y-auto');
        if (main) main.scrollTop = state.mainTop || 0;
        if (shell) shell.scrollTop = state.shellTop || 0;
    });
}

export function readPlannerEditsFromDom(meta) {
    if (!meta?.items) return meta;
    const craftSettings = window.readCraftSettings ? window.readCraftSettings() : {};
    meta.items.forEach(item => {
        item.generation = item.generation || {};
        item.generation.fields = item.generation.fields || {};
        const fields = item.generation.fields;
        ['style', 'composition', 'character', 'clothing', 'expression', 'action', 'background', 'negative'].forEach(key => {
            const input = document.getElementById(`planner-${item.imageNumber}-${key}`);
            if (input) fields[key] = input.value.trim();
        });
        const countInput = document.getElementById(`planner-${item.imageNumber}-count`);
        if (countInput) item.count = clampPlannerImageCount(countInput.value);
        const generationInputs = {
            res: document.getElementById(`planner-${item.imageNumber}-res`)?.value
        };
        Object.entries(generationInputs).forEach(([key, value]) => {
            if (value !== undefined) item.generation[key] = value;
        });
        item.generation.v4PromptCharacters = normalizePlannerV4PromptRows(readPlannerV4PromptRows(item.imageNumber));
        item.generation.v4_prompt = item.generation.v4PromptCharacters;
        item.generation.batchCount = String(item.count);
        item.generation.negative = fields.negative;
        if (craftSettings.qualityTags !== undefined) item.generation.qualityTags = craftSettings.qualityTags;
        if (craftSettings.defaultNegativePrompt !== undefined) item.generation.defaultNegativePrompt = craftSettings.defaultNegativePrompt;
        if (craftSettings.useQualityTags !== undefined) item.generation.useQualityTags = craftSettings.useQualityTags;
        if (craftSettings.useDefaultNegativePrompt !== undefined) item.generation.useDefaultNegativePrompt = craftSettings.useDefaultNegativePrompt;
        item.generation.prompts = {
            ...item.generation.prompts,
            'prompt-style': fields.style,
            'prompt-composition': fields.composition,
            'prompt-character': fields.character,
            'prompt-clothing': fields.clothing,
            'prompt-expression': fields.expression,
            'prompt-action': fields.action,
            'prompt-background': fields.background,
            'prompt-raw': ''
        };
        applyPlannerSettingsToGeneration(item.generation, window.PROJECT_PLANNER_SETTINGS || DEFAULT_PLANNER_SETTINGS);
    });
    meta.updatedAt = Date.now();
    return meta;
}

export async function persistPlannerGenerationToSituations(project, meta) {
    if (!project || !Array.isArray(meta?.items) || !meta.items.length) return;
    await loadProjectSituations(project, true).catch(() => []);
    let changed = false;
    meta.items.forEach(item => {
        const situation = getSituationById(project, item.situationId);
        if (!situation) return;
        const nextGeneration = {
            ...getSituationGeneration(situation),
            res: item.generation?.res || getSituationGeneration(situation).res,
            v4PromptCharacters: normalizePlannerV4PromptRows(item.generation?.v4PromptCharacters || [])
        };
        nextGeneration.v4_prompt = nextGeneration.v4PromptCharacters;
        const currentGeneration = getSituationGeneration(situation);
        if (
            currentGeneration.res !== nextGeneration.res ||
            JSON.stringify(currentGeneration.v4PromptCharacters) !== JSON.stringify(nextGeneration.v4PromptCharacters)
        ) {
            situation.generation = nextGeneration;
            situation.resolution = nextGeneration.res;
            situation.v4PromptCharacters = nextGeneration.v4PromptCharacters;
            situation.v4_prompt = nextGeneration.v4PromptCharacters;
            situation.updatedAt = Date.now();
            changed = true;
        }
    });
    if (changed) await saveProjectSituations(project);
}

export async function listPlannerImages(project, imageNumber) {
    const prefix = getPlannerImagePrefix(project, imageNumber);
    const res = await fetch(`/api/list?prefix=${encodeURIComponent(prefix)}&_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.files || []).filter(file => /\.(png|webp|jpe?g)$/i.test(file.key || '')).map(file => file.key);
}

export function getPlannerSituationImage(character, situation, situationIndex) {
    const files = Array.isArray(character?.files) ? character.files : [];
    return findSituationImage(files, situation, situationIndex);
}

export function getPlannerSituationItem(meta, situationId) {
    return meta?.items?.find(item => item.situationId === situationId) || null;
}

export function getPlannerPromptVariantName(variant) {
    return variant?.name || variant?.label || variant?.id || 'Default';
}

function getPlannerBackgroundData(project) {
    const data = getProjectBackgroundPromptData(project);
    if (data.backgrounds.length) return data;
    const defaultBackground = createDefaultBackgroundPrompt();
    return normalizeProjectBackgroundPrompts({
        backgrounds: [defaultBackground],
        activeBackgroundId: defaultBackground.id
    });
}

function getPlannerBackgroundPromptById(project, backgroundId = '') {
    const data = getPlannerBackgroundData(project);
    return data.backgrounds.find(background => background.id === backgroundId)
        || data.backgrounds.find(background => background.id === data.activeBackgroundId)
        || data.backgrounds[0]
        || createDefaultBackgroundPrompt();
}

export function distributePlannerCount(totalCount, variantCount) {
    const total = Math.max(1, parseInt(totalCount, 10) || 1);
    const count = Math.max(1, parseInt(variantCount, 10) || 1);
    const base = Math.floor(total / count);
    const remainder = total % count;
    return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function buildPlannerGeneration({ currentSettings, plannerSettings, projectStyle, characterVariant, situationVariant, count, backgroundPrompt = '' }) {
    const characterParts = characterVariant?.parts || {};
    const prompt = situationVariant?.prompt || {};
    const generationSource = situationVariant?.generation || {};
    const isNsfw = getSituationRating(situationVariant) === 'nsfw';
    const fields = {
        style: projectStyle || currentSettings.prompts?.['prompt-style'] || '',
        composition: prompt.composition || currentSettings.prompts?.['prompt-composition'] || 'straight-on',
        character: characterParts.character || characterVariant?.prompt || '',
        clothing: isNsfw
            ? (prompt.clothing || '')
            : (characterParts.clothing || prompt.clothing || currentSettings.prompts?.['prompt-clothing'] || ''),
        expression: prompt.expression || currentSettings.prompts?.['prompt-expression'] || '',
        action: prompt.action || currentSettings.prompts?.['prompt-action'] || '',
        background: backgroundPrompt || prompt.background || currentSettings.prompts?.['prompt-background'] || '',
        negative: combinePromptParts(characterParts.negative, prompt.negative) || currentSettings.negative || ''
    };
    const generation = applyPlannerSettingsToGeneration({
        ...currentSettings,
        simpleMode: false,
        res: generationSource.res || currentSettings.res || DEFAULT_PLANNER_RESOLUTION,
        batchCount: String(count),
        negative: fields.negative,
        prompts: {
            ...(currentSettings.prompts || {}),
            'prompt-style': fields.style,
            'prompt-composition': fields.composition,
            'prompt-character': fields.character,
            'prompt-clothing': fields.clothing,
            'prompt-expression': fields.expression,
            'prompt-action': fields.action,
            'prompt-background': fields.background,
            'prompt-raw': ''
        },
        fields,
        v4PromptCharacters: normalizePlannerV4PromptRows(generationSource.v4PromptCharacters)
    }, plannerSettings);
    generation.v4_prompt = generation.v4PromptCharacters;
    return generation;
}

export function renderPlannerField(item, key, label, rows = 2) {
    return `
        <label class="block min-w-0">
            <span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">${label}</span>
            <textarea id="planner-${escapeHtml(item.imageNumber)}-${key}" rows="${rows}" class="w-full resize-y p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500">${escapeHtml(getPlannerField(item, key))}</textarea>
        </label>
    `;
}

export function renderPlannerSelect(id, label, value, options) {
    return `
        <label class="block min-w-0">
            <span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">${label}</span>
            <select id="${escapeHtml(id)}" class="w-full p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100">
                ${options.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${value === optionValue ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>`).join('')}
            </select>
        </label>
    `;
}

export function renderPlannerNumberInput(id, label, value, attrs = '') {
    return `
        <label class="block min-w-0">
            <span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">${label}</span>
            <input id="${escapeHtml(id)}" value="${escapeHtml(value)}" ${attrs} class="w-full p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100">
        </label>
    `;
}

export function renderPlannerCheckbox(id, label, checked) {
    return `
        <label class="inline-flex items-center gap-1.5 text-[10px] font-bold text-gray-600 dark:text-gray-300">
            <input id="${escapeHtml(id)}" type="checkbox" ${checked ? 'checked' : ''} class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
            ${label}
        </label>
    `;
}

export function getPlannerV4PromptRows(item) {
    const rows = item?.generation?.v4PromptCharacters || [];
    return Array.isArray(rows)
        ? rows.slice(0, MAX_V4_PROMPT_CHARACTERS).map(row => ({
            subject: String(row?.subject || ''),
            clothing: String(row?.clothing || ''),
            expression: String(row?.expression || ''),
            action: String(row?.action || ''),
            negative: String(row?.negative || '')
        }))
        : [];
}

export function readPlannerV4PromptRows(imageNumber) {
    const container = document.getElementById(`planner-${imageNumber}-v4-rows`);
    if (!container) return [];
    return Array.from(container.querySelectorAll('[data-planner-v4-row]')).slice(0, MAX_V4_PROMPT_CHARACTERS).map(row => {
        const rowId = row.getAttribute('data-planner-v4-row');
        return {
            subject: document.getElementById(`planner-${imageNumber}-v4-${rowId}-subject`)?.value.trim() || '',
            clothing: document.getElementById(`planner-${imageNumber}-v4-${rowId}-clothing`)?.value.trim() || '',
            expression: document.getElementById(`planner-${imageNumber}-v4-${rowId}-expression`)?.value.trim() || '',
            action: document.getElementById(`planner-${imageNumber}-v4-${rowId}-action`)?.value.trim() || '',
            negative: document.getElementById(`planner-${imageNumber}-v4-${rowId}-negative`)?.value.trim() || ''
        };
    }).filter(row => [row.subject, row.clothing, row.expression, row.action, row.negative].some(Boolean));
}

export function renderPlannerV4PromptRow(imageNumber, row, index) {
    const rowId = index;
    const inputClass = 'w-full p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100';
    return `
        <div data-planner-v4-row="${rowId}" class="rounded-md border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 p-2">
            <div class="flex items-center justify-between gap-2 mb-2">
                <span class="text-[10px] font-bold text-gray-500 dark:text-gray-400">V4 캐릭터 ${index + 1}</span>
                <button type="button" onclick="window.removePlannerV4Prompt('${escapeJsString(imageNumber)}', ${index})" class="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" title="V4 캐릭터 삭제">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input id="planner-${escapeHtml(imageNumber)}-v4-${rowId}-subject" value="${escapeHtml(row.subject || '')}" class="${inputClass}" placeholder="캐릭터">
                <input id="planner-${escapeHtml(imageNumber)}-v4-${rowId}-clothing" value="${escapeHtml(row.clothing || '')}" class="${inputClass}" placeholder="의상">
                <input id="planner-${escapeHtml(imageNumber)}-v4-${rowId}-expression" value="${escapeHtml(row.expression || '')}" class="${inputClass}" placeholder="표정">
                <input id="planner-${escapeHtml(imageNumber)}-v4-${rowId}-action" value="${escapeHtml(row.action || '')}" class="${inputClass}" placeholder="행위">
                <input id="planner-${escapeHtml(imageNumber)}-v4-${rowId}-negative" value="${escapeHtml(row.negative || '')}" class="${inputClass} md:col-span-2" placeholder="부정 프롬프트">
            </div>
        </div>
    `;
}

export function renderPlannerV4PromptSection(item) {
    const rows = getPlannerV4PromptRows(item);
    const isAtLimit = rows.length >= MAX_V4_PROMPT_CHARACTERS;
    return `
        <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <div class="flex items-center justify-between gap-2 mb-2">
                <div>
                    <p class="text-[10px] font-bold text-gray-500 dark:text-gray-400">V4 Prompt</p>
                    <p class="text-[10px] text-gray-400 dark:text-gray-500">필요할 때 캐릭터를 추가해 v4_prompt char_captions로 전달합니다.</p>
                </div>
                <button type="button" onclick="window.addPlannerV4Prompt('${escapeJsString(item.imageNumber)}')" ${isAtLimit ? 'disabled' : ''} class="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-[10px] font-bold text-gray-700 dark:text-gray-200 hover:border-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed">
                    <i data-lucide="user-plus" class="w-3.5 h-3.5"></i> 캐릭터 추가
                </button>
            </div>
            <div id="planner-${escapeHtml(item.imageNumber)}-v4-rows" class="space-y-2">
                ${rows.map((row, index) => renderPlannerV4PromptRow(item.imageNumber, row, index)).join('')}
            </div>
        </div>
    `;
}

export function renderPlannerReferencePicker(target, label, key) {
    const inputId = `planner-setting-${target}-key`;
    const fileId = `planner-setting-${target}-file`;
    return `
        <div>
            <span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">${label}</span>
            <div class="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-3"
                ondragover="event.preventDefault(); this.classList.add('border-indigo-400')"
                ondragleave="this.classList.remove('border-indigo-400')"
                ondrop="window.handlePlannerReferenceDrop(event, '${target}')">
                <input id="${fileId}" type="file" accept="image/*" class="hidden" onchange="window.handlePlannerReferenceFileInput(event, '${target}')">
                <div class="flex flex-col sm:flex-row sm:items-center gap-2">
                    <input id="${inputId}" value="${escapeHtml(key || '')}" class="flex-1 min-w-0 p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100" placeholder="이미지를 드롭하거나 선택하세요">
                    <button type="button" onclick="document.getElementById('${fileId}')?.click()" class="px-2.5 py-2 rounded-md border border-gray-200 dark:border-gray-700 text-[10px] font-bold text-gray-700 dark:text-gray-200 hover:border-indigo-400">업로드</button>
                    <button type="button" onclick="window.openPlannerReferenceLibrary('${target}')" class="px-2.5 py-2 rounded-md border border-gray-200 dark:border-gray-700 text-[10px] font-bold text-gray-700 dark:text-gray-200 hover:border-indigo-400">보관함</button>
                </div>
                <p class="mt-1 text-[10px] text-gray-400 dark:text-gray-500">로컬 이미지는 _planner_temp_image/references/에 저장됩니다.</p>
            </div>
        </div>
    `;
}

export function renderPlannerGenerationFields(item) {
    const generation = item.generation || {};
    const id = `planner-${item.imageNumber}`;

    return `
        <div class="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                ${renderPlannerSelect(`${id}-res`, '해상도', generation.res || '832x1216', PLANNER_RESOLUTION_OPTIONS)}
            </div>
        </div>
        ${renderPlannerV4PromptSection(item)}
    `;
}

function getPlannerBasePromptSettings() {
    if (window.readCraftBasePromptSettings) return window.readCraftBasePromptSettings();
    return {
        qualityTags: DEFAULT_PLANNER_QUALITY_TAGS,
        defaultNegativePrompt: '',
        useQualityTags: true,
        useDefaultNegativePrompt: true
    };
}

function renderPlannerBasePromptSettings() {
    const settings = getPlannerBasePromptSettings();
    return `
        <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-3 space-y-3">
            <div>
                <p class="text-[11px] font-bold text-gray-700 dark:text-gray-200">기본 생성 태그</p>
                <p class="mt-1 text-[10px] text-gray-400 dark:text-gray-500">이미지 생성 패널과 동일한 공용 태그 저장소를 사용합니다.</p>
            </div>
            <div>
                <div class="flex items-center justify-between gap-2 mb-1.5">
                    <label for="planner-setting-quality-tags" class="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Quality Tags</label>
                    <label class="inline-flex items-center gap-1.5 text-[11px] font-bold text-gray-600 dark:text-gray-300 select-none cursor-pointer">
                        <input id="planner-setting-use-quality-tags" type="checkbox" class="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" ${settings.useQualityTags ? 'checked' : ''}>
                        사용함
                    </label>
                </div>
                <textarea id="planner-setting-quality-tags" rows="2" class="w-full p-2.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="masterpiece, best quality, very aesthetic, no text">${escapeHtml(settings.qualityTags || '')}</textarea>
            </div>
            <div>
                <div class="flex items-center justify-between gap-2 mb-1.5">
                    <label for="planner-setting-default-negative" class="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Default Negative Prompt</label>
                    <label class="inline-flex items-center gap-1.5 text-[11px] font-bold text-gray-600 dark:text-gray-300 select-none cursor-pointer">
                        <input id="planner-setting-use-default-negative" type="checkbox" class="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" ${settings.useDefaultNegativePrompt ? 'checked' : ''}>
                        사용함
                    </label>
                </div>
                <textarea id="planner-setting-default-negative" rows="3" class="w-full p-2.5 text-xs rounded-lg border border-red-200 dark:border-red-900 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-400" placeholder="기본으로 제외할 태그">${escapeHtml(settings.defaultNegativePrompt || '')}</textarea>
            </div>
        </div>
    `;
}

export function renderPlannerSettingsModal(settings) {
    return `
        <div id="planner-settings-modal" class="fixed inset-0 z-50 hidden bg-black/60 backdrop-blur-sm items-center justify-center p-4" onclick="window.closePlannerSettingsModal(event)">
            <div class="w-full max-w-2xl rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden" onclick="event.stopPropagation()">
                <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <h3 class="text-sm font-bold text-gray-900 dark:text-white">플래너 공통 설정</h3>
                    <button type="button" onclick="window.closePlannerSettingsModal()" class="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
                        <i data-lucide="x" class="w-4 h-4"></i>
                    </button>
                </div>
                <div class="p-4 space-y-3 max-h-[76vh] overflow-y-auto">
                    ${renderPlannerSelect('planner-setting-model', 'Model', settings.model, PLANNER_MODEL_OPTIONS)}
                    ${renderPlannerNumberInput('planner-setting-steps', 'Steps', settings.steps, 'type="number" min="1" max="50"')}
                    ${renderPlannerNumberInput('planner-setting-scale', 'CFG Scale', settings.scale, 'type="number" min="1" max="10" step="0.1"')}
                    ${renderPlannerSelect('planner-setting-sampler', 'Sampler', settings.sampler, PLANNER_SAMPLER_OPTIONS)}
                    <div class="flex flex-wrap gap-3">
                        ${renderPlannerCheckbox('planner-setting-sm', 'SMEA', settings.sm)}
                        ${renderPlannerCheckbox('planner-setting-sm-dyn', 'DYN', settings.sm_dyn)}
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        ${renderPlannerNumberInput('planner-setting-vibe-strength', 'Vibe Strength', settings.vibeStrength, 'type="number" min="0" max="1" step="0.1"')}
                        ${renderPlannerNumberInput('planner-setting-vibe-info', 'Vibe Info', settings.vibeInfo, 'type="number" min="0" max="1" step="0.1"')}
                        ${renderPlannerNumberInput('planner-setting-precise-strength', 'Reference Strength', settings.preciseStrength, 'type="number" min="0" max="1" step="0.1"')}
                        ${renderPlannerNumberInput('planner-setting-precise-fidelity', 'Reference Fidelity', settings.preciseFidelity, 'type="number" min="0" max="1" step="0.1"')}
                    </div>
                    ${renderPlannerSelect('planner-setting-precise-type', 'Reference 타입', settings.preciseType, [
                        ['character&style', '캐릭터+그림체'],
                        ['character', '캐릭터'],
                        ['style', '그림체']
                    ])}
                    ${renderPlannerReferencePicker('vibe', 'Vibe 이미지', settings.vibeImageKey)}
                    ${renderPlannerReferencePicker('precise', 'Reference 이미지', settings.preciseImageKey)}
                    ${renderPlannerBasePromptSettings()}
                    <p id="planner-settings-status" class="min-h-4 text-[11px] text-gray-400 dark:text-gray-500"></p>
                </div>
                <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
                    <button type="button" onclick="window.closePlannerSettingsModal()" class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200">취소</button>
                    <button type="button" onclick="window.savePlannerSettingsFromModal()" class="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700">저장</button>
                </div>
            </div>
        </div>
    `;
}

// TODO(planner): 각 플랜별 결과 확인 전용 화면은 별도 레이아웃 검토 후 구현한다.

export function renderPlannerImages(item) {
    if (!Array.isArray(item.images) || !item.images.length) {
        return '<div class="text-[11px] text-gray-400 dark:text-gray-500 py-3">아직 생성된 임시 이미지가 없습니다.</div>';
    }

    return `
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
            ${item.images.map(key => {
                const selected = item.selectedImage === key;
                return `
                    <div class="relative aspect-square rounded-md overflow-hidden border ${selected ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700'} bg-gray-100 dark:bg-gray-900">
                        <button type="button" onclick="window.selectPlannerImage('${escapeJsString(key)}')" class="absolute inset-0">
                            <img src="${escapeHtml(getAssetUrl(key))}?t=${Date.now()}" alt="" class="w-full h-full object-cover" loading="lazy">
                        </button>
                        ${selected ? '<span class="absolute left-1 top-1 px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-bold">선택됨</span>' : ''}
                        <button type="button" onclick="window.deletePlannerImage('${escapeJsString(key)}')" class="absolute right-1 top-1 p-1 rounded bg-black/60 text-white hover:bg-red-600 transition" title="임시 이미지 삭제" aria-label="임시 이미지 삭제">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

export function getPlannerItemBySituationId(meta, situationId) {
    const decodedId = decodeURIComponent(situationId || '');
    return meta?.items?.find(item => item.situationId === decodedId) || null;
}

export function renderPlannerResultList(meta) {
    if (!meta?.items?.length) {
        return renderEmptyState('실행 화면에서 이미지를 생성하면 결과가 표시됩니다.');
    }

    return `
        <div class="space-y-2">
            ${meta.items.map(item => {
                const generatedCount = Array.isArray(item.images) ? item.images.length : 0;
                const selected = !!item.selectedImage;
                return `
                    <div role="button" tabindex="0" onclick="window.openPlannerResultModal('${escapeJsString(item.situationId)}', '${escapeJsString(meta?.characterId || '')}')" onkeydown="if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.openPlannerResultModal('${escapeJsString(item.situationId)}', '${escapeJsString(meta?.characterId || '')}'); }" class="w-full cursor-pointer rounded-lg border ${selected ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/60 dark:bg-indigo-950/20' : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30'} p-3 text-left hover:border-indigo-400 transition">
                        <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
                            <div class="min-w-0">
                                <p class="text-xs font-bold text-gray-900 dark:text-white truncate">${escapeHtml(item.situationName || item.situationId)}</p>
                                <p class="mt-1 text-[10px] text-gray-400 dark:text-gray-500 truncate">${escapeHtml(item.imageNumber)}.webp · ${selected ? '선택됨' : '미선택'}</p>
                            </div>
                            <div class="flex items-center gap-2 flex-shrink-0">
                                <span class="px-2 py-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[10px] font-bold text-gray-600 dark:text-gray-300">목표 ${escapeHtml(clampPlannerImageCount(item.count))}</span>
                                <span class="px-2 py-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[10px] font-bold text-gray-600 dark:text-gray-300">생성 ${generatedCount}</span>
                                <button type="button" onclick="event.stopPropagation(); window.deletePlannerItem('${escapeJsString(item.situationId)}')" class="inline-flex p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition" title="플랜 삭제" aria-label="플랜 삭제">
                                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

export function renderPlannerResultModal(meta) {
    const item = getPlannerItemBySituationId(meta, window.PLANNER_RESULT_MODAL_SITUATION_ID);
    if (!item) return '';

    const images = Array.isArray(item.images) ? item.images : [];
    const confirmBlocked = window.PROJECT_PLANNER_CONFIRMING || isPlannerConfirmBlocked(meta, item);
    return `
        <div id="planner-result-modal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div class="w-full max-w-5xl max-h-[88vh] rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden flex flex-col">
                <div class="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <div class="min-w-0">
                        <h3 class="text-sm font-bold text-gray-900 dark:text-white truncate">${escapeHtml(item.situationName || item.situationId)}</h3>
                        <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">목표 ${escapeHtml(clampPlannerImageCount(item.count))}장 · 생성 ${images.length}장 · ${item.selectedImage ? '선택됨' : '미선택'}</p>
                    </div>
                    <button type="button" onclick="window.closePlannerResultModal()" class="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition" title="닫기" aria-label="닫기">
                        <i data-lucide="x" class="w-5 h-5"></i>
                    </button>
                </div>
                <div class="flex-1 min-h-0 overflow-y-auto p-4">
                    ${images.length ? `
                        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            ${images.map(key => {
                                const selected = item.selectedImage === key;
                                return `
                                    <button type="button" data-planner-image-key="${escapeHtml(key)}" onclick="window.openPlannerImagePreview('${escapeJsString(key)}')" class="relative aspect-square rounded-lg overflow-hidden border ${selected ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-gray-200 dark:border-gray-700'} bg-gray-100 dark:bg-gray-800 hover:border-indigo-400 transition">
                                        <img src="${escapeHtml(getAssetUrl(key))}?t=${Date.now()}" alt="" class="w-full h-full object-cover" loading="lazy">
                                        ${selected ? '<span data-planner-selected-badge class="absolute left-2 top-2 px-2 py-1 rounded bg-indigo-600 text-white text-[10px] font-bold">선택됨</span>' : ''}
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    ` : renderEmptyState('아직 생성된 이미지가 없습니다.')}
                </div>
                <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3">
                    <p id="planner-result-selected-label" class="text-[11px] text-gray-500 dark:text-gray-400 truncate">${item.selectedImage ? `선택 이미지: ${getFileNameFromKey(item.selectedImage)}` : '이미지를 클릭해 선택하세요.'}</p>
                    <div class="flex items-center gap-2">
                        <button type="button" onclick="window.closePlannerResultModal()" class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200">닫기</button>
                        <button type="button" onclick="window.startPlannerResultGeneration('${escapeJsString(item.situationId)}')" class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200 hover:border-indigo-400">다시 생성</button>
                        <button id="planner-result-confirm-button" type="button" onclick="window.confirmPlannerSelection('${escapeJsString(item.situationId)}', this)" ${item.selectedImage && !confirmBlocked ? '' : 'disabled'} class="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">최종 선택 완료</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function renderPlannerImagePreviewModal() {
    const key = window.PLANNER_IMAGE_PREVIEW_KEY;
    if (!key) return '';

    return `
        <div id="planner-image-preview-modal" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onclick="window.closePlannerImagePreview(event)">
            <div class="w-full max-w-4xl max-h-[90vh] rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden flex flex-col" onclick="event.stopPropagation()">
                <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <h3 class="text-sm font-bold text-gray-900 dark:text-white truncate">${escapeHtml(getFileNameFromKey(key))}</h3>
                    <button type="button" onclick="window.closePlannerImagePreview()" class="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition" title="닫기" aria-label="닫기">
                        <i data-lucide="x" class="w-5 h-5"></i>
                    </button>
                </div>
                <div class="flex-1 min-h-0 bg-gray-100 dark:bg-gray-950 flex items-center justify-center p-4">
                    <img src="${escapeHtml(getAssetUrl(key))}?t=${Date.now()}" alt="" class="max-w-full max-h-[68vh] object-contain rounded-lg shadow">
                </div>
                <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p class="text-xs font-bold text-gray-700 dark:text-gray-200">이 이미지를 선택하시겠습니까?</p>
                    <div class="flex items-center gap-2 justify-end">
                        <button type="button" onclick="window.closePlannerImagePreview()" class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200">취소</button>
                        <button type="button" onclick="window.selectPlannerImageFromPreview('${escapeJsString(key)}')" class="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700">선택</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export function renderPlannerRunConfirmModal() {
    if (!window.PROJECT_PLANNER_RUN_CONFIRM) return '';
    return `
        <div id="planner-run-confirm-modal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onclick="window.closePlannerRunConfirmModal(event)">
            <div class="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden" onclick="event.stopPropagation()">
                <div class="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <div class="min-w-0">
                        <h3 class="text-sm font-bold text-gray-900 dark:text-white">기존 결과를 삭제하고 다시 생성</h3>
                        <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">기존에 생성된 이미지를 삭제하고 처음부터 다시 생성합니다.</p>
                    </div>
                    <button type="button" onclick="window.closePlannerRunConfirmModal()" class="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition" title="닫기" aria-label="닫기">
                        <i data-lucide="x" class="w-5 h-5"></i>
                    </button>
                </div>
                <div class="px-4 py-4">
                    <p class="text-xs leading-5 text-gray-600 dark:text-gray-300">삭제된 후보 이미지는 되돌릴 수 없습니다. 계속 진행하시겠습니까?</p>
                </div>
                <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
                    <button type="button" onclick="window.closePlannerRunConfirmModal()" class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200">취소</button>
                    <button type="button" onclick="window.confirmPlannerRunStart()" class="px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700">삭제 후 실행</button>
                </div>
            </div>
        </div>
    `;
}

export function ensurePlannerOverlayRoot(id) {
    let root = document.getElementById(id);
    if (!root) {
        root = document.createElement('div');
        root.id = id;
        document.body.appendChild(root);
    }
    return root;
}

export function renderPlannerResultOverlay() {
    const root = ensurePlannerOverlayRoot('planner-result-overlay-root');
    root.innerHTML = renderPlannerResultModal(getPlannerResultModalMeta());
    if (window.lucide) lucide.createIcons();
}

export function renderPlannerPreviewOverlay() {
    const root = ensurePlannerOverlayRoot('planner-preview-overlay-root');
    root.innerHTML = renderPlannerImagePreviewModal();
    if (window.lucide) lucide.createIcons();
}

export function renderPlannerRunConfirmOverlay() {
    const root = ensurePlannerOverlayRoot('planner-run-confirm-overlay-root');
    root.innerHTML = renderPlannerRunConfirmModal();
    if (window.lucide) lucide.createIcons();
}

export function renderPlannerSituationPlanOverlay() {
    const root = ensurePlannerOverlayRoot('planner-situation-plan-overlay-root');
    const project = getActiveProject();
    const situation = getSituationById(project, window.PLANNER_PLAN_MODAL_SITUATION_ID);
    const character = getCharacterById(project, getSelectedPlannerCharacterId(project));
    root.innerHTML = renderPlannerSituationPlanModal(project, situation, character, window.PROJECT_PLANNER_META || null);
    document.getElementById('planner-plan-character-variant')?.addEventListener('change', () => window.updatePlannerPlanModalDefaults?.('character'));
    document.querySelectorAll('[data-planner-plan-situation-variant]').forEach(input => {
        input.addEventListener('change', () => window.updatePlannerPlanModalDefaults?.('situation'));
    });
    document.getElementById('planner-plan-background-variant')?.addEventListener('change', () => window.updatePlannerPlanModalDefaults?.('background'));
    if (window.lucide) lucide.createIcons();
    if (window.refreshNaiPromptWeightPreviews) window.refreshNaiPromptWeightPreviews();
}

export function updatePlannerPlanModalDefaults(scope = 'all') {
    const project = getActiveProject();
    const situation = getSituationById(project, window.PLANNER_PLAN_MODAL_SITUATION_ID);
    const character = getCharacterById(project, getSelectedPlannerCharacterId(project));
    if (!project || !situation || !character) return;

    const characterVariants = normalizeCharacterPromptVariants(character.meta || {});
    const situationVariants = normalizeSituationPromptVariants(situation);
    const characterVariantId = document.getElementById('planner-plan-character-variant')?.value || characterVariants[0]?.id || 'default';
    const characterVariant = characterVariants.find(variant => variant.id === characterVariantId) || characterVariants[0];
    const selectedSituationVariantIds = Array.from(document.querySelectorAll('[data-planner-plan-situation-variant]:checked')).map(input => input.value);
    const situationVariant = situationVariants.find(variant => selectedSituationVariantIds.includes(variant.id)) || situationVariants[0];
    const characterParts = characterVariant?.parts || {};
    const situationPrompt = situationVariant?.prompt || {};
    const isNsfw = getSituationRating(situation) === 'nsfw';

    const setValue = (id, value) => {
        const input = document.getElementById(id);
        if (input) input.value = value || '';
    };

    if (scope === 'all' || scope === 'character') {
        setValue('planner-plan-character', characterParts.character || characterVariant?.prompt || '');
        setValue('planner-plan-clothing', isNsfw ? (situationPrompt.clothing || '') : (characterParts.clothing || situationPrompt.clothing || ''));
    }
    if (scope === 'all' || scope === 'situation') {
        setValue('planner-plan-composition', situationPrompt.composition || '');
        if (isNsfw) setValue('planner-plan-clothing', situationPrompt.clothing || '');
        setValue('planner-plan-expression', situationPrompt.expression || '');
        setValue('planner-plan-action', situationPrompt.action || '');
    }
    if (scope === 'all' || scope === 'situation' || scope === 'background') {
        const selectedBackgroundId = document.getElementById('planner-plan-background-variant')?.value || '';
        setValue('planner-plan-background', getPlannerBackgroundPromptById(project, selectedBackgroundId).prompt || situationPrompt.background || '');
    }
    const styleInput = document.getElementById('planner-plan-style');
    if (styleInput && !styleInput.value.trim()) styleInput.value = window.PROJECT_PLANNER_PROJECT_STYLE || '';
    setValue('planner-plan-negative', combinePromptParts(characterParts.negative, situationPrompt.negative));
    if (window.refreshNaiPromptWeightPreviews) window.refreshNaiPromptWeightPreviews();
}

export function syncPlannerResultModalSelection(item, selectedKey = item?.selectedImage || '') {
    const modal = document.getElementById('planner-result-modal');
    if (!modal || !item) return;

    modal.querySelectorAll('[data-planner-image-key]').forEach(button => {
        const imageKey = button.getAttribute('data-planner-image-key') || button.dataset.plannerImageKey || '';
        const selected = imageKey === selectedKey;
        button.classList.toggle('border-indigo-500', selected);
        button.classList.toggle('ring-2', selected);
        button.classList.toggle('ring-indigo-500', selected);
        button.classList.toggle('border-gray-200', !selected);
        button.classList.toggle('dark:border-gray-700', !selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');

        let badge = button.querySelector('[data-planner-selected-badge]');
        if (selected && !badge) {
            badge = document.createElement('span');
            badge.dataset.plannerSelectedBadge = 'true';
            badge.className = 'absolute left-2 top-2 px-2 py-1 rounded bg-indigo-600 text-white text-[10px] font-bold';
            badge.textContent = '선택됨';
            button.appendChild(badge);
        } else if (!selected && badge) {
            badge.remove();
        }
    });

    const label = document.getElementById('planner-result-selected-label');
    if (label) label.textContent = selectedKey ? `선택 이미지: ${getFileNameFromKey(selectedKey)}` : '이미지를 클릭해 선택하세요.';
    const confirmButton = document.getElementById('planner-result-confirm-button');
    if (confirmButton) confirmButton.disabled = !selectedKey || window.PROJECT_PLANNER_CONFIRMING || isPlannerConfirmBlocked(getPlannerResultModalMeta() || {}, item);
}

export function renderPlannerProgressPanel(meta) {
    if (!meta?.items?.length || !['queued', 'running', 'cancel_requested', 'paused'].includes(meta.status)) return '';

    const activeIds = Array.isArray(meta.runningSituationIds) && meta.runningSituationIds.length
        ? new Set(meta.runningSituationIds)
        : null;
    const progressItems = activeIds ? meta.items.filter(item => activeIds.has(item.situationId)) : meta.items;
    const total = progressItems.length;
    const doneCount = progressItems.filter(item => ['done', 'completed', 'confirmed'].includes(item.status)).length;
    const failedCount = progressItems.reduce((sum, item) => sum + getPlannerItemFailedCount(item), 0);
    const runningItem = progressItems.find(item => ['queued', 'running', 'cancel_requested'].includes(item.status));
    const runningIndex = runningItem ? progressItems.findIndex(item => item.situationId === runningItem.situationId) + 1 : doneCount + failedCount + 1;
    const progressCount = Math.min(total, doneCount + failedCount);
    const percent = total ? Math.round((progressCount / total) * 100) : 0;
    const eta = meta.backgroundStatus?.eta || meta.eta || null;

    return `
        <div class="mb-4 rounded-xl border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/80 dark:bg-indigo-950/30 p-4">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="min-w-0">
                    <p class="inline-flex items-center gap-2 text-sm font-bold text-indigo-800 dark:text-indigo-200">
                        <i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i>
                        ${meta.status === 'queued' ? '생성 대기 중' : meta.status === 'cancel_requested' ? '취소 요청 중' : '생성 진행 중'}
                    </p>
                    <p class="mt-1 text-xs text-indigo-700/80 dark:text-indigo-300/80 truncate">
                        ${runningItem ? `${escapeHtml(runningItem.imageNumber)}.webp / ${escapeHtml(runningItem.situationName || runningItem.situationId)} · ${escapeHtml(getPlannerStageLabel(runningItem.stage) || getPlannerStatusLabel(runningItem.status))}` : '다음 플랜을 준비 중입니다.'}
                    </p>
                </div>
                <div class="flex items-center gap-2 text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                    <span>${Math.min(runningIndex, total)} / ${total}</span>
                    <span>완료 ${doneCount}</span>
                    <span>실패 ${failedCount}</span>
                </div>
            </div>
            ${eta ? `<div class="mt-3 flex flex-wrap gap-2">${renderPlannerEtaBadge(eta)}</div>` : ''}
            <div class="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white dark:bg-gray-900 border border-indigo-100 dark:border-indigo-900/70">
                <div class="h-full rounded-full bg-indigo-600 transition-all duration-500" style="width: ${percent}%"></div>
            </div>
            <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                ${progressItems.map(item => `
                    <div class="rounded-lg border ${['queued', 'running', 'cancel_requested'].includes(item.status) ? 'border-indigo-400 bg-white dark:bg-indigo-950/50' : 'border-indigo-100 dark:border-indigo-900/50 bg-white/70 dark:bg-gray-900/50'} px-3 py-2">
                        <div class="flex items-center justify-between gap-2">
                            <p class="min-w-0 truncate text-[11px] font-bold text-gray-800 dark:text-gray-100">${escapeHtml(item.situationName || item.situationId)}</p>
                            <span class="flex-shrink-0 text-[10px] font-bold ${['queued', 'running', 'cancel_requested'].includes(item.status) ? 'text-indigo-600 dark:text-indigo-300' : 'text-gray-500 dark:text-gray-400'}">${escapeHtml(getPlannerStatusLabel(item.status || 'pending'))}</span>
                        </div>
                        <p class="mt-1 text-[10px] text-gray-500 dark:text-gray-400">후보 ${item.images?.length || 0}장 / 목표 ${escapeHtml(clampPlannerImageCount(item.count))}장</p>
                        ${item.stage ? `<p class="mt-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-300">${escapeHtml(getPlannerStageLabel(item.stage))}</p>` : ''}
                        ${item.errorMessage ? `<p class="mt-1 text-[10px] text-red-500 truncate">${escapeHtml(item.errorMessage)}</p>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderPlannerQueueProgressPanel(queueMetas = []) {
    const summary = getPlannerQueueSummary(queueMetas);
    if (!summary.totalItems) return '';
    const percent = summary.totalImages ? Math.round((summary.completedImages / summary.totalImages) * 100) : 0;
    const activeEntry = summary.entries.find(entry => isPlannerActiveStatus(entry.item.status) || isPlannerActiveStatus(entry.meta.status));
    const statusText = summary.active ? '생성 진행 중' : summary.paused ? '일시정지됨' : '대기열';
    const eta = getPlannerQueueEta(queueMetas);
    return `
        <div class="mb-4 rounded-lg border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/80 dark:bg-indigo-950/30 p-4">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div class="min-w-0">
                    <p class="inline-flex items-center gap-2 text-sm font-bold text-indigo-800 dark:text-indigo-200">
                        <i data-lucide="${summary.paused ? 'pause' : 'loader-2'}" class="w-4 h-4 ${summary.active ? 'animate-spin' : ''}"></i>
                        ${statusText}
                    </p>
                    <p class="mt-1 text-xs text-indigo-700/80 dark:text-indigo-300/80 truncate">
                        ${activeEntry ? `${escapeHtml(activeEntry.character.name || activeEntry.character.folderName || activeEntry.character.id)} / ${escapeHtml(activeEntry.item.imageNumber)}.webp / ${escapeHtml(activeEntry.item.situationName || activeEntry.item.situationId)} · ${escapeHtml(getPlannerStageLabel(activeEntry.item.stage) || getPlannerStatusLabel(activeEntry.item.status))}` : '캐릭터별 대기열을 확인할 수 있습니다.'}
                    </p>
                </div>
                <div class="flex items-center gap-2 text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                    <span>항목 ${summary.totalItems}</span>
                    <span>결과 ${summary.completedImages} / ${summary.totalImages}</span>
                    <span>실패 ${summary.failed}</span>
                </div>
            </div>
            ${eta ? `<div class="mt-3 flex flex-wrap gap-2">${renderPlannerEtaBadge(eta)}</div>` : ''}
            <div class="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white dark:bg-gray-900 border border-indigo-100 dark:border-indigo-900/70">
                <div class="h-full rounded-full bg-indigo-600 transition-all duration-500" style="width: ${percent}%"></div>
            </div>
        </div>
    `;
}

function renderPlannerRunControls(summary) {
    const pendingAction = window.PROJECT_PLANNER_PENDING_ACTION?.action || '';
    const isPending = !!pendingAction;
    const pendingAttrs = isPending ? 'disabled aria-busy="true"' : '';
    const pendingClass = 'disabled:opacity-60 disabled:cursor-wait';
    const canStart = !summary.active && !summary.paused;
    return `
        ${canStart ? `
            <button type="button" onclick="window.openPlannerRunConfirmModal()" ${pendingAttrs} class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 ${pendingClass}">
                <i data-lucide="play" class="w-4 h-4"></i> 실행 시작
            </button>
        ` : ''}
        ${summary.active ? `
            <button type="button" onclick="window.pausePlannerGeneration()" ${pendingAttrs} class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300 text-xs font-bold hover:bg-amber-50 dark:hover:bg-amber-900/20 ${pendingClass}">
                <i data-lucide="pause" class="w-4 h-4"></i> 일시정지
            </button>
        ` : ''}
        ${summary.paused ? `
            <button type="button" onclick="window.resumePlannerGeneration()" ${pendingAttrs} class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 ${pendingClass}">
                <i data-lucide="rotate-cw" class="w-4 h-4"></i> 재개하기
            </button>
        ` : ''}
        ${(summary.active || summary.paused) ? `
            <button type="button" onclick="window.cancelPlannerGeneration()" ${pendingAttrs} class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-900/20 ${pendingClass}">
                <i data-lucide="square" class="w-4 h-4"></i> 취소
            </button>
        ` : ''}
    `;
}

function renderPlannerCharacterQueue(queueMetas = []) {
    if (!queueMetas.length) return renderEmptyState('플랜짜기 화면에서 플랜을 저장하면 실행 목록이 표시됩니다.');
    return `
        <div class="space-y-3">
            ${queueMetas.map(entry => {
                const characterName = entry.character.name || entry.character.alias || entry.character.folderName || entry.character.id;
                const items = entry.meta.items || [];
                const completed = items.reduce((sum, item) => sum + (Array.isArray(item.images) ? item.images.length : 0), 0);
                const total = items.reduce((sum, item) => sum + clampPlannerImageCount(item.count), 0);
                return `
                    <section class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3">
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                            <div class="min-w-0">
                                <p class="text-xs font-bold text-gray-900 dark:text-white truncate">${escapeHtml(characterName)}</p>
                                <p class="mt-1 text-[10px] text-gray-500 dark:text-gray-400">${escapeHtml(getPlannerStatusLabel(entry.meta.status || 'draft'))} · 결과 ${completed} / ${total}</p>
                            </div>
                            <span class="inline-flex w-fit items-center rounded-full border border-gray-200 dark:border-gray-700 px-2 py-1 text-[10px] font-bold text-gray-600 dark:text-gray-300">${items.length}개 플랜</span>
                        </div>
                        <div class="grid grid-cols-1 lg:grid-cols-2 gap-2">
                            ${items.map(item => `
                                <div class="rounded-md border ${isPlannerActiveStatus(item.status) || item.status === 'paused' ? 'border-indigo-300 dark:border-indigo-800 bg-white dark:bg-indigo-950/30' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/70'} p-3">
                                    <div class="flex items-start justify-between gap-2">
                                        <div class="min-w-0">
                                            <p class="text-[11px] font-bold text-gray-900 dark:text-white truncate">${escapeHtml(item.imageNumber)}.webp / ${escapeHtml(item.situationName || item.situationId)}</p>
                                            <p class="mt-1 text-[10px] text-gray-500 dark:text-gray-400">${escapeHtml(getPlannerStatusLabel(item.status || 'pending'))} · 후보 ${Array.isArray(item.images) ? item.images.length : 0}장 / 목표 ${escapeHtml(clampPlannerImageCount(item.count))}장</p>
                                        </div>
                                        <span class="flex-shrink-0 text-[10px] font-bold text-indigo-600 dark:text-indigo-300">${escapeHtml(getPlannerStageLabel(item.stage))}</span>
                                    </div>
                                    ${item.errorMessage ? `<p class="mt-2 truncate text-[10px] text-red-500">${escapeHtml(item.errorMessage)}</p>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </section>
                `;
            }).join('')}
        </div>
    `;
}

export function renderPlannerSituationGrid(project, situations, character, meta, mode = 'plan') {
    if (!character) return renderEmptyState('플래너에 사용할 캐릭터를 선택하세요.');
    if (!situations.length) return renderEmptyState('먼저 상황을 추가하세요.');

    return `
        <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            ${situations.map((situation, index) => {
                const image = getPlannerSituationImage(character, situation, index);
                const item = getPlannerSituationItem(meta, situation.id);
                const generatedCount = Array.isArray(item?.images) ? item.images.length : 0;
                const complete = !!image;
                const selected = !!item?.selectedImage;
                const statusText = mode === 'result'
                    ? (selected ? '선택됨' : generatedCount ? `결과 ${generatedCount}` : '결과 없음')
                    : (complete ? '완료' : '미완료');
                const clickAction = mode === 'result'
                    ? (item ? `window.openPlannerResultModal('${escapeJsString(situation.id)}', '${escapeJsString(character.id || '')}')` : `window.setPlannerStatus('이 상황에 저장된 플랜 결과가 없습니다.')`)
                    : `window.openPlannerSituationPlanModal('${escapeJsString(situation.id)}')`;
                return `
                    <button type="button" onclick="${clickAction}" class="group min-h-[112px] rounded-lg border ${item ? 'border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'} p-3 text-left hover:border-indigo-400 transition">
                        <div class="flex items-start gap-3">
                            <span class="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100 dark:bg-gray-900 text-[11px] font-extrabold text-gray-500 dark:text-gray-400">
                                ${image ? `<img src="${escapeHtml(getAssetUrl(image.key))}?t=${image.uploaded ? new Date(image.uploaded).getTime() : Date.now()}" alt="" class="h-full w-full object-cover" loading="lazy">` : escapeHtml(getSituationImageNumber(project, situation))}
                            </span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-xs font-bold text-gray-900 dark:text-white">${escapeHtml(getSituationDisplayName(situation))}</span>
                                <span class="mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${complete || selected ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}">${escapeHtml(statusText)}</span>
                                ${item ? `<span class="mt-1 block truncate text-[10px] text-gray-500 dark:text-gray-400">플랜 ${escapeHtml(clampPlannerImageCount(item.count))}회 · ${escapeHtml(getPlannerStatusLabel(item.status || 'pending'))}</span>` : '<span class="mt-1 block text-[10px] text-gray-400 dark:text-gray-500">플랜 없음</span>'}
                            </span>
                        </div>
                    </button>
                `;
            }).join('')}
        </div>
    `;
}

export function renderPlannerSituationPlanModal(project, situation, character, meta) {
    if (!situation || !character) return '';
    const characterMeta = character.meta || {};
    const characterVariants = normalizeCharacterPromptVariants(characterMeta);
    const situationVariants = normalizeSituationPromptVariants(situation);
    const existingItem = getPlannerSituationItem(meta, situation.id);
    const selectedCharacterVariantId = existingItem?.characterPromptVariantId || characterMeta.activePromptVariantId || characterVariants[0]?.id || 'default';
    const selectedSituationVariantIds = Array.isArray(existingItem?.situationPromptVariantIds) && existingItem.situationPromptVariantIds.length
        ? existingItem.situationPromptVariantIds
        : situationVariants.map(variant => variant.id);
    const firstSituationVariant = situationVariants.find(variant => selectedSituationVariantIds.includes(variant.id)) || situationVariants[0];
    const selectedCharacterVariant = characterVariants.find(variant => variant.id === selectedCharacterVariantId) || characterVariants[0];
    const generation = existingItem?.generation || firstSituationVariant?.generation || {};
    const situationPrompt = firstSituationVariant?.prompt || {};
    const characterParts = selectedCharacterVariant?.parts || {};
    const projectStyle = window.PROJECT_PLANNER_PROJECT_STYLE || '';
    const isNsfw = getSituationRating(situation) === 'nsfw';
    const backgroundData = getPlannerBackgroundData(project);
    const activeBackground = getPlannerBackgroundPromptById(project, existingItem?.backgroundPromptId || backgroundData.activeBackgroundId);
    const defaultFields = {
        style: projectStyle,
        composition: situationPrompt.composition || '',
        character: characterParts.character || selectedCharacterVariant?.prompt || '',
        clothing: isNsfw ? (situationPrompt.clothing || '') : (characterParts.clothing || situationPrompt.clothing || ''),
        expression: situationPrompt.expression || '',
        action: situationPrompt.action || '',
        background: activeBackground.prompt || situationPrompt.background || '',
        negative: combinePromptParts(characterParts.negative, situationPrompt.negative)
    };
    const fields = {
        ...defaultFields,
        ...(existingItem?.generation?.fields || {})
    };
    if (!fields.style) fields.style = projectStyle;
    if (!fields.background) fields.background = defaultFields.background;
    if (!fields.negative) fields.negative = defaultFields.negative;
    const selectedBackgroundId = backgroundData.backgrounds.some(background => background.id === existingItem?.backgroundPromptId)
        ? existingItem.backgroundPromptId
        : activeBackground.id;
    const count = existingItem?.count === undefined
        ? PLANNER_DEFAULT_IMAGE_COUNT
        : clampPlannerImageCount(existingItem.count);

    return `
        <div id="planner-situation-plan-modal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onclick="window.closePlannerSituationPlanModal(event)">
            <div class="w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl flex flex-col" onclick="event.stopPropagation()">
                <div class="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <div class="min-w-0">
                        <h3 class="truncate text-sm font-bold text-gray-900 dark:text-white">${escapeHtml(getSituationDisplayName(situation))}</h3>
                        <p class="mt-1 text-[11px] text-gray-500 dark:text-gray-400">${escapeHtml(character.name || character.folderName)} · ${escapeHtml(getSituationImageNumber(project, situation))}.webp</p>
                    </div>
                    <button type="button" onclick="window.closePlannerSituationPlanModal()" class="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
                        <i data-lucide="x" class="w-5 h-5"></i>
                    </button>
                </div>
                <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                        ${renderPlannerSelect('planner-plan-character-variant', '의상 / 헤어스타일', selectedCharacterVariantId, characterVariants.map(variant => [variant.id, getPlannerPromptVariantName(variant)]))}
                        ${renderPlannerSelect('planner-plan-res', '해상도', generation.res || DEFAULT_PLANNER_RESOLUTION, PLANNER_RESOLUTION_OPTIONS)}
                        ${renderPlannerNumberInput('planner-plan-count', '생성 횟수', count, `type="number" min="${PLANNER_MIN_IMAGE_COUNT}" max="${PLANNER_MAX_IMAGE_COUNT}"`)}
                    </div>
                    <div>
                        <p class="mb-2 text-[10px] font-bold text-gray-500 dark:text-gray-400">적용할 구도</p>
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            ${situationVariants.map(variant => `
                                <label class="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 p-2 text-xs font-bold text-gray-700 dark:text-gray-200">
                                    <input type="checkbox" data-planner-plan-situation-variant value="${escapeHtml(variant.id)}" ${selectedSituationVariantIds.includes(variant.id) ? 'checked' : ''} class="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500">
                                    <span class="truncate">${escapeHtml(getPlannerPromptVariantName(variant))}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label class="block"><span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">그림체</span><textarea id="planner-plan-style" rows="2" class="w-full resize-y p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100">${escapeHtml(fields.style || '')}</textarea></label>
                        <label class="block"><span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">구도</span><textarea id="planner-plan-composition" rows="2" class="w-full resize-y p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100">${escapeHtml(fields.composition || '')}</textarea></label>
                        <label class="block"><span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">캐릭터</span><textarea id="planner-plan-character" rows="3" class="w-full resize-y p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100">${escapeHtml(fields.character || '')}</textarea></label>
                        <label class="block"><span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">의상</span><textarea id="planner-plan-clothing" rows="3" class="w-full resize-y p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100">${escapeHtml(fields.clothing || '')}</textarea></label>
                        <label class="block"><span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">표정</span><textarea id="planner-plan-expression" rows="2" class="w-full resize-y p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100">${escapeHtml(fields.expression || '')}</textarea></label>
                        <label class="block"><span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">행위</span><textarea id="planner-plan-action" rows="2" class="w-full resize-y p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100">${escapeHtml(fields.action || '')}</textarea></label>
                        <div class="block">
                            <span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">배경</span>
                            <select id="planner-plan-background-variant" class="mb-2 w-full p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100">
                                ${backgroundData.backgrounds.map(background => `<option value="${escapeHtml(background.id)}" ${background.id === selectedBackgroundId ? 'selected' : ''}>${escapeHtml(background.name)}</option>`).join('')}
                            </select>
                            <textarea id="planner-plan-background" rows="2" class="w-full resize-y p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100">${escapeHtml(fields.background || '')}</textarea>
                        </div>
                        <label class="block"><span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">부정 프롬프트</span><textarea id="planner-plan-negative" rows="2" class="w-full resize-y p-2 text-xs rounded-md border border-red-300 dark:border-red-800 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100">${escapeHtml(fields.negative || '')}</textarea></label>
                    </div>
                    <p id="planner-plan-modal-status" class="min-h-4 text-[11px] text-gray-400 dark:text-gray-500"></p>
                </div>
                <div class="flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                    ${existingItem ? `<button type="button" onclick="window.deletePlannerItemFromModal('${escapeJsString(situation.id)}')" class="mr-auto px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 text-xs font-bold text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20">플랜 삭제</button>` : ''}
                    <button type="button" onclick="window.closePlannerSituationPlanModal()" class="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200">닫기</button>
                    <button type="button" onclick="window.savePlannerSituationPlan()" class="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700">플랜 추가</button>
                </div>
            </div>
        </div>
    `;
}

export function renderPlannerPanel(project, situations) {
    const characters = getProjectItems(project, 'characters');
    const meta = window.PROJECT_PLANNER_META || null;
    const activeCharacter = getCharacterById(project, getSelectedPlannerCharacterId(project))
        || getCharacterById(project, meta?.characterId)
        || getCharacterById(project, meta?.characterPrefix)
        || getCharacterById(project, getCachedPlannerCharacterId(project))
        || characters[0];
    const activeCharacterName = activeCharacter ? (activeCharacter.name || activeCharacter.alias || activeCharacter.folderName || activeCharacter.id) : '선택된 캐릭터 없음';
    const view = window.PROJECT_PLANNER_VIEW || 'plan';
    const settings = normalizePlannerSettings(window.PROJECT_PLANNER_SETTINGS || {});
    const queueMetas = window.PROJECT_PLANNER_QUEUE_METAS?.length
        ? window.PROJECT_PLANNER_QUEUE_METAS
        : (meta?.items?.length ? [{ character: activeCharacter, meta }] : []);
    const queueSummary = getPlannerQueueSummary(queueMetas);
    const characterSelector = characters.length ? `
        <label class="block min-w-[180px] sm:min-w-[240px]">
            <span class="block mb-1 text-[10px] font-bold text-gray-500 dark:text-gray-400">대상 캐릭터</span>
            <select id="planner-character-select" onchange="window.cachePlannerCharacterSelection()" class="w-full p-2 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-gray-800 dark:text-gray-100">
                ${characters.map(character => `<option value="${escapeHtml(character.id)}" ${activeCharacter?.id === character.id ? 'selected' : ''}>${escapeHtml(character.name || character.folderName)}</option>`).join('')}
            </select>
        </label>
    ` : '';

    const modeButton = (mode, label, icon) => `
        <button type="button" onclick="window.setPlannerView('${mode}')" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition ${view === mode ? 'bg-indigo-600 text-white' : 'border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-indigo-400'}">
            <i data-lucide="${icon}" class="w-4 h-4"></i>
            ${label}
        </button>
    `;

    const planRows = meta?.items?.length ? `
        <div class="space-y-3 overflow-y-auto pr-1">
            ${meta.items.map(item => `
                <div class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3">
                    <div class="flex items-center justify-between gap-3 mb-3">
                        <div class="min-w-0">
                            <p class="text-xs font-bold text-gray-900 dark:text-white truncate">${escapeHtml(item.imageNumber)}.webp / ${escapeHtml(item.situationName || item.situationId)}</p>
                            <p class="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">${escapeHtml(getPlannerStatusLabel(item.status || 'pending'))} · 생성 ${escapeHtml(clampPlannerImageCount(item.count))}장</p>
                        </div>
                        <div class="flex items-center gap-2 flex-shrink-0">
                            <input id="planner-${escapeHtml(item.imageNumber)}-count" type="number" min="${PLANNER_MIN_IMAGE_COUNT}" max="${PLANNER_MAX_IMAGE_COUNT}" value="${escapeHtml(clampPlannerImageCount(item.count))}" class="w-16 p-1.5 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100">
                            <button type="button" onclick="window.deletePlannerItem('${escapeJsString(item.situationId)}')" class="p-1.5 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition" title="플랜 삭제" aria-label="플랜 삭제">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                        ${renderPlannerField(item, 'style', '그림체')}
                        ${renderPlannerField(item, 'composition', '구도', 1)}
                        ${renderPlannerField(item, 'character', '캐릭터')}
                        ${renderPlannerField(item, 'clothing', '의상')}
                        ${renderPlannerField(item, 'expression', '표정', 1)}
                        ${renderPlannerField(item, 'action', '행위', 1)}
                        ${renderPlannerField(item, 'background', '배경', 1)}
                        ${renderPlannerField(item, 'negative', '부정 프롬프트', 1)}
                    </div>
                    ${renderPlannerGenerationFields(item)}
                </div>
            `).join('')}
        </div>
    ` : '<div class="flex-1 flex items-center justify-center text-sm font-bold text-gray-500 dark:text-gray-400 text-center">캐릭터와 상황을 선택한 뒤 추가하기를 눌러 플랜 작성안을 만드세요.</div>';

    const planView = `
        <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
            <p class="text-[11px] font-bold text-gray-500 dark:text-gray-400">상황을 선택하면 해당 상황의 플랜을 구성합니다.</p>
            <div class="flex flex-wrap justify-end gap-2">
                <button type="button" onclick="window.createMissingPlannerPlans()" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-xs font-bold hover:border-indigo-400">
                    <i data-lucide="image-plus" class="w-4 h-4"></i> 누락 이미지 플랜 생성
                </button>
                <button type="button" onclick="window.savePlannerDraft()" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 text-xs font-bold hover:border-indigo-400">
                    <i data-lucide="save" class="w-4 h-4"></i> 플랜 저장하기
                </button>
                ${meta?.items?.length ? `
                    <button type="button" onclick="window.deleteAllPlannerItems()" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-900/20">
                        <i data-lucide="trash-2" class="w-4 h-4"></i> 전체 플랜 삭제
                    </button>
                ` : ''}
            </div>
        </div>
        ${!characters.length ? renderEmptyState('플랜을 작성하려면 먼저 캐릭터를 추가하세요.') : ''}
        ${!situations.length ? renderEmptyState('플랜을 작성하려면 먼저 상황을 추가하세요.') : ''}
        ${characters.length && situations.length ? renderPlannerSituationGrid(project, situations, activeCharacter, meta, 'plan') : ''}
    `;

    const runView = `
        <div class="flex items-center justify-between gap-3 mb-4">
            <div>
                <p class="text-xs font-bold text-gray-900 dark:text-white">저장된 플랜 실행</p>
                <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">${queueMetas.length}명 / ${queueSummary.totalItems}개 플랜 항목</p>
            </div>
            <div class="flex flex-wrap justify-end gap-2">
                ${renderPlannerRunControls(queueSummary)}
            </div>
        </div>
        <div class="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-3">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <p class="text-[11px] font-bold text-gray-700 dark:text-gray-200">실행 방식</p>
                    <p class="mt-1 text-[10px] text-gray-400 dark:text-gray-500">${window.PROJECT_PLANNER_GENERATION_MODE === 'background' ? '서버 작업으로 등록하고 상태를 조회합니다.' : '현재 브라우저에서 기존 방식으로 생성합니다.'}</p>
                </div>
                <div class="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1">
                    <button type="button" onclick="window.setPlannerGenerationMode('browser')" class="px-3 py-1.5 rounded-md text-[11px] font-bold ${window.PROJECT_PLANNER_GENERATION_MODE !== 'background' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}">브라우저</button>
                    <button type="button" onclick="window.setPlannerGenerationMode('background')" class="px-3 py-1.5 rounded-md text-[11px] font-bold ${window.PROJECT_PLANNER_GENERATION_MODE === 'background' ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}">백그라운드</button>
                </div>
            </div>
        </div>
        ${renderPlannerQueueProgressPanel(queueMetas)}
        ${renderPlannerCharacterQueue(queueMetas)}
    `;

    const resultView = `
        <div class="flex items-center justify-between gap-3 mb-4">
            <div>
                <p class="text-xs font-bold text-gray-900 dark:text-white">결과 확인</p>
                <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">현재 선택한 캐릭터의 상황별 결과를 확인하고 선택합니다.</p>
            </div>
        </div>
        ${renderPlannerSituationGrid(project, situations, activeCharacter, meta, 'result')}
    `;

    return `
        <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 h-full min-h-0 overflow-hidden flex flex-col">
            <div class="flex items-start justify-between gap-3 mb-4 flex-shrink-0">
                <div>
                    <h3 class="font-bold text-sm text-gray-900 dark:text-white">플래너 데모</h3>
                    <p id="planner-status" class="mt-1 min-h-4 text-[11px] text-gray-400 dark:text-gray-500">${escapeHtml(getPlannerStatusLabel(meta?.status))}</p>
                </div>
                <div class="flex flex-col sm:flex-row sm:items-end gap-2">
                    ${characterSelector || `<p class="text-[11px] font-bold text-gray-500 dark:text-gray-400">${escapeHtml(activeCharacterName)}</p>`}
                    <div class="flex items-center justify-end gap-1">
                        <button type="button" onclick="window.openPlannerSettingsModal()" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" title="플래너 설정">
                            <i data-lucide="settings" class="w-4 h-4"></i>
                        </button>
                        <button type="button" onclick="window.refreshPlannerPanel()" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700" title="새로고침">
                            <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>
            </div>
            <div class="flex flex-wrap gap-2 mb-4 flex-shrink-0">
                ${modeButton('plan', '플랜짜기', 'list-plus')}
                ${modeButton('run', '실행 화면', 'play')}
                ${modeButton('result', '결과 확인', 'images')}
            </div>
            <div data-planner-scroll="main" class="min-h-0 flex-1 overflow-y-auto pr-1">
                ${view === 'plan' ? planView : view === 'run' ? runView : resultView}
            </div>
            ${renderPlannerSettingsModal(settings)}
        </div>
    `;
}

export function renderPlannerSection(section, state = {}) {
    const project = getActiveProject();
    const situations = getProjectItems(project, 'situations');
    const scrollState = state.preserveScroll ? capturePlannerScrollState() : null;

    renderProjectShell(`
        ${renderSectionHeader(section.title)}
        <div class="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0">
            <section class="h-full min-h-0">
                ${state.loading ? renderEmptyState('플래너 데이터를 불러오는 중입니다.') : ''}
                ${state.error ? renderEmptyState(state.error) : ''}
                ${!state.loading && !state.error ? renderPlannerPanel(project, situations) : ''}
            </section>
        </div>
        ${renderProjectItemCreateModal()}
    `);
    restorePlannerScrollState(scrollState);
}

export function renderPlannerSectionByState(options = {}) {
    renderPlannerSection(PROJECT_SECTIONS.find(section => section.key === 'planner'), options);
}

export async function refreshPlannerPanel() {
    const project = getActiveProject();
    if (!project) return;
    const characterId = getSelectedPlannerCharacterId(project);
    window.PROJECT_PLANNER_SELECTED_CHARACTER_ID = characterId;
    setCachedPlannerCharacterId(project, characterId);
    const character = getCharacterById(project, characterId);
    const characters = getProjectItems(project, 'characters');
    const [meta, , projectStyle] = await Promise.all([
        loadPlannerMeta(project, characterId, { force: true }).catch(() => null),
        loadPlannerSettings(project, true).catch(() => normalizePlannerSettings()),
        loadProjectStylePrompt(project).catch(() => ''),
        loadProjectBackgroundPrompts(project).catch(() => normalizeProjectBackgroundPrompts()),
        character ? loadCharacterFiles(character).catch(() => []) : Promise.resolve([]),
        character ? loadCharacterMeta(character).catch(() => ({})) : Promise.resolve({})
    ]);
    window.PROJECT_PLANNER_META = meta;
    window.PROJECT_PLANNER_QUEUE_METAS = await loadPlannerQueueMetas(project, characters, { force: true }).catch(() => meta ? [{ character, meta }] : []);
    window.PROJECT_PLANNER_PROJECT_STYLE = projectStyle || '';
    let refreshedActiveStatus = false;
    if (window.PROJECT_PLANNER_GENERATION_MODE === 'background') {
        (window.PROJECT_PLANNER_QUEUE_METAS || []).forEach(entry => {
            if (entry.meta?.backgroundJobId && isPlannerActiveStatus(entry.meta.status)) {
                startPlannerBackgroundPolling(entry.meta.backgroundJobId);
                if (!refreshedActiveStatus) {
                    refreshedActiveStatus = true;
                    refreshPlannerBackgroundStatus(entry.meta.backgroundJobId).catch(() => null);
                }
            }
        });
    }
    renderPlannerSectionByState({ preserveScroll: true });
}

export function setPlannerView(view = 'plan') {
    window.PROJECT_PLANNER_VIEW = ['plan', 'run', 'result'].includes(view) ? view : 'plan';
    renderPlannerSectionByState();
}

export function setPlannerGenerationMode(mode = 'browser') {
    window.PROJECT_PLANNER_GENERATION_MODE = mode === 'background' ? 'background' : 'browser';
    localStorage.setItem('imggul_planner_generation_mode', window.PROJECT_PLANNER_GENERATION_MODE);
    if (window.PROJECT_PLANNER_GENERATION_MODE !== 'background') stopPlannerBackgroundPolling();
    renderPlannerSectionByState({ preserveScroll: true });
}

function getPlannerRunStartItemsForCurrentView() {
    const metas = Array.isArray(window.PROJECT_PLANNER_QUEUE_METAS) && window.PROJECT_PLANNER_QUEUE_METAS.length
        ? window.PROJECT_PLANNER_QUEUE_METAS.map(entry => entry.meta).filter(Boolean)
        : [window.PROJECT_PLANNER_META].filter(Boolean);
    return metas.flatMap(meta => getPlannerClearableItems(meta));
}

export async function openPlannerRunConfirmModal() {
    const items = getPlannerRunStartItemsForCurrentView();
    if (!items.some(item => hasPlannerGeneratedImages(item))) {
        await startPlannerGeneration(null, { clearExisting: true });
        return;
    }
    window.PROJECT_PLANNER_RUN_CONFIRM = true;
    renderPlannerRunConfirmOverlay();
}

export function closePlannerRunConfirmModal(event) {
    if (event && event.target?.id !== 'planner-run-confirm-modal') return;
    window.PROJECT_PLANNER_RUN_CONFIRM = false;
    renderPlannerRunConfirmOverlay();
}

export async function confirmPlannerRunStart() {
    window.PROJECT_PLANNER_RUN_CONFIRM = false;
    renderPlannerRunConfirmOverlay();
    await startPlannerGeneration(null, { clearExisting: true });
}

export async function loadPlannerForSelectedCharacter() {
    const project = getActiveProject();
    if (!project) return;
    const characterId = getSelectedPlannerCharacterId(project);
    window.PROJECT_PLANNER_SELECTED_CHARACTER_ID = characterId;
    setCachedPlannerCharacterId(project, characterId);
    window.PLANNER_RESULT_MODAL_CHARACTER_ID = null;
    window.PLANNER_RESULT_MODAL_SITUATION_ID = null;
    window.PLANNER_IMAGE_PREVIEW_KEY = null;
    window.PLANNER_PLAN_MODAL_SITUATION_ID = null;
    window.PROJECT_PLANNER_RUN_CONFIRM = false;
    const character = getCharacterById(project, characterId);
    if (character) {
        await Promise.all([
            loadCharacterMeta(character).catch(() => ({})),
            loadCharacterFiles(character).catch(() => [])
        ]);
    }
    const [meta, projectStyle] = await Promise.all([
        loadPlannerMeta(project, characterId, { force: true }).catch(() => null),
        loadProjectStylePrompt(project).catch(() => ''),
        loadProjectBackgroundPrompts(project).catch(() => normalizeProjectBackgroundPrompts())
    ]);
    window.PROJECT_PLANNER_META = meta;
    window.PROJECT_PLANNER_QUEUE_METAS = await loadPlannerQueueMetas(project, undefined, { force: true }).catch(() => meta ? [{ character, meta }] : []);
    window.PROJECT_PLANNER_PROJECT_STYLE = projectStyle || '';
    renderPlannerSituationPlanOverlay();
    renderPlannerResultOverlay();
    renderPlannerPreviewOverlay();
    renderPlannerRunConfirmOverlay();
    renderPlannerSectionByState();
}

export async function openPlannerSituationPlanModal(situationId) {
    const project = getActiveProject();
    const characterId = getSelectedPlannerCharacterId(project);
    const character = getCharacterById(project, characterId);
    if (character) await loadCharacterMeta(character).catch(() => ({}));
    window.PROJECT_PLANNER_PROJECT_STYLE = await loadProjectStylePrompt(project).catch(() => '');
    await loadProjectBackgroundPrompts(project).catch(() => normalizeProjectBackgroundPrompts());
    window.PLANNER_PLAN_MODAL_SITUATION_ID = situationId;
    renderPlannerSituationPlanOverlay();
}

export function closePlannerSituationPlanModal(event) {
    if (event && event.target?.id !== 'planner-situation-plan-modal') return;
    window.PLANNER_PLAN_MODAL_SITUATION_ID = null;
    renderPlannerSituationPlanOverlay();
}

export async function openPlannerResultModal(situationId, characterId = '') {
    const project = getActiveProject();
    const targetCharacterId = characterId || getSelectedPlannerCharacterId(project);
    window.PLANNER_RESULT_MODAL_CHARACTER_ID = targetCharacterId;
    window.PLANNER_RESULT_MODAL_SITUATION_ID = situationId;
    window.PLANNER_IMAGE_PREVIEW_KEY = null;
    if (project && targetCharacterId && !getPlannerMetaForCharacter(project, targetCharacterId)) {
        const meta = await loadPlannerMeta(project, targetCharacterId, { force: true }).catch(() => null);
        if (meta) setPlannerMetaForCharacter(project, meta);
    }
    renderPlannerResultOverlay();
    renderPlannerPreviewOverlay();
    const meta = getPlannerMetaForCharacter(project, targetCharacterId);
    if (window.PROJECT_PLANNER_GENERATION_MODE === 'background' && meta?.backgroundJobId) {
        refreshPlannerBackgroundStatus(meta.backgroundJobId).catch(() => null);
    }
}

export function closePlannerResultModal() {
    window.PLANNER_RESULT_MODAL_CHARACTER_ID = null;
    window.PLANNER_RESULT_MODAL_SITUATION_ID = null;
    window.PLANNER_IMAGE_PREVIEW_KEY = null;
    renderPlannerResultOverlay();
    renderPlannerPreviewOverlay();
}

export function openPlannerImagePreview(key) {
    window.PLANNER_IMAGE_PREVIEW_KEY = key;
    renderPlannerPreviewOverlay();
}

export function closePlannerImagePreview(event) {
    if (event && event.target?.id !== 'planner-image-preview-modal') return;
    window.PLANNER_IMAGE_PREVIEW_KEY = null;
    renderPlannerPreviewOverlay();
}

function syncPlannerBasePromptSettingsInputs() {
    const settings = getPlannerBasePromptSettings();
    const qualityInput = document.getElementById('planner-setting-quality-tags');
    const negativeInput = document.getElementById('planner-setting-default-negative');
    const qualityEnabledInput = document.getElementById('planner-setting-use-quality-tags');
    const negativeEnabledInput = document.getElementById('planner-setting-use-default-negative');
    if (qualityInput) qualityInput.value = settings.qualityTags || '';
    if (negativeInput) negativeInput.value = settings.defaultNegativePrompt || '';
    if (qualityEnabledInput) qualityEnabledInput.checked = !!settings.useQualityTags;
    if (negativeEnabledInput) negativeEnabledInput.checked = !!settings.useDefaultNegativePrompt;
}

export function openPlannerSettingsModal() {
    const modal = document.getElementById('planner-settings-modal');
    if (!modal) return;
    syncPlannerBasePromptSettingsInputs();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    refreshProjectIcons();
}

export function closePlannerSettingsModal(event) {
    if (event && event.target?.id !== 'planner-settings-modal') return;
    const modal = document.getElementById('planner-settings-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

export async function savePlannerSettingsFromModal() {
    const project = getActiveProject();
    if (!project) return;
    const status = document.getElementById('planner-settings-status');
    if (status) status.textContent = '저장 중...';

    try {
        const basePromptSettings = window.saveCraftBasePromptSettings
            ? window.saveCraftBasePromptSettings({
                qualityTags: document.getElementById('planner-setting-quality-tags')?.value || '',
                defaultNegativePrompt: document.getElementById('planner-setting-default-negative')?.value || '',
                useQualityTags: document.getElementById('planner-setting-use-quality-tags')?.checked ?? true,
                useDefaultNegativePrompt: document.getElementById('planner-setting-use-default-negative')?.checked ?? true
            })
            : {
                qualityTags: document.getElementById('planner-setting-quality-tags')?.value || '',
                defaultNegativePrompt: document.getElementById('planner-setting-default-negative')?.value || '',
                useQualityTags: document.getElementById('planner-setting-use-quality-tags')?.checked ?? true,
                useDefaultNegativePrompt: document.getElementById('planner-setting-use-default-negative')?.checked ?? true
            };
        const settings = await savePlannerSettings(project, {
            model: document.getElementById('planner-setting-model')?.value,
            steps: document.getElementById('planner-setting-steps')?.value,
            scale: document.getElementById('planner-setting-scale')?.value,
            sampler: document.getElementById('planner-setting-sampler')?.value,
            sm: document.getElementById('planner-setting-sm')?.checked,
            sm_dyn: document.getElementById('planner-setting-sm-dyn')?.checked,
            vibeStrength: document.getElementById('planner-setting-vibe-strength')?.value,
            vibeInfo: document.getElementById('planner-setting-vibe-info')?.value,
            preciseStrength: document.getElementById('planner-setting-precise-strength')?.value,
            preciseFidelity: document.getElementById('planner-setting-precise-fidelity')?.value,
            preciseType: document.getElementById('planner-setting-precise-type')?.value,
            vibeImageKey: document.getElementById('planner-setting-vibe-key')?.value.trim(),
            preciseImageKey: document.getElementById('planner-setting-precise-key')?.value.trim()
        });
        let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
        if (meta?.items?.length) {
            meta.items.forEach(item => {
                applyPlannerSettingsToGeneration(item.generation, settings);
                item.generation.qualityTags = basePromptSettings.useQualityTags ? String(basePromptSettings.qualityTags || '').trim() : '';
                item.generation.defaultNegativePrompt = basePromptSettings.useDefaultNegativePrompt ? String(basePromptSettings.defaultNegativePrompt || '').trim() : '';
                item.generation.useQualityTags = !!basePromptSettings.useQualityTags;
                item.generation.useDefaultNegativePrompt = !!basePromptSettings.useDefaultNegativePrompt;
            });
            meta.updatedAt = Date.now();
            await savePlannerMeta(project, meta);
            window.PROJECT_PLANNER_META = meta;
        }
        if (status) status.textContent = '저장되었습니다.';
        setTimeout(() => {
            closePlannerSettingsModal();
            renderPlannerSectionByState({ preserveScroll: true });
        }, 250);
    } catch (err) {
        if (status) status.textContent = err.message || '저장에 실패했습니다.';
    }
}

export function openPlannerReferenceLibrary(target) {
    window.PLANNER_REFERENCE_TARGET = target === 'precise' ? 'precise' : 'vibe';
    if (window.openInpaintLibraryModal) window.openInpaintLibraryModal('main');
}

export function setPlannerReferenceImageFromKey(key) {
    const target = window.PLANNER_REFERENCE_TARGET === 'precise' ? 'precise' : 'vibe';
    const input = document.getElementById(`planner-setting-${target}-key`);
    if (input) input.value = key || '';
    window.PLANNER_REFERENCE_TARGET = null;
}

export async function uploadPlannerReferenceFile(target, file) {
    const project = getActiveProject();
    if (!project || !file) return;
    const normalizedTarget = target === 'precise' ? 'precise' : 'vibe';
    const status = document.getElementById('planner-settings-status');
    if (status) status.textContent = '참조 이미지 업로드 중...';

    let uploadFile = file;
    if (window.convertToWebP && file.type !== 'image/webp') uploadFile = await window.convertToWebP(file);
    const ext = uploadFile.name.split('.').pop() || 'webp';
    const fileName = `${normalizedTarget}_${Date.now()}.${ext}`;
    const key = `${getPlannerPrefix(project)}references/${fileName}`;
    const buffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('참조 이미지 읽기에 실패했습니다.'));
        reader.readAsArrayBuffer(uploadFile);
    });
    const res = await fetch('/api/upload?_t=' + Date.now(), {
        method: 'PUT',
        headers: {
            'Content-Type': uploadFile.type || 'image/webp',
            'X-File-Name': encodeURIComponent(fileName),
            'X-Absolute-Path': encodeURIComponent(key)
        },
        body: buffer,
        cache: 'no-store'
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '참조 이미지 업로드에 실패했습니다.');
    }
    const input = document.getElementById(`planner-setting-${normalizedTarget}-key`);
    if (input) input.value = key;
    if (status) status.textContent = '참조 이미지가 업로드되었습니다.';
}

export async function handlePlannerReferenceFileInput(event, target) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    try {
        await uploadPlannerReferenceFile(target, file);
    } catch (err) {
        const status = document.getElementById('planner-settings-status');
        if (status) status.textContent = err.message || '참조 이미지 업로드에 실패했습니다.';
    } finally {
        if (event?.target) event.target.value = '';
    }
}

export async function handlePlannerReferenceDrop(event, target) {
    event.preventDefault();
    event.currentTarget?.classList.remove('border-indigo-400');
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    try {
        await uploadPlannerReferenceFile(target, file);
    } catch (err) {
        const status = document.getElementById('planner-settings-status');
        if (status) status.textContent = err.message || '참조 이미지 업로드에 실패했습니다.';
    }
}

export async function addPlannerV4Prompt(imageNumber) {
    const project = getActiveProject();
    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!meta?.items?.length) return;
    meta = readPlannerEditsFromDom(meta);
    const item = meta.items.find(entry => String(entry.imageNumber) === String(imageNumber));
    if (!item) return;
    if ((item.generation.v4PromptCharacters || []).length >= MAX_V4_PROMPT_CHARACTERS) return alert(`V4 캐릭터는 최대 ${MAX_V4_PROMPT_CHARACTERS}명까지만 추가할 수 있습니다.`);
    item.generation.v4PromptCharacters = [
        ...(item.generation.v4PromptCharacters || []),
        { subject: '', clothing: '', expression: '', action: '', negative: '' }
    ];
    item.generation.v4_prompt = item.generation.v4PromptCharacters;
    window.PROJECT_PLANNER_META = meta;
    renderPlannerSectionByState();
}

export async function removePlannerV4Prompt(imageNumber, index) {
    const project = getActiveProject();
    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!meta?.items?.length) return;
    meta = readPlannerEditsFromDom(meta);
    const item = meta.items.find(entry => String(entry.imageNumber) === String(imageNumber));
    if (!item) return;
    item.generation.v4PromptCharacters = (item.generation.v4PromptCharacters || []).filter((_, rowIndex) => rowIndex !== index);
    item.generation.v4_prompt = item.generation.v4PromptCharacters;
    window.PROJECT_PLANNER_META = meta;
    renderPlannerSectionByState();
}

export async function savePlannerSituationPlan() {
    const project = getActiveProject();
    if (!project) return;
    const situation = getSituationById(project, window.PLANNER_PLAN_MODAL_SITUATION_ID);
    const characterId = getSelectedPlannerCharacterId(project);
    const character = getCharacterById(project, characterId);
    const status = document.getElementById('planner-plan-modal-status');
    if (!situation || !character) return;
    if (status) status.textContent = '저장 중...';

    const characterMeta = await loadCharacterMeta(character).catch(() => ({}));
    const characterVariants = normalizeCharacterPromptVariants(characterMeta);
    const situationVariants = normalizeSituationPromptVariants(situation);
    const characterVariantId = document.getElementById('planner-plan-character-variant')?.value || characterVariants[0]?.id || 'default';
    const characterVariant = characterVariants.find(variant => variant.id === characterVariantId) || characterVariants[0];
    const selectedSituationVariantIds = Array.from(document.querySelectorAll('[data-planner-plan-situation-variant]:checked')).map(input => input.value);
    const activeSituationVariants = situationVariants.filter(variant => selectedSituationVariantIds.includes(variant.id));
    if (!activeSituationVariants.length) {
        if (status) status.textContent = '적용할 구도를 하나 이상 선택하세요.';
        return;
    }

    const count = clampPlannerImageCount(document.getElementById('planner-plan-count')?.value);
    const counts = distributePlannerCount(count, activeSituationVariants.length);
    const plannerSettings = await loadPlannerSettings(project).catch(() => normalizePlannerSettings());
    const currentSettings = window.readCraftSettings ? window.readCraftSettings() : {};
    const projectStyle = document.getElementById('planner-plan-style')?.value.trim()
        || await loadProjectStylePrompt(project).catch(() => '')
        || '';
    const backgroundPromptId = document.getElementById('planner-plan-background-variant')?.value || '';
    const overrideFields = {
        composition: document.getElementById('planner-plan-composition')?.value.trim() || '',
        character: document.getElementById('planner-plan-character')?.value.trim() || '',
        clothing: document.getElementById('planner-plan-clothing')?.value.trim() || '',
        expression: document.getElementById('planner-plan-expression')?.value.trim() || '',
        action: document.getElementById('planner-plan-action')?.value.trim() || '',
        background: document.getElementById('planner-plan-background')?.value.trim() || '',
        negative: document.getElementById('planner-plan-negative')?.value.trim() || ''
    };

    const variantGenerations = activeSituationVariants.map((variant, index) => {
        const mergedVariant = {
            ...variant,
            rating: getSituationRating(situation),
            prompt: {
                ...(variant.prompt || {}),
                ...Object.fromEntries(Object.entries(overrideFields).filter(([, value]) => value))
            },
            generation: {
                ...(variant.generation || {}),
                res: document.getElementById('planner-plan-res')?.value || variant.generation?.res || DEFAULT_PLANNER_RESOLUTION
            }
        };
        return {
            situationPromptVariantId: variant.id,
            situationPromptVariantName: getPlannerPromptVariantName(variant),
            count: counts[index],
            generation: buildPlannerGeneration({
                currentSettings,
                plannerSettings,
                projectStyle,
                backgroundPrompt: overrideFields.background || getPlannerBackgroundPromptById(project, backgroundPromptId).prompt,
                characterVariant: {
                    ...characterVariant,
                    parts: {
                        ...(characterVariant.parts || {}),
                        character: overrideFields.character || characterVariant.parts?.character || characterVariant.prompt || '',
                        clothing: overrideFields.clothing || characterVariant.parts?.clothing || '',
                        negative: overrideFields.negative ? '' : characterVariant.parts?.negative || ''
                    }
                },
                situationVariant: mergedVariant,
                count: counts[index]
            })
        };
    }).filter(entry => entry.count > 0);

    const imageNumber = getSituationImageNumber(project, situation);
    const item = {
        situationId: situation.id,
        situationName: getSituationDisplayName(situation),
        situationRating: getSituationRating(situation),
        situationIndex: getProjectItems(project, 'situations').findIndex(entry => entry.id === situation.id),
        imageNumber,
        count,
        status: 'pending',
        characterPromptVariantId: characterVariant.id,
        characterPromptVariantName: getPlannerPromptVariantName(characterVariant),
        backgroundPromptId,
        backgroundPromptName: getPlannerBackgroundPromptById(project, backgroundPromptId).name,
        situationPromptVariantIds: activeSituationVariants.map(variant => variant.id),
        variantCounts: Object.fromEntries(variantGenerations.map(entry => [entry.situationPromptVariantId, entry.count])),
        variantGenerations,
        generation: variantGenerations[0]?.generation || {},
        images: getPlannerSituationItem(window.PROJECT_PLANNER_META, situation.id)?.images || [],
        selectedImage: getPlannerSituationItem(window.PROJECT_PLANNER_META, situation.id)?.selectedImage || null
    };

    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project, character.id).catch(() => null);
    if (!meta || meta.characterId !== character.id) {
        meta = {
            projectId: project.id,
            characterId: character.id,
            characterPrefix: character.prefix,
            status: 'draft',
            defaultCount: count,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            items: []
        };
    }
    const existingIndex = meta.items.findIndex(entry => entry.situationId === situation.id);
    if (existingIndex >= 0) meta.items[existingIndex] = item;
    else meta.items.push(item);
    meta.items = sortPlannerItems(meta.items);
    meta.defaultCount = count;
    meta.lastSituationId = situation.id;
    meta.status = 'draft';
    meta.updatedAt = Date.now();
    await savePlannerItem(project, meta, item);
    window.PROJECT_PLANNER_META = meta;
    window.PLANNER_PLAN_MODAL_SITUATION_ID = null;
    renderPlannerSituationPlanOverlay();
    renderPlannerSectionByState({ preserveScroll: true });
}

function buildPlannerPlanItemFromSituation({
    project,
    situation,
    character,
    characterMeta,
    plannerSettings,
    currentSettings,
    projectStyle,
    backgroundPrompt = '',
    backgroundPromptId = '',
    backgroundPromptName = '',
    count,
    selectedCharacterVariantId = '',
    selectedSituationVariantIds = null,
    fieldOverrides = {},
    existingItem = null
}) {
    const characterVariants = normalizeCharacterPromptVariants(characterMeta);
    const situationVariants = normalizeSituationPromptVariants(situation);
    const characterVariantId = selectedCharacterVariantId || characterMeta.activePromptVariantId || characterVariants[0]?.id || 'default';
    const characterVariant = characterVariants.find(variant => variant.id === characterVariantId) || characterVariants[0];
    const activeSituationVariants = Array.isArray(selectedSituationVariantIds) && selectedSituationVariantIds.length
        ? situationVariants.filter(variant => selectedSituationVariantIds.includes(variant.id))
        : situationVariants;
    if (!characterVariant || !activeSituationVariants.length) return null;

    const normalizedCount = clampPlannerImageCount(count);
    const counts = distributePlannerCount(normalizedCount, activeSituationVariants.length);
    const overrideEntries = Object.entries(fieldOverrides).filter(([, value]) => value);
    const variantGenerations = activeSituationVariants.map((variant, index) => {
        const mergedVariant = {
            ...variant,
            rating: getSituationRating(situation),
            prompt: {
                ...(variant.prompt || {}),
                ...Object.fromEntries(overrideEntries)
            },
            generation: {
                ...(variant.generation || {}),
                res: fieldOverrides.res || variant.generation?.res || DEFAULT_PLANNER_RESOLUTION
            }
        };
        return {
            situationPromptVariantId: variant.id,
            situationPromptVariantName: getPlannerPromptVariantName(variant),
            count: counts[index],
            generation: buildPlannerGeneration({
                currentSettings,
                plannerSettings,
                projectStyle,
                backgroundPrompt: fieldOverrides.background || backgroundPrompt,
                characterVariant: {
                    ...characterVariant,
                    parts: {
                        ...(characterVariant.parts || {}),
                        character: fieldOverrides.character || characterVariant.parts?.character || characterVariant.prompt || '',
                        clothing: fieldOverrides.clothing || characterVariant.parts?.clothing || '',
                        negative: fieldOverrides.negative ? '' : characterVariant.parts?.negative || ''
                    }
                },
                situationVariant: mergedVariant,
                count: counts[index]
            })
        };
    }).filter(entry => entry.count > 0);

    const imageNumber = getSituationImageNumber(project, situation);
    return {
        situationId: situation.id,
        situationName: getSituationDisplayName(situation),
        situationRating: getSituationRating(situation),
        situationIndex: getProjectItems(project, 'situations').findIndex(entry => entry.id === situation.id),
        imageNumber,
        count: normalizedCount,
        status: 'pending',
        characterPromptVariantId: characterVariant.id,
        characterPromptVariantName: getPlannerPromptVariantName(characterVariant),
        backgroundPromptId,
        backgroundPromptName,
        situationPromptVariantIds: activeSituationVariants.map(variant => variant.id),
        variantCounts: Object.fromEntries(variantGenerations.map(entry => [entry.situationPromptVariantId, entry.count])),
        variantGenerations,
        generation: variantGenerations[0]?.generation || {},
        images: existingItem?.images || [],
        selectedImage: existingItem?.selectedImage || null
    };
}

export async function createMissingPlannerPlans() {
    const project = getActiveProject();
    if (!project) return;
    const characterId = getSelectedPlannerCharacterId(project);
    const character = getCharacterById(project, characterId);
    const situations = getProjectItems(project, 'situations');
    if (!character) {
        setPlannerStatus('플랜을 만들 캐릭터를 선택하세요.');
        return;
    }
    if (!situations.length) {
        setPlannerStatus('플랜을 만들 상황이 없습니다.');
        return;
    }

    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project, character.id).catch(() => null);
    if (meta && (isPlannerActiveStatus(meta.status) || isPlannerActiveStatus(meta.backgroundStatus?.status))) {
        setPlannerStatus('생성 중인 플랜이 있을 때는 일괄 생성할 수 없습니다.');
        return;
    }

    await Promise.all([
        loadCharacterFiles(character, true).catch(() => []),
        loadCharacterMeta(character, true).catch(() => ({}))
    ]);

    const existingItems = new Map((meta?.items || []).map(item => [item.situationId, item]));
    const missingSituations = situations.filter((situation, index) =>
        !getPlannerSituationImage(character, situation, index)
        && !existingItems.has(situation.id)
    );
    if (!missingSituations.length) {
        setPlannerStatus('누락된 이미지 중 새로 만들 플랜이 없습니다.');
        return;
    }

    const [plannerSettings, projectStyle] = await Promise.all([
        loadPlannerSettings(project).catch(() => normalizePlannerSettings()),
        loadProjectStylePrompt(project).catch(() => ''),
        loadProjectBackgroundPrompts(project).catch(() => normalizeProjectBackgroundPrompts())
    ]);
    const currentSettings = window.readCraftSettings ? window.readCraftSettings() : {};
    const characterMeta = character.meta || {};
    const defaultCount = clampPlannerImageCount(meta?.defaultCount || PLANNER_DEFAULT_IMAGE_COUNT);
    const defaultBackground = getPlannerBackgroundPromptById(project);
    if (!meta || meta.characterId !== character.id) {
        meta = {
            projectId: project.id,
            characterId: character.id,
            characterPrefix: character.prefix,
            status: 'draft',
            defaultCount,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            items: []
        };
    }

    const newItems = missingSituations
        .map(situation => buildPlannerPlanItemFromSituation({
            project,
            situation,
            character,
            characterMeta,
            plannerSettings,
            currentSettings,
            projectStyle,
            backgroundPrompt: defaultBackground.prompt,
            backgroundPromptId: defaultBackground.id,
            backgroundPromptName: defaultBackground.name,
            count: defaultCount
        }))
        .filter(Boolean);

    meta.items = sortPlannerItems([...(meta.items || []), ...newItems]);
    meta.defaultCount = defaultCount;
    meta.status = 'draft';
    meta.updatedAt = Date.now();
    await savePlannerMeta(project, meta);
    window.PROJECT_PLANNER_META = meta;
    window.PROJECT_PLANNER_PROJECT_STYLE = projectStyle || '';
    updatePlannerQueueMetaCache(project, meta);
    renderPlannerSectionByState({ preserveScroll: true });
    setPlannerStatus(`${newItems.length}개 누락 이미지 플랜을 생성했습니다.`);
}

export async function savePlannerDraft() {
    const project = getActiveProject();
    if (!project) return;

    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!meta?.items?.length) {
        setPlannerStatus('저장할 플랜 작성안이 없습니다.');
        return;
    }

    meta = readPlannerEditsFromDom(meta);
    meta.status = 'draft';
    await persistPlannerGenerationToSituations(project, meta);
    await savePlannerMeta(project, meta);
    window.PROJECT_PLANNER_META = meta;
    setPlannerStatus('플랜이 저장되었습니다.');
}

export async function deletePlannerItem(situationId) {
    const project = getActiveProject();
    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!project || !meta?.items?.length) return;

    const item = meta.items.find(entry => entry.situationId === situationId);
    if (!item) return;
    if (!confirm(`'${item.situationName || item.situationId}' 플랜을 삭제하시겠습니까?\n이 플랜의 임시 이미지도 함께 삭제됩니다.`)) return;

    if (window.PLANNER_RESULT_MODAL_SITUATION_ID === situationId) {
        window.PLANNER_RESULT_MODAL_SITUATION_ID = null;
        window.PLANNER_IMAGE_PREVIEW_KEY = null;
    }

    await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_folder', key: getPlannerImagePrefix(project, item.imageNumber) })
    }).catch(() => null);

    meta.items = meta.items.filter(entry => entry.situationId !== situationId);
    meta.updatedAt = Date.now();
    if (meta.items.length) {
        await savePlannerMeta(project, meta);
        window.PROJECT_PLANNER_META = meta;
    } else {
        await deletePlannerMeta(project);
        window.PROJECT_PLANNER_META = null;
    }
    clearFolderDataCaches(getPlannerPrefix(project));
    renderPlannerResultOverlay();
    renderPlannerPreviewOverlay();
    renderPlannerSectionByState();
}

export async function deleteAllPlannerItems() {
    const project = getActiveProject();
    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!project || !meta?.items?.length) {
        setPlannerStatus('삭제할 플랜이 없습니다.');
        return;
    }
    if (isPlannerActiveStatus(meta.status) || isPlannerActiveStatus(meta.backgroundStatus?.status)) {
        setPlannerStatus('생성 중에는 전체 플랜을 삭제할 수 없습니다. 일시정지 또는 취소 후 삭제하세요.');
        return;
    }
    if (!confirm(`현재 캐릭터의 플랜 ${meta.items.length}개를 모두 삭제하시겠습니까?\n각 플랜의 임시 이미지도 함께 삭제됩니다.`)) return;

    const items = [...meta.items];
    await Promise.all(items.map(item => fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_folder', key: getPlannerImagePrefix(project, item.imageNumber) })
    }).catch(() => null)));

    await deletePlannerMeta(project, meta.characterId);
    window.PROJECT_PLANNER_META = null;
    window.PLANNER_RESULT_MODAL_SITUATION_ID = null;
    window.PLANNER_IMAGE_PREVIEW_KEY = null;
    window.PLANNER_PLAN_MODAL_SITUATION_ID = null;
    clearFolderDataCaches(getPlannerPrefix(project));
    updatePlannerQueueMetaCache(project, { ...meta, items: [] });
    renderPlannerSituationPlanOverlay();
    renderPlannerResultOverlay();
    renderPlannerPreviewOverlay();
    renderPlannerSectionByState();
    setPlannerStatus(`${items.length}개 플랜을 삭제했습니다.`);
}

export async function deletePlannerItemFromModal(situationId) {
    await deletePlannerItem(situationId);
    if (window.PLANNER_PLAN_MODAL_SITUATION_ID === situationId) {
        window.PLANNER_PLAN_MODAL_SITUATION_ID = null;
        renderPlannerSituationPlanOverlay();
    }
}

export async function deletePlannerImage(key) {
    const project = getActiveProject();
    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!project || !meta?.items?.length || !key) return;

    const item = meta.items.find(entry => Array.isArray(entry.images) && entry.images.includes(key));
    if (!item) return;
    if (!confirm('이 임시 이미지를 삭제하시겠습니까?')) return;

    const res = await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', key })
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPlannerStatus(data.error || '임시 이미지 삭제에 실패했습니다.');
        return;
    }

    const prefix = key.slice(0, key.lastIndexOf('/') + 1);
    await window.removeMetadataFromDB(prefix, getFileNameFromKey(key)).catch(() => null);
    item.images = item.images.filter(imageKey => imageKey !== key);
    if (item.imagePromptSnapshots) delete item.imagePromptSnapshots[key];
    if (item.selectedImage === key) item.selectedImage = null;
    item.status = item.images.length ? item.status : 'pending';
    meta.updatedAt = Date.now();
    await savePlannerMeta(project, meta);
    window.PROJECT_PLANNER_META = meta;
    renderPlannerSectionByState();
}

export async function waitForPlannerQueueComplete() {
    return await new Promise(resolve => {
        const handler = (event) => {
            window.removeEventListener('imggul:generation-queue-complete', handler);
            resolve(event.detail || {});
        };
        window.addEventListener('imggul:generation-queue-complete', handler);
    });
}

export async function clearPlannerItemImages(project, item) {
    const prefix = getPlannerImagePrefix(project, item.imageNumber);
    const imageKeys = Array.isArray(item.images) ? [...item.images] : [];
    await Promise.all(imageKeys.map(key =>
        window.removeMetadataFromDB(prefix, getFileNameFromKey(key)).catch(() => null)
    ));
    await fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_folder', key: prefix })
    }).catch(() => null);
    item.images = [];
    item.generatedImages = [];
    item.imagePromptSnapshots = {};
    item.selectedImage = null;
    item.completedCount = 0;
    item.failedCount = 0;
    item.stage = '';
    item.stageLabel = '';
    item.errorMessage = '';
    item.status = 'pending';
}

async function clearPlannerItemsImages(project, items = [], meta = null) {
    const uniqueItems = Array.from(new Map(
        items.filter(Boolean).map(item => [item.situationId || item.id || item.imageNumber, item])
    ).values());
    for (const item of uniqueItems) {
        await clearPlannerItemImages(project, item);
    }
}

export function startPlannerBackgroundPolling(jobId) {
    const jobIds = Array.isArray(jobId) ? jobId.filter(Boolean) : [jobId].filter(Boolean);
    if (!jobIds.length) return;
    window.PLANNER_BACKGROUND_POLL_JOB_IDS = Array.from(new Set(jobIds));
    if (window.PLANNER_BACKGROUND_POLL_TIMER) clearInterval(window.PLANNER_BACKGROUND_POLL_TIMER);
    window.PLANNER_BACKGROUND_POLL_TIMER = setInterval(() => {
        const activeJobIds = Array.isArray(window.PLANNER_BACKGROUND_POLL_JOB_IDS) ? [...window.PLANNER_BACKGROUND_POLL_JOB_IDS] : [];
        activeJobIds.forEach(activeJobId => {
            window.refreshPlannerBackgroundStatus(activeJobId).catch(() => null);
        });
    }, 5000);
}

export function stopPlannerBackgroundPolling() {
    if (!window.PLANNER_BACKGROUND_POLL_TIMER) return;
    clearInterval(window.PLANNER_BACKGROUND_POLL_TIMER);
    window.PLANNER_BACKGROUND_POLL_TIMER = null;
    window.PLANNER_BACKGROUND_POLL_JOB_IDS = [];
}

function removePlannerBackgroundPollingJob(jobId) {
    if (!jobId || !Array.isArray(window.PLANNER_BACKGROUND_POLL_JOB_IDS)) return;
    window.PLANNER_BACKGROUND_POLL_JOB_IDS = window.PLANNER_BACKGROUND_POLL_JOB_IDS.filter(id => id !== jobId);
    if (!window.PLANNER_BACKGROUND_POLL_JOB_IDS.length) stopPlannerBackgroundPolling();
}

function findPlannerQueueEntryByJob(jobId, status = {}) {
    const queueMetas = Array.isArray(window.PROJECT_PLANNER_QUEUE_METAS) ? window.PROJECT_PLANNER_QUEUE_METAS : [];
    return queueMetas.find(entry =>
        entry.meta?.backgroundJobId === jobId
        || (status.runId && entry.meta?.id === status.runId)
        || (status.characterId && entry.meta?.characterId === status.characterId)
    ) || null;
}

function setPlannerActiveMetaIfSelected(project, meta) {
    if (!project || !meta) return;
    const selectedCharacterId = getSelectedPlannerCharacterId(project);
    if (!selectedCharacterId || meta.characterId === selectedCharacterId) {
        window.PROJECT_PLANNER_META = meta;
    }
}

export async function refreshPlannerBackgroundStatus(jobId = null) {
    const project = getActiveProject();
    const currentMeta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    const targetJobId = jobId || currentMeta?.backgroundJobId;
    if (!project || !targetJobId) return null;

    const res = await fetch(`/api/planner/v3/generate/status?jobId=${encodeURIComponent(targetJobId)}&_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPlannerStatus(data.error || '백그라운드 상태 조회에 실패했습니다.');
        return null;
    }

    const status = await res.json();
    const eta = updatePlannerBackgroundEta(targetJobId, status);
    const statusForView = eta ? { ...status, eta } : status;
    const statusForStorage = withoutPlannerVolatileEta(statusForView);
    const queuedEntry = findPlannerQueueEntryByJob(targetJobId, status);
    const meta = queuedEntry?.meta || currentMeta;
    if (status.expired || status.status === 'expired') {
        removePlannerBackgroundPollingJob(targetJobId);
        if (meta?.backgroundJobId === targetJobId) {
            delete meta.backgroundJobId;
            if (['queued', 'running', 'cancel_requested', 'paused'].includes(meta.status)) meta.status = 'draft';
            meta.updatedAt = Date.now();
            await savePlannerMeta(project, meta).catch(() => null);
            setPlannerActiveMetaIfSelected(project, meta);
            updatePlannerQueueMetaCache(project, meta);
        }
        window.PROJECT_PLANNER_QUEUE_METAS = await loadPlannerQueueMetas(project).catch(() => window.PROJECT_PLANNER_QUEUE_METAS || []);
        setPlannerStatus('이전 백그라운드 작업 기록이 만료되었습니다.');
        renderPlannerIfVisible();
        return status;
    }
    const nextMeta = await loadPlannerMeta(project, status.characterId || meta?.characterId || '', { force: true }).catch(() => meta || window.PROJECT_PLANNER_META);
    if (nextMeta) {
        if (status.status === 'cancel_requested') {
            resetPlannerMetaAfterCancel(nextMeta);
            nextMeta.backgroundStatus = { ...statusForStorage, status: 'queued' };
            await savePlannerMeta(project, nextMeta).catch(() => null);
            nextMeta.backgroundStatus = { ...statusForView, status: 'queued' };
            setPlannerActiveMetaIfSelected(project, nextMeta);
            window.PROJECT_PLANNER_QUEUE_METAS = await loadPlannerQueueMetas(project).catch(() => window.PROJECT_PLANNER_QUEUE_METAS || []);
            updatePlannerQueueMetaCache(project, nextMeta);
            removePlannerBackgroundPollingJob(targetJobId);
            renderPlannerIfVisible();
            return statusForView;
        }
        nextMeta.backgroundStatus = statusForStorage;
        nextMeta.status = status.status || nextMeta.status;
        nextMeta.backgroundJobId = status.jobId || nextMeta.backgroundJobId;
        if (!isPlannerActiveStatus(status.status)) {
            delete nextMeta.runningSituationIds;
            delete nextMeta.backgroundJobId;
        }
        if (Array.isArray(status.items) && Array.isArray(nextMeta.items)) {
            nextMeta.items = nextMeta.items.map(item => {
                const statusItem = status.items.find(entry => entry.situationId === item.situationId);
                if (!statusItem) return item;
                return {
                    ...item,
                    status: statusItem.status === 'completed' ? 'done' : statusItem.status,
                    stage: statusItem.stage || item.stage || '',
                    stageLabel: statusItem.stageLabel || item.stageLabel || '',
                    images: Array.isArray(statusItem.resultKeys) ? statusItem.resultKeys : (item.images || []),
                    generatedImages: Array.isArray(statusItem.generatedImages) ? statusItem.generatedImages : (item.generatedImages || []),
                    completedCount: Number(statusItem.completedCount || 0),
                    failedCount: Number(statusItem.failedCount || 0),
                    errorMessage: statusItem.errorMessage || item.errorMessage || ''
                };
            });
        }
        await savePlannerMeta(project, nextMeta).catch(() => null);
        nextMeta.backgroundStatus = statusForView;
        setPlannerActiveMetaIfSelected(project, nextMeta);
    }
    window.PROJECT_PLANNER_QUEUE_METAS = await loadPlannerQueueMetas(project).catch(() => window.PROJECT_PLANNER_QUEUE_METAS || []);
    if (nextMeta) updatePlannerQueueMetaCache(project, nextMeta);
    if (!['queued', 'running', 'cancel_requested'].includes(status.status)) removePlannerBackgroundPollingJob(targetJobId);
    renderPlannerIfVisible();
    return statusForView;
}

export async function cancelPlannerBackgroundGeneration(jobId = null) {
    const project = getActiveProject();
    const meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    const targetJobId = jobId || meta?.backgroundJobId;
    if (!targetJobId) return;

    if (meta) {
        meta.status = 'cancel_requested';
        meta.stage = '';
        meta.stageLabel = '';
        if (Array.isArray(meta.items)) {
            meta.items = meta.items.map(item => ['queued', 'running', 'cancel_requested'].includes(item.status)
                ? { ...item, status: 'cancel_requested', stage: '', stageLabel: '' }
                : item
            );
        }
        window.PROJECT_PLANNER_META = meta;
        updatePlannerQueueMetaCache(project, meta);
        renderPlannerIfVisible();
    }

    const res = await fetch('/api/planner/v3/generate/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: targetJobId })
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPlannerStatus(data.error || '백그라운드 취소 요청에 실패했습니다.');
        return;
    }
    setPlannerStatus('백그라운드 취소를 요청했습니다.');
    if (meta) {
        resetPlannerMetaAfterCancel(meta);
        await savePlannerMeta(project, meta).catch(() => null);
        window.PROJECT_PLANNER_META = meta;
        updatePlannerQueueMetaCache(project, meta);
    }
    setPlannerStatus('취소되었습니다. 다시 실행할 수 있습니다.');
    stopPlannerBackgroundPolling();
    renderPlannerIfVisible();
}

export async function pausePlannerBackgroundGeneration(jobId = null) {
    const project = getActiveProject();
    const meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    const targetJobId = jobId || meta?.backgroundJobId;
    if (!targetJobId) return;

    if (meta) {
        meta.status = 'paused';
        meta.stage = 'paused';
        meta.stageLabel = getPlannerStageLabel('paused');
        delete meta.runningSituationIds;
        if (Array.isArray(meta.items)) {
            meta.items = meta.items.map(item => ['queued', 'running', 'cancel_requested'].includes(item.status)
                ? { ...item, status: 'paused', stage: 'paused', stageLabel: getPlannerStageLabel('paused') }
                : item
            );
        }
        meta.updatedAt = Date.now();
        window.PROJECT_PLANNER_META = meta;
        updatePlannerQueueMetaCache(project, meta);
        await savePlannerMeta(project, meta).catch(() => null);
        renderPlannerIfVisible();
    }

    const res = await fetch('/api/planner/v3/generate/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: targetJobId })
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPlannerStatus(data.error || '백그라운드 일시정지 요청에 실패했습니다.');
        return;
    }

    stopPlannerBackgroundPolling();
    setPlannerStatus('일시정지되었습니다.');
    await refreshPlannerBackgroundStatus(targetJobId).catch(() => null);
}

export async function resumePlannerBackgroundGeneration(jobId = null) {
    const project = getActiveProject();
    const meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    const targetJobId = jobId || meta?.backgroundJobId;
    if (!targetJobId) return;

    const res = await fetch('/api/planner/v3/generate/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: targetJobId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        setPlannerStatus(data.error || '백그라운드 재개 요청에 실패했습니다.');
        return;
    }
    if (data.expired || data.status === 'expired') {
        if (meta?.backgroundJobId === targetJobId) {
            delete meta.backgroundJobId;
            meta.status = 'draft';
            meta.updatedAt = Date.now();
            await savePlannerMeta(project, meta).catch(() => null);
            window.PROJECT_PLANNER_META = meta;
            updatePlannerQueueMetaCache(project, meta);
        }
        setPlannerStatus('이전 백그라운드 작업 기록이 만료되었습니다. 다시 실행하세요.');
        renderPlannerIfVisible();
        return;
    }
    if (meta) {
        meta.status = data.status || 'running';
        meta.stage = data.stage || 'running';
        meta.stageLabel = data.stageLabel || getPlannerStageLabel('running');
        meta.backgroundJobId = data.jobId || targetJobId;
        meta.runningSituationIds = (meta.items || [])
            .filter(item => item.status === 'paused' && !isPlannerItemTargetComplete(item, meta))
            .map(item => item.situationId);
        if (Array.isArray(meta.items)) {
            meta.items = meta.items.map(item => item.status === 'paused'
                ? (isPlannerItemTargetComplete(item, meta)
                    ? { ...item, status: 'done', stage: 'completed', stageLabel: getPlannerStageLabel('completed') }
                    : { ...item, status: 'running', stage: 'running', stageLabel: getPlannerStageLabel('running') })
                : item
            );
        }
        meta.updatedAt = Date.now();
        await savePlannerMeta(project, meta).catch(() => null);
        window.PROJECT_PLANNER_META = meta;
        updatePlannerQueueMetaCache(project, meta);
    }
    startPlannerBackgroundPolling(targetJobId);
    setPlannerStatus('백그라운드 작업을 재개했습니다.');
    await refreshPlannerBackgroundStatus(targetJobId).catch(() => null);
}

export async function pausePlannerGeneration() {
    const pendingToken = setPlannerPendingAction('pause');
    setPlannerStatus(getPlannerPendingActionLabel('pause'));
    try {
    const project = getActiveProject();
    const meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    window.PROJECT_PLANNER_PAUSE_REQUESTED = true;
    if (window.PROJECT_PLANNER_GENERATION_MODE !== 'background') {
        const browserRunIds = new Set(window.PROJECT_PLANNER_BROWSER_RUN?.runningSituationIds || []);
        setPlannerBrowserRunState({ status: 'paused' });
        if (window.IS_GENERATING && window.cancelNaiGeneration) window.cancelNaiGeneration();
        if (meta) {
            meta.status = 'paused';
            meta.stage = 'paused';
            meta.stageLabel = getPlannerStageLabel('paused');
            delete meta.runningSituationIds;
            meta.items = (meta.items || []).map(item => browserRunIds.has(item.situationId) && !isPlannerItemTargetComplete(item, meta)
                ? { ...item, status: 'paused', stage: '', stageLabel: '' }
                : item
            );
            meta.updatedAt = Date.now();
            window.PROJECT_PLANNER_META = meta;
            updatePlannerQueueMetaCache(project, meta);
        }
        setPlannerStatus('일시정지했습니다.');
        renderPlannerIfVisible();
        return;
    }
    const backgroundEntries = await getPlannerBackgroundControlEntries(project, ['queued', 'running', 'cancel_requested']);
    if (backgroundEntries.length) {
        await controlPlannerBackgroundEntries(project, backgroundEntries, 'pause');
        setPlannerStatus('백그라운드 작업을 일시정지했습니다.');
        return;
    }
    if (meta?.backgroundJobId && ['queued', 'running'].includes(meta.status)) {
        await pausePlannerBackgroundGeneration(meta.backgroundJobId);
        return;
    }
    if (meta) {
        meta.status = 'paused';
        meta.items = (meta.items || []).map(item => ['queued', 'running', 'cancel_requested'].includes(item.status)
            ? { ...item, status: 'paused' }
            : item
        );
        delete meta.runningSituationIds;
        meta.updatedAt = Date.now();
        await savePlannerMeta(project, meta).catch(() => null);
        window.PROJECT_PLANNER_META = meta;
        updatePlannerQueueMetaCache(project, meta);
    }
    setPlannerStatus('일시정지되었습니다.');
    renderPlannerIfVisible();
    } finally {
        clearPlannerPendingAction(pendingToken);
    }
}

export async function resumePlannerGeneration() {
    const pendingToken = setPlannerPendingAction('resume');
    setPlannerStatus(getPlannerPendingActionLabel('resume'));
    try {
    const project = getActiveProject();
    const meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (window.PROJECT_PLANNER_GENERATION_MODE !== 'background') {
        const resumeEntries = getPlannerBrowserResumeEntries(project, meta);
        if (!resumeEntries.length) return;
        for (const entry of resumeEntries) {
            const resumeMeta = entry?.meta;
            if (!resumeMeta?.items?.some(item => isPlannerRunnableItem(item, resumeMeta, true))) continue;
            resumeMeta.items = resumeMeta.items.map(item => item.status === 'paused' && !isPlannerItemTargetComplete(item, resumeMeta)
                ? { ...item, status: 'pending', stage: '', stageLabel: '' }
                : item
            );
            resumeMeta.status = 'draft';
            resumeMeta.stage = '';
            resumeMeta.stageLabel = '';
            delete resumeMeta.runningSituationIds;
            resumeMeta.updatedAt = Date.now();
            window.PROJECT_PLANNER_META = resumeMeta;
            updatePlannerQueueMetaCache(project, resumeMeta);
            setPlannerBrowserRunState({
                status: 'running',
                projectId: project.id,
                characterId: resumeMeta.characterId || ''
            });
            await startPlannerGeneration(null, { resume: true });
            if (window.PROJECT_PLANNER_BROWSER_RUN?.status === 'paused' || window.PROJECT_PLANNER_CANCEL_REQUESTED) break;
        }
        return;
    }
    const backgroundEntries = await getPlannerBackgroundControlEntries(project, ['paused']);
    if (backgroundEntries.length) {
        await controlPlannerBackgroundEntries(project, backgroundEntries, 'resume');
        setPlannerStatus('백그라운드 작업을 재개했습니다.');
        return;
    }
    if (meta.backgroundJobId && meta.status === 'paused') {
        await resumePlannerBackgroundGeneration(meta.backgroundJobId);
        return;
    }
    if (!meta?.items?.length) return;
    meta.items = meta.items.map(item => item.status === 'paused' && !isPlannerItemTargetComplete(item, meta)
        ? { ...item, status: 'pending' }
        : item
    );
    meta.status = 'draft';
    meta.updatedAt = Date.now();
    await savePlannerMeta(project, meta).catch(() => null);
    window.PROJECT_PLANNER_META = meta;
    updatePlannerQueueMetaCache(project, meta);
    await startPlannerGeneration(null, { resume: true });
    } finally {
        clearPlannerPendingAction(pendingToken);
    }
}

export async function cancelPlannerGeneration() {
    const pendingToken = setPlannerPendingAction('cancel');
    setPlannerStatus(getPlannerPendingActionLabel('cancel'));
    try {
    const project = getActiveProject();
    const meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    window.PROJECT_PLANNER_CANCEL_REQUESTED = true;
    if (window.IS_GENERATING && window.cancelNaiGeneration) window.cancelNaiGeneration();
    if (window.PROJECT_PLANNER_GENERATION_MODE !== 'background') {
        setPlannerBrowserRunState(null);
        if (meta) {
            resetPlannerMetaAfterCancel(meta);
            const storedMeta = await savePlannerBrowserStoredMeta(project, meta).catch(() => meta);
            window.PROJECT_PLANNER_META = storedMeta;
            updatePlannerQueueMetaCache(project, storedMeta);
        }
        setPlannerStatus('취소했습니다. 다시 실행할 수 있습니다.');
        renderPlannerIfVisible();
        return;
    }
    const backgroundEntries = await getPlannerBackgroundControlEntries(project, ['queued', 'running', 'cancel_requested', 'paused']);
    if (backgroundEntries.length) {
        await controlPlannerBackgroundEntries(project, backgroundEntries, 'cancel');
        setPlannerStatus('백그라운드 작업을 취소했습니다. 다시 실행할 수 있습니다.');
        return;
    }
    if (meta?.backgroundJobId && ['queued', 'running', 'cancel_requested', 'paused'].includes(meta.status)) {
        await cancelPlannerBackgroundGeneration(meta.backgroundJobId);
        return;
    }
    if (meta) {
        resetPlannerMetaAfterCancel(meta);
        await savePlannerMeta(project, meta).catch(() => null);
        window.PROJECT_PLANNER_META = meta;
        updatePlannerQueueMetaCache(project, meta);
    }
    setPlannerStatus('취소되었습니다. 다시 실행할 수 있습니다.');
    renderPlannerIfVisible();
    } finally {
        clearPlannerPendingAction(pendingToken);
    }
}

export async function startPlannerBackgroundGeneration(situationId = null, options = {}) {
    if (window.PLANNER_BACKGROUND_STARTING) return;
    const pendingToken = setPlannerPendingAction('start');
    window.PLANNER_BACKGROUND_STARTING = true;
    setPlannerStatus(getPlannerPendingActionLabel('start'));
    try {
        await runPlannerBackgroundGenerationStart(situationId, options);
    } finally {
        window.PLANNER_BACKGROUND_STARTING = false;
        clearPlannerPendingAction(pendingToken);
    }
}

function getPlannerRunnableItems(meta = {}, situationId = null, includeCompleted = false) {
    const items = Array.isArray(meta.items) ? meta.items : [];
    const predicate = includeCompleted
        ? item => isPlannerRestartableItem(item)
        : item => isPlannerRunnableItem(item, meta);
    return situationId
        ? items.filter(item => item.situationId === situationId && predicate(item))
        : items.filter(predicate);
}

function getPlannerClearableItems(meta = {}, situationId = null) {
    const items = Array.isArray(meta.items) ? meta.items : [];
    const clearableItems = situationId
        ? items.filter(item => item.situationId === situationId && isPlannerRestartableItem(item))
        : items.filter(item => isPlannerRestartableItem(item));
    return clearableItems.filter(item => hasPlannerGeneratedImages(item));
}

function hasUnsupportedPlannerBackgroundReference(items = []) {
    return items.some(item => item.generation?.vibeImageKey || item.generation?.preciseImageKey);
}

async function startPlannerBackgroundRun(project, meta, targetItems, situationId = null, batch = null) {
    const res = await fetch('/api/planner/v3/generate/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            projectId: project.id,
            projectPrefix: project.prefix,
            runId: meta.id,
            targetSituationId: situationId || null,
            mode: 'background',
            clearExisting: batch?.clearExisting === true,
            batchKey: batch?.key || '',
            batchIndex: batch?.index ?? 0
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || '백그라운드 생성 등록에 실패했습니다.');
    }

    const nextMeta = {
        ...meta,
        backgroundJobId: data.jobId || meta.backgroundJobId,
        status: data.status || 'queued',
        runningSituationIds: targetItems.map(item => item.situationId),
        updatedAt: Date.now()
    };
    nextMeta.items = (nextMeta.items || []).map(item =>
        targetItems.some(target => target.situationId === item.situationId)
            ? { ...item, status: 'queued', stage: 'queued', stageLabel: getPlannerStageLabel('queued') }
            : item
    );
    updatePlannerQueueMetaCache(project, nextMeta);
    setPlannerActiveMetaIfSelected(project, nextMeta);
    return { data, meta: nextMeta };
}

async function runAllPlannerBackgroundGenerationStart(options = {}) {
    const project = getActiveProject();
    if (!project) return;
    const characters = getProjectItems(project, 'characters');
    if (!characters.length) {
        setPlannerStatus('실행할 캐릭터가 없습니다.');
        return;
    }

    const queueMetas = await loadPlannerQueueMetas(project, characters, { force: true }).catch(() => []);
    const runnableEntries = queueMetas
        .map(entry => ({ ...entry, targetItems: getPlannerRunnableItems(entry.meta, null, options.clearExisting === true) }))
        .filter(entry => entry.meta?.items?.length && (entry.targetItems.length || entry.meta.backgroundJobId));
    if (!runnableEntries.length) {
        setPlannerStatus('실행할 플랜을 찾을 수 없습니다.');
        window.PROJECT_PLANNER_QUEUE_METAS = queueMetas;
        renderPlannerSectionByState();
        return;
    }

    const unsupportedEntry = runnableEntries.find(entry => hasUnsupportedPlannerBackgroundReference(entry.targetItems));
    if (unsupportedEntry) {
        const characterName = unsupportedEntry.character?.name || unsupportedEntry.character?.folderName || unsupportedEntry.meta?.characterId || '';
        setPlannerStatus(`백그라운드 생성은 아직 참조 이미지를 지원하지 않습니다. ${characterName ? `${characterName} 플랜의 ` : ''}참조 이미지를 제거하거나 브라우저 모드를 사용하세요.`);
        return;
    }

    window.PROJECT_PLANNER_VIEW = 'run';
    const startedJobIds = [];
    const failed = [];
    let existingCount = 0;
    let startedCount = 0;
    const batchKey = `planner_${project.id || project.prefix || 'project'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.replace(/[^a-zA-Z0-9_-]+/g, '_');
    let batchIndex = 0;

    if (options.clearExisting === true) {
        const entriesToClear = queueMetas
            .map(entry => ({ ...entry, clearItems: getPlannerClearableItems(entry.meta) }))
            .filter(entry =>
                !(entry.meta.backgroundJobId && ['queued', 'running', 'cancel_requested'].includes(entry.meta.status))
                && entry.clearItems.length
            );
        for (const entry of entriesToClear) {
            await clearPlannerItemsImages(project, entry.clearItems, entry.meta);
            entry.meta.updatedAt = Date.now();
            updatePlannerQueueMetaCache(project, entry.meta);
            setPlannerActiveMetaIfSelected(project, entry.meta);
        }
        renderPlannerSectionByState({ preserveScroll: true });
    }

    for (const entry of runnableEntries) {
        const meta = entry.meta;
        if (meta.backgroundJobId && ['queued', 'running', 'cancel_requested'].includes(meta.status)) {
            startedJobIds.push(meta.backgroundJobId);
            existingCount += 1;
            continue;
        }
        if (!entry.targetItems.length) continue;
        try {
            const result = await startPlannerBackgroundRun(project, meta, entry.targetItems, null, { key: batchKey, index: batchIndex, clearExisting: options.clearExisting === true });
            if (result.data?.jobId) startedJobIds.push(result.data.jobId);
            startedCount += 1;
            batchIndex += 1;
        } catch (error) {
            failed.push({
                character: entry.character,
                message: error?.message || String(error)
            });
        }
    }

    window.PROJECT_PLANNER_QUEUE_METAS = await loadPlannerQueueMetas(project, characters, { force: true }).catch(() => window.PROJECT_PLANNER_QUEUE_METAS || []);
    if (startedJobIds.length) {
        startPlannerBackgroundPolling(startedJobIds);
        await Promise.all(startedJobIds.map(jobId => refreshPlannerBackgroundStatus(jobId).catch(() => null)));
    }
    renderPlannerSectionByState();
    if (failed.length) {
        const first = failed[0];
        const name = first.character?.name || first.character?.folderName || first.character?.id || '일부 캐릭터';
        setPlannerStatus(`${name} 등 ${failed.length}개 캐릭터의 백그라운드 등록에 실패했습니다: ${first.message}`);
    } else if (startedCount || existingCount) {
        setPlannerStatus(`${startedCount}개 캐릭터의 백그라운드 생성 작업을 등록했습니다.${existingCount ? ` 이미 실행 중인 ${existingCount}개 작업도 함께 추적합니다.` : ''}`);
    } else {
        setPlannerStatus('새로 실행할 플랜을 찾을 수 없습니다.');
    }
}

async function getPlannerBackgroundControlEntries(project, statuses) {
    const characters = getProjectItems(project, 'characters');
    const queueMetas = (Array.isArray(window.PROJECT_PLANNER_QUEUE_METAS) && window.PROJECT_PLANNER_QUEUE_METAS.length)
        ? window.PROJECT_PLANNER_QUEUE_METAS
        : await loadPlannerQueueMetas(project, characters, { force: true }).catch(() => []);
    const statusSet = new Set(statuses);
    return queueMetas.filter(entry => entry.meta?.backgroundJobId && statusSet.has(entry.meta.status));
}

async function controlPlannerBackgroundEntries(project, entries, action) {
    if (!entries.length) return false;
    const endpoint = {
        pause: '/api/planner/v3/generate/pause',
        resume: '/api/planner/v3/generate/resume',
        cancel: '/api/planner/v3/generate/cancel'
    }[action];
    if (!endpoint) return false;

    const nextPollingJobIds = [];
    for (const entry of entries) {
        const meta = entry.meta;
        const jobId = meta.backgroundJobId;
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobId })
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || '백그라운드 작업 제어에 실패했습니다.');
        }
        if (action === 'pause') {
            meta.status = 'paused';
            meta.stage = 'paused';
            meta.stageLabel = getPlannerStageLabel('paused');
            delete meta.runningSituationIds;
            meta.items = (meta.items || []).map(item => ['queued', 'running', 'cancel_requested'].includes(item.status)
                ? { ...item, status: 'paused', stage: 'paused', stageLabel: getPlannerStageLabel('paused') }
                : item
            );
            removePlannerBackgroundPollingJob(jobId);
        } else if (action === 'resume') {
            meta.status = 'running';
            meta.stage = 'running';
            meta.stageLabel = getPlannerStageLabel('running');
            meta.items = (meta.items || []).map(item => item.status === 'paused'
                ? { ...item, status: 'queued', stage: 'queued', stageLabel: getPlannerStageLabel('queued') }
                : item
            );
            nextPollingJobIds.push(jobId);
        } else if (action === 'cancel') {
            resetPlannerMetaAfterCancel(meta);
            removePlannerBackgroundPollingJob(jobId);
        }
        meta.updatedAt = Date.now();
        updatePlannerQueueMetaCache(project, meta);
        setPlannerActiveMetaIfSelected(project, meta);
    }

    if (nextPollingJobIds.length) {
        startPlannerBackgroundPolling(nextPollingJobIds);
        await Promise.all(nextPollingJobIds.map(jobId => refreshPlannerBackgroundStatus(jobId).catch(() => null)));
    }
    window.PROJECT_PLANNER_QUEUE_METAS = await loadPlannerQueueMetas(project, getProjectItems(project, 'characters'), { force: true }).catch(() => window.PROJECT_PLANNER_QUEUE_METAS || []);
    renderPlannerIfVisible();
    return true;
}

export async function runPlannerBackgroundGenerationStart(situationId = null, options = {}) {
    const project = getActiveProject();
    if (!project) return;
    if (!situationId) {
        await runAllPlannerBackgroundGenerationStart(options);
        return;
    }

    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!meta?.items?.length) {
        setPlannerStatus('먼저 플래너 초안을 생성하세요.');
        return;
    }

    if (meta.backgroundJobId && ['queued', 'running', 'cancel_requested'].includes(meta.status)) {
        startPlannerBackgroundPolling(meta.backgroundJobId);
        await refreshPlannerBackgroundStatus(meta.backgroundJobId);
        setPlannerStatus('이미 백그라운드 생성이 진행 중입니다. 현재 실행 중인 플랜을 불러왔습니다.');
        return;
    }

    meta = readPlannerEditsFromDom(meta);
    await persistPlannerGenerationToSituations(project, meta).catch(() => null);
    const targetItems = getPlannerRunnableItems(meta, situationId, options.clearExisting === true);
    if (!targetItems.length) {
        setPlannerStatus('실행할 플랜을 찾을 수 없습니다.');
        return;
    }

    const unsupportedReference = targetItems.some(item => item.generation?.vibeImageKey || item.generation?.preciseImageKey);
    if (unsupportedReference) {
        setPlannerStatus('백그라운드 생성은 아직 참조 이미지를 지원하지 않습니다. 브라우저 모드를 사용하세요.');
        return;
    }

    const clearExisting = options.clearExisting === true;
    if (clearExisting) {
        await clearPlannerItemsImages(project, getPlannerClearableItems(meta), meta);
    }

    for (const item of targetItems) {
        item.status = 'queued';
        item.stage = 'queued';
    }

    meta.status = 'queued';
    meta.runningSituationIds = targetItems.map(item => item.situationId);
    meta.updatedAt = Date.now();
    window.PROJECT_PLANNER_VIEW = 'run';
    const useExistingRunForClear = clearExisting && !!meta.id;
    if (!useExistingRunForClear) {
        await savePlannerMeta(project, meta, { preserveActiveStatus: true });
    }
    window.PROJECT_PLANNER_META = meta;
    renderPlannerSectionByState();

    const startPayload = {
        projectId: project.id,
        projectPrefix: project.prefix,
        targetSituationId: situationId || null,
        mode: 'background',
        clearExisting
    };
    if (useExistingRunForClear) {
        startPayload.runId = meta.id;
    } else {
        startPayload.plannerMeta = meta;
    }
    const res = await fetch('/api/planner/v3/generate/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(startPayload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        console.error('Background planner start failed', data);
        setPlannerStatus(data.error || '백그라운드 생성 등록에 실패했습니다.');
        meta.status = 'failed';
        meta.updatedAt = Date.now();
        if (!useExistingRunForClear) {
            await savePlannerMeta(project, meta).catch(() => null);
        }
        window.PROJECT_PLANNER_META = meta;
        renderPlannerSectionByState();
        return;
    }

    if (data.existing) {
        const activeMeta = await loadPlannerMeta(project).catch(() => null);
        if (activeMeta) {
            window.PROJECT_PLANNER_META = activeMeta;
            updatePlannerQueueMetaCache(project, activeMeta);
        }
        setPlannerStatus('이미 백그라운드 생성이 진행 중입니다. 새 작업은 시작하지 않고 현재 실행 중인 플랜을 불러왔습니다.');
        startPlannerBackgroundPolling(data.jobId);
        await refreshPlannerBackgroundStatus(data.jobId).catch(() => null);
        renderPlannerSectionByState();
        return;
    }

    meta.backgroundJobId = data.jobId;
    meta.status = data.status || 'queued';
    meta.updatedAt = Date.now();
    if (!useExistingRunForClear) {
        await savePlannerMeta(project, meta);
    }
    window.PROJECT_PLANNER_META = meta;
    setPlannerStatus('백그라운드 생성 작업을 등록했습니다.');
    startPlannerBackgroundPolling(data.jobId);
    await refreshPlannerBackgroundStatus(data.jobId);
}

export async function startPlannerResultGeneration(situationId = null) {
    const project = getActiveProject();
    const meta = getPlannerResultModalMeta(project);
    if (!project || !meta?.items?.length) {
        setPlannerStatus('다시 생성할 플랜을 찾을 수 없습니다.');
        return;
    }
    if (window.PROJECT_PLANNER_GENERATION_MODE !== 'background') {
        setPlannerStatus('다중 캐릭터 결과에서는 백그라운드 모드에서 다시 생성하세요.');
        return;
    }
    const targetItems = getPlannerRunnableItems(meta, situationId, true);
    if (!targetItems.length) {
        setPlannerStatus('다시 생성할 플랜을 찾을 수 없습니다.');
        return;
    }
    if (hasUnsupportedPlannerBackgroundReference(targetItems)) {
        setPlannerStatus('백그라운드 생성은 아직 참조 이미지를 지원하지 않습니다. 브라우저 모드를 사용하세요.');
        return;
    }
    if (!confirm('이 플랜의 기존 후보 이미지를 삭제하고 다시 생성하시겠습니까?')) return;
    try {
        await clearPlannerItemsImages(project, targetItems, meta);
        const result = await startPlannerBackgroundRun(project, meta, targetItems, situationId, { clearExisting: true });
        if (result.data?.jobId) startPlannerBackgroundPolling(result.data.jobId);
        setPlannerStatus('백그라운드 생성 작업을 등록했습니다.');
        window.PLANNER_RESULT_MODAL_SITUATION_ID = null;
        window.PLANNER_IMAGE_PREVIEW_KEY = null;
        renderPlannerResultOverlay();
        renderPlannerPreviewOverlay();
        renderPlannerSectionByState({ preserveScroll: true });
        if (result.data?.jobId) await refreshPlannerBackgroundStatus(result.data.jobId).catch(() => null);
    } catch (error) {
        setPlannerStatus(error?.message || '다시 생성에 실패했습니다.');
    }
}

export async function startPlannerGeneration(situationId = null, options = {}) {
    if (window.PROJECT_PLANNER_GENERATION_MODE === 'background') {
        await startPlannerBackgroundGeneration(situationId, options);
        return;
    }

    const project = getActiveProject();
    if (!project || window.IS_GENERATING) {
        setPlannerStatus(window.IS_GENERATING ? '이미 생성 작업이 진행 중입니다.' : '');
        return;
    }

    let meta = window.PROJECT_PLANNER_META || await loadPlannerMeta(project).catch(() => null);
    if (!meta?.items?.length) {
        setPlannerStatus('먼저 플래너 초안을 생성하세요.');
        return;
    }

    meta = readPlannerEditsFromDom(meta);
    await persistPlannerGenerationToSituations(project, meta).catch(() => null);
    const resumeRun = !!options.resume;
    const clearExisting = options.clearExisting === true && !resumeRun;
    const targetItems = situationId
        ? meta.items.filter(item => item.situationId === situationId && (clearExisting ? isPlannerRestartableItem(item) : isPlannerRunnableItem(item, meta, resumeRun)))
        : meta.items.filter(item => clearExisting ? isPlannerRestartableItem(item) : isPlannerRunnableItem(item, meta, resumeRun));
    if (!targetItems.length) {
        setPlannerStatus('실행할 플랜을 찾을 수 없습니다.');
        return;
    }
    if (clearExisting) {
        setPlannerStatus('기존 이미지를 정리하는 중...');
        await clearPlannerItemsImages(project, getPlannerClearableItems(meta), meta);
        meta.updatedAt = Date.now();
        window.PROJECT_PLANNER_META = meta;
        updatePlannerQueueMetaCache(project, meta);
        renderPlannerSectionByState({ preserveScroll: true });
    }
    meta.status = 'running';
    meta.runningSituationIds = targetItems.map(item => item.situationId);
    setPlannerBrowserRunState({
        status: 'running',
        projectId: project.id,
        characterId: meta.characterId || '',
        runningSituationIds: targetItems.map(item => item.situationId)
    });
    window.PROJECT_PLANNER_PAUSE_REQUESTED = false;
    window.PROJECT_PLANNER_CANCEL_REQUESTED = false;
    window.PROJECT_PLANNER_VIEW = 'run';
    if (situationId) {
        window.PLANNER_RESULT_MODAL_SITUATION_ID = null;
        window.PLANNER_IMAGE_PREVIEW_KEY = null;
    }
    await savePlannerBrowserStoredMeta(project, meta).catch(() => null);
    window.PROJECT_PLANNER_META = meta;
    updatePlannerQueueMetaCache(project, meta);
    renderPlannerSectionByState();

    const previousSettings = window.readCraftSettings ? window.readCraftSettings() : null;
    const previousVibeFile = window.VIBE_IMAGE_FILE || null;
    const previousPreciseFile = window.PRECISE_IMAGE_FILE || null;
    const plannerSettings = await loadPlannerSettings(project).catch(() => normalizePlannerSettings());
    try {
        for (const item of targetItems) {
            item.status = 'running';
            const runGenerations = buildPlannerRunGenerations(item, meta, resumeRun);
            if (!runGenerations.length) {
                item.status = 'done';
                continue;
            }
            let result = {};
            for (const variantRun of runGenerations) {
            if (window.PROJECT_PLANNER_PAUSE_REQUESTED || window.PROJECT_PLANNER_CANCEL_REQUESTED) {
                result = { stopped: true };
                break;
            }
            const generation = variantRun.generation || item.generation;
            generation.batchCount = String(clampPlannerImageCount(variantRun.count || item.count || meta.defaultCount));
            applyPlannerSettingsToGeneration(generation, plannerSettings);
            item.generation = generation;
            await savePlannerBrowserStoredMeta(project, meta).catch(() => null);
            window.PROJECT_PLANNER_META = meta;
            updatePlannerQueueMetaCache(project, meta);
            renderPlannerSectionByState({ preserveScroll: true });
            setPlannerStatus(`${item.imageNumber}.webp 생성 중...`);

            if (window.applyCraftSettings) window.applyCraftSettings(generation);
            await applyPlannerReferenceFiles(generation);
            const beforeImages = new Set(await listPlannerImages(project, item.imageNumber));
            window.generateNaiImage({
                outputPrefix: getPlannerImagePrefix(project, item.imageNumber),
                v4PromptCharacters: generation.v4PromptCharacters || [],
                planner: {
                    projectId: project.id,
                    situationId: item.situationId,
                    imageNumber: item.imageNumber,
                    situationPromptVariantId: variantRun.situationPromptVariantId || ''
                }
            });

            result = await waitForPlannerQueueComplete();
            if (result.stopped) break;
            const afterImages = await listPlannerImages(project, item.imageNumber);
            const metadataSnapshot = buildPlannerMetadataFallback({ generation });
            item.imagePromptSnapshots = item.imagePromptSnapshots || {};
            afterImages
                .filter(key => !beforeImages.has(key))
                .forEach(key => {
                    item.imagePromptSnapshots[key] = metadataSnapshot;
                });
            item.images = afterImages;
            meta.updatedAt = Date.now();
            await savePlannerBrowserStoredMeta(project, meta).catch(() => null);
            }
            item.images = await listPlannerImages(project, item.imageNumber);
            item.status = result.stopped
                ? (window.PROJECT_PLANNER_CANCEL_REQUESTED ? 'pending' : 'paused')
                : (isPlannerItemTargetComplete(item, meta) ? 'done' : 'failed');
            meta.updatedAt = Date.now();
            await savePlannerBrowserStoredMeta(project, meta).catch(() => null);
            window.PROJECT_PLANNER_META = meta;
            updatePlannerQueueMetaCache(project, meta);
            renderPlannerSectionByState({ preserveScroll: true });
            if (result.stopped) {
                meta.status = window.PROJECT_PLANNER_CANCEL_REQUESTED ? 'draft' : 'paused';
                break;
            }
        }

        if (!['draft', 'paused'].includes(meta.status)) meta.status = targetItems.every(item => item.status === 'done') ? 'completed' : 'failed';
        delete meta.runningSituationIds;
        meta.updatedAt = Date.now();
        await savePlannerBrowserStoredMeta(project, meta).catch(() => null);
        window.PROJECT_PLANNER_META = meta;
        updatePlannerQueueMetaCache(project, meta);
        setPlannerStatus(meta.status);
    } finally {
        const browserRunStatus = window.PROJECT_PLANNER_BROWSER_RUN?.status;
        window.VIBE_IMAGE_FILE = previousVibeFile;
        window.PRECISE_IMAGE_FILE = previousPreciseFile;
        window.PROJECT_PLANNER_PAUSE_REQUESTED = false;
        window.PROJECT_PLANNER_CANCEL_REQUESTED = false;
        if (browserRunStatus !== 'paused') setPlannerBrowserRunState(null);
        if (previousSettings && window.applyCraftSettings) window.applyCraftSettings(previousSettings);
        renderPlannerSectionByState({ preserveScroll: true });
    }
}

export async function selectPlannerImage(key) {
    const project = getActiveProject();
    const meta = findPlannerMetaByImageKey(project, key);
    if (!project || !meta?.items) return;
    const item = meta.items.find(entry => Array.isArray(entry.images) && entry.images.includes(key));
    if (!item) return;
    item.selectedImage = key;
    meta.updatedAt = Date.now();
    setPlannerMetaForCharacter(project, meta);
    syncPlannerResultModalSelection(item, key);
    renderPlannerPreviewOverlay();
    renderPlannerSectionByState({ preserveScroll: true });
}

export async function selectPlannerImageFromPreview(key) {
    const project = getActiveProject();
    const meta = findPlannerMetaByImageKey(project, key);
    if (!project || !meta?.items) return;
    const item = meta.items.find(entry => Array.isArray(entry.images) && entry.images.includes(key));
    if (!item) return;
    item.selectedImage = key;
    meta.updatedAt = Date.now();
    window.PLANNER_IMAGE_PREVIEW_KEY = null;
    setPlannerMetaForCharacter(project, meta);
    syncPlannerResultModalSelection(item, key);
    renderPlannerPreviewOverlay();
}

export function buildPlannerMetadataFallback(item) {
    const generation = item?.generation || {};
    const fields = generation.fields || {};
    const splitPrompts = buildPlannerSplitPrompts(generation);

    const [width, height] = String(generation.res || DEFAULT_PLANNER_RESOLUTION).split('x').map(Number);
    const metadata = {
        'Negative Prompt': generation.negative || fields.negative || '',
        'Resolution': `${Number.isFinite(width) ? width : 832} x ${Number.isFinite(height) ? height : 1216}`,
        'Steps': generation.steps,
        'Sampler': generation.sampler,
        'CFG Scale': generation.scale,
        'Split Prompts': splitPrompts
    };
    if (Array.isArray(generation.v4PromptCharacters) && generation.v4PromptCharacters.length) {
        metadata['Extra Characters'] = generation.v4PromptCharacters
            .map(row => ({
                subject: row.subject || '',
                clothing: row.clothing || '',
                expression: row.expression || '',
                action: row.action || ''
            }))
            .filter(row => row.subject || row.clothing || row.expression || row.action);
        metadata['Negative Extra Characters'] = generation.v4PromptCharacters
            .map(row => row.negative || '')
    }
    Object.keys(metadata).forEach(key => {
        if (
            metadata[key] === undefined ||
            metadata[key] === null ||
            metadata[key] === '' ||
            (Array.isArray(metadata[key]) && metadata[key].length === 0) ||
            (key === 'Split Prompts' && Object.keys(metadata[key]).length === 0)
        ) {
            delete metadata[key];
        }
    });
    return metadata;
}

export async function confirmPlannerSelection(situationId = null, triggerButton = null) {
    if (window.PROJECT_PLANNER_CONFIRMING) return;
    window.PROJECT_PLANNER_CONFIRMING = true;
    const confirmButton = triggerButton || document.getElementById('planner-result-confirm-button');
    if (confirmButton) confirmButton.disabled = true;
    try {
    const project = getActiveProject();
    const targetCharacterId = getPlannerResultModalCharacterId(project);
    let meta = getPlannerMetaForCharacter(project, targetCharacterId);
    if (!meta && project && targetCharacterId) meta = await loadPlannerMeta(project, targetCharacterId, { force: true }).catch(() => null);
    if (!project || !meta?.items?.length) {
        setPlannerStatus('확정할 플래너 데이터가 없습니다.');
        if (confirmButton) confirmButton.disabled = false;
        return;
    }

    await loadProjectCharacters(project).catch(() => []);
    const character = getCharacterById(project, meta.characterId) || getCharacterById(project, meta.characterPrefix);
    if (!character) {
        setPlannerStatus('플래너 캐릭터를 찾을 수 없습니다.');
        if (confirmButton) confirmButton.disabled = false;
        return;
    }

    const selectedItems = meta.items.filter(item =>
        item.selectedImage && (!situationId || item.situationId === situationId)
    );
    if (!selectedItems.length) {
        setPlannerStatus('확정 전에 상황별 이미지를 하나 이상 선택하세요.');
        if (confirmButton) confirmButton.disabled = false;
        return;
    }
    const blockedItems = selectedItems.filter(item => isPlannerConfirmBlocked(meta, item));
    if (blockedItems.length) {
        setPlannerStatus('생성 중에는 플랜을 확정할 수 없습니다. 일시정지 또는 완료 후 확정하세요.');
        if (confirmButton) confirmButton.disabled = false;
        return;
    }

    for (const item of selectedItems) {
        const newKey = `${character.prefix}${item.imageNumber}.webp`;
        const selectedAsset = (item.generatedImages || []).find(asset => asset.id && (asset.key === item.selectedImage || asset.r2Key === item.selectedImage));
        let metadata = {};
        if (window.loadMetadataFromDB) {
            const sourcePrefix = item.selectedImage.slice(0, item.selectedImage.lastIndexOf('/') + 1);
            const sourceFileName = getFileNameFromKey(item.selectedImage);
            const sourceMetadata = await window.loadMetadataFromDB(sourcePrefix, sourceFileName).catch(() => null);
            metadata = mergePlannerSplitMetadata(item, sourceMetadata, item.selectedImage);
        }
        if (selectedAsset?.id) {
            const confirmRes = await fetch('/api/planner/v3/confirm?_t=' + Date.now(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({
                    itemId: item.id,
                    assetId: selectedAsset.id,
                    idempotencyKey: `confirm:${item.id}:${selectedAsset.id}`,
                    targetFolderPrefix: character.prefix,
                    targetFileName: `${item.imageNumber}.webp`,
                    metadata
                }),
                cache: 'no-store'
            });
            if (!confirmRes.ok) {
                const data = await confirmRes.json().catch(() => ({}));
                throw new Error(data.error || `${item.imageNumber}.webp 확정에 실패했습니다.`);
            }
        } else {
            const imageRes = await fetch(getAssetUrl(item.selectedImage), { cache: 'no-store' });
            if (!imageRes.ok) throw new Error(`${item.selectedImage} 이미지를 읽지 못했습니다.`);
            const blob = await imageRes.blob();
            const sourceFile = new File([blob], getFileNameFromKey(item.selectedImage), { type: blob.type || 'image/png' });
            const finalFile = sourceFile.type === 'image/webp' ? sourceFile : await window.convertToWebP(sourceFile);
            const buffer = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('FileReader error'));
                reader.readAsArrayBuffer(finalFile);
            });
            const uploadRes = await fetch('/api/upload?_t=' + Date.now(), {
                method: 'PUT',
                headers: {
                    'X-File-Name': encodeURIComponent(`${item.imageNumber}.webp`),
                    'Content-Type': 'image/webp',
                    'X-Absolute-Path': encodeURIComponent(newKey)
                },
                body: buffer,
                cache: 'no-store'
            });
            if (!uploadRes.ok) {
                const data = await uploadRes.json().catch(() => ({}));
                throw new Error(data.error || `${item.imageNumber}.webp 확정에 실패했습니다.`);
            }
            if (window.saveMetadataToDB && metadata && Object.keys(metadata).length) await window.saveMetadataToDB(character.prefix, `${item.imageNumber}.webp`, metadata);
        }
        item.finalImage = newKey;
        item.status = 'confirmed';
    }

    const selectedIds = new Set(selectedItems.map(item => item.situationId));
    if (Array.isArray(window.GENERATION_QUEUE) && window.GENERATION_QUEUE.length) {
        window.GENERATION_QUEUE = window.GENERATION_QUEUE.filter(task => !selectedIds.has(task?.planner?.situationId));
        if (window.saveQueueToStorage) window.saveQueueToStorage();
    }
    meta.items = meta.items.filter(item => !selectedIds.has(item.situationId));
    meta.status = meta.items.length ? 'draft' : 'confirmed';
    meta.updatedAt = Date.now();
    window.PLANNER_RESULT_MODAL_CHARACTER_ID = null;
    window.PLANNER_RESULT_MODAL_SITUATION_ID = null;
    window.PLANNER_IMAGE_PREVIEW_KEY = null;
    if (meta.items.length) {
        await savePlannerMeta(project, meta);
        setPlannerMetaForCharacter(project, meta);
        setPlannerStatus(`${selectedItems.length}개 플랜을 확정했습니다. 선택하지 않은 플랜은 남아 있습니다.`);
    } else {
        await deletePlannerMeta(project, meta.characterId);
        updatePlannerQueueMetaCache(project, { ...meta, items: [] });
        if (window.PROJECT_PLANNER_META?.characterId === meta.characterId) window.PROJECT_PLANNER_META = null;
        setPlannerStatus('선택한 플랜이 모두 확정되었습니다.');
    }
    await Promise.all(selectedItems.map(item => fetch('/api/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_folder', key: getPlannerImagePrefix(project, item.imageNumber) })
    }).catch(() => null)));

    clearFolderDataCaches(project.prefix, character.prefix, getPlannerPrefix(project));
    character.filesLoaded = false;
    await loadCharacterFiles(character, true).catch(() => []);
    renderPlannerResultOverlay();
    renderPlannerPreviewOverlay();
    renderPlannerSectionByState();
    } catch (err) {
        setPlannerStatus(err.message || '플랜 확정에 실패했습니다.');
        if (confirmButton) confirmButton.disabled = false;
    } finally {
        window.PROJECT_PLANNER_CONFIRMING = false;
    }
}
