import assert from 'node:assert/strict';
import {
    PROMPT_COMPONENTS_METADATA_KEY,
    buildPromptComponentsMetadata,
    resolveImportedNegativePrompt,
    stripLeadingDefaultNegativePrompt
} from '../public/js/prompt-metadata.js';

const defaultNegative = 'lowres, bad anatomy';

assert.equal(
    stripLeadingDefaultNegativePrompt('lowres, bad anatomy, extra fingers', defaultNegative),
    'extra fingers'
);
assert.equal(
    stripLeadingDefaultNegativePrompt('lowres, bad anatomy, lowres, bad anatomy, extra fingers', defaultNegative),
    'extra fingers'
);
assert.equal(stripLeadingDefaultNegativePrompt(defaultNegative, defaultNegative), '');
assert.equal(
    stripLeadingDefaultNegativePrompt('extra fingers, lowres, bad anatomy', defaultNegative),
    'extra fingers, lowres, bad anatomy'
);

const currentDefaults = {
    useDefaultNegativePrompt: true,
    defaultNegativePrompt: defaultNegative
};
assert.equal(resolveImportedNegativePrompt({
    'Negative Prompt': `${defaultNegative}, extra fingers`,
    [PROMPT_COMPONENTS_METADATA_KEY]: buildPromptComponentsMetadata({
        userNegativePrompt: 'extra fingers',
        appliedDefaultNegativePrompt: defaultNegative
    })
}, currentDefaults), 'extra fingers');

assert.equal(resolveImportedNegativePrompt({
    'Negative Prompt': 'old default, extra fingers',
    [PROMPT_COMPONENTS_METADATA_KEY]: buildPromptComponentsMetadata({
        userNegativePrompt: 'extra fingers',
        appliedDefaultNegativePrompt: 'old default'
    })
}, currentDefaults), 'extra fingers');

assert.equal(resolveImportedNegativePrompt({
    'Negative Prompt': 'old default, extra fingers',
    [PROMPT_COMPONENTS_METADATA_KEY]: {
        version: 2,
        appliedDefaultNegativePrompt: 'old default'
    }
}, currentDefaults), 'extra fingers');

assert.equal(resolveImportedNegativePrompt({
    'Negative Prompt': `${defaultNegative}, ${defaultNegative}, extra fingers`
}, currentDefaults), 'extra fingers');

assert.equal(resolveImportedNegativePrompt({
    'Negative Prompt': `${defaultNegative}, extra fingers`
}, {
    useDefaultNegativePrompt: false,
    defaultNegativePrompt: defaultNegative
}), `${defaultNegative}, extra fingers`);

assert.equal(resolveImportedNegativePrompt({
    'Negative Prompt': defaultNegative,
    [PROMPT_COMPONENTS_METADATA_KEY]: buildPromptComponentsMetadata({
        userNegativePrompt: '',
        appliedDefaultNegativePrompt: defaultNegative
    })
}, currentDefaults), '');

console.log('Prompt metadata checks passed.');
