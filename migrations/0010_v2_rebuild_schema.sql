CREATE TABLE IF NOT EXISTS v2_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS v2_characters (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES v2_projects(id) ON DELETE CASCADE,
    UNIQUE (project_id, prefix)
);

CREATE INDEX IF NOT EXISTS idx_v2_characters_project
    ON v2_characters(project_id, sort_order);

CREATE TABLE IF NOT EXISTS v2_situations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    image_number TEXT NOT NULL,
    rating TEXT NOT NULL DEFAULT 'sfw' CHECK (rating IN ('sfw', 'nsfw')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES v2_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_v2_situations_project
    ON v2_situations(project_id, sort_order);

CREATE TABLE IF NOT EXISTS v2_prompt_sets (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    compiled_prompt_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_prompt_sets_owner
    ON v2_prompt_sets(owner_type, owner_id, kind, sort_order);

CREATE TABLE IF NOT EXISTS v2_prompt_parts (
    id TEXT PRIMARY KEY,
    prompt_set_id TEXT NOT NULL,
    part_key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (prompt_set_id) REFERENCES v2_prompt_sets(id) ON DELETE CASCADE,
    UNIQUE (prompt_set_id, part_key)
);

CREATE TABLE IF NOT EXISTS v2_prompt_v4_rows (
    id TEXT PRIMARY KEY,
    prompt_set_id TEXT NOT NULL,
    row_index INTEGER NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    clothing TEXT NOT NULL DEFAULT '',
    expression TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    negative TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (prompt_set_id) REFERENCES v2_prompt_sets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_v2_prompt_v4_rows_set
    ON v2_prompt_v4_rows(prompt_set_id, row_index);

CREATE TABLE IF NOT EXISTS v2_assets (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    owner_type TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    r2_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER,
    width INTEGER,
    height INTEGER,
    kind TEXT NOT NULL DEFAULT 'image',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    is_public INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES v2_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_v2_assets_owner
    ON v2_assets(owner_type, owner_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_v2_assets_deleted
    ON v2_assets(status, deleted_at);

CREATE TABLE IF NOT EXISTS v2_asset_metadata (
    asset_id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL DEFAULT '',
    negative_prompt TEXT NOT NULL DEFAULT '',
    model TEXT,
    sampler TEXT,
    steps INTEGER,
    scale TEXT,
    seed TEXT,
    width INTEGER,
    height INTEGER,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (asset_id) REFERENCES v2_assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS v2_planner_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'completed', 'confirmed', 'failed')),
    mode TEXT NOT NULL DEFAULT 'background' CHECK (mode IN ('background', 'browser')),
    default_count INTEGER NOT NULL DEFAULT 20,
    legacy_object_key TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    confirmed_at TEXT,
    FOREIGN KEY (project_id) REFERENCES v2_projects(id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES v2_characters(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_v2_planner_runs_project
    ON v2_planner_runs(project_id, character_id, updated_at);

CREATE TABLE IF NOT EXISTS v2_planner_items (
    id TEXT PRIMARY KEY,
    planner_run_id TEXT NOT NULL,
    situation_id TEXT NOT NULL,
    image_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'paused', 'done', 'confirmed', 'failed')),
    target_count INTEGER NOT NULL DEFAULT 20,
    selected_generated_image_id TEXT,
    confirmed_asset_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (planner_run_id) REFERENCES v2_planner_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (situation_id) REFERENCES v2_situations(id) ON DELETE CASCADE,
    FOREIGN KEY (confirmed_asset_id) REFERENCES v2_assets(id) ON DELETE SET NULL,
    UNIQUE (planner_run_id, situation_id)
);

CREATE INDEX IF NOT EXISTS idx_v2_planner_items_run
    ON v2_planner_items(planner_run_id, sort_order);

CREATE TABLE IF NOT EXISTS v2_planner_generated_images (
    id TEXT PRIMARY KEY,
    planner_item_id TEXT NOT NULL,
    asset_id TEXT NOT NULL UNIQUE,
    image_index INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'selected', 'confirmed', 'rejected')),
    created_at TEXT NOT NULL,
    FOREIGN KEY (planner_item_id) REFERENCES v2_planner_items(id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id) REFERENCES v2_assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_v2_planner_generated_images_item
    ON v2_planner_generated_images(planner_item_id, image_index);

CREATE TABLE IF NOT EXISTS v2_generation_jobs (
    id TEXT PRIMARY KEY,
    planner_run_id TEXT,
    project_id TEXT NOT NULL,
    character_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'paused', 'completed', 'partial_failed', 'failed')),
    mode TEXT NOT NULL DEFAULT 'background' CHECK (mode IN ('background', 'browser')),
    total_count INTEGER NOT NULL DEFAULT 0,
    completed_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    legacy_background_job_id TEXT UNIQUE,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (planner_run_id) REFERENCES v2_planner_runs(id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES v2_projects(id) ON DELETE CASCADE,
    FOREIGN KEY (character_id) REFERENCES v2_characters(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_generation_jobs_active
    ON v2_generation_jobs(planner_run_id, status, updated_at);

CREATE TABLE IF NOT EXISTS v2_generation_job_items (
    id TEXT PRIMARY KEY,
    generation_job_id TEXT NOT NULL,
    planner_item_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'paused', 'completed', 'partial_failed', 'failed')),
    target_count INTEGER NOT NULL DEFAULT 1,
    completed_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    legacy_background_item_id TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (generation_job_id) REFERENCES v2_generation_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (planner_item_id) REFERENCES v2_planner_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_v2_generation_job_items_job
    ON v2_generation_job_items(generation_job_id, status);

CREATE TABLE IF NOT EXISTS v2_generation_queue (
    id TEXT PRIMARY KEY,
    generation_job_item_id TEXT NOT NULL,
    image_index INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'paused', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    scheduled_at TEXT,
    legacy_background_queue_id TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (generation_job_item_id) REFERENCES v2_generation_job_items(id) ON DELETE CASCADE,
    UNIQUE (generation_job_item_id, image_index)
);

CREATE INDEX IF NOT EXISTS idx_v2_generation_queue_next
    ON v2_generation_queue(status, scheduled_at, created_at);
