import assert from 'node:assert/strict';
import { handleGuestApi } from '../src/guest-api.js';

function makeObject(key, customMetadata, body = `image:${key}`) {
    return {
        key,
        body,
        size: body.length,
        uploaded: new Date('2026-08-11T00:00:00.000Z'),
        httpEtag: `"${key}"`,
        customMetadata,
        writeHttpMetadata(headers) {
            headers.set('Content-Type', 'application/octet-stream');
        }
    };
}

const objects = new Map([
    ['project/character/1.webp', makeObject('project/character/1.webp', {
        ispublic: 'true',
        visibilityconfigured: 'true'
    })],
    ['project/character/2.webp', makeObject('project/character/2.webp', {
        ispublic: 'false',
        visibilityconfigured: 'true'
    })],
    ['project/character/3.webp', makeObject('project/character/3.webp', {
        ispublic: 'false'
    })],
    ['project/character/4.webp', makeObject('project/character/4.webp', undefined)],
    ['project/character/_planner_temp_image/internal.webp', makeObject(
        'project/character/_planner_temp_image/internal.webp',
        { ispublic: 'true', visibilityconfigured: 'true' }
    )],
    ['project/character/note.txt', makeObject('project/character/note.txt', {
        ispublic: 'true',
        visibilityconfigured: 'true'
    }, 'note')]
]);

const characterListOptions = [];

const env = {
    DB: {
        prepare(sql) {
            const normalized = sql.replace(/\s+/g, ' ').trim();
            return {
                bind(...values) {
                    return {
                        async first() {
                            if (normalized.includes('FROM v2_projects')) {
                                const projectMatches = values.some(value => value === 'project' || value === 'project/');
                                return projectMatches
                                    ? { id: 'project-id', name: 'Project', prefix: 'project/' }
                                    : null;
                            }
                            return null;
                        },
                        async all() {
                            if (normalized.includes('FROM aliases')) return { results: [] };
                            if (normalized.includes('FROM v2_situations')) return { results: [] };
                            if (normalized.includes('FROM v2_characters')) {
                                return {
                                    results: [{
                                        id: 'character-id',
                                        name: 'Character',
                                        prefix: 'project/character/',
                                        sort_order: 0
                                    }]
                                };
                            }
                            return { results: [] };
                        }
                    };
                }
            };
        }
    },
    imgBucket: {
        async list(options = {}) {
            if (options.prefix === 'project/' && options.delimiter === '/') {
                return {
                    objects: [],
                    delimitedPrefixes: ['project/character/'],
                    truncated: false
                };
            }
            if (options.prefix === 'project/character/') {
                characterListOptions.push(options);
                const page = options.cursor
                    ? [
                        objects.get('project/character/3.webp'),
                        objects.get('project/character/4.webp'),
                        objects.get('project/character/_planner_temp_image/internal.webp'),
                        objects.get('project/character/note.txt')
                    ]
                    : [
                        objects.get('project/character/1.webp'),
                        objects.get('project/character/2.webp')
                    ];
                return {
                    objects: page,
                    delimitedPrefixes: [],
                    truncated: !options.cursor,
                    cursor: options.cursor ? undefined : 'next-page'
                };
            }
            return { objects: [], delimitedPrefixes: [], truncated: false };
        },
        async get(key) {
            return objects.get(key) || null;
        },
        async head(key) {
            const object = objects.get(key);
            return object ? { ...object, body: undefined } : null;
        }
    }
};

async function guestRequest(path, { method = 'GET', isAdmin = false } = {}) {
    const request = new Request(`https://example.com${path}`, { method });
    const response = await handleGuestApi(request, env, isAdmin, {});
    assert.ok(response, `Guest route was not handled: ${method} ${path}`);
    return response;
}

const summaryResponse = await guestRequest('/api/guest/projects/project');
assert.equal(summaryResponse.status, 200);
assert.equal(summaryResponse.headers.get('Cache-Control'), 'no-store, no-cache, must-revalidate');
const summary = (await summaryResponse.json()).data;
assert.equal(summary.characters.length, 1);
assert.equal(summary.characters[0].imageCount, 1);
assert.match(summary.characters[0].coverUrl, /file=1\.webp$/);

const detailResponse = await guestRequest('/api/guest/projects/project/characters/character');
assert.equal(detailResponse.status, 200);
const detail = (await detailResponse.json()).data;
assert.deepEqual(detail.images.map(image => image.path), ['1.webp']);
assert.ok(characterListOptions.length >= 2);
assert.ok(characterListOptions.every(options => options.include?.includes('customMetadata')));

const publicGetResponse = await guestRequest(
    '/api/guest/projects/project/characters/character/image?file=1.webp'
);
assert.equal(publicGetResponse.status, 200);
assert.equal(publicGetResponse.headers.get('Cache-Control'), 'no-store');
assert.equal(await publicGetResponse.text(), 'image:project/character/1.webp');

const publicHeadResponse = await guestRequest(
    '/api/guest/projects/project/characters/character/image?file=1.webp',
    { method: 'HEAD' }
);
assert.equal(publicHeadResponse.status, 200);
assert.equal(publicHeadResponse.headers.get('Cache-Control'), 'no-store');
assert.equal(await publicHeadResponse.text(), '');

for (const file of ['2.webp', '3.webp', '4.webp', '_planner_temp_image%2Finternal.webp']) {
    const response = await guestRequest(
        `/api/guest/projects/project/characters/character/image?file=${file}`
    );
    assert.equal(response.status, 404, `${file} must not be available to guests`);
    assert.equal(response.headers.get('Cache-Control'), 'no-store, no-cache, must-revalidate');
}

const privateAdminGuestResponse = await guestRequest(
    '/api/guest/projects/project/characters/character/image?file=2.webp',
    { isAdmin: true }
);
assert.equal(privateAdminGuestResponse.status, 404);

const otherCharacterResponse = await guestRequest(
    '/api/guest/projects/project/characters/other/image?file=1.webp'
);
assert.equal(otherCharacterResponse.status, 404);

console.log('guest image visibility checks passed');
