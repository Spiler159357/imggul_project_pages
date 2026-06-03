UPDATE planner_background_items
SET generation_json = '{}'
WHERE status IN ('completed', 'partial_failed', 'failed', 'cancelled')
  AND generation_json <> '{}';
