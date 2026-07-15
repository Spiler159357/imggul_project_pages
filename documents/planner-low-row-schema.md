# 플래너 low-row 신규 DB 스키마 설계

작성일: 2026-07-06

## 1. 목표

이번 스키마는 기존 v3 DB의 정규화 방향을 의도적으로 되돌린다.

목표는 다음과 같다.

- D1 `rows_written`을 최소화한다.
- 테이블 수를 최소화한다.
- 이미지 1장마다 queue/task/asset row를 만들지 않는다.
- 플래너 상태를 project+character 단위 JSON document row로 합친다.
- 새 row와 payload 내부 ID는 랜덤 생성하지 않고 프로젝트, 캐릭터, 상황, 이미지 번호 등 안정적인 reference에서 파생한다.
- 기존 DB 내용을 보존하거나 migration하지 않는다.
- 기존 프로젝트, 캐릭터, 상황, 최종 이미지 저장 구조는 건드리지 않는다.

## 2. 설계 요약

신규 플래너 DB는 테이블 1개만 사용한다.

```text
planner_compact_records
```

이 테이블은 `record_key`를 primary key로 쓰는 compact document store다.

| record type | record_key 형식 | payload |
| --- | --- | --- |
| settings | `settings:{projectId}` | 프로젝트별 기본 생성 설정 |
| run | `run:{projectId}:{characterId}` | 캐릭터별 플래너 초안, item, variant, 후보 이미지, active job |
| confirm | `confirm:{itemId}` | item 확정 idempotency ledger |
| rate | `rate:novelai` | NovelAI cooldown |

보조 index는 만들지 않는다. 모든 조회는 deterministic `record_key` primary key로 수행한다.

## 3. ID/key 정책

신규 구조에서는 row 증가를 막고 운영자가 DB를 직접 볼 때 의미를 파악하기 쉽도록 랜덤 ID 생성을 기본 금지한다.

### 3.1 deterministic ID 원칙

- `record_key`는 반드시 프로젝트/캐릭터/상황 등 기존 source reference에서 만든다.
- payload 내부 `runId`, `itemId`, `variantId`, `jobId`, `assetId`, `operationId`도 같은 원칙을 따른다.
- 같은 프로젝트, 캐릭터, 상황, variant, image index 조합은 항상 같은 ID를 만든다.
- 같은 개념의 row를 다시 저장할 때 새 ID를 만들지 않고 기존 deterministic key를 upsert한다.
- 랜덤 값은 동시성 제어용 `revision`, 외부 API retry token, 임시 in-memory lock처럼 DB identity가 아닌 용도에만 제한한다.

### 3.2 ID 생성 규칙

ID는 다음 규칙으로 만든다.

```text
safe(value):
  projectId, characterId, situationId처럼 이미 안정적인 내부 ID가 있으면 trim 후 그대로 사용
  표시명, prefix, imageNumber 등 보조 reference만 있으면 slug(reference) + '_' + shortHash(reference) 사용
  slug는 trim, 소문자화, 구분자 정리 후 문자/숫자/_/-만 유지
  빈 값이면 fallback reference에 shortHash를 붙임

runId:
  prun:{safe(projectId)}:{safe(characterId)}

itemId:
  pitem:{safe(projectId)}:{safe(characterId)}:{safe(situationId || imageNumber)}

variantId:
  pvar:{itemId}:{safe(characterPromptVariantId || 'default')}:{safe(situationPromptVariantId || 'default')}

jobId:
  pjob:{runId}:{safe(targetSituationId || 'all')}:{safe(mode)}

assetId:
  passet:{itemId}:{safe(variantId)}:{imageIndex}

operationId:
  pcfm:{itemId}
```

`assetId`는 같은 후보 생성 슬롯을 가리키는 안정적인 ID다. 같은 슬롯을 재생성할 때는 기존 candidate entry를 덮어쓰거나 교체하고, 새 ID를 계속 추가하지 않는다.

