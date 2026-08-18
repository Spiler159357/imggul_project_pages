export function getSituationDocumentChanges(previousValue, nextValue, getSituationId) {
    if (typeof getSituationId !== 'function') throw new Error('getSituationId is required');

    const previousSituations = Array.isArray(previousValue?.situations) ? previousValue.situations : [];
    const nextSituations = Array.isArray(nextValue?.situations) ? nextValue.situations : [];
    const previousById = new Map(previousSituations.map((situation, index) => [
        getSituationId(situation, index),
        { situation, index }
    ]));
    const nextById = new Map(nextSituations.map((situation, index) => [
        getSituationId(situation, index),
        { situation, index }
    ]));
    const changed = [];

    nextById.forEach((entry, situationId) => {
        const previous = previousById.get(situationId);
        if (
            !previous
            || previous.index !== entry.index
            || JSON.stringify(previous.situation || {}) !== JSON.stringify(entry.situation || {})
        ) {
            changed.push({ situationId, ...entry });
        }
    });

    const removed = [];
    previousById.forEach((entry, situationId) => {
        if (!nextById.has(situationId)) removed.push({ situationId, ...entry });
    });

    return { changed, removed };
}
