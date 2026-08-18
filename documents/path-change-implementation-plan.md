# 캐릭터·상황 경로 변경 정합성 및 R2 자동 마이그레이션 구현 계획

- 작성일: 2026-08-18
- 기준 문서: `documents/path-change-consistency-and-r2-migration-report.md`
- 라인 번호 기준: 2026-08-18 현재 작업 트리. 실제 수정이 시작되면 앞선 삽입으로 후속 라인 번호가 이동할 수 있으므로 함수명과 코드 anchor를 함께 사용한다.
- 구현 범위: 캐릭터 경로 변경, 상황 저장 경로 변경, R2/D1/플래너 참조 마이그레이션, 화면 즉시 갱신
- 제외 범위: 프로젝트 경로 변경의 전용 API 전환. 공통 엔진은 재사용 가능하게 만들되 이번 완료 조건에는 포함하지 않는다.

## 1. 구현 결정

### 1.1 상황 식별자와 저장 경로 분리

상황은 다음 규칙으로 변경한다.

```js
{
    id: '불변 내부 ID',
    storageName: '사용자가 변경하는 실제 파일 basename',
    folderName: 'storageName 호환 mirror',
    imageNumber: 'storageName 호환 mirror',
    name: '표시 이름',
    alias: '표시 별칭'
}
```

- `id`는 경로 변경 시 수정하지 않는다.
- `storageName`을 `{characterPrefix}{storageName}.webp`의 기준값으로 사용한다.
- 기존 코드 호환 기간에는 `folderName`과 `imageNumber`도 `storageName`과 같은 문자열로 저장한다.
- 신규 상황은 `crypto.randomUUID()`를 `id`로 사용한다.
- 기존 상황은 현재 `id`를 불변 ID로 승격한다. 별도 일괄 UUID 교체는 하지 않는다.

이 결정으로 상황 경로 변경 시 플래너의 `situationId`, item ID, route ID는 유지하고, 실제 파일명과 `imageNumber`만 마이그레이션할 수 있다.

### 1.2 서버 권위 변경

클라이언트의 `saveProjectSituations()`와 `renameProjectFolder()` 조합으로 경로를 변경하지 않는다. 다음 서버 API가 경로 변경 전체를 소유한다.

```text
POST /api/path-migrations/character
POST /api/path-migrations/situation
GET  /api/path-migrations/:migrationId
```

캐릭터 요청:

```json
{
  "projectId": "project-id",
  "projectPrefix": "project/",
  "characterId": "old-character-prefix",
  "oldPrefix": "project/old/",
  "newPrefix": "project/new/",
  "idempotencyKey": "uuid"
}
```

상황 요청:

```json
{
  "projectId": "project-id",
  "projectPrefix": "project/",
  "situationId": "stable-id",
  "oldStorageName": "1",
  "newStorageName": "scene-a",
  "expectedDocumentUpdatedAt": "2026-08-18T...",
  "idempotencyKey": "uuid"
}
```

API는 `409`를 목적지 충돌·실행 중 플래너·revision 충돌에 사용하고, 응답에 기계 판독 가능한 `code`를 포함한다.

## 2. 신규 파일

### 2.1 `migrations/0020_path_migrations.sql` 신규 추가 — 1행부터

다음 D1 schema를 추가한다.

```sql
ALTER TABLE v2_situations ADD COLUMN storage_name TEXT;

UPDATE v2_situations
SET storage_name = image_number
WHERE storage_name IS NULL OR storage_name = '';

CREATE INDEX IF NOT EXISTS idx_v2_situations_project_storage
    ON v2_situations(project_id, storage_name);

CREATE TABLE IF NOT EXISTS path_migrations (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('character', 'situation')),
    entity_key TEXT NOT NULL,
    project_id TEXT NOT NULL,
    old_path TEXT NOT NULL,
    new_path TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('prepared', 'copying', 'committed', 'cleaning', 'completed', 'failed')
    ),
    manifest_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(manifest_json)),
    copied_count INTEGER NOT NULL DEFAULT 0,
    deleted_count INTEGER NOT NULL DEFAULT 0,
    error_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(error_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_path_migrations_active_entity
    ON path_migrations(entity_type, entity_key)
    WHERE status IN ('prepared', 'copying', 'committed', 'cleaning');
```