### 3.3 record_key와 ID 예시

| 개념 | 예시 |
| --- | --- |
| settings record | `settings:proj_001` |
| run record | `run:proj_001:char_a` |
| runId | `prun:proj_001:char_a` |
| itemId | `pitem:proj_001:char_a:sit_001` |
| variantId | `pvar:pitem_proj_001_char_a_sit_001:default:closeup` |
| jobId | `pjob:prun_proj_001_char_a:all:background` |
| assetId | `passet:pitem_proj_001_char_a_sit_001:pvar_default_closeup:0` |
| confirm record | `confirm:pitem:proj_001:char_a:sit_001` |
| operationId | `pcfm:pitem:proj_001:char_a:sit_001` |

실제 저장 시 구분자 `:`를 유지할 수 없는 위치가 있으면 `safe()` 결과처럼 `_`로 바꾼다. 중요한 것은 같은 reference가 같은 ID를 만든다는 점이다.

예를 들어 `situationId = 'sit_001'`처럼 안정적인 ID가 있으면 `sit_001`을 그대로 쓰고, 상황 표시명만 `첫 만남 / 야외`처럼 있는 경우에는 `첫_만남_야외_ab12cd`처럼 사람이 읽을 수 있는 slug와 deterministic hash를 함께 사용한다. hash는 충돌 방지용이며 랜덤 값이 아니다.

## 4. DDL

```sql
CREATE TABLE IF NOT EXISTS planner_compact_records (
    record_key TEXT PRIMARY KEY,
    record_type TEXT NOT NULL
        CHECK (record_type IN ('settings', 'run', 'confirm', 'rate')),
    project_id TEXT NOT NULL DEFAULT '',
    character_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT
);
```

보조 index를 만들지 않는 이유:

- Cloudflare D1은 index가 write에 추가 written row를 만들 수 있다.
- 플래너는 project/character 목록을 이미 frontend가 알고 있으므로 listing index 없이 key 조회가 가능하다.
- cleanup 대상 confirm record는 많아지지 않도록 TTL cleanup을 느슨하게 수행한다.

## 5. record payload 구조

### 5.1 settings record

```json
{
  "version": 1,
  "projectId": "proj_001",
  "projectPrefix": "comic01/",
  "defaults": {
    "model": "nai-diffusion-4-5-full",
    "steps": "28",
    "scale": "5.0",
    "sampler": "k_euler_ancestral",
    "resolution": "832x1216",
    "sm": false,
    "sm_dyn": false,
    "vibeStrength": "",
    "vibeInfo": "",
    "preciseStrength": "",
    "preciseFidelity": "",
    "preciseType": "",
    "vibeImageKey": "",
    "preciseImageKey": ""
  }
}
```

### 5.2 run record

```json
{
  "version": 1,
  "runId": "prun:proj_001:char_a",
  "projectId": "proj_001",
  "projectPrefix": "comic01/",
  "characterId": "char_a",
  "characterPrefix": "alice/",
  "status": "draft",
  "mode": "background",
  "defaultCount": 20,
  "items": [
    {
      "itemId": "pitem:proj_001:char_a:sit_001",
      "situationId": "sit_001",
      "situationName": "intro",
      "situationIndex": 0,
      "imageNumber": "1",
      "rating": "sfw",
      "status": "pending",
      "targetCount": 20,
      "completedCount": 0,
      "failedCount": 0,
      "generation": {
        "prompt": "",
        "negative": "",
        "fields": {},
        "v4PromptCharacters": [],
        "model": "nai-diffusion-4-5-full",
        "res": "832x1216",
        "steps": "28",
        "scale": "5.0",
        "sampler": "k_euler_ancestral"
      },
      "variants": [
        {
          "variantId": "pvar:pitem_proj_001_char_a_sit_001:default:default",
          "characterPromptVariantId": "",
          "situationPromptVariantId": "",
          "targetCount": 20,
          "generation": {}
        }
      ],
      "candidates": []
    }
  ],
  "activeJob": null,
  "updatedAt": "2026-07-06T00:00:00.000Z"
}
```

