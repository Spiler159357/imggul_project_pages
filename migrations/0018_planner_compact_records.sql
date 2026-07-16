CREATE TABLE IF NOT EXISTS planner_compact_records (
    record_key TEXT PRIMARY KEY,
    record_type TEXT NOT NULL
        CHECK (record_type IN ('settings', 'run', 'confirm', 'rate')),
    project_id TEXT NOT NULL DEFAULT '',
    character_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT
);
