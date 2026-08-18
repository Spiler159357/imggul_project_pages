ALTER TABLE v2_situations ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_v2_situations_project_active
    ON v2_situations(project_id, is_active, sort_order);
