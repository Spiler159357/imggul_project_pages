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

let deletedCommentId = '';

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
                            if (normalized.includes('FROM guest_comments c')) {
                                return values[0] === 'private-comment'
                                    ? {
                                        id: 'private-comment',
                                        post_id: 'private-post',
                                        project_id: 'private-project',
                                        project_is_public: 0,
                                        password_hash: 'unused',
                                        password_salt: 'unused'
                                    }
                                    : null;
                            }
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
                            if (normalized.startsWith('DELETE FROM guest_comments')) {
                                deletedCommentId = String(values[0] || '');
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

projects.get('private-project').is_public = 0;
const privateCommentResponse = await guestApi('/api/guest/comments/private-comment', {
    method: 'PATCH',
    body: {
        password: 'password-123',
        authorName: 'Guest',
        body: 'Updated'
    }
});
assert.equal(privateCommentResponse.status, 404);
assert.deepEqual(await privateCommentResponse.json(), {
    error: { code: 'COMMENT_NOT_FOUND', message: '댓글을 찾을 수 없습니다.' }
});

const adminCommentDeleteResponse = await guestApi('/api/guest/comments/private-comment', {
    method: 'DELETE',
    isAdmin: true
});
assert.equal(adminCommentDeleteResponse.status, 200);
assert.equal(deletedCommentId, 'private-comment');

console.log('project visibility checks passed');