구현 전에 배포 D1에서 아래 audit query를 실행하여 같은 프로젝트의 `image_number` 중복을 확인한다. 중복이 존재할 수 있으므로 첫 배포에서는 `(project_id, storage_name)`을 unique index로 만들지 않고 일반 index로 만든다. API preflight가 충돌을 차단하며, 데이터 정리 후 별도 migration에서 unique로 강화한다.

### 2.2 `src/path-migration.js` 신규 추가 — 1행부터

이 파일에 R2와 D1을 함께 조정하는 공통 엔진을 둔다. `functions/[[path]].js`에 대규모 로직을 추가하지 않는다.

추가할 상수와 함수는 다음과 같다.

```js
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const ACTIVE_MIGRATION_STATUSES = new Set(['prepared', 'copying', 'committed', 'cleaning']);

function pathMigrationError(code, status, message, details = {})
function normalizePathSegment(value)
function normalizePrefix(value)
function splitObjectKey(key)
function replaceExactBasename(key, oldName, newName)
async function listAllR2Objects(bucket, options)
async function assertNoDestinationObjects(bucket, manifest)
async function copyManifestObjects(bucket, manifest, onProgress)
async function verifyManifestObjects(bucket, manifest)
async function deleteManifestSources(bucket, manifest, onProgress)
async function createOrResumeMigration(env, input)
async function markMigration(env, id, patch)
async function buildCharacterManifest(env, input)
async function buildSituationManifest(env, input)
async function commitCharacterD1(env, migration, input)
async function commitSituationD1(env, migration, input)
async function auditCompletedMigration(env, migration, input)
export async function changeCharacterPath(env, input)
export async function changeSituationPath(env, input)
export async function getPathMigration(env, migrationId)
```

#### `listAllR2Objects()`

- `bucket.list({ prefix, cursor, include: ['httpMetadata', 'customMetadata'] })`를 사용한다.
- 객체 수로 종료를 판단하지 않고 `truncated`와 `cursor`로 pagination한다.
- 한 페이지가 1,000개보다 적어도 `truncated === true`이면 계속 조회한다.

#### `copyManifestObjects()`

각 manifest 항목은 다음 구조를 갖는다.

```js
{
    sourceKey,
    targetKey,
    size,
    etag,
    kind: 'character-prefix' | 'situation-image' | 'planner-temp'
}
```

복사 코드는 다음 속성을 보존한다.

```js
const source = await env.imgBucket.get(entry.sourceKey);
await env.imgBucket.put(entry.targetKey, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: source.customMetadata,
    storageClass: source.storageClass
});
```

복사 후 `head(targetKey)`의 `size`를 원본과 비교한다. 목적지 key가 이미 존재하면 동일 migration이 먼저 복사한 동일 size/etag 대상인 경우에만 재시도 대상으로 인정하고, 그 외에는 `PATH_DESTINATION_EXISTS`로 중단한다.

#### `buildCharacterManifest()`

다음 두 prefix를 manifest에 포함한다.

1. 실제 캐릭터 폴더: `oldPrefix -> newPrefix`
2. compact planner 임시 폴더: `safePlannerRef(oldCharacterId) -> safePlannerRef(newCharacterId)`에 해당하는 `_planner_temp_image` 하위 prefix

두 번째 항목은 `src/planner-compact.js`의 `safePlannerRef()`를 import하여 계산한다. 캐릭터 ID가 현재 prefix 기반이므로 R2 후보 경로와 compact record key까지 함께 마이그레이션해야 한다.

#### `buildSituationManifest()`

- 프로젝트의 캐릭터 목록은 D1 `v2_characters.prefix`와 R2의 프로젝트 바로 아래 delimiter listing을 합쳐 구한다.
- 각 캐릭터 prefix 및 프로젝트 root에서 파일명을 분리하고, 확장자를 제외한 basename이 `oldStorageName`과 정확히 같은 이미지만 선택한다.
- `1 -> 2` 변경이 `10.webp` 또는 `scene-1.webp`에 적용되지 않도록 부분 문자열 치환을 금지한다.
- 기존 legacy 임시 경로 `${projectPrefix}_planner_temp_image/${oldStorageName}/`가 존재하면 prefix 이동 manifest에 넣는다.
- compact planner 후보 R2 key는 안정된 `situationId`를 사용하므로 상황의 `storageName`만 변경하는 이번 설계에서는 이동하지 않는다.

#### D1 commit

R2 복사와 검증이 끝난 뒤 `env.DB.batch([...])` 한 번으로 관련 D1 변경을 수행한다. D1 batch는 한 statement 실패 시 전체 sequence를 rollback하는 transaction으로 사용한다.

