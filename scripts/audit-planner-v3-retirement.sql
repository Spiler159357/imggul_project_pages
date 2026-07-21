-- Read-only audit before retiring the legacy planner_v3_* schema.
-- Run this before deploying the compact-only background worker.

SELECT name AS planner_v3_table
FROM sqlite_master
WHERE type = 'table'
  AND name LIKE 'planner_v3_%'
ORDER BY name;

SELECT 'planner_v3_project_settings' AS table_name, COUNT(*) AS row_count FROM planner_v3_project_settings
UNION ALL SELECT 'planner_v3_runs', COUNT(*) FROM planner_v3_runs
UNION ALL SELECT 'planner_v3_items', COUNT(*) FROM planner_v3_items
UNION ALL SELECT 'planner_v3_item_variants', COUNT(*) FROM planner_v3_item_variants
UNION ALL SELECT 'planner_v3_generation_snapshots', COUNT(*) FROM planner_v3_generation_snapshots
UNION ALL SELECT 'planner_v3_jobs', COUNT(*) FROM planner_v3_jobs
UNION ALL SELECT 'planner_v3_job_tasks', COUNT(*) FROM planner_v3_job_tasks
UNION ALL SELECT 'planner_v3_queue', COUNT(*) FROM planner_v3_queue
UNION ALL SELECT 'planner_v3_assets', COUNT(*) FROM planner_v3_assets
UNION ALL SELECT 'planner_v3_asset_cleanup_queue', COUNT(*) FROM planner_v3_asset_cleanup_queue
UNION ALL SELECT 'planner_v3_confirm_operations', COUNT(*) FROM planner_v3_confirm_operations
UNION ALL SELECT 'planner_v3_rate_limits', COUNT(*) FROM planner_v3_rate_limits
UNION ALL SELECT 'planner_v3_events', COUNT(*) FROM planner_v3_events
ORDER BY table_name;

SELECT status, COUNT(*) AS row_count
FROM planner_v3_jobs
GROUP BY status
ORDER BY status;

SELECT status, COUNT(*) AS row_count
FROM planner_v3_queue
GROUP BY status
ORDER BY status;

SELECT status, COUNT(*) AS row_count
FROM planner_v3_confirm_operations
GROUP BY status
ORDER BY status;

SELECT status, COUNT(*) AS row_count
FROM planner_v3_asset_cleanup_queue
GROUP BY status
ORDER BY status;

-- Every query below must return zero rows before the legacy worker is removed.
SELECT id, run_id, mode, status, updated_at
FROM planner_v3_jobs
WHERE status IN ('queued', 'running', 'paused', 'cancel_requested')
ORDER BY updated_at;

SELECT id, job_id, item_id, status, lease_expires_at, updated_at
FROM planner_v3_queue
WHERE status IN ('queued', 'running', 'paused')
ORDER BY updated_at;

SELECT id, item_id, selected_asset_r2_key, target_r2_key, status, updated_at
FROM planner_v3_confirm_operations
WHERE status NOT IN ('completed', 'failed')
ORDER BY updated_at;

SELECT id, r2_key, status, attempts, updated_at
FROM planner_v3_asset_cleanup_queue
WHERE status NOT IN ('done')
ORDER BY updated_at;

-- Candidate R2 keys should be reviewed or exported before dropping the schema.
SELECT id, item_id, r2_key, status, created_at
FROM planner_v3_assets
ORDER BY created_at;

-- Confirm that the replacement compact store is populated and healthy.
SELECT record_type, status, COUNT(*) AS row_count
FROM planner_compact_records
GROUP BY record_type, status
ORDER BY record_type, status;
