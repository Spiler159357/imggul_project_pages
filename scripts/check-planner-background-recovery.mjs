import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    classifyPlannerGenerationError,
    getPlannerRetryDelaySeconds,
    isNovelAiRateLimitError
} from '../src/planner-retry-policy.js';
import { evaluatePlannerRunHealth } from '../src/planner-compact.js';

const rateLimit = Object.assign(new Error('[NovelAI 429] Too Many Requests'), { status: 429 });
assert.equal(isNovelAiRateLimitError(rateLimit), true);
assert.equal(isNovelAiRateLimitError(new Error('error code: 1015')), true);
assert.equal(isNovelAiRateLimitError(new Error('Concurrent generation is locked')), true);
assert.deepEqual(
    [1, 2, 3, 4, 5].map(attempt => getPlannerRetryDelaySeconds(rateLimit, attempt)),
    [120, 300, 900, 1800, 1800]
);
assert.equal(
    getPlannerRetryDelaySeconds(Object.assign(rateLimit, { retryAfterSeconds: 2000 }), 1),
    2000
);
assert.equal(classifyPlannerGenerationError({ status: 401 }), 'fatal');
assert.equal(classifyPlannerGenerationError({ status: 503 }), 'transient');
assert.equal(classifyPlannerGenerationError({ code: 'NOVELAI_REQUEST_TIMEOUT' }), 'transient');
assert.equal(classifyPlannerGenerationError({ code: 'R2_PUT_RETRY_EXHAUSTED' }), 'storage');
assert.equal(classifyPlannerGenerationError(new Error('Invalid zip: EOCD not found')), 'generation');

const healthNow = Date.parse('2026-10-05T00:10:00.000Z');
assert.deepEqual(
    evaluatePlannerRunHealth({ status: 'running', execution: {
        claimedAt: '2026-10-05T00:09:00.000Z',
        leaseUntil: '2026-10-05T00:19:00.000Z',
        phase: 'novelai_request'
    } }, healthNow),
    {
        health: 'processing',
        healthReason: 'novelai_request',
        healthMessage: '이미지를 정상적으로 처리하고 있습니다.',
        canRecover: false
    }
);
assert.equal(evaluatePlannerRunHealth({ status: 'running', execution: {
    claimedAt: '2026-10-04T23:50:00.000Z',
    leaseUntil: '2026-10-05T00:00:00.000Z'
} }, healthNow).canRecover, true);
assert.equal(evaluatePlannerRunHealth({
    status: 'running',
    lastDispatchAt: '2026-10-05T00:09:00.000Z'
}, healthNow).health, 'queued');
assert.equal(evaluatePlannerRunHealth({
    status: 'running',
    lastDispatchAt: '2026-10-05T00:00:00.000Z'
}, healthNow).healthReason, 'queue_delivery_timeout');
assert.equal(evaluatePlannerRunHealth({
    status: 'running',
    retryState: {
        lastErrorKind: 'rate_limit',
        nextRetryAt: '2026-10-05T00:20:00.000Z'
    }
}, healthNow).health, 'cooldown');

const compactSource = readFileSync(new URL('../src/planner-compact.js', import.meta.url), 'utf8');
const backgroundSource = readFileSync(new URL('../src/planner-background.js', import.meta.url), 'utf8');
const frontendSource = readFileSync(new URL('../public/js/project/planner.js', import.meta.url), 'utf8');
const workerConfig = readFileSync(new URL('../wrangler.background.toml', import.meta.url), 'utf8');
const exampleConfig = readFileSync(new URL('../wrangler.background.example.toml', import.meta.url), 'utf8');

assert.ok(compactSource.includes('nextMessage: next && !stale'));
assert.equal(compactSource.includes('next && !duplicate && !stale'), false);
assert.ok(compactSource.includes('export async function deferPlannerCompactQueueSlot'));
assert.ok(compactSource.includes('export async function recordPlannerCompactSlotFailure'));
assert.ok(compactSource.includes('export async function recoverStalledPlannerCompactRuns'));
assert.ok(compactSource.includes('lastFailureToken'));
assert.ok(backgroundSource.includes('delaySeconds: rateLimitDelaySeconds'));
assert.ok(backgroundSource.includes('messageId: message.id'));
assert.ok(backgroundSource.includes('recoverStalledPlannerCompactRuns(env)'));
assert.ok(backgroundSource.includes('processPlannerCompactQueueBurst'));
assert.ok(backgroundSource.includes('planner_slot_completed'));
assert.ok(frontendSource.includes('/api/planner/compact/generate/recover'));
assert.ok(frontendSource.includes("cooldown: 'NovelAI 제한 해제 대기'"));
assert.ok(frontendSource.includes("background.health === 'stalled'"));
assert.equal(frontendSource.includes('now - updatedAt >= 12 * 60 * 1000'), false);

for (const config of [workerConfig, exampleConfig]) {
    assert.match(config, /max_retries\s*=\s*5/);
    assert.match(config, /dead_letter_queue\s*=\s*"imggul-generation-dlq"/);
    assert.match(config, /"\*\/2 \* \* \* \*"/);
    assert.match(config, /\[observability\][\s\S]*enabled\s*=\s*true/);
}

console.log('Planner background recovery checks passed.');
