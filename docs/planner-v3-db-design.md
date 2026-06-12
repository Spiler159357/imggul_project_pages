# Planner V3 DB Design

## 1. Goal

Planner V3는 기존 플래너 관련 DB와 완전히 분리된 새 저장 구조다.

기존 플래너 DB에서 지원하던 기능은 유지하되, 다음 의존성은 제거한다.

- `json_documents.doc_type = 'planner_meta'`
- `json_documents.doc_type = 'planner_settings'`
- `planner_metas`
- `planner_items`
- `planner_item_v4_rows`
- `planner_item_images`
- `planner_item_image_snapshots`
- `planner_background_jobs`
- `planner_background_items`
- `planner_background_queue`
- `planner_background_rate_limits`
- `v2_planner_runs`
- `v2_planner_sources`
- `v2_planner_items`
- `v2_planner_generated_images`
- `v2_generation_jobs`
- `v2_generation_job_items`
- `v2_generation_queue`
- `v2_prompt_sets`, `v2_prompt_parts`, `v2_prompt_v4_rows` 중 `owner_type = 'planner_item'`인 row
- `v2_assets`, `v2_asset_metadata` 중 `owner_type = 'planner_item'`인 row

기존 DB에서 플래너와 관련되지 않은 테이블과 데이터는 수정하지 않는다.

Planner V3는 기존 프로젝트, 캐릭터, 상황 데이터를 읽어서 플랜을 만들 수 있지만, 플래너 실행 상태와 결과 후보 이미지는 새 `planner_v3_*` 테이블만 원본으로 삼는다.

## 2. Design Principles

1. 플래너 상태의 원본은 D1의 `planner_v3_*` 테이블이다.
2. R2는 이미지 binary와 로그 저장소로만 사용한다.
3. R2 JSON fallback은 플래너에서 사용하지 않는다.
4. 기존 `v2_*` 플래너 테이블과 legacy `planner_*` 테이블은 읽지 않는다.
5. 새 테이블은 모두 `planner_v3_` prefix를 사용한다.
6. 공유 테이블에 FK를 걸지 않는다.
   - `project_id`, `character_id`, `situation_id`는 외부 식별자처럼 저장한다.
   - 공유 테이블 삭제/이름 변경이 플래너 DB를 cascade로 삭제하지 않게 한다.
7. 플래너 생성 시점의 캐릭터, 상황, 프롬프트, 생성 설정은 snapshot으로 저장한다.
8. 계획과 실행을 분리한다.
   - plan/run/item: 사용자가 관리하는 플래너 구조
   - job/task/queue: 실제 이미지 생성 실행 구조
9. 브라우저 생성과 백그라운드 생성을 같은 실행 모델에 기록한다.
   - 백그라운드는 Cloudflare Queue가 `planner_v3_queue`를 소비한다.
   - 브라우저는 같은 job/task/queue row를 만들되, 브라우저 런타임이 queue row를 직접 완료 처리한다.
10. 삭제는 명시적으로 처리한다.
    - 최종 확정이 끝난 item은 플래너 전용 row를 일제히 삭제한다.
    - 확정된 최종 이미지는 기존 프로젝트/캐릭터 저장 흐름으로 이동하므로 플래너 DB 삭제의 영향을 받지 않는다.
    - 확정되지 않은 후보 이미지는 삭제 대상 R2 key를 cleanup outbox에 기록한 뒤 플래너 row를 삭제한다.
11. 정규화를 우선한다.
    - 조회 성능이나 구현 편의를 이유로 플래너 핵심 상태를 JSON blob에만 저장하지 않는다.
    - JSON 컬럼은 외부 API 원문, UI 임시 확장값, 디버깅 payload처럼 구조가 고정되지 않은 데이터에만 제한적으로 사용한다.

## 3. Supported Features

새 구조는 다음 기능을 모두 지원해야 한다.

- 프로젝트별 플래너 설정 저장
- 캐릭터별 플래너 초안 저장
- 상황별 플랜 생성
- 누락 이미지 일괄 플랜 생성
- 개별 플랜 편집
- prompt variant 기반 생성
- v4 prompt character rows 저장
- 브라우저 생성 모드
- 백그라운드 생성 모드
- 시작, 일시정지, 재개, 취소
- 진행률 조회
- 생성 실패와 재시도 기록
- NovelAI rate limit cooldown 기록
- 생성 이미지 후보 목록 표시
- 이미지 선택은 UI 임시 상태로만 처리
- 선택 이미지 즉시 확정
- 일부 상황만 확정 후 나머지 플랜 유지
- 모든 플랜 확정 후 run 종료
- 새로고침/재접속/모바일 접속 시 동일 상태 복원
- 임시 후보 이미지 cleanup
- 오류 로그 추적

## 4. Table Overview

| 영역 | 테이블 | 역할 |
| --- | --- | --- |
| 설정 | `planner_v3_project_settings` | 프로젝트별 플래너 기본 생성 설정 |
| Run | `planner_v3_runs` | 캐릭터별 플래너 초안/실행 상위 단위 |
| Item | `planner_v3_items` | 상황별 플랜 |
| Variant | `planner_v3_item_variants` | item에 포함된 캐릭터/상황 prompt variant 조합 |
| Settings | `planner_v3_generation_settings` | item 또는 variant별 생성 설정 snapshot |
| Prompt | `planner_v3_prompt_parts` | 생성 시점의 분리 프롬프트 |
| Prompt | `planner_v3_v4_rows` | 생성 시점의 v4 character prompt rows |
| Generation | `planner_v3_jobs` | 브라우저/백그라운드 생성 실행 단위 |
| Generation | `planner_v3_job_tasks` | item별 생성 작업 |
| Queue | `planner_v3_queue` | 이미지 1장 단위 실행 큐 |
| Assets | `planner_v3_assets` | 플래너 후보 이미지 R2 파일 |
| Metadata | `planner_v3_asset_metadata` | 후보 이미지 생성 메타데이터 |
| Cleanup | `planner_v3_asset_cleanup_queue` | 플래너 row 삭제 후 R2 후보 이미지 삭제 예약 |
| Confirm | `planner_v3_confirm_operations` | 최종 확정 처리의 재시도 가능한 상태 기록 |
| Rate limit | `planner_v3_rate_limits` | NovelAI cooldown/호출 간격 |
| Events | `planner_v3_events` | 상태 변경 감사 로그 |

## 5. Schema

### 5.1 Project Settings

