# 프로젝트 경로 변경 정합성 및 R2 자동 마이그레이션 점검 보고서

- 작성일: 2026-08-18
- 점검 범위: 프로젝트·캐릭터·상황 경로 변경 UI, Cloudflare Worker API, R2 객체 key, D1 메타데이터, 화면 캐시
- 대상 코드: `public/js/project/*`, `functions/[[path]].js`, `src/planner-compact.js`, `src/guest-api.js`, 관련 D1 migration

## 1. 보고 요약

현재 발견된 상황 경로 표시 문제의 주원인은 브라우저 또는 R2의 지연 캐시가 아니다. 상황 한 건에 `id`, `folderName`, `imageNumber`라는 서로 다른 경로성 값이 함께 존재하고, 경로 변경 기능이 이 값들을 일관되게 바꾸지 않기 때문에 발생한다.

특히 현재 화면은 실제 상황 경로인 `id` 또는 `folderName`이 아니라 `imageNumber.webp`를 경로처럼 표시한다. 경로를 숫자가 아닌 값으로 변경하면 `id`와 `folderName`만 바뀌고 `imageNumber`는 이전 값으로 남으므로 상황 목록과 상황 상세에 기존 파일명이 계속 나타난다. 숫자 경로로 변경한 경우에도 화면 값만 바뀔 뿐, 기존 R2 파일과 D1 참조는 이동하지 않아 이미지가 미생성 상태로 보이거나 과거 데이터가 고아 데이터로 남을 수 있다.

해결은 프런트엔드에서 메타 값을 먼저 수정하는 방식이 아니라, 서버에 원자적 관점의 경로 변경 전용 API를 추가하는 방식으로 진행해야 한다. 서버가 충돌 검사, 영향 범위 산정, R2 복사, D1 참조 변경, 검증, 원본 삭제를 순서대로 수행하고 성공 결과를 반환한 뒤에만 클라이언트 상태와 화면을 교체해야 한다.

권고 결론은 다음과 같다.

1. 상황의 불변 식별자와 변경 가능한 저장 경로를 분리한다.
2. 캐릭터 경로 변경은 기존 범용 `rename_folder`가 아니라 캐릭터 전용 마이그레이션 API로 승격한다.
3. 상황 경로 변경은 프로젝트 전체의 캐릭터 이미지 파일명, 플래너 데이터 및 각종 D1 참조를 일괄 변경하는 전용 API로 구현한다.
4. 변경 성공 후 관련 인메모리 상태와 폴더·플래너 캐시를 폐기하고 서버에서 강제 재조회한다.
5. R2에는 폴더 rename 연산이 없으므로 copy(`get` 후 `put`) + 검증 + delete 방식으로 처리하며, 중간 실패를 재시도할 수 있는 작업 상태를 기록한다.

## 2. 현재 구조와 확인 결과

### 2.1 상황 데이터와 화면 표시

| 항목 | 현재 동작 | 확인 위치 | 결과 |
|---|---|---|---|
| 상황 조회 | `project.situationsLoaded`가 참이면 서버 재조회 없이 메모리 배열 반환 | `public/js/project/shared.js:764-784` | 화면 이동만으로는 최신 서버 데이터를 다시 읽지 않을 수 있음 |
| 상황 저장 | `{project.prefix}_situations_meta.json`이라는 D1 JSON document에 전체 상황 배열 저장 | `public/js/project/shared.js:821-840` | 저장 자체는 `no-store`이나 별도 경로 마이그레이션은 없음 |
| 상황 목록 경로 표시 | `getSituationImageNumber(...).webp` 표시 | `public/js/project/situation.js:11-23` | `folderName`이 바뀌어도 `imageNumber`가 그대로면 과거 파일명 표시 |
| 상황 상세 경로 표시 | `imageNumber.webp` 표시 | `public/js/project/situation.js:251-265` | 목록과 동일한 문제 발생 |
| 상황 이미지 탐색 | 캐릭터 폴더에서 basename이 `imageNumber`와 같은 파일 검색 | `public/js/project/character.js:5-18` | 파일을 이동하지 않고 `imageNumber`만 바꾸면 기존 이미지 연결 단절 |
| 상황 경로 변경 | `id`, `folderName` 수정. 새 경로가 숫자일 때만 `imageNumber` 수정 | `public/js/project/situation.js:447-503` | 비숫자 경로 변경 시 기존 경로명이 계속 표시되는 직접 원인 |
| 상황 변경의 R2 처리 | 별칭 key만 이전 값에서 새 값으로 변경 | `public/js/project/situation.js:484-490` | 실제 이미지·임시 이미지·메타데이터는 이동하지 않음 |

