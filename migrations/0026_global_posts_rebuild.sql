DROP TABLE IF EXISTS guest_comments;
DROP TABLE IF EXISTS guest_posts;
DROP TABLE IF EXISTS guest_comment_rate_limits;

CREATE TABLE guest_posts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    image_key TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_guest_posts_created
    ON guest_posts(created_at DESC, id DESC);

CREATE TABLE guest_comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    parent_comment_id TEXT,
    author_name TEXT NOT NULL,
    body TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    request_key TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (post_id) REFERENCES guest_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_comment_id) REFERENCES guest_comments(id) ON DELETE CASCADE
);

CREATE INDEX idx_guest_comments_post_parent_created
    ON guest_comments(post_id, parent_comment_id, created_at ASC, id ASC);

CREATE UNIQUE INDEX idx_guest_comments_post_request
    ON guest_comments(post_id, request_key)
    WHERE request_key IS NOT NULL;

CREATE TABLE guest_comment_rate_limits (
    bucket_key TEXT PRIMARY KEY,
    window_started_at TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count >= 0),
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_guest_comment_rate_limits_updated
    ON guest_comment_rate_limits(updated_at);
