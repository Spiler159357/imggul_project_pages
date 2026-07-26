# 플래너 재생성 이미지 재사용·교체 오류 수정 계획

## 1. 목적

이미 최종 선택까지 완료한 상황에 대해 같은 캐릭터·상황의 플랜을 다시 만들고 이미지를 생성할 때 다음 문제가 발생한다.

1. 이전에 선택했던 이미지 슬롯에서는 새 이미지를 생성하지 않고 이전 임시 이미지를 다시 결과로 사용한다.
2. 새로 생성된 다른 이미지를 선택해도 기존 최종 이미지를 새 이미지로 교체할 수 없다.

이번 수정의 목표는 Queue 재전달과 API 재시도에 대한 멱등성은 유지하면서, 사용자가 명시적으로 시작한 다음 생성 시도는 이전 생성·확정 작업과 다른 작업으로 인식하게 만드는 것이다.

## 2. 현재 작동 구조

### 2.1 플랜과 후보 이미지 ID

`src/planner-compact.js`는 프로젝트·캐릭터·상황으로 `itemId`를 만들고, `itemId`·variant·variant 내부 index로 후보 `assetId`를 만든다.

```text
itemId  = pitem:{project}:{character}:{situation}
assetId = passet:{itemId}:{variantId}:{variantImageIndex}
```

같은 프로젝트·캐릭터·상황·variant·index로 플랜을 다시 만들면 이전과 완전히 같은 `itemId`와 `assetId`가 만들어진다.

R2 후보 이미지 경로도 다음 값만 사용한다.

```text
{projectPrefix}/_planner_temp_image/
  {character}/{situation}/{variant}/{variantImageIndex}.webp
```

따라서 생성 시도가 달라도 같은 슬롯은 같은 R2 key를 사용한다.

### 2.2 백그라운드 생성

백그라운드 Worker는 생성 전에 해당 R2 key가 존재하는지 `head()`로 확인한다.

- R2 object가 없으면 NovelAI를 호출하고 새 이미지를 저장한다.
- R2 object가 있으면 NovelAI를 호출하지 않고 기존 object를 현재 슬롯의 결과로 commit한다.

이 검사는 같은 Queue 메시지가 재전달되거나, R2 저장 후 D1 commit 전에 재시도되는 경우 중복 생성을 막기 위한 장치다.

### 2.3 최종 선택 완료

최종 선택 완료 시 서버는 `confirm:{itemId}`를 멱등 key로 사용한다.

- 후보 이미지를 최종 경로 `{characterPrefix}{imageNumber}.webp`로 복사한다.
- `file_metadata`를 upsert한다.
- 완료된 플래너 item을 run에서 제거한다.
- 선택하지 않은 후보 R2 object만 삭제한다.
- 선택한 후보 R2 object는 삭제하지 않는다.

같은 `itemId`의 confirm record가 이미 `completed`이면 서버는 이를 이전 요청의 재시도로 간주한다.

## 3. 정확한 문제 발생 지점

### 3.1 이전 선택 이미지가 새 생성 결과에 다시 나타나는 직접 원인

직접 원인은 다음 세 조건의 조합이다.

1. `src/planner-compact.js`의 `makePlannerCompactAssetId()`가 생성 시도를 구분하지 않는다.
2. `src/planner-compact.js`의 `makePlannerCompactR2Key()`가 생성 시도를 구분하지 않는다.
3. `src/planner-background.js`의 `processPlannerCompactQueueMessage()`가 동일 R2 key의 object가 있으면 새 이미지 생성을 생략한다.

이전 확정 처리에서는 선택하지 않은 후보만 삭제하고 선택한 후보는 남긴다. 이후 같은 상황의 플랜을 다시 만들면 이전 선택 슬롯의 R2 key만 남아 있으므로, Worker가 그 슬롯만 기존 object로 재사용한다. 다른 슬롯은 이전 확정 때 삭제되었으므로 새로 생성된다.

이 동작은 사용자 증상의 “선택한 이미지의 index에 해당하는 부분만 기존 이미지가 그대로 결과로 제시됨”과 정확히 일치한다.

