-- Planner V3 generation snapshot simplification.
-- This migration adds a compact owner-level snapshot table and leaves the
-- previous generation_settings/prompt_parts/v4_rows/asset_metadata tables in
-- place for rollback/data inspection. New code should write this table only.

CREATE TABLE IF NOT EXISTS planner_v3_generation_snapshots (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('item', 'variant')),
    owner_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    variant_id TEXT,
    model TEXT NOT NULL DEFAULT '',
    resolution TEXT NOT NULL DEFAULT '',
    width INTEGER,
    height INTEGER,
    steps INTEGER,
    scale TEXT NOT NULL DEFAULT '',
    sampler TEXT NOT NULL DEFAULT '',
    seed TEXT NOT NULL DEFAULT '',
    sm INTEGER NOT NULL DEFAULT 0,
    sm_dyn INTEGER NOT NULL DEFAULT 0,
    prompt TEXT NOT NULL DEFAULT '',
    negative_prompt TEXT NOT NULL DEFAULT '',
    split_prompts_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(split_prompts_json)),
    v4_rows_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(v4_rows_json)),
    reference_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(reference_json)),
    options_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(options_json)),
    generation_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(generation_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES planner_v3_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES planner_v3_item_variants(id) ON DELETE CASCADE,
    CHECK (
        (owner_type = 'item' AND owner_id = item_id AND variant_id IS NULL)
        OR (owner_type = 'variant' AND owner_id = variant_id AND variant_id IS NOT NULL)
    ),
    UNIQUE (owner_type, owner_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_generation_snapshots_owner
    ON planner_v3_generation_snapshots(owner_type, owner_id);

CREATE INDEX IF NOT EXISTS idx_planner_v3_generation_snapshots_item
    ON planner_v3_generation_snapshots(item_id, owner_type, owner_id);

INSERT OR IGNORE INTO planner_v3_generation_snapshots (
    id, owner_type, owner_id, run_id, item_id, variant_id,
    model, resolution, width, height, steps, scale, sampler, seed, sm, sm_dyn,
    prompt, negative_prompt, split_prompts_json, v4_rows_json,
    reference_json, options_json, generation_json, created_at, updated_at
)
SELECT
    'psnap_' || id,
    owner_type,
    owner_id,
    run_id,
    item_id,
    variant_id,
    model,
    resolution,
    width,
    height,
    steps,
    scale,
    sampler,
    seed,
    sm,
    sm_dyn,
    COALESCE(json_extract(extra_json, '$.prompt'), ''),
    COALESCE(json_extract(extra_json, '$.negative'), ''),
    json_object(
        'style', COALESCE(json_extract(extra_json, '$.fields.style'), ''),
        'composition', COALESCE(json_extract(extra_json, '$.fields.composition'), ''),
        'character', COALESCE(json_extract(extra_json, '$.fields.character'), ''),
        'clothing', COALESCE(json_extract(extra_json, '$.fields.clothing'), ''),
        'expression', COALESCE(json_extract(extra_json, '$.fields.expression'), ''),
        'action', COALESCE(json_extract(extra_json, '$.fields.action'), ''),
        'background', COALESCE(json_extract(extra_json, '$.fields.background'), ''),
        'negative', COALESCE(json_extract(extra_json, '$.negative'), '')
    ),
    COALESCE(json_extract(extra_json, '$.v4PromptCharacters'), json_extract(extra_json, '$.v4_prompt'), '[]'),
    json_object(
        'vibeImageKey', COALESCE(json_extract(extra_json, '$.vibeImageKey'), ''),
        'preciseImageKey', COALESCE(json_extract(extra_json, '$.preciseImageKey'), ''),
        'inpaintImageKey', COALESCE(json_extract(extra_json, '$.inpaintImageKey'), ''),
        'vibeStrength', COALESCE(json_extract(extra_json, '$.vibeStrength'), ''),
        'vibeInfo', COALESCE(json_extract(extra_json, '$.vibeInfo'), ''),
        'preciseStrength', COALESCE(json_extract(extra_json, '$.preciseStrength'), ''),
        'preciseFidelity', COALESCE(json_extract(extra_json, '$.preciseFidelity'), ''),
        'preciseType', COALESCE(json_extract(extra_json, '$.preciseType'), '')
    ),
    json_object(
        'sm', sm,
        'sm_dyn', sm_dyn,
        'fields', COALESCE(json_extract(extra_json, '$.fields'), json('{}')),
        'prompts', COALESCE(json_extract(extra_json, '$.prompts'), json('{}'))
    ),
    extra_json,
    created_at,
    updated_at
FROM planner_v3_generation_settings
WHERE json_valid(extra_json);

DROP TABLE IF EXISTS planner_v3_asset_metadata;

ALTER TABLE planner_v3_assets RENAME TO planner_v3_assets_legacy_0016;

CREATE TABLE planner_v3_assets (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    variant_id TEXT,
    queue_id TEXT,
    r2_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'image/webp',
    byte_size INTEGER,
    width INTEGER,
    height INTEGER,
    image_index INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'candidate'
        CHECK (status IN ('candidate', 'rejected', 'deleted')),
    is_public INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES planner_v3_item_variants(id) ON DELETE SET NULL,
    FOREIGN KEY (queue_id) REFERENCES planner_v3_queue(id) ON DELETE SET NULL,
    UNIQUE (queue_id)
);

INSERT OR IGNORE INTO planner_v3_assets (
    id, item_id, variant_id, queue_id, r2_key, file_name, mime_type,
    byte_size, width, height, image_index, status, is_public,
    deleted_at, created_at, updated_at
)
SELECT
    id,
    item_id,
    NULLIF(variant_id, ''),
    NULLIF(queue_id, ''),
    r2_key,
    file_name,
    mime_type,
    byte_size,
    width,
    height,
    image_index,
    status,
    is_public,
    deleted_at,
    created_at,
    updated_at
FROM planner_v3_assets_legacy_0016;

DROP TABLE planner_v3_assets_legacy_0016;

CREATE INDEX IF NOT EXISTS idx_planner_v3_assets_item
    ON planner_v3_assets(item_id, image_index, created_at);

CREATE INDEX IF NOT EXISTS idx_planner_v3_assets_status
    ON planner_v3_assets(status, deleted_at);

CREATE INDEX IF NOT EXISTS idx_planner_v3_assets_queue
    ON planner_v3_assets(queue_id);
