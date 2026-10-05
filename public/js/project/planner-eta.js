export function getPlannerGlobalCompletionIntervalSamples(events = [], limit = 100) {
    const samples = [];
    const sorted = [...events]
        .filter(event => Number.isFinite(Number(event?.createdAtMs)))
        .sort((a, b) => Number(a.createdAtMs) - Number(b.createdAtMs)
            || String(a.key || '').localeCompare(String(b.key || '')));
    for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (Number(previous.epoch || 0) !== Number(current.epoch || 0)) continue;
        const durationMs = Math.round(Number(current.createdAtMs) - Number(previous.createdAtMs));
        if (Number.isFinite(durationMs) && durationMs > 0) samples.push(durationMs);
    }
    return samples.slice(-Math.max(1, Number.parseInt(limit, 10) || 100));
}
