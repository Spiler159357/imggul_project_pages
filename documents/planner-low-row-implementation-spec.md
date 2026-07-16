# 플래너 low-row 실제 구현 계획 및 상세 명세

작성일: 2026-07-16

## 1. 문서 목적

이 문서는 `planner-low-row-code-change-plan.md`를 실제 코드 작업으로 옮기기 위한 구현 명세다.

다음 목표를 동시에 만족해야 한다.

- 신규 플래너 저장소는 `planner_compact_records` 단일 테이블을 사용한다.
- 기존 `planner_v3_*` row는 읽거나 신규 구조로 이관하지 않는다.
- 프로젝트, 캐릭터, 상황, variant, 이미지 슬롯 reference에서 모든 영속 ID를 결정적으로 생성한다.
- 이미지 생성 1건당 D1 write는 정상 경로에서 run record `UPDATE` 1회로 제한한다.
- 생성 중 stage, heartbeat, event, queue, task, asset 전용 row를 만들지 않는다.
- 기존 `/api/planner/v3/*` URL은 유지하되 내부 구현을 compact 저장소로 교체한다.
- 로컬에서는 syntax/static check만 수행하고 실제 D1 사용량은 Cloudflare 배포 후 확인한다.

## 2. 관련 문서와 우선순위

구현 시 다음 문서를 함께 사용한다.

1. `documents/planner-low-row-implementation-spec.md`: 실제 구현 계약과 순서
2. `documents/planner-low-row-schema.md`: DB와 payload 설계
3. `documents/planner-low-row-code-change-plan.md`: 기존 코드와 신규 코드 비교
4. `documents/cloudflare-d1-row-usage-criteria.md`: D1 row 측정 기준
5. `documents/planner-low-row-review-report.md`: write count와 위험 점검

문서 간 충돌이 있으면 이 문서의 API 계약, 상태 전이, 단계별 완료 조건을 우선한다. D1의 제한, 과금, 반환 metadata는 구현 시점의 Cloudflare 공식 문서를 다시 확인한다.

## 3. 구현 범위

### 3.1 변경 파일

| 파일 | 작업 |
| --- | --- |
| `migrations/0018_planner_compact_records.sql` | compact 단일 테이블 생성 |
| `src/planner-compact.js` | ID, 저장소, 플랜, 생성, 확정 로직 구현 |
| `src/planner-background.js` | 이미지 생성 공통 함수 재사용, compact Queue consumer 연결 |
| `functions/[[path]].js` | v3 route를 compact 함수로 교체 |
| `public/js/project/planner.js` | `runKey`, compact status, browser completion 계약 반영 |
| `public/js/project/shared.js` | 공유 상태에 ID alias가 있으면 compact 필드 반영 |
| `wrangler.background.toml` | 필요한 경우 metrics 환경 변수 문서화. Queue 설정은 유지 |
| `wrangler.toml` | 필요한 경우 metrics 환경 변수 문서화. D1/R2/Queue binding은 유지 |

### 3.2 변경하지 않는 범위

- 프로젝트, 캐릭터, 상황 원본 데이터 구조
- NovelAI 요청 payload의 이미지 생성 품질 로직
- R2의 최종 이미지 폴더 구조
- 최종 이미지의 기존 `file_metadata` 저장 계약
- 관리자 인증 방식
- 기존 v3 데이터를 compact row로 변환하는 migration

### 3.3 제거 또는 사용 중단할 v3 경로

compact 전환 후 아래 테이블에는 신규 write를 수행하지 않는다.

```text
planner_v3_runs
planner_v3_items
planner_v3_item_variants
planner_v3_generation_snapshots
planner_v3_jobs
planner_v3_job_tasks
planner_v3_queue
planner_v3_assets
planner_v3_asset_metadata
planner_v3_asset_cleanup_queue
planner_v3_confirm_operations
planner_v3_events
planner_v3_rate_limits
```

초기 배포에서는 테이블을 바로 `DROP`하지 않는다. rollback 관찰 기간 이후 별도 migration으로 정리한다.

## 4. 핵심 아키텍처

```text
planner frontend
  -> Pages Function /api/planner/v3/*
    -> src/planner-compact.js
      -> D1 planner_compact_records 1개 테이블
      -> R2 후보/최종 이미지
      -> GENERATION_QUEUE
        -> src/planner-background.js queue consumer
          -> NovelAI
          -> R2 후보 이미지 저장
          -> run record 1회 optimistic update
```

저장 단위는 다음 네 종류뿐이다.

| record type | cardinality | key |
| --- | --- | --- |
| `settings` | 프로젝트당 최대 1 | `settings:{projectRef}` |
| `run` | 프로젝트+캐릭터당 최대 1 | `run:{projectRef}:{characterRef}` |
| `confirm` | item당 최대 1 | `confirm:{itemId}` |
| `rate` | 외부 서비스당 최대 1 | `rate:novelai` |

같은 reference 조합을 다시 저장할 때 새 row를 만들지 않고 같은 key를 갱신한다.

## 5. 필수 불변조건

구현 전체에서 아래 조건을 깨면 안 된다.

1. 영속 ID 생성에 `crypto.randomUUID()`, 시간값, 난수 suffix를 사용하지 않는다.
2. `record_key`와 payload의 `runId`, `itemId`, `variantId`, `jobId`, `assetId`, `operationId`는 안정적인 source reference로부터 생성한다.
3. run payload의 `projectId`, `characterId`는 row의 `project_id`, `character_id`와 일치한다.
4. 하나의 run에는 동시에 하나의 `activeJob`만 존재한다.
5. candidate는 `(itemId, variantId, imageIndex)` 조합당 최대 하나다.
6. candidate 배열은 append-only가 아니라 동일 `assetId`를 replace하는 방식으로 갱신한다.
7. `completedCount + failedCount`는 `totalCount`를 초과하지 않는다.
8. run update는 반드시 `record_key`와 기존 `revision`을 함께 조건으로 사용한다.
9. optimistic update 충돌 시 최신 payload를 다시 읽고 같은 작업이 이미 반영됐는지 먼저 확인한다.
10. 후보 선택만으로는 D1을 갱신하지 않는다.
11. Queue 메시지의 중복 전달은 candidate 중복이나 count 중복 증가를 만들지 않는다.
12. 기존 v3 테이블을 fallback read로 사용하지 않는다.

