import assert from 'node:assert/strict';
import { compareNumberedFileNames } from '../public/js/file-name-sort.js';

const input = [
    'cover.webp',
    '10-1.webp',
    '2.webp',
    '1-10.webp',
    '10.webp',
    '1-2.webp',
    '1.webp',
    '2-1.webp',
    'sample10.webp',
    'sample2.webp'
];

assert.deepEqual([...input].sort(compareNumberedFileNames), [
    '1.webp',
    '2.webp',
    '10.webp',
    '1-2.webp',
    '1-10.webp',
    '2-1.webp',
    '10-1.webp',
    'cover.webp',
    'sample2.webp',
    'sample10.webp'
]);

assert.deepEqual([
    'character/2-10.png',
    'character/2-2.webp',
    'character/2-1.jpg'
].sort(compareNumberedFileNames), [
    'character/2-1.jpg',
    'character/2-2.webp',
    'character/2-10.png'
]);

console.log('file name sort checks passed');