캐릭터 commit 대상:

- `json_documents.object_key`: `character_meta`의 old prefix key를 new prefix key로 변경
- `file_metadata.folder_prefix`: old prefix로 시작하는 값 prefix 치환
- `aliases.target_key`: 프로젝트 scope의 old folder name을 new folder name으로 변경
- `v2_characters.prefix`
- `v2_assets.r2_key`
- `planner_metas.character_prefix`, `planner_metas.object_key` 및 관련 `meta_object_key`
- `image_editor_documents` 중 이동 대상 key를 참조하는 draft/saved 문서는 `status = 'stale_path_migration'`으로 만료 처리. 문서 JSON 내부의 과거 key를 무조건 문자열 치환하지 않음
- compact planner record의 `record_key`, `character_id`, `payload_json`은 아래 3.2의 전용 함수가 만든 statements를 batch에 합친다.

상황 commit 대상:

- `json_documents`의 `situations_meta` payload에서 target `id`의 `storageName`, `folderName`, `imageNumber`를 새 문자열로 변경
- `v2_situations.storage_name`, `v2_situations.image_number`
- `file_metadata.file_name`
- `aliases.target_key`
- `v2_assets.r2_key`, `v2_assets.file_name`
- 현재 사용 중인 `planner_compact_records.payload_json`의 target item `imageNumber`
- 호환용 `planner_items.image_number`, `v2_planner_items.image_number`는 테이블 존재 여부를 확인한 경우에만 갱신
- `image_editor_documents` 중 이동 대상 key를 참조하는 draft/saved 문서는 `status = 'stale_path_migration'`으로 만료 처리

JSON 문자열 전체에 `replaceAll()`을 적용하지 않는다. JSON parse 후 지정 필드만 변경하고 다시 직렬화한다.

## 3. 서버 코드 수정

### 3.1 `functions/[[path]].js`

#### 2–36행 import 영역

`src/path-migration.js`에서 다음 함수를 import한다.

```js
import {
    changeCharacterPath,
    changeSituationPath,
    getPathMigration
} from '../src/path-migration.js';
```

#### 111–146행 `ensureJsonDbSchema()`

`path_migrations`를 runtime에 반복 생성하지 않는다. 신규 migration `0020`을 schema의 단일 출처로 사용한다. 다만 기존 세 테이블을 runtime 생성하는 현재 정책은 이번 작업에서 제거하지 않는다.

#### 209–273행 `mirrorJsonDocumentToV2()`

`docType === 'situations_meta'` 분기의 SQL을 수정한다.

- `INSERT INTO v2_situations` 열에 `storage_name`을 추가한다.
- 값은 `situation.storageName || situation.folderName || String(situation.imageNumber ?? index)` 순으로 결정한다.
- `ON CONFLICT(id)`에서도 `storage_name`과 `image_number`를 함께 갱신한다.
- 전체 상황 저장 시 현재 JSON에 없는 같은 project의 오래된 `v2_situations` 행을 삭제하는 statement를 추가한다. 단, FK가 걸린 planner item이 있으면 삭제하지 않고 별도 cleanup 대상으로 보고한다.

권장 코드 형식:

```js
const storageName = String(
    situation?.storageName
    || situation?.folderName
    || String(situation?.imageNumber ?? index)
);
```

#### 1895행 `onRequest()` 라우터, 2164행 이후와 2183행 이전

다음 route를 `/api/manage`보다 먼저 추가한다.

```js
if (path === '/api/path-migrations/character' && method === 'POST') { ... }
if (path === '/api/path-migrations/situation' && method === 'POST') { ... }

const pathMigrationMatch = path.match(/^\/api\/path-migrations\/([^/]+)$/);
if (pathMigrationMatch && method === 'GET') { ... }
```

- 모든 route에 기존 `isAdmin` 검사를 적용한다.
- `change*Path()`가 던진 `status`, `code`, `details`를 `jsonResponse`에 보존한다.
- 성공 응답에는 `Cache-Control: no-store`를 지정한다.

#### 2722–2788행 `/api/manage`의 `rename_folder`

- 탐색기와 프로젝트 경로 변경의 호환을 위해 즉시 삭제하지 않는다.
- 캐릭터 UI에서는 더 이상 호출하지 않는다.
- 기존 copy loop에 최소한 `storageClass` 보존과 목적지 `head()` 검증을 추가한다.
- 이 action은 응답에 `deprecatedForEntityPathChanges: true`를 포함하여 신규 코드가 잘못 재사용되는 것을 드러낸다.

