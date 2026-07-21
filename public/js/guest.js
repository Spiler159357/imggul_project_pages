const state = {
    project: null,
    characters: [],
    characterDetails: new Map(),
    posts: [],
    postsLoaded: false,
    nextCursor: null,
    activePost: null,
    postsScrollTop: 0,
    imageReturnFocus: null,
    commentReturnFocus: null,
    commentAction: null,
    postsRefreshInFlight: false
};

let guestPostsVisibilityListenerBound = false;

const content = document.getElementById('guest-content');
const main = document.getElementById('guest-main');
const projectPath = String(window.GUEST_PROJECT_PATH || '').trim();
const apiBase = `/api/guest/projects/${encodeURIComponent(projectPath)}`;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    }).format(date);
}

function refreshIcons() {
    window.lucide?.createIcons();
}

function renderState(icon, title, message = '') {
    content.innerHTML = `
        <section class="flex h-40 items-center justify-center p-6 text-center text-gray-400 dark:text-gray-500">
            <div>
                <i data-lucide="${escapeHtml(icon)}" class="mx-auto h-12 w-12 opacity-50"></i>
                <h2 class="mt-2 text-sm font-medium">${escapeHtml(title)}</h2>
                ${message ? `<p class="mt-1.5 text-xs leading-5">${escapeHtml(message)}</p>` : ''}
            </div>
        </section>`;
    refreshIcons();
}

async function api(url, options = {}) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload?.error?.message || '요청을 처리하지 못했습니다.');
        error.status = response.status;
        throw error;
    }
    return payload.data;
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

