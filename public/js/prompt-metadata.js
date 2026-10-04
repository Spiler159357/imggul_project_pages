export const PROMPT_COMPONENTS_METADATA_KEY = 'Prompt Components';
export const PROMPT_COMPONENTS_VERSION = 2;

function normalizePromptText(value) {
    return String(value || '').trim();
}

export function buildPromptComponentsMetadata({
    userNegativePrompt = '',
    appliedDefaultNegativePrompt = ''
} = {}) {
    return {
        version: PROMPT_COMPONENTS_VERSION,
        userNegativePrompt: normalizePromptText(userNegativePrompt),
        appliedDefaultNegativePrompt: normalizePromptText(appliedDefaultNegativePrompt)
    };
}

export function stripLeadingDefaultNegativePrompt(negativePrompt = '', defaultNegativePrompt = '') {
    const defaultPrompt = normalizePromptText(defaultNegativePrompt);
    let remaining = normalizePromptText(negativePrompt);
    if (!defaultPrompt || !remaining) return remaining;

    while (remaining) {
        if (remaining === defaultPrompt) return '';
        if (!remaining.startsWith(defaultPrompt)) break;

        const suffix = remaining.slice(defaultPrompt.length);
        if (!suffix.startsWith(',')) break;
        remaining = suffix.slice(1).trimStart();
    }

    return remaining;
}

export function resolveImportedNegativePrompt(metadata = {}, currentDefaults = {}) {
    const source = metadata && typeof metadata === 'object' ? metadata : {};
    const components = source[PROMPT_COMPONENTS_METADATA_KEY];
    if (
        components
        && typeof components === 'object'
        && Object.prototype.hasOwnProperty.call(components, 'userNegativePrompt')
    ) {
        return normalizePromptText(components.userNegativePrompt);
    }

    const effectiveNegativePrompt = normalizePromptText(source['Negative Prompt']);
    if (!effectiveNegativePrompt) return '';

    if (
        components
        && typeof components === 'object'
        && Object.prototype.hasOwnProperty.call(components, 'appliedDefaultNegativePrompt')
    ) {
        return stripLeadingDefaultNegativePrompt(
            effectiveNegativePrompt,
            components.appliedDefaultNegativePrompt
        );
    }

    if (currentDefaults.useDefaultNegativePrompt === false) return effectiveNegativePrompt;
    return stripLeadingDefaultNegativePrompt(
        effectiveNegativePrompt,
        currentDefaults.defaultNegativePrompt
            ?? currentDefaults.rawDefaultNegativePrompt
            ?? ''
    );
}