`json_documents`의 `planner_settings`를 대체한다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_project_settings (
    project_id TEXT NOT NULL,
    project_prefix TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'nai-diffusion-4-5-full',
    steps TEXT NOT NULL DEFAULT '28',
    scale TEXT NOT NULL DEFAULT '5.0',
    sampler TEXT NOT NULL DEFAULT 'k_euler_ancestral',
    resolution TEXT NOT NULL DEFAULT '832x1216',
    sm INTEGER NOT NULL DEFAULT 0,
    sm_dyn INTEGER NOT NULL DEFAULT 0,
    vibe_strength TEXT NOT NULL DEFAULT '',
    vibe_info TEXT NOT NULL DEFAULT '',
    precise_strength TEXT NOT NULL DEFAULT '',
    precise_fidelity TEXT NOT NULL DEFAULT '',
    precise_type TEXT NOT NULL DEFAULT '',
    vibe_image_key TEXT NOT NULL DEFAULT '',
    precise_image_key TEXT NOT NULL DEFAULT '',
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_settings_prefix
    ON planner_v3_project_settings(project_prefix);
```

변경 시점:

- 플래너 설정 모달 저장
- 프로젝트 prefix 보정이 필요한 경우 명시 update

예시:

| project_id | project_prefix | model | steps | scale | sampler |
| --- | --- | --- | --- | --- | --- |
| `proj_001` | `comic01` | `nai-diffusion-4-5-full` | `28` | `5.0` | `k_euler_ancestral` |

### 5.2 Runs

캐릭터별 플래너의 상위 단위다. 기존 `_planner_meta.json`과 `v2_planner_runs`를 대체한다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    project_prefix TEXT NOT NULL,
    character_id TEXT NOT NULL,
    character_prefix TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'queued', 'running', 'paused', 'complete', 'partial_failed', 'failed')),
    mode TEXT NOT NULL DEFAULT 'background'
        CHECK (mode IN ('background', 'browser')),
    default_count INTEGER NOT NULL DEFAULT 20 CHECK (default_count > 0),
    active_job_id TEXT,
    running_situation_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(running_situation_ids_json)),
    stage TEXT NOT NULL DEFAULT '',
    stage_label TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_runs_project_character
    ON planner_v3_runs(project_id, character_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_planner_v3_runs_active
    ON planner_v3_runs(project_id, status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_v3_runs_one_active_character
    ON planner_v3_runs(project_id, character_id)
    WHERE status IN ('draft', 'queued', 'running', 'paused', 'complete', 'partial_failed', 'failed');
```

정책:

- 한 프로젝트/캐릭터에는 열린 run을 하나만 둔다.
- run 안의 item이 모두 확정되어 삭제되면 run도 삭제한다. 확정 완료 run을 상태 row로 누적하지 않는다.
- `active_job_id`는 현재 실행 중인 `planner_v3_jobs.id`를 가리키지만 FK를 강제하지 않는다. job 정리와 run 보존을 분리하기 위해서다.

예시:

| id | project_id | character_id | status | mode | default_count | active_job_id |
| --- | --- | --- | --- | --- | --- | --- |
| `prun_001` | `proj_001` | `char_a` | `running` | `background` | `20` | `pjob_001` |

### 5.3 Items

상황별 플랜이다. 기존 `planner_items`, `v2_planner_items`, `planner_background_items`의 계획 관련 필드를 통합한다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_items (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    situation_id TEXT NOT NULL,
    situation_name TEXT NOT NULL DEFAULT '',
    situation_index INTEGER,
    image_number TEXT NOT NULL,
    situation_rating TEXT NOT NULL DEFAULT 'sfw'
        CHECK (situation_rating IN ('sfw', 'nsfw')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'queued', 'running', 'paused', 'complete', 'partial_failed', 'failed')),
    target_count INTEGER NOT NULL DEFAULT 20 CHECK (target_count > 0),
    completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
    failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    stage TEXT NOT NULL DEFAULT '',
    stage_label TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (run_id) REFERENCES planner_v3_runs(id) ON DELETE CASCADE,
    UNIQUE (run_id, situation_id),
    CHECK (completed_count + failed_count <= target_count)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_items_run
    ON planner_v3_items(run_id, sort_order, image_number);

CREATE INDEX IF NOT EXISTS idx_planner_v3_items_status
    ON planner_v3_items(run_id, status, updated_at);
```

변경 시점:

- 상황별 플랜 생성/수정
- 생성 시작 시 `queued`
- 이미지 생성 중 `running`
- pause/resume/cancel
- 목표 수량 충족 시 `complete`
- 선택 이미지 최종 확정 시 item row 삭제

예시:

| id | run_id | situation_id | image_number | status | target_count | completed_count |
| --- | --- | --- | --- | --- | --- | --- |
| `pitem_001` | `prun_001` | `sit_001` | `1` | `running` | `20` | `3` |

### 5.4 Item Variants

item에 포함된 캐릭터 prompt variant와 상황 prompt variant 조합이다.

기존 구조의 `characterPromptVariantId`, `situationPromptVariantIds`, `variantCounts`, `variantGenerations`를 JSON으로 묶어 저장하지 않고 행 단위로 분리한다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_item_variants (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    character_prompt_variant_id TEXT NOT NULL DEFAULT '',
    character_prompt_variant_name TEXT NOT NULL DEFAULT '',
    situation_prompt_variant_id TEXT NOT NULL DEFAULT '',
    situation_prompt_variant_name TEXT NOT NULL DEFAULT '',
    target_count INTEGER NOT NULL DEFAULT 1 CHECK (target_count > 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_item_variants_item
    ON planner_v3_item_variants(item_id, sort_order);
```

정책:

- prompt variant 조합이 1개뿐이어도 반드시 row를 만든다.
- 한 item이 여러 상황 variant로 나뉘면 variant마다 별도 row를 만든다.
- 같은 item의 variant `target_count` 합계는 item `target_count`와 같아야 한다. 저장 API에서 이 합계를 검증한다.
- job task는 item을 대상으로 만들고, queue는 실제 생성 시 사용할 variant를 참조한다.

예시:

| id | item_id | character_prompt_variant_id | situation_prompt_variant_id | target_count |
| --- | --- | --- | --- | --- |
| `pvar_001` | `pitem_001` | `char_default` | `sit_closeup` | `10` |

### 5.5 Generation Settings

생성 설정 snapshot이다. item 기본 설정과 variant별 override를 모두 표현할 수 있다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_generation_settings (
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
    vibe_strength TEXT NOT NULL DEFAULT '',
    vibe_info TEXT NOT NULL DEFAULT '',
    precise_strength TEXT NOT NULL DEFAULT '',
    precise_fidelity TEXT NOT NULL DEFAULT '',
    precise_type TEXT NOT NULL DEFAULT '',
    vibe_asset_key TEXT NOT NULL DEFAULT '',
    precise_asset_key TEXT NOT NULL DEFAULT '',
    inpaint_asset_key TEXT NOT NULL DEFAULT '',
    extra_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json)),
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

CREATE INDEX IF NOT EXISTS idx_planner_v3_generation_settings_owner
    ON planner_v3_generation_settings(owner_type, owner_id);

CREATE INDEX IF NOT EXISTS idx_planner_v3_generation_settings_item
    ON planner_v3_generation_settings(item_id, owner_type, owner_id);
```

정책:

- 기본 생성 설정은 `owner_type = 'item'`으로 저장한다.
- variant별 설정이 다르면 `owner_type = 'variant'`로 override row를 둔다.
- browser/background 모두 이 테이블에서 같은 입력값을 읽는다.
- `owner_type/owner_id`는 조회 편의용 식별자이고, 실제 삭제 경계는 `run_id/item_id/variant_id` FK로 강제한다.

예시:

| owner_type | owner_id | model | resolution | steps | sampler |
| --- | --- | --- | --- | --- | --- |
| `variant` | `pvar_001` | `nai-diffusion-4-5-full` | `832x1216` | `28` | `k_euler_ancestral` |

### 5.6 Prompt Parts

생성 당시의 분리 프롬프트 snapshot이다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_prompt_parts (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('item', 'variant')),
    owner_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    variant_id TEXT,
    part_key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES planner_v3_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES planner_v3_item_variants(id) ON DELETE CASCADE,
    CHECK (
        (owner_type = 'item' AND owner_id = item_id AND variant_id IS NULL)
        OR (owner_type = 'variant' AND owner_id = variant_id AND variant_id IS NOT NULL)
    ),
    UNIQUE (owner_type, owner_id, part_key)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_prompt_parts_item
    ON planner_v3_prompt_parts(owner_type, owner_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_planner_v3_prompt_parts_item_owner
    ON planner_v3_prompt_parts(item_id, owner_type, owner_id, sort_order);
```

