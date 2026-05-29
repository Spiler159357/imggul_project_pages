ALTER TABLE planner_background_jobs ADD COLUMN active_key TEXT;
ALTER TABLE planner_background_jobs ADD COLUMN active_project_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_background_jobs_active_key
    ON planner_background_jobs(active_key)
    WHERE status IN ('queued', 'running', 'cancel_requested');

CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_background_jobs_active_project_key
    ON planner_background_jobs(active_project_key)
    WHERE status IN ('queued', 'running', 'cancel_requested');
