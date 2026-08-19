DROP INDEX IF EXISTS idx_v2_assets_project_active_file;

CREATE INDEX IF NOT EXISTS idx_file_metadata_file_folder
    ON file_metadata(file_name, folder_prefix);