## 6. Phase 0: 구현 전 확인

### 6.1 작업

- 실제 원격 D1의 migration 적용 이력을 확인한다.
- `0015`와 `0016`의 파일 순서 및 실제 적용 순서가 일치하는지 확인한다.
- `0018` migration 번호가 아직 사용되지 않았는지 확인한다.
- Pages와 background Worker가 동일한 `DB`, `imgBucket`, `GENERATION_QUEUE`를 사용하는지 확인한다.
- 현재 v3 API response shape를 frontend 사용 지점과 대조한다.

### 6.2 완료 조건

- `0018`을 충돌 없이 추가할 수 있다.
- D1/R2/Queue binding 이름을 변경하지 않아도 된다.
- 기존 v3 데이터 미이관 방침이 배포 절차에 기록되어 있다.

## 7. Phase 1: migration 구현

### 7.1 파일

`migrations/0018_planner_compact_records.sql`

### 7.2 DDL

```sql
CREATE TABLE IF NOT EXISTS planner_compact_records (
    record_key TEXT PRIMARY KEY,
    record_type TEXT NOT NULL
        CHECK (record_type IN ('settings', 'run', 'confirm', 'rate')),
    project_id TEXT NOT NULL DEFAULT '',
    character_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT
);
```

### 7.3 제약

- 보조 index를 추가하지 않는다.
- trigger를 추가하지 않는다.
- 기존 테이블에 `ALTER`, `DELETE`, `DROP`을 수행하지 않는다.
- `record_type` 목록과 JS 상수 목록을 동일하게 유지한다.

### 7.4 정적 검증

```sql
SELECT name, sql
FROM sqlite_schema
WHERE type = 'table'
  AND name = 'planner_compact_records';
```

로컬 DB 실행은 필수가 아니다. SQL 문법과 기존 migration 번호 충돌을 검토한다.

### 7.5 완료 조건

- migration이 여러 번 평가되어도 안전한 `IF NOT EXISTS` 구조다.
- 신규 planner 전용 테이블은 정확히 1개다.
- 보조 index 생성문이 없다.

## 8. Phase 2: deterministic ID 모듈 구현

### 8.1 공개 함수

`src/planner-compact.js`에서 다음 함수를 구현한다.

```js
export function safePlannerRef(value, fallback = 'default');
export function stablePlannerRefHash(value);
export function makePlannerCompactIds(input);
export function makePlannerCompactKey(type, input);
export function makePlannerCompactAssetId(input);
```

### 8.2 입력 우선순위

| 대상 | reference 우선순위 |
| --- | --- |
| project | `projectId` -> `projectPrefix` |
| character | `characterId` -> `characterPrefix` |
| situation | `situationId` -> `imageNumber` -> `situationName` |
| character variant | `characterPromptVariantId` -> `default` |
| situation variant | `situationPromptVariantId` -> `default` |
| 이미지 슬롯 | `variantImageIndex` 또는 variant 내부의 0-based index |

안정적인 내부 ID가 존재하면 표시명보다 항상 우선한다. 표시명 변경이 ID 변경으로 이어지지 않게 하기 위함이다.

### 8.3 정규화 규칙

```text
1. String 변환 후 trim
2. [A-Za-z0-9_-]만 있으면 소문자화한 값을 그대로 사용
3. 그 외 값은 NFKC 정규화
4. 공백, /, \\, : 연속 구분자를 _로 변환
5. 문자, 숫자, _, - 외 문자를 _로 변환
6. 중복 _와 앞뒤 _ 제거
7. 원문 deterministic hash 6자를 suffix로 추가
8. 빈 값은 fallback과 fallback hash를 사용
```

### 8.4 ID 형식

```text
runId      = prun:{projectRef}:{characterRef}
itemId     = pitem:{projectRef}:{characterRef}:{situationRef}
variantId  = pvar:{itemRef}:{characterVariantRef}:{situationVariantRef}
jobId      = pjob:{runRef}:{targetSituationRef|all}:{mode}
assetId    = passet:{itemRef}:{variantRef}:{variantImageIndex}
operationId = pcfm:{itemRef}
```

`jobId`는 매 실행마다 증가하는 식별자가 아니다. 같은 run, 대상, mode의 현재 실행 슬롯을 뜻하며 run payload 안에서 재사용한다.

### 8.5 단위 검증 사례

| 입력 | 기대 조건 |
| --- | --- |
| `proj_001` | 항상 `proj_001` |
| `Char-A` | 항상 `char-a` |
| `첫 만남 / 야외` | 읽을 수 있는 slug + 동일한 hash |
| 같은 입력 100회 | 결과가 100회 모두 동일 |
| 다른 한글 원문이 같은 slug | hash가 달라 구분됨 |
| 빈 situationId + imageNumber `12` | item ID가 imageNumber reference로 안정화됨 |

### 8.6 완료 조건

- 동일 입력에 동일 ID가 생성된다.
- 함수 구현에 난수와 현재 시각 의존성이 없다.
- 기존 `makePlannerV3Id()`를 compact 코드에서 호출하지 않는다.

## 9. Phase 3: compact 저장소 계층 구현

### 9.1 내부 record 타입

```js
{
  recordKey: string,
  recordType: 'settings' | 'run' | 'confirm' | 'rate',
  projectId: string,
  characterId: string,
  status: string,
  payload: object,
  revision: number,
  createdAt: string,
  updatedAt: string,
  expiresAt: string | null
}
```