`part_key` 예시:

- `style`
- `composition`
- `character`
- `clothing`
- `expression`
- `action`
- `background`
- `negative`
- `raw`

예시:

| owner_type | owner_id | part_key | value |
| --- | --- | --- |
| `variant` | `pvar_001` | `character` | `Alice, black hair` |

### 5.7 V4 Rows

NovelAI v4 character prompt rows다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_v4_rows (
    id TEXT PRIMARY KEY,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('item', 'variant')),
    owner_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    variant_id TEXT,
    row_index INTEGER NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    clothing TEXT NOT NULL DEFAULT '',
    expression TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    negative TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES planner_v3_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES planner_v3_item_variants(id) ON DELETE CASCADE,
    CHECK (
        (owner_type = 'item' AND owner_id = item_id AND variant_id IS NULL)
        OR (owner_type = 'variant' AND owner_id = variant_id AND variant_id IS NOT NULL)
    ),
    UNIQUE (owner_type, owner_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_v4_rows_item
    ON planner_v3_v4_rows(owner_type, owner_id, row_index);

CREATE INDEX IF NOT EXISTS idx_planner_v3_v4_rows_item_owner
    ON planner_v3_v4_rows(item_id, owner_type, owner_id, row_index);
```

예시:

| owner_type | owner_id | row_index | subject | clothing | expression | action |
| --- | --- | --- | --- | --- | --- |
| `variant` | `pvar_001` | `0` | `Alice` | `school uniform` | `smile` | `standing` |

### 5.8 Jobs

실제 생성 실행 단위다. 브라우저 생성과 백그라운드 생성을 모두 기록한다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_jobs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    project_prefix TEXT NOT NULL,
    character_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'background'
        CHECK (mode IN ('background', 'browser')),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'paused', 'completed', 'partial_failed', 'failed', 'cancel_requested', 'cancelled')),
    target_situation_id TEXT,
    total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
    completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
    failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    stage TEXT NOT NULL DEFAULT '',
    stage_label TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    active_key TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    cancelled_at TEXT,
    FOREIGN KEY (run_id) REFERENCES planner_v3_runs(id) ON DELETE CASCADE,
    CHECK (completed_count + failed_count <= total_count)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_jobs_run
    ON planner_v3_jobs(run_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_planner_v3_jobs_status
    ON planner_v3_jobs(status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_v3_jobs_one_active_run
    ON planner_v3_jobs(run_id)
    WHERE status IN ('queued', 'running', 'paused', 'cancel_requested');

CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_v3_jobs_active_key
    ON planner_v3_jobs(active_key)
    WHERE active_key <> ''
      AND status IN ('queued', 'running', 'paused', 'cancel_requested');
```

`active_key` 정책:

- 전체 캐릭터 실행: `{project_id}:{character_id}:all`
- 단일 상황 실행: `{project_id}:{character_id}:{situation_id}`

예시:

| id | run_id | mode | status | total_count | completed_count |
| --- | --- | --- | --- | --- | --- |
| `pjob_001` | `prun_001` | `background` | `running` | `20` | `3` |

### 5.9 Job Tasks

job 안에서 item별 생성 실행 상태를 기록한다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_job_tasks (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'paused', 'completed', 'partial_failed', 'failed', 'cancel_requested', 'cancelled')),
    target_count INTEGER NOT NULL DEFAULT 1 CHECK (target_count > 0),
    completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
    failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    stage TEXT NOT NULL DEFAULT '',
    stage_label TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    queue_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (job_id) REFERENCES planner_v3_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE,
    UNIQUE (job_id, item_id),
    CHECK (completed_count + failed_count <= target_count)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_tasks_job
    ON planner_v3_job_tasks(job_id, queue_order);

CREATE INDEX IF NOT EXISTS idx_planner_v3_tasks_status
    ON planner_v3_job_tasks(job_id, status, updated_at);
```

예시:

| id | job_id | item_id | status | target_count | completed_count |
| --- | --- | --- | --- | --- | --- |
| `ptask_001` | `pjob_001` | `pitem_001` | `running` | `20` | `3` |

### 5.10 Queue

이미지 1장 단위 큐다. 백그라운드 생성과 브라우저 생성이 모두 이 테이블을 사용한다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_queue (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    image_index INTEGER NOT NULL,
    variant_image_index INTEGER NOT NULL DEFAULT 0,
    executor TEXT NOT NULL DEFAULT 'background'
        CHECK (executor IN ('background', 'browser')),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancel_requested', 'cancelled')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    scheduled_at TEXT,
    claimed_by TEXT NOT NULL DEFAULT '',
    claim_token TEXT NOT NULL DEFAULT '',
    claimed_at TEXT,
    lease_expires_at TEXT,
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (job_id) REFERENCES planner_v3_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES planner_v3_job_tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES planner_v3_item_variants(id) ON DELETE CASCADE,
    UNIQUE (job_id, sequence),
    UNIQUE (task_id, image_index),
    UNIQUE (task_id, variant_id, variant_image_index)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_queue_next
    ON planner_v3_queue(job_id, executor, status, scheduled_at, sequence);

CREATE INDEX IF NOT EXISTS idx_planner_v3_queue_task
    ON planner_v3_queue(task_id, image_index);

CREATE INDEX IF NOT EXISTS idx_planner_v3_queue_variant
    ON planner_v3_queue(task_id, variant_id, variant_image_index);

CREATE INDEX IF NOT EXISTS idx_planner_v3_queue_lease
    ON planner_v3_queue(status, lease_expires_at, updated_at);
```

정책:

- background mode는 Cloudflare Queue worker가 `executor = 'background'` row를 처리한다.
- browser mode는 프론트 런타임이 `executor = 'browser'` row를 하나씩 가져가고, 이미지 생성 완료 후 API로 row를 완료 처리한다.
- queue claim은 lease 방식으로 처리한다. 처리자는 `queued` 또는 만료된 `running` row만 `running`으로 바꾸고, 매번 새 `claim_token`을 저장한다.
- 생성 완료 API는 `queue_id`, `claim_token`이 모두 일치하고 row가 아직 `running`일 때만 asset 생성과 count 증가를 수행한다.
- `image_index`는 task 전체에서의 전역 순번이고, `variant_image_index`는 같은 variant 안에서의 순번이다.
- 완료된 queue row는 item 확정 전까지 남겨 진행률 복원에 사용한다.
- item 확정 후에는 해당 item의 queue/task/job 관련 row가 cascade 또는 명시 삭제로 제거되어 누적되지 않아야 한다.

예시:

| id | job_id | task_id | variant_id | executor | image_index | status | attempts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pqueue_001` | `pjob_001` | `ptask_001` | `pvar_001` | `background` | `0` | `running` | `1` |

### 5.11 Assets

플래너 후보 이미지 전용 asset 테이블이다. 기존 `v2_assets`와 독립된다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_assets (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    queue_id TEXT NOT NULL,
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
    FOREIGN KEY (run_id) REFERENCES planner_v3_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES planner_v3_items(id) ON DELETE CASCADE,
    FOREIGN KEY (variant_id) REFERENCES planner_v3_item_variants(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES planner_v3_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES planner_v3_job_tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (queue_id) REFERENCES planner_v3_queue(id) ON DELETE CASCADE,
    UNIQUE (queue_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_assets_item
    ON planner_v3_assets(item_id, image_index, created_at);

CREATE INDEX IF NOT EXISTS idx_planner_v3_assets_status
    ON planner_v3_assets(status, deleted_at);
```

