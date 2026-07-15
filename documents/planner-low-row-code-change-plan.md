# 신규 low-row 스키마 코드 수정 계획

작성일: 2026-07-06

## 1. 수정 목표

신규 코드의 목표는 기존 v3 API의 row 중심 실행 모델을 버리고, `planner_compact_records` 1개 테이블의 JSON document 모델로 교체하는 것이다.

핵심 원칙:

- 이미지 1장마다 D1 queue row를 만들지 않는다.
- job/task/item/run 중복 카운터 update를 제거한다.
- stage/heartbeat/event write를 제거한다.
- 후보 asset row를 만들지 않는다.
- 사용자 선택은 DB에 저장하지 않는다.
- confirm 정상 경로에서도 D1 write를 최소화한다.
- DB row key와 payload 내부 ID는 랜덤 생성하지 않고 기존 프로젝트/캐릭터/상황 reference에서 deterministic하게 만든다.

## 2. 파일별 수정 범위

| 파일 | 작업 |
| --- | --- |
| `migrations/0018_planner_compact_records.sql` | 신규 compact table 생성 |
| `src/planner-compact.js` | 신규 low-row planner backend 구현 |
| `src/planner-background.js` | v3 background queue 처리 제거 또는 compact worker 호출로 교체 |
| `functions/[[path]].js` | `/api/planner/v3/*`를 compact backend로 연결하거나 `/api/planner/compact/*` 신규 라우트 추가 |
| `public/js/project/planner.js` | queue 기반 browser/background 호출 제거, compact run/status/confirm 호출로 교체 |
| `public/js/project/shared.js` | legacy planner R2 meta/settings key 사용 축소 |

## 3. migration 계획

### 기존 구조

```sql
CREATE TABLE IF NOT EXISTS planner_v3_runs (...);
CREATE TABLE IF NOT EXISTS planner_v3_items (...);
CREATE TABLE IF NOT EXISTS planner_v3_item_variants (...);
CREATE TABLE IF NOT EXISTS planner_v3_generation_snapshots (...);
CREATE TABLE IF NOT EXISTS planner_v3_jobs (...);
CREATE TABLE IF NOT EXISTS planner_v3_job_tasks (...);
CREATE TABLE IF NOT EXISTS planner_v3_queue (...);
CREATE TABLE IF NOT EXISTS planner_v3_assets (...);
CREATE TABLE IF NOT EXISTS planner_v3_confirm_operations (...);
CREATE TABLE IF NOT EXISTS planner_v3_events (...);
```

### 신규 구조

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

보조 index는 만들지 않는다.

## 4. deterministic ID helper 신설

기존 v3 코드에는 `makePlannerV3Id("prun")`, `makePlannerV3Id("pitem")`, `makePlannerV3Id("pqueue")`처럼 신규 row마다 랜덤성 있는 ID를 만드는 흐름이 있다. compact 구조에서는 같은 프로젝트/캐릭터/상황을 다시 저장할 때 같은 ID가 나와야 하므로 이 방식을 사용하지 않는다.

### 기존 ID 생성 방향

```js
const runId = existing?.id || makePlannerV3Id("prun");
const itemId = item.id || existingItemBySituationId.get(situationId) || makePlannerV3Id("pitem");
const variantId = makePlannerV3Id("pvar");
const jobId = makePlannerV3Id("pjob");
const assetId = makePlannerV3Id("passet");
```

### 신규 ID 생성 방향

```js
function safePlannerRef(value, fallback = 'default') {
  const raw = String(value || fallback).trim() || fallback;
  const stableAsciiId = /^[a-zA-Z0-9_-]+$/.test(raw);
  if (stableAsciiId) return raw.toLowerCase();

  const slug = raw
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\\/\s:]+/gu, '_')
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${slug || fallback}_${stablePlannerRefHash(raw).slice(0, 6)}`;
}

