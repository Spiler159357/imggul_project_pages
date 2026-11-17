-- Apply only after deploying the R2-only editor. Editor data is intentionally discarded.
-- Keep shared projects, aliases and character data. Remove only editor-tagged
-- fields from shared file metadata, preserving all generation metadata and files.
UPDATE file_metadata
SET metadata_json = json_remove(metadata_json, '$.edited', '$.editorDocumentId',
    '$.editorRevision', '$.derivedFromKey', '$.editedAt')
WHERE CASE WHEN json_valid(metadata_json)
    THEN json_type(metadata_json, '$.editorDocumentId') = 'text' ELSE 0 END;
DROP TABLE IF EXISTS editor_workspace_revisions;
DROP TABLE IF EXISTS editor_workspace_documents;
DROP TABLE IF EXISTS image_editor_revisions;
DROP TABLE IF EXISTS image_editor_documents;