### 5.3 activeJob 구조

이미지별 queue row를 만들지 않고, 실행 포인터를 JSON 안에 둔다.

```json
{
  "jobId": "pjob:prun_proj_001_char_a:all:background",
  "mode": "background",
  "status": "running",
  "targetSituationId": "",
  "totalCount": 40,
  "completedCount": 3,
  "failedCount": 0,
  "next": {
    "itemIndex": 0,
    "variantIndex": 0,
    "variantImageIndex": 3,
    "globalImageIndex": 3
  },
  "startedAt": "2026-07-06T00:00:00.000Z",
  "updatedAt": "2026-07-06T00:00:00.000Z",
  "lastError": ""
}
```

생성 완료 시 candidate만 item 안에 append한다.

```json
{
  "assetId": "passet:pitem_proj_001_char_a_sit_001:pvar_default_default:3",
  "r2Key": "comic01/_planner_temp_image/char_a/1/0003.webp",
  "itemId": "pitem:proj_001:char_a:sit_001",
  "variantId": "pvar:pitem_proj_001_char_a_sit_001:default:default",
  "imageIndex": 3,
  "width": 832,
  "height": 1216,
  "byteSize": 123456,
  "createdAt": "2026-07-06T00:00:00.000Z"
}
```

### 5.4 confirm record

```json
{
  "version": 1,
  "operationId": "pcfm:pitem_proj_001_char_a_sit_001",
  "runKey": "run:proj_001:char_a",
  "itemId": "pitem:proj_001:char_a:sit_001",
  "selectedAssetId": "passet:pitem_proj_001_char_a_sit_001:pvar_default_default:3",
  "selectedR2Key": "comic01/_planner_temp_image/char_a/1/0003.webp",
  "targetR2Key": "alice/1.webp",
  "targetFolderPrefix": "alice/",
  "targetFileName": "1.webp",
  "idempotencyKey": "confirm:pitem_001:passet_001",
  "status": "completed",
  "errorMessage": "",
  "createdAt": "2026-07-06T00:00:00.000Z",
  "completedAt": "2026-07-06T00:00:00.000Z",
  "expiresAt": "2026-07-07T00:00:00.000Z"
}
```

### 5.5 rate record

```json
{
  "version": 1,
  "key": "novelai",
  "availableAt": 1783340000000,
  "reason": "cooldown"
}
```

## 6. 신규 write 정책

### 6.1 플랜 저장

기존 구조는 run, items, variants, snapshots를 여러 row로 나누어 저장했다. 신규 구조는 전체 플랜을 run record 1 row에 저장한다.

```sql
INSERT INTO planner_compact_records (
    record_key, record_type, project_id, character_id, status,
    payload_json, revision, created_at, updated_at
)
VALUES (?, 'run', ?, ?, ?, ?, 1, ?, ?)
ON CONFLICT(record_key) DO UPDATE SET
    status = excluded.status,
    payload_json = excluded.payload_json,
    revision = planner_compact_records.revision + 1,
    updated_at = excluded.updated_at;
```

예상 base write:

- 신규 플랜 생성: 1 `INSERT`
- 기존 플랜 저장: 1 `UPDATE`

### 6.2 생성 시작

생성 시작 시 job/task/queue row를 만들지 않는다. run payload에 `activeJob`만 만든다.

```sql
UPDATE planner_compact_records
SET status = 'queued',
    payload_json = ?,
    revision = revision + 1,
    updated_at = ?
WHERE record_key = ?
  AND record_type = 'run';
```

예상 base write:

- 생성 시작: 1 `UPDATE`

### 6.3 이미지 생성 완료