따라서 제보된 현상은 다음 두 경우로 재현 가능하다.

- `1`에서 `scene-a`로 변경: `id/folderName = scene-a`, `imageNumber = 1`이 되어 목록과 상세는 계속 `1.webp`를 표시한다.
- `1`에서 `2`로 변경: 화면은 `2.webp`로 즉시 바뀌지만 실제 파일은 캐릭터별 폴더의 `1.webp`에 남아 있으므로 상세 진행률과 이미지 연결이 끊긴다.

### 2.2 캐시 여부 판단

상황 조회와 저장 요청에는 타임스탬프 query 및 `cache: 'no-store'`가 이미 사용된다. Cloudflare R2 Worker binding을 통한 write, delete, list는 강한 일관성을 제공하므로 Worker가 R2를 직접 조회하는 경로에서 과거 목록이 잠시 남는 현상을 기본 원인으로 보기 어렵다.

다만 애플리케이션 내부 캐시는 별도 문제다.

- `project.situationsLoaded`가 참이면 `loadProjectSituations()`는 네트워크 요청 없이 현재 배열을 반환한다.
- `window.FOLDER_DATA_CACHE`는 탐색기와 파일 목록을 보존한다.
- 플래너에는 별도의 메모리 캐시와 선택 상황 ID 상태가 있다.
- 현재 상황 경로 변경 성공 후에는 위 캐시를 포괄적으로 무효화하지 않는다.

정리하면, 최초 증상의 직접 원인은 `imageNumber` 불일치이며, 변경 후 다른 화면에서 혼합된 상태가 보이는 현상을 애플리케이션 캐시가 확대할 수 있다. CDN 캐시를 우선 원인으로 가정해 purge부터 적용하는 것은 적절하지 않다.

### 2.3 캐릭터 경로 변경

캐릭터 경로 변경은 현재 `renameProjectFolder(oldPrefix, newPrefix)`를 통해 서버의 범용 `rename_folder`를 호출한다. 서버는 R2의 이전 prefix 아래 객체를 모두 읽어 새 prefix에 쓰고, 완료 후 이전 key들을 삭제한다. 또한 일부 alias와 다음 D1 열을 갱신한다.

- `v2_projects.prefix`
- `v2_characters.prefix`
- `v2_assets.r2_key`
- `guest_posts.image_key`

따라서 기본 이미지 폴더 이동은 이미 구현되어 있다. 그러나 완전한 마이그레이션으로 보기에는 다음 참조가 누락되어 있다.

- `json_documents.object_key`의 캐릭터 메타 key
- `file_metadata.folder_prefix`
- `v2_assets.file_name` 등 key 파생 필드의 정합성 검증
- 플래너의 `character_prefix`, R2 후보·선택 이미지 key 및 관련 JSON 필드
- 이미지 편집기의 `source_key`, `output_key`, `preview_key`와 저장 문서 내부 참조
- 프로젝트 경로까지 변경하는 경우 `aliases.project_name` 및 프로젝트 하위 alias 전체

또한 R2 복사 완료 뒤 D1 batch가 실패하면 R2는 이미 새 경로로 이동되고 D1은 이전 경로를 가리킬 수 있다. 반대로 복사 도중 실패하면 새 prefix에 일부 사본이 남는다. 현재 API에는 작업 상태, 재시도, 롤백 또는 사후 정합성 검사가 없다.

### 2.4 상황 경로 변경의 영향 범위

현재 구조에서 상황 경로 또는 파일 식별 번호를 변경하면 최소한 다음 항목을 함께 처리해야 한다.