function getRoute() {
    const raw = location.hash.replace(/^#/, '') || 'characters';
    const parts = raw.split('/').filter(Boolean).map(part => {
        try { return decodeURIComponent(part); } catch { return ''; }
    });
    if (parts[0] === 'posts') return { tab: 'posts', id: parts[1] || '' };
    return { tab: 'characters', id: parts[1] || '' };
}

function navigate(hash, { replace = false } = {}) {
    const target = hash.startsWith('#') ? hash : `#${hash}`;
    const method = replace ? 'replaceState' : 'pushState';
    history[method]({}, '', target);
    renderRoute();
}

function setActiveTab(tab) {
    for (const name of ['characters', 'posts']) {
        const button = document.getElementById(`guest-tab-${name}`);
        if (!button) continue;
        const active = name === tab;
        button.setAttribute('aria-selected', String(active));
        button.className = `flex flex-shrink-0 items-center justify-center whitespace-nowrap rounded-lg text-xs font-bold transition-colors sm:text-sm ${active
            ? 'shadow-sm bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400'
            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`;
    }
    const refreshButton = document.getElementById('guest-posts-refresh');
    refreshButton?.classList.toggle('hidden', tab !== 'posts');
    refreshButton?.classList.toggle('inline-flex', tab === 'posts');
}

function setViewLabel(value) {
    const label = document.getElementById('guest-view-label');
    if (label) label.textContent = value;
}

function characterCard(character) {
    return `
        <button type="button" data-character="${escapeHtml(character.id)}" class="group relative flex w-full flex-col items-center overflow-hidden rounded-lg border border-transparent p-3 transition hover:border-indigo-100 hover:bg-indigo-50 dark:border-gray-600 dark:hover:border-indigo-500 dark:hover:bg-gray-700 sm:p-4">
            <span class="relative mb-2 h-20 w-20 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-600 dark:bg-gray-800 sm:h-28 sm:w-28">
                ${character.coverUrl
                    ? `<img src="${escapeHtml(character.coverUrl)}" alt="" loading="lazy" class="h-full w-full object-cover">`
                    : `<span class="flex h-full items-center justify-center bg-yellow-100 dark:bg-yellow-900/30"><i data-lucide="folder" class="h-10 w-10 fill-current text-yellow-500 sm:h-12 sm:w-12"></i></span>`}
            </span>
            <span class="block w-full overflow-hidden text-center">
                <span class="block w-full truncate text-xs font-bold text-gray-800 group-hover:text-indigo-700 dark:text-gray-200 dark:group-hover:text-indigo-400 sm:text-sm">${escapeHtml(character.name)}</span>
                <span class="mt-0.5 block w-full truncate text-[9px] text-gray-500 dark:text-gray-400 sm:text-[10px]">이미지 ${character.imageCount}개</span>
            </span>
        </button>`;
}

function renderCharacterList() {
    if (!state.characters.length) {
        renderState('users', '등록된 캐릭터가 없습니다.');
        return;
    }
    content.innerHTML = `
        <section>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                ${state.characters.map(characterCard).join('')}
            </div>
        </section>`;
    refreshIcons();
}

async function renderCharacterDetail(characterId) {
    const summary = state.characters.find(character => character.id === characterId);
    if (!summary) {
        renderState('circle-alert', '캐릭터를 찾을 수 없습니다.');
        return;
    }
    renderState('loader-circle', '이미지를 불러오는 중입니다.');
    try {
        let detail = state.characterDetails.get(characterId);
        if (!detail) {
            detail = await api(`${apiBase}/characters/${encodeURIComponent(characterId)}`);
            state.characterDetails.set(characterId, detail);
        }
        setViewLabel(detail.name);
        content.innerHTML = `
            <section>
                <div class="mb-3 flex items-center gap-2">
                    <button type="button" data-route="characters" class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-indigo-600 dark:hover:text-indigo-400" aria-label="캐릭터 목록">
                        <i data-lucide="arrow-left" class="h-4 w-4"></i><span>캐릭터 목록</span>
                    </button>
                    <span class="truncate text-[11px] text-gray-400 dark:text-gray-500">이미지 ${detail.images.length}개</span>
                </div>
                ${detail.images.length ? `
                    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                        ${detail.images.map(image => `
                            <button type="button" data-image-url="${escapeHtml(image.url)}" data-image-title="${escapeHtml(`${detail.name} · ${image.name || image.fileName}`)}" data-image-path="${escapeHtml(image.name || image.fileName)}" class="group relative flex w-full flex-col items-center overflow-hidden rounded-lg border border-gray-100 p-2 transition hover:border-indigo-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:border-indigo-500 dark:hover:bg-gray-700 sm:p-3">
                                <span class="block h-24 w-full overflow-hidden rounded border border-gray-200 bg-gray-100 shadow-sm dark:border-gray-600 dark:bg-gray-800 sm:h-32">
                                    <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.name || image.fileName)}" loading="lazy" class="h-full w-full object-cover">
                                </span>
                                <span class="mt-2 block w-full truncate text-center text-[10px] font-medium text-gray-600 group-hover:text-indigo-700 dark:text-gray-300 dark:group-hover:text-indigo-400 sm:text-xs">${escapeHtml(image.name || image.fileName)}</span>
                            </button>`).join('')}
                    </div>` : `
                    <div class="flex h-40 flex-col items-center justify-center text-gray-400 dark:text-gray-500"><i data-lucide="image-off" class="mb-2 h-12 w-12 opacity-50"></i><p class="text-sm">등록된 이미지가 없습니다.</p></div>`}
            </section>`;
        refreshIcons();
    } catch (error) {
        renderState('circle-alert', '이미지를 불러오지 못했습니다.', error.message);
    }
}

function postCard(post) {
    return `
        <button type="button" data-post="${escapeHtml(post.id)}" class="grid w-full grid-cols-[minmax(0,1fr)_5rem] gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:border-indigo-300 hover:ring-2 hover:ring-indigo-500/10 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-indigo-600 sm:grid-cols-[minmax(0,1fr)_7rem] sm:p-4">
            <span class="min-w-0">
                <span class="block truncate text-sm font-bold text-gray-900 dark:text-white">${escapeHtml(post.title)}</span>
                <span class="mt-1.5 line-clamp-2 block whitespace-pre-wrap text-xs leading-5 text-gray-500 dark:text-gray-400">${escapeHtml(post.body || '내용 없음')}</span>
                <span class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400 dark:text-gray-500">
                    <span>${escapeHtml(formatDate(post.createdAt))}</span>
                    <span class="inline-flex items-center gap-1"><i data-lucide="message-circle" class="h-3.5 w-3.5"></i>${post.commentCount}</span>
                    ${post.edited ? '<span>수정됨</span>' : ''}
                </span>
            </span>
            <span class="aspect-square overflow-hidden rounded border border-gray-200 bg-gray-100 dark:border-gray-600 dark:bg-gray-900">
                ${post.imageUrl
                    ? `<img src="${escapeHtml(post.imageUrl)}" alt="" loading="lazy" class="h-full w-full object-cover">`
                    : `<span class="flex h-full items-center justify-center"><i data-lucide="file-text" class="h-7 w-7 text-gray-300 dark:text-gray-600"></i></span>`}
            </span>
        </button>`;
}

async function ensurePosts() {
    if (state.postsLoaded) return;
    const page = await api(`${apiBase}/posts?limit=20`);
    state.posts = page.items;
    state.nextCursor = page.nextCursor;
    state.postsLoaded = true;
}

function renderPostList() {
    if (!state.posts.length) {
        renderState('newspaper', '등록된 게시글이 없습니다.');
        return;
    }
    content.innerHTML = `
        <section class="mx-auto max-w-4xl">
            <div class="space-y-3">${state.posts.map(postCard).join('')}</div>
            ${state.nextCursor ? `<button id="guest-posts-more" type="button" class="mt-4 w-full rounded-lg border border-gray-200 bg-white py-2.5 text-sm font-bold text-gray-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">더 보기</button>` : ''}
        </section>`;
    refreshIcons();
    requestAnimationFrame(() => { main.scrollTop = state.postsScrollTop; });
}

async function renderPosts() {
    renderState('loader-circle', '게시글을 불러오는 중입니다.');
    try {
        await ensurePosts();
        renderPostList();
    } catch (error) {
        renderState('circle-alert', '게시글을 불러오지 못했습니다.', error.message);
    }
}

function commentHtml(comment) {
    return `
        <article class="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="truncate text-xs font-bold text-gray-800 dark:text-gray-100">${escapeHtml(comment.authorName)}</p>
                    <p class="mt-0.5 text-[10px] text-gray-400">${escapeHtml(formatDate(comment.updatedAt || comment.createdAt))}${comment.edited ? ' · 수정됨' : ''}</p>
                </div>
                <div class="flex flex-shrink-0 gap-1">
                    <button type="button" data-comment-edit="${escapeHtml(comment.id)}" class="rounded p-1.5 text-gray-400 hover:bg-white hover:text-indigo-600 dark:hover:bg-gray-800" aria-label="댓글 수정"><i data-lucide="pencil" class="h-3.5 w-3.5"></i></button>
                    <button type="button" data-comment-delete="${escapeHtml(comment.id)}" class="rounded p-1.5 text-gray-400 hover:bg-white hover:text-red-500 dark:hover:bg-gray-800" aria-label="댓글 삭제"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>
                </div>
            </div>
            <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-700 dark:text-gray-200">${escapeHtml(comment.body)}</p>
        </article>`;
}

async function renderPostDetail(postId, options = {}) {
    const preserveView = options.preserveView === true;
    const previousScrollTop = preserveView ? main.scrollTop : 0;
    const focusedId = preserveView && document.activeElement?.id ? document.activeElement.id : '';
    const focusedSelection = focusedId && typeof document.activeElement?.selectionStart === 'number'
        ? [document.activeElement.selectionStart, document.activeElement.selectionEnd]
        : null;
    const draft = preserveView ? {
        name: document.getElementById('guest-comment-name')?.value || '',
        password: document.getElementById('guest-comment-password')?.value || '',
        body: document.getElementById('guest-comment-body')?.value || ''
    } : null;
    if (!options.post) renderState('loader-circle', '게시글을 불러오는 중입니다.');
    try {
        const post = options.post || await api(`${apiBase}/posts/${encodeURIComponent(postId)}`);
        state.activePost = post;
        const summaryIndex = state.posts.findIndex(item => item.id === post.id);
        if (summaryIndex >= 0) {
            state.posts[summaryIndex] = {
                ...state.posts[summaryIndex],
                title: post.title,
                body: post.body,
                imageUrl: post.imageUrl,
                updatedAt: post.updatedAt,
                edited: post.edited,
                commentCount: post.commentCount
            };
        }
        setViewLabel(post.title);
        content.innerHTML = `
            <article class="mx-auto max-w-4xl">
                <div class="mb-3 flex items-center gap-2">
                    <button type="button" data-route="posts" class="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600 transition hover:border-indigo-300 hover:text-indigo-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-indigo-600 dark:hover:text-indigo-400" aria-label="게시글 목록">
                        <i data-lucide="arrow-left" class="h-4 w-4"></i><span>게시글 목록</span>
                    </button>
                </div>
                <section class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                    <div class="p-4 sm:p-6">
                        <h1 class="break-words text-xl font-bold text-gray-900 dark:text-white">${escapeHtml(post.title)}</h1>
                        <p class="mt-2 text-xs text-gray-400">${escapeHtml(formatDate(post.createdAt))}${post.edited ? ` · 수정됨 ${escapeHtml(formatDate(post.updatedAt))}` : ''}</p>
                        <p class="mt-5 whitespace-pre-wrap break-words text-sm leading-7 text-gray-700 dark:text-gray-200">${escapeHtml(post.body)}</p>
                    </div>
                    ${post.imageUrl ? `
                        <button type="button" data-image-url="${escapeHtml(post.imageUrl)}" data-image-title="${escapeHtml(post.title)}" data-image-path="게시글 이미지" class="block w-full border-t border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-900">
                            <img src="${escapeHtml(post.imageUrl)}" alt="게시글 이미지" class="mx-auto max-h-[70dvh] max-w-full object-contain">
                        </button>` : ''}
                </section>

                <section class="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-5">
                    <h2 class="text-sm font-bold text-gray-900 dark:text-white">댓글 ${post.comments.length}개</h2>
                    <form id="guest-comment-create-form" class="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <input id="guest-comment-name" type="text" maxlength="30" placeholder="이름" aria-label="댓글 이름" class="rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required>
                            <input id="guest-comment-password" type="password" minlength="8" maxlength="72" autocomplete="new-password" placeholder="비밀번호 (8자 이상)" aria-label="댓글 비밀번호" class="rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required>
                        </div>
                        <textarea id="guest-comment-body" maxlength="2000" rows="3" placeholder="댓글을 입력하세요." aria-label="댓글 내용" class="mt-2 w-full resize-y rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-indigo-500 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white" required></textarea>
                        <div class="mt-2 flex items-center justify-between gap-3">
                            <p id="guest-comment-create-error" class="hidden text-xs text-red-500" role="alert"></p>
                            <button id="guest-comment-create-submit" type="submit" class="ml-auto rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700">댓글 등록</button>
                        </div>
                    </form>
                    <div id="guest-comments-list" class="mt-4 space-y-2">
                        ${post.comments.length ? post.comments.map(commentHtml).join('') : '<p class="py-6 text-center text-xs text-gray-400">첫 댓글을 남겨보세요.</p>'}
                    </div>
                </section>
            </article>`;
        refreshIcons();
        if (preserveView && draft) {
            const nameInput = document.getElementById('guest-comment-name');
            const passwordInput = document.getElementById('guest-comment-password');
            const bodyInput = document.getElementById('guest-comment-body');
            if (nameInput) nameInput.value = draft.name;
            if (passwordInput) passwordInput.value = draft.password;
            if (bodyInput) bodyInput.value = draft.body;
            main.scrollTop = previousScrollTop;
            const focused = focusedId ? document.getElementById(focusedId) : null;
            if (focused) {
                focused.focus({ preventScroll: true });
                if (focusedSelection && typeof focused.setSelectionRange === 'function') {
                    focused.setSelectionRange(focusedSelection[0], focusedSelection[1]);
                }
            }
        } else {
            main.scrollTop = 0;
        }
    } catch (error) {
        renderState('circle-alert', '게시글을 불러오지 못했습니다.', error.message);
    }
}

async function renderRoute() {
    if (!state.project) return;
    const route = getRoute();
    setActiveTab(route.tab);
    if (route.tab === 'posts') setViewLabel(route.id ? '게시글 상세' : '게시글');
    else setViewLabel(route.id ? '캐릭터 이미지' : '캐릭터');
    if (route.tab === 'posts') {
        if (route.id) await renderPostDetail(route.id);
        else await renderPosts();
    } else if (route.id) {
        await renderCharacterDetail(route.id);
    } else {
        renderCharacterList();
        main.scrollTop = 0;
    }
}

function setGuestPostsRefreshNeeded(needed) {
    const label = document.getElementById('guest-posts-refresh-label');
    const dot = document.getElementById('guest-posts-refresh-dot');
    if (label) {
        label.textContent = needed ? '새 변경 있음' : '새로고침';
        label.classList.toggle('text-amber-600', needed);
        label.classList.toggle('dark:text-amber-400', needed);
    }
    dot?.classList.toggle('hidden', !needed);
}

function setGuestPostsRefreshLoading(loading) {
    const button = document.getElementById('guest-posts-refresh');
    const icon = document.getElementById('guest-posts-refresh-icon');
    if (button) button.disabled = loading;
    icon?.classList.toggle('animate-spin', loading);
}

async function detectVisibleGuestPostChanges() {
    if (document.hidden || !state.project || state.postsRefreshInFlight) return;
    const route = getRoute();
    if (route.tab !== 'posts') return;
    state.postsRefreshInFlight = true;
    try {
        if (!route.id) {
            const limit = Math.min(50, Math.max(20, state.posts.length || 0));
            const page = await api(`${apiBase}/posts?limit=${limit}`);
            setGuestPostsRefreshNeeded(postsRevision(state.posts) !== postsRevision(page.items));
            return;
        }

        const post = await api(`${apiBase}/posts/${encodeURIComponent(route.id)}`);
        setGuestPostsRefreshNeeded(postRevision(state.activePost) !== postRevision(post));
    } catch (error) {
        if (error.status === 404) setGuestPostsRefreshNeeded(true);
    } finally {
        state.postsRefreshInFlight = false;
    }
}

async function refreshGuestPosts() {
    if (!state.project || state.postsRefreshInFlight) return;
    const route = getRoute();
    if (route.tab !== 'posts') return;
    state.postsRefreshInFlight = true;
    setGuestPostsRefreshLoading(true);
    try {
        if (!route.id) {
            const limit = Math.min(50, Math.max(20, state.posts.length || 0));
            const page = await api(`${apiBase}/posts?limit=${limit}`);
            state.postsScrollTop = main.scrollTop;
            state.posts = page.items;
            state.nextCursor = page.nextCursor;
            state.postsLoaded = true;
            renderPostList();
        } else {
            const post = await api(`${apiBase}/posts/${encodeURIComponent(route.id)}`);
            await renderPostDetail(route.id, { post, preserveView: true });
        }
        setGuestPostsRefreshNeeded(false);
    } catch (error) {
        if (error.status === 404 && getRoute().id === route.id) navigate('posts', { replace: true });
    } finally {
        state.postsRefreshInFlight = false;
        setGuestPostsRefreshLoading(false);
    }
}

function bindGuestPostsChangeDetection() {
    if (!guestPostsVisibilityListenerBound) {
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) detectVisibleGuestPostChanges();
        });
        window.addEventListener('focus', detectVisibleGuestPostChanges);
        guestPostsVisibilityListenerBound = true;
    }
}