`clearExisting`만으로는 이 경로를 해결할 수 없다.

- `startPlannerCompactGeneration()`의 `clearExisting`은 run payload의 `item.candidates`만 비운다.
- 새 플랜에는 이전에 확정된 item의 candidate 정보가 없으므로 이전 선택 이미지 R2 key를 정리할 수 없다.
- R2 object 자체가 남아 있으면 Worker의 `head()` 재사용 조건은 계속 성립한다.

### 3.2 새 이미지로 기존 최종 이미지를 교체하지 못하는 직접 원인

직접 원인은 `src/planner-compact.js`의 confirm 멱등 범위다.

```text
confirmKey = confirm:{itemId}
operationId = pcfm:{itemId}
```

`itemId`는 같은 프로젝트·캐릭터·상황에서 항상 같으므로, 새 플랜의 확정 요청도 이전 플랜의 확정 요청과 같은 작업으로 취급된다.

- 새로 선택한 후보의 `assetId`가 이전과 다르면 `PLANNER_CONFIRM_CONFLICT`가 발생한다.
- 이전과 같은 index여서 `assetId`까지 같으면 서버는 이미 완료된 이전 confirm 결과를 그대로 반환한다.
- 따라서 최종 R2 경로를 새 이미지로 다시 `put()`하는 정상 교체 단계까지 진행하지 못한다.

`expires_at`은 현재 confirm record에 저장만 되며, `getPlannerCompactRecord()`는 만료 여부를 확인하지 않는다. 만료 record를 제거하는 compact cleanup 경로도 현재 코드에 없으므로 24시간이 지나면 자동으로 문제가 해소되는 구조도 아니다.

### 3.3 프론트엔드의 기존 후보 승계

`public/js/project/planner.js`의 플랜 저장 로직도 기존 item을 다시 편집할 때 아래 값을 그대로 승계한다.

```text
images
selectedImage
selectedAssetId
```

이는 단순한 플랜 문구 수정 시 기존 결과를 보존하려는 동작이지만, 생성 조건을 바꾼 뒤 새 결과를 만들려는 상황과 구분되지 않는다. 서버 문제의 직접 원인은 아니지만, “플랜 수정”과 “새 생성 시도”의 상태 경계가 불명확해지는 보조 원인이다.

## 4. 해결 원칙

### 4.1 논리 item과 생성 시도를 분리한다

`itemId`는 프로젝트·캐릭터·상황을 나타내는 안정적인 ID로 유지한다.

별도 카운터 row나 독립 카운터 필드를 만들지 않고, 기존 optimistic locking에 사용하는 run record의 `revision`을 생성 세대로 재사용한다. 서버는 실제 새 생성 작업을 시작하는 UPDATE가 성공한 뒤의 revision, 즉 mutation 시점의 `current.revision + 1`을 `activeJob.generationSequence`에 저장한다. 한 번 시작한 작업의 Queue 재시도에서는 같은 값을 계속 사용하고, 사용자가 새 생성을 시작할 때만 다음 run revision으로 진행한다.

```text
itemId             = 상황의 논리 ID
generationSequence = 생성 시작 UPDATE가 만든 run revision
slotId             = item + variant + index의 논리 슬롯
assetId            = slot + generationSequence의 후보 이미지 ID
```

`generationSequence`는 UUID·시간·난수에서 만들지 않는다. 이미 존재하는 run row의 optimistic revision에서 파생하므로 deterministic primary key 방침과 영속 ID 난수 금지 조건을 지키며, 별도 counter write도 필요 없다.

마지막 item을 확정할 때 run row를 DELETE하지 않고, item 배열을 비운 작은 tombstone payload로 UPDATE한다. D1 row의 revision 자체가 남기 때문에 다음 플랜에서도 generation sequence가 다시 초기화되지 않는다. 기존 마지막 confirm의 DELETE 1회를 UPDATE 1회로 바꾸는 것이므로 rows written 수는 증가하지 않는다.

### 4.2 R2 후보 경로를 생성 시도별로 분리한다

