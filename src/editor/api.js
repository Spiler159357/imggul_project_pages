import { validateDocument, presetFor } from "../../public/js/editor/model.js";
import { makeR2ImageVisibilityMetadata } from "../image-serving.js";
const ROOT = "__editor/";
const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function id(value) {
  if (!/^[\w-]{1,80}$/.test(value || "")) fail("잘못된 작업 ID입니다.");
  return value;
}
function hash(value) {
  if (!/^[a-f0-9]{64}$/.test(value || "")) fail("잘못된 자산 해시입니다.");
  return value;
}
function key(value) {
  if (typeof value !== "string" || !value || value.length > 1024 || value.startsWith("/") || value.includes("..") || value.includes("\\") || /[\x00-\x1f]/.test(value) || value.split("/").some((p) => !p || p.startsWith(".") || p.startsWith("__"))) fail("저장 경로가 잘못되었습니다.");
  return value;
}
async function bodyJson(request) {
  const raw = await boundedBytes(request, 2 * 1024 * 1024);
  try {
    return JSON.parse(new TextDecoder().decode(raw));
  } catch {
    fail("JSON 형식이 잘못되었습니다.");
  }
}
async function boundedBytes(request, max) {
  const declared = Number(request.headers.get("content-length"));
  if (declared > max) fail("요청 크기를 초과했습니다.", 413);
  const reader = request.body?.getReader();
  if (!reader) fail("본문이 없습니다.");
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) {
        await reader.cancel();
        fail("요청 크기를 초과했습니다.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function digest(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}
function pngSize(bytes) {
  if (bytes.length < 24 || [137, 80, 78, 71, 13, 10, 26, 10].some((b, i) => bytes[i] !== b)) fail("PNG 자산만 저장할 수 있습니다.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}
function outputSize(bytes, format) {
  if (format === "png") return pngSize(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === "webp") {
    const text = (start, n) => new TextDecoder().decode(bytes.subarray(start, start + n));
    if (bytes.length < 30 || text(0, 4) !== "RIFF" || text(8, 4) !== "WEBP") fail("WebP 파일이 아닙니다.");
    for (let offset = 12; offset + 8 < bytes.length; ) {
      const type = text(offset, 4), size = view.getUint32(offset + 4, true), p = offset + 8;
      if (p + size > bytes.length) fail("WebP 데이터가 잘렸습니다.");
      if (type === "VP8X" && size >= 10) return [1 + (bytes[p + 4] | bytes[p + 5] << 8 | bytes[p + 6] << 16), 1 + (bytes[p + 7] | bytes[p + 8] << 8 | bytes[p + 9] << 16)];
      if (type === "VP8 " && size >= 10 && bytes[p + 3] === 157 && bytes[p + 4] === 1 && bytes[p + 5] === 42) return [view.getUint16(p + 6, true) & 16383, view.getUint16(p + 8, true) & 16383];
      if (type === "VP8L" && size >= 5 && bytes[p] === 47) {
        const bits = view.getUint32(p + 1, true);
        return [(bits & 16383) + 1, (bits >>> 14 & 16383) + 1];
      }
      offset = p + size + size % 2;
    }
  }
  if (format === "jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    let p = 2;
    while (p + 4 < bytes.length) {
      if (bytes[p++] !== 255) continue;
      while (bytes[p] === 255) p++;
      const marker = bytes[p++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      const length = view.getUint16(p);
      if (length < 2 || p + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) return [view.getUint16(p + 5), view.getUint16(p + 3)];
      p += length;
    }
  }
  fail("이미지 형식 또는 크기를 확인하지 못했습니다.");
}
async function schema(env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS editor_workspace_documents (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, revision TEXT NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS editor_workspace_project ON editor_workspace_documents(project_id, deleted, updated_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS editor_workspace_revisions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, manifest_key TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS editor_workspace_revision_doc ON editor_workspace_revisions(document_id, created_at)")
  ]);
}
async function reconcile(env, documentId, head) {
  if (!head) return;
  if (head.deleted) {
    await env.DB.prepare("UPDATE editor_workspace_documents SET deleted=1 WHERE id=?").bind(documentId).run();
    return;
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE editor_workspace_revisions SET state='committed' WHERE id=? AND document_id=?").bind(head.revision, documentId),
    env.DB.prepare("INSERT INTO editor_workspace_documents (id,project_id,title,revision,updated_at,deleted) VALUES(?,?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,title=excluded.title,revision=excluded.revision,updated_at=excluded.updated_at,deleted=0 WHERE excluded.updated_at >= editor_workspace_documents.updated_at").bind(documentId, head.projectId, head.title, head.revision, head.updatedAt)
  ]);
}
async function getHead(env, documentId) {
  const object = await env.imgBucket.get(`${ROOT}documents/${documentId}/head.json`);
  return object ? { object, head: await object.json() } : null;
}
async function completeOutput(env, services, record, recordKey) {
  const target = await env.imgBucket.get(record.outputKey);
  if (!target) fail("저장된 출력 파일이 없습니다.", 409);
  if (record.etag && target.etag !== record.etag) fail("출력 파일이 다른 작업에서 바뀌었습니다. 메타데이터를 덮지 않습니다.", 409);
  if (!record.etag) {
    if (await digest(await target.arrayBuffer()) !== record.hash) fail("현재 출력이 해당 저장 작업과 다릅니다.", 409);
    record.etag = target.etag;
  }
  try {
    await services.writeMetadata(env, record.outputKey, record.fileMetadata);
    record.state = "complete";
    record.completedAt = (/* @__PURE__ */ new Date()).toISOString();
    await env.imgBucket.put(recordKey, JSON.stringify(record), { httpMetadata: { contentType: "application/json" } });
    return { outputKey: record.outputKey, revision: record.revision, operationId: record.id };
  } catch (error) {
    record.state = "metadata-pending";
    await env.imgBucket.put(recordKey, JSON.stringify(record), { httpMetadata: { contentType: "application/json" } });
    return { error: "이미지는 저장되었으나 메타데이터 갱신이 끝나지 않았습니다. 복구를 다시 실행할 수 있습니다.", code: "OUTPUT_METADATA_PENDING", outputKey: record.outputKey, operationId: record.id };
  }
}
function validateAssets(document) {
  if (Object.keys(document.assets).length > 600) fail("자산 수를 초과했습니다.");
  if (document.originalAssetId && !document.assets[document.originalAssetId]) fail("원본 자산이 없습니다.");
  for (const [assetId, a] of [...Object.entries(document.assets), ...document.preview ? [["preview", document.preview]] : []]) {
    id(assetId);
    hash(a.hash);
    if (a.type !== "image/png" || !Number.isInteger(a.width) || !Number.isInteger(a.height) || a.width < 1 || a.height < 1 || a.width > 1216 || a.height > 1216) fail("자산 규격이 잘못되었습니다.");
  }
  const checkReferences = (doc) => {
    if (doc.originalAssetId && !document.assets[doc.originalAssetId]) fail("원본 자산이 없습니다.");
    for (const layer of doc.layers) {
      if (layer.data.assetId && !document.assets[layer.data.assetId]) fail("레이어 자산이 없습니다.");
      if (layer.mask && !document.assets[layer.mask.assetId]) fail("마스크 자산이 없습니다.");
    }
  };
  checkReferences(document);
  for (const l of document.layers) {
    if (l.data?.assetId && !document.assets[l.data.assetId]) fail("레이어 자산이 없습니다.");
    if (l.mask && !document.assets[l.mask.assetId]) fail("마스크 자산이 없습니다.");
  }
  if (!Array.isArray(document.candidates) || document.candidates.length > 100) fail("후보 수를 초과했습니다.");
  for (const c of document.candidates) {
    if (!document.assets[c.assetId] || !document.assets[c.maskId] || !presetFor(c.width, c.height)) fail("후보 자산이 없습니다.");
    if (c.sourceDocument) {
      validateDocument(c.sourceDocument);
      if (c.sourceDocument.candidates?.length) fail("중첩된 후보 스냅샷은 지원하지 않습니다.");
      checkReferences(c.sourceDocument);
    }
  }
}
async function handleEditorApi(request, env, isAdmin, services = {}) {
  if (!isAdmin) return json({ error: "관리자 권한이 필요합니다." }, 403);
  const url = new URL(request.url), path = url.pathname.slice("/api/editor".length), method = request.method;
  try {
    if (path.startsWith("/assets/")) {
      const assetHash = hash(path.slice(8)), assetKey = `${ROOT}assets/${assetHash}.png`;
      if (method === "PUT") {
        const bytes = await boundedBytes(request, 8 * 1024 * 1024), [w, h] = pngSize(bytes);
        if (w < 1 || h < 1 || w > 1216 || h > 1216) fail("자산 크기를 초과했습니다.");
        if (await digest(bytes) !== assetHash) fail("자산 해시가 일치하지 않습니다.");
        await env.imgBucket.put(assetKey, bytes, { httpMetadata: { contentType: "image/png" }, customMetadata: { width: String(w), height: String(h) }, onlyIf: new Headers({ "If-None-Match": "*" }) });
        return json({ hash: assetHash });
      }
      if (method === "GET" || method === "HEAD") {
        const object = method === "HEAD" ? await env.imgBucket.head(assetKey) : await env.imgBucket.get(assetKey);
        if (!object) return json({ error: "자산을 찾을 수 없습니다." }, 404);
        return new Response(method === "HEAD" ? null : object.body, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
      }
    }
    const previewRoute = path.match(/^\/documents\/([\w-]+)\/preview$/);
    if (previewRoute && method === "GET") {
      const current2 = await getHead(env, id(previewRoute[1]));
      if (!current2?.head.previewHash || current2.head.deleted) return json({ error: "미리보기가 없습니다." }, 404);
      const image = await env.imgBucket.get(`${ROOT}assets/${hash(current2.head.previewHash)}.png`);
      if (!image) return json({ error: "미리보기가 없습니다." }, 404);
      return new Response(image.body, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
    }
    await schema(env);
    if (path === "/documents" && method === "GET") {
      const projectId = String(url.searchParams.get("projectId") || "");
      const result = await env.DB.prepare("SELECT id,title,revision,updated_at FROM editor_workspace_documents WHERE project_id=? AND deleted=0 ORDER BY updated_at DESC LIMIT 100").bind(projectId).all();
      return json({ documents: result.results });
    }
    const match = path.match(/^\/documents\/([\w-]+)(?:\/(versions|export|repair))?$/);
    if (!match) return json({ error: "지원하지 않는 편집 API입니다." }, 404);
    const documentId = id(match[1]), action = match[2], current = await getHead(env, documentId);
    if (action === "repair" && method === "POST") {
      const body = await bodyJson(request), operationId = id(body.operationId), recordKey = `${ROOT}exports/${documentId}/${operationId}.json`, object = await env.imgBucket.get(recordKey);
      if (!object) fail("복구할 저장 작업을 찾을 수 없습니다.", 404);
      const record = await object.json();
      if (record.documentId !== documentId) fail("다른 문서의 저장 작업입니다.");
      const result = await completeOutput(env, services, record, recordKey);
      return json(result, result.error ? 503 : 200);
    }
    if (action === "versions" && method === "GET") {
      if (current) await reconcile(env, documentId, current.head);
      const rows = await env.DB.prepare("SELECT id,created_at FROM editor_workspace_revisions WHERE document_id=? AND state='committed' ORDER BY created_at DESC LIMIT 100").bind(documentId).all();
      return json({ versions: rows.results });
    }
    if (!action && method === "GET") {
      if (!current || current.head.deleted) fail("작업을 찾을 수 없습니다.", 404);
      await reconcile(env, documentId, current.head);
      const version = url.searchParams.get("revision");
      let manifestKey = current.head.manifestKey;
      if (version) {
        const row = await env.DB.prepare("SELECT manifest_key FROM editor_workspace_revisions WHERE id=? AND document_id=? AND state='committed'").bind(id(version), documentId).first();
        if (!row) fail("버전을 찾을 수 없습니다.", 404);
        manifestKey = row.manifest_key;
      }
      const object = await env.imgBucket.get(manifestKey);
      if (!object) fail("작업 자산을 찾을 수 없습니다.", 404);
      return json({ document: await object.json(), revision: current.head.revision, viewRevision: version || current.head.revision });
    }
    if (!action && method === "PUT") {
      if (current?.head.deleted) fail("삭제된 문서입니다. 복제 작업으로 저장하세요.", 409);
      const { document, baseRevision, requestId } = await bodyJson(request);
      id(requestId);
      try {
        validateDocument(document);
        validateAssets(document);
      } catch (error) {
        fail(error.message);
      }
      if (document.id !== documentId) fail("작업 ID가 다릅니다.");
      if (current) await reconcile(env, documentId, current.head);
      const oldRequest = await env.DB.prepare("SELECT state,document_id,manifest_key FROM editor_workspace_revisions WHERE id=?").bind(requestId).first();
      const serialized = JSON.stringify(document), manifestKey = `${ROOT}documents/${documentId}/versions/${requestId}.json`;
      if (oldRequest) {
        if (oldRequest.document_id !== documentId) fail("요청 ID가 다른 문서에서 사용되었습니다.", 409);
        const previous = await env.imgBucket.get(oldRequest.manifest_key);
        if (previous && await previous.text() !== serialized) fail("같은 요청 ID에 다른 내용을 저장할 수 없습니다.", 409);
        if (oldRequest.state === "committed") return json({ revision: requestId });
      }
      if ((current?.head.revision || "0") !== String(baseRevision || "0")) return json({ error: "다른 창에서 작업이 변경되었습니다. 복제 저장 또는 다시 열기를 선택하세요.", code: "REVISION_CONFLICT", revision: current?.head.revision || "0" }, 409);
      for (const a of [...Object.values(document.assets), document.preview].filter(Boolean)) {
        const object = await env.imgBucket.head(`${ROOT}assets/${a.hash}.png`);
        if (!object) fail("자산 업로드가 끝나지 않았습니다.", 409);
        if (Number(object.customMetadata?.width) !== a.width || Number(object.customMetadata?.height) !== a.height) fail("자산 크기 정보가 일치하지 않습니다.");
      }
      const created = await env.imgBucket.put(manifestKey, serialized, { httpMetadata: { contentType: "application/json" }, onlyIf: new Headers({ "If-None-Match": "*" }) });
      if (document.sourceKey && !current) {
        const original = await env.imgBucket.head(document.sourceKey);
        if (original) await env.imgBucket.put(`${ROOT}documents/${documentId}/source-metadata.json`, JSON.stringify({ customMetadata: original.customMetadata, fileMetadata: await services.readMetadata?.(env, document.sourceKey) }), { httpMetadata: { contentType: "application/json" }, onlyIf: new Headers({ "If-None-Match": "*" }) });
      }
      if (!created) {
        const previous = await env.imgBucket.get(manifestKey);
        if (!previous || await previous.text() !== serialized) fail("요청 ID가 충돌했습니다.", 409);
      }
      await env.DB.prepare("INSERT OR IGNORE INTO editor_workspace_revisions (id,document_id,manifest_key,state,created_at) VALUES(?,?,?,'pending',?)").bind(requestId, documentId, manifestKey, (/* @__PURE__ */ new Date()).toISOString()).run();
      const head = { revision: requestId, manifestKey, previewHash: document.preview?.hash || "", projectId: String(document.projectId || ""), title: String(document.title || "작업").slice(0, 200), updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      const committed = await env.imgBucket.put(`${ROOT}documents/${documentId}/head.json`, JSON.stringify(head), { httpMetadata: { contentType: "application/json" }, onlyIf: current ? { etagMatches: current.object.etag } : new Headers({ "If-None-Match": "*" }) });
      if (!committed) fail("동시 저장 충돌입니다. 현재 작업을 복제해 저장하세요.", 409);
      await reconcile(env, documentId, head);
      return json({ revision: requestId });
    }
    if (!action && method === "DELETE") {
      if (current) {
        const result = await env.imgBucket.put(`${ROOT}documents/${documentId}/head.json`, JSON.stringify({ ...current.head, deleted: true }), { onlyIf: { etagMatches: current.object.etag }, httpMetadata: { contentType: "application/json" } });
        if (!result) fail("문서가 변경되었습니다. 다시 삭제하세요.", 409);
      }
      await env.DB.prepare("UPDATE editor_workspace_documents SET deleted=1 WHERE id=?").bind(documentId).run();
      return json({ deleted: true });
    }
    if (action === "export" && method === "POST") {
      if (!current || current.head.deleted) fail("먼저 작업문서를 저장하세요.", 409);
      if (request.headers.get("X-Editor-Revision") !== current.head.revision) fail("작업 버전이 변경되었습니다. 다시 출력하세요.", 409);
      const bytes = await boundedBytes(request, 8 * 1024 * 1024), outputKey = key(url.searchParams.get("key") || ""), format = url.searchParams.get("format"), types = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };
      if (!types[format] || !outputKey.toLowerCase().endsWith(format === "jpeg" ? ".jpg" : `.${format}`)) fail("파일 확장자와 형식이 다릅니다.");
      const manifest = await env.imgBucket.get(current.head.manifestKey), doc = await manifest.json();
      const [width, height] = outputSize(bytes, format);
      if (!presetFor(width, height) || width !== doc.width || height !== doc.height) fail("출력 크기가 저장된 문서 규격과 다릅니다.");
      const snapshotObject = await env.imgBucket.get(`${ROOT}documents/${documentId}/source-metadata.json`), sourceSnapshot = snapshotObject ? await snapshotObject.json() : null;
      const source = doc.sourceKey ? await env.imgBucket.head(doc.sourceKey) : null, existing = await env.imgBucket.get(outputKey), expected = url.searchParams.get("etag");
      if (existing && expected !== existing.etag) return json({ error: "이미 존재하는 파일입니다. 확인 후 다시 저장하세요.", etag: existing.etag, code: "OUTPUT_EXISTS" }, 409);
      if (!existing && expected) fail("대상이 변경되었습니다. 다시 저장하세요.", 409);
      if (existing) {
        const backup = `${ROOT}backups/${documentId}/${crypto.randomUUID()}`;
        await env.imgBucket.put(`${backup}/image`, existing.body, { httpMetadata: existing.httpMetadata, customMetadata: existing.customMetadata });
        await env.imgBucket.put(`${backup}/metadata.json`, JSON.stringify({ outputKey, httpMetadata: existing.httpMetadata, customMetadata: existing.customMetadata, metadata: await services.readMetadata?.(env, outputKey) }));
      }
      const metadata = { ...sourceSnapshot?.customMetadata || source?.customMetadata || {}, ...makeR2ImageVisibilityMetadata(outputKey, existing?.customMetadata || sourceSnapshot?.customMetadata || source?.customMetadata, { preserveExplicitPrivate: true }), editorDocumentId: documentId, editorRevision: current.head.revision };
      const operationId = id(request.headers.get("X-Editor-Request") || crypto.randomUUID()), recordKey = `${ROOT}exports/${documentId}/${operationId}.json`, base = sourceSnapshot?.fileMetadata || (doc.sourceKey ? await services.readMetadata(env, doc.sourceKey) : {});
      const record = { id: operationId, documentId, revision: current.head.revision, outputKey, hash: await digest(bytes), state: "prepared", createdAt: (/* @__PURE__ */ new Date()).toISOString(), fileMetadata: { ...base, edited: true, editorDocumentId: documentId, editorRevision: current.head.revision, derivedFromKey: doc.sourceKey, editedAt: (/* @__PURE__ */ new Date()).toISOString() } };
      const prepared = await env.imgBucket.put(recordKey, JSON.stringify(record), { httpMetadata: { contentType: "application/json" }, onlyIf: new Headers({ "If-None-Match": "*" }) });
      if (!prepared) fail("같은 출력 요청이 이미 있습니다. 복구를 사용하세요.", 409);
      const output = await env.imgBucket.put(outputKey, bytes, { httpMetadata: { contentType: types[format] }, customMetadata: metadata, onlyIf: existing ? { etagMatches: existing.etag } : new Headers({ "If-None-Match": "*" }) });
      if (!output) fail("출력 대상이 변경되었습니다. 다시 저장하세요.", 409);
      record.etag = output.etag;
      record.state = "image-written";
      await env.imgBucket.put(recordKey, JSON.stringify(record), { httpMetadata: { contentType: "application/json" } });
      const result = await completeOutput(env, services, record, recordKey);
      return json(result, result.error ? 503 : 200);
    }
    return json({ error: "지원하지 않는 요청입니다." }, 405);
  } catch (error) {
    return json({ error: error.message || "작업 처리 실패" }, error.status || 500);
  }
}
export {
  handleEditorApi
};
