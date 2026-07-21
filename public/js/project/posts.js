import {
    escapeHtml,
    escapeJsString,
    getActiveProject,
    refreshProjectIcons,
    renderEmptyState,
    renderProjectShell,
    rememberProjectRoute,
    setProjectRoute
} from './shared.js';

const POSTS_AUTO_REFRESH_MS = 15000;
let postsAutoRefreshTimer = null;
let postsAutoRefreshInFlight = false;
let postsVisibilityListenerBound = false;

function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    }).format(date);
}

async function readApiResponse(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || payload?.error || '요청을 처리하지 못했습니다.');
    return payload.data;
}

async function fetchProjectPosts(project) {
    const response = await fetch(`/api/admin/projects/${encodeURIComponent(project.id)}/posts?limit=50`, { cache: 'no-store' });
    const page = await readApiResponse(response);
    return page.items || [];
}

function postsRevision(posts) {
    return JSON.stringify((posts || []).map(post => [post.id, post.updatedAt, post.commentCount]));
}

function postRevision(post) {
    if (!post?.id) return '';
    return JSON.stringify([
        post.id,
        post.title,
        post.body,
        post.imageUrl,
        post.updatedAt,
        (post.comments || []).map(comment => [comment.id, comment.authorName, comment.body, comment.updatedAt])
    ]);
}

export async function loadProjectPosts(project, force = false) {
    if (!project) return [];
    if (!force && project.postsLoaded) return Array.isArray(project.posts) ? project.posts : [];
    project.posts = await fetchProjectPosts(project);
    project.postsLoaded = true;
    return project.posts;
}

function renderHeader(project) {
    return `
        <div class="h-14 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 sm:px-6 bg-white dark:bg-gray-800 flex-shrink-0 gap-3">
            <div class="flex items-center gap-2 min-w-0">
                <button type="button" onclick="window.openProjectDetail('${escapeJsString(project.id)}', false)" class="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition" aria-label="프로젝트로 돌아가기">
                    <i data-lucide="arrow-left" class="w-5 h-5"></i>
                </button>
                <div class="min-w-0">
                    <h1 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">${escapeHtml(project.name)}</h1>
                    <p class="text-[11px] text-gray-500 dark:text-gray-400">게시글</p>
                </div>
            </div>
            <button type="button" onclick="window.openAdminPostEditor()" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition">
                <i data-lucide="plus" class="w-4 h-4"></i><span>새 게시글</span>
            </button>
        </div>`;
}

function renderPostList(project, selectedId, state = {}) {
    const posts = Array.isArray(project.posts) ? project.posts : [];
    return `
        <aside id="admin-post-list-panel" class="min-h-0 rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 flex flex-col overflow-hidden">
            <div class="flex-shrink-0 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <h2 class="text-sm font-bold text-gray-900 dark:text-white">게시글 목록</h2>
                <p class="mt-0.5 text-[11px] text-gray-400">최신 작성 순 · ${posts.length}개</p>
            </div>
            <div id="admin-post-list-scroll" class="min-h-0 flex-1 overflow-y-auto p-2 space-y-2">
                ${state.loading ? renderEmptyState('게시글을 불러오는 중입니다.') : ''}
                ${state.error ? renderEmptyState(state.error) : ''}
                ${!state.loading && !state.error && posts.map(post => `
                    <button type="button" onclick="window.openAdminPost('${escapeJsString(post.id)}')" class="w-full rounded-lg border p-3 text-left transition ${post.id === selectedId ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/30' : 'border-gray-200 hover:border-indigo-300 dark:border-gray-700 dark:hover:border-indigo-600'}">
                        <span class="block truncate text-xs font-bold text-gray-800 dark:text-gray-100">${escapeHtml(post.title)}</span>
                        <span class="mt-1 block truncate text-[11px] text-gray-500 dark:text-gray-400">${escapeHtml(post.body || '내용 없음')}</span>
                        <span class="mt-2 flex items-center justify-between gap-2 text-[10px] text-gray-400">
                            <span>${escapeHtml(formatDate(post.updatedAt || post.createdAt))}</span>
                            <span>댓글 ${post.commentCount}</span>
                        </span>
                    </button>`).join('')}
                ${!state.loading && !state.error && !posts.length ? renderEmptyState('등록된 게시글이 없습니다.') : ''}
            </div>
        </aside>`;
}