### 3.2 `src/planner-compact.js`

#### 4–5행 상태 상수

`ACTIVE_JOB_STATUSES`는 1839행에서 이미 export되므로 `src/path-migration.js`가 실행 중 작업 차단에 재사용한다.

#### 70–85행 `safePlannerRef()`

캐릭터 planner prefix 계산을 공통화하기 위해 현재 export를 유지한다. 별도 중복 slug 함수를 만들지 않는다.

#### 369–458행 `normalizeRunItems()`

- `imageNumber` 입력을 숫자로 변환하지 않고 문자열 그대로 보존하는 현재 동작을 유지한다.
- 변수와 주석에서 이 값이 앞으로 실제 `storageName` 호환값임을 명시한다.
- 상황 `id`를 item identity로 사용하고 `imageNumber`를 item identity fallback으로 사용하는 것은 구형 데이터에만 허용한다.

#### 876–882행 `makePlannerCompactR2Key()`

- `situationId`가 존재하면 계속 이를 사용한다.
- 새 데이터에서 `storageName` 변경이 compact 후보 key를 바꾸지 않는다는 회귀 주석을 추가한다.

#### 1810행 `cleanupPlannerCompactAssets()` 앞에 신규 함수 추가

다음 함수를 추가한다.

```js
export async function prepareCharacterPathPlannerMigration(env, input)
export async function prepareSituationPathPlannerMigration(env, input)
```

`prepareCharacterPathPlannerMigration()` 역할:

- old character ID로 `planner_compact_records`의 run을 조회한다.
- `activeJob.status`가 `queued/running/paused/cancel_requested`이면 `PLANNER_RUN_ACTIVE` 409를 반환한다.
- 새 character ID 기준으로 `record_key`, `runId`, `itemId`, `variantId`, candidate `assetId`를 다시 계산한다.
- candidate `r2Key`는 R2 manifest의 old/new mapping으로 치환한다.
- 만료성 confirm record는 새 identity로 복잡하게 재키잉하지 않고 완료·실패 상태만 삭제 대상으로 반환한다. `pending` confirm은 active와 동일하게 변경을 차단한다.
- 실제 DB write는 하지 않고 `statements`, `r2Mappings`, `recordSummary`를 반환하여 path migration commit batch에 포함시킨다.

`prepareSituationPathPlannerMigration()` 역할:

- `project_id`의 모든 run payload를 parse한다.
- target `situationId` item의 `imageNumber`만 `newStorageName`으로 갱신한다.
- `itemId`, `variantId`, candidate R2 key는 변경하지 않는다.
- 실행 중 target 상황을 포함하는 run이면 변경을 차단한다.

#### 1676–1679행 `confirmPlannerCompactAsset()`

`targetFileName` 기본값은 계속 `${item.imageNumber}.webp`를 사용하되 `imageNumber`가 storage basename 문자열임을 전제로 validation을 추가한다.

```js
if (!isSafeStorageName(item.imageNumber)) {
    throw plannerError('PLANNER_INVALID_STORAGE_NAME', 400, 'Invalid situation storage name.');
}
```

검증 helper는 `src/path-migration.js`와 순환 import하지 않도록 작은 순수 helper를 `src/worker-utils.js`로 이동하거나 `src/path-utils.js` 신규 파일로 분리한다. 권장안은 `src/path-utils.js`다.

### 3.3 `src/guest-api.js`

#### 199–214행 `getProjectSituations()`

SQL을 다음처럼 변경한다.

```sql
SELECT id, name, COALESCE(NULLIF(storage_name, ''), image_number) AS storage_name
FROM v2_situations
WHERE project_id = ?
ORDER BY sort_order ASC, storage_name ASC
```

JS의 `byImageNumber`는 호환을 위해 이름을 당장 바꾸지 않아도 되지만 값은 `row.storage_name`에서 채운다. 후속 정리 때 `byStorageName`으로 rename한다.

#### 247–273행 `getCharacterImages()`

- `fileStem -> situations.byImageNumber` 매칭을 유지하되 실제 의미가 storage name임을 반영한다.
- 이전 storage name과 새 storage name이 동시에 남은 비정상 상태에서는 새 D1 storage name과 일치하는 파일만 상황에 연결한다.

## 4. 공통 프런트엔드 수정

### 4.1 `public/js/project/shared.js`

#### 222–233행 `renameProjectFolder()` 인접 위치

