const PROMPT_WEIGHT_SELECTOR = [
    '#prompt-raw',
    '.prompt-input',
    '#nai-negative',
    '#project-style-prompt-input',
    '#character-prompt-character-input',
    '#character-prompt-clothing-input',
    '#character-prompt-expression-input',
    '#character-prompt-negative-input',
    '#situation-composition-input',
    '#situation-expression-input',
    '#situation-action-input',
    '#situation-negative-input'
].join(', ');

const EMPHASIS_STEP = 1.05;
const WEIGHT_RE = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))::/;

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
    if (!html) return '';

    const delta = Math.abs(weight - 1);
    const alpha = clamp(0.08 + (delta / 0.8) * 0.24, 0.08, 0.32).toFixed(3);
    const outlineAlpha = clamp(0.12 + (delta / 0.8) * 0.2, 0.12, 0.32).toFixed(3);
    const label = weight.toFixed(2).replace(/\.?0+$/, '');
    const className = weight >= 1 ? 'nai-weight-strong' : 'nai-weight-weak';

    return `<span class="nai-weight-token ${className}" style="--nai-weight-alpha:${alpha};--nai-weight-outline-alpha:${outlineAlpha}" title="weight ${label}">${html}</span>`;
}

function findStrictNumericWeightClose(text, start) {
    return text.indexOf('::', start);
}

function parsePromptSegment(text, baseWeight = 1) {
    let html = '';
    let weighted = false;

    for (let i = 0; i < text.length;) {
        const numericMatch = text.slice(i).match(WEIGHT_RE);
        if (numericMatch) {
            const weight = Number(numericMatch[1]);
            const bodyStart = i + numericMatch[0].length;
            if (Number.isFinite(weight)) {
                const bodyEnd = findStrictNumericWeightClose(text, bodyStart);
                if (bodyEnd !== -1 && bodyEnd > bodyStart) {
                    const rawBody = text.slice(bodyStart, bodyEnd);
                    const chunkHtml = `${escapeHtml(numericMatch[0])}${escapeHtml(rawBody)}${escapeHtml('::')}`.replace(/\n/g, '<br>');
                    html += renderWeightedChunk(chunkHtml, baseWeight * weight);
                    weighted = true;
                    i = bodyEnd + 2;
                    continue;
                }
            }
        }

        const char = text[i];
        if (char === '{' || char === '[') {
            const closeToken = char === '{' ? '}' : ']';
            const end = findClosingToken(text, i + 1, char, closeToken);
            if (end !== -1) {
                const nextWeight = baseWeight * (char === '{' ? EMPHASIS_STEP : 1 / EMPHASIS_STEP);
                const child = parsePromptSegment(text.slice(i + 1, end), nextWeight);
                html += renderWeightedChunk(`${escapeHtml(char)}${child.html}${escapeHtml(closeToken)}`, nextWeight);
                weighted = true;
                i = end + 1;
                continue;
            }
        }

        html += escapeHtml(char);
        i += 1;
    }

    return { html: html.replace(/\n/g, '<br>'), weighted };
}

function renderPromptWeightPreview(value) {
    const parsed = parsePromptSegment(value || '');
    return parsed.html || '<br>';
}

function getOverlayElement(input) {
    const existingId = input.dataset.naiWeightOverlayId;
    if (existingId) {
        const existing = document.getElementById(existingId);
        if (existing) return existing;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'nai-weight-editor';
    if (input.classList.contains('flex-1')) wrapper.classList.add('flex-1');
    if (input.classList.contains('w-full')) wrapper.classList.add('w-full');

    const initialStyle = window.getComputedStyle(input);
    const overlay = document.createElement('div');
    overlay.id = `nai-weight-overlay-${Math.random().toString(36).slice(2)}`;
    overlay.className = 'nai-weight-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.dataset.naiWeightBackground = initialStyle.backgroundColor;
    overlay.dataset.naiWeightColor = initialStyle.color;

    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(overlay);
    wrapper.appendChild(input);
    input.classList.add('nai-weight-textarea');
    input.dataset.naiWeightOverlayId = overlay.id;

    return overlay;
}

function syncOverlayMetrics(input, overlay) {
    const style = window.getComputedStyle(input);
    const wrapper = input.closest('.nai-weight-editor');
    if (wrapper) wrapper.classList.toggle('hidden', input.classList.contains('hidden'));

    overlay.style.padding = style.padding;
    overlay.style.font = style.font;
    overlay.style.lineHeight = style.lineHeight;
    overlay.style.letterSpacing = style.letterSpacing;
    overlay.style.borderWidth = style.borderWidth;
    overlay.style.borderStyle = 'solid';
    overlay.style.backgroundColor = overlay.dataset.naiWeightBackground || style.backgroundColor;
    overlay.style.color = overlay.dataset.naiWeightColor || style.color;
    overlay.style.minHeight = style.minHeight;
    overlay.style.borderRadius = style.borderRadius;
}

function updatePromptWeightPreview(input) {
    const overlay = getOverlayElement(input);
    const html = renderPromptWeightPreview(input.value || '');
    syncOverlayMetrics(input, overlay);
    overlay.innerHTML = html;
    overlay.scrollTop = input.scrollTop;
    overlay.scrollLeft = input.scrollLeft;
}

function bindPromptWeightInput(input) {
    if (!input || input.tagName !== 'TEXTAREA' || input.dataset.naiWeightBound === 'true') return;
    input.dataset.naiWeightBound = 'true';
    input.addEventListener('input', () => updatePromptWeightPreview(input));
    input.addEventListener('scroll', () => {
        const overlay = document.getElementById(input.dataset.naiWeightOverlayId || '');
        if (!overlay) return;
        overlay.scrollTop = input.scrollTop;
        overlay.scrollLeft = input.scrollLeft;
    });
    updatePromptWeightPreview(input);
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
    window.refreshNaiPromptWeightPreviews = () => scanPromptWeightInputs();
}
