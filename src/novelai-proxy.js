import { jsonResponse } from './worker-utils.js';

const USAGE_TIMEOUT_MS = 8_000;
const GENERATION_TIMEOUT_MS = 165_000;

// 토큰과 요청 본문을 로그/오류 응답에 포함하지 않는다.
export async function proxyNovelAi(request, token, usage = false) {
    const suppliedId = request.headers.get('X-Request-Id') || '';
    const requestId = /^[a-zA-Z0-9-]{1,80}$/.test(suppliedId) ? suppliedId : crypto.randomUUID();
    const stage = usage ? 'checking-cost' : 'requesting';
    const startedAt = Date.now();
    const headers = { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' };
    const failure = (status, code, upstreamStatus = null) => {
        console.warn(JSON.stringify({ event: 'novelai-proxy-failed', requestId, stage, status, code, upstreamStatus, elapsedMs: Date.now() - startedAt }));
        return jsonResponse({ available: false, error: usage ? '구독 정보를 확인하지 못했습니다.' : '이미지 생성 응답을 확인하지 못했습니다.', code, stage, upstreamStatus, requestId }, { status, headers });
    };
    let body;
    if (!usage) {
        try { body = JSON.stringify(await request.json()); }
        catch { return failure(400, 'INVALID_GENERATION_REQUEST'); }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), usage ? USAGE_TIMEOUT_MS : GENERATION_TIMEOUT_MS);
    let streaming = false;
    try {
        const upstream = await fetch(`https://image.novelai.net/${usage ? 'user/subscription' : 'ai/generate-image'}`, {
            method: usage ? 'GET' : 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Accept: usage ? 'application/json' : 'application/x-zip-compressed',
                Origin: 'https://novelai.net',
                Referer: 'https://novelai.net/',
                ...(!usage ? { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' } : {})
            },
            ...(usage ? {} : { body }),
            signal: controller.signal
        });
        if (!upstream.ok) {
            await upstream.body?.cancel();
            return failure(upstream.status, usage ? 'USAGE_UPSTREAM_ERROR' : 'GENERATION_UPSTREAM_ERROR', upstream.status);
        }
        if (usage) {
            const subscription = await upstream.json();
            const fixed = Number(subscription?.trainingStepsLeft?.fixedTrainingStepsLeft);
            const purchased = Number(subscription?.trainingStepsLeft?.purchasedTrainingSteps);
            return jsonResponse({
                available: true,
                active: subscription?.active === true,
                tier: Number(subscription?.tier) || 0,
                usage: subscription?.usage ? {
                    percent: Number(subscription.usage.percent),
                    isNegative: subscription.usage.isNegative === true,
                    timeUntilNextPercent: Number(subscription.usage.timeUntilNextPercent)
                } : null,
                anlas: Number.isFinite(fixed) && Number.isFinite(purchased) ? {
                    subscription: fixed, paid: purchased, total: fixed + purchased
                } : null,
                requestId
            }, { headers });
        }
        if (!upstream.body) return failure(502, 'GENERATION_EMPTY_RESPONSE');
        const reader = upstream.body.getReader();
        let cancelled = false;
        // ZIP을 Worker 메모리에 전부 적재하지 않고 전달한다. 제한 시간은 본문 수신까지 유지한다.
        const stream = new ReadableStream({
            async pull(output) {
                try {
                    const { done, value } = await reader.read();
                    if (cancelled) return;
                    if (done) {
                        clearTimeout(timer);
                        reader.releaseLock();
                        output.close();
                        console.log(JSON.stringify({ event: 'novelai-result-received', requestId, elapsedMs: Date.now() - startedAt }));
                    } else output.enqueue(value);
                } catch (error) {
                    clearTimeout(timer);
                    if (cancelled) return;
                    reader.releaseLock();
                    console.warn(JSON.stringify({ event: 'novelai-body-failed', requestId, stage: 'receiving', timedOut: controller.signal.aborted, elapsedMs: Date.now() - startedAt }));
                    output.error(error);
                }
            },
            async cancel(reason) {
                cancelled = true;
                clearTimeout(timer);
                try { await reader.cancel(reason); } finally { reader.releaseLock(); }
            }
        });
        streaming = true;
        return new Response(stream, { headers: { ...headers, 'Content-Type': 'application/x-zip-compressed', 'Content-Disposition': 'attachment; filename="image.zip"' } });
    } catch {
        return failure(controller.signal.aborted ? 504 : 502, controller.signal.aborted ? 'NOVELAI_TIMEOUT' : 'NOVELAI_NETWORK_ERROR');
    } finally {
        if (!streaming) clearTimeout(timer);
    }
}