| 구분 | 현재 key 또는 참조 예시 | 필요한 처리 |
|---|---|---|
| 프로젝트 대표 상황 이미지 | `{projectPrefix}{imageNumber}.webp` | 정확히 이전 basename과 일치하는 객체를 새 basename으로 이동 |
| 캐릭터별 최종 이미지 | `{characterPrefix}{imageNumber}.{ext}` | 모든 캐릭터 폴더에서 대상 확장자 파일 일괄 이동 |
| 파일 메타데이터 | `file_metadata(folder_prefix, file_name)` | 각 이동 파일의 PK를 새 파일명으로 변경 |
| alias | 프로젝트 scope의 `target_key` | 이전 파일명 alias를 새 파일명으로 이동하고 충돌 검사 |
| legacy 플래너 임시 이미지 | `{projectPrefix}_planner_temp_image/{imageNumber}/...` | 이전 번호 prefix를 새 번호 prefix로 이동 |
| compact 플래너 임시 이미지 | `.../_planner_temp_image/{characterRef}/{situationRef}/...` | 이전 상황 참조 prefix를 새 참조 prefix로 이동 |
| 상황 원본 메타 | `json_documents(situations_meta)`의 배열 | 새 경로와 저장 참조를 한 번에 반영 |
| v2 상황/프롬프트 | `v2_situations.id/image_number`, `v2_prompt_sets.owner_id` | 기존 행을 단순 추가하지 말고 참조 관계와 함께 교체 |
| 플래너 정규화 데이터 | `planner_items.situation_id/image_number`, 이미지 key, 실행 중 ID JSON | 실행 상태에 따라 변경 또는 변경 거부 |
| v2 플래너 데이터 | `v2_planner_items.situation_id/image_number`, 관련 asset key | 의존 행과 함께 갱신 |
| 게스트 조회 | `v2_situations`를 image number와 id로 매핑 | 오래된 `v2_situations` 행 제거 및 새 매핑 보장 |
| 이미지 편집 문서 | 이동 대상 이미지를 가리키는 source/output key | 참조 갱신 또는 해당 문서를 명시적으로 만료 처리 |
| 브라우저 상태 | active situation, planner modal, 업로드 선택 localStorage | 이전 ID를 새 ID로 치환하거나 관련 캐시 폐기 |

현재 `putJsonDocument()`의 v2 mirror는 새 상황 ID를 upsert할 뿐, 기존 상황 ID의 행과 그 프롬프트를 삭제하지 않는다. 따라서 `oldId -> newId` 변경 후 `v2_situations`에 이전 행이 남아 게스트 페이지 등 D1 기반 조회에서 과거 상황명이 계속 노출될 가능성이 있다.

## 3. 해결 설계

### 3.1 데이터 모델 원칙

상황은 다음 세 개념을 명시적으로 분리해야 한다.

| 필드 | 성격 | 권고 규칙 |
|---|---|---|
| `id` | 불변 내부 식별자 | 생성 시 UUID 또는 안정 ID를 부여하며 경로 변경 시 수정하지 않음 |
| `path` 또는 `storageName` | 변경 가능한 저장 경로명 | 사용자가 “상황 경로 변경”으로 수정하는 값 |
| `name`/`alias` | 표시 이름 | 파일 경로와 무관하게 변경 가능 |

현재 `imageNumber`는 화면 번호, 파일 basename, 정렬 키의 역할을 동시에 수행한다. 단기적으로는 이를 `storageName`과 같은 의미의 문자열로 통일할 수 있으나, 장기적으로는 다음처럼 분리하는 편이 안전하다.

- `storageName`: 실제 파일 basename과 플래너 경로에 사용하는 값
- `sortOrder`: 목록 순서
- `displayNumber`: 번호 표시가 꼭 필요할 때만 사용하는 파생값

이렇게 하면 상황 경로를 `1`에서 `scene-a`로 바꾸더라도 실제 저장 key는 `scene-a.webp`로 일관되게 결정되며, 내부 관계는 불변 `id`를 계속 사용한다.

기존 데이터와의 호환 단계에서는 `path = folderName || id || String(imageNumber)`로 읽고, 저장 시 새 필드를 채우는 점진적 변환이 필요하다. 기존 `id`를 즉시 UUID로 모두 교체하면 플래너와 프롬프트 FK 영향이 커지므로 별도 D1 migration과 backfill 이후 적용해야 한다.

### 3.2 전용 서버 API

다음 두 API를 권고한다.

```text
POST /api/projects/:projectId/characters/:characterId/change-path
POST /api/projects/:projectId/situations/:situationId/change-path
```

