# 플래너 관련 기존 DB 구조 분석

> 보관 문서: 이 문서는 compact 전환 전 구조를 분석한 기록이다. 현재 런타임은
> `planner_compact_records`와 `/api/planner/compact/*`를 사용하며, 구형
> `planner_v3_*` 실행 코드는 2026-07-21에 제거되었다.

작성일: 2026-07-06

## 1. 조사 범위

다음 파일을 기준으로 현재 프로젝트에서 플래너 기능과 연결된 DB 구조와 코드 흐름을 확인했다.

- `migrations/0001_planner_background.sql` ~ `migrations/0017_planner_v3_queue_recovery.sql`
- `src/planner-background.js`
- `functions/[[path]].js`
- `public/js/project/planner.js`
- `public/js/project/shared.js`
- `docs/planner-v3-db-design.md`

## 2. 플래너 DB 구조의 변천

현재 코드에는 플래너 저장 방식이 세대별로 남아 있다.

| 세대 | 주요 저장소 | 현재 상태 |
| --- | --- | --- |
| R2 JSON/문서 DB | R2 `_planner_meta.json`, `_planner_settings.json`, `json_documents` | v3 API에서 사용하지 않음. legacy API는 410 반환 |
| legacy planner tables | `planner_metas`, `planner_items`, `planner_item_v4_rows`, `planner_item_images`, `planner_item_image_snapshots` | `0015_cleanup_legacy_planner_data.sql`에서 삭제 대상으로 분류 |
| legacy background | `planner_background_jobs`, `planner_background_items`, `planner_background_queue`, `planner_background_rate_limits` | v3로 대체. legacy background queue는 비활성화 |
| v2 planner | `v2_planner_runs`, `v2_planner_items`, `v2_planner_generated_images`, `v2_planner_sources` | v3 이전 어댑터 구조. cleanup 대상 |
| v2 generation | `v2_generation_jobs`, `v2_generation_job_items`, `v2_generation_queue` | planner 관련 row는 cleanup 대상 |
| planner v3 | `planner_v3_*` | 현재 플래너 API와 background worker의 주 사용 구조 |

## 3. 현재 v3 스키마

현재 코드가 요구하는 최소 v3 스키마 조건은 `ensurePlannerV3Schema()`에서 확인된다.

- `planner_v3_runs`가 있어야 한다.
- `planner_v3_generation_snapshots`가 있어야 한다.
- `planner_v3_queue.stage` 컬럼이 있어야 한다.

즉, 의도된 현재 상태는 `0014_planner_v3_schema.sql`, `0016_planner_v3_simplify_generation_snapshots.sql`, `0017_planner_v3_queue_recovery.sql`이 반영된 상태다.

### 3.1 현재 사용 테이블

| 테이블 | 역할 | 주요 write 시점 |
| --- | --- | --- |
| `planner_v3_project_settings` | 프로젝트별 기본 생성 설정 | 설정 저장 |
| `planner_v3_runs` | 프로젝트+캐릭터 단위 플래너 상위 상태 | 플랜 저장, 생성 시작/종료, pause/resume/cancel |
| `planner_v3_items` | 상황별 플랜 | 플랜 저장, 생성 상태/카운터 변경, 확정 시 삭제 |
| `planner_v3_item_variants` | item별 캐릭터/상황 prompt variant 조합 | 플랜 저장 시 재생성 |
| `planner_v3_generation_snapshots` | item/variant별 생성 프롬프트와 설정 JSON snapshot | 플랜 저장 시 재생성 |
| `planner_v3_jobs` | 생성 실행 단위 | 생성 시작, 진행률, 종료 |
| `planner_v3_job_tasks` | item별 생성 task | 생성 시작, 진행률, 종료 |
| `planner_v3_queue` | 이미지 1장 단위 queue | 생성 시작 시 이미지 수만큼 insert, claim/complete/stage 갱신 |
| `planner_v3_assets` | 후보 이미지 R2 key | 이미지 생성 완료 시 insert, 확정/삭제 시 삭제 |
| `planner_v3_asset_cleanup_queue` | 후보 이미지 cleanup outbox | 현재 확정 정상 경로에서는 거의 사용되지 않고 직접 R2 삭제가 수행됨 |
| `planner_v3_confirm_operations` | 확정 처리 idempotency ledger | 확정 시작/단계/완료 상태 갱신 |
| `planner_v3_rate_limits` | NovelAI 호출 가능 시점 | rate limit/cooldown 갱신 |
| `planner_v3_events` | queue claim/stage/complete/fail 이벤트 로그 | background worker 진행 중 insert |