function openImageModal(button) {
    const modal = document.getElementById('guest-image-modal');
    const image = document.getElementById('guest-image-preview');
    state.imageReturnFocus = button;
    image.src = button.dataset.imageUrl || '';
    image.alt = button.dataset.imageTitle || '이미지 미리보기';
    document.getElementById('guest-image-title').textContent = button.dataset.imageTitle || '이미지 미리보기';
    document.getElementById('guest-image-path').textContent = button.dataset.imagePath || '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.style.overflow = 'hidden';
    document.getElementById('guest-image-close').focus();
}

function closeImageModal() {
    const modal = document.getElementById('guest-image-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.getElementById('guest-image-preview').src = '';
    document.body.style.overflow = '';
    state.imageReturnFocus?.focus();
    state.imageReturnFocus = null;
}

function openCommentModal(mode, commentId, button) {
    const comment = state.activePost?.comments.find(item => item.id === commentId);
    if (!comment) return;
    state.commentAction = { mode, commentId };
    state.commentReturnFocus = button;
    const isDelete = mode === 'delete';
    document.getElementById('guest-comment-modal-title').textContent = isDelete ? '댓글 삭제' : '댓글 수정';
    document.getElementById('guest-comment-edit-fields').classList.toggle('hidden', isDelete);
    const nameInput = document.getElementById('guest-comment-edit-name');
    const bodyInput = document.getElementById('guest-comment-edit-body');
    nameInput.value = comment.authorName;
    bodyInput.value = comment.body;
    nameInput.disabled = isDelete;
    bodyInput.disabled = isDelete;
    document.getElementById('guest-comment-action-password').value = '';
    document.getElementById('guest-comment-action-error').classList.add('hidden');
    const submit = document.getElementById('guest-comment-action-submit');
    submit.textContent = isDelete ? '삭제' : '저장';
    submit.classList.toggle('bg-red-600', isDelete);
    submit.classList.toggle('bg-indigo-600', !isDelete);
    const modal = document.getElementById('guest-comment-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('guest-comment-action-password').focus();
}

function closeCommentModal() {
    const modal = document.getElementById('guest-comment-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.getElementById('guest-comment-action-password').value = '';
    state.commentAction = null;
    state.commentReturnFocus?.focus();
    state.commentReturnFocus = null;
}

async function createComment(form) {
    const submit = document.getElementById('guest-comment-create-submit');
    const errorElement = document.getElementById('guest-comment-create-error');
    const passwordInput = document.getElementById('guest-comment-password');
    submit.disabled = true;
    errorElement.classList.add('hidden');
    try {
        await api(`${apiBase}/posts/${encodeURIComponent(state.activePost.id)}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                authorName: document.getElementById('guest-comment-name').value,
                password: passwordInput.value,
                body: document.getElementById('guest-comment-body').value,
                requestId: crypto.randomUUID()
            })
        });
        passwordInput.value = '';
        form.reset();
        await renderPostDetail(state.activePost.id);
        setGuestPostsRefreshNeeded(false);
    } catch (error) {
        passwordInput.value = '';
        errorElement.textContent = error.message;
        errorElement.classList.remove('hidden');
    } finally {
        submit.disabled = false;
    }
}

async function submitCommentAction() {
    if (!state.commentAction) return;
    const submit = document.getElementById('guest-comment-action-submit');
    const passwordInput = document.getElementById('guest-comment-action-password');
    const errorElement = document.getElementById('guest-comment-action-error');
    const { mode, commentId } = state.commentAction;
    submit.disabled = true;
    errorElement.classList.add('hidden');
    try {
        const body = mode === 'delete'
            ? { password: passwordInput.value }
            : {
                password: passwordInput.value,
                authorName: document.getElementById('guest-comment-edit-name').value,
                body: document.getElementById('guest-comment-edit-body').value
            };
        await api(`/api/guest/comments/${encodeURIComponent(commentId)}`, {
            method: mode === 'delete' ? 'DELETE' : 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        passwordInput.value = '';
        const postId = state.activePost.id;
        closeCommentModal();
        await renderPostDetail(postId);
        setGuestPostsRefreshNeeded(false);
    } catch (error) {
        passwordInput.value = '';
        errorElement.textContent = error.message;
        errorElement.classList.remove('hidden');
        passwordInput.focus();
    } finally {
        submit.disabled = false;
    }
}

async function loadMorePosts(button) {
    if (!state.nextCursor) return;
    button.disabled = true;
    try {
        const page = await api(`${apiBase}/posts?limit=20&cursor=${encodeURIComponent(state.nextCursor)}`);
        state.posts.push(...page.items);
        state.nextCursor = page.nextCursor;
        state.postsScrollTop = main.scrollTop;
        renderPostList();
    } catch (error) {
        button.textContent = error.message;
    } finally {
        button.disabled = false;
    }
}

function updateThemeIcon() {
    const icon = document.querySelector('#guest-theme-toggle [data-lucide]');
    if (!icon) return;
    icon.setAttribute('data-lucide', document.documentElement.classList.contains('dark') ? 'sun' : 'moon');
    refreshIcons();
}

content.addEventListener('click', event => {
    const routeButton = event.target.closest('[data-route]');
    if (routeButton) {
        navigate(routeButton.dataset.route);
        return;
    }
    const characterButton = event.target.closest('[data-character]');
    if (characterButton) {
        navigate(`characters/${encodeURIComponent(characterButton.dataset.character)}`);
        return;
    }
    const postButton = event.target.closest('[data-post]');
    if (postButton) {
        state.postsScrollTop = main.scrollTop;
        navigate(`posts/${encodeURIComponent(postButton.dataset.post)}`);
        return;
    }
    const imageButton = event.target.closest('[data-image-url]');
    if (imageButton) {
        openImageModal(imageButton);
        return;
    }
    const editButton = event.target.closest('[data-comment-edit]');
    if (editButton) {
        openCommentModal('edit', editButton.dataset.commentEdit, editButton);
        return;
    }
    const deleteButton = event.target.closest('[data-comment-delete]');
    if (deleteButton) openCommentModal('delete', deleteButton.dataset.commentDelete, deleteButton);
});

content.addEventListener('submit', event => {
    if (event.target.id !== 'guest-comment-create-form') return;
    event.preventDefault();
    createComment(event.target);
});

content.addEventListener('click', event => {
    const moreButton = event.target.closest('#guest-posts-more');
    if (moreButton) loadMorePosts(moreButton);
});

document.getElementById('guest-tab-characters').addEventListener('click', () => navigate('characters'));
document.getElementById('guest-tab-posts').addEventListener('click', () => navigate('posts'));
document.getElementById('guest-posts-refresh').addEventListener('click', refreshGuestPosts);
document.getElementById('guest-logo-home').addEventListener('click', () => navigate('characters'));
document.getElementById('guest-theme-toggle').addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    updateThemeIcon();
});
document.getElementById('guest-image-close').addEventListener('click', closeImageModal);
document.getElementById('guest-image-modal').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeImageModal();
});
document.getElementById('guest-comment-modal-close').addEventListener('click', closeCommentModal);
document.getElementById('guest-comment-action-cancel').addEventListener('click', closeCommentModal);
document.getElementById('guest-comment-modal').addEventListener('click', event => {
    if (event.target === event.currentTarget) closeCommentModal();
});
document.getElementById('guest-comment-action-form').addEventListener('submit', event => {
    event.preventDefault();
    submitCommentAction();
});
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!document.getElementById('guest-comment-modal').classList.contains('hidden')) closeCommentModal();
    else if (!document.getElementById('guest-image-modal').classList.contains('hidden')) closeImageModal();
});
window.addEventListener('popstate', renderRoute);

async function init() {
    renderState('loader-circle', '프로젝트를 불러오는 중입니다.');
    updateThemeIcon();
    try {
        state.project = await api(apiBase);
        state.characters = state.project.characters || [];
        document.getElementById('guest-project-name').textContent = state.project.name;
        if (!location.hash) history.replaceState({}, '', '#characters');
        await renderRoute();
        bindGuestPostsChangeDetection();
    } catch (error) {
        document.getElementById('guest-project-name').textContent = '프로젝트 오류';
        renderState('circle-alert', '프로젝트를 불러오지 못했습니다.', error.message);
    }
}

init();