function renderEmptyEditor() {
    return `
        <section class="min-h-[360px] rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 flex items-center justify-center p-8 text-center">
            <div>
                <i data-lucide="newspaper" class="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600"></i>
                <h2 class="mt-4 text-sm font-bold text-gray-700 dark:text-gray-200">게시글을 선택하거나 새로 작성하세요.</h2>
                <button type="button" onclick="window.openAdminPostEditor()" class="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700">새 게시글</button>
            </div>
        </section>`;
}

function renderEditor(post = null) {
    const isEdit = !!post?.id;
    return `
        <section class="min-h-0 rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 flex flex-col overflow-hidden">
            <div class="flex flex-shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <div>
                    <h2 class="text-sm font-bold text-gray-900 dark:text-white">${isEdit ? '게시글 수정' : '새 게시글'}</h2>
                    ${isEdit ? `<p class="mt-0.5 text-[10px] text-gray-400">작성 ${escapeHtml(formatDate(post.createdAt))}${post.edited ? ` · 수정 ${escapeHtml(formatDate(post.updatedAt))}` : ''}</p>` : ''}
                </div>
                ${isEdit ? `<button type="button" onclick="window.deleteAdminPost('${escapeJsString(post.id)}')" class="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20" aria-label="게시글 삭제"><i data-lucide="trash-2" class="h-4 w-4"></i></button>` : ''}
            </div>
            <div id="admin-post-editor-scroll" class="min-h-0 flex-1 overflow-y-auto p-4">
                <form id="admin-post-form" class="space-y-4" onsubmit="window.submitAdminPost(event)">
                    <input id="admin-post-id" type="hidden" value="${escapeHtml(post?.id || '')}">
                    <div>
                        <label for="admin-post-title" class="mb-1 block text-xs font-bold text-gray-600 dark:text-gray-300">제목</label>
                        <input id="admin-post-title" name="title" type="text" maxlength="100" value="${escapeHtml(post?.title || '')}" class="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white" required>
                    </div>
                    <div>
                        <label for="admin-post-body" class="mb-1 block text-xs font-bold text-gray-600 dark:text-gray-300">본문</label>
                        <textarea id="admin-post-body" name="body" maxlength="10000" rows="10" class="w-full resize-y rounded-lg border border-gray-300 bg-white p-2.5 text-sm leading-6 dark:border-gray-600 dark:bg-gray-700 dark:text-white">${escapeHtml(post?.body || '')}</textarea>
                    </div>
                    <div>
                        <div class="mb-1 flex items-center justify-between gap-2">
                            <label for="admin-post-image" class="text-xs font-bold text-gray-600 dark:text-gray-300">이미지 (선택)</label>
                            <button id="admin-post-image-remove" type="button" onclick="window.removeAdminPostImage()" class="${post?.imageUrl ? '' : 'hidden'} text-[11px] font-bold text-red-500">이미지 제거</button>
                        </div>
                        <input id="admin-post-image" name="image" type="file" accept="image/webp,image/png,image/jpeg" onchange="window.previewAdminPostImage(event)" class="block w-full text-xs text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:font-bold file:text-indigo-600 dark:text-gray-400 dark:file:bg-indigo-950/40 dark:file:text-indigo-300">
                        <input id="admin-post-remove-image" type="hidden" value="false">
                        <div id="admin-post-image-preview-wrap" class="${post?.imageUrl ? '' : 'hidden'} mt-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-900">
                            <img id="admin-post-image-preview" src="${escapeHtml(post?.imageUrl || '')}" alt="게시글 이미지 미리보기" class="mx-auto max-h-72 max-w-full object-contain">
                        </div>
                        <p class="mt-1 text-[10px] text-gray-400">WebP, PNG, JPG · 최대 10MiB</p>
                    </div>
                    <p id="admin-post-error" class="hidden text-xs text-red-500" role="alert"></p>
                    <div class="flex justify-end gap-2">
                        <button type="button" onclick="window.closeAdminPostEditor()" class="rounded-lg border border-gray-200 px-4 py-2 text-xs font-bold text-gray-600 dark:border-gray-700 dark:text-gray-300">취소</button>
                        <button id="admin-post-submit" type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700">${isEdit ? '변경 저장' : '게시글 등록'}</button>
                    </div>
                </form>
                ${isEdit ? `
                    <div class="mt-6 border-t border-gray-200 pt-5 dark:border-gray-700">
                        <h3 class="text-xs font-bold text-gray-700 dark:text-gray-200">댓글 ${post.comments?.length || 0}개</h3>
                        <div class="mt-3 space-y-2">
                            ${(post.comments || []).map(comment => `
                                <article class="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/50">
                                    <div class="flex items-start justify-between gap-3">
                                        <div class="min-w-0">
                                            <p class="truncate text-xs font-bold text-gray-700 dark:text-gray-200">${escapeHtml(comment.authorName)}</p>
                                            <p class="mt-0.5 text-[10px] text-gray-400">${escapeHtml(formatDate(comment.updatedAt || comment.createdAt))}${comment.edited ? ' · 수정됨' : ''}</p>
                                        </div>
                                        <button type="button" onclick="window.deleteAdminComment('${escapeJsString(comment.id)}')" class="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/20" aria-label="댓글 삭제"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>
                                    </div>
                                    <p class="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-gray-600 dark:text-gray-300">${escapeHtml(comment.body)}</p>
                                </article>`).join('') || '<p class="py-4 text-center text-xs text-gray-400">등록된 댓글이 없습니다.</p>'}
                        </div>
                    </div>` : ''}
            </div>
        </section>`;
}

