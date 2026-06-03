CREATE TABLE IF NOT EXISTS planner_metas (
    object_key TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT '',
    project_prefix TEXT NOT NULL,
    character_id TEXT NOT NULL,
    character_prefix TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    stage TEXT NOT NULL DEFAULT '',
    stage_label TEXT NOT NULL DEFAULT '',
    default_count INTEGER NOT NULL DEFAULT 20,
    background_job_id TEXT NOT NULL DEFAULT '',
    background_status_json TEXT NOT NULL DEFAULT '{}',
    running_situation_ids_json TEXT NOT NULL DEFAULT '[]',
    extra_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planner_metas_project
    ON planner_metas(project_prefix, character_id, updated_at);

CREATE TABLE IF NOT EXISTS planner_items (
    id TEXT PRIMARY KEY,
    meta_object_key TEXT NOT NULL,
    situation_id TEXT NOT NULL,
    situation_name TEXT NOT NULL DEFAULT '',
    situation_index INTEGER,
    image_number TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 20,
    status TEXT NOT NULL DEFAULT 'pending',
    stage TEXT NOT NULL DEFAULT '',
    stage_label TEXT NOT NULL DEFAULT '',
    selected_image TEXT NOT NULL DEFAULT '',
    final_image TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    background_job_id TEXT NOT NULL DEFAULT '',
    background_item_id TEXT NOT NULL DEFAULT '',
    generation_json TEXT NOT NULL DEFAULT '{}',
    extra_json TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (meta_object_key) REFERENCES planner_metas(object_key) ON DELETE CASCADE,
    UNIQUE (meta_object_key, situation_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_items_meta
    ON planner_items(meta_object_key, sort_order);

CREATE TABLE IF NOT EXISTS planner_item_v4_rows (
    item_id TEXT NOT NULL,
    row_index INTEGER NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    clothing TEXT NOT NULL DEFAULT '',
    expression TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    negative TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (item_id, row_index),
    FOREIGN KEY (item_id) REFERENCES planner_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS planner_item_images (
    item_id TEXT NOT NULL,
    image_key TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (item_id, image_key),
    FOREIGN KEY (item_id) REFERENCES planner_items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS planner_item_image_snapshots (
    item_id TEXT NOT NULL,
    image_key TEXT NOT NULL,
    snapshot_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (item_id, image_key),
    FOREIGN KEY (item_id) REFERENCES planner_items(id) ON DELETE CASCADE
);
