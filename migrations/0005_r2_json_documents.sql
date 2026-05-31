CREATE TABLE IF NOT EXISTS json_documents (
    doc_type TEXT NOT NULL,
    object_key TEXT NOT NULL,
    data_json TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'db',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (doc_type, object_key)
);

CREATE INDEX IF NOT EXISTS idx_json_documents_type
    ON json_documents(doc_type, updated_at);

CREATE TABLE IF NOT EXISTS file_metadata (
    folder_prefix TEXT NOT NULL,
    file_name TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (folder_prefix, file_name)
);

CREATE INDEX IF NOT EXISTS idx_file_metadata_folder
    ON file_metadata(folder_prefix, updated_at);

CREATE TABLE IF NOT EXISTS aliases (
    scope TEXT NOT NULL,
    project_name TEXT NOT NULL DEFAULT '',
    target_key TEXT NOT NULL,
    alias TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope, project_name, target_key)
);

CREATE INDEX IF NOT EXISTS idx_aliases_project
    ON aliases(project_name, target_key);