### 9.2 저장소 함수

```js
export async function ensurePlannerCompactSchema(env);
export async function getPlannerCompactRecord(env, recordKey, expectedType);
export async function putPlannerCompactRecord(env, record);
export async function updatePlannerCompactRecord(env, current, nextPayload, options);
export async function deletePlannerCompactRecord(env, recordKey, revision);
```

### 9.3 schema 확인

`ensurePlannerCompactSchema()`는 요청마다 전체 schema를 조사하지 않는다. 최소한의 table existence 확인만 수행하거나 D1의 `no such table` 오류를 명확한 migration 오류로 변환한다.

오류 형식:

```js
{
  code: 'PLANNER_COMPACT_SCHEMA_MISSING',
  status: 503,
  message: 'Planner compact schema is not installed. Run migration 0018.'
}
```

### 9.4 read 계약

```sql
SELECT record_key, record_type, project_id, character_id, status,
       payload_json, revision, created_at, updated_at, expires_at
FROM planner_compact_records
WHERE record_key = ?;
```

- 결과가 없으면 `null`을 반환한다.
- `expectedType`과 `record_type`이 다르면 corruption 오류를 발생시킨다.
- JSON parse 실패를 빈 객체로 숨기지 않고 corruption 오류를 발생시킨다.

### 9.5 일반 upsert 계약

settings와 최초 run 저장에만 일반 upsert를 사용한다.

```sql
INSERT INTO planner_compact_records (
    record_key, record_type, project_id, character_id, status,
    payload_json, revision, created_at, updated_at, expires_at
) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
ON CONFLICT(record_key) DO UPDATE SET
    status = excluded.status,
    payload_json = excluded.payload_json,
    revision = planner_compact_records.revision + 1,
    updated_at = excluded.updated_at,
    expires_at = excluded.expires_at
WHERE planner_compact_records.record_type = excluded.record_type;
```

### 9.6 optimistic update 계약

생성, 상태 제어, confirm 후 run 정리에는 아래 형식을 사용한다.

```sql
UPDATE planner_compact_records
SET status = ?,
    payload_json = ?,
    revision = revision + 1,
    updated_at = ?,
    expires_at = ?
WHERE record_key = ?
  AND record_type = ?
  AND revision = ?;
```

`meta.changes === 0`이면 최대 3회까지 다시 읽고 merge한다. 재시도마다 무조건 write하지 않고 이미 반영된 작업인지 먼저 검사한다.

### 9.7 payload 크기 guard

DB write 전에 UTF-8 byte 길이를 측정한다.

```js
const byteLength = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
```

- 1.25 MB 이상: Worker warning log
- 1.5 MB 이상: `PLANNER_RUN_PAYLOAD_TOO_LARGE` 오류로 write 차단
- candidate에 prompt 전체, 외부 API response 원문, binary/base64를 저장하지 않는다.

### 9.8 write metrics

모든 D1 write는 `runPlannerCompactWrite(statement, label, env)`를 통과시킨다.

```js
if (env.PLANNER_D1_METRICS === '1') {
  console.log('[planner-compact-d1]', label, {
    rowsRead: result.meta?.rows_read,
    rowsWritten: result.meta?.rows_written,
    changes: result.meta?.changes
  });
}
```

metrics log를 위해 추가 D1 row를 만들지 않는다.

### 9.9 완료 조건

- read는 primary key 단건 조회만 사용한다.
- 생성 상태 변경은 revision 조건 없는 `UPDATE`를 사용하지 않는다.
- JSON parse, record type mismatch, payload size 오류가 구분된다.

## 10. Phase 4: settings와 run CRUD 구현

### 10.1 settings

```js
export async function getPlannerCompactSettings(env, projectId);
export async function putPlannerCompactSettings(env, input);
```

동작:

- key는 `settings:{projectRef}`다.
- GET 결과가 없으면 기존 frontend가 허용하는 기본 설정을 반환하거나 route에서 `data: null`을 반환한다.
- PUT 1회는 정확히 1 row upsert만 수행한다.
- 입력에서 알 수 없는 필드는 저장하지 않는다.

### 10.2 run 저장

```js
export async function getPlannerCompactRun(env, { projectId, characterId });
export async function putPlannerCompactRunFromMeta(env, meta, options = {});
export async function updatePlannerCompactItem(env, itemId, patch);
export async function deletePlannerCompactItem(env, itemId);
export async function deletePlannerCompactRun(env, runIdOrKey);
```

### 10.3 run normalization

저장 전 다음 순서로 payload를 만든다.

```text
validate project/character references
-> derive run key and runId
-> normalize item list
-> derive itemId per situation
-> normalize variants and derive variantId
-> retain candidates whose assetId still belongs to an existing slot
-> preserve activeJob only when the incoming edit does not invalidate it
-> validate counts and status
-> write one run row
```

### 10.4 편집 중 생성 충돌

- `activeJob.status`가 `queued`, `running`, `paused`, `cancel_requested`이면 generation 설정과 item 구조 변경을 `409`로 거부한다.
- 이미지 선택처럼 DB에 저장하지 않는 UI state는 허용한다.
- 오류 code는 `PLANNER_RUN_ACTIVE`로 통일한다.

### 10.5 item 단건 API의 실제 저장 방식

item 추가, 수정, 삭제도 별도 item row를 만들지 않는다.

```text
GET run row
-> itemId로 payload.items 탐색
-> 배열 추가/교체/삭제
-> run row optimistic UPDATE 1회
```

마지막 item 삭제 시 선택지는 다음으로 고정한다.

- 명시적인 run 삭제 API: run row `DELETE`
- item 삭제 API로 마지막 item 제거: 빈 `items: []`를 가진 draft run으로 `UPDATE`

