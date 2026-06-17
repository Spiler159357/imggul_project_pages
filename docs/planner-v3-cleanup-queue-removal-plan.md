# Planner V3 Cleanup Queue Removal Plan

## 목적

`planner_v3_asset_cleanup_queue`는 Planner V3 후보 이미지 삭제를 지연 처리하기 위해 만든 D1 outbox 테이블이다. 현재 코드에서는 확정 처리 중 후보 이미지를 이미 직접 R2에서 삭제하고 있어, 이 테이블은 설계 문서와 실제 구현 사이의 불일치 지점이 되었다.

이 문서는 cleanup queue를 왜 만들었는지, 현재 왜 문제가 되는지, 삭제하거나 대체할 때 어떤 순서로 전환해야 하는지 정리한다.

## 현재 역할

### 설계상 역할

초기 Planner V3 설계에서 cleanup queue는 다음 문제를 해결하기 위한 테이블이었다.

1. D1 row 삭제와 R2 object 삭제는 하나의 트랜잭션으로 묶을 수 없다.
2. item 확정 후 `planner_v3_items`, `planner_v3_queue`, `planner_v3_assets` row를 삭제하면 삭제해야 할 R2 후보 이미지 key도 함께 사라진다.
3. R2 삭제가 실패하더라도 확정 작업 자체는 완료되어야 한다.
4. 실패한 R2 삭제를 나중에 재시도하려면 삭제 대상 key를 D1에 따로 남겨야 한다.

따라서 원래 의도는 다음 순서였다.

1. 확정 대상 item의 후보 이미지 `r2_key` 목록을 `planner_v3_asset_cleanup_queue`에 저장한다.
2. planner 관련 row를 FK cascade 또는 명시 삭제로 제거한다.
3. 별도 cleanup worker/API가 queue row를 읽어 R2 object를 삭제한다.
4. 성공하면 queue row를 `done`, 실패하면 `failed`로 남긴 뒤 재시도한다.

### 실제 구현상 역할

현재 구현은 설계와 다르다.

- `src/planner-background.js`의 `confirmPlannerV3Asset`는 같은 item의 후보 asset을 조회한 뒤 `env.imgBucket.delete(candidate.r2_key)`를 즉시 호출한다.
- 그 다음 `planner_v3_confirm_operations`를 `cleanup_queued`로 표시하지만, 실제로 `planner_v3_asset_cleanup_queue`에 `INSERT`하지 않는다.
- `cleanupPlannerV3Assets`는 아직 존재하고 `/api/planner/v3/cleanup-assets`에서 호출할 수 있지만, 새 row가 들어오지 않으면 처리할 대상이 없다.
- background worker의 scheduled handler는 `planner_v3_asset_cleanup_queue`가 아니라 legacy `v2_assets`의 soft delete cleanup만 수행한다.

즉 현재 cleanup queue는 "필수 경로"가 아니라 "남아 있는 설계 잔재"에 가깝다.

## 문제가 되는 이유

1. **상태명이 오해를 만든다.** `confirm_operations.status = 'cleanup_queued'`는 cleanup queue에 작업이 들어간 것처럼 보이지만 실제 queue insert는 없다.
2. **운영자가 잘못된 복구 경로를 기대할 수 있다.** `/api/planner/v3/cleanup-assets`를 실행해도 queue row가 없으면 누락된 R2 object를 찾아 삭제하지 못한다.
3. **D1이 불필요한 상태 머신을 더 가진다.** `pending`, `running`, `done`, `failed`, lease 관련 컬럼이 있지만 현재 생산자가 없다.
4. **문제 원인 파악이 어려워진다.** 후보 이미지 삭제 실패가 발생해도 실패 기록은 cleanup queue가 아니라 확정 API 실패 또는 직접 삭제 루프 중 예외로만 나타난다.
5. **문서와 코드가 충돌한다.** `docs/planner-v3-db-design.md`는 cleanup queue를 핵심 삭제 경로로 설명하지만, 실제 코드는 동기 삭제 경로로 작동한다.

## 권장 방향

cleanup queue를 완전히 삭제하고, "확정 API 안에서 후보 이미지를 직접 삭제하되 삭제 실패 목록을 operation에 기록하는 방식"으로 대체한다.

