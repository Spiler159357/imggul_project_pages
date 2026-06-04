# DB Rebuild Migration Plan

## Goal

현재 구조는 R2 object key, `json_documents`, planner background table, 브라우저 상태가 느슨하게 연결되어 있어 동기화 문제가 반복된다.

새 구조에서는 D1을 상태와 관계의 원본으로 고정하고, R2는 이미지 binary 저장소로만 사용한다.

핵심 원칙:

- D1: 상태, 관계, prompt, metadata, queue, selection의 원본
- R2: 이미지와 대용량 blob 저장소
- R2 JSON fallback 제거
- `json_documents.data_json`에 planner 상태 저장 금지
- 모든 주요 삭제는 FK/CASCADE 또는 명시 cleanup으로 처리
- 브라우저는 D1 API만 신뢰

## Current Problems

1. `planner_meta`가 `json_documents.data_json` 또는 R2 JSON fallback에서 복원되어 삭제된 플랜이 다시 살아난다.
2. `planner_background_jobs/items/queue`와 planner meta의 key 연결이 약하다.
3. PC/모바일 재접속 시 브라우저가 stale meta를 표시할 수 있다.
4. R2 object key가 사실상 식별자처럼 쓰이고 있어 DB 관계가 명확하지 않다.
5. metadata가 R2 JSON, D1 JSON, 브라우저 상태에 분산되어 있다.

## Storage Responsibility

```text
D1
- projects
- characters
- situations
- prompts
- planner runs/items
- generation jobs/queue
- assets metadata
- selection/confirmation state

R2
- image binary
- zip/raw response
- long logs
- optional archive snapshot
```

R2에 저장되는 JSON은 현재 상태가 아니라 archive/debug 용도로만 사용한다.

## Core Tables

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE (project_id, prefix)
);

CREATE TABLE situations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  image_number TEXT NOT NULL,
  rating TEXT NOT NULL DEFAULT 'sfw',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