요청에는 최소한 `oldPath`, `newPath`, 클라이언트가 읽은 `updatedAt` 또는 revision을 포함한다. 서버는 URL의 대상과 요청 본문을 교차 검증하고, 클라이언트가 보낸 R2 key 목록을 신뢰하지 말고 현재 D1/R2 상태에서 영향 범위를 직접 계산해야 한다.

응답은 변경된 엔터티 전체와 migration 결과를 반환한다.

```json
{
  "success": true,
  "entity": { "id": "stable-id", "path": "scene-a", "name": "표시 이름" },
  "migration": {
    "status": "completed",
    "movedObjects": 14,
    "updatedRows": 29,
    "warnings": []
  },
  "revision": "..."
}
```

### 3.3 공통 마이그레이션 절차

R2 object key는 디렉터리 엔트리가 아니라 문자열이므로 폴더 rename은 실제로 지원되지 않는다. 안전한 처리는 다음 순서로 구성한다.

1. 입력 정규화 및 예약 경로 검사
2. 진행 중 플래너 작업, 동일 목적지 key, D1 unique key 충돌 검사
3. 이동 대상 R2 객체와 D1 행의 manifest 생성
4. migration 작업 레코드 생성(`prepared`)
5. 모든 목적지 R2 key에 copy 수행
6. 목적지의 존재, 크기, 가능하면 ETag/checksum 검증
7. D1 트랜잭션 또는 batch로 모든 참조를 새 key로 갱신
8. 메타의 경로 값을 마지막에 변경하고 작업 상태를 `committed`로 기록
9. 원본 R2 key 일괄 삭제
10. 잔존 이전 참조와 누락 목적지를 재검사한 뒤 `completed` 기록

R2와 D1 사이에는 하나의 분산 트랜잭션이 없으므로 “새 객체 생성 후 검증, D1 전환, 이전 객체 삭제” 순서를 사용해야 한다. 삭제를 마지막으로 미루면 중간 실패 시 원본을 보존한 상태로 재시도할 수 있다.

작업 레코드는 다음 정도의 필드를 가진 `path_migrations` 테이블로 관리하는 것이 적절하다.

```text
id, entity_type, entity_id, project_id,
old_path, new_path, status,
manifest_json, copied_count, deleted_count,
error_json, created_at, updated_at, completed_at
```

동일 `entity_id`에 `prepared/copying/committed` 상태의 작업이 있으면 추가 변경을 거부한다. 같은 요청을 다시 보내면 기존 작업을 이어서 실행하도록 idempotency key도 저장한다.

### 3.4 캐릭터 경로 변경 처리

캐릭터는 기본적으로 `oldCharacterPrefix -> newCharacterPrefix`의 prefix 치환으로 처리한다. 단, R2 객체뿐 아니라 아래 D1 참조를 같은 작업에서 갱신해야 한다.

- 캐릭터 메타 document key 및 `v2_characters.prefix`
- `file_metadata.folder_prefix`
- `v2_assets.r2_key`와 파생 `file_name`
- 현재 사용하는 planner meta/run/item/image 참조
- 이미지 편집 문서의 source/output/preview 참조
- 해당 캐릭터 alias

프로젝트 경로 변경도 같은 공통 prefix migration 엔진을 사용하되 `aliases.project_name`, 프로젝트 문서 key, guest post와 모든 하위 캐릭터·플래너 참조까지 포함한다.

### 3.5 상황 경로 변경 처리

상황은 prefix 치환이 아니라 “프로젝트 전역의 정확한 basename 및 상황 참조 치환”으로 처리한다.

1. `oldStorageName`과 `newStorageName`을 확정한다.
2. 각 캐릭터 폴더에서 파일 basename이 `oldStorageName`과 정확히 같은 이미지 파일만 선택한다.
3. `.png`, `.jpg`, `.jpeg`, `.webp` 등 현재 허용 확장자를 유지한 채 basename만 바꾼다.
4. 프로젝트 루트 대표 이미지 및 양쪽 플래너 임시 경로를 별도로 탐색한다.
5. `file_metadata`, alias, asset key, planner item/image 참조를 같은 manifest에 넣는다.
6. 새 경로가 하나라도 기존 객체나 다른 상황과 충돌하면 복사를 시작하기 전에 전체 요청을 거부한다.
7. 실행 중인 플래너 작업이 해당 상황을 참조하면 변경을 거부하고 사용자가 작업을 종료한 후 재시도하게 한다. 실행 중 ID와 출력 key를 동시에 바꾸는 것은 race condition 위험이 크다.
8. R2 copy 검증 후 D1에서 상황 storage path 및 관련 참조를 한 번에 갱신한다.
9. 원본을 삭제하고 이전 basename 또는 이전 상황 ID 참조가 남았는지 감사 query를 수행한다.