이 프로젝트의 현재 구현은 이미 이 방향에 더 가깝다. 따라서 새 시스템을 만들기보다 남은 queue 테이블/API/상태명을 제거하고, 직접 삭제 실패를 관측 가능하게 만드는 것이 가장 작고 안전한 전환이다.

## 대체 설계

### 핵심 원칙

1. 최종 이미지 복사와 `file_metadata` 저장이 성공하기 전에는 planner row를 삭제하지 않는다.
2. 후보 이미지 R2 삭제는 확정 API에서 best-effort로 수행한다.
3. 후보 이미지 삭제 실패가 있어도 최종 이미지 확정은 성공할 수 있다.
4. 삭제 실패 key는 `planner_v3_confirm_operations`에 JSON snapshot으로 남긴다.
5. 별도 D1 cleanup queue는 두지 않는다.
6. 사후 정리는 "DB queue 처리"가 아니라 "R2 prefix와 현재 DB asset 참조 비교" 기반의 관리성 sweep으로 분리한다.

### 확정 처리 흐름

1. `planner_v3_confirm_operations`에 idempotency row를 만든다.
2. 선택된 candidate asset을 최종 R2 위치로 복사한다.
3. 최종 이미지 metadata를 저장한다.
4. 같은 item의 후보 asset 목록을 조회해 메모리에 snapshot한다.
5. 후보 asset의 R2 object를 순차 삭제한다.
6. 실패한 key가 있으면 operation의 `cleanup_failed_keys_json` 같은 컬럼에 기록한다.
7. planner row를 삭제한다.
8. operation을 `completed`로 종료한다.
9. 응답에 `cleanupFailedKeys`를 포함한다.

### 사후 정리 흐름

cleanup queue 대체용으로 상시 queue를 만들지 않는다. 대신 관리자 전용 수동 sweep API 또는 Cloudflare 운영 스크립트를 둔다.

1. 대상 prefix는 `planner-v3/`로 제한한다.
2. R2 object list를 가져온다.
3. `planner_v3_assets.r2_key`에 존재하는 key와 비교한다.
4. DB에 참조가 없고 보존 기간이 지난 object만 삭제한다.
5. dry-run 모드를 기본값으로 제공한다.

이 방식은 D1 table을 추가로 유지하지 않으면서도 실제 orphan R2 object를 찾을 수 있다.

## 스키마 변경 계획

### 1단계: 실패 기록 컬럼 추가

`planner_v3_confirm_operations`에 후보 이미지 삭제 결과를 남길 컬럼을 추가한다.

```sql
ALTER TABLE planner_v3_confirm_operations
ADD COLUMN cleanup_failed_keys_json TEXT NOT NULL DEFAULT '[]'
CHECK (json_valid(cleanup_failed_keys_json));

ALTER TABLE planner_v3_confirm_operations
ADD COLUMN cleanup_error_message TEXT NOT NULL DEFAULT '';
```

D1/SQLite 제약상 기존 테이블에 `CHECK` 포함 컬럼 추가가 제한되면 새 테이블 rebuild migration으로 처리한다.

### 2단계: 상태 단순화

`planner_v3_confirm_operations.status`에서 `cleanup_queued`를 제거한다.

권장 상태:

- `pending`
- `copying`
- `metadata_saved`
- `completed`
- `failed`

마이그레이션 시 기존 `cleanup_queued` row는 실제 cleanup queue row 유무를 확인한 뒤 다음 중 하나로 정리한다.

- 이미 최종 파일과 metadata가 있으면 `completed`
- 확정이 중간에 멈췄고 재개가 필요하면 `metadata_saved`
- 복구 불가능하면 `failed`

### 3단계: cleanup queue 제거

코드 배포가 끝나고 일정 기간 관측한 뒤 다음 migration에서 제거한다.

```sql
DROP TABLE IF EXISTS planner_v3_asset_cleanup_queue;
```

## 코드 변경 계획

### `src/planner-background.js`

1. `cleanupPlannerV3Assets` export를 제거한다.
2. `confirmPlannerV3Asset`에서 `cleanup_queued` 상태 갱신을 제거한다.
3. 후보 이미지 삭제 루프를 `try/catch`로 감싸 실패 key를 수집한다.
4. operation 완료 시 `cleanup_failed_keys_json`, `cleanup_error_message`를 함께 저장한다.
5. 응답의 `cleanupFailedKeys`를 실제 실패 목록으로 채운다.
6. 중복 완료/idempotency 재호출 시 기존 operation의 실패 목록을 그대로 반환한다.

