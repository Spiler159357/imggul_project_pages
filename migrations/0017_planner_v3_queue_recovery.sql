ALTER TABLE planner_v3_queue ADD COLUMN stage TEXT NOT NULL DEFAULT '';
ALTER TABLE planner_v3_queue ADD COLUMN stage_label TEXT NOT NULL DEFAULT '';
ALTER TABLE planner_v3_queue ADD COLUMN stage_started_at TEXT;
ALTER TABLE planner_v3_queue ADD COLUMN last_heartbeat_at TEXT;

CREATE INDEX IF NOT EXISTS idx_planner_v3_queue_stale
    ON planner_v3_queue(status, lease_expires_at, last_heartbeat_at);
