const SINGLE_NUMBER_PATTERN = /^(\d+)$/;
const PAIRED_NUMBER_PATTERN = /^(\d+)-(\d+)$/;

function getFileName(path) {
    return String(path || '').split(/[\\/]/).pop() || '';
}

function getFileStem(path) {
    return getFileName(path).replace(/\.[^.]+$/, '');
}

function normalizeDigits(value) {
    return String(value || '').replace(/^0+(?=\d)/, '');
}

function compareDigits(left, right) {
    const normalizedLeft = normalizeDigits(left);
    const normalizedRight = normalizeDigits(right);
    if (normalizedLeft.length !== normalizedRight.length) {
        return normalizedLeft.length - normalizedRight.length;
    }
    if (normalizedLeft < normalizedRight) return -1;
    if (normalizedLeft > normalizedRight) return 1;
    return 0;
}

function parseNumberedFileName(path) {
    const stem = getFileStem(path);
    const singleMatch = stem.match(SINGLE_NUMBER_PATTERN);
    if (singleMatch) return { group: 0, primary: singleMatch[1], secondary: '' };

    const pairedMatch = stem.match(PAIRED_NUMBER_PATTERN);
    if (pairedMatch) return { group: 1, primary: pairedMatch[1], secondary: pairedMatch[2] };

    return { group: 2, primary: '', secondary: '' };
}

function compareFallback(left, right) {
    const leftName = getFileName(left);
    const rightName = getFileName(right);
    return leftName.localeCompare(rightName, 'ko', { numeric: true, sensitivity: 'base' })
        || leftName.localeCompare(rightName, 'ko');
}

/**
 * 파일명을 단일 숫자, 숫자 쌍, 기타 이름 그룹 순으로 정렬한다.
 * 각 숫자 그룹 안에서는 숫자값을 기준으로 오름차순 정렬한다.
 */
export function compareNumberedFileNames(left, right) {
    const leftParts = parseNumberedFileName(left);
    const rightParts = parseNumberedFileName(right);

    if (leftParts.group !== rightParts.group) return leftParts.group - rightParts.group;
    if (leftParts.group === 2) return compareFallback(left, right);

    const primaryComparison = compareDigits(leftParts.primary, rightParts.primary);
    if (primaryComparison) return primaryComparison;

    if (leftParts.group === 1) {
        const secondaryComparison = compareDigits(leftParts.secondary, rightParts.secondary);
        if (secondaryComparison) return secondaryComparison;
    }

    return compareFallback(left, right);
}