R2 key 정책:

```text
planner-v3/{project_id}/{run_id}/{item_id}/{asset_id}.webp
```

기존 `comic01_planner_temp_image/1/*.webp` 패턴은 새 플래너에서는 사용하지 않는다.

예시:

| id | run_id | item_id | variant_id | r2_key | status |
| --- | --- | --- | --- | --- | --- |
| `passet_001` | `prun_001` | `pitem_001` | `pvar_001` | `planner-v3/proj_001/prun_001/pitem_001/passet_001.webp` | `candidate` |

### 5.12 Asset Metadata

후보 이미지 생성 메타데이터다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_asset_metadata (
    asset_id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL DEFAULT '',
    negative_prompt TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    sampler TEXT NOT NULL DEFAULT '',
    steps INTEGER,
    scale TEXT NOT NULL DEFAULT '',
    seed TEXT NOT NULL DEFAULT '',
    width INTEGER,
    height INTEGER,
    split_prompts_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(split_prompts_json)),
    v4_rows_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(v4_rows_json)),
    request_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(request_json)),
    response_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(response_json)),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (asset_id) REFERENCES planner_v3_assets(id) ON DELETE CASCADE
);
```

예시:

| asset_id | model | seed | width | height |
| --- | --- | --- | --- | --- |
| `passet_001` | `nai-diffusion-4-5-full` | `123456` | `832` | `1216` |

### 5.13 Asset Cleanup Queue

플래너 row를 삭제한 뒤 R2 후보 이미지를 비동기로 삭제하기 위한 outbox다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_asset_cleanup_queue (
    id TEXT PRIMARY KEY,
    r2_key TEXT NOT NULL UNIQUE,
    source_asset_id TEXT NOT NULL DEFAULT '',
    source_run_id TEXT NOT NULL DEFAULT '',
    source_item_id TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'done', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    claimed_by TEXT NOT NULL DEFAULT '',
    claim_token TEXT NOT NULL DEFAULT '',
    claimed_at TEXT,
    lease_expires_at TEXT,
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_asset_cleanup_next
    ON planner_v3_asset_cleanup_queue(status, lease_expires_at, updated_at);
```

정책:

- item 확정, run 삭제, stale queue upload처럼 DB row 삭제와 R2 삭제가 분리되는 모든 경로는 먼저 이 테이블에 삭제 대상 `r2_key`를 넣는다.
- stale queue upload처럼 DB asset row가 생성되지 않은 경우 `source_asset_id`, `source_run_id`, `source_item_id`는 빈 문자열일 수 있다.
- R2 삭제 실패가 플래너 DB 정리를 막지 않도록 outbox를 사용한다.
- cleanup worker도 lease 방식으로 `pending` 또는 lease가 만료된 `running` row를 claim하고, 실패 시 `attempts`, `error_message`, `updated_at`을 갱신해 재시도한다.

예시:

| r2_key | source_asset_id | reason | status |
| --- | --- | --- | --- |
| `planner-v3/proj_001/prun_001/pitem_001/passet_001.webp` | `passet_001` | `confirmed_item_cleanup` | `pending` |

### 5.14 Confirm Operations