후보 R2 key에 `generationSequence`를 포함한다.

```text
변경 전:
.../{character}/{situation}/{variant}/{index}.webp

변경 후:
.../{character}/{situation}/{generationSequence}/{variant}/{index}.webp
```

같은 생성 시도의 Queue 재시도는 같은 key를 사용하므로 기존 `head()` 기반 복구를 유지할 수 있다. 새 생성 시도는 다른 key를 사용하므로 과거 object를 새 결과로 오인하지 않는다.

### 4.3 confirm row 수는 유지하고 작업 세대만 교체한다

D1 row 증가를 피하기 위해 confirm record key는 `confirm:{itemId}`로 유지한다. 대신 payload에 `generationSequence`를 저장하고 다음 규칙을 적용한다.

- 같은 `generationSequence` + 같은 `assetId`의 재호출: 기존 completed 결과 반환
- 같은 `generationSequence` + 다른 `assetId`: 동일 작업 내부 충돌로 409
- 더 낮은 `generationSequence`의 completed/failed record: 현재 run의 candidate가 유효한지 확인한 뒤 같은 confirm row를 새 pending payload로 갱신
- 다른 generation의 pending confirm: 무조건 덮지 말고 현재 run 및 target을 확인해 충돌 처리

`operationId`도 `itemId`만이 아니라 `itemId + generationSequence`로 계산한다.

이 구조는 item당 confirm row 1개라는 compact 설계를 유지하면서 새 생성 결과의 최종 파일 덮어쓰기를 허용한다.

### 4.4 확정 완료 후 모든 후보 object를 정리한다

플래너 후보는 최종 이미지와 metadata를 목적지에 이주하기 위한 임시 자산이다. 최종 선택이 완료된 뒤에는 선택 후보도 더 이상 원본이나 복구본으로 취급하지 않는다.

confirm의 정상 순서는 다음으로 고정한다.

```text
1. 선택 candidate와 현재 generation 검증
2. confirm pending 기록
3. 선택 후보 binary를 최종 R2 key에 put/overwrite
4. 선택 후보의 metadata를 최종 file_metadata에 upsert
5. confirm completed 기록
6. run에서 item 제거 또는 빈 tombstone으로 전환
7. 선택 후보를 포함한 해당 item의 모든 임시 후보 R2 object 삭제
```

1~4 중 하나라도 실패하면 binary 또는 metadata 이주가 완료되지 않은 상태이므로 모든 후보를 유지하고 같은 confirm operation으로 재시도한다. 5~6까지 완료되면 최종 binary와 metadata 및 D1 상태가 목적지에 확정됐으므로 후보를 재시도 원본으로 보관할 이유가 없다.

7의 삭제 대상은 다음과 같다.

- 선택한 candidate의 R2 key
- 선택하지 않은 모든 candidate의 R2 key
- 같은 item과 generation에 속하지만 D1 candidate 배열에서 누락된 object가 확인되는 경우 해당 generation prefix의 orphan object

삭제 실패는 이미 완료된 최종 확정을 rollback하지 않는다. 실패 key를 응답과 Worker log에 남기고, D1 cleanup row를 만들지 않는 R2 직접 재시도 또는 저빈도 prefix cleanup으로 정리한다. 즉 모든 후보 삭제는 confirm 완료 수명주기의 필수 후처리지만, R2 일시 오류가 최종 이미지와 metadata의 성공 상태를 무효화하지는 않는다.

## 5. 코드 변경 계획

### Phase 1. 생성 sequence 도입

대상: `src/planner-compact.js`

1. 별도 run-level counter 필드는 추가하지 않는다.
2. 새 job을 만드는 mutation에서 `current.revision + 1`을 `activeJob.generationSequence`에 저장하고, 동일 mutation의 optimistic UPDATE가 실제로 그 revision을 만들게 한다.
3. `jobId`가 생성 시도를 포함하도록 변경해 이전 Queue 메시지를 새 작업 메시지로 오인하지 않게 한다.
4. Queue/browser slot 응답과 상태 응답에 `generationSequence`를 포함한다.
5. pause/resume 및 동일 job 재시도에서는 기존 sequence를 유지한다.
6. 마지막 item 확정 시 run row를 삭제하는 대신 items가 빈 tombstone payload로 한 번 UPDATE한다.

