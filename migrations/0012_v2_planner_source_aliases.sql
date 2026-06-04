CREATE TABLE IF NOT EXISTS v2_planner_sources (
    source_key TEXT PRIMARY KEY,
    planner_run_id TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'planner_meta',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (planner_run_id) REFERENCES v2_planner_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_v2_planner_sources_run
    ON v2_planner_sources(planner_run_id);
