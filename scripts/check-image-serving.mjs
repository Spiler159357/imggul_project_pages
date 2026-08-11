import assert from 'node:assert/strict';
import { makeR2ImageVisibilityMetadata, serveR2Image } from '../src/image-serving.js';

function makeObject(key, isPublic, body = 'image-data', visibilityWasConfigured = true) {
    return {
        key,
        body,
        httpEtag: '"test-etag"',
        customMetadata: {
            ispublic: isPublic ? 'true' : 'false',
            ...(visibilityWasConfigured ? { visibilityconfigured: 'true' } : {})
        },
        writeHttpMetadata(headers) {
            headers.set('Content-Type', 'application/octet-stream');
        }
    };
}

function makeEnv(objects) {
    return {
        secretKey: 'admin-secret',
        imgBucket: {
            async get(key) {
                return objects.get(key) || null;
            },
            async head(key) {
                const object = objects.get(key);
                return object ? { ...object, body: undefined } : null;
            }
        }
    };
}

async function requestImage(env, key, init = {}) {
    return serveR2Image({
        request: new Request(`https://example.com/i/${key}`, init),
        env,
        rawKey: key
    });
}

const objects = new Map([
    ['project/public.webp', makeObject('project/public.webp', true)],
    ['project/private.webp', makeObject('project/private.webp', false)],
    ['project/legacy.webp', makeObject('project/legacy.webp', false, 'image-data', false)],
    ['project/_planner_temp_image/internal.webp', makeObject('project/_planner_temp_image/internal.webp', true)]
]);
const env = makeEnv(objects);

const publicResponse = await requestImage(env, 'project/public.webp');
assert.equal(publicResponse.status, 200);
assert.equal(publicResponse.headers.get('Content-Type'), 'image/webp');
assert.equal(publicResponse.headers.get('Access-Control-Allow-Origin'), '*');
assert.equal(publicResponse.headers.get('Cache-Control'), 'no-cache, must-revalidate');

const privateAnonymousResponse = await requestImage(env, 'project/private.webp');
assert.equal(privateAnonymousResponse.status, 404);
assert.equal(privateAnonymousResponse.headers.get('Cache-Control'), 'no-store');

const legacyResponse = await requestImage(env, 'project/legacy.webp');
assert.equal(legacyResponse.status, 200);
assert.equal(legacyResponse.headers.get('Cache-Control'), 'no-cache, must-revalidate');

const privateAdminResponse = await requestImage(env, 'project/private.webp', {
    headers: { Cookie: 'auth=admin-secret' }
});
assert.equal(privateAdminResponse.status, 200);
assert.equal(privateAdminResponse.headers.get('Cache-Control'), 'private, no-store');
assert.equal(privateAdminResponse.headers.has('Access-Control-Allow-Origin'), false);

const internalAnonymousResponse = await requestImage(env, 'project/_planner_temp_image/internal.webp');
assert.equal(internalAnonymousResponse.status, 404);

const headResponse = await requestImage(env, 'project/public.webp', { method: 'HEAD' });
assert.equal(headResponse.status, 200);
assert.equal(await headResponse.text(), '');

const traversalResponse = await requestImage(env, 'project/../private.webp');
assert.equal(traversalResponse.status, 404);

assert.deepEqual(makeR2ImageVisibilityMetadata('project/new.webp'), {
    ispublic: 'true',
    visibilityconfigured: 'true',
    visibilitysource: 'default'
});
assert.deepEqual(makeR2ImageVisibilityMetadata('project/private.webp', {
    ispublic: 'false',
    visibilityconfigured: 'true',
    visibilitysource: 'user'
}), {
    ispublic: 'false',
    visibilityconfigured: 'true',
    visibilitysource: 'user'
});
assert.deepEqual(makeR2ImageVisibilityMetadata('project/candidate.webp', {}, {
    forcePrivate: true
}), {
    ispublic: 'false',
    visibilityconfigured: 'true',
    visibilitysource: 'system'
});
assert.equal(makeR2ImageVisibilityMetadata('project/save-as.webp', {
    ispublic: 'false',
    visibilityconfigured: 'true'
}, { preserveExplicitPrivate: false }).ispublic, 'true');

console.log('image-serving checks passed');
