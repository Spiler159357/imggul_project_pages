DELETE FROM planner_background_queue
WHERE status IN ('completed', 'cancelled', 'failed');
