UPDATE planner_background_jobs
SET planner_meta_json = '{}'
WHERE planner_meta_json IS NOT NULL
  AND planner_meta_json <> '{}';