이미지 생성 중 stage/heartbeat는 D1에 쓰지 않는다. 성공 또는 실패가 확정되는 순간에만 run record를 갱신한다.

```sql
UPDATE planner_compact_records
SET status = ?,
    payload_json = ?,
    revision = revision + 1,
    updated_at = ?
WHERE record_key = ?
  AND revision = ?;
```

예상 base write:

- 이미지 1장 성공: 1 `UPDATE`
- 이미지 1장 실패: 1 `UPDATE`

optimistic `revision` 충돌이 나면 최신 run payload를 다시 읽고 candidate 중복 여부를 확인한 뒤 재시도한다.

### 6.4 선택

사용자 UI에서 후보 이미지를 선택하는 행위는 D1에 쓰지 않는다. 선택한 `assetId`는 confirm API 요청 body에만 포함한다.

예상 base write:

- 선택: 0

### 6.5 확정

확정은 다음 순서로 처리한다.

```text
1. confirm:{itemId} record를 pending으로 INSERT한다.
2. 선택 후보 R2 key를 최종 위치로 copy한다.
3. 기존 file_metadata에 최종 이미지 metadata를 upsert한다.
4. confirm record를 completed로 UPDATE한다.
5. run record에서 확정된 item과 후보 목록을 제거한다.
6. 남은 item이 없으면 run record를 DELETE한다.
7. 후보 R2 key는 D1 cleanup row 없이 직접 삭제한다.
```

정상 경로 예상 base write:

- confirm ledger: 1 `INSERT`
- 최종 `file_metadata`: 1 `INSERT` 또는 `UPDATE`
- confirm 완료: 1 `UPDATE`
- run에서 item 제거: 1 `UPDATE` 또는 마지막 item이면 1 `DELETE`

## 7. 삭제와 cleanup 정책

기존 v3는 후보마다 asset row를 만들고, queue/task/item row를 삭제하면서 cascade를 사용했다. 신규 구조는 candidate가 run JSON 안에만 있으므로 확정 후 삭제할 D1 row가 없다.

정상 경로:

```text
1. 후보 R2 key들을 직접 delete
2. D1 cleanup queue row는 만들지 않음
```

실패 경로:

```text
1. R2 delete 실패 key만 run payload의 cleanupFailures 배열에 남김
2. 다음 run 조회 또는 별도 cleanup API 호출 시 다시 삭제 시도
3. 실패가 반복되는 경우에만 cleanup record 1개로 압축 저장 가능
```

## 8. trade-off

이 스키마는 D1 row 사용량을 줄이기 위해 다음을 희생한다.

- SQL로 item/queue/job을 세밀하게 검색하기 어렵다.
- 진행 stage와 heartbeat가 DB에 남지 않는다.
- 한 run row의 JSON payload가 커진다.
- 동시 편집 충돌은 row 단위 `revision`으로만 제어한다.
- candidate 이미지별 감사 로그가 사라진다.
- cleanup 실패 추적이 느슨해진다.
- reference 기반 ID가 바뀌면 같은 개념을 다른 record로 볼 수 있으므로 projectId, characterId, situationId는 생성 후 안정적으로 유지되어야 한다.

하지만 이번 작업의 우선순위는 D1 row write 최소화이므로 위 trade-off를 의도적으로 수용한다.

## 9. D1 제한 대응

D1 row count에는 row 크기가 직접 반영되지 않지만, row/string/BLOB size 제한은 2 MB다. 따라서 다음 기준을 둔다.

- 이미지 binary는 절대 D1에 저장하지 않는다.
- candidate에는 R2 key와 작은 metadata만 저장한다.
- generation 원문이 너무 커지면 R2 JSON snapshot으로 분리하고 run payload에는 snapshot R2 key만 둔다.
- run payload가 1.5 MB를 넘으면 해당 캐릭터 run을 item별 record로 분리하는 fallback을 검토한다. 단, 기본 설계는 1 run row다.