### 3.2 `0014` 생성 후 `0016`에서 단순화된 영역

`0014_planner_v3_schema.sql`은 다음 정규화 테이블을 만들었다.

```sql
planner_v3_generation_settings
planner_v3_prompt_parts
planner_v3_v4_rows
planner_v3_asset_metadata
```

이후 `0016_planner_v3_simplify_generation_snapshots.sql`은 생성 설정, 분리 프롬프트, v4 rows를 `planner_v3_generation_snapshots` JSON snapshot으로 합치고 `planner_v3_assets`도 더 작은 구조로 재작성한다.

현재 `0015_cleanup_legacy_planner_data.sql`에는 다음 drop이 들어 있다.

```sql
DROP TABLE IF EXISTS planner_v3_asset_metadata;
DROP TABLE IF EXISTS planner_v3_prompt_parts;
DROP TABLE IF EXISTS planner_v3_v4_rows;
DROP TABLE IF EXISTS planner_v3_generation_settings;
```

주의할 점: 파일명 기준으로는 `0015`가 `0016`보다 먼저 오지만, `0015` 주석은 `0016`을 먼저 실행해야 한다고 적고 있다. 실제 D1 migration 적용 순서가 파일명 순서라면 `0016`의 `FROM planner_v3_generation_settings`가 실패할 수 있다. 새 스키마 작업 시 이 순서 문제를 함께 정리해야 한다.

## 4. 현재 API 연결 구조

`functions/[[path]].js`의 Pages catch-all 라우터가 v3 플래너 API를 직접 라우팅한다.

| Method | Path | backend 함수 |
| --- | --- | --- |
| `GET` | `/api/planner/v3/settings` | `getPlannerV3Settings` |
| `PUT` | `/api/planner/v3/settings` | `putPlannerV3Settings` |
| `GET` | `/api/planner/v3/run` | `getPlannerV3Run` |
| `POST` | `/api/planner/v3/run` | `putPlannerV3RunFromMeta` |
| `POST` | `/api/planner/v3/item` | `putPlannerV3ItemFromMeta` |
| `PUT/DELETE` | `/api/planner/v3/run/:id` | run 수정/삭제 |
| `PUT/DELETE` | `/api/planner/v3/item/:id` | item 수정/삭제 |
| `POST` | `/api/planner/v3/generate/start` | `startPlannerV3Generation` |
| `GET` | `/api/planner/v3/generate/status` | `getPlannerV3Status` |
| `GET` | `/api/planner/v3/generate/next-browser-queue` | `claimNextPlannerV3BrowserQueue` |
| `POST` | `/api/planner/v3/generate/complete-browser-queue` | `completePlannerV3BrowserQueue` |
| `POST` | `/api/planner/v3/generate/pause` | `pausePlannerV3Generation` |
| `POST` | `/api/planner/v3/generate/resume` | `resumePlannerV3Generation` |
| `POST` | `/api/planner/v3/generate/cancel` | `cancelPlannerV3Generation` |
| `POST` | `/api/planner/v3/confirm` | `confirmPlannerV3Asset` |
| `POST` | `/api/planner/v3/cleanup-assets` | `cleanupPlannerV3Assets` |

legacy `/api/planner/meta`와 `/api/planner/background/*`는 410으로 막혀 있다.

## 5. 현재 frontend 연결 구조

`public/js/project/planner.js`는 v3 API를 기본 저장소로 사용한다.

- `loadPlannerMeta()`는 `/api/planner/v3/run`을 호출한다.
- `savePlannerMeta()`는 `/api/planner/v3/run`에 전체 meta를 저장한다.
- `savePlannerItem()`은 `/api/planner/v3/item`으로 단일 item을 저장한다.
- `loadPlannerSettings()`와 `savePlannerSettings()`는 `/api/planner/v3/settings`를 사용한다.
- background 생성은 `/api/planner/v3/generate/start/status/pause/resume/cancel`을 사용한다.
- 후보 확정은 `/api/planner/v3/confirm`을 사용한다.

