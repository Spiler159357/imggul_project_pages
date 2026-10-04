import assert from 'node:assert/strict';
import { handleGuestApi, resolveGuestProject } from '../src/guest-api.js';

const projects = new Map([
    ['public-project', {
        id: 'public-project',
        name: 'Public Project',
        prefix: 'public-project/',
        is_public: 1
    }],
    ['private-project', {
        id: 'private-project',
        name: 'Private Project',
        prefix: 'private-project/',
        is_public: 0
    }]
]);

function findProject(values) {
    return [...projects.values()].find(project => values.some(value => (
        value === project.id
        || value === project.prefix
        || value === project.prefix.replace(/\/+$/g, '')
    ))) || null;
}

const env = {
    DB: {
        prepare(sql) {
            const normalized = sql.replace(/\s+/g, ' ').trim();
            const statement = {
                async all() {
                    if (normalized.includes('SELECT id, prefix, is_public FROM v2_projects')) {
                        return { results: [...projects.values()] };
                    }
                    return { results: [] };
                },
                bind(...values) {
                    return {
                        async first() {
                            if (normalized.includes('FROM v2_projects')) {
                                const project = findProject(values);
                                if (!project) return null;
                                if (normalized.includes('is_public = 1') && project.is_public !== 1) return null;
                                return { ...project };
                            }
                            return null;
                        },
                        async run() {
                            if (normalized.startsWith('UPDATE v2_projects')) {
                                const [isPublic, updatedAt, projectId] = values;
                                const project = projects.get(projectId);
                                assert.ok(project);
                                assert.ok(updatedAt);
                                project.is_public = Number(isPublic);
                            }
                            return { success: true };
                        }
                    };
                }
            };
            return statement;
        }
    },
    imgBucket: {
        async list() {
            return { objects: [], delimitedPrefixes: [], truncated: false };
        }
    }
};

const publicProject = await resolveGuestProject(env, 'public-project');
assert.equal(publicProject?.id, 'public-project');
assert.equal(await resolveGuestProject(env, 'private-project'), null);
assert.equal(await resolveGuestProject(env, 'missing-project'), null);

async function guestApi(path, { method = 'GET', isAdmin = false, body } = {}) {
    const request = new Request(`https://example.com${path}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const response = await handleGuestApi(request, env, isAdmin, {});
    assert.ok(response);
    return response;
}

const privateResponse = await guestApi('/api/guest/projects/private-project');
const missingResponse = await guestApi('/api/guest/projects/missing-project');
assert.equal(privateResponse.status, 404);
assert.equal(missingResponse.status, 404);
assert.deepEqual(await privateResponse.json(), await missingResponse.json());

const unauthorizedList = await guestApi('/api/admin/project-visibility');
assert.equal(unauthorizedList.status, 403);

const visibilityList = await guestApi('/api/admin/project-visibility', { isAdmin: true });
assert.equal(visibilityList.status, 200);
const visibilityPayload = (await visibilityList.json()).data;
assert.deepEqual(
    visibilityPayload.projects.map(project => [project.id, project.isPublic]),
    [['public-project', true], ['private-project', false]]
);

const updateResponse = await guestApi('/api/admin/projects/private-project/visibility', {
    method: 'PATCH',
    isAdmin: true,
    body: { isPublic: true }
});
assert.equal(updateResponse.status, 200);
assert.equal((await updateResponse.json()).data.isPublic, true);
assert.equal(projects.get('private-project').is_public, 1);

console.log('project visibility checks passed');