### `functions/[[path]].js`

1. `cleanupPlannerV3Assets` import를 제거한다.
2. `/api/planner/v3/cleanup-assets` 라우트를 제거하거나 `410 Gone`으로 바꾼다.
3. 운영 편의를 위해 필요하면 새 dry-run sweep API를 별도 이름으로 만든다.

권장 새 API 이름:

```text
POST /api/planner/v3/sweep-orphan-assets
```

기본값은 `dryRun: true`로 두고, 실제 삭제는 명시적으로 `dryRun: false`가 들어온 경우에만 수행한다.

### `docs/planner-v3-db-design.md`

1. `planner_v3_asset_cleanup_queue` 설명을 제거한다.
2. Confirm Image 흐름에서 queue insert 단계를 직접 삭제 및 실패 기록 단계로 바꾼다.
3. 삭제 정책에서 "cleanup outbox" 표현을 제거한다.
4. 사후 orphan sweep 정책을 운영 절차로 분리한다.

## 마이그레이션 순서

1. 현재 DB에서 cleanup queue row 수와 상태를 확인한다.

```sql
SELECT status, COUNT(*) AS count
FROM planner_v3_asset_cleanup_queue
GROUP BY status;
```

2. `pending` 또는 `failed` row가 있으면 R2 삭제를 한 번 수행하거나, row의 `r2_key`를 별도 운영 로그로 백업한다.
3. `planner_v3_confirm_operations`에 실패 기록 컬럼을 추가한다.
4. 코드에서 cleanup queue 생산/소비 경로를 제거한다.
5. `cleanup_queued` 상태를 쓰지 않도록 배포한다.
6. 배포 후 확정 기능을 Cloudflare 환경에서 검증한다.
7. 일정 기간 신규 문제가 없으면 cleanup queue 테이블을 drop한다.
8. 문서를 실제 구현 기준으로 갱신한다.

## 리스크와 대응

| 리스크 | 대응 |
| --- | --- |
| R2 후보 이미지 삭제 실패 후 orphan object가 남음 | operation에 실패 key를 기록하고 관리자 sweep으로 정리 |
| 확정 API 중간 실패 시 중복 복사/metadata overwrite 발생 | 기존 `idempotency_key`와 operation 상태 기반으로 재진입 처리 유지 |
| planner row 삭제 후 삭제 대상 key를 잃음 | 삭제 전에 후보 asset 목록을 메모리와 operation row에 snapshot |
| sweep API가 정상 후보 이미지를 지움 | `planner-v3/` prefix, 보존 기간, DB 참조 비교, dry-run 기본값 적용 |
| 기존 `cleanup_queued` row가 남아 상태 해석이 어려움 | migration에서 `completed`/`metadata_saved`/`failed`로 명시 보정 |

## 삭제 전 점검 쿼리

```sql
-- cleanup queue 잔여 작업
SELECT status, COUNT(*) AS count
FROM planner_v3_asset_cleanup_queue
GROUP BY status;

-- cleanup_queued 상태로 멈춘 확정 작업
SELECT id, item_id, selected_asset_r2_key, target_r2_key, updated_at
FROM planner_v3_confirm_operations
WHERE status = 'cleanup_queued'
ORDER BY updated_at;

-- 참조가 남아 있는 후보 이미지 수
SELECT status, COUNT(*) AS count
FROM planner_v3_assets
GROUP BY status;
```

## 최종 결론

`planner_v3_asset_cleanup_queue`는 원래 R2 삭제 실패를 재시도하기 위한 outbox였지만, 현재 구현에서는 생산되지 않는 테이블이다. 지금 상태로 유지하면 운영자가 실제 동작을 오해하고, 문제 해결 경로도 불명확해진다.

따라서 이 테이블은 삭제하는 편이 낫다. 대체는 별도 queue가 아니라 확정 API 내부의 직접 삭제, operation row의 실패 key 기록, 관리자용 orphan sweep으로 구성한다. 이렇게 하면 D1 상태 머신을 줄이면서도 R2 orphan 정리 가능성은 유지할 수 있다.