다음 API wrapper를 추가한다.

```js
export async function changeCharacterStoragePath(payload)
export async function changeSituationStoragePath(payload)
```

공통 private helper `requestPathMigration(type, payload)`는 다음을 수행한다.

- `POST /api/path-migrations/${type}`
- `Content-Type: application/json; charset=utf-8`
- `cache: 'no-store'`
- 실패 응답의 `code`, `details`를 Error 객체에 붙임
- `crypto.randomUUID()`로 idempotency key 생성

#### 253–266행 `clearProjectCaches()`와 `clearFolderDataCaches()`

현재는 정확히 일치하는 key만 삭제한다. 하위 캐시까지 지우는 함수를 추가한다.

```js
export function clearFolderDataCacheTree(...prefixes) {
    for (const cacheKey of Object.keys(window.FOLDER_DATA_CACHE || {})) {
        if (prefixes.some(prefix => cacheKey === prefix || cacheKey.startsWith(prefix))) {
            delete window.FOLDER_DATA_CACHE[cacheKey];
        }
    }
}
```

경로 변경 코드에서는 기존 exact-delete 함수가 아니라 이 함수를 사용한다.

#### 764–784행 `loadProjectSituations()`

- 응답의 `updatedAt`을 `project.situationsUpdatedAt`에 저장한다.
- 전용 API의 optimistic concurrency에 이 값을 보낸다.
- 기존 `force` 동작은 유지한다.

이를 위해 서버 `GET /api/db/json-document`의 2296–2308행도 `{ data, updatedAt }`을 반환하도록 row 조회를 확장한다.

#### 787–818행 `normalizeProjectSituations()`

다음 값을 추가한다.

```js
const legacyStorageName = situation?.folderName
    || String(situation?.imageNumber ?? '')
    || situation?.id
    || String(index);
const storageName = String(situation?.storageName || legacyStorageName);
```

반환 객체는 다음을 포함한다.

```js
{
    ...situation,
    id,
    storageName,
    folderName: storageName,
    imageNumber: storageName,
    ...
}
```

현재 809행의 `Number.isFinite(Number(...))` 변환은 제거한다. 이 숫자 강제가 비숫자 경로를 과거 번호로 되돌리는 원인이므로 문자열을 보존한다.

#### 951–980행 상황 helper 영역

다음 helper를 추가하고 기존 함수의 역할을 축소한다.

```js
export function getSituationStorageName(project, situation) {
    const index = getProjectItems(project, 'situations').findIndex(item => item.id === situation?.id);
    return String(
        situation?.storageName
        || situation?.folderName
        || situation?.imageNumber
        || (index >= 0 ? index : getProjectItems(project, 'situations').length)
    );
}

export function getSituationImageNumber(project, situation) {
    return getSituationStorageName(project, situation); // 호환 alias
}
```

- 962–964행 `getSituationImageKey()`는 `getSituationStorageName()`을 직접 사용한다.
- 966–980행 next-number 계산은 모든 `storageName` 중 순수 숫자 값만 모아 다음 숫자 문자열을 반환한다.
- `getSituationFolderNumber()`는 신규 경로 변경 흐름에서 사용하지 않고 생성 기본값 계산 호환용으로만 남긴다.

## 5. 캐릭터 화면 수정

### 5.1 `public/js/project/character.js`

#### 1행 import

- `renameProjectFolder` import를 제거한다.
- `changeCharacterStoragePath`, `clearFolderDataCacheTree`, `getSituationStorageName`을 추가한다.

#### 5–18행 `getSituationImageCandidates()` / `findSituationImage()`

- `Number(situation.imageNumber)` 변환을 제거한다.
- `getSituationStorageName()`과 동일한 우선순위의 문자열 basename을 사용한다.
- legacy 데이터 조회 기간에는 `storageName`, `folderName`, `imageNumber`, index를 중복 제거 후보로 제공하되 새 `storageName`을 첫 번째로 둔다.

#### 277–321행 `uploadCharacterSituationImage()`

- 285행 `imageNumber`를 `storageName`으로 rename한다.
- 최종 파일명을 `${getSituationStorageName(project, situation)}.webp`로 만든다.
- 업로드 성공 후 `clearFolderDataCacheTree(character.prefix)`를 호출한다.

#### 620–666행 `changeActiveCharacterPath()` 전체 교체

현재 648–656행의 `renameProjectFolder()` 호출과 즉시 reload 흐름을 제거한다.

새 흐름:

1. old/new prefix와 현재 character ID를 캡처
2. 버튼 재진입 방지 상태 표시
3. `changeCharacterStoragePath({...})` 호출
4. 성공 후 `clearFolderDataCacheTree(project.prefix, oldPrefix, newPrefix, getPlannerPrefix(project))`
5. `project.charactersLoaded = false`
6. `loadProjectCharacters(project, true)`로 서버 재조회
7. 응답의 `newCharacterId` 또는 새 prefix로 새 character를 찾음
8. 상세 화면 및 route 교체

클라이언트 객체를 API 성공 전에 수정하지 않는다. `PATH_MIGRATION_ACTIVE`, `PLANNER_RUN_ACTIVE`, `PATH_DESTINATION_EXISTS`는 서로 다른 한국어 안내로 표시한다.

#### 863–905행 `createSituation()`

함수 signature를 `createSituation(project, storageName, alias, rating)`로 변경한다.

```js
const situation = {
    id: crypto.randomUUID(),
    storageName,
    folderName: storageName,
    imageNumber: storageName,
    ...
};
```

- 중복 검사는 `situation.id`가 아니라 `getSituationStorageName(project, situation) === storageName`으로 수행한다.
- 저장과 alias 생성 로직은 유지하되 helper가 새 storage name을 사용하도록 한다.

## 6. 상황 화면 수정

### 6.1 `public/js/project/situation.js`

#### 1행 import

다음을 추가한다.

- `changeSituationStoragePath`
- `clearFolderDataCacheTree`
- `getPlannerPrefix`
- `getSituationStorageName`

다음은 경로 변경 함수에서 더 이상 사용하지 않으면 제거한다.

- `getSituationFolderNumber`
- `saveProjectAlias`
- `saveProjectSituations`

단, 이름 변경·삭제에서 계속 사용하므로 실제 import 제거 여부는 전체 파일 사용처를 확인한 뒤 결정한다.

#### 11–23행 `renderSituationCards()`

- 15–16행 표시값을 `getSituationStorageName(project, situation)`으로 통일한다.
- 숫자 타일이라는 의미를 제거하고 “저장 경로”임을 title/aria-label에 반영한다.

#### 154행 `renderSituationCharacterProgress()`

미생성 파일명도 `getSituationStorageName()`을 사용한다.

#### 247–265행 `renderSituationDetailShell()`

- `const imageNumber`를 `const storageName`으로 변경한다.
- 상세 보조 문구를 `${storageName}.webp`로 렌더링한다.

#### 352–399행 `openSituationDetail()`

경로 변경 뒤 서버의 최신 상황을 반드시 읽도록 선택적 `forceSituations` 인자를 추가한다.

```js
export async function openSituationDetail(projectId, situationId, skipHistory = false, options = {})
```

`options.forceSituations === true`이면 `loadProjectSituations(project, true)`를 호출한다.

#### 447–503행 `changeActiveSituationPath()` 전체 교체

기존 문제 코드인 다음 동작을 제거한다.

- `situation.id = folderName`
- `situation.folderName = folderName`
- 숫자일 때만 `situation.imageNumber` 변경
- `saveProjectSituations()` 후 alias만 별도 이동
- catch에서 일부 필드만 수동 rollback

새 흐름:

```js
const oldStorageName = getSituationStorageName(project, situation);
const result = await changeSituationStoragePath({
    projectId: project.id,
    projectPrefix: project.prefix,
    situationId: situation.id,
    oldStorageName,
    newStorageName: folderName,
    expectedDocumentUpdatedAt: project.situationsUpdatedAt
});
```

성공 후:

- `clearFolderDataCacheTree(project.prefix, getPlannerPrefix(project), ...characterPrefixes)`
- 모든 `character.filesLoaded = false`
- `project.situationsLoaded = false`
- `loadProjectSituations(project, true)`와 `loadCharacterFiles(character, { force: true })` 실행
- `window.PROJECT_ACTIVE_SITUATION_ID`는 불변 `situation.id`를 그대로 유지
- 동일 route에서 서버 재조회한 새 객체로 상세 재렌더링
- 상황 목록으로 이동하면 이미 갱신된 `project.situations`를 사용

ID가 변하지 않으므로 `replaceProjectRoute()`로 situation ID를 바꾸는 현재 492–495행 코드는 삭제한다.

## 7. 플래너 프런트엔드 수정

### 7.1 `public/js/project/planner.js`

#### 1행 import