```

## Prompt Schema

Prompt는 DB로 정규화한다. `prompt_sets`는 프롬프트 묶음, `prompt_parts`는 묶음 안의 영역별 값이다.

```sql
CREATE TABLE prompt_sets (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  compiled_prompt_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE prompt_parts (
  id TEXT PRIMARY KEY,
  prompt_set_id TEXT NOT NULL,
  part_key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (prompt_set_id) REFERENCES prompt_sets(id) ON DELETE CASCADE,
  UNIQUE (prompt_set_id, part_key)
);

CREATE TABLE prompt_v4_rows (
  id TEXT PRIMARY KEY,
  prompt_set_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  clothing TEXT NOT NULL DEFAULT '',
  expression TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  negative TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (prompt_set_id) REFERENCES prompt_sets(id) ON DELETE CASCADE
);
```

`owner_type` 예시:

```text
project
character
situation
planner_item
asset
```

planner item 생성 시점에는 원본 prompt를 직접 참조하지 않고 `owner_type='planner_item'`, `kind='snapshot'`으로 prompt snapshot을 만든다.

## Asset Schema

이미지는 R2에 저장하고, 이미지의 의미와 metadata는 D1에서 관리한다.

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER,
  width INTEGER,
  height INTEGER,
  kind TEXT NOT NULL DEFAULT 'image',
  status TEXT NOT NULL DEFAULT 'active',
  is_public INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE asset_metadata (
  asset_id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  model TEXT,
  sampler TEXT,
  steps INTEGER,
  scale TEXT,
  seed TEXT,
  width INTEGER,
  height INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
```

R2 경로는 DB id 중심으로 둔다.

```text
projects/{project_id}/assets/{asset_id}.webp
```

R2 key는 의미의 원본이 아니라 `assets.r2_key`의 값일 뿐이다.

## Planner Schema

Planner는 “계획”이고 generation은 “실행”이다. 두 개념을 분리한다.

```sql
CREATE TABLE planner_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  mode TEXT NOT NULL DEFAULT 'background',
  default_count INTEGER NOT NULL DEFAULT 20,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  confirmed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE planner_items (
  id TEXT PRIMARY KEY,
  planner_run_id TEXT NOT NULL,
  situation_id TEXT NOT NULL,
  image_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  target_count INTEGER NOT NULL DEFAULT 20,
  selected_generated_image_id TEXT,
  confirmed_asset_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (planner_run_id) REFERENCES planner_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (situation_id) REFERENCES situations(id) ON DELETE CASCADE
);

CREATE TABLE planner_generated_images (
  id TEXT PRIMARY KEY,
  planner_item_id TEXT NOT NULL,
  asset_id TEXT NOT NULL UNIQUE,
  image_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL,
  FOREIGN KEY (planner_item_id) REFERENCES planner_items(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
```

Status 정책:

```text
planner_runs.status:
draft, running, paused, completed, confirmed, failed

planner_items.status:
pending, running, paused, done, confirmed, failed

planner_generated_images.status:
candidate, selected, confirmed, rejected
```

`cancelled`는 사용하지 않는다. 취소는 queue 삭제 후 상태를 `pending/queued`로 되돌린다.

## Generation Schema

```sql
CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY,
  planner_run_id TEXT,
  project_id TEXT NOT NULL,
  character_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  mode TEXT NOT NULL DEFAULT 'background',
  total_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (planner_run_id) REFERENCES planner_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL
);

CREATE TABLE generation_job_items (
  id TEXT PRIMARY KEY,
  generation_job_id TEXT NOT NULL,
  planner_item_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  target_count INTEGER NOT NULL DEFAULT 1,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (generation_job_id) REFERENCES generation_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (planner_item_id) REFERENCES planner_items(id) ON DELETE SET NULL
);

CREATE TABLE generation_queue (
  id TEXT PRIMARY KEY,
  generation_job_item_id TEXT NOT NULL,
  image_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (generation_job_item_id) REFERENCES generation_job_items(id) ON DELETE CASCADE
);
```

Generation status:

```text
generation_jobs.status:
queued, running, paused, completed, partial_failed, failed

generation_queue.status:
queued, running, paused, failed
```

## Delete Policy

DB 내부는 가능한 곳에 `ON DELETE CASCADE`를 사용한다.

```text
projects
 -> characters
 -> planner_runs
 -> planner_items
 -> planner_generated_images
 -> assets
 -> asset_metadata
```

R2 파일 삭제는 DB cascade로 처리할 수 없으므로 soft delete 후 cleanup worker가 처리한다.

```sql
UPDATE assets
SET status = 'deleted', deleted_at = ?
WHERE id = ?;
```

Cleanup worker:

```sql
SELECT id, r2_key
FROM assets
WHERE status = 'deleted'
  AND deleted_at < ?
LIMIT 100;
```

R2 삭제 성공 후:

```sql
DELETE FROM assets WHERE id = ?;
```

## Query Policy

플래너 화면 진입:

```sql
SELECT *
FROM planner_runs
WHERE project_id = ?
  AND character_id = ?
  AND status IN ('draft', 'running', 'paused', 'completed')
ORDER BY updated_at DESC
LIMIT 1;
```

플래너 상세:

```sql
SELECT *
FROM planner_items
WHERE planner_run_id = ?
ORDER BY sort_order;
```

생성 상태:

```sql
SELECT *
FROM generation_jobs
WHERE planner_run_id = ?
  AND status IN ('queued', 'running', 'paused')
ORDER BY updated_at DESC
LIMIT 1;
```

이미지 목록:

```sql
SELECT a.*, pgi.status AS planner_image_status
FROM planner_generated_images pgi
JOIN assets a ON a.id = pgi.asset_id
WHERE pgi.planner_item_id = ?
ORDER BY pgi.image_index;
```

## R2 Fallback Policy

새 구조에서는 브라우저 조회 시 R2 planner JSON fallback을 사용하지 않는다.

허용되는 R2 JSON:

```text
archive
debug log
generation raw response
export/import backup
```

금지되는 R2 JSON:

```text
현재 planner 상태
현재 generation queue 상태
현재 selected image 상태
```

## Migration Phases

1. 새 `v2_*` 테이블 생성
2. 기존 데이터 inventory 작성
   - `json_documents`
   - `planner_background_*`
   - `file_metadata`
   - R2 image keys
3. 기존 project/character/situation 정보를 `projects/characters/situations`로 이관
4. prompts 이관
   - project style prompt
   - character prompt variants
   - situation prompt variants
   - planner snapshot prompt
5. assets 이관
   - R2 image key를 스캔
   - `assets` row 생성
   - 기존 `_meta.json` 또는 `file_metadata`를 `asset_metadata`로 이관
6. planner 이관
   - `planner_meta` JSON을 `planner_runs/planner_items/planner_generated_images`로 변환
   - stale R2 planner JSON은 이관 후 삭제
7. background job 이관
   - `planner_background_jobs/items/queue`를 `generation_jobs/job_items/queue`로 변환
8. API 전환
   - `/api/planner/meta` 제거 또는 v2 API로 대체
   - `/api/db/json-document?type=planner_meta` 완전 차단
9. 브라우저 코드 전환
   - planner 화면은 v2 planner API만 조회
   - R2 JSON fallback 제거
10. legacy cleanup
   - `json_documents WHERE doc_type='planner_meta'` 삭제
   - R2 `*_planner_meta.json` 삭제
   - legacy planner background table 제거 또는 read-only archive화

## Existing Function Compatibility Requirements

DB 구조를 재구성하더라도 기존 사용자 기능은 동일하게 동작해야 한다. 마이그레이션은 단순한 테이블 교체가 아니라 기존 함수들이 바라보던 데이터 원본과 반환 형태를 새 schema에 맞게 재연결하는 작업이다.

특히 다음 기능은 기존 동작을 보장해야 한다.

- 프로젝트 목록 조회, 생성, 이름/alias 관리
- 캐릭터 목록 조회, 이미지 목록 조회, metadata 조회
- 상황 목록 조회, SFW/NSFW 구분, image number 매핑
- project/character/situation prompt 편집과 저장
- 플래너 초안 생성, 개별 플랜 편집, 일괄 플랜 생성
- 브라우저 생성 모드
- 백그라운드 생성 모드
- pause/resume/cancel
- 생성 진행률 표시
- 결과 이미지 선택
- 최종 선택 확정
- 확정 후 임시 이미지와 planner item 정리
- PC/모바일 간 새로고침 및 재접속 동기화
- R2 이미지 업로드, 삭제, 공개 여부 변경
- file metadata 조회/수정/삭제

새 DB 구조로 바꾸는 동안 기존 함수 이름을 바로 제거하지 않는다. 우선 adapter layer를 두고, 기존 함수가 새 API와 새 테이블을 사용하도록 내부 구현만 교체한다.

예시:

```text
loadPlannerMeta()
  기존: json_documents/R2 planner_meta 조회
  변경: planner_runs/planner_items/generated_images 조회 후 기존 meta shape로 조립

savePlannerMeta()
  기존: planner_meta JSON 저장
  변경: planner_runs/planner_items/prompt snapshot/assets 관계 저장

deletePlannerMeta()
  기존: planner_meta JSON 삭제
  변경: planner_run 또는 planner_items 삭제 + generated image cleanup 예약
```

프론트 함수의 반환 데이터 형태도 즉시 깨지지 않게 한다. 화면 코드가 큰 폭으로 동시에 바뀌면 회귀 위험이 커지므로, 1차 전환에서는 새 DB를 읽더라도 기존 UI가 기대하는 object shape를 유지한다.

```text
기존 UI가 기대하는 meta shape:
- meta.status
- meta.characterId
- meta.characterPrefix
- meta.defaultCount
- meta.items[]
- item.situationId
- item.imageNumber
- item.count
- item.status
- item.generation
- item.images[]
- item.selectedImage
```

이 shape는 adapter에서 조립하고, 내부 저장소만 새 normalized schema를 사용한다. UI 리팩터링은 DB 안정화 이후 별도 단계로 진행한다.

## Regression-Sensitive Areas

다음 영역은 DB 구조 변경 시 특히 회귀가 발생하기 쉽다.

1. **Planner 삭제/확정**
   - 모든 item 확정 후 planner가 브라우저에서 다시 나타나면 안 된다.
   - D1 삭제 후 R2 fallback 또는 legacy `json_documents`에서 복원되면 안 된다.
   - 확정된 최종 이미지는 `assets`와 character 소유 관계로 정상 이전되어야 한다.

2. **Background generation 동기화**
   - 실행 중인 job이 있으면 브라우저 새로고침 시 반드시 동일 job과 item이 표시되어야 한다.
   - active job이 있으면 새 생성 시작 요청은 새 플랜처럼 표시되지 않아야 한다.
   - queue, job, planner item status가 서로 다른 상태를 보여주면 안 된다.

3. **Browser generation 분리**
   - 브라우저 생성 모드는 background queue table을 오염시키지 않아야 한다.
   - 브라우저 런타임 상태는 persisted planner status와 구분되어야 한다.

4. **Prompt snapshot**
   - 원본 prompt 수정이 이미 생성 중이거나 완료된 planner item의 prompt snapshot을 바꾸면 안 된다.
   - 생성 이미지 metadata는 생성 당시 prompt를 기준으로 저장되어야 한다.

5. **Asset cleanup**
   - DB row 삭제와 R2 file 삭제는 transaction으로 묶을 수 없으므로 soft delete + cleanup worker를 사용한다.
   - R2 삭제 실패가 planner 상태를 되살리거나 DB 관계를 깨면 안 된다.

## Required Compatibility Tests

마이그레이션 구현 시 최소한 다음 흐름은 직접 검증해야 한다.

```text
1. 기존 프로젝트 진입
2. 기존 캐릭터/상황 목록 표시
3. 기존 prompt 불러오기
4. 플래너 초안 생성
5. 플래너 저장 후 새로고침
6. 백그라운드 생성 시작
7. PC 브라우저 종료 후 모바일 접속
8. 동일 generation job 표시
9. 생성 완료 후 이미지 선택
10. 최종 선택 확정
11. 확정된 item이 planner에서 사라짐
12. 모든 item 확정 후 planner run이 confirmed 또는 제거 상태가 됨
13. 새로고침 후 삭제된 planner가 다시 나타나지 않음
14. R2 이미지와 D1 asset metadata 연결 확인
15. cleanup worker가 deleted asset을 안전하게 정리
```

이 테스트를 통과하기 전까지 legacy fallback 제거 또는 기존 테이블 삭제를 진행하지 않는다.

## Verification Checklist

- PC에서 생성 시작 후 모바일 새로고침 시 동일 planner run 표시
- background queue가 존재하면 새 플랜 생성 불가
- 생성 완료 후 선택/확정 시 planner item 삭제 또는 confirmed 처리 일관성 유지
- 모든 플랜 확정 후 planner run이 `confirmed`가 됨
- 삭제 후 R2 fallback으로 플랜이 되살아나지 않음
- `cancelled` status가 새 DB에 존재하지 않음
- R2 이미지 삭제 실패 시 DB 상태가 깨지지 않음
- cleanup worker가 deleted asset을 안전하게 제거함

## Priority

1. D1을 상태 원본으로 고정
2. R2 planner JSON fallback 제거
3. planner/generation 분리
4. assets/metadata D1화
5. prompt 정규화
6. FK/CASCADE 적용
7. cleanup worker 추가

이 계획의 핵심은 “이미지는 R2, 이미지의 의미와 상태는 D1”이다. R2 key는 식별자가 아니라 `assets.r2_key`의 값일 뿐이고, 모든 관계와 상태는 D1의 id/FK를 기준으로 관리한다.