이 구분은 frontend의 작업 취소와 run 자체 삭제를 혼동하지 않게 한다.

### 10.6 client adapter

DB payload를 그대로 노출하지 않고 기존 frontend shape로 변환한다.

```js
function plannerCompactRunToClient(record) {
  return {
    ...record.payload,
    id: record.payload.runId,
    runKey: record.recordKey,
    revision: record.revision,
    backgroundJobId: record.payload.activeJob?.jobId || '',
    backgroundStatus: compactStatusFromRun(record.payload)
  };
}
```

### 10.7 완료 조건

- 플랜 전체 저장, item 추가/수정/삭제가 각각 정상 경로 1 write다.
- 같은 상황을 반복 저장해도 item ID와 row 수가 증가하지 않는다.
- active generation 중 구조 변경이 거부된다.

## 11. Phase 5: 생성 상태 모델 구현

### 11.1 run 상태

```text
draft -> queued -> running -> complete
                    |       -> partial_failed
                    |       -> failed
                    |       -> paused -> running
                    |       -> cancel_requested -> cancelled
```

DB의 `status` column과 payload의 `status`는 항상 같은 값으로 쓴다.

### 11.2 activeJob 상태

허용 상태:

```text
queued, running, paused, cancel_requested,
completed, partial_failed, failed, cancelled
```

`activeJob`은 terminal 상태를 status 응답에 한 번 이상 제공할 수 있도록 payload에 남긴다. 다음 생성 시작 시 같은 deterministic `jobId`의 내용을 새 job 상태로 교체한다.

### 11.3 pointer

```js
{
  itemIndex: number,
  variantIndex: number,
  variantImageIndex: number,
  globalImageIndex: number
}
```

pointer는 다음 생성 슬롯을 가리킨다. 완료된 슬롯을 가리키지 않는다.

### 11.4 슬롯 계산

```text
items sort_order
-> variants sort_order
-> variantImageIndex 0..targetCount-1
```

`targetSituationId`가 있으면 해당 situation item만 순회한다. `clearExisting=false`이면 이미 candidate가 있는 슬롯을 건너뛴다. `clearExisting=true`이면 대상 item의 candidate 배열을 생성 시작 update에서 비우고 동일 asset ID 슬롯을 다시 채운다.

### 11.5 완료 조건

- 같은 payload에서 다음 슬롯 계산 결과가 항상 같다.
- candidate 존재 여부와 pointer가 불일치하면 candidate를 기준으로 pointer를 복구할 수 있다.
- terminal count 계산이 frontend 표시 값과 일치한다.

## 12. Phase 6: 생성 시작과 제어 API 구현

### 12.1 공개 함수

```js
export async function startPlannerCompactGeneration(env, body);
export async function getPlannerCompactStatus(env, lookup);
export async function pausePlannerCompactGeneration(env, lookup);
export async function resumePlannerCompactGeneration(env, lookup);
export async function cancelPlannerCompactGeneration(env, lookup);
```

`lookup`은 전환 기간 동안 `{ runKey }` 또는 `{ projectId, characterId }`를 허용한다. `jobId`만 전달된 경우 deterministic job ID를 가진 run을 index 없이 역검색할 수 없으므로 frontend를 `runKey` 기준으로 먼저 전환한다.

### 12.2 start request

```json
{
  "projectId": "proj_001",
  "characterId": "char_a",
  "targetSituationId": "",
  "mode": "background",
  "clearExisting": false,
  "plannerMeta": null
}
```

`plannerMeta`가 있으면 먼저 run payload를 정규화하되, 가능하면 frontend가 별도 run 저장을 완료한 뒤 start를 호출하도록 한다. 한 요청 안에서 run save와 start를 연속 write하면 start 단계가 2 write가 되기 때문이다.

### 12.3 start 처리

```text
GET run
-> active non-terminal job 존재 시 현재 status 반환(write 0)
-> 대상 슬롯 계산
-> 슬롯이 없으면 409 PLANNER_NO_RUNNABLE_ITEMS
-> activeJob 생성, 대상 item 상태 변경, 필요 시 candidates 초기화
-> run optimistic UPDATE 1회
-> background mode이면 Queue 메시지 1개 전송
-> compact status 반환
```

Queue 전송 실패 시 run을 되돌리는 추가 D1 write를 하지 않는다. 오류를 반환하고 다음 start 요청이 `queued` 상태를 감지해 동일 첫 메시지를 다시 전송할 수 있게 한다.

### 12.4 status response

```json
{
  "runKey": "run:proj_001:char_a",
  "runId": "prun:proj_001:char_a",
  "jobId": "pjob:prun_proj_001_char_a:all:background",
  "projectId": "proj_001",
  "characterId": "char_a",
  "status": "running",
  "mode": "background",
  "totalCount": 4,
  "completedCount": 1,
  "failedCount": 0,
  "stage": "generating",
  "stageLabel": "Generating image",
  "errorMessage": "",
  "updatedAt": "2026-07-16T00:00:00.000Z",
  "items": []
}
```

`items`는 기존 frontend 호환 필드를 유지한다. 각 item의 `generatedImages`는 candidate에서 변환한다.

### 12.5 pause

- `queued` 또는 `running`에서만 허용한다.
- run update 1회로 `paused`를 기록한다.
- 이미 `paused`면 write 없이 현재 status를 반환한다.

### 12.6 resume

- `paused`에서만 `queued`로 변경한다.
- run update 1회 후 background Queue 메시지 1개를 보낸다.
- 이미 `queued` 또는 `running`이면 write 없이 현재 status를 반환한다.

### 12.7 cancel

- `queued`, `running`, `paused`에서 `cancel_requested`로 update 1회 수행한다.
- Worker가 다음 메시지를 처리할 때 `cancelled` terminal update를 1회 수행한다.
- 아직 외부 API 호출 전이라면 API 자체에서 바로 `cancelled`로 전환해도 되지만 한 요청에서 중간 상태와 terminal 상태를 두 번 쓰지 않는다.