파일 검색은 `key.includes(oldPath)`와 같은 부분 문자열 치환을 사용하면 안 된다. 반드시 폴더 경계와 basename을 파싱하여 정확히 일치하는 대상만 변경해야 한다. 예를 들어 `1`을 `2`로 변경할 때 `10.webp`, `scene-1.webp`, 메타 JSON 내부 일반 문장까지 잘못 바뀌어서는 안 된다.

### 3.6 클라이언트 갱신

경로 변경 UI는 로컬 객체를 먼저 수정하지 않고 서버 API가 성공한 후 응답 엔터티로 교체한다.

성공 후 다음 순서를 적용한다.

1. `project.situationsLoaded = false` 또는 `project.charactersLoaded = false`
2. `loadProjectSituations(project, true)` 및 필요한 파일 목록을 `force: true`로 재조회
3. 이전/새 프로젝트·캐릭터·플래너 prefix에 해당하는 `FOLDER_DATA_CACHE` 제거
4. planner meta memory cache와 modal 선택 ID 제거 또는 새 ID로 치환
5. 업로드/크래프트 선택 localStorage에 이전 상황 경로가 있으면 새 값으로 치환
6. 상세 route를 `replaceState`로 새 경로에 맞춤
7. 서버에서 다시 받은 엔터티로 목록 또는 상세를 재렌더링

실패 시에는 화면 상태를 변경하지 않는다. 현재처럼 로컬 객체를 먼저 수정한 후 일부만 되돌리는 방식은 저장은 성공했지만 alias 변경이 실패한 경우처럼 부분 성공을 정확히 복구하지 못한다.

## 4. 구현 단계

### 1단계: 즉시 표시 오류 수정

- 상황 카드와 상세의 “경로” 표시 기준을 하나의 helper로 통일한다.
- 경로 입력값이 실제 저장 basename을 뜻한다면 `imageNumber`를 숫자로 제한하지 말고 문자열 저장 경로로 갱신한다.
- 경로 변경 후 상황·캐릭터 파일·폴더·플래너 캐시를 강제 무효화하고 재조회한다.

이 단계만으로 화면 표시 문제는 완화되지만 기존 파일 마이그레이션은 해결되지 않으므로, 실제 운영에서는 2단계 API와 함께 배포하는 것이 안전하다.

### 2단계: 마이그레이션 기반 및 캐릭터 전용 API

- `path_migrations` D1 migration 추가
- 공통 R2 manifest/copy/verify/delete 유틸리티 구현
- 캐릭터 전용 change-path API 구현
- 기존 `rename_folder` 호출을 전용 API로 교체
- 누락된 D1 참조 갱신 및 사후 감사 추가

### 3단계: 상황 전용 API

- 영향 파일 탐색기 구현
- 상황 storage path 및 관련 R2/D1 참조 일괄 변경
- 실행 중 planner 차단 정책 구현
- 재시도 가능한 작업 상태와 관리자 오류 메시지 구현

### 4단계: 불변 ID 전환

- 상황에 불변 ID와 변경 가능한 `storageName/path` 추가
- 기존 데이터 backfill
- route, planner, prompt 관계를 불변 ID 기준으로 전환
- `imageNumber`의 다중 역할 제거
- 호환 기간 종료 후 구형 필드 정리

## 5. 검증 계획

프로젝트 규칙에 따라 로컬에서는 구문·정적 검사만 수행하고, 실제 동작 검증은 사용자가 변경을 commit/push한 뒤 Cloudflare 배포 서버에서 수행한다.

### 5.1 정적 검사

- 변경 JS 파일 `node --check`
- migration SQL의 테이블·인덱스·FK 참조 검토
- 이전 key를 갱신하는 모든 SQL에 프로젝트 및 엔터티 범위 조건이 있는지 검토
- 수정 텍스트 파일의 UTF-8 BOM 부재 확인

### 5.2 배포 서버 검증 시나리오