후보 이미지를 최종 이미지로 확정하는 작업의 idempotency ledger다. R2 복사와 D1 갱신은 하나의 원자적 트랜잭션으로 묶을 수 없으므로, 확정 요청은 먼저 operation row를 만들고 단계별로 재시도 가능하게 진행한다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_confirm_operations (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    selected_asset_id TEXT NOT NULL,
    selected_asset_r2_key TEXT NOT NULL,
    target_r2_key TEXT NOT NULL,
    target_folder_prefix TEXT NOT NULL DEFAULT '',
    target_file_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'copying', 'metadata_saved', 'cleanup_queued', 'completed', 'failed')),
    idempotency_key TEXT NOT NULL UNIQUE,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    error_message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    expires_at TEXT,
    UNIQUE (item_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_confirm_operations_item
    ON planner_v3_confirm_operations(item_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_planner_v3_confirm_operations_retention
    ON planner_v3_confirm_operations(status, expires_at);
```

정책:

- confirm API는 `item_id`, `asset_id`, `idempotency_key`를 받는다.
- `asset_id`는 반드시 같은 `item_id`에 속한 `candidate` asset이어야 한다.
- operation row는 item/asset FK를 걸지 않는다. 확정 성공 후 planner row가 삭제되어도 같은 `idempotency_key` 재요청에 완료 결과를 반환할 수 있어야 하기 때문이다.
- 같은 item에는 하나의 confirm operation만 허용한다. 서로 다른 asset을 동시에 확정하려는 요청은 먼저 생성된 operation을 기준으로 처리한다.
- 동일 `idempotency_key` 요청은 기존 operation 상태를 반환하거나 다음 미완료 단계부터 재시도한다.
- 최종 R2 복사, `file_metadata` 저장, cleanup queue 등록, planner row 삭제는 operation 상태를 갱신하면서 단계적으로 수행한다.
- `completed` operation은 플래너 실행 상태로 사용하지 않는다. 짧은 retention 기간 뒤 삭제할 수 있고, 운영 감사가 필요하면 `planner_v3_events`에 별도 기록한다.

### 5.15 Rate Limits

기존 `planner_background_rate_limits`를 대체한다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_rate_limits (
    key TEXT PRIMARY KEY,
    available_at INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);
```

예시:

| key | available_at | reason |
| --- | --- | --- |
| `novelai` | `1780970000000` | `429` |

### 5.16 Events

운영 디버깅과 상태 추적을 위한 append-only event log다.

```sql
CREATE TABLE IF NOT EXISTS planner_v3_events (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    item_id TEXT,
    job_id TEXT,
    task_id TEXT,
    queue_id TEXT,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    data_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data_json)),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_planner_v3_events_run
    ON planner_v3_events(run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_planner_v3_events_job
    ON planner_v3_events(job_id, created_at);
```

예시:

| run_id | job_id | event_type | status | stage |
| --- | --- | --- | --- | --- |
| `prun_001` | `pjob_001` | `queue_started` | `running` | `novelai_request` |

## 6. Status Model

### 6.1 Run Status

| status | 의미 |
| --- | --- |
| `draft` | 초안. 실행 전 또는 취소 후 재실행 가능 |
| `queued` | 실행 등록 완료, 아직 실제 생성 전 |
| `running` | 하나 이상의 item/task가 실행 중 |
| `paused` | 실행 일시정지 |
| `complete` | 모든 대상 item이 성공했고 사용자 확정을 기다리는 상태 |
| `partial_failed` | 일부 성공, 일부 실패 |
| `failed` | 전부 실패 또는 치명적 오류 |

확정 완료 상태는 run row에 저장하지 않는다. 마지막 item 확정이 끝나면 run row 자체를 삭제한다.

### 6.2 Item Status

| status | 의미 |
| --- | --- |
| `pending` | 생성 전 |
| `queued` | 실행 대기 |
| `running` | 생성 중 |
| `paused` | 일시정지 |
| `complete` | 목표 후보 이미지 생성 완료, 사용자 확정 대기 |
| `partial_failed` | 일부 이미지만 생성 성공 |
| `failed` | 생성 실패 |

확정 완료 상태는 item row에 저장하지 않는다. 사용자가 후보 이미지를 확정하면 item row 자체를 삭제한다.

### 6.3 Job/Task Status

| status | 의미 |
| --- | --- |
| `queued` | 대기 |
| `running` | 실행 중 |
| `paused` | 일시정지 |
| `completed` | 완료 |
| `partial_failed` | 부분 실패 |
| `failed` | 실패 |
| `cancel_requested` | 취소 요청 수신 |
| `cancelled` | 취소 완료 |

### 6.4 Queue Status

| status | 의미 |
| --- | --- |
| `queued` | 처리 대기 |
| `running` | lease를 가진 처리자가 실행 중 |
| `paused` | 일시정지 |
| `completed` | 해당 이미지 1장 생성 완료 |
| `failed` | 해당 이미지 1장 생성 실패 |
| `cancel_requested` | 취소 요청 수신 |
| `cancelled` | 취소 완료 |

## 7. Core Data Flow

### 7.1 Create Draft

1. 프론트는 기존 프로젝트/캐릭터/상황 데이터를 읽는다.
2. 플래너 API는 `planner_v3_runs`에 run을 만든다.
3. 상황별로 `planner_v3_items`를 만든다.
4. 생성 당시 프롬프트를 `planner_v3_prompt_parts`와 `planner_v3_v4_rows`에 snapshot으로 저장한다.
5. 브라우저는 `planner_v3_runs` + `planner_v3_items`를 조립한 응답을 받아 기존 planner UI shape로 렌더링한다.

### 7.2 Start Background Generation

1. API가 실행 대상 item을 조회한다.
2. 같은 run에 active job이 있으면 새 job을 만들지 않고 기존 job을 반환한다.
3. `planner_v3_jobs` row를 생성한다.
4. item별 `planner_v3_job_tasks` row를 생성한다.
5. variant별 `target_count`에 따라 `executor = 'background'`인 `planner_v3_queue` row를 생성한다.
6. run/item status를 `queued`로 갱신한다.
7. Cloudflare Queue에 첫 메시지를 보낸다.

### 7.3 Start Browser Generation

브라우저 생성은 백그라운드와 별도 임시 구조를 쓰지 않는다. 같은 job/task/queue 구조를 쓰되 실행 주체만 다르다.

1. API가 실행 대상 item을 조회한다.
2. 같은 run에 active job이 있으면 새 job을 만들지 않고 기존 job을 반환한다.
3. `planner_v3_jobs.mode = 'browser'` row를 생성한다.
4. item별 `planner_v3_job_tasks` row를 생성한다.
5. variant별 `target_count`에 따라 `executor = 'browser'`인 `planner_v3_queue` row를 생성한다.
6. 프론트는 `/api/planner/v3/generate/next-browser-queue` 같은 API로 다음 queue row를 가져간다.
7. 브라우저에서 이미지 생성이 끝나면 `/api/planner/v3/generate/complete-browser-queue`로 결과 asset을 등록한다.
8. 진행률, pause, cancel, 완료 rollup은 background mode와 같은 테이블에서 처리한다.

### 7.4 Process One Queue Entry

1. 처리자는 `queued` 또는 lease가 만료된 `running` queue row를 조회한다.
2. `UPDATE ... WHERE status IN (...)` 조건으로 row를 `running`으로 claim하고 `claim_token`, `claimed_by`, `lease_expires_at`을 저장한다.
3. claim에 성공한 처리자만 job/task/item/run을 `running`으로 rollup한다.
4. `planner_v3_rate_limits`에서 NovelAI 호출 가능 시간을 확인한다.
5. NovelAI 생성 요청을 보낸다.
6. 결과 이미지를 WebP로 변환한다.
7. R2 저장 직전에 queue row의 `claim_token`, `status = 'running'`, `lease_expires_at`을 다시 확인한다.
8. claim이 더 이상 유효하지 않으면 이미지 bytes를 버리고 DB/R2에 결과를 남기지 않는다.
9. claim이 유효하면 R2에 `planner-v3/{project_id}/{run_id}/{item_id}/{asset_id}.webp`로 저장한다.
10. R2 저장 직후 DB transaction에서 같은 `queue_id`의 asset 존재 여부와 `claim_token`을 다시 확인한다.
11. 같은 `queue_id`의 asset이 이미 있으면 중복 완료로 보고 방금 저장한 R2 key를 `planner_v3_asset_cleanup_queue`에 `stale_queue_upload` reason으로 넣는다.
12. `claim_token`이 일치하고 queue row가 아직 `running`일 때만 `planner_v3_assets`와 `planner_v3_asset_metadata`를 생성한다.
13. queue row를 `completed`로 바꾸고 task/item/job/run의 completed count를 한 번만 증가시킨다.
14. 다음 queue entry를 예약한다.
15. 모든 queue가 끝나면 item/run은 `complete`, job은 `completed` 또는 `partial_failed`가 된다.

### 7.5 Pause

1. active job status를 `paused`로 바꾼다.
2. running/queued task와 queue를 `paused`로 바꾼다.
3. run과 대상 item을 `paused`로 바꾼다.
4. 이미 생성된 assets는 유지한다.

### 7.6 Resume

1. paused job을 다시 `queued`로 바꾼다.
2. 완료되지 않은 task와 queue를 `queued`로 되돌린다.
3. run과 item을 `queued`로 바꾼다.
4. 다음 queue message를 보낸다.

### 7.7 Cancel

1. active job을 `cancel_requested`로 표시한다.
2. 아직 생성되지 않은 queue를 `cancelled` 또는 삭제 대상으로 표시한다.
3. run은 `draft`로 되돌린다.
4. 완료되지 않은 item은 `pending`으로 되돌린다.
5. 이미 생성된 후보 이미지는 정책에 따라 유지하거나 `deleted`로 soft delete한다.

기본 정책:

- 사용자가 명시적으로 "기존 결과 삭제 후 다시 실행"을 선택한 경우만 후보 이미지를 삭제한다.
- 일반 취소는 이미 만들어진 후보 이미지를 유지한다.

### 7.8 Confirm Image

생성 완료 후 item은 `complete` 상태로 대기한다. 사용자가 후보 이미지를 고르면 별도 선택 상태를 저장하지 않고 곧바로 확정 API를 호출한다.

1. 확정 API는 `item_id`, 사용자가 고른 `asset_id`, `idempotency_key`를 받는다.
2. 같은 `idempotency_key`의 operation이 이미 있으면 현재 상태를 읽고 다음 미완료 단계부터 재개한다.
3. 같은 `item_id`에 다른 `idempotency_key`의 operation이 이미 있으면 중복 확정 시도로 보고 conflict를 반환한다.
4. 새 operation을 만들 때는 `asset_id`가 같은 `item_id`에 속한 `candidate` asset인지 검증하고, 선택 asset의 현재 `r2_key`를 `selected_asset_r2_key`에 snapshot한다.
5. operation 상태가 `pending`이면 상태를 `copying`으로 바꾸고 선택된 asset의 R2 파일을 최종 캐릭터 이미지 위치로 복사한다.
6. 기존 `file_metadata` API 흐름으로 최종 이미지 메타데이터를 저장하고 `metadata_saved`로 갱신한다.
7. 같은 item의 모든 후보 asset `r2_key`를 `planner_v3_asset_cleanup_queue`에 `INSERT OR IGNORE`하고 `cleanup_queued`로 갱신한다.
8. item 관련 planner row를 삭제한다.
9. operation을 `completed`로 갱신하고 `expires_at`을 설정한다.
10. FK cascade로 item에 종속된 variants, queue, task, assets, metadata, prompt/settings/v4 rows가 삭제된다.
11. 해당 run에 남은 item이 없으면 `planner_v3_runs`를 삭제한다.
12. cleanup worker가 `planner_v3_asset_cleanup_queue`를 읽어 R2 임시 후보 이미지를 삭제한다.

확정 후 플래너 DB에 누적되어도 되는 것은 `planner_v3_asset_cleanup_queue`의 cleanup 작업 row, retention 기간 안의 `planner_v3_confirm_operations`, 선택적으로 남기는 `planner_v3_events`뿐이다. 플래너 실행에 다시 영향을 줄 수 있는 job, task, queue, item, asset row는 남기지 않는다.

## 8. Normalization Policy

Planner V3는 기존 DB의 단순 대체가 아니라 구조 쇄신을 목표로 한다.

정규화 원칙:

1. run, item, variant, generation setting, prompt, job, task, queue, asset을 별도 테이블로 분리한다.
2. item row에는 현재 상태와 정렬/식별 정보만 둔다.
3. prompt variant 조합은 `planner_v3_item_variants`에 행 단위로 저장한다.
4. 생성 설정은 `planner_v3_generation_settings`에 저장한다.
5. 분리 프롬프트는 `planner_v3_prompt_parts`에 저장한다.
6. v4 character rows는 `planner_v3_v4_rows`에 저장한다.
7. 생성 결과 후보 이미지는 `planner_v3_assets`에 저장한다.
8. 이미지 메타데이터는 `planner_v3_asset_metadata`에 저장한다.
9. 브라우저 생성과 백그라운드 생성은 동일한 job/task/queue 구조를 사용한다.
10. 선택 상태는 저장하지 않는다. 선택은 확정 API 요청의 입력값일 뿐이다.

JSON 허용 범위:

- `extra_json`: UI가 아직 정규화하지 않은 확장 필드 임시 보존
- `request_json`, `response_json`, `metadata_json`: 외부 API 원문 또는 디버깅 payload
- `running_situation_ids_json`: UI 표시 보조. 핵심 상태 판단은 item/job/task/queue에서 한다.

JSON 금지 범위:

- item 목록 전체
- 생성 queue 전체
- 후보 이미지 목록 전체
- prompt parts 전체
- v4 rows 전체
- 선택/확정 상태 전체

## 9. Deletion Policy

삭제 정책은 Planner V3의 핵심 요구사항이다. 생성 이력이 누적되어 이후 작업에 영향을 주는 구조를 만들지 않는다.

### 9.1 Deletion Goals

1. item 확정 후 해당 item의 플래너 전용 row는 일제히 삭제된다.
2. run 안의 모든 item이 확정되어 삭제되면 run도 삭제된다.
3. run 삭제 시 job/task/queue row도 함께 삭제된다.
4. 확정된 최종 이미지는 플래너 DB 밖의 기존 최종 저장 구조에 남는다.
5. 후보 이미지 R2 파일은 cleanup outbox를 통해 삭제한다.
6. 삭제 후 같은 캐릭터의 새 플래너를 만들 때 과거 job/queue가 조회되면 안 된다.

### 9.2 Ownership Tree

아래 트리가 삭제 경계다.

```text
planner_v3_runs
  -> planner_v3_items
      -> planner_v3_item_variants
          -> planner_v3_generation_settings(variant_id)
          -> planner_v3_prompt_parts(variant_id)
          -> planner_v3_v4_rows(variant_id)
      -> planner_v3_generation_settings(item_id)
      -> planner_v3_prompt_parts(item_id)
      -> planner_v3_v4_rows(item_id)
      -> planner_v3_job_tasks
          -> planner_v3_queue
      -> planner_v3_assets
          -> planner_v3_asset_metadata
  -> planner_v3_jobs
      -> planner_v3_job_tasks
          -> planner_v3_queue

planner_v3_confirm_operations
  -> 독립 idempotency ledger. run/item/asset id는 문자열 snapshot이며 FK cascade 대상이 아니다.
```

`owner_type/owner_id`는 조회용 식별자다. SQLite/D1은 polymorphic FK를 강제할 수 없으므로 prompt/settings/v4 테이블에는 `run_id`, `item_id`, `variant_id`를 함께 저장해 실제 삭제 경계를 FK로 강제한다.

### 9.3 Confirm One Item Delete Transaction

item 하나를 확정하면 다음 순서로 처리한다.

1. `planner_v3_assets`에서 `item_id = ?`인 후보 이미지의 `r2_key`를 조회한다.
2. `planner_v3_confirm_operations`에 `idempotency_key` 기준으로 operation row를 만들고 선택 asset의 `r2_key`를 snapshot한다.
3. 선택된 `asset_id`의 R2 파일을 최종 위치로 복사한다.
4. 최종 위치의 `file_metadata`를 저장한다.
5. 조회한 모든 후보 `r2_key`를 `planner_v3_asset_cleanup_queue`에 `INSERT OR IGNORE`한다.
6. `planner_v3_confirm_operations`를 `cleanup_queued`로 갱신한다.
7. `planner_v3_queue`에서 해당 item의 row를 삭제한다.
8. queue FK cascade로 해당 item의 `planner_v3_assets`와 `planner_v3_asset_metadata`가 삭제된다.
9. `planner_v3_job_tasks`에서 해당 item의 row를 삭제한다.
10. `planner_v3_items`에서 해당 item row를 삭제한다.
11. item/variant FK cascade로 variants, prompt/settings/v4 rows가 삭제된다.
12. `planner_v3_confirm_operations`를 `completed`로 갱신하고 `expires_at`을 설정한다.
13. `planner_v3_jobs` 중 더 이상 task가 없는 job을 삭제한다.
14. `planner_v3_runs` 중 더 이상 item이 없는 run을 삭제한다.

예시 SQL 형태:

```sql
INSERT OR IGNORE INTO planner_v3_asset_cleanup_queue (
    id, r2_key, source_asset_id, source_run_id, source_item_id, reason,
    status, created_at, updated_at
)
SELECT
    'cleanup_' || id,
    r2_key,
    id,
    run_id,
    item_id,
    'confirmed_item_cleanup',
    'pending',
    ?,
    ?
FROM planner_v3_assets
WHERE item_id = ?;

UPDATE planner_v3_confirm_operations
SET status = 'cleanup_queued',
    updated_at = ?
WHERE id = ?
  AND status = 'metadata_saved';

DELETE FROM planner_v3_queue WHERE item_id = ?;
DELETE FROM planner_v3_job_tasks WHERE item_id = ?;
DELETE FROM planner_v3_items WHERE id = ?;

UPDATE planner_v3_confirm_operations
SET status = 'completed',
    completed_at = ?,
    expires_at = ?,
    updated_at = ?
WHERE id = ?
  AND status = 'cleanup_queued';

DELETE FROM planner_v3_jobs
WHERE run_id = ?
  AND id NOT IN (SELECT DISTINCT job_id FROM planner_v3_job_tasks);

DELETE FROM planner_v3_runs
WHERE id = ?
  AND id NOT IN (SELECT DISTINCT run_id FROM planner_v3_items);
```

### 9.4 Delete Whole Run

사용자가 플래너 전체를 취소/삭제하거나 모든 item이 확정된 뒤 마지막 item 삭제가 끝나면 run 전체를 정리한다.

순서:

1. run의 모든 후보 asset `r2_key`를 cleanup queue에 넣는다.
2. run에 속한 non-terminal `planner_v3_confirm_operations`가 있으면 삭제를 거부하고 confirm 완료/실패 처리를 먼저 끝낸다.
3. `DELETE FROM planner_v3_runs WHERE id = ?`를 실행한다.
4. FK cascade로 item, variant, prompt/settings/v4 rows, job, task, queue, assets, metadata가 제거된다.
5. cleanup worker가 R2 임시 이미지를 삭제한다.

### 9.5 What Must Not Be Deleted

다음은 플래너 확정/삭제 과정에서 삭제하지 않는다.

- 최종 캐릭터 이미지 R2 key
- 최종 이미지의 `file_metadata`
- 프로젝트/캐릭터/상황 원본 데이터
- aliases
- 플래너와 무관한 `v2_assets`
- 플래너와 무관한 `json_documents`

### 9.6 What Must Not Accumulate

다음 row는 완료/확정 이후 누적되면 안 된다.

- 완료된 `planner_v3_queue`
- 완료된 `planner_v3_job_tasks`
- 완료된 `planner_v3_jobs`
- 확정된 `planner_v3_assets`
- 확정된 `planner_v3_asset_metadata`
- 확정된 `planner_v3_items`
- item이 없는 `planner_v3_runs`
- `expires_at`이 지난 terminal `planner_v3_confirm_operations`

기존 `v2_generation_queue`, `v2_generation_jobs`, `v2_generation_job_items`처럼 과거 실행 내역이 계속 쌓이는 구조는 금지한다.

## 10. API Design

기존 `/api/planner/meta`와 `/api/planner/background/*`는 제거하거나 v3 API로 내부 redirect하지 않는다. 레거시 호환을 없애기 위해 프론트 호출을 명시적으로 교체한다.

| Method | Path | 용도 |
| --- | --- | --- |
| `GET` | `/api/planner/v3/settings?projectId=` | 설정 조회 |
| `PUT` | `/api/planner/v3/settings` | 설정 저장 |
| `GET` | `/api/planner/v3/run?projectId=&characterId=` | 열린 run 조회 |
| `POST` | `/api/planner/v3/run` | run 생성 |
| `PUT` | `/api/planner/v3/run/:runId` | run header 수정 |
| `DELETE` | `/api/planner/v3/run/:runId` | run 삭제 |
| `PUT` | `/api/planner/v3/item/:itemId` | item 수정 |
| `DELETE` | `/api/planner/v3/item/:itemId` | item 삭제 |
| `POST` | `/api/planner/v3/generate/start` | 생성 시작 |
| `GET` | `/api/planner/v3/generate/status?jobId=` | 생성 상태 조회 |
| `GET` | `/api/planner/v3/generate/next-browser-queue?jobId=` | 브라우저 생성용 다음 queue 조회 |
| `POST` | `/api/planner/v3/generate/complete-browser-queue` | 브라우저 생성 결과 등록 |
| `POST` | `/api/planner/v3/generate/pause` | 일시정지 |
| `POST` | `/api/planner/v3/generate/resume` | 재개 |
| `POST` | `/api/planner/v3/generate/cancel` | 취소 |
| `POST` | `/api/planner/v3/confirm` | `item_id`, `asset_id`, `idempotency_key`를 받아 즉시 확정 |
| `POST` | `/api/planner/v3/cleanup-assets` | 삭제 예정 후보 이미지 cleanup |

`GET /api/planner/v3/run`은 해당 캐릭터에 열린 run이 없을 때 콘솔에 불필요한 네트워크 오류가 찍히지 않도록 `200 { data: null }`을 반환한다.

## 11. Frontend Code Changes

기존 함수 이름은 UI 회귀를 줄이기 위해 1차로 유지할 수 있다. 다만 내부 호출 대상은 v3 API로 바꾼다.

| 기존 함수 | 변경 방향 |
| --- | --- |
| `loadPlannerMeta` | `/api/planner/v3/run`에서 run 상세 조회 |
| `savePlannerMeta` | run/item/prompt snapshot API 호출로 분해 저장 |
| `deletePlannerMeta` | `/api/planner/v3/run/:runId` 삭제 |
| `loadPlannerSettings` | `planner_v3_project_settings` 조회 |
| `savePlannerSettings` | `planner_v3_project_settings` 저장 |
| `startPlannerBackgroundGeneration` | `/api/planner/v3/generate/start` 호출 |
| `refreshPlannerBackgroundStatus` | `/api/planner/v3/generate/status` 호출 |
| `pausePlannerBackgroundGeneration` | `/api/planner/v3/generate/pause` 호출 |
| `resumePlannerBackgroundGeneration` | `/api/planner/v3/generate/resume` 호출 |
| `cancelPlannerBackgroundGeneration` | `/api/planner/v3/generate/cancel` 호출 |
| `selectPlannerImage` | DB 저장 없이 UI 임시 선택만 처리 |
| `confirmPlannerSelection` | 선택된 `asset_id`와 `idempotency_key`를 `/api/planner/v3/confirm`에 전달 |

금지 사항:

- `planner_meta`를 `json_documents`에 저장하지 않는다.
- `planner_settings`를 `json_documents`에 저장하지 않는다.
- `_planner_meta.json` R2 key를 읽지 않는다.
- `v2_planner_sources` alias를 사용하지 않는다.
- legacy object key로 run을 찾지 않는다.

## 12. Cleanup Plan For Existing Planner Data

기존 플래너 데이터는 삭제 가능하다는 전제다. 단, 플래너와 무관한 데이터는 삭제하지 않는다.

삭제 대상:

```sql
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
```

주의:

- `file_metadata`는 삭제하지 않는다.
- `aliases`는 삭제하지 않는다.
- `v2_projects`, `v2_characters`, `v2_situations`는 삭제하지 않는다.
- `v2_assets` 중 `owner_type <> 'planner_item'`인 row는 삭제하지 않는다.
- R2의 최종 캐릭터 이미지와 그 메타데이터는 삭제하지 않는다.

R2 삭제 대상:

```text
*_planner_temp_image/**
planner legacy temporary images
legacy *_planner_meta.json
legacy *_planner_settings.json
```

R2 삭제는 DB migration과 분리한다. 먼저 DB를 정리하고, R2는 별도 cleanup API 또는 관리 스크립트로 삭제한다.

## 13. Migration Strategy

기존 플래너 데이터를 보존하지 않는 전제이므로 data migration은 하지 않는다.

단계:

1. `planner_v3_*` 테이블 생성 migration 추가
2. v3 API 구현
3. 프론트 planner 함수가 v3 API만 호출하도록 변경
4. 백그라운드 워커가 `planner_v3_jobs/tasks/queue`만 사용하도록 변경
5. 브라우저 생성 완료 이벤트가 `planner_v3_assets`에 결과를 기록하도록 변경
6. legacy planner API 호출 제거
7. legacy planner cleanup migration 또는 admin cleanup endpoint 실행
8. R2 legacy planner temp cleanup 실행
9. `node --check` 수준의 syntax/static check 수행
10. Cloudflare 배포 후 실제 동작 검증

## 14. Implementation Boundaries

수정 가능:

- `functions/[[path]].js`
- `src/planner-background.js`
- `public/js/project/planner.js`
- 신규 migration
- 신규 planner v3 helper module
- 관련 docs

수정 금지 또는 주의:

- 플래너와 무관한 DB 테이블 구조 변경 금지
- 기존 최종 이미지 저장 구조 임의 변경 금지
- `file_metadata` 전체 삭제 금지
- 프로젝트/캐릭터/상황 데이터 삭제 금지
- R2 전체 prefix 삭제 금지

## 15. Verification Checklist

로컬에서는 단순 syntax/static check만 수행한다. 실제 동작 검증은 Cloudflare 배포 후 진행한다.

필수 확인:

1. 새 프로젝트에서 플래너 설정 저장/조회
2. 캐릭터별 플래너 초안 생성
3. 새로고침 후 동일 run 복원
4. 개별 item 수정
5. 전체 백그라운드 생성 시작
6. 단일 상황 백그라운드 생성 시작
7. active job 중복 생성 방지
8. 진행률 조회
9. pause
10. resume
11. cancel
12. 생성 성공 후 후보 이미지 목록 표시
13. 후보 이미지 선택
14. 일부 item 확정 후 해당 item row와 관련 job/task/queue/assets row 삭제
15. 나머지 item은 유지
16. 모든 item 확정 후 run row 삭제
17. browser mode 생성 결과도 v3 DB에 기록
18. R2 planner JSON이 없어도 플래너가 정상 동작
19. legacy planner table을 비워도 플래너가 정상 동작
20. non-planner 프로젝트/캐릭터/상황/파일 메타데이터가 유지됨
21. 완료된 생성 job/task/queue가 확정 이후 누적되지 않음
22. 중복 queue delivery가 발생해도 `UNIQUE(queue_id)`와 `claim_token` 검증으로 asset/count가 중복 생성되지 않음
23. stale worker가 R2에 올린 임시 파일이 cleanup queue에 들어감
24. 같은 `idempotency_key` confirm 재요청이 같은 operation 결과를 반환함
25. 다른 `idempotency_key`로 같은 item을 동시에 confirm하려 하면 conflict 처리됨
26. cleanup worker가 lease 만료 row를 재claim하고 재시도함
27. `expires_at`이 지난 terminal confirm operation이 삭제되어 누적되지 않음

## 16. Open Decisions

아래 항목은 구현 전에 확정이 필요하다.

1. 취소 시 이미 생성된 후보 이미지를 기본 유지할지, 기본 삭제할지
2. item 확정 전 완료 queue row를 얼마나 자세히 보존할지
3. `planner_v3_events`를 확정 후에도 남길지, run 삭제와 함께 지울지
4. 브라우저 생성 모드에서 queue claim timeout을 몇 초로 둘지
5. planner v3 R2 임시 이미지 prefix의 최종 형식
6. legacy R2 `_planner_temp_image` 삭제를 자동화할지 수동 관리로 둘지
7. terminal `planner_v3_confirm_operations` retention 기간을 몇 시간/일로 둘지
8. cleanup worker lease timeout과 최대 재시도 횟수를 얼마로 둘지

## 17. Example Scenario

예시 값:

- project: `proj_001`, prefix `comic01`
- character: `char_a`, prefix `alice`
- situation: `sit_001`, image number `1`
- run: `prun_001`
- item: `pitem_001`
- job: `pjob_001`
- task: `ptask_001`
- first queue: `pqueue_001`
- first asset: `passet_001`
- confirm operation: `pcfm_001`
- idempotency key: `confirm:pitem_001:passet_001`

흐름:

1. 사용자가 상황 `sit_001`의 플랜을 만든다.
2. `planner_v3_runs`에 `prun_001`이 `draft`로 생성된다.
3. `planner_v3_items`에 `pitem_001`이 `pending`, `target_count = 20`으로 생성된다.
4. `planner_v3_item_variants`에 기본 variant `pvar_001`이 생성되고, `planner_v3_generation_settings`, `planner_v3_prompt_parts`, `planner_v3_v4_rows`에 생성 당시 snapshot이 저장된다.
5. 사용자가 백그라운드 생성을 누른다.
6. `planner_v3_jobs`에 `pjob_001`이 `queued`, `total_count = 20`으로 생성된다.
7. `planner_v3_job_tasks`에 `ptask_001`이 생성된다.
8. `planner_v3_queue`에 `variant_id = 'pvar_001'`, `image_index = 0..19`, `variant_image_index = 0..19` row가 생성된다.
9. 첫 queue row `pqueue_001`이 `claim_token = 'claim_001'`, `lease_expires_at = ?`와 함께 `running`으로 claim된다.
10. NovelAI 호출 전 `planner_v3_rate_limits`의 `novelai` row가 갱신된다.
11. R2 저장 직전 `pqueue_001`의 `claim_token`과 lease가 다시 유효한지 확인한다.
12. 생성된 WebP가 R2 `planner-v3/proj_001/prun_001/pitem_001/passet_001.webp`에 저장된다.
13. DB transaction에서 같은 `queue_id` asset이 없고 `claim_token = 'claim_001'`이 유효한 것을 확인한다.
14. `planner_v3_assets`에 `passet_001`이 `candidate`로 생성되고, `planner_v3_asset_metadata`에 prompt, seed, width, height가 저장된다.
15. `pqueue_001`이 `completed`가 되고 `planner_v3_items.completed_count`와 `planner_v3_jobs.completed_count`가 1 증가한다.
16. 같은 queue가 중복 전달되어 늦게 완료되면 `UNIQUE(queue_id)`와 `claim_token` 검증으로 count는 증가하지 않는다. 늦은 worker가 이미 R2에 파일을 올렸다면 해당 key는 `planner_v3_asset_cleanup_queue`에 `stale_queue_upload`로 들어간다.
17. 20장이 모두 완료되면 item은 `complete`, job은 `completed`, run은 `complete`가 된다.
18. 사용자가 `passet_001`을 고르고 곧바로 확정한다.
19. 확정 API가 `item_id = 'pitem_001'`, `asset_id = 'passet_001'`, `idempotency_key = 'confirm:pitem_001:passet_001'`를 받는다.
20. `planner_v3_confirm_operations`에 `pcfm_001`이 생성되고, 선택 asset의 `r2_key`가 `selected_asset_r2_key`로 snapshot된다.
21. 이미지가 최종 캐릭터 위치 `alice/1.webp`로 복사되고 `file_metadata`가 저장된다.
22. `pitem_001`에 속한 후보 이미지 R2 key들이 `planner_v3_asset_cleanup_queue`에 들어간다.
23. `pitem_001`과 관련된 variant, prompt, v4 row, settings, task, queue, asset, metadata row가 FK cascade로 삭제된다.
24. `pcfm_001`은 `completed`와 `expires_at`을 가진 terminal ledger로 남아 같은 idempotency key 재요청에 완료 결과를 반환할 수 있다.
25. run에 item이 더 남아 있으면 run은 유지된다.
26. run에 item이 더 없으면 `prun_001`도 삭제되고, 연결된 job/task/queue row도 남지 않는다.
27. cleanup worker가 lease 방식으로 cleanup row를 처리해 후보 R2 key를 삭제한다.
28. 새로고침해도 legacy planner JSON이나 v2 planner row를 읽지 않으므로 삭제된 과거 플랜이 되살아나지 않는다.