### 12.8 완료 조건

- start는 정상 경로 1 write다.
- 같은 start 재호출이 새 job row나 ID를 만들지 않는다.
- pause/resume/cancel의 동일 요청 재호출은 write 0인 멱등 동작이다.

## 13. Phase 7: background Queue 처리 구현

### 13.1 Queue message 계약

```json
{
  "plannerCompact": true,
  "runKey": "run:proj_001:char_a",
  "jobId": "pjob:prun_proj_001_char_a:all:background",
  "expectedGlobalImageIndex": 0
}
```

Queue message ID를 DB identity로 저장하지 않는다.

### 13.2 dispatcher

`processPlannerQueueMessage()`에 compact 분기를 먼저 추가한다.

```js
if (message?.plannerCompact) {
  return processPlannerCompactQueueMessage(env, message);
}
if (message?.plannerV3) {
  return processPlannerV3QueueMessage(env, message);
}
```

v3 분기는 rollback 기간 동안만 유지하고 compact API에서는 더 이상 v3 메시지를 발행하지 않는다.

### 13.3 메시지 처리 순서

```text
GET run
-> run 또는 activeJob 없음: ack, write 0
-> jobId 불일치: stale message로 ack, write 0
-> paused: ack, write 0
-> cancel_requested: cancelled로 run update 1회 후 ack
-> expectedGlobalImageIndex가 현재 pointer보다 작음: duplicate로 ack, write 0
-> expectedGlobalImageIndex가 현재 pointer보다 큼: retryable error
-> deterministic slot과 assetId/R2 key 계산
-> R2에 동일 key가 있고 candidate가 없으면 object metadata를 재사용
-> 없으면 NovelAI 호출, WebP 변환, R2 put
-> candidate replace, count/pointer/status 계산
-> run optimistic UPDATE 1회
-> 다음 슬롯이 있으면 다음 Queue 메시지 1개 전송
-> terminal이면 종료
```

### 13.4 R2 key

```text
{projectPrefix}_planner_temp_image/{characterRef}/{situationRef}/{variantRef}/{variantImageIndex}.webp
```

동일 슬롯 재시도는 동일 R2 key에 overwrite한다. 파일명에 timestamp나 random UUID를 넣지 않는다.

### 13.5 성공 update

성공 update에서 한 번에 처리할 항목:

- candidate replace
- item `completedCount`
- item `status`
- activeJob `completedCount`
- activeJob pointer advance
- activeJob/run terminal status 계산
- `updatedAt`

이 상태들을 별도 stage update로 나누지 않는다.

### 13.6 실패 update

재시도 가능한 네트워크/R2 오류는 Queue retry에 맡기고 D1을 갱신하지 않는다. 최종 실패로 판정될 때만 run update 1회로 다음을 함께 기록한다.

- 실패 슬롯의 최소 정보
- item/job `failedCount`
- pointer advance
- `lastError`
- terminal 여부

실패 상세 stack과 외부 response 원문은 Worker log 또는 기존 R2 오류 로그에 저장한다.

### 13.7 optimistic 충돌

충돌 후 최신 run을 읽었을 때:

- 같은 `assetId`가 이미 candidate에 있으면 성공으로 종료한다.
- pointer가 다음 슬롯로 이동했으면 stale 성공으로 종료한다.
- jobId가 바뀌었으면 stale 메시지로 종료한다.
- 아직 같은 슬롯이면 payload를 재구성해 최대 3회 재시도한다.

### 13.8 cooldown

NovelAI cooldown이 실제 발생한 경우에만 `rate:novelai`를 upsert한다. polling, 대기 heartbeat, slot claim을 위해 rate row를 갱신하지 않는다.

### 13.9 완료 조건

- 성공 이미지 1장당 D1 write 1회다.
- 최종 실패 슬롯 1건당 D1 write 1회다.
- 중복 메시지는 D1 write 0회다.
- 다음 Queue 메시지는 현재 run update 성공 후에만 발행한다.

## 14. Phase 8: browser 생성 모드 구현

### 14.1 API 교체

기존 URL은 유지할 수 있지만 내부 의미를 compact slot으로 바꾼다.

```text
GET  /api/planner/v3/generate/next-browser-queue?runKey=...
POST /api/planner/v3/generate/complete-browser-queue
```

### 14.2 next response

next 호출은 read-only다. claim row나 heartbeat를 만들지 않는다.

```json
{
  "done": false,
  "runKey": "run:proj_001:char_a",
  "jobId": "pjob:prun_proj_001_char_a:all:browser",
  "expectedRevision": 4,
  "slot": {
    "itemId": "pitem:proj_001:char_a:sit_001",
    "variantId": "pvar:pitem_proj_001_char_a_sit_001:default:default",
    "variantImageIndex": 0,
    "globalImageIndex": 0,
    "assetId": "passet:pitem_proj_001_char_a_sit_001:pvar_default_default:0",
    "r2Key": "..."
  },
  "generation": {}
}
```

### 14.3 complete request

```json
{
  "runKey": "run:proj_001:char_a",
  "jobId": "pjob:prun_proj_001_char_a:all:browser",
  "assetId": "passet:...:0",
  "r2Key": "...",
  "width": 832,
  "height": 1216,
  "byteSize": 123456,
  "mimeType": "image/webp",
  "expectedRevision": 4
}
```

서버는 client가 보낸 `assetId`, `r2Key`를 그대로 신뢰하지 않는다. 현재 run의 next slot에서 다시 계산한 값과 일치하는지 검증한다.

### 14.4 동시 탭 제한

별도 claim write를 만들지 않으므로 두 탭이 같은 next slot을 받을 수 있다. complete 시 revision과 deterministic asset ID를 검증하여 먼저 완료된 요청만 count를 증가시킨다. 늦은 동일 요청은 이미 반영된 성공으로 응답한다.