export function renderProjectPostsSection(options = {}) {
    const project = getActiveProject();
    if (!project) return;
    const activePost = options.post !== undefined ? options.post : (window.PROJECT_ACTIVE_POST || null);
    window.PROJECT_ACTIVE_POST = activePost;
    renderProjectShell(`
        ${renderHeader(project)}
        <div class="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
            <div class="mx-auto grid min-h-full max-w-6xl grid-cols-1 gap-4 lg:grid-cols-[minmax(240px,2fr)_minmax(0,5fr)]">
                ${renderPostList(project, activePost?.id, options)}
                ${options.loadingDetail ? renderEmptyState('게시글 내용을 불러오는 중입니다.') : (activePost !== null ? renderEditor(activePost) : renderEmptyEditor())}
            </div>
        </div>`);
    refreshProjectIcons();
}

function isAdminPostEditorBusy(post) {
    const form = document.getElementById('admin-post-form');
    if (!form || !post?.id) return !!form;
    if (form.contains(document.activeElement)) return true;
    const title = document.getElementById('admin-post-title')?.value || '';
    const body = document.getElementById('admin-post-body')?.value || '';
    const removeImage = document.getElementById('admin-post-remove-image')?.value === 'true';
    const hasImageFile = (document.getElementById('admin-post-image')?.files?.length || 0) > 0;
    return title !== (post.title || '') || body !== (post.body || '') || removeImage || hasImageFile;
}

function refreshAdminPostListOnly(project, selectedId) {
    const panel = document.getElementById('admin-post-list-panel');
    if (!panel) return;
    const scrollTop = document.getElementById('admin-post-list-scroll')?.scrollTop || 0;
    panel.outerHTML = renderPostList(project, selectedId);
    const scroll = document.getElementById('admin-post-list-scroll');
    if (scroll) scroll.scrollTop = scrollTop;
    refreshProjectIcons();
}