주의:

- sequence는 `startPlannerCompactGeneration()`의 기존 UPDATE가 생성하는 revision에서 파생한다. sequence만을 위한 별도 D1 read/write를 만들지 않는다.
- 이미 active인 job에 start 요청이 중복 도착한 경우 sequence를 증가시키지 않는다.
- run save/normalize는 tombstone row 자체와 그 D1 revision을 보존하며, 이를 위해 별도 confirm 조회나 신규 row를 만들지 않는다.
- browser와 background가 동일한 sequence 규칙을 사용해야 한다.

### Phase 2. 후보 ID와 R2 key의 범위 수정

대상: `src/planner-compact.js`, `src/planner-background.js`

1. `makePlannerCompactAssetId()` 입력에 `generationSequence`를 추가한다.
2. `enumerateRunSlots()`가 현재 active job의 sequence로 asset ID를 계산하게 한다.
3. `makePlannerCompactR2Key()`에 sequence 경로 segment를 추가한다.
4. Queue 메시지와 browser complete 검증에서 sequence가 일치하는지 확인한다.
5. Worker의 R2 `head()` 재사용은 “같은 sequence의 동일 key”에 대해서만 유지한다.
6. object custom metadata에도 `generationSequence`와 `assetId`를 저장하고, 기존 object를 재사용할 때 metadata 일치 여부를 검사한다.

custom metadata가 현재 slot과 다르면 기존 object를 성공 결과로 commit하지 말고 새 이미지를 생성해 overwrite한다.

### Phase 3. 후보 정규화와 저장 계약 수정

대상: `src/planner-compact.js`, `public/js/project/planner.js`

1. candidate payload에 `generationSequence`를 추가한다.
2. `normalizeRunItems()`가 현재 generation의 candidate만 허용하도록 필터 조건을 보강한다.
3. `plannerCompactRunToClient()`가 `generatedImages`에 sequence를 전달한다.
4. 프론트엔드의 선택 상태는 계속 `selectedAssetId`를 기준으로 저장하되, candidate의 sequence도 보존한다.
5. 상태 poll 병합은 새 sequence의 후보와 과거 후보를 합치지 않도록 한다.

현재 `mergePlannerGeneratedImages()`는 `id/key/r2Key`만으로 합친다. 새 sequence가 시작되면 대상 item의 로컬 후보 목록을 먼저 비우거나, sequence가 다른 current 후보를 폐기한 후 incoming 후보만 반영해야 한다.

### Phase 4. confirm 멱등성 범위 수정

대상: `src/planner-compact.js`, `public/js/project/planner.js`

1. confirm request에 `generationSequence`를 포함한다.
2. 서버는 request 값을 그대로 신뢰하지 않고 run의 selected candidate에 기록된 sequence와 대조한다.
3. confirm payload와 `operationId`에 sequence를 기록한다.
4. 같은 sequence의 재시도와 더 높은 sequence의 교체 요청을 구분한다.
5. 더 높은 sequence이면 기존 completed confirm row를 pending으로 갱신한 뒤 기존 최종 R2 key에 새 이미지를 `put()`한다.
6. metadata도 현재 선택 이미지 기준으로 upsert한다.
7. confirm completed 기록과 run item 정리까지 성공한 후, 선택 여부와 관계없이 현재 item/generation의 모든 후보 object를 삭제한다.
8. cleanup 대상 key는 run item 제거 전에 메모리에 snapshot하여, D1 item 정리 후에도 선택 후보를 포함한 전체 목록을 삭제할 수 있게 한다.
9. cleanup 결과에 `scanned`, `deletedCount`, `failedCount`, `failedKeys`를 포함하되 이를 위한 D1 write는 추가하지 않는다.

