-- New editor schema. Legacy editor documents are intentionally not migrated.
CREATE TABLE IF NOT EXISTS editor_workspace_documents (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
    revision TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS editor_workspace_project ON editor_workspace_documents(project_id, deleted, updated_at);
CREATE TABLE IF NOT EXISTS editor_workspace_revisions (
    id TEXT PRIMARY KEY, document_id TEXT NOT NULL, manifest_key TEXT NOT NULL,
    state TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS editor_workspace_revision_doc ON editor_workspace_revisions(document_id, created_at);
