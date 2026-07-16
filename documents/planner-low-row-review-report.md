# 플래너 low-row 문서 전수점검 및 시나리오 보고서

작성일: 2026-07-06

## 1. 점검 대상

이번 작업에서 작성한 문서는 다음 4개다.

- `documents/planner-db-current-structure.md`
- `documents/cloudflare-d1-row-usage-criteria.md`
- `documents/planner-low-row-schema.md`
- `documents/planner-low-row-code-change-plan.md`

## 2. 요구사항 충족 여부

| 요구사항 | 점검 결과 |
| --- | --- |
| 플래너 기능과 엮인 기존 DB 구조 파악 | 충족. legacy, v2, v3 테이블과 현재 API/write 흐름을 정리함 |
| D1 row 사용량 측정 기준 확인 | 충족. 공식 Cloudflare 문서 기준으로 rows read/written, index 영향, 측정 방법을 정리함 |
| D1 row 사용량 최소화 신규 스키마 | 충족. `planner_compact_records` 1개 테이블로 설계함 |
| 기존 DB 내용 미사용 | 충족. 신규 스키마는 기존 planner row를 migration하지 않는 전제 |
| 테이블 수 최소화 | 충족. 신규 planner 전용 테이블 1개 |
| 정규화 최소화 | 충족. settings/run/confirm/rate를 JSON payload로 통합 |
| 랜덤 ID로 인한 row 누적 방지 | 충족. 신규 문서에 프로젝트/캐릭터/상황 reference 기반 deterministic ID 정책을 추가함 |
| 코드 수정 계획서에 기존/수정 부분 code block 포함 | 충족. migration, save, start, complete, status, confirm, frontend 변경을 code block으로 비교 |
| row 수정 작업 최소화 방안 포함 | 충족. 이미지별 queue/task/asset/event row를 제거하고 run row 1 update로 압축 |
| 시나리오 기반 write count 보고 | 충족. 아래 섹션에 작성 |

## 3. 신규 스키마의 row write 최소화 판단

신규 스키마는 다음 이유로 rows written을 줄일 수 있다.

- 플랜 저장 시 여러 item/variant/snapshot row를 만들지 않고 run record 1개만 쓴다.
- 생성 시작 시 job/task/queue row를 만들지 않고 run payload만 update한다.
- 이미지 생성 중 stage/heartbeat/event write를 하지 않는다.
- 이미지 완료 시 asset row insert 없이 run payload에 candidate를 append한다.
- 사용자 선택은 DB에 저장하지 않는다.
- 확정 시 후보 asset row, queue row, task row, item row를 삭제하지 않는다. run JSON에서 item만 제거한다.
- 보조 index를 만들지 않아 indexed column write로 인한 추가 rows written을 피한다.
- row key와 payload 내부 ID를 기존 reference에서 deterministic하게 만들기 때문에 같은 상황을 다시 저장해도 새 identity가 계속 늘어나지 않는다.

## 4. 시나리오

아래 시나리오는 플랜 생성, 이미지 생성, 최종 선택, 후처리까지 포함한다.

전제:

- 프로젝트: `proj_001`
- 캐릭터: `char_a`
- 상황: `sit_001`, `sit_002`
- run ID: `prun:proj_001:char_a`
- item ID: `pitem:proj_001:char_a:sit_001`, `pitem:proj_001:char_a:sit_002`
- 각 상황별 후보 이미지 목표 수: 2장
- 총 생성 후보 이미지: 4장
- NovelAI cooldown 갱신은 발생하지 않는 정상 경로
- 플래너 설정은 이미 저장되어 있음
- 최종 확정은 두 상황 모두 1장씩 수행
- R2 object put/copy/delete는 D1 row count에 포함하지 않음
- 최종 이미지 metadata 저장을 위한 기존 `file_metadata` write는 D1 write이므로 별도 포함
- D1의 실제 `rows_written`은 primary key/index 내부 반영 때문에 수동 base count와 다를 수 있으며, 최종 측정은 D1 `meta.rows_written` 기준