최종 R2 key는 기존처럼 `{characterPrefix}{imageNumber}.webp`를 유지한다. R2 `put()`은 overwrite를 지원하므로 confirm gate만 정상적으로 통과하면 실제 파일 교체가 가능하다.

### Phase 5. 프론트엔드 플랜 상태 의미 정리

대상: `public/js/project/planner.js`

1. 단순 플랜 편집과 명시적 재생성을 구분한다.
2. 기존 후보가 있는 item에서 생성 관련 설정 또는 variant 구조가 변경되면 후보를 그대로 유효 결과로 간주하지 않는다.
3. “다시 생성”은 대상 item의 선택 상태와 후보 표시를 즉시 초기화하고 새 sequence 시작 결과를 기다린다.
4. 새 플랜 생성 시 과거 confirm 상태를 프론트엔드에서 승계하지 않는다.
5. 저장된 최종 이미지의 존재 여부는 플래너 후보 존재 여부와 별개로 취급한다. 최종 파일이 있어도 새 플랜 생성과 후보 선택을 막지 않는다.

## 6. D1 row 사용량 예산

이 설계는 새로운 table, record type, candidate row, generation row, cleanup queue row를 만들지 않는다. 기존 D1 `revision`을 재사용하고 active job/candidate에 그 숫자를 기록하므로 row 크기만 소폭 증가하고 row count에는 영향을 주지 않는다.

| 작업 | 현재 rows written | 변경 후 목표 | 근거 |
| --- | ---: | ---: | --- |
| 플랜 최초 저장 | 1 | 1 | 동일 run row INSERT |
| 플랜 재저장 | 1 | 1 | 동일 run row UPDATE |
| 생성 시작 | 1 | 1 | 기존 activeJob UPDATE 안에서 sequence도 함께 증가 |
| 이미지 성공 1장 | 1 | 1 | candidate를 기존 run JSON에 반영 |
| 이미지 최종 실패 1장 | 1 | 1 | failed slot을 기존 run JSON에 반영 |
| status 조회 | 0 | 0 | primary key read만 수행 |
| 후보 선택 | 0 | 0 | client-only 상태 유지 |
| pause/resume/cancel | 1 | 1 | 기존 run UPDATE |
| confirm | 4 | 4 이하 | 기존 confirm row 재사용, metadata 1회, run 1회 |
| 마지막 item confirm | 4 | 4 이하 | run DELETE 1회를 tombstone UPDATE 1회로 대체 |
| 동일 confirm 재호출 | 0 | 0 | 같은 sequence와 asset이면 기존 결과 반환 |
| 임시 후보 cleanup | 0 | 0 | R2 직접 삭제 |

금지할 구현은 다음과 같다.

- 생성 시도마다 새 D1 row를 INSERT하는 방식
- confirm key에 sequence를 넣어 confirm row를 누적하는 방식
- sequence 증가만을 위한 별도 run UPDATE
- sequence를 찾기 위해 item별 confirm record를 추가 조회하는 방식
- 후보별 cleanup queue row 또는 event log row 생성
- sequence 조회용 보조 index 추가
- UUID, 현재 시간, 난수를 영속 ID에 포함하는 방식

빈 tombstone run은 프로젝트+캐릭터당 기존 최대 1개라는 cardinality를 유지한다. 플래너가 없는 시점에도 작은 run row가 남는 만큼 저장 공간과 해당 key 조회 시 최대 1 row read가 유지되는 trade-off는 있다. 대신 추가 table/index/counter/write 없이 기존 D1 revision만으로 다음 생성 번호를 보존하며, 마지막 confirm도 DELETE 대신 UPDATE이므로 write 예산은 동일하다.

## 7. 호환성과 정리 전략

### 7.1 기존 run/candidate

- sequence가 없는 기존 active run은 배포 시점에 계속 resume하지 않고, 사용자에게 재시작이 필요하다는 상태로 전환하는 편이 안전하다.
- 완료·실패·취소된 기존 run은 저장된 sequence를 0으로 간주하고 새 생성 시작 UPDATE에서 1로 증가시킨다.
- sequence가 없는 기존 candidate는 새 sequence candidate로 승계하지 않는다.

