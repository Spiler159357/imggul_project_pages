CREATE TABLE situation_hard_delete_targets_0022 (
    project_id TEXT NOT NULL,
    situation_id TEXT NOT NULL,
    storage_name TEXT NOT NULL,
    PRIMARY KEY (project_id, situation_id)
);

INSERT INTO situation_hard_delete_targets_0022 (project_id, situation_id, storage_name)
SELECT project_id, id, COALESCE(storage_name, image_number, '')
FROM v2_situations
WHERE is_active = 0;

CREATE TABLE situation_hard_delete_compact_items_0022 (
    record_key TEXT NOT NULL,
    item_id TEXT NOT NULL,
    PRIMARY KEY (record_key, item_id)
);

INSERT OR IGNORE INTO situation_hard_delete_compact_items_0022 (record_key, item_id)
SELECT record.record_key, json_extract(item.value, '$.itemId')
FROM planner_compact_records AS record,
     json_each(record.payload_json, '$.items') AS item
JOIN situation_hard_delete_targets_0022 AS target
  ON target.situation_id = json_extract(item.value, '$.situationId')
 AND (
     record.project_id = target.project_id
     OR record.project_id = rtrim(target.project_id, '/')
 )
WHERE record.record_type = 'run'
  AND json_extract(item.value, '$.itemId') IS NOT NULL;

DELETE FROM planner_compact_records
WHERE record_type = 'confirm'
  AND json_extract(payload_json, '$.itemId') IN (
      SELECT item_id FROM situation_hard_delete_compact_items_0022
  );

UPDATE planner_compact_records AS record
SET payload_json = json_set(
        record.payload_json,
        '$.items',
        json(COALESCE((
            SELECT json_group_array(json(item.value))
            FROM json_each(record.payload_json, '$.items') AS item
            WHERE NOT EXISTS (
                SELECT 1
                FROM situation_hard_delete_targets_0022 AS target
                WHERE target.situation_id = json_extract(item.value, '$.situationId')
                  AND (
                      record.project_id = target.project_id
                      OR record.project_id = rtrim(target.project_id, '/')
                  )
            )
        ), '[]'))
    ),
    status = 'draft',
    revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE record.record_type = 'run'
  AND EXISTS (
      SELECT 1
      FROM situation_hard_delete_compact_items_0022 AS deleted_item
      WHERE deleted_item.record_key = record.record_key
  );

DELETE FROM planner_v3_asset_cleanup_queue
WHERE source_item_id IN (
    SELECT item.id
    FROM planner_v3_items AS item
    JOIN planner_v3_runs AS run ON run.id = item.run_id
    JOIN situation_hard_delete_targets_0022 AS target
      ON target.situation_id = item.situation_id
     AND (
         run.project_id = target.project_id
         OR run.project_id = rtrim(target.project_id, '/')
     )
);

DELETE FROM planner_v3_jobs
WHERE EXISTS (
    SELECT 1
    FROM situation_hard_delete_targets_0022 AS target
    WHERE target.situation_id = planner_v3_jobs.target_situation_id
      AND (
          planner_v3_jobs.project_id = target.project_id
          OR planner_v3_jobs.project_id = rtrim(target.project_id, '/')
      )
);

DELETE FROM planner_v3_items
WHERE EXISTS (
    SELECT 1
    FROM planner_v3_runs AS run
    JOIN situation_hard_delete_targets_0022 AS target
      ON target.situation_id = planner_v3_items.situation_id
     AND (
         run.project_id = target.project_id
         OR run.project_id = rtrim(target.project_id, '/')
     )
    WHERE run.id = planner_v3_items.run_id
);

UPDATE planner_v3_runs AS run
SET running_situation_ids_json = COALESCE((
        SELECT json_group_array(value)
        FROM json_each(run.running_situation_ids_json)
        WHERE NOT EXISTS (
            SELECT 1
            FROM situation_hard_delete_targets_0022 AS target
            WHERE CAST(value AS TEXT) = target.situation_id
              AND (
                  run.project_id = target.project_id
                  OR run.project_id = rtrim(target.project_id, '/')
              )
        )
    ), '[]'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (
    SELECT 1
    FROM situation_hard_delete_targets_0022 AS target
    WHERE run.project_id = target.project_id
       OR run.project_id = rtrim(target.project_id, '/')
);

DELETE FROM v2_prompt_v4_rows
WHERE prompt_set_id IN (
    SELECT prompt.id
    FROM v2_prompt_sets AS prompt
    JOIN situation_hard_delete_targets_0022 AS target
      ON prompt.owner_type = 'situation'
     AND prompt.owner_id = target.situation_id
);

DELETE FROM v2_prompt_parts
WHERE prompt_set_id IN (
    SELECT prompt.id
    FROM v2_prompt_sets AS prompt
    JOIN situation_hard_delete_targets_0022 AS target
      ON prompt.owner_type = 'situation'
     AND prompt.owner_id = target.situation_id
);

DELETE FROM v2_prompt_sets
WHERE owner_type = 'situation'
  AND owner_id IN (
      SELECT situation_id FROM situation_hard_delete_targets_0022
  );

DELETE FROM aliases
WHERE scope = 'project'
  AND EXISTS (
      SELECT 1
      FROM situation_hard_delete_targets_0022 AS target
      WHERE aliases.project_name = substr(
                target.project_id,
                1,
                instr(target.project_id || '/', '/') - 1
            )
        AND aliases.target_key IN (
            target.storage_name || '.png',
            target.storage_name || '.jpg',
            target.storage_name || '.jpeg',
            target.storage_name || '.webp'
        )
  );

DELETE FROM v2_situations
WHERE EXISTS (
    SELECT 1
    FROM situation_hard_delete_targets_0022 AS target
    WHERE target.project_id = v2_situations.project_id
      AND target.situation_id = v2_situations.id
);

DROP TABLE situation_hard_delete_compact_items_0022;
DROP TABLE situation_hard_delete_targets_0022;
