import { validateDocument } from "../../public/js/editor/model.js";
import { makeR2ImageVisibilityMetadata } from "../image-serving.js";
import { ROOT, AUTO_AGE, TICKET_AGE, identifier, scopeFor, objectJson, listAll, removeKeys, putJson, condition, reserveAutosave, releaseAutosave, collectAssets, cleanupProject, deleteWork, withScopeLock } from "./r2-store.js";

const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
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
function validateAssets(document) {
  validateDocument(document);
  if (document.candidates?.length) fail('이 편집기에서는 생성 후보를 저장하지 않습니다.');
  const assets = [...Object.values(document.assets), document.preview].filter(Boolean);
  if (assets.length > 601) fail('자산 수를 초과했습니다.');
  for (const a of assets) {
    hash(a.hash);
    if (a.type !== 'image/png' || !Number.isInteger(a.bytes) || a.bytes < 1 || a.bytes > 8 * 1024 * 1024 || !Number.isInteger(a.width) || !Number.isInteger(a.height) || a.width < 1 || a.height < 1 || a.width > 1216 || a.height > 1216) fail('자산 규격이 잘못되었습니다.');
  }
  const referenced = [document.originalAssetId, ...document.layers.flatMap(l => [l.data.assetId, l.mask?.assetId])].filter(Boolean);
  if (referenced.some(id => !Object.hasOwn(document.assets, id))) fail('참조 자산이 없습니다.');
  return [...new Map(assets.map(a => [a.hash, a])).values()];
}
function recordPayload(body, scope) {
  const assets = validateAssets(body.document);
  if (body.document.id !== scope.documentId || (body.document.projectId || 'global') !== scope.projectId) fail('작업과 프로젝트가 일치하지 않습니다.');
  for (const field of ['stateId', 'manualStateId', 'initialStateId']) identifier(body[field]);
  if (typeof body.document.title !== 'string' || body.document.title.length > 200) fail('작업 이름은 200자 이내로 입력하세요.');
  if (body.document.sourceKey) key(body.document.sourceKey);
  return assets;
}
const ticketMetadata = ticket => ({ expires: String(ticket.expires), headKey: ticket.scope.headKey, kind: ticket.scope.kind });
const outputMetadataKey = async outputKey => `${ROOT}output-metadata/${await digest(new TextEncoder().encode(outputKey))}.json`;
async function ticketFor(bucket, projectId, ticketId) {
  const ticket = await objectJson(bucket, `${ROOT}${identifier(projectId)}/tickets/${identifier(ticketId)}.json`);
  if (!ticket || ticket.data.expires < Date.now() || ticket.data.state === 'cancelled') fail('저장 요청이 만료되었습니다. 다시 저장하세요.', 410);
  return ticket.data;
}
async function ensureAlive(bucket, ticket) {
  const current = await objectJson(bucket, ticket.scope.headKey);
  if (current?.data.deleted) fail('삭제한 작업은 다시 저장할 수 없습니다.', 410);
  if(ticket.scope.kind==='autosave'&&ticket.manualRevision&&ticket.manualRevision!=='0'){const saved=await objectJson(bucket,`${ticket.scope.project}saved/documents/${ticket.scope.documentId}.json`);if(!saved||saved.data.deleted)fail('정식 작업이 삭제되었습니다. 다른 이름으로 저장하세요.',410);}
  return current;
}
async function assetHeads(bucket,scope,assets){
  const heads=[];
  for(let offset=0;offset<assets.length;offset+=8)heads.push(...await Promise.all(assets.slice(offset,offset+8).map(a=>bucket.head(`${scope.assetPrefix}${a.hash}.png`))));
  return heads;
}
async function prepare(bucket, scope, body) {
  const assets = recordPayload(body, scope), requestId = identifier(body.requestId), now = Date.now();
  const ticketKey = `${scope.project}tickets/${requestId}.json`, manifestHash = await digest(new TextEncoder().encode(JSON.stringify(body)));
  const existing = await objectJson(bucket, ticketKey);
  if (existing) {
    if (existing.data.manifestHash !== manifestHash) fail('같은 저장 요청의 내용이 바뀌었습니다.', 409);
    if (existing.data.expires < now || existing.data.state === 'cancelled') fail('저장 요청이 만료되었습니다.', 410);
    return { ticketId: requestId, missing: existing.data.missing };
  }
  const current = await objectJson(bucket, scope.headKey);
  if (current?.data.deleted) fail('삭제된 작업입니다.', 410);
  if ((current?.object.etag || '0') !== String(body.baseRevision || '0')) fail('다른 창에서 작업이 변경되었습니다. 다시 불러오거나 다른 이름으로 저장하세요.', 409);
  if (scope.kind === 'autosave' && body.manualRevision && body.manualRevision !== '0') {
    const saved = await objectJson(bucket, `${scope.project}saved/documents/${scope.documentId}.json`);
    if (!saved || saved.data.deleted) fail('정식 작업이 삭제되었습니다. 다른 이름으로 저장하세요.', 410);
  }
  const heads=await assetHeads(bucket,scope,assets),missing=assets.filter((a,index)=>!heads[index]).map(a=>a.hash);
  const ticket = { id: requestId, scope, manualRevision:body.manualRevision||'0', baseRevision: current?.object.etag || '0', manifestHash, assets, missing, expires: now + TICKET_AGE, state: 'uploading' };
  if (scope.kind === 'autosave') {
    const bytes = assets.filter(a => missing.includes(a.hash)).reduce((n, a) => n + a.bytes, 0) + new TextEncoder().encode(JSON.stringify(body)).length + new TextEncoder().encode(JSON.stringify(ticket)).length;
    await reserveAutosave(bucket, scope, requestId, bytes);
  }
  const result = await putJson(bucket, ticketKey, ticket, { onlyIf: condition(), customMetadata: ticketMetadata(ticket) });
  if (!result) fail('저장 요청이 겹쳤습니다. 다시 시도하세요.', 409);
  return { ticketId: requestId, missing };
}
async function commit(bucket, ticket, body) {
  if(ticket.state==='committed'){await ensureAlive(bucket,ticket);return{revision:ticket.revision};}
  if (await digest(new TextEncoder().encode(JSON.stringify(body))) !== ticket.manifestHash) fail('준비한 저장 내용과 다릅니다.');
  const current = await ensureAlive(bucket, ticket);
  if (current?.data.requestId === ticket.id) return { revision: current.object.etag };
  if ((current?.object.etag || '0') !== ticket.baseRevision) fail('작업 저장이 충돌했습니다. 다른 이름으로 저장하거나 다시 불러오세요.', 409);
  const heads=await assetHeads(bucket,ticket.scope,ticket.assets);
  for(const [index,a] of ticket.assets.entries()){
    const object=heads[index];
    if (!object || object.size !== a.bytes || Number(object.customMetadata?.width) !== a.width || Number(object.customMetadata?.height) !== a.height) fail('자산 업로드가 끝나지 않았습니다.', 409);
  }
  const updatedAt = new Date().toISOString();
  const record = { document: body.document, stateId: body.stateId, manualStateId: body.manualStateId, initialStateId: body.initialStateId, manualRevision: body.manualRevision || '0', requestId: ticket.id, updatedAt };
  const customMetadata = { id: ticket.scope.documentId, title: body.document.title || '제목 없음', updatedAt, stateId: body.stateId, sessionId: ticket.scope.sessionId, kind: ticket.scope.kind };
  const result = await putJson(bucket, ticket.scope.headKey, record, { onlyIf: condition(current?.object), customMetadata });
  if (!result) fail('작업 저장이 충돌했습니다.', 409);
  ticket.state = 'committed'; ticket.revision = result.etag; ticket.assets = []; ticket.missing = [];
  await putJson(bucket, `${ticket.scope.project}tickets/${ticket.id}.json`, ticket, { customMetadata: ticketMetadata(ticket) });
  // A committed head is authoritative even if best-effort housekeeping must retry.
  await collectAssets(bucket, ticket.scope,true).catch(() => {});
  if (ticket.scope.kind === 'autosave') await releaseAutosave(bucket, ticket.scope.project, ticket.id).catch(() => {});
  return { revision: result.etag, updatedAt };
}
async function legacyInventory(bucket, includeOutputs) {
  const objects = [];
  for (const prefix of ['__editor/', '__editor_sessions/', '__editor_backups/', 'editor_sessions/', 'editor_session/']) {
    objects.push(...(await listAll(bucket, prefix)).filter(o => !o.key.startsWith(ROOT)));
  }
  if (includeOutputs) {
    const sources = new Set(), records = [];
    // A legacy output used as a current original is no longer disposable test output.
    for(const object of (await listAll(bucket,ROOT)).filter(o=>/\/documents\/[^/]+\.json$/.test(o.key))){
      const work=await objectJson(bucket,object.key).catch(()=>null);
      if(work?.data.document?.sourceKey)sources.add(work.data.document.sourceKey);
    }
    for (const object of objects.filter(o => o.key.startsWith('__editor/exports/') && o.key.endsWith('.json'))) {
      const record = await objectJson(bucket, object.key).catch(()=>null);
      if (!record?.data.outputKey) continue;
      if (record.data.fileMetadata?.derivedFromKey) sources.add(record.data.fileMetadata.derivedFromKey);
      records.push(record.data);
    }
    for (const object of objects.filter(o => /\/head\.json$/.test(o.key))) {
      const head = await objectJson(bucket, object.key).catch(()=>null);
      if (head?.data.manifestKey) {
        const manifest = await objectJson(bucket, head.data.manifestKey).catch(()=>null);
        if (manifest?.data.sourceKey) sources.add(manifest.data.sourceKey);
      }
    }
    for (const record of records) {
      if(sources.has(record.outputKey)||/(^|\/)0\.(webp|png|jpe?g)$/i.test(record.outputKey))continue;
      const output = await bucket.head(record.outputKey);
      if (output?.customMetadata?.editorDocumentId === record.documentId) objects.push(output);
    }
  }
  const unique = [...new Map(objects.map(o => [o.key, o])).values()].sort((a, b) => a.key.localeCompare(b.key));
  return { objects: unique, token: await digest(new TextEncoder().encode(JSON.stringify(unique.map(o => [o.key, o.etag])))) };
}
export async function handleEditorApi(request, capabilities, isAdmin) {
  if (!isAdmin) return json({ error: '관리자 권한이 필요합니다.' }, 403);
  const bucket = capabilities.bucket, url = new URL(request.url), method = request.method;
  if (!url.pathname.startsWith('/api/editor/v2/')) return json({ error: '편집기가 새 버전으로 변경되었습니다. 페이지를 새로고침하세요.', code: 'EDITOR_UPGRADE_REQUIRED' }, 410);
  if (method !== 'GET' && method !== 'HEAD' && request.headers.get('X-Editor-Protocol') !== '2') return json({ error: '새 편집기에서 다시 실행하세요.' }, 410);
  const path = url.pathname.slice('/api/editor/v2'.length);
  try {
    if(path==='/maintenance/output-repair'&&method==='POST'){
      const body=await bodyJson(request),operationId=identifier(body.operationId),operationKey=`${ROOT}output-operations/${operationId}.json`,operation=await objectJson(bucket,operationKey);
      if(!operation)fail('재시도할 출력 정보를 찾을 수 없습니다.',404);
      const image=await bucket.head(operation.data.outputKey);
      if(!image||image.customMetadata?.editorOperationId!==operationId)fail('이미지가 다른 내용으로 바뀌었습니다. 다시 내보내세요.',409);
      await putJson(bucket,await outputMetadataKey(operation.data.outputKey),{...operation.data.metadata,etag:image.etag});
      await bucket.delete(operationKey);return json({outputKey:operation.data.outputKey});
    }
    if (path === '/maintenance/legacy') {
      if(!['GET','POST'].includes(method))return json({error:'지원하지 않는 요청입니다.'},405);
      const body = method === 'POST' ? await bodyJson(request) : null, includeOutputs = body?.includeOutputs === true || url.searchParams.get('includeOutputs') === '1';
      const inventory = await legacyInventory(bucket, includeOutputs);
      if (method === 'POST') {
        if (body.token !== inventory.token) fail('정리 대상이 변경되었습니다. 목록을 다시 확인하세요.', 409);
        await removeKeys(bucket, inventory.objects.map(o => o.key));
        return json({ deleted: inventory.objects.length });
      }
      return json({ token: inventory.token, count: inventory.objects.length, bytes: inventory.objects.reduce((n, o) => n + o.size, 0), keys: inventory.objects.map(o => o.key) });
    }
    const projectId = identifier(url.searchParams.get('projectId') || 'global'), project = `${ROOT}${projectId}/`;
    if (path === '/documents' && method === 'GET') {
      await cleanupProject(bucket, projectId);
      const kind = url.searchParams.get('kind') === 'autosave' ? 'autosave' : 'saved';
      const objects = await listAll(bucket, kind === 'saved' ? `${project}saved/documents/` : `${project}autosave/`, true);
      const documents = objects.filter(o => o.key.includes('/documents/') && o.customMetadata?.deleted !== '1').map(o => ({ ...o.customMetadata, revision: o.etag, kind, id: o.customMetadata.id, updatedAt: o.customMetadata.updatedAt || o.uploaded.toISOString() })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return json({ documents });
    }
    const ticketMatch = path.match(/^\/tickets\/([\w-]+)\/(assets\/([a-f0-9]{64})|commit)$/);
    if (ticketMatch) {
      const ticket = await ticketFor(bucket, projectId, ticketMatch[1]);
      if (ticketMatch[2] === 'commit' && method === 'POST') {const body=await bodyJson(request);return json(await withScopeLock(bucket,ticket.scope,async()=>commit(bucket,await ticketFor(bucket,projectId,ticket.id),body)));}
      if(ticketMatch[3]&&method==='PUT'){
        const a=ticket.assets.find(a=>a.hash===ticketMatch[3]);if(!a)fail('예약하지 않은 자산입니다.');
        const bytes=await boundedBytes(request,8*1024*1024),[width,height]=pngSize(bytes);
        if(bytes.length!==a.bytes||width!==a.width||height!==a.height||await digest(bytes)!==a.hash)fail('자산 내용이 일치하지 않습니다.');
        return await withScopeLock(bucket,ticket.scope,async()=>{
          const fresh=await ticketFor(bucket,projectId,ticket.id);if(fresh.state!=='uploading')fail('이미 종료된 저장 요청입니다.',409);
          await ensureAlive(bucket,fresh);
          await bucket.put(`${fresh.scope.assetPrefix}${a.hash}.png`,bytes,{onlyIf:condition(),httpMetadata:{contentType:'image/png'},customMetadata:{width:String(width),height:String(height)}});
          return json({hash:a.hash});
        });
      }
    }

    const match = path.match(/^\/documents\/([\w-]+)(?:\/(prepare|preview|assets\/([a-f0-9]{64})|export))?$/);
    if (!match) return json({ error: '지원하지 않는 편집 요청입니다.' }, 404);
    const scope = scopeFor(url, match[1]), action = match[2];
    if(action==='prepare'&&method==='POST'){await cleanupProject(bucket,scope.projectId);const body=await bodyJson(request);return json(await withScopeLock(bucket,scope,()=>prepare(bucket,scope,body)));}
    const current = await objectJson(bucket, scope.headKey);
    if (method === 'DELETE' && !action) {
      await deleteWork(bucket, scope);
      if (scope.kind === 'saved') {
        for (const object of (await listAll(bucket, `${project}autosave/`, true)).filter(o => o.customMetadata?.id === scope.documentId)) {
          const auto = scopeFor(new URL(`https://editor.invalid/?projectId=${projectId}&kind=autosave&sessionId=${object.customMetadata.sessionId}`), scope.documentId);
          await deleteWork(bucket, auto);
        }
      }
      return json({ deleted: true });
    }
    if (!current || current.data.deleted) fail('작업을 찾을 수 없습니다.', 404);
    if(scope.kind==='autosave'&&Date.parse(current.data.updatedAt)+AUTO_AGE<Date.now()){await deleteWork(bucket,scope);fail('임시 편집 보관 기간이 만료되었습니다.',410);}
    if (!action && method === 'GET') return json({ ...current.data, revision: current.object.etag });
    if ((action === 'preview' || match[3]) && method === 'GET') {
      const assetHash = action === 'preview' ? current.data.document.preview?.hash : match[3];
      const refs = [...Object.values(current.data.document.assets), current.data.document.preview].filter(Boolean);
      if (!assetHash || !refs.some(a => a.hash === assetHash)) fail('작업 이미지가 없습니다.', 404);
      const object = await bucket.get(`${scope.assetPrefix}${assetHash}.png`); if (!object) fail('작업 이미지가 없습니다.', 404);
      return new Response(object.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (action === 'export' && method === 'POST') {
      if (request.headers.get('X-Editor-Revision') !== current.object.etag) fail('출력 중 작업이 변경되었습니다. 다시 실행하세요.', 409);
      const doc = current.data.document, outputKey = key(url.searchParams.get('key')), format = url.searchParams.get('format'), types = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
      if (!types[format] || !outputKey.toLowerCase().endsWith(format === 'jpeg' ? '.jpg' : `.${format}`)) fail('이미지 형식이 잘못되었습니다.');
      if (!doc.prefix || !outputKey.startsWith(doc.prefix) || outputKey === doc.sourceKey) fail('원본을 덮어쓰지 않도록 프로젝트 안의 새 이미지 이름을 지정하세요.');
      const existing=await bucket.get(outputKey),expected=url.searchParams.get('etag');
      if(existing&&!expected)return json({error:'같은 이름의 이미지가 있습니다.',code:'OUTPUT_EXISTS',etag:existing.etag},409);
      if(expected&&existing?.etag!==expected)fail('출력 대상이 변경되었습니다. 다시 실행하세요.',409);
      const bytes = await boundedBytes(request, 8 * 1024 * 1024), [width, height] = outputSize(bytes, format);
      if (width !== doc.width || height !== doc.height) fail('출력 규격이 다릅니다.');
      const sidecarKey = await outputMetadataKey(outputKey), previousMetadata = await objectJson(bucket, sidecarKey);
      if (existing) {
        const backup = `${ROOT}output-backups/${await digest(new TextEncoder().encode(outputKey))}`;
        await bucket.put(`${backup}/image`, existing.body, { httpMetadata: existing.httpMetadata, customMetadata: existing.customMetadata });
        await putJson(bucket, `${backup}/metadata.json`, previousMetadata?.data || {});
      }
      const source = doc.sourceKey ? await bucket.head(doc.sourceKey) : null;
      const metadata = { ...source?.customMetadata, ...makeR2ImageVisibilityMetadata(outputKey, existing?.customMetadata || source?.customMetadata, { preserveExplicitPrivate: true }), editorDocumentId: doc.id, editorState: current.data.stateId };
      const operationId=identifier(request.headers.get('X-Editor-Request')||crypto.randomUUID()),operationKey=`${ROOT}output-operations/${operationId}.json`;
      metadata.editorOperationId=operationId;
      const outputMetadata={outputKey,edited:true,editorDocumentId:doc.id,derivedFromKey:doc.sourceKey,editedAt:new Date().toISOString(),width,height,format};
      await putJson(bucket,operationKey,{outputKey,metadata:outputMetadata,createdAt:Date.now()});
      const result = await bucket.put(outputKey, bytes, { onlyIf: condition(existing), httpMetadata: { contentType: types[format] }, customMetadata: metadata });
      if (!result){await bucket.delete(operationKey);fail('출력 대상이 바뀌었습니다. 다시 실행하세요.',409);}
      try{await putJson(bucket,sidecarKey,{...outputMetadata,etag:result.etag});await bucket.delete(operationKey);}
      catch{return json({error:'이미지는 저장됐지만 연결 정보 저장이 지연되었습니다.',code:'OUTPUT_METADATA_PENDING',operationId,outputKey},503);}
      return json({ outputKey });
    }
    return json({ error: '지원하지 않는 편집 요청입니다.' }, 405);
  } catch (error) { return json({ error: error.message || '작업 처리 실패', ...(error.code ? { code: error.code } : {}) }, error.status || 500); }
}
export { outputMetadataKey };
