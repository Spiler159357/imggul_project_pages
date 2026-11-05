// 비용 계산과 표시 정책을 분리한다. 비 V5 비용도 별도 안내에 남긴다.
export function getGenerationCostPresentation(disclosure) {
    const amount = Number(disclosure.maximum || 0).toLocaleString('ko-KR');
    let paidLabel = '';
    if (disclosure.status === 'paid') paidLabel = `${amount} Anlas 사용 · 생성`;
    if (disclosure.status === 'conditional') paidLabel = `최대 ${amount} Anlas · 생성`;
    if (disclosure.status === 'unknown') paidLabel = `최대 ${amount} Anlas 가능 · 생성`;
    const detail = disclosure.requiresConsent
        ? `예상 Anlas 비용: ${Number(disclosure.minimum || 0).toLocaleString('ko-KR')} ~ ${amount}${disclosure.reasons?.length ? ` · ${disclosure.reasons.join(' · ')}` : ''}`
        : '';
    return {
        label: disclosure.profile?.family === 'v5' && paidLabel ? paidLabel : '생성',
        detail
    };
}

// consume까지 제한 시간 안에서 처리하여 헤더 이후 본문 읽기도 중단한다.
export async function withGenerationTimeout(timeoutMs, operation) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            reject(new DOMException('처리 시간 초과', 'AbortError'));
        }, timeoutMs);
    });
    try {
        return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]);
    } finally {
        clearTimeout(timer);
    }
}

export async function readGenerationHttpError(response) {
    // 게이트웨이 HTML 및 upstream 원문을 상태 UI/로그에 유출하지 않는다.
    let payload = {};
    if ((response.headers.get('content-type') || '').includes('application/json')) {
        try {
            const parsed = await response.json();
            if (parsed && typeof parsed === 'object') payload = parsed;
        } catch { /* 상태 코드만으로도 분류 가능 */ }
    } else {
        await response.body?.cancel();
    }
    const error = new Error(`서버 응답 오류 (HTTP ${response.status})`);
    error.status = response.status;
    error.upstreamStatus = payload.upstreamStatus;
    error.requestId = payload.requestId || response.headers.get('X-Request-Id');
    error.stage = payload.stage;
    error.code = payload.code;
    // 알려진 요청 거부 외에는 전송 후 처리 여부를 단정할 수 없다.
    error.resultUnknown = payload.stage !== 'preparing' && (response.status >= 500 || response.status === 408);
    return error;
}
