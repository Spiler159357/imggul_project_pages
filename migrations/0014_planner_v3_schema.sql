PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS planner_v3_project_settings (
    project_id TEXT NOT NULL,
    project_prefix TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'nai-diffusion-4-5-full',
    steps TEXT NOT NULL DEFAULT '28',
    scale TEXT NOT NULL DEFAULT '5.0',
    sampler TEXT NOT NULL DEFAULT 'k_euler_ancestral',
    resolution TEXT NOT NULL DEFAULT '832x1216',
    sm INTEGER NOT NULL DEFAULT 0,
    sm_dyn INTEGER NOT NULL DEFAULT 0,
    vibe_strength TEXT NOT NULL DEFAULT '',
    vibe_info TEXT NOT NULL DEFAULT '',
    precise_strength TEXT NOT NULL DEFAULT '',
    precise_fidelity TEXT NOT NULL DEFAULT '',
    precise_type TEXT NOT NULL DEFAULT '',
    vibe_image_key TEXT NOT NULL DEFAULT '',
    precise_image_key TEXT NOT NULL DEFAULT '',
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_settings_prefix
    ON planner_v3_project_settings(project_prefix);

CREATE TABLE IF NOT EXISTS planner_v3_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_prefix TEXT NOT NULL,
    character_id TEXT NOT NULL,
    character_prefix TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'queued', 'running', 'paused', 'complete', 'partial_failed', 'failed')),
    mode TEXT NOT NULL DEFAULT 'background'
        CHECK (mode IN ('background', 'browser')),
    default_count INTEGER NOT NULL DEFAULT 20 CHECK (default_count > 0),
    active_job_id TEXT,
    running_situation_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(running_situation_ids_json)),
    stage TEXT NOT NULL DEFAULT '',
    stage_label TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_runs_project_character
    ON planner_v3_runs(project_id, character_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_planner_v3_runs_active
    ON planner_v3_runs(project_id, status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_v3_runs_one_active_character
    ON planner_v3_runs(project_id, character_id)
    WHERE status IN ('draft', 'queued', 'running', 'paused', 'complete', 'partial_failed', 'failed');

CREATE TABLE IF NOT EXISTS planner_v3_items (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    situation_id TEXT NOT NULL,
    situation_name TEXT NOT NULL DEFAULT '',
    situation_index INTEGER,
    image_number TEXT NOT NULL,
    situation_rating TEXT NOT NULL DEFAULT 'sfw'
        CHECK (situation_rating IN ('sfw', 'nsfw')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'queued', 'running', 'paused', 'complete', 'partial_failed', 'failed')),
    target_count INTEGER NOT NULL DEFAULT 20 CHECK (target_count > 0),
    completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
    failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    stage TEXT NOT NULL DEFAULT '',
    stage_label TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (run_id) REFERENCES planner_v3_runs(id) ON DELETE CASCADE,
    UNIQUE (run_id, situation_id),
    CHECK (completed_count + failed_count <= target_count)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_items_run
    ON planner_v3_items(run_id, sort_order, image_number);

CREATE INDEX IF NOT EXISTS idx_planner_v3_items_status
    ON planner_v3_items(run_id, status, updated_at);

CREATE TABLE IF NOT EXISTS planner_v3_item_variants (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    character_prompt_variant_id TEXT NOT NULL DEFAULT '',
    character_prompt_variant_name TEXT NOT NULL DEFAULT '',
    situation_prompt_variant_id TEXT NOT NULL DEFAULT '',
    situation_prompt_variant_name TEXT NOT NULL DEFAULT '',
    target_count INTEGER NOT NULL DEFAULT 1 CHECK (target_count > 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_item_variants_item
    ON planner_v3_item_variants(item_id, sort_order);

CREATE TABLE IF NOT EXISTS planner_v3_generation_settings (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('item', 'variant')),
    owner_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    variant_id TEXT,
    model TEXT NOT NULL DEFAULT '',
    resolution TEXT NOT NULL DEFAULT '',
    width INTEGER,
    height INTEGER,
    steps INTEGER,
    scale TEXT NOT NULL DEFAULT '',
    sampler TEXT NOT NULL DEFAULT '',
    seed TEXT NOT NULL DEFAULT '',
    sm INTEGER NOT NULL DEFAULT 0,
    sm_dyn INTEGER NOT NULL DEFAULT 0,
    vibe_strength TEXT NOT NULL DEFAULT '',
    vibe_info TEXT NOT NULL DEFAULT '',
    precise_strength TEXT NOT NULL DEFAULT '',
    precise_fidelity TEXT NOT NULL DEFAULT '',
    precise_type TEXT NOT NULL DEFAULT '',
    vibe_asset_key TEXT NOT NULL DEFAULT '',
    precise_asset_key TEXT NOT NULL DEFAULT '',
    inpaint_asset_key TEXT NOT NULL DEFAULT '',
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES planner_v3_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES planner_v3_item_variants(id) ON DELETE CASCADE,
    CHECK (
        (owner_type = 'item' AND owner_id = item_id AND variant_id IS NULL)
        OR (owner_type = 'variant' AND owner_id = variant_id AND variant_id IS NOT NULL)
    ),
    UNIQUE (owner_type, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_generation_settings_owner
    ON planner_v3_generation_settings(owner_type, owner_id);

CREATE INDEX IF NOT EXISTS idx_planner_v3_generation_settings_item
    ON planner_v3_generation_settings(item_id, owner_type, owner_id);

CREATE TABLE IF NOT EXISTS planner_v3_prompt_parts (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('item', 'variant')),
    owner_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    variant_id TEXT,
    part_key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES planner_v3_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES planner_v3_item_variants(id) ON DELETE CASCADE,
    CHECK (
        (owner_type = 'item' AND owner_id = item_id AND variant_id IS NULL)
        OR (owner_type = 'variant' AND owner_id = variant_id AND variant_id IS NOT NULL)
    ),
    UNIQUE (owner_type, owner_id, part_key)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_prompt_parts_item
    ON planner_v3_prompt_parts(owner_type, owner_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_planner_v3_prompt_parts_item_owner
    ON planner_v3_prompt_parts(item_id, owner_type, owner_id, sort_order);

CREATE TABLE IF NOT EXISTS planner_v3_v4_rows (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('item', 'variant')),
    owner_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    variant_id TEXT,
    row_index INTEGER NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    clothing TEXT NOT NULL DEFAULT '',
    expression TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    negative TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES planner_v3_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES planner_v3_item_variants(id) ON DELETE CASCADE,
    CHECK (
        (owner_type = 'item' AND owner_id = item_id AND variant_id IS NULL)
        OR (owner_type = 'variant' AND owner_id = variant_id AND variant_id IS NOT NULL)
    ),
    UNIQUE (owner_type, owner_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_v4_rows_item
    ON planner_v3_v4_rows(owner_type, owner_id, row_index);

CREATE INDEX IF NOT EXISTS idx_planner_v3_v4_rows_item_owner
    ON planner_v3_v4_rows(item_id, owner_type, owner_id, row_index);

CREATE TABLE IF NOT EXISTS planner_v3_jobs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    project_prefix TEXT NOT NULL,
    character_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'background'
        CHECK (mode IN ('background', 'browser')),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'paused', 'completed', 'partial_failed', 'failed', 'cancel_requested', 'cancelled')),
    target_situation_id TEXT,
    total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
    completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
    failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    stage TEXT NOT NULL DEFAULT '',
    stage_label TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    active_key TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    FOREIGN KEY (run_id) REFERENCES planner_v3_runs(id) ON DELETE CASCADE,
    CHECK (completed_count + failed_count <= total_count)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_jobs_run
    ON planner_v3_jobs(run_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_planner_v3_jobs_status
    ON planner_v3_jobs(status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_v3_jobs_one_active_run
    ON planner_v3_jobs(run_id)
    WHERE status IN ('queued', 'running', 'paused', 'cancel_requested');

CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_v3_jobs_active_key
    ON planner_v3_jobs(active_key)
    WHERE active_key <> ''
      AND status IN ('queued', 'running', 'paused', 'cancel_requested');

CREATE TABLE IF NOT EXISTS planner_v3_job_tasks (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'paused', 'completed', 'partial_failed', 'failed', 'cancel_requested', 'cancelled')),
    target_count INTEGER NOT NULL DEFAULT 1 CHECK (target_count > 0),
    completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
    failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    stage TEXT NOT NULL DEFAULT '',
    stage_label TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    queue_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (job_id) REFERENCES planner_v3_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE,
    UNIQUE (job_id, item_id),
    CHECK (completed_count + failed_count <= target_count)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_tasks_job
    ON planner_v3_job_tasks(job_id, queue_order);

CREATE INDEX IF NOT EXISTS idx_planner_v3_tasks_status
    ON planner_v3_job_tasks(job_id, status, updated_at);

CREATE TABLE IF NOT EXISTS planner_v3_queue (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    image_index INTEGER NOT NULL,
    variant_image_index INTEGER NOT NULL DEFAULT 0,
    executor TEXT NOT NULL DEFAULT 'background'
        CHECK (executor IN ('background', 'browser')),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancel_requested', 'cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    scheduled_at TEXT,
    claimed_by TEXT NOT NULL DEFAULT '',
    claim_token TEXT NOT NULL DEFAULT '',
    claimed_at TEXT,
    lease_expires_at TEXT,
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (job_id) REFERENCES planner_v3_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES planner_v3_job_tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES planner_v3_item_variants(id) ON DELETE CASCADE,
    UNIQUE (job_id, sequence),
    UNIQUE (task_id, image_index),
    UNIQUE (task_id, variant_id, variant_image_index)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_queue_next
    ON planner_v3_queue(job_id, executor, status, scheduled_at, sequence);

CREATE INDEX IF NOT EXISTS idx_planner_v3_queue_task
    ON planner_v3_queue(task_id, image_index);

CREATE INDEX IF NOT EXISTS idx_planner_v3_queue_variant
    ON planner_v3_queue(task_id, variant_id, variant_image_index);

CREATE INDEX IF NOT EXISTS idx_planner_v3_queue_lease
    ON planner_v3_queue(status, lease_expires_at, updated_at);

CREATE TABLE IF NOT EXISTS planner_v3_assets (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    queue_id TEXT NOT NULL,
    r2_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'image/webp',
    byte_size INTEGER,
    width INTEGER,
    height INTEGER,
    image_index INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'candidate'
        CHECK (status IN ('candidate', 'rejected', 'deleted')),
    is_public INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES planner_v3_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES planner_v3_item_variants(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES planner_v3_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES planner_v3_job_tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (queue_id) REFERENCES planner_v3_queue(id) ON DELETE CASCADE,
    UNIQUE (queue_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_assets_item
    ON planner_v3_assets(item_id, image_index, created_at);

CREATE INDEX IF NOT EXISTS idx_planner_v3_assets_status
    ON planner_v3_assets(status, deleted_at);

CREATE TABLE IF NOT EXISTS planner_v3_asset_metadata (
    asset_id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL DEFAULT '',
    negative_prompt TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    sampler TEXT NOT NULL DEFAULT '',
    steps INTEGER,
    scale TEXT NOT NULL DEFAULT '',
    seed TEXT NOT NULL DEFAULT '',
    width INTEGER,
    height INTEGER,
    split_prompts_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(split_prompts_json)),
    v4_rows_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(v4_rows_json)),
    request_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(request_json)),
    response_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(response_json)),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (asset_id) REFERENCES planner_v3_assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS planner_v3_asset_cleanup_queue (
    id TEXT PRIMARY KEY,
    r2_key TEXT NOT NULL UNIQUE,
    source_asset_id TEXT NOT NULL DEFAULT '',
    source_run_id TEXT NOT NULL DEFAULT '',
    source_item_id TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'done', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    claimed_by TEXT NOT NULL DEFAULT '',
    claim_token TEXT NOT NULL DEFAULT '',
    claimed_at TEXT,
    lease_expires_at TEXT,
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_asset_cleanup_next
    ON planner_v3_asset_cleanup_queue(status, lease_expires_at, updated_at);

CREATE TABLE IF NOT EXISTS planner_v3_confirm_operations (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    selected_asset_id TEXT NOT NULL,
    selected_asset_r2_key TEXT NOT NULL,
    target_r2_key TEXT NOT NULL,
    target_folder_prefix TEXT NOT NULL DEFAULT '',
    target_file_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'copying', 'metadata_saved', 'cleanup_queued', 'completed', 'failed')),
    idempotency_key TEXT NOT NULL UNIQUE,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    expires_at TEXT,
    UNIQUE (item_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_confirm_operations_item
    ON planner_v3_confirm_operations(item_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_planner_v3_confirm_operations_retention
    ON planner_v3_confirm_operations(status, expires_at);

CREATE TABLE IF NOT EXISTS planner_v3_rate_limits (
    key TEXT PRIMARY KEY,
    available_at INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS planner_v3_events (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    item_id TEXT,
    job_id TEXT,
    task_id TEXT,
    queue_id TEXT,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_events_run
    ON planner_v3_events(run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_planner_v3_events_job
    ON planner_v3_events(job_id, created_at);