### 7.2 기존 confirm record

- 기존 confirm payload에는 generation sequence가 없다.
- 새 confirm 요청에서는 이를 legacy completed generation으로 간주한다.
- 현재 run의 candidate가 더 높은 sequence를 가지고 있으면 같은 confirm row를 새 operation으로 갱신할 수 있게 한다.

### 7.3 기존 임시 R2 object

- 새 경로는 sequence segment를 포함하므로 기존 경로 object와 충돌하지 않는다.
- 기존 `_planner_temp_image` object는 별도 저빈도 cleanup 또는 관리자 정리 경로로 제거한다.
- 새 confirm 정상 경로부터는 선택 후보까지 삭제해 같은 누적 문제가 반복되지 않게 한다.

## 8. 검증 계획

프로젝트 규칙에 따라 로컬에서는 syntax/static check만 수행하고 실제 동작은 Cloudflare 배포 후 확인한다.

### 8.1 정적 검증

1. `node --check src/planner-compact.js`
2. `node --check src/planner-background.js`
3. `node --check public/js/project/planner.js`
4. Queue message, browser slot, candidate, confirm payload의 generation sequence 전달 누락 검색
5. 변경 파일 UTF-8 BOM 부재 확인

### 8.2 Cloudflare 배포 후 필수 시나리오

1. 같은 플랜 start 요청 중복 호출 시 job/sequence가 새로 생기지 않는다.
2. 같은 Queue 메시지 재전달 시 NovelAI 중복 호출과 candidate 중복이 없다.
3. 최초 생성 후 한 후보를 선택·확정한다.
4. 같은 캐릭터·상황의 플랜을 다시 만든다.
5. 이전 선택 index를 포함해 모든 슬롯에서 새 sequence 경로가 사용된다.
6. 이전 선택 이미지가 새 결과에 재등장하지 않는다.
7. 새 후보를 선택·확정하면 기존 `{imageNumber}.webp`가 실제로 교체된다.
8. 교체 후 metadata도 새 후보의 값으로 갱신된다.
9. 같은 새 confirm 요청을 다시 보내면 write 없이 같은 성공 결과를 반환한다.
10. 확정 후 해당 sequence의 선택·미선택 후보가 모두 임시 R2 경로에서 정리된다.
11. browser 생성과 background 생성에서 결과가 동일하다.
12. pause/resume 시 sequence가 유지되고, cancel 후 새 시작에서는 sequence가 1 증가한다.
13. 최종 R2 put 전에 실패하면 선택·미선택 후보가 모두 유지되고 confirm 재시도가 가능하다.
14. metadata upsert가 실패하면 후보가 유지되고, 재시도 시 최종 binary overwrite와 metadata 저장을 다시 수행한다.
15. confirm completed와 run item 정리 후 후보 삭제가 일부 실패해도 최종 이미지와 metadata는 완료 상태를 유지하며 failed key만 후속 R2 cleanup 대상으로 남는다.
16. confirm 응답 유실 후 같은 요청을 다시 보내도 삭제된 선택 후보를 다시 요구하지 않고 completed 결과를 반환한다.

## 9. 완료 기준

다음 조건을 모두 만족하면 수정 완료로 본다.

- 동일 상황을 여러 번 생성해도 각 사용자 생성 시도는 서로 다른 후보 이미지 집합을 가진다.
- Queue/API 재시도는 같은 생성 시도 안에서 계속 멱등하다.
- 이전에 최종 이미지가 있어도 새 후보 선택으로 동일 최종 경로를 정상 overwrite할 수 있다.
- item당 compact confirm row 수는 1개를 유지한다.
- 최종 binary와 metadata 이주가 완료된 item은 선택 후보를 포함한 모든 임시 후보를 삭제한다.
- 이주 완료 전 오류에서는 후보를 보존하고, 이주 완료 후 cleanup 오류에서는 최종 확정을 rollback하지 않는다.
- 기존 최종 이미지 경로와 `file_metadata` 계약은 변경하지 않는다.
