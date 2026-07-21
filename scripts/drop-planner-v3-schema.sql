-- DESTRUCTIVE: run only after audit-planner-v3-retirement.sql shows no active
-- jobs, queues, confirms, or cleanup work and after the compact-only code is deployed.
-- Export/backup D1 before running this script.

DROP TABLE IF EXISTS planner_v3_asset_metadata;
DROP TABLE IF EXISTS planner_v3_events;
DROP TABLE IF EXISTS planner_v3_asset_cleanup_queue;
DROP TABLE IF EXISTS planner_v3_confirm_operations;
DROP TABLE IF EXISTS planner_v3_assets;
DROP TABLE IF EXISTS planner_v3_assets_legacy_0016;
DROP TABLE IF EXISTS planner_v3_queue;
DROP TABLE IF EXISTS planner_v3_job_tasks;
DROP TABLE IF EXISTS planner_v3_jobs;
DROP TABLE IF EXISTS planner_v3_generation_snapshots;
DROP TABLE IF EXISTS planner_v3_prompt_parts;
DROP TABLE IF EXISTS planner_v3_v4_rows;
DROP TABLE IF EXISTS planner_v3_generation_settings;
DROP TABLE IF EXISTS planner_v3_item_variants;
DROP TABLE IF EXISTS planner_v3_items;
DROP TABLE IF EXISTS planner_v3_runs;
DROP TABLE IF EXISTS planner_v3_project_settings;
DROP TABLE IF EXISTS planner_v3_rate_limits;
DROP TABLE IF EXISTS planner_v3_cleanup_generation_job_ids;

SELECT name
FROM sqlite_master
WHERE type = 'table'
  AND name LIKE 'planner_v3_%'
ORDER BY name;