### 14.5 완료 조건

- next 호출의 D1 write는 0이다.
- complete 호출은 이미지 1장당 run update 1회다.
- 동일 complete 재호출은 candidate와 count를 중복 생성하지 않는다.

## 15. Phase 9: confirm과 후처리 구현

### 15.1 공개 함수

```js
export async function confirmPlannerCompactAsset(env, body);
export async function cleanupPlannerCompactAssets(env, options = {});
```

### 15.2 confirm request

```json
{
  "runKey": "run:proj_001:char_a",
  "itemId": "pitem:proj_001:char_a:sit_001",
  "assetId": "passet:...:0",
  "targetR2Key": "alice/1.webp",
  "targetFolderPrefix": "alice/",
  "targetFileName": "1.webp"
}
```

### 15.3 confirm 순서

```text
1. GET run, item, candidate 검증                         D1 write 0
2. confirm:{itemId} 조회                               D1 write 0
3. completed + 동일 asset/target이면 기존 결과 반환     D1 write 0
4. pending confirm upsert                              D1 write 1
5. R2 후보 object 읽기 및 최종 key put                  D1 write 0
6. file_metadata upsert                               D1 write 1
7. confirm completed update                           D1 write 1
8. run에서 item 제거 또는 마지막 item이면 run delete    D1 write 1
9. 미선택 후보 R2 object best-effort 삭제               D1 write 0
```

정상 base count는 4다.

### 15.4 confirm record 재사용

confirm key는 item당 하나다. 동일 item에 대해 새 random operation row를 만들지 않는다.

- 동일 asset/target 재호출: write 0, 이전 성공 반환
- `pending` 재호출: 마지막 완료 지점부터 재개
- `failed` 재호출: 같은 row를 pending으로 upsert하고 재시도
- 다른 asset/target으로 completed operation 변경 요청: `409 PLANNER_CONFIRM_CONFLICT`

### 15.5 실패 경계

| 실패 위치 | 재호출 동작 |
| --- | --- |
| pending 저장 전 | 처음부터 시작 |
| pending 저장 후, R2 put 전 | 같은 confirm row로 재개 |
| R2 put 후, metadata 전 | 동일 target key overwrite 후 metadata 수행 |
| metadata 후, confirm 완료 전 | metadata upsert 반복 후 완료 처리 |
| confirm 완료 후, run 정리 전 | run 정리만 재개 |

단계별 상태를 여러 번 update하지 않기 위해 confirm payload에는 최소한 `pending`, `completed`, `failed`만 사용한다. `copying`, `metadata_saved`, `cleanup_queued` 중간 상태는 만들지 않는다.

### 15.6 run 정리 충돌

confirm 시작 시 읽은 run revision이 변경되면 최신 run을 다시 읽는다.

- item이 이미 없고 confirm이 completed면 성공 처리한다.
- item이 있고 선택 candidate가 같으면 item 제거를 재시도한다.
- item candidate가 달라졌으면 conflict로 중단한다.

### 15.7 cleanup

- 정상 confirm에서는 후보 R2 object를 직접 best-effort 삭제한다.
- cleanup 작업을 위해 D1 queue row를 만들지 않는다.
- 삭제 실패는 R2/Worker log에 남긴다.
- 정기 cleanup은 deterministic prefix를 기준으로 orphan object를 찾아 처리하되 D1 row를 만들지 않는다.
- confirm TTL cleanup은 `expires_at` full scan을 자주 실행하지 않고 낮은 빈도의 유지보수 작업으로 제한한다.

### 15.8 완료 조건

- confirm 정상 경로는 planner 3 write + `file_metadata` 1 write다.
- 동일 confirm 재호출은 write 0으로 완료될 수 있다.
- item당 confirm row가 하나를 초과하지 않는다.

## 16. Phase 10: API route 교체

### 16.1 import 교체

`functions/[[path]].js`에서 v3 route가 호출하는 구현을 `src/planner-compact.js`로 변경한다. URL과 관리자 인증은 유지한다.

### 16.2 route 계약

| method/path | compact lookup | write budget |
| --- | --- | ---: |
| `GET /api/planner/v3/settings?projectId=` | settings key | 0 |
| `PUT /api/planner/v3/settings` | settings key | 1 |
| `GET /api/planner/v3/run?projectId=&characterId=` | run key | 0 |
| `POST /api/planner/v3/run` | run key | 1 |
| `PUT /api/planner/v3/run/:runId` | body에서 project/character 검증 | 1 |
| `DELETE /api/planner/v3/run/:runId` | deterministic run key | 1 |
| `POST /api/planner/v3/item` | 부모 run key | 1 |
| `PUT /api/planner/v3/item/:itemId` | body의 project/character 또는 runKey | 1 |
| `DELETE /api/planner/v3/item/:itemId` | query/body의 runKey | 1 |
| `POST /api/planner/v3/generate/start` | runKey | 1 |
| `GET /api/planner/v3/generate/status?runKey=` | runKey | 0 |
| `GET /api/planner/v3/generate/next-browser-queue?runKey=` | runKey | 0 |
| `POST /api/planner/v3/generate/complete-browser-queue` | runKey | 1 |
| `POST /api/planner/v3/generate/pause` | runKey | 0 또는 1 |
| `POST /api/planner/v3/generate/resume` | runKey | 0 또는 1 |
| `POST /api/planner/v3/generate/cancel` | runKey | 0 또는 1 |
| `POST /api/planner/v3/confirm` | runKey + itemId | 4 |
| `POST /api/planner/v3/cleanup-assets` | prefix 기반 cleanup | 0 |

### 16.3 오류 응답

```json
{
  "error": "Planner run is active",
  "code": "PLANNER_RUN_ACTIVE"
}
```

