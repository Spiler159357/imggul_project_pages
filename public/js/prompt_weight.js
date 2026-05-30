const PROMPT_WEIGHT_SELECTOR = [
    '#prompt-raw',
    '.prompt-input',
    '#nai-negative',
    '#project-style-prompt-input',
    '#character-prompt-character-input',
    '#character-prompt-clothing-input',
    '#character-prompt-negative-input',
    '#situation-composition-input',
    '#situation-expression-input',
    '#situation-action-input',
    '#situation-negative-input'
].join(', ');

const EMPHASIS_STEP = 1.05;
const WEIGHT_RE = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))::/;
const EDITOR_NAVIGATION_KEYS = new Set([
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
    'PageUp',
    'PageDown'
]);

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function findClosingToken(text, start, openToken, closeToken) {
    let depth = 1;
    for (let i = start; i < text.length; i += 1) {
        if (text[i] === openToken) depth += 1;
        else if (text[i] === closeToken) depth -= 1;
        if (depth === 0) return i;
    }
    return -1;
}

function renderWeightedChunk(html, weight) {
    const delta = Math.abs(weight - 1);
    const alpha = clamp(0.08 + (delta / 0.8) * 0.24, 0.08, 0.32).toFixed(3);
    const outlineAlpha = clamp(0.12 + (delta / 0.8) * 0.2, 0.12, 0.32).toFixed(3);
    const className = weight >= 1 ? 'nai-weight-strong' : 'nai-weight-weak';
    const label = weight.toFixed(2).replace(/\.?0+$/, '');
    return `<span class="nai-weight-token ${className}" style="--nai-weight-alpha:${alpha};--nai-weight-outline-alpha:${outlineAlpha}" title="weight ${label}">${html}</span>`;
}

function parsePromptSegment(text, baseWeight = 1) {
    let html = '';

    for (let i = 0; i < text.length;) {
        const numericMatch = text.slice(i).match(WEIGHT_RE);
        if (numericMatch) {
            const weight = Number(numericMatch[1]);
            const bodyStart = i + numericMatch[0].length;
            const bodyEnd = text.indexOf('::', bodyStart);
            if (Number.isFinite(weight) && bodyEnd > bodyStart) {
                const rawBody = text.slice(bodyStart, bodyEnd);
                const chunkHtml = `${escapeHtml(numericMatch[0])}${escapeHtml(rawBody)}${escapeHtml('::')}`.replace(/\n/g, '<br>');
                html += renderWeightedChunk(chunkHtml, baseWeight * weight);
                i = bodyEnd + 2;
                continue;
            }
        }

        const char = text[i];
        if (char === '{' || char === '[') {
            const closeToken = char === '{' ? '}' : ']';
            const end = findClosingToken(text, i + 1, char, closeToken);
            if (end !== -1) {
                const nextWeight = baseWeight * (char === '{' ? EMPHASIS_STEP : 1 / EMPHASIS_STEP);
                const child = parsePromptSegment(text.slice(i + 1, end), nextWeight);
                html += renderWeightedChunk(`${escapeHtml(char)}${child}${escapeHtml(closeToken)}`, nextWeight);
                i = end + 1;
                continue;
            }
        }

        html += escapeHtml(char);
        i += 1;
    }

    return html.replace(/\n/g, '<br>');
}

function getTextOffset(root) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !root.contains(selection.anchorNode)) return null;

    const range = selection.getRangeAt(0);
    const before = range.cloneRange();
    before.selectNodeContents(root);
    before.setEnd(range.startContainer, range.startOffset);
    return before.toString().length;
}

function setTextOffset(root, offset) {
    if (offset === null) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let node = walker.nextNode();

    while (node) {
        if (remaining <= node.nodeValue.length) {
            const range = document.createRange();
            range.setStart(node, remaining);
            range.collapse(true);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            return;
        }
        remaining -= node.nodeValue.length;
        node = walker.nextNode();
    }

    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
}

function normalizeEditorText(editor) {
    return editor.innerText.replace(/\r\n/g, '\n').replace(/\n$/, '');
}