## 5. 신규 compact 구조 write count

### 5.1 플랜 생성

```text
작업: run:{projectId}:{characterId} record 생성
SQL: INSERT planner_compact_records
base write count: 1
```

### 5.2 이미지 생성 시작

```text
작업: run payload에 activeJob 생성
SQL: UPDATE planner_compact_records
base write count: 1
```

### 5.3 이미지 4장 생성

이미지 1장마다 R2 저장 후 run payload에 candidate를 append한다.

```text
이미지 1장:
  SQL: UPDATE planner_compact_records
  base write count: 1

이미지 4장:
  UPDATE 4회
  base write count: 4
```

### 5.4 사용자 후보 선택

```text
작업: UI state에서 assetId 선택
SQL: 없음
base write count: 0
```

### 5.5 첫 번째 상황 확정

```text
1. confirm:pitem_001 record 생성
   SQL: INSERT planner_compact_records
   base write count: 1

2. 최종 이미지 metadata 저장
   SQL: INSERT 또는 UPDATE file_metadata
   base write count: 1

3. confirm record 완료 처리
   SQL: UPDATE planner_compact_records
   base write count: 1

4. run payload에서 pitem_001 제거
   SQL: UPDATE planner_compact_records
   base write count: 1

합계: 4
```

### 5.6 두 번째 상황 확정

마지막 item이므로 run record는 update가 아니라 delete된다.

```text
1. confirm:pitem_002 record 생성
   SQL: INSERT planner_compact_records
   base write count: 1

2. 최종 이미지 metadata 저장
   SQL: INSERT 또는 UPDATE file_metadata
   base write count: 1

3. confirm record 완료 처리
   SQL: UPDATE planner_compact_records
   base write count: 1

4. run record 삭제
   SQL: DELETE planner_compact_records
   base write count: 1

합계: 4
```

### 5.7 compact 구조 총합

| 단계 | INSERT | UPDATE | DELETE | base write count |
| --- | ---: | ---: | ---: | ---: |
| 플랜 생성 | 1 | 0 | 0 | 1 |
| 생성 시작 | 0 | 1 | 0 | 1 |
| 후보 이미지 4장 완료 | 0 | 4 | 0 | 4 |
| 후보 선택 | 0 | 0 | 0 | 0 |
| 첫 번째 확정 | 2 | 2 | 0 | 4 |
| 두 번째 확정 | 2 | 1 | 1 | 4 |
| 합계 | 5 | 8 | 1 | 14 |

정상 경로에서 플래너 관련 전체 흐름의 base write count는 14다.

설정을 같은 시나리오에서 저장하면 `settings:{projectId}` upsert 1회가 추가되어 15가 된다. NovelAI cooldown이 실제로 발생하면 `rate:novelai` upsert 1회가 cooldown 이벤트마다 추가된다.

## 6. 기존 v3 구조와의 대략 비교

같은 시나리오에서 기존 v3 구조의 최소 write는 다음 이상이다. stage 변경, heartbeat, index 추가 write, FK cascade 내부 write는 제외한 낮은 추정치다.

### 6.1 플랜 생성

```text
planner_v3_runs: 1
planner_v3_items: 2
planner_v3_item_variants: 2
planner_v3_generation_snapshots: item 2 + variant 2 = 4
합계: 최소 9
```

### 6.2 생성 시작

```text
planner_v3_jobs insert: 1
planner_v3_runs update: 1
planner_v3_job_tasks insert: 2
planner_v3_items update: 2
planner_v3_queue insert: 4
합계: 최소 10
```

### 6.3 이미지 4장 처리

background 정상 처리에서 이미지 1장당 최소 claim과 complete만 세도 다음 write가 발생한다.