| HTTP | code | 의미 |
| ---: | --- | --- |
| 400 | `PLANNER_INVALID_INPUT` | reference나 payload 누락/형식 오류 |
| 404 | `PLANNER_RUN_NOT_FOUND` | compact run 없음 |
| 404 | `PLANNER_ITEM_NOT_FOUND` | item 없음 |
| 404 | `PLANNER_ASSET_NOT_FOUND` | candidate 또는 R2 object 없음 |
| 409 | `PLANNER_RUN_ACTIVE` | 생성 중 구조 변경 |
| 409 | `PLANNER_REVISION_CONFLICT` | optimistic retry 소진 |
| 409 | `PLANNER_CONFIRM_CONFLICT` | 완료된 item의 다른 확정 요청 |
| 409 | `PLANNER_NO_RUNNABLE_ITEMS` | 생성할 슬롯 없음 |
| 413 | `PLANNER_RUN_PAYLOAD_TOO_LARGE` | payload guard 초과 |
| 503 | `PLANNER_COMPACT_SCHEMA_MISSING` | migration 미적용 |

### 16.4 완료 조건

- route에서 v3 저장 함수 호출이 남아 있지 않다.
- 모든 route는 기존과 같은 admin guard를 사용한다.
- frontend가 필요한 호환 response 필드는 adapter가 제공한다.

## 17. Phase 11: frontend 전환

### 17.1 상태 필드

frontend planner meta에 다음 값을 유지한다.

```js
{
  id: runId,
  runKey,
  characterId,
  backgroundJobId: activeJob?.jobId || '',
  backgroundStatus
}
```

`backgroundJobId`는 표시 호환용이다. status/control API 조회 key로는 `runKey`를 사용한다.

### 17.2 변경 대상

- run 저장 response에서 `runKey` 보관
- 생성 start body에 `projectId`, `characterId` 전달
- status polling query를 `jobId`에서 `runKey`로 변경
- pause/resume/cancel body를 `{ runKey }`로 변경
- browser next/complete에 `runKey`, `jobId`, `expectedRevision` 전달
- confirm body에 `runKey`, `itemId`, `assetId` 전달
- UI에서 선택한 R2 key로 candidate를 찾을 때 asset ID를 함께 보관

### 17.3 선택 상태

이미지 선택은 계속 frontend 메모리에만 둔다.

```js
item.selectedImage = candidate.r2Key;
item.selectedAssetId = candidate.assetId;
```

플랜 저장 API를 호출할 때 `selectedImage`, `selectedAssetId`를 run payload에 영속화하지 않는다.

### 17.4 polling

- background status polling은 read-only다.
- terminal status에서 즉시 중단한다.
- polling 간격 때문에 D1 read가 증가할 수 있으므로 현재보다 짧게 만들지 않는다.
- visibility가 hidden이면 polling을 멈추거나 느리게 한다.

### 17.5 완료 조건

- frontend 네트워크 호출에서 status/control용 `jobId` 단독 조회가 없다.
- 후보 선택 시 D1 save가 발생하지 않는다.
- 기존 화면의 진행률, 이미지 목록, 재생성, 확정 동작이 compact response로 유지된다.

## 18. Phase 12: 기존 v3 write 차단과 정리

### 18.1 코드 차단

- Pages route에서 `put/start/complete/confirm` v3 함수를 더 이상 import하지 않는다.
- Queue producer는 `{ plannerCompact: true }` 메시지만 발행한다.
- 기존 `{ plannerV3: true }` consumer는 rollback 기간 동안 수신만 허용한다.
- 신규 compact 경로에서 `planner_v3_` SQL 문자열이 사용되지 않는지 검색한다.

### 18.2 정적 검색

```powershell
rg -n "planner_v3_|makePlannerV3Id|plannerV3: true" src functions public
```

검색 결과가 존재할 수 있는 허용 위치:

- rollback용 기존 함수 본문
- legacy message drain 분기
- 명시적인 legacy cleanup 코드

compact 함수와 v3 route 연결부에는 존재하면 안 된다.

### 18.3 데이터 삭제 시점

기존 v3 table 삭제는 이번 구현의 일부가 아니다. Cloudflare 배포 후 compact 흐름과 rows written을 확인한 다음 별도 migration으로 수행한다.

## 19. 단계별 write 예산

| 작업 | INSERT | UPDATE | DELETE | 정상 base count |
| --- | ---: | ---: | ---: | ---: |
| settings 최초 저장 | 1 | 0 | 0 | 1 |
| settings 재저장 | 0 | 1 | 0 | 1 |
| 플랜 최초 저장 | 1 | 0 | 0 | 1 |
| 플랜 재저장 | 0 | 1 | 0 | 1 |
| 생성 시작 | 0 | 1 | 0 | 1 |
| 이미지 성공 1장 | 0 | 1 | 0 | 1 |
| 이미지 최종 실패 1장 | 0 | 1 | 0 | 1 |
| status 조회 | 0 | 0 | 0 | 0 |
| 후보 선택 | 0 | 0 | 0 | 0 |
| pause/resume/cancel 상태 변경 | 0 | 1 | 0 | 1 |
| 중복 상태 제어 | 0 | 0 | 0 | 0 |
| confirm | 2 | 2 | 0 | 4 |
| 마지막 item confirm | 2 | 1 | 1 | 4 |
| 중복 completed confirm | 0 | 0 | 0 | 0 |

confirm의 INSERT 2개는 compact confirm row와 기존 `file_metadata` row를 의미한다. metadata가 이미 있으면 그중 하나는 UPDATE가 될 수 있으나 base count는 동일하게 1로 본다.

## 20. 검증 명세

### 20.1 로컬 정적 검증

프로젝트 규칙에 따라 live D1, browser, end-to-end 테스트는 로컬에서 수행하지 않는다.