function renderEditor(editor, value, preserveCaret = true) {
    const offset = preserveCaret ? getTextOffset(editor) : null;
    editor.innerHTML = value ? parsePromptSegment(value) : '';
    setTextOffset(editor, offset);
    resizeEditor(editor);
}

function syncTextareaFromEditor(textarea, editor) {
    textarea.value = normalizeEditorText(editor);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function resizeEditor(editor) {
    editor.style.height = 'auto';
    editor.style.height = `${editor.scrollHeight}px`;
}

function syncEditorFromTextarea(textarea) {
    const editor = document.getElementById(textarea.dataset.naiWeightEditorId || '');
    if (!editor) return;

    editor.classList.toggle('hidden', textarea.classList.contains('hidden'));
    editor.classList.toggle('block', textarea.classList.contains('block'));

    const value = textarea.value || '';
    if (normalizeEditorText(editor) === value) {
        resizeEditor(editor);
        return;
    }
    renderEditor(editor, value, false);
}

function copyTextareaShape(textarea, editor) {
    const style = window.getComputedStyle(textarea);
    editor.style.minHeight = style.minHeight;
    editor.style.font = style.font;
    editor.style.lineHeight = style.lineHeight;
    editor.style.letterSpacing = style.letterSpacing;
}

function createEditor(textarea) {
    const editor = document.createElement('div');
    editor.id = `nai-weight-editor-${Math.random().toString(36).slice(2)}`;
    editor.className = textarea.className;
    editor.classList.remove('auto-resize-textarea');
    editor.classList.add('nai-weight-editor');
    editor.contentEditable = 'true';
    editor.spellcheck = textarea.spellcheck;
    editor.dataset.placeholder = textarea.getAttribute('placeholder') || '';
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');
    if (textarea.getAttribute('aria-label')) editor.setAttribute('aria-label', textarea.getAttribute('aria-label'));

    textarea.dataset.naiWeightEditorId = editor.id;
    textarea.classList.add('nai-weight-source');
    textarea.setAttribute('aria-hidden', 'true');
    textarea.tabIndex = -1;
    textarea.insertAdjacentElement('afterend', editor);

    copyTextareaShape(textarea, editor);
    editor.classList.toggle('hidden', textarea.classList.contains('hidden'));
    editor.classList.toggle('block', textarea.classList.contains('block'));
    renderEditor(editor, textarea.value || '', false);

    editor.addEventListener('input', () => {
        syncTextareaFromEditor(textarea, editor);
        resizeEditor(editor);
    });

    editor.addEventListener('blur', () => {
        syncTextareaFromEditor(textarea, editor);
        renderEditor(editor, textarea.value || '', false);
    });

    editor.addEventListener('keydown', (event) => {
        if (EDITOR_NAVIGATION_KEYS.has(event.key)) {
            event.stopPropagation();
            return;
        }

        if (event.key === 'Enter' && !event.shiftKey && textarea.matches('.prompt-input, #nai-negative')) {
            event.preventDefault();
            syncTextareaFromEditor(textarea, editor);
            if (window.generateNaiImage) window.generateNaiImage();
        }
    });

    editor.addEventListener('paste', (event) => {
        event.preventDefault();
        const text = event.clipboardData?.getData('text/plain') || '';
        document.execCommand('insertText', false, text);
    });

    return editor;
}

function bindPromptWeightInput(textarea) {
    if (!textarea || textarea.tagName !== 'TEXTAREA' || textarea.dataset.naiWeightBound === 'true') return;
    textarea.dataset.naiWeightBound = 'true';
    createEditor(textarea);
}

function scanPromptWeightInputs(root = document) {
    root.querySelectorAll(PROMPT_WEIGHT_SELECTOR).forEach(bindPromptWeightInput);
}

export function initNaiPromptWeightPreviews() {
    scanPromptWeightInputs();

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (!(node instanceof Element)) return;
                if (node.matches?.(PROMPT_WEIGHT_SELECTOR)) bindPromptWeightInput(node);
                scanPromptWeightInputs(node);
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    window.refreshNaiPromptWeightPreviews = () => {
        scanPromptWeightInputs();
        document.querySelectorAll('textarea[data-nai-weight-editor-id]').forEach(syncEditorFromTextarea);
    };
}
