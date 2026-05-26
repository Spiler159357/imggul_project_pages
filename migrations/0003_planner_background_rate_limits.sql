CREATE TABLE IF NOT EXISTS planner_background_rate_limits (
    key TEXT PRIMARY KEY,
    available_at INTEGER NOT NULL,
    updated_at TEXT NOT NULL
);