function stablePlannerRefHash(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

export function makePlannerCompactIds(input = {}) {
  const project = safePlannerRef(input.projectId || input.projectPrefix, 'project');
  const character = safePlannerRef(input.characterId || input.characterPrefix, 'character');
  const situation = safePlannerRef(input.situationId || input.imageNumber, 'situation');
  const characterVariant = safePlannerRef(input.characterPromptVariantId, 'default');
  const situationVariant = safePlannerRef(input.situationPromptVariantId, 'default');
  const runId = `prun:${project}:${character}`;
  const itemId = `pitem:${project}:${character}:${situation}`;
  const variantId = `pvar:${safePlannerRef(itemId)}:${characterVariant}:${situationVariant}`;
  return { project, character, situation, runId, itemId, variantId };
}

export function makePlannerCompactAssetId({ itemId, variantId, imageIndex }) {
  return `passet:${safePlannerRef(itemId)}:${safePlannerRef(variantId)}:${Number(imageIndex) || 0}`;
}
```

이 정책의 효과:

```text
1. 같은 상황 플랜을 다시 저장해도 pitem row identity가 바뀌지 않는다.
2. 같은 variant/image slot을 재생성해도 candidate identity가 계속 누적되지 않는다.
3. DB를 직접 볼 때 record_key와 payload ID만으로 어느 프로젝트/캐릭터/상황인지 추적할 수 있다.
4. 랜덤 ID 기반 중복 row 증가를 방지한다.
```

## 5. backend helper 신설

### 신규 key helper

```js
export function makePlannerCompactKey(type, input = {}) {
  if (type === 'settings') return `settings:${input.projectId}`;
  if (type === 'run') return `run:${input.projectId}:${input.characterId}`;
  if (type === 'confirm') return `confirm:${input.itemId}`;
  if (type === 'rate') return `rate:${input.key || 'novelai'}`;
  throw new Error(`Unknown compact planner key type: ${type}`);
}
```

### 신규 record read/write helper

```js
async function getCompactRecord(env, recordKey) {
  const row = await env.DB.prepare(
    'SELECT * FROM planner_compact_records WHERE record_key = ?'
  ).bind(recordKey).first();
  if (!row) return null;
  return {
    ...row,
    payload: JSON.parse(row.payload_json || '{}')
  };
}

async function putCompactRecord(env, record) {
  const now = new Date().toISOString();
  return await env.DB.prepare(`
    INSERT INTO planner_compact_records (
      record_key, record_type, project_id, character_id, status,
      payload_json, revision, created_at, updated_at, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(record_key) DO UPDATE SET
      status = excluded.status,
      payload_json = excluded.payload_json,
      revision = planner_compact_records.revision + 1,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
  `).bind(
    record.recordKey,
    record.recordType,
    record.projectId || '',
    record.characterId || '',
    record.status || '',
    JSON.stringify(record.payload || {}),
    now,
    now,
    record.expiresAt || null
  ).run();
}
```

## 6. 플랜 저장 로직 교체

### 기존 로직

`putPlannerV3RunFromMeta()`는 run row 저장 후 item/variant/snapshot row를 다시 만든다.

```js
await deletePlannerV3SnapshotsForRun(env, runId);

for (const item of meta.items || []) {
  await env.DB.prepare(`INSERT INTO planner_v3_items (...) VALUES (...) ON CONFLICT(id) DO UPDATE SET ...`).run();
  await env.DB.prepare(`INSERT INTO planner_v3_item_variants (...) VALUES (...)`).run();
  await insertPlannerV3GenerationSnapshot(env, ...);
}
```

### 신규 로직

전체 meta를 compact run payload로 normalize한 뒤 1 row만 쓴다.

```js
export async function putPlannerCompactRun(env, meta = {}) {
  const projectId = String(meta.projectId || '').trim();
  const characterId = String(meta.characterId || '').trim();
  if (!projectId || !characterId) throw new Error('projectId and characterId are required');

  const recordKey = makePlannerCompactKey('run', { projectId, characterId });
  const payload = normalizeCompactRunPayload(meta, { makeIds: makePlannerCompactIds });

  await putCompactRecord(env, {
    recordKey,
    recordType: 'run',
    projectId,
    characterId,
    status: payload.status,
    payload
  });

  return payload;
}
```

row write 변화:

```text
기존: run + items + variants + item snapshots + variant snapshots + 삭제 row
신규: run record 1 row
```

## 7. 생성 시작 로직 교체

### 기존 로직

`startPlannerV3Generation()`은 job, task, queue를 다수 생성한다.

```js
await env.DB.prepare(`INSERT INTO planner_v3_jobs (...) VALUES (...)`).run();
await env.DB.prepare("UPDATE planner_v3_runs SET status = 'queued', active_job_id = ? WHERE id = ?").run();

for (const item of candidates) {
  await env.DB.prepare(`INSERT INTO planner_v3_job_tasks (...) VALUES (...)`).run();
  await env.DB.prepare("UPDATE planner_v3_items SET status = 'queued' WHERE id = ?").run();
  for (const variant of variants) {
    for (...) {
      await env.DB.prepare(`INSERT INTO planner_v3_queue (...) VALUES (...)`).run();
    }
  }
}
```

### 신규 로직

run payload 안에 `activeJob`과 item 상태만 갱신한다.

```js
export async function startPlannerCompactGeneration(env, body = {}) {
  const run = await getCompactRunByIdOrKey(env, body);
  if (!run) throw new Error('Planner run not found');

  const nextPayload = buildCompactActiveJob(run.payload, {
    mode: body.mode === 'browser' ? 'browser' : 'background',
    targetSituationId: body.targetSituationId || '',
    clearExisting: body.clearExisting === true
  });

  await updateCompactRunPayload(env, run.record_key, run.revision, nextPayload);

  if (nextPayload.activeJob.mode === 'background') {
    await env.GENERATION_QUEUE.send({
      plannerCompact: true,
      runKey: run.record_key,
      jobId: nextPayload.activeJob.jobId
    });
  }

  return compactStatusFromRun(nextPayload);
}
```

row write 변화:

```text
기존: job 1 + run 1 + task N + item N + queue imageCount
신규: run record 1 update
```

## 8. 이미지 생성 완료 로직 교체

### 기존 로직

background queue 완료는 queue/task/item/job/events를 갱신한다.

```js
await env.DB.batch([
  env.DB.prepare("UPDATE planner_v3_queue SET status = 'completed' WHERE id = ?"),
  env.DB.prepare("UPDATE planner_v3_job_tasks SET completed_count = completed_count + 1 WHERE id = ?"),
  env.DB.prepare("UPDATE planner_v3_items SET completed_count = completed_count + 1 WHERE id = ?"),
  env.DB.prepare("UPDATE planner_v3_jobs SET completed_count = completed_count + 1 WHERE id = ?")
]);
await insertPlannerV3Event(env, queue, "queue_completed", ...);
```

### 신규 로직

R2에 이미지를 저장한 뒤 run payload에 candidate를 append하고 pointer를 전진한다.

```js
async function completePlannerCompactImage(env, runKey, imageResult) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const run = await getCompactRecord(env, runKey);
    const nextPayload = appendCompactCandidate(run.payload, {
      ...imageResult,
      assetId: makePlannerCompactAssetId(imageResult)
    });

    const result = await env.DB.prepare(`
      UPDATE planner_compact_records
      SET status = ?,
          payload_json = ?,
          revision = revision + 1,
          updated_at = ?
      WHERE record_key = ?
        AND revision = ?
    `).bind(
      nextPayload.status,
      JSON.stringify(nextPayload),
      new Date().toISOString(),
      runKey,
      run.revision
    ).run();

    if (Number(result.meta?.changes || 0) === 1) return nextPayload;
  }
  throw new Error('Planner run changed while recording image result');
}
```

row write 변화:

```text
기존: 이미지 1장마다 최소 queue update + task update + item update + job update + asset insert + event insert
신규: 이미지 1장마다 run record 1 update
```

## 9. status 조회 로직 교체

### 기존 로직

`getPlannerV3Status()`는 job, task, asset join을 수행한다.

```sql
SELECT * FROM planner_v3_jobs WHERE id = ?;
SELECT t.*, i.situation_id, i.image_number
FROM planner_v3_job_tasks t
LEFT JOIN planner_v3_items i ON i.id = t.item_id
WHERE t.job_id = ?;
SELECT a.item_id, a.id, a.r2_key
FROM planner_v3_assets a
JOIN planner_v3_queue q ON q.id = a.queue_id
WHERE q.job_id = ?;
```

### 신규 로직

run record 1개만 읽는다.

```js
export async function getPlannerCompactStatus(env, runKey) {
  const run = await getCompactRecord(env, runKey);
  if (!run) throw new Error('Planner run not found');
  return compactStatusFromRun(run.payload);
}
```

## 10. confirm 로직 교체

### 기존 로직

```js
await env.DB.prepare(`INSERT INTO planner_v3_confirm_operations (...) VALUES (...)`).run();
await env.DB.prepare("UPDATE planner_v3_confirm_operations SET status = 'copying' WHERE id = ?").run();
await env.DB.prepare(`INSERT INTO file_metadata (...) VALUES (...) ON CONFLICT (...) DO UPDATE SET ...`).run();
await env.DB.prepare("UPDATE planner_v3_confirm_operations SET status = 'metadata_saved' WHERE id = ?").run();
await env.DB.batch([
  env.DB.prepare("DELETE FROM planner_v3_queue WHERE item_id = ?"),
  env.DB.prepare("DELETE FROM planner_v3_job_tasks WHERE item_id = ?"),
  env.DB.prepare("DELETE FROM planner_v3_items WHERE id = ?")
]);
await env.DB.prepare("UPDATE planner_v3_confirm_operations SET status = 'completed' WHERE id = ?").run();
```

### 신규 로직

```js
export async function confirmPlannerCompactAsset(env, body = {}) {
  const run = await getCompactRecord(env, body.runKey);
  const selection = findCompactCandidate(run.payload, body.itemId, body.assetId);
  if (!selection) throw new Error('Candidate asset not found');

  const confirmKey = makePlannerCompactKey('confirm', { itemId: body.itemId });
  await insertPendingCompactConfirm(env, confirmKey, run, body, selection);

  const object = await env.imgBucket.get(selection.r2Key);
  if (!object) throw new Error('Selected candidate image is missing in R2');

  await env.imgBucket.put(body.targetR2Key, object.body, {
    httpMetadata: { contentType: selection.mimeType || 'image/webp' }
  });

  await upsertFinalFileMetadata(env, body);
  await markCompactConfirmCompleted(env, confirmKey);
  await removeConfirmedCompactItem(env, run.record_key, body.itemId);
  await deleteCompactCandidateObjectsBestEffort(env, selection.itemCandidates);

  return { success: true, targetR2Key: body.targetR2Key };
}
```

row write 변화:

```text
기존: confirm operation 여러 update + queue/task/item/assets 삭제 + 빈 job/run 삭제
신규: confirm insert 1 + file_metadata upsert 1 + confirm update 1 + run update/delete 1
```

## 11. frontend 수정 계획

### 기존 background start 호출

```js
const res = await fetch('/api/planner/v3/generate/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    projectId: project.id,
    projectPrefix: project.prefix,
    runId: meta.id,
    targetSituationId: situationId || null,
    mode: 'background',
    clearExisting
  })
});
```

### 신규 호출

URL은 기존 v3를 유지하되 backend 내부만 compact로 바꾸는 방식을 권장한다. frontend 변경량을 줄이면서 로직은 완전히 교체할 수 있다.

```js
const res = await fetch('/api/planner/v3/generate/start', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    projectId: project.id,
    characterId: meta.characterId,
    targetSituationId: situationId || null,
    mode: 'background',
    clearExisting
  }),
  cache: 'no-store'
});
```

`jobId` 대신 `runKey`와 `activeJob.jobId`를 함께 받을 수 있게 response shape를 조정한다.

```js
{
  "runKey": "run:proj_001:char_a",
  "jobId": "pjob_001",
  "status": "queued",
  "completedCount": 0,
  "totalCount": 20
}
```

## 12. browser 생성 모드 정리

현재 browser 생성은 local queue와 R2 temp folder 흐름이 강하게 남아 있다. 신규 구조에서는 browser/background 모두 같은 compact run payload를 갱신하게 한다.

```text
browser mode:
1. startPlannerCompactGeneration(mode='browser')로 activeJob 생성
2. frontend가 다음 생성 target을 run payload에서 계산
3. 이미지 생성 및 R2 upload 후 completePlannerCompactImage API 호출
4. D1에는 이미지 1장당 run row 1 update만 발생
```

`next-browser-queue`와 `complete-browser-queue`는 queue row를 전제로 하므로 제거하거나 다음 API로 대체한다.

```text
GET  /api/planner/v3/generate/next-compact-image?runKey=
POST /api/planner/v3/generate/complete-compact-image
```

## 13. 측정 코드 추가

D1 사용량 확인을 위해 compact backend의 write helper에는 optional logging을 넣는다. 운영에서는 꺼둘 수 있게 env flag를 사용한다.

```js
async function runCompactWrite(statement, label, env) {
  const result = await statement.run();
  if (env.PLANNER_D1_METRICS === '1') {
    console.log('[planner-compact-d1]', label, {
      rowsRead: result.meta?.rows_read,
      rowsWritten: result.meta?.rows_written,
      changes: result.meta?.changes
    });
  }
  return result;
}
```

검증은 로컬 live/e2e가 아니라 syntax/static check만 수행하고, 실제 rows written은 Cloudflare 배포 후 D1 meta/dashboard에서 확인한다.

## 14. 단계별 구현 순서

1. `migrations/0018_planner_compact_records.sql` 추가
2. `src/planner-compact.js` 신설
3. deterministic ID helper 구현
4. compact settings/run CRUD 구현
5. compact generation start/status 구현
6. background worker가 `plannerCompact` message를 처리하도록 추가
7. compact image completion 구현
8. compact confirm 구현
9. `functions/[[path]].js`에서 v3 route를 compact 함수로 연결
10. frontend response shape 조정
11. legacy v3 table write 경로 제거
12. `node --check` 수준의 static check 수행
13. Cloudflare 배포 후 D1 `rows_written` 확인