async function refreshVisibleAdminPosts() {
    if (document.hidden || window.PROJECT_ACTIVE_SECTION !== 'posts' || postsAutoRefreshInFlight) return;
    const project = getActiveProject();
    if (!project) return;
    postsAutoRefreshInFlight = true;
    try {
        const previousPostsRevision = postsRevision(project.posts);
        const nextPosts = await fetchProjectPosts(project);
        const listChanged = previousPostsRevision !== postsRevision(nextPosts);
        project.posts = nextPosts;
        project.postsLoaded = true;

        const activePost = window.PROJECT_ACTIVE_POST;
        if (!activePost?.id) {
            if (listChanged) refreshAdminPostListOnly(project, activePost?.id);
            return;
        }

        const response = await fetch(`/api/admin/posts/${encodeURIComponent(activePost.id)}`, { cache: 'no-store' });
        if (response.status === 404) {
            window.PROJECT_ACTIVE_POST = null;
            renderProjectPostsSection({ post: null });
            return;
        }
        const nextPost = await readApiResponse(response);
        const detailChanged = postRevision(activePost) !== postRevision(nextPost);
        if (!listChanged && !detailChanged) return;

        if (isAdminPostEditorBusy(activePost)) {
            if (listChanged) refreshAdminPostListOnly(project, activePost.id);
            return;
        }

        const listScrollTop = document.getElementById('admin-post-list-scroll')?.scrollTop || 0;
        const editorScrollTop = document.getElementById('admin-post-editor-scroll')?.scrollTop || 0;
        window.PROJECT_ACTIVE_POST = nextPost;
        renderProjectPostsSection({ post: nextPost });
        const listScroll = document.getElementById('admin-post-list-scroll');
        const editorScroll = document.getElementById('admin-post-editor-scroll');
        if (listScroll) listScroll.scrollTop = listScrollTop;
        if (editorScroll) editorScroll.scrollTop = editorScrollTop;
    } catch {
        // 자동 갱신 실패는 현재 화면을 유지하고 다음 주기에 다시 시도한다.
    } finally {
        postsAutoRefreshInFlight = false;
    }
}

function startAdminPostsAutoRefresh() {
    if (!postsAutoRefreshTimer) {
        postsAutoRefreshTimer = window.setInterval(refreshVisibleAdminPosts, POSTS_AUTO_REFRESH_MS);
    }
    if (!postsVisibilityListenerBound) {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) refreshVisibleAdminPosts();
        });
        postsVisibilityListenerBound = true;
    }
}

export async function openProjectPostsSection(skipHistory = false) {
    const project = getActiveProject();
    if (!project) return;
    window.PROJECT_ACTIVE_POST = null;
    renderProjectPostsSection({ loading: !project.postsLoaded });
    try {
        await loadProjectPosts(project);
        if (window.PROJECT_ACTIVE_SECTION === 'posts') renderProjectPostsSection();
    } catch (error) {
        if (window.PROJECT_ACTIVE_SECTION === 'posts') renderProjectPostsSection({ error: error.message });
    }
    const routeState = { projectView: 'section', projectId: project.id, projectSection: 'posts' };
    if (!skipHistory) setProjectRoute(routeState, `#project/${project.id}/posts`);
    else rememberProjectRoute(routeState, `#project/${project.id}/posts`);
    startAdminPostsAutoRefresh();
}

export function openAdminPostEditor() {
    window.PROJECT_ACTIVE_POST = {};
    renderProjectPostsSection({ post: {} });
    setTimeout(() => document.getElementById('admin-post-title')?.focus(), 0);
}

export function closeAdminPostEditor() {
    window.PROJECT_ACTIVE_POST = null;
    renderProjectPostsSection({ post: null });
}

export async function openAdminPost(postId, skipHistory = false) {
    const project = getActiveProject();
    if (!project) return;
    renderProjectPostsSection({ loadingDetail: true });
    try {
        const response = await fetch(`/api/admin/posts/${encodeURIComponent(postId)}`, { cache: 'no-store' });
        const post = await readApiResponse(response);
        window.PROJECT_ACTIVE_POST = post;
        renderProjectPostsSection({ post });
        const routeState = { projectView: 'post-detail', projectId: project.id, projectSection: 'posts', projectPostId: post.id };
        if (!skipHistory) setProjectRoute(routeState, `#project/${project.id}/posts/${post.id}`);
        else rememberProjectRoute(routeState, `#project/${project.id}/posts/${post.id}`);
    } catch (error) {
        renderProjectPostsSection({ error: error.message });
    }
}

