PRAGMA foreign_keys = ON;

DELETE FROM planner_background_queue;
DELETE FROM planner_background_items;
DELETE FROM planner_background_jobs;
DELETE FROM planner_background_rate_limits;

DELETE FROM planner_item_image_snapshots;
DELETE FROM planner_item_images;
DELETE FROM planner_item_v4_rows;
DELETE FROM planner_items;
DELETE FROM planner_metas;

DELETE FROM json_documents WHERE doc_type IN ('planner_meta', 'planner_settings');

CREATE TABLE IF NOT EXISTS planner_v3_cleanup_generation_job_ids (
    id TEXT PRIMARY KEY
);

DELETE FROM planner_v3_cleanup_generation_job_ids;

INSERT OR IGNORE INTO planner_v3_cleanup_generation_job_ids (id)
SELECT id
FROM v2_generation_jobs
WHERE planner_run_id IS NOT NULL;

INSERT OR IGNORE INTO planner_v3_cleanup_generation_job_ids (id)
SELECT generation_job_id
FROM v2_generation_job_items
GROUP BY generation_job_id
HAVING COUNT(*) > 0
   AND SUM(CASE WHEN planner_item_id IS NULL THEN 1 ELSE 0 END) = 0;

DELETE FROM v2_generation_queue
WHERE generation_job_item_id IN (
    SELECT id
    FROM v2_generation_job_items
    WHERE generation_job_id IN (SELECT id FROM planner_v3_cleanup_generation_job_ids)
       OR planner_item_id IS NOT NULL
);

DELETE FROM v2_generation_job_items
WHERE generation_job_id IN (SELECT id FROM planner_v3_cleanup_generation_job_ids)
   OR planner_item_id IS NOT NULL;

DELETE FROM v2_generation_jobs
WHERE id IN (SELECT id FROM planner_v3_cleanup_generation_job_ids);

DROP TABLE IF EXISTS planner_v3_cleanup_generation_job_ids;

DELETE FROM v2_planner_generated_images;
DELETE FROM v2_planner_items;
DELETE FROM v2_planner_sources;
DELETE FROM v2_planner_runs;

DELETE FROM v2_prompt_v4_rows
WHERE prompt_set_id IN (
    SELECT id FROM v2_prompt_sets WHERE owner_type = 'planner_item'
);

DELETE FROM v2_prompt_parts
WHERE prompt_set_id IN (
    SELECT id FROM v2_prompt_sets WHERE owner_type = 'planner_item'
);

DELETE FROM v2_prompt_sets WHERE owner_type = 'planner_item';

DELETE FROM v2_asset_metadata
WHERE asset_id IN (
    SELECT id FROM v2_assets WHERE owner_type = 'planner_item'
);

DELETE FROM v2_assets WHERE owner_type = 'planner_item';

-- Planner V3 pre-0016 normalized snapshot tables are no longer used after
-- migrations/0016_planner_v3_simplify_generation_snapshots.sql.
-- Run 0016 before this cleanup so existing generation_settings rows are
-- backfilled into planner_v3_generation_snapshots first.
DROP TABLE IF EXISTS planner_v3_asset_metadata;
DROP TABLE IF EXISTS planner_v3_prompt_parts;
DROP TABLE IF EXISTS planner_v3_v4_rows;
DROP TABLE IF EXISTS planner_v3_generation_settings;
DROP TABLE IF EXISTS planner_v3_assets_legacy_0016;