```text
claim:
  planner_v3_queue update
  planner_v3_jobs update
  planner_v3_job_tasks update
  planner_v3_items update
  planner_v3_runs update
  planner_v3_events insert
  => 최소 6

complete:
  planner_v3_assets insert
  planner_v3_queue update
  planner_v3_job_tasks update
  planner_v3_items update
  planner_v3_jobs update
  planner_v3_events insert
  => 최소 6

이미지 1장 최소: 12
이미지 4장 최소: 48
```

마지막 rollup에서 job/task/item/run terminal 상태 갱신도 추가된다.

```text
planner_v3_jobs update: 1
planner_v3_job_tasks update: 2
planner_v3_items update: 2
planner_v3_runs update: 1
합계: 최소 6
```

### 6.4 확정 2개

확정 정상 경로는 confirm operation 상태를 여러 번 바꾸고, queue/task/item/assets를 삭제한다.

낮게 잡아도 각 item 확정마다 다음 write가 발생한다.

```text
planner_v3_confirm_operations insert/update 여러 회
file_metadata upsert
planner_v3_queue delete
planner_v3_job_tasks delete
planner_v3_items delete
planner_v3_assets cascade delete
빈 planner_v3_jobs/planner_v3_runs delete
```

두 item 확정 기준으로 최소 20회 이상의 base write가 발생한다.

### 6.5 비교 결론

| 구조 | 동일 시나리오 base write count |
| --- | ---: |
| 기존 v3 낮은 추정치 | 90회 이상 |
| 신규 compact 정상 경로 | 14회 |

기존 v3의 실제 D1 `rows_written`은 stage 변경, heartbeat, 이벤트, FK cascade, index 갱신 때문에 위 추정치보다 더 커질 수 있다. 신규 compact 구조도 primary key 갱신 비용은 있을 수 있지만 보조 index가 없어 추가 write를 제한한다.

## 7. 리스크 점검

| 리스크 | 내용 | 대응 |
| --- | --- | --- |
| JSON row 크기 | run payload가 커지면 D1 2 MB row 제한에 접근 가능 | 이미지 binary 저장 금지, candidate metadata 최소화, 1.5 MB 이상이면 item별 record fallback |
| 동시성 | run row 하나를 통째로 update하므로 동시 편집 충돌 가능 | `revision` optimistic update 사용 |
| 상태 추적 감소 | stage/heartbeat/event row 제거로 상세 디버깅 감소 | 오류 로그는 R2 또는 Worker 로그 사용 |
| cleanup 보장 약화 | D1 cleanup queue를 기본 생성하지 않음 | 정상 경로 직접 삭제, 실패 key만 payload에 압축 기록 |
| read 편의성 감소 | SQL join/listing이 어려워짐 | deterministic key 조회와 frontend character 목록 기반 조회 |
| reference 변경 | ID가 projectId/characterId/situationId에 의존하므로 source reference가 바뀌면 다른 record처럼 보일 수 있음 | 표시명 변경과 안정 ID 변경을 분리하고, 기존 ID는 생성 후 유지 |
| migration 순서 | 기존 `0015`/`0016` 순서 주석 불일치 | 신규 migration 추가 전 실제 적용 이력 확인 필요 |

## 8. 최종 판정 

작성된 신규 스키마와 코드 수정 계획은 사용자가 제시한 기준에 부합한다.

- row 수정 작업을 줄이기 위해 기존 v3 구조를 재사용하지 않는다.
- 신규 schema는 테이블 1개로 최소화했다.
- 정규화는 거의 하지 않고 JSON payload로 통합했다.
- 랜덤 ID 대신 기존 reference 기반 deterministic ID를 사용해 같은 대상의 row/key가 반복 생성되지 않도록 했다.
- 이미지별 queue row와 asset row를 제거해 이미지 수에 비례하는 insert/delete를 없앴다.
- 정상 시나리오에서 base write count를 기존 v3의 90회 이상에서 14회 수준으로 줄일 수 있다.

다만 구현 전에는 `0015`/`0016` migration 적용 순서와 실제 D1 migration 이력을 반드시 확인해야 한다.