```powershell
node --check src/planner-compact.js
node --check src/planner-background.js
node --check functions/[[path]].js
node --check public/js/project/planner.js
node --check public/js/project/shared.js
```

추가 검토:

- 수정 파일 UTF-8 BOM 없음
- migration 번호 중복 없음
- compact DDL에 보조 index 없음
- compact ID helper에 random/time 의존성 없음
- D1 write SQL이 metrics wrapper를 통과함
- status/next API에 write SQL 없음

### 20.2 배포 후 기능 시나리오

사용자가 commit/push하고 Cloudflare 배포가 완료된 뒤 다음 순서로 확인한다.

```text
1. 프로젝트+캐릭터 플랜 생성
2. 같은 플랜 재저장 후 run row가 1개인지 확인
3. 상황 2개, 각 이미지 2장 background 생성
4. status polling 중 추가 write가 없는지 확인
5. 동일 Queue 메시지 재처리 시 candidate/count 중복이 없는지 확인
6. 이미지 선택 시 D1 write가 없는지 확인
7. 첫 상황 confirm
8. 같은 confirm 재호출 시 write 0과 동일 결과 확인
9. 두 번째 상황 confirm 후 run row 삭제 확인
10. R2 최종 이미지와 file_metadata 확인
```

### 20.3 D1 측정

각 write helper의 D1 반환 metadata에서 다음을 기록한다.

```text
label
meta.rows_read
meta.rows_written
meta.changes
record_key
revision before/after
```

기대값:

- 이미지 4장 정상 생성의 application SQL write 호출은 4회다.
- 설정 저장 제외 전체 기준 시나리오의 base write는 14회다.
- 실제 `rows_written`은 D1 내부 처리 기준으로 base count와 다를 수 있으므로 dashboard 및 반환 metadata를 최종값으로 사용한다.

### 20.4 실패 시나리오

| 시나리오 | 기대 결과 |
| --- | --- |
| Queue 중복 전달 | write 0, candidate/count 변화 없음 |
| R2 put 후 Worker retry | 동일 key 재사용, candidate 1개 |
| revision 충돌 | 최신 payload merge, 최대 3회 |
| 생성 중 플랜 편집 | 409, write 0 |
| 동일 confirm 재호출 | 기존 결과 반환, write 0 |
| confirm 중 R2 object 없음 | failed confirm 재사용 가능, 새 row 없음 |
| run payload 1.5 MB 초과 | 413, write 0 |
| migration 미적용 | 503 schema 오류 |

## 21. 배포와 rollback 순서

### 21.1 배포

```text
1. 0018 migration 적용
2. background Worker 배포
3. Pages 배포
4. compact 플랜 신규 생성 확인
5. rows_written 측정
6. browser/background/confirm 시나리오 확인
```

background Worker를 먼저 배포하는 이유는 Pages가 compact Queue 메시지를 발행하는 순간 consumer가 이를 이해해야 하기 때문이다.

### 21.2 rollback

- 기존 v3 table과 코드는 관찰 기간 동안 보존한다.
- rollback 시 Pages route와 Queue producer를 v3 구현으로 되돌린다.
- compact row를 v3로 역이관하지 않는다.
- compact table은 즉시 삭제하지 않는다.
- compact와 v3를 동시에 쓰는 dual-write는 rows written 목표를 훼손하므로 구현하지 않는다.

## 22. 최종 구현 체크리스트

### 22.1 데이터 계층

- [ ] `0018_planner_compact_records.sql` 추가
- [ ] 단일 테이블, 보조 index 없음 확인
- [ ] deterministic ID helper 구현
- [ ] record parser와 corruption 오류 구현
- [ ] optimistic update와 3회 retry 구현
- [ ] payload byte guard 구현
- [ ] optional rows read/written log 구현

### 22.2 기능 계층

- [ ] settings CRUD 구현
- [ ] run 전체 CRUD 구현
- [ ] item payload CRUD 구현
- [ ] 생성 상태와 pointer 계산 구현
- [ ] start/status/pause/resume/cancel 구현
- [ ] background Queue compact message 구현
- [ ] browser next/complete 구현
- [ ] confirm idempotency와 후처리 구현
- [ ] R2 deterministic key 및 cleanup 구현

### 22.3 연결 계층

- [ ] v3 URL을 compact backend에 연결
- [ ] frontend에 `runKey` 저장
- [ ] status/control을 `runKey` 기준으로 변경
- [ ] 선택 상태를 client-only로 유지
- [ ] 기존 v3 신규 write 차단

### 22.4 검증

- [ ] 수정 JS 파일 `node --check`
- [ ] UTF-8 BOM 검사
- [ ] compact ID random/time 의존성 검색
- [ ] compact write SQL 호출 수 검토
- [ ] 사용자 배포 후 D1 metadata 측정
- [ ] 기준 시나리오 14 base write 확인

## 23. 구현 완료 판정 기준

다음 조건을 모두 충족해야 실제 구현이 완료된 것으로 본다.

1. 플래너 신규 데이터가 `planner_compact_records` 외의 planner table에 기록되지 않는다.
2. 동일 프로젝트+캐릭터+상황을 반복 저장해도 run/item/confirm identity 수가 증가하지 않는다.
3. 이미지 1장 성공 또는 최종 실패가 run row 1회 update로 끝난다.
4. Queue 중복 전달과 API 중복 요청이 count, candidate, confirm row를 중복 생성하지 않는다.
5. 후보 선택은 D1 write를 발생시키지 않는다.
6. confirm 전체 정상 경로가 base write 4회 이하다.
7. frontend의 플랜 작성, background 생성, browser 생성, 상태 제어, 최종 확정 흐름이 유지된다.
8. 로컬 static check와 BOM 검사를 통과한다.
9. Cloudflare 배포 후 D1 `meta.rows_written` 및 dashboard로 개선 효과를 확인한다.

