import assert from 'node:assert/strict';
import { handleGuestApi } from '../src/guest-api.js';

const posts = new Map();
const comments = new Map();
const rateLimits = new Map();

function postRow(id) {
    const post = posts.get(id);
    if (!post) return null;
    return {
        ...post,
        comment_count: [...comments.values()].filter(comment => comment.post_id === id).length
    };
}

const env = {
    DB: {
        prepare(sql) {
            const normalized = sql.replace(/\s+/g, ' ').trim();
            return {
                bind(...values) {
                    return {
                        async all() {
                            if (normalized.includes('FROM guest_posts p') && normalized.includes('GROUP BY p.id')) {
                                return {
                                    results: [...posts.values()]
                                        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
                                        .map(post => postRow(post.id))
                                };
                            }
                            if (normalized.includes('FROM guest_comments') && normalized.includes('ORDER BY created_at ASC')) {
                                return {
                                    results: [...comments.values()]
                                        .filter(comment => comment.post_id === values[0])
                                        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
                                };
                            }
                            return { results: [] };
                        },
                        async first() {
                            if (normalized.includes('SELECT p.*') && normalized.includes('FROM guest_posts p')) {
                                return postRow(String(values[0] || ''));
                            }
                            if (normalized.includes('SELECT id, post_id, parent_comment_id') && normalized.includes('FROM guest_comments')) {
                                return comments.get(String(values[0] || '')) || null;
                            }
                            if (normalized.includes('FROM guest_comments WHERE post_id = ? AND request_key = ?')) {
                                return [...comments.values()].find(comment => (
                                    comment.post_id === values[0] && comment.request_key === values[1]
                                )) || null;
                            }
                            if (normalized.includes('SELECT request_count FROM guest_comment_rate_limits')) {
                                return { request_count: rateLimits.get(String(values[0] || '')) || 0 };
                            }
                            if (normalized.includes('SELECT c.*') && normalized.includes('JOIN guest_posts p')) {
                                return comments.get(String(values[0] || '')) || null;
                            }
                            return null;
                        },
                        async run() {
                            if (normalized.startsWith('INSERT INTO guest_posts')) {
                                const [id, title, body, imageKey, createdAt, updatedAt] = values;
                                posts.set(id, {
                                    id, title, body, image_key: imageKey,
                                    created_at: createdAt, updated_at: updatedAt
                                });
                            } else if (normalized.startsWith('INSERT INTO guest_comment_rate_limits')) {
                                const bucketKey = String(values[0] || '');
                                rateLimits.set(bucketKey, (rateLimits.get(bucketKey) || 0) + 1);
                            } else if (normalized.startsWith('INSERT INTO guest_comments')) {
                                const [id, postId, parentCommentId, authorName, body, passwordHash, passwordSalt, requestKey, createdAt, updatedAt] = values;
                                comments.set(id, {
                                    id,
                                    post_id: postId,
                                    parent_comment_id: parentCommentId,
                                    author_name: authorName,
                                    body,
                                    password_hash: passwordHash,
                                    password_salt: passwordSalt,
                                    request_key: requestKey,
                                    created_at: createdAt,
                                    updated_at: updatedAt
                                });
                            } else if (normalized.startsWith('DELETE FROM guest_comments')) {
                                const id = String(values[0] || '');
                                comments.delete(id);
                                for (const [commentId, comment] of comments) {
                                    if (comment.parent_comment_id === id) comments.delete(commentId);
                                }
                            }
                            return { success: true };
                        }
                    };
                }
            };
        }
    },
    imgBucket: {
        async put() {},
        async get() { return null; },
        async head() { return null; },
        async delete() {}
    }
};

async function request(path, { method = 'GET', isAdmin = false, json, form } = {}) {
    const headers = json === undefined ? undefined : { 'Content-Type': 'application/json' };
    const response = await handleGuestApi(new Request(`https://example.com${path}`, {
        method,
        headers,
        body: form || (json === undefined ? undefined : JSON.stringify(json))
    }), env, isAdmin, {});
    assert.ok(response, `${method} ${path} was not handled`);
    return response;
}

async function createPost(title) {
    const form = new FormData();
    form.set('title', title);
    form.set('body', `${title} body`);
    const response = await request('/api/admin/posts', { method: 'POST', isAdmin: true, form });
    assert.equal(response.status, 201);
    return (await response.json()).data;
}

async function createComment(postId, { parentCommentId = null, requestId }) {
    const response = await request(`/api/guest/posts/${postId}/comments`, {
        method: 'POST',
        json: {
            authorName: 'Guest',
            password: 'password-123',
            body: parentCommentId ? 'Reply' : 'Comment',
            requestId,
            ...(parentCommentId ? { parentCommentId } : {})
        }
    });
    return response;
}

const unauthorized = await request('/api/admin/posts', { method: 'POST', form: new FormData() });
assert.equal(unauthorized.status, 403);

const firstPost = await createPost('First');
const secondPost = await createPost('Second');

const listResponse = await request('/api/guest/posts');
assert.equal(listResponse.status, 200);
assert.equal((await listResponse.json()).data.items.length, 2);

const commentResponse = await createComment(firstPost.id, { requestId: 'comment-1' });
assert.equal(commentResponse.status, 201);
const comment = (await commentResponse.json()).data;

const replyResponse = await createComment(firstPost.id, { parentCommentId: comment.id, requestId: 'reply-1' });
assert.equal(replyResponse.status, 201);
const reply = (await replyResponse.json()).data;

const nestedReply = await createComment(firstPost.id, { parentCommentId: reply.id, requestId: 'reply-2' });
assert.equal(nestedReply.status, 400);

const crossPostReply = await createComment(secondPost.id, { parentCommentId: comment.id, requestId: 'reply-3' });
assert.equal(crossPostReply.status, 404);

const detailResponse = await request(`/api/guest/posts/${firstPost.id}`);
assert.equal(detailResponse.status, 200);
const detail = (await detailResponse.json()).data;
assert.equal(detail.commentCount, 2);
assert.equal(detail.comments.length, 1);
assert.equal(detail.comments[0].replies.length, 1);
assert.equal(detail.comments[0].replies[0].id, reply.id);

const deleteResponse = await request(`/api/guest/comments/${comment.id}`, { method: 'DELETE', isAdmin: true });
assert.equal(deleteResponse.status, 200);
assert.equal(comments.size, 0);

const removedProjectRoute = await request('/api/guest/projects/project/posts');
assert.equal(removedProjectRoute.status, 404);

const removedAdminProjectRoute = await request('/api/admin/projects/project/posts', { isAdmin: true });
assert.equal(removedAdminProjectRoute.status, 404);

console.log('global post and reply checks passed');