`getSituationStorageName`을 추가한다. `getSituationImageNumber`는 화면 번호가 아니라 storage name이라는 혼동을 없애기 위해 경로·파일 처리 위치부터 순차 교체한다.

#### 파일 경로를 만드는 필수 변경 위치

| 현재 라인 | 함수 | 수정 내용 |
|---|---|---|
| 378–380 | `getPlannerImagePrefix()` | 인자명을 `imageNumber`에서 `storageName`으로 변경. legacy temp 경로용임을 주석으로 명시 |
| 1173–1184 | `listPlannerImages()` | `storageName` 문자열을 전달 |
| 3345–3377 | `savePlannerSituationPlan()` 관련 item 생성 | `imageNumber`에 `getSituationStorageName()` 결과 저장 |
| 3454–3475 | batch item 생성 | 위와 동일 |
| 3872–3904 | `clearPlannerItemImages()` | item의 storage name으로 legacy prefix 정리 |
| 5222–5261 | confirm 처리 | `targetFileName`, `newKey`, upload header, file metadata 이름을 모두 `${item.imageNumber}.webp`로 유지하되 값이 새 storage name인지 확인 |

#### 113–134행 planner meta memory cache helper

상황 경로 migration 성공 후 프로젝트의 모든 planner cache를 지우는 export 함수를 추가한다.

```js
export function clearPlannerCachesForProject(project) {
    for (const key of plannerMetaMemoryCache.keys()) {
        if (key.startsWith(project.prefix)) plannerMetaMemoryCache.delete(key);
    }
    window.PROJECT_PLANNER_META = null;
    window.PROJECT_PLANNER_QUEUE_METAS = [];
}
```

`situation.js`에서 직접 private Map에 접근하지 않고 이 함수를 호출한다.

## 8. 브라우저 선택 상태 정리

상황 ID가 불변이므로 다음 상태는 변경할 필요가 없다.

- `window.PROJECT_ACTIVE_SITUATION_ID`
- `window.PROJECT_PLANNER_SELECTED_SITUATION_ID`
- `window.PLANNER_PLAN_MODAL_SITUATION_ID`
- `window.PLANNER_RESULT_MODAL_SITUATION_ID`
- craft/import localStorage의 `situationId`

따라서 `public/js/project/craft_bridge.js:45–84`와 `public/js/modals.js:777–814`에는 직접 수정이 필요 없다. 이 부분은 불변 ID 설계를 선택하는 주요 이유다.

캐릭터는 현재 ID가 prefix 기반이므로 다음 캐시를 새 character ID로 치환해야 한다.

- `public/js/project/shared.js:571–597`의 planner character cache
- `public/js/project/planner.js`의 선택 character 및 modal character ID
- `public/js/project/craft_bridge.js:45–84`의 `characterPath`
- `public/js/modals.js:777–814`의 import `characterPath`

`shared.js`에 다음 함수를 추가한다.

```js
export function replaceCachedCharacterPath(project, oldPrefix, newPrefix)
```

이 함수가 planner 선택 cache와 `imggul_craft_upload_context.byProject[...].characterPath`를 한 번에 치환하며, 캐릭터 경로 변경 성공 후 호출된다.

## 9. 구현 순서와 커밋 단위

### 1단계 — schema와 순수 helper

1. `0020_path_migrations.sql`
2. `src/path-utils.js`
3. `shared.js`의 `storageName` 정규화/helper
4. `guest-api.js`의 storage name 조회

완료 조건: 기존 상황 JSON을 읽으면 `storageName`이 항상 문자열로 정규화되고 기존 화면은 깨지지 않는다.

### 2단계 — 서버 migration 엔진

1. `src/path-migration.js`
2. `src/planner-compact.js`의 planner migration 준비 함수
3. `functions/[[path]].js` route 연결
4. R2 copy/verify/delete와 D1 batch commit

완료 조건: API만 호출해도 캐릭터 및 상황 R2/D1 참조가 이동하고, 중간 실패 후 동일 idempotency key로 재개할 수 있다.

### 3단계 — 캐릭터 UI 전환

1. `shared.js` API wrapper와 cache 치환
2. `character.js:620–666` 교체
3. compact planner character identity migration 확인

완료 조건: 캐릭터 경로 변경 후 하위 이미지, meta, planner 결과, 파일 metadata가 새 경로에서 조회된다.

### 4단계 — 상황 UI 전환

