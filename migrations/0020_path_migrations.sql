ALTER TABLE v2_situations ADD COLUMN storage_name TEXT;

UPDATE v2_situations
SET storage_name = image_number
WHERE storage_name IS NULL OR storage_name = '';

CREATE INDEX IF NOT EXISTS idx_v2_situations_project_storage
    ON v2_situations(project_id, storage_name);

CREATE TABLE IF NOT EXISTS path_migrations (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('character', 'situation')),
    entity_key TEXT NOT NULL,
    project_id TEXT NOT NULL,
    old_path TEXT NOT NULL,
    new_path TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('prepared', 'copying', 'committed', 'cleaning', 'completed', 'failed')
    ),
    manifest_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(manifest_json)),
    copied_count INTEGER NOT NULL DEFAULT 0,
    deleted_count INTEGER NOT NULL DEFAULT 0,
    error_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(error_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_path_migrations_active_entity
    ON path_migrations(entity_type, entity_key)
    WHERE status IN ('prepared', 'copying', 'committed', 'cleaning');
