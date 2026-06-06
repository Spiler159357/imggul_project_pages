import { createOrUpdateDocument } from './storage.js';

export function createAutosave(editor, onStatus) {
    let timer = null;
    let lastSavedJson = '';

    async function flush() {
        if (!editor?.state?.documentId) return;
        const payload = editor.serializeDocument();
        const json = JSON.stringify(payload);
        if (json === lastSavedJson) return;
        onStatus?.('임시 저장 중...');
        try {
            await createOrUpdateDocument(payload);
            lastSavedJson = json;
            onStatus?.('임시 저장됨');
        } catch (err) {
            onStatus?.(`임시 저장 실패: ${err.message}`);
        }
    }

    return {
        schedule() {
            clearTimeout(timer);
            timer = setTimeout(flush, 900);
        },
        flush,
        stop() {
            clearTimeout(timer);
        }
    };
}
