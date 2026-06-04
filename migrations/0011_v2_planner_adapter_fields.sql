ALTER TABLE v2_planner_runs ADD COLUMN ui_status TEXT NOT NULL DEFAULT '';
ALTER TABLE v2_planner_runs ADD COLUMN stage TEXT NOT NULL DEFAULT '';
ALTER TABLE v2_planner_runs ADD COLUMN stage_label TEXT NOT NULL DEFAULT '';
ALTER TABLE v2_planner_runs ADD COLUMN background_job_id TEXT NOT NULL DEFAULT '';
ALTER TABLE v2_planner_runs ADD COLUMN background_status_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE v2_planner_runs ADD COLUMN running_situation_ids_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE v2_planner_items ADD COLUMN ui_status TEXT NOT NULL DEFAULT '';
ALTER TABLE v2_planner_items ADD COLUMN situation_index INTEGER;
ALTER TABLE v2_planner_items ADD COLUMN stage TEXT NOT NULL DEFAULT '';
ALTER TABLE v2_planner_items ADD COLUMN stage_label TEXT NOT NULL DEFAULT '';
ALTER TABLE v2_planner_items ADD COLUMN error_message TEXT NOT NULL DEFAULT '';
ALTER TABLE v2_planner_items ADD COLUMN background_job_id TEXT NOT NULL DEFAULT '';
ALTER TABLE v2_planner_items ADD COLUMN background_item_id TEXT NOT NULL DEFAULT '';
ALTER TABLE v2_planner_items ADD COLUMN extra_json TEXT NOT NULL DEFAULT '{}';