export function previewAdminPostImage(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024 || !['image/webp', 'image/png', 'image/jpeg'].includes(file.type)) {
        event.target.value = '';
        const error = document.getElementById('admin-post-error');
        if (error) {
            error.textContent = 'WebP, PNG, JPG 형식의 10MiB 이하 이미지만 선택할 수 있습니다.';
            error.classList.remove('hidden');
        }
        return;
    }
    const image = document.getElementById('admin-post-image-preview');
    const wrap = document.getElementById('admin-post-image-preview-wrap');
    if (image) {
        if (image.src?.startsWith('blob:')) URL.revokeObjectURL(image.src);
        image.src = URL.createObjectURL(file);
    }
    wrap?.classList.remove('hidden');
    document.getElementById('admin-post-image-remove')?.classList.remove('hidden');
    document.getElementById('admin-post-remove-image').value = 'false';
}

export function removeAdminPostImage() {
    const input = document.getElementById('admin-post-image');
    if (input) input.value = '';
    const image = document.getElementById('admin-post-image-preview');
    if (image?.src?.startsWith('blob:')) URL.revokeObjectURL(image.src);
    document.getElementById('admin-post-image-preview-wrap')?.classList.add('hidden');
    document.getElementById('admin-post-image-remove')?.classList.add('hidden');
    document.getElementById('admin-post-remove-image').value = 'true';
}

export async function submitAdminPost(event) {
    event?.preventDefault();
    const project = getActiveProject();
    const id = document.getElementById('admin-post-id')?.value || '';
    const submit = document.getElementById('admin-post-submit');
    const errorElement = document.getElementById('admin-post-error');
    if (!project || !submit) return;
    submit.disabled = true;
    errorElement?.classList.add('hidden');
    try {
        const form = new FormData();
        form.set('title', document.getElementById('admin-post-title')?.value || '');
        form.set('body', document.getElementById('admin-post-body')?.value || '');
        form.set('removeImage', document.getElementById('admin-post-remove-image')?.value || 'false');
        const file = document.getElementById('admin-post-image')?.files?.[0];
        if (file) form.set('image', file, file.name);
        const endpoint = id ? `/api/admin/posts/${encodeURIComponent(id)}` : `/api/admin/projects/${encodeURIComponent(project.id)}/posts`;
        const response = await fetch(endpoint, { method: id ? 'PATCH' : 'POST', body: form, cache: 'no-store' });
        const post = await readApiResponse(response);
        await loadProjectPosts(project, true);
        window.PROJECT_ACTIVE_POST = post;
        renderProjectPostsSection({ post });
        const routeState = { projectView: 'post-detail', projectId: project.id, projectSection: 'posts', projectPostId: post.id };
        rememberProjectRoute(routeState, `#project/${project.id}/posts/${post.id}`);
        history.replaceState({ tab: 'project', ...routeState }, '', `#project/${project.id}/posts/${post.id}`);
    } catch (error) {
        if (errorElement) {
            errorElement.textContent = error.message;
            errorElement.classList.remove('hidden');
        }
    } finally {
        submit.disabled = false;
    }
}

export async function deleteAdminPost(postId) {
    const project = getActiveProject();
    if (!project || !confirm('이 게시글과 첨부 이미지, 댓글을 모두 삭제하시겠습니까?')) return;
    try {
        const response = await fetch(`/api/admin/posts/${encodeURIComponent(postId)}`, { method: 'DELETE', cache: 'no-store' });
        await readApiResponse(response);
        await loadProjectPosts(project, true);
        window.PROJECT_ACTIVE_POST = null;
        renderProjectPostsSection();
        const routeState = { projectView: 'section', projectId: project.id, projectSection: 'posts' };
        history.replaceState({ tab: 'project', ...routeState }, '', `#project/${project.id}/posts`);
        rememberProjectRoute(routeState, `#project/${project.id}/posts`);
    } catch (error) {
        alert(error.message || '게시글을 삭제하지 못했습니다.');
    }
}

export async function deleteAdminComment(commentId) {
    const post = window.PROJECT_ACTIVE_POST;
    if (!post?.id || !confirm('이 댓글을 삭제하시겠습니까?')) return;
    try {
        const response = await fetch(`/api/guest/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE', cache: 'no-store' });
        await readApiResponse(response);
        await openAdminPost(post.id, true);
    } catch (error) {
        alert(error.message || '댓글을 삭제하지 못했습니다.');
    }
}
