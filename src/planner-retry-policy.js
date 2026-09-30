export const NOVELAI_RATE_LIMIT_DELAYS = Object.freeze([120, 300, 900, 1800]);

export function isNovelAiRateLimitError(error) {
    const message = error?.message || String(error || "");
    return error?.status === 429
        || message.includes("[NovelAI 429]")
        || message.includes("error code: 1015")
        || message.includes("Concurrent generation is locked");
}

export function isFatalNovelAiError(error) {
    return [400, 401, 402, 403].includes(Number(error?.status || 0));
}

export function classifyPlannerGenerationError(error) {
    if (isNovelAiRateLimitError(error) || error?.code === "NOVELAI_COOLDOWN") return "rate_limit";
    if (isFatalNovelAiError(error)) return "fatal";
    if (error?.code === "NOVELAI_REQUEST_TIMEOUT") return "transient";
    if (Number(error?.status || 0) >= 500) return "transient";
    if (error?.code === "R2_PUT_RETRY_EXHAUSTED") return "storage";
    const message = error?.message || String(error || "");
    if (/fetch failed|network|connection|service.?unavailable|timeout/i.test(message)) return "transient";
    return "generation";
}

export function getPlannerRetryDelaySeconds(error, attempt) {
    if (error?.code === "NOVELAI_COOLDOWN") {
        return Math.max(30, Number(error.retryAfterSeconds || 60));
    }
    if (isNovelAiRateLimitError(error)) {
        const index = Math.min(Math.max(Number(attempt || 1) - 1, 0), NOVELAI_RATE_LIMIT_DELAYS.length - 1);
        return Math.max(Number(error.retryAfterSeconds || 0), NOVELAI_RATE_LIMIT_DELAYS[index]);
    }
    return Math.min(60 * Math.max(1, Number(attempt || 1)), 300);
}
