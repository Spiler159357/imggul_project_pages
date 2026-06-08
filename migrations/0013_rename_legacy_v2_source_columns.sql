ALTER TABLE v2_planner_runs
    RENAME COLUMN legacy_object_key TO source_object_key;

ALTER TABLE v2_generation_jobs
    RENAME COLUMN legacy_background_job_id TO source_background_job_id;

ALTER TABLE v2_generation_job_items
    RENAME COLUMN legacy_background_item_id TO source_background_item_id;

ALTER TABLE v2_generation_queue
    RENAME COLUMN legacy_background_queue_id TO source_background_queue_id;

UPDATE v2_planner_sources
SET source_type = 'alias'
WHERE source_type = 'legacy_alias';