다만 browser 생성 모드는 아직 `savePlannerBrowserStoredMeta()`를 통해 플래너 meta를 반복 저장하고, 이미지 파일은 `getPlannerImagePrefix(project, imageNumber)` 형태의 R2 temp prefix를 사용하는 흐름이 섞여 있다.

## 6. 현재 write 증폭 지점

### 6.1 플랜 저장

`putPlannerV3RunFromMeta()`는 전체 run 저장 시 다음 작업을 수행한다.

```text
1. planner_v3_runs upsert
2. planner_v3_generation_snapshots delete by run_id
3. planner_v3_item_variants delete by run_id
4. 각 item upsert
5. 각 item의 variant insert
6. 각 item/variant의 generation snapshot insert
7. 사라진 item delete
```

이 구조는 플랜 일부를 바꾸더라도 item, variant, snapshot row를 다시 만드는 방향이다.

### 6.2 생성 시작

`startPlannerV3Generation()`은 다음 row를 만든다.

```text
1. planner_v3_jobs 1 row insert
2. planner_v3_runs 1 row update
3. item마다 planner_v3_job_tasks 1 row insert
4. item마다 planner_v3_items 1 row update
5. 생성 이미지 1장마다 planner_v3_queue 1 row insert
```

이미지 수가 20장이면 queue row만 20개가 추가된다.

### 6.3 background 이미지 1장 처리

background worker는 queue 1개를 claim하고, 생성 진행 단계마다 여러 테이블을 함께 갱신한다.

```text
claim:
  planner_v3_queue update
  planner_v3_jobs update
  planner_v3_job_tasks update
  planner_v3_items update
  planner_v3_runs update
  planner_v3_events insert

stage 변경:
  planner_v3_queue update
  planner_v3_jobs update
  planner_v3_job_tasks update
  planner_v3_items update
  planner_v3_runs update
  planner_v3_events insert

complete:
  planner_v3_assets insert
  planner_v3_queue update
  planner_v3_job_tasks update
  planner_v3_items update
  planner_v3_jobs update
  planner_v3_events insert
```

heartbeat도 `planner_v3_queue`를 반복 update한다. 따라서 실제 `rows_written`은 이미지 수뿐 아니라 stage/heartbeat 횟수에 크게 좌우된다.

### 6.4 확정

`confirmPlannerV3Asset()`은 다음 흐름을 갖는다.

```text
1. planner_v3_confirm_operations insert
2. planner_v3_confirm_operations status='copying' update
3. R2 후보 이미지를 최종 위치로 copy
4. file_metadata upsert
5. planner_v3_confirm_operations status='metadata_saved' update
6. 같은 item의 후보 R2 key 직접 삭제
7. planner_v3_confirm_operations status='cleanup_queued' update
8. planner_v3_queue delete by item
9. planner_v3_job_tasks delete by item
10. planner_v3_items delete by item
11. cascade로 variants/snapshots/assets 삭제
12. planner_v3_confirm_operations status='completed' update
13. 빈 job/run delete
```

정상 경로에서도 confirm operation row가 여러 번 update되고, queue/task/item/assets 관련 row가 삭제된다.

## 7. row 사용량 관점의 결론

현재 v3 구조는 기능 복원력과 상태 추적을 위해 정규화가 많이 되어 있다. 하지만 D1의 `rows_written`을 줄이는 관점에서는 다음 특징이 비용을 키운다.

- 이미지 1장마다 `planner_v3_queue` row가 생긴다.
- 진행률 카운터가 queue, task, item, job, run에 중복 저장된다.
- stage와 heartbeat가 여러 테이블을 반복 update한다.
- 이벤트 로그가 D1 row로 누적된다.
- 후보 이미지가 row 단위로 저장되고 확정 시 다시 삭제된다.
- prompt/settings/v4 snapshot이 item/variant 단위 row로 분리되어 있다.

따라서 새 구조는 테이블과 row를 줄이려면 정규화를 의도적으로 버리고, 프로젝트/캐릭터 단위의 compact JSON document row로 플래너 상태를 합치는 것이 가장 직접적이다.
