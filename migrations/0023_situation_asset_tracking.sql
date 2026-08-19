CREATE INDEX IF NOT EXISTS idx_v2_assets_project_active_file
    ON v2_assets(project_id, status, kind, file_name);