1. 이미지와 프롬프트가 있는 상황 `1`을 `scene-a`로 변경
2. 상황 목록과 상세에 `scene-a`가 즉시 표시되는지 확인
3. 모든 캐릭터의 기존 `1.*` 이미지가 `scene-a.*`로 이동했는지 확인
4. 이미지 공개 여부, custom metadata, D1 file metadata, alias가 보존되는지 확인
5. 플래너 후보·선택 이미지와 게스트 조회가 새 상황에 연결되는지 확인
6. 새로고침·재로그인·다른 브라우저에서도 이전 경로가 다시 나타나지 않는지 확인
7. 캐릭터 경로 변경 후 하위 이미지, 캐릭터 메타, 플래너, 이미지 편집 문서가 정상 조회되는지 확인
8. 목적지 충돌 시 아무 R2/D1 변경 없이 요청이 실패하는지 확인
9. copy 중 인위적 실패 후 원본이 보존되고 동일 요청 재시도로 완료되는지 확인
10. 실행 중 planner가 있는 상황의 경로 변경이 명확한 메시지와 함께 차단되는지 확인

### 5.3 사후 정합성 감사

마이그레이션 완료 조건은 API의 성공 응답만으로 판단하지 않고 다음을 모두 만족해야 한다.

- 목적지 R2 객체 수가 manifest와 일치
- 원본 R2 key가 존재하지 않음
- `file_metadata`에 이전 PK가 없음
- 현재 사용 중인 planner 및 v2 테이블에 이전 상황 ID·image number·R2 key 참조가 없음
- `json_documents`의 현재 상황 배열에 이전 storage path가 없음
- `v2_situations`에 동일 프로젝트의 구 경로 고아 행이 없음
- alias가 새 target key에서 조회됨

## 6. 위험 및 운영 정책

| 위험 | 대응 |
|---|---|
| 대량 캐릭터/파일로 Worker 실행 시간이 길어짐 | manifest를 페이지 단위로 처리하고 작업 레코드 기반 재개 지원. 규모가 커지면 Cloudflare Workflow 또는 Queue로 비동기화 |
| R2 copy와 D1 갱신 사이 실패 | 원본 삭제를 마지막으로 미루고 단계 상태 및 idempotency key 저장 |
| 목적지 파일 덮어쓰기 | 사전 `head/list`와 D1 unique 충돌 검사 후 하나라도 존재하면 전체 거부 |
| 동시 업로드·생성 | 대상 엔터티 migration lock 및 실행 중 planner 변경 차단 |
| CDN에 기존 이미지가 남음 | key가 변경되므로 새 URL 사용. 이전 URL의 즉시 제거가 운영상 필요하면 별도 cache purge 검토 |
| 구형 v2/v3/legacy 테이블 범위 불명확 | 실제 배포 DB에서 사용 중 테이블과 잔존 행을 감사한 뒤 migration 대상 확정. retired 테이블은 무조건 갱신하지 않고 삭제 계획과 연계 |

## 7. 최종 판단

제보된 상황 목록·상세의 기존 경로명 노출은 캐시가 아니라 `folderName/id`와 `imageNumber`가 분리된 상태에서 화면이 후자를 표시하는 로직 문제로 판단된다. 동시에 현재 상황 경로 변경은 저장 메타와 alias만 바꾸므로 R2 및 D1 전체 정합성을 보장하지 못한다.

캐릭터 경로 변경은 현재 구현을 재사용할 수 있지만, 범용 폴더 이동 API에 누락된 D1·플래너·이미지 편집 참조를 보강해야 한다. 상황 경로 변경은 별도 전용 마이그레이션이 반드시 필요하며, 정확한 basename 매칭, 목적지 충돌 검사, R2 copy 검증, D1 참조 전환, 원본 삭제, 사후 감사의 순서로 구현해야 한다.

따라서 권장 구현 단위는 “화면 캐시 보정”이 아니라 “서버 권위의 경로 변경 트랜잭션 + 클라이언트 강제 재조회”이다. 이 구조를 적용하면 즉시 표시 문제와 하위 파일 자동 마이그레이션 문제를 같은 원인 체계 안에서 해결할 수 있다.

## 8. 참고 자료

- Cloudflare R2 Workers API: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- Cloudflare R2 consistency model: https://developers.cloudflare.com/r2/reference/consistency/