1. `character.js:863–905` 신규 상황 불변 ID 적용
2. `situation.js:447–503` 교체
3. 목록·상세·업로드·planner 파일명 helper 통일
4. 강제 reload와 cache invalidation

완료 조건: 숫자→문자, 문자→숫자, 문자→문자 변경 모두 즉시 새 파일명을 표시하고 모든 캐릭터의 기존 이미지가 연결된다.

### 5단계 — legacy 정리

1. 더 이상 캐릭터 UI에서 `rename_folder`를 호출하지 않는지 확인
2. `getSituationFolderNumber()` 사용처 축소
3. 오래된 `v2_situations` 및 누락 `storage_name` 감사
4. 완료된 migration record 보존 기간 정책 추가

## 10. 정적 검증과 배포 후 검증

### 10.1 로컬 정적 검사

프로젝트 규칙에 따라 브라우저/E2E/실서비스 테스트는 로컬에서 실행하지 않는다.

```text
node --check functions/[[path]].js
node --check src/path-utils.js
node --check src/path-migration.js
node --check src/planner-compact.js
node --check src/guest-api.js
node --check public/js/project/shared.js
node --check public/js/project/character.js
node --check public/js/project/situation.js
node --check public/js/project/planner.js
git diff --check
```

추가 정적 확인:

- 수정 파일 UTF-8 BOM 부재
- `storageName`이 `Number()` 또는 `parseInt()`를 통과하는 코드가 남지 않았는지 `rg` 확인
- 상황 경로 변경 코드에서 `situation.id =` 대입이 남지 않았는지 확인
- `rename_folder`의 캐릭터 UI 호출이 남지 않았는지 확인
- R2 list loop가 `objects.length`가 아니라 `truncated`로 종료되는지 확인
- R2 delete는 최대 1,000 key 단위로 chunk 처리되는지 확인

### 10.2 Cloudflare 배포 후 확인

1. 기존 상황 `1`을 `scene-a`로 변경
2. 목록·상세에 즉시 `scene-a.webp` 표시
3. 모든 캐릭터의 `1.webp`가 `scene-a.webp`로 이동
4. 공개 여부, HTTP/custom metadata, D1 file metadata 보존
5. planner item ID와 후보 key는 유지되고 `imageNumber`만 `scene-a`로 변경
6. 확정 시 `{characterPrefix}scene-a.webp`에 저장
7. 게스트 API가 새 storage name으로 상황을 매핑
8. 새로고침·재로그인 후 구 경로가 나타나지 않음
9. 캐릭터 폴더 rename 후 compact planner run이 새 character identity로 조회됨
10. active planner/confirm 중 경로 변경은 409로 차단
11. 목적지 충돌 시 R2와 D1 모두 무변경
12. copy 단계 실패 후 원본 보존 및 동일 요청 재개

## 11. 완료 판정 기준

다음 조건을 모두 만족해야 완료로 판정한다.

- 상황 목록과 상세가 동일 helper에서 실제 storage name을 표시한다.
- 상황 경로 변경 후 `id`는 변하지 않는다.
- 모든 관련 R2 목적지 객체가 생성·검증된 뒤에만 D1 참조가 전환된다.
- D1 batch 실패 시 원본 R2가 삭제되지 않는다.
- D1 commit 후 원본 R2가 삭제되고 audit가 통과한다.
- 캐릭터 경로 변경이 범용 `rename_folder`에 의존하지 않는다.
- 실행 중 planner에 대한 경로 변경이 차단된다.
- migration 요청이 idempotent하며 중간 실패 후 재개 가능하다.
- 강제 서버 재조회 후 목록, 상세, planner, guest에서 구 경로가 노출되지 않는다.
- 수정 파일은 UTF-8 without BOM이며 정적 검사에 통과한다.

## 12. 공식 API 근거

- R2 Workers API의 `head`, `get`, `put`, `delete`, `list`를 사용한다. `list`는 반환 개수가 아니라 `truncated/cursor`로 pagination하고, delete는 한 호출당 최대 1,000 key로 나눈다.
- R2 `put`과 `delete` 완료 후에는 Worker binding에서 최신 상태를 즉시 관찰할 수 있으므로 복사 검증 후 다음 단계로 진행한다.
- D1 `batch()`는 statements를 순서대로 실행하고 한 statement 실패 시 전체 sequence를 rollback하므로 참조 전환 commit에 사용한다.

- Cloudflare R2 Workers API: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- Cloudflare D1 Database API: https://developers.cloudflare.com/d1/worker-api/d1-database/
