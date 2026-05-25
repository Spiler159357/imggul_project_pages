CREATE TABLE IF NOT EXISTS planner_background_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_prefix TEXT NOT NULL,
    character_id TEXT,
    character_prefix TEXT,
    status TEXT NOT NULL,
    stage TEXT,
    total_count INTEGER NOT NULL DEFAULT 0,
    completed_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    target_situation_id TEXT,
    planner_meta_json TEXT NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    cancelled_at TEXT
);

CREATE TABLE IF NOT EXISTS planner_background_items (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    situation_id TEXT NOT NULL,
    situation_name TEXT,
    image_number TEXT NOT NULL,
    output_prefix TEXT NOT NULL,
    generation_json TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    completed_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    stage TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    result_keys TEXT NOT NULL DEFAULT '[]',
    error_message TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (job_id) REFERENCES planner_background_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_planner_background_jobs_project
    ON planner_background_jobs(project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_planner_background_jobs_status
    ON planner_background_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_planner_background_items_job
    ON planner_background_items(job_id, image_number);

CREATE INDEX IF NOT EXISTS idx_planner_background_items_status
    ON planner_background_items(status, updated_at);
