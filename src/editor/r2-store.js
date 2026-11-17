export const ROOT = '__editor/v2/';
export const AUTO_BYTES = 256 * 1024 * 1024;
export const AUTO_COUNT = 10;
export const AUTO_AGE = 7 * 86400000;
export const TICKET_AGE = 10 * 60000;
export const fail = (message, status = 400, code = '') => { throw Object.assign(new Error(message), { status, code }); };
export function identifier(value) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(value || '')) fail('작업 식별자가 올바르지 않습니다.');
    return value;
}
export function scopeFor(url, documentId) {
    const projectId = identifier(url.searchParams.get('projectId') || 'global');
    const kind = url.searchParams.get('kind') || 'saved';
    if (!['saved', 'autosave'].includes(kind)) fail('저장 종류가 잘못되었습니다.');
    const sessionId = kind === 'autosave' ? identifier(url.searchParams.get('sessionId')) : '';
    const project = `${ROOT}${projectId}/`, base = project + (kind === 'saved' ? 'saved/' : `autosave/${sessionId}/`);
    return { projectId, kind, sessionId, documentId: identifier(documentId), project, base,
        headKey: `${base}documents/${documentId}.json`, assetPrefix: `${base}assets/${documentId}/` };
}
export async function objectJson(bucket, key) {
    const object = await bucket.get(key);
    return object ? { object, data: await object.json() } : null;
}
export async function listAll(bucket, prefix, metadata = false) {
    const objects = []; let cursor;
    do {
        const result = await bucket.list({ prefix, ...(metadata ? { include: ['customMetadata'] } : {}), ...(cursor ? { cursor } : {}) });
        objects.push(...result.objects); cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);
    return objects;
}
export async function removeKeys(bucket, keys) {
    for (let i = 0; i < keys.length; i += 100) await bucket.delete(keys.slice(i, i + 100));
}
export const putJson = (bucket, key, data, options = {}) => bucket.put(key, JSON.stringify(data), { httpMetadata: { contentType: 'application/json' }, ...options });
export const condition = (object) => object ? { etagMatches: object.etag } : new Headers({ 'If-None-Match': '*' });
// Every asset mutation and collection for one scope shares this short R2 lease.
// CAS on the document alone cannot protect referenced blobs from concurrent collection.
export async function withScopeLock(bucket,scope,work){
    const key=`${scope.project}locks/${scope.documentId}.json`,owner=crypto.randomUUID();
    const old=await objectJson(bucket,key),now=Date.now();
    if(old&&old.data.expires>now)fail('같은 작업의 저장이 진행 중입니다. 잠시 후 다시 시도하세요.',423);
    const acquired=await putJson(bucket,key,{owner,expires:now+120000},{onlyIf:condition(old?.object)});
    if(!acquired)fail('같은 작업의 요청이 겹쳤습니다. 잠시 후 다시 시도하세요.',423);
    try{return await work();}finally{
        // Conditional replacement, rather than unconditional deletion, never releases a newer lease.
        await putJson(bucket,key,{owner,expires:0},{onlyIf:{etagMatches:acquired.etag}}).catch(()=>{});
    }
}
export async function reserveAutosave(bucket, scope, ticketId, bytes) {
    const key = `${scope.project}quota.json`;
    for (let retry = 0; retry < 8; retry++) {
        const old = await objectJson(bucket, key), now = Date.now();
        const reservations = Object.fromEntries(Object.entries(old?.data.reservations || {}).filter(([, r]) => r.expires > now));
        const objects = await listAll(bucket, `${scope.project}autosave/`, true);
        const receipts=(await listAll(bucket,`${scope.project}tickets/`,true)).filter(o=>o.customMetadata?.kind==='autosave');
        const used = [...objects,...receipts].reduce((n, o) => n + o.size, 0);
        const pending = Object.values(reservations).reduce((n, r) => n + r.bytes, 0);
        const works = new Set(objects.filter(o => o.key.includes('/documents/') && o.customMetadata?.deleted !== '1').map(o => o.key));
        for (const r of Object.values(reservations)) works.add(r.headKey);
        if (!works.has(scope.headKey) && works.size >= AUTO_COUNT) fail('임시 작업이 10개입니다. 작업 불러오기에서 불필요한 임시 편집을 삭제하세요.', 507, 'AUTOSAVE_LIMIT');
        // Reservations include pending transfers. Counting uploaded pending bytes twice is
        // conservative, so concurrent uploads cannot silently exceed the admitted budget.
        if (used + pending + bytes + 8192 > AUTO_BYTES) fail('임시 저장 공간이 가득 찼습니다. 작업을 정식 저장하거나 불필요한 임시 편집을 삭제하세요.', 507, 'AUTOSAVE_LIMIT');
        reservations[ticketId] = { bytes: bytes + 8192, headKey: scope.headKey, expires: now + TICKET_AGE * 2 };
        if (await putJson(bucket, key, { reservations }, { onlyIf: condition(old?.object) })) return;
    }
    fail('임시 저장 예약이 겹쳤습니다. 잠시 후 다시 저장하세요.', 409);
}
export async function releaseAutosave(bucket, project, ticketId) {
    const key = `${project}quota.json`;
    for (let retry = 0; retry < 6; retry++) {
        const old = await objectJson(bucket, key); if (!old) return;
        delete old.data.reservations?.[ticketId];
        if (await putJson(bucket, key, old.data, { onlyIf: condition(old.object) })) return;
    }
}
export async function activeTickets(bucket, project, scope) {
    const tickets = [];
    for (const object of await listAll(bucket, `${project}tickets/`, true)) {
        if (Number(object.customMetadata?.expires) <= Date.now()) continue;
        if (scope && object.customMetadata?.headKey !== scope.headKey) continue;
        const record = await objectJson(bucket, object.key);
        if (record && record.data.expires > Date.now() && record.data.state === 'uploading') tickets.push(record.data);
    }
    return tickets;
}
export async function collectAssets(bucket, scope, locked=false) {
    if(!locked)return withScopeLock(bucket,scope,()=>collectAssets(bucket,scope,true));
    const current = await objectJson(bucket, scope.headKey), keep = new Set();
    if (current && !current.data.deleted) for (const item of [...Object.values(current.data.document.assets), current.data.document.preview].filter(Boolean)) keep.add(item.hash);
    for (const ticket of await activeTickets(bucket, scope.project, scope)) for (const item of ticket.assets) keep.add(item.hash);
    const objects = await listAll(bucket, scope.assetPrefix);
    await removeKeys(bucket, objects.filter(o => !keep.has(o.key.split('/').at(-1).replace(/\.png$/, ''))).map(o => o.key));
}
export async function deleteWork(bucket, scope, locked=false) {
    if(!locked)return withScopeLock(bucket,scope,()=>deleteWork(bucket,scope,true));
    const current = await objectJson(bucket, scope.headKey);
    if (current?.data.deleted) { await collectAssets(bucket, scope,true); return; }
    // A small expiring barrier prevents an already prepared request from reviving a
    // deleted work. Pixel assets are physically removed; this is not a soft delete.
    const tombstone = { deleted: true, expires: Date.now() + 86400000 };
    const result = await putJson(bucket, scope.headKey, tombstone, { onlyIf: condition(current?.object), customMetadata: { deleted: '1', expires: String(tombstone.expires) } });
    if (!result) fail('작업이 변경되었습니다. 목록을 새로 연 뒤 삭제하세요.', 409);
    for (const ticket of await activeTickets(bucket, scope.project, scope)) {
        ticket.state = 'cancelled';
        await putJson(bucket, `${scope.project}tickets/${ticket.id}.json`, ticket, { customMetadata: { expires: String(ticket.expires), headKey: scope.headKey, kind: scope.kind } });
        if (scope.kind === 'autosave') await releaseAutosave(bucket, scope.project, ticket.id);
    }
    await removeKeys(bucket, (await listAll(bucket, scope.assetPrefix)).map(o => o.key));
}
export async function cleanupProject(bucket, projectId) {
    const project = `${ROOT}${identifier(projectId)}/`, now = Date.now(); let removed = 0;
    const objects = await listAll(bucket, `${project}autosave/`, true);
    for (const object of objects.filter(o => o.key.includes('/documents/'))) {
        const sessionId = object.key.slice((project + 'autosave/').length).split('/')[0], documentId = object.key.split('/').at(-1).replace(/\.json$/, '');
        const url = new URL(`https://editor.invalid/?projectId=${projectId}&kind=autosave&sessionId=${sessionId}`), scope = scopeFor(url, documentId);
        const current = await objectJson(bucket, scope.headKey); if (!current) continue;
        if (current.data.deleted) {
            if(current.data.expires<now)await withScopeLock(bucket,scope,async()=>{const check=await objectJson(bucket,scope.headKey);if(check?.data.deleted&&check.data.expires<now){await removeKeys(bucket,(await listAll(bucket,scope.assetPrefix)).map(o=>o.key));await bucket.delete(scope.headKey);removed++;}});
        }else if(Date.parse(current.data.updatedAt)+AUTO_AGE<now){await withScopeLock(bucket,scope,async()=>{const check=await objectJson(bucket,scope.headKey);if(check&&!check.data.deleted&&Date.parse(check.data.updatedAt)+AUTO_AGE<now){await deleteWork(bucket,scope,true);removed++;}});}
    }
    for (const object of await listAll(bucket, `${project}tickets/`, true)) {
        if (Number(object.customMetadata?.expires) + TICKET_AGE > now) continue;
        const record = await objectJson(bucket, object.key);
        if (record?.data.scope) await collectAssets(bucket, record.data.scope);
        await bucket.delete(object.key); await releaseAutosave(bucket, project, object.key.split('/').at(-1).replace(/\.json$/, '')); removed++;
    }
    // Saved-work tombstones are also bounded; all request tickets expire much earlier.
    for (const object of await listAll(bucket, `${project}saved/documents/`, true)) {
        if(object.customMetadata?.deleted==='1'&&Number(object.customMetadata.expires)<now){const scope=scopeFor(new URL(`https://editor.invalid/?projectId=${projectId}`),object.key.split('/').at(-1).replace(/\.json$/,''));await withScopeLock(bucket,scope,async()=>{const check=await objectJson(bucket,object.key);if(check?.data.deleted&&check.data.expires<now)await bucket.delete(object.key);});}
    }
    // Released leases are control data, not permanent work records.
    for(const object of await listAll(bucket,`${project}locks/`)){
        if(object.uploaded.getTime()+86400000>=now)continue;
        const documentId=object.key.split('/').at(-1).replace(/\.json$/,''),scope=scopeFor(new URL(`https://editor.invalid/?projectId=${projectId}`),documentId);
        await withScopeLock(bucket,scope,()=>bucket.delete(object.key));
    }
    return removed;
}
