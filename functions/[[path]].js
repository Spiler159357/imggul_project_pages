// functions/[[path]].js
import {
    cancelPlannerBackgroundJob,
    getPlannerBackgroundStatus,
    jsonResponse,
    startPlannerBackgroundJob
} from "../src/planner-background.js";
// Cloudflare Pages Functions - Catch-all 라우터 및 API 서버리스 핸들러

/**
 * 역할: R2 object key가 텍스트 메모 파일인지 판별한다.
 * 매개변수: key - 검사할 파일 경로 문자열.
 * 주요 변수: key - 소문자로 변환해 확장자를 확인한다.
 * 반환값: .txt로 끝나면 true, 아니면 false.
 */
function isTextFile(key) {
    return key.toLowerCase().endsWith('.txt');
}

/**
 * 역할: R2 object key를 폴더 prefix와 파일명으로 분리한다.
 * 매개변수: key - 분리할 전체 경로 문자열.
 * 주요 변수: parts, fileName, prefix - 경로 조각과 마지막 파일명.
 * 반환값: { prefix, fileName } 형태의 객체.
 */
function splitPath(key) {
    const parts = key.split('/');
    const fileName = parts.pop();
    const prefix = parts.length > 0 ? parts.join('/') + '/' : '';
    return { prefix, fileName };
}

// Pages Functions의 Entry Point (모든 Method 요청을 처리하는 Catch-all 핸들러)
/**
 * 역할: Cloudflare Pages catch-all 요청을 라우팅하고 인증, API, 정적/R2 파일 응답을 처리한다.
 * 매개변수: context - request, env, Pages 런타임 바인딩을 포함한 요청 컨텍스트.
 * 주요 변수: request, env, url, path, method, secret, isAdmin - 요청 라우팅과 권한 판단에 쓰는 값.
 * 반환값: 각 라우트에 맞는 Response 객체.
 */
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const secret = env.secretKey;
    const commitVersion = (env.CF_PAGES_COMMIT_SHA || 'ccff5c7').slice(0, 7);

    /**
     * 역할: Cookie 헤더 문자열을 key-value 객체로 변환한다.
     * 매개변수: cookieStr - request Cookie 헤더 원문.
     * 주요 변수: cookies, parts - 쿠키 누적 객체와 name/value 분리 결과.
     * 반환값: 쿠키 이름을 key로 가지는 객체.
     */
    const getCookies = (cookieStr) => {
      const cookies = {};
      if (cookieStr) {
        cookieStr.split(';').forEach(cookie => {
          const parts = cookie.split('=');
          cookies[parts[0].trim()] = parts[1];
        });
      }
      return cookies;
    };
    
    const cookies = getCookies(request.headers.get('Cookie'));
    const isAdmin = cookies['auth'] === secret;

    // 1. 로그인 POST 라우팅 처리
    if (path === "/login" && method === "POST") {
        try {
            const body = await request.json();
            if (body.password === secret) {
                return new Response(JSON.stringify({ success: true }), {
                    headers: {
                        'Content-Type': 'application/json',
                        'Set-Cookie': `auth=${body.password}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`
                    }
                });
            } else {
                return new Response(JSON.stringify({ success: false, error: 'Wrong password' }), { 
                    status: 401, headers: { 'Content-Type': 'application/json' }
                });
            }
        } catch (e) { return new Response(JSON.stringify({ success: false, error: 'Error' }), { status: 400 }); }
    }

    // 2. 로그아웃 GET 라우팅 처리
    if (path === "/logout" && method === "GET") {
        return new Response(null, {
            status: 302,
            headers: { 'Location': '/', 'Set-Cookie': `auth=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` }
        });
    }

    // 3. API 라우팅 처리
    if (path === "/api/planner/background/start" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            const result = await startPlannerBackgroundJob(env, body);
            return jsonResponse(result);
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/planner/background/status" && method === "GET") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const jobId = url.searchParams.get('jobId');
            if (!jobId) return jsonResponse({ error: 'jobId is required' }, { status: 400 });
            const result = await getPlannerBackgroundStatus(env, jobId);
            return jsonResponse(result);
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/planner/background/cancel" && method === "POST") {
        if (!isAdmin) return jsonResponse({ error: 'Unauthorized' }, { status: 403 });
        try {
            const body = await request.json();
            if (!body?.jobId) return jsonResponse({ error: 'jobId is required' }, { status: 400 });
            const result = await cancelPlannerBackgroundJob(env, body.jobId);
            return jsonResponse(result);
        } catch (e) {
            return jsonResponse({ error: e.message }, { status: 500 });
        }
    }

    if (path === "/api/generate" && method === "POST") {
        if (!isAdmin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
        if (!env.NOVELAI_TOKEN) return new Response(JSON.stringify({ error: 'Novel AI API 토큰이 설정되지 않았습니다.' }), { status: 500 });
        
        try {
            const naiPayload = await request.json();
            const naiRes = await fetch("https://image.novelai.net/ai/generate-image", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${env.NOVELAI_TOKEN}`,
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    "Accept": "application/x-zip-compressed",
                    "Origin": "https://novelai.net",
                    "Referer": "https://novelai.net/"
                },
                body: JSON.stringify(naiPayload)
            });

            if (!naiRes.ok) {
                const errText = await naiRes.text();
                throw new Error(`[${naiRes.status}] ${errText}`);
            }

            const buffer = await naiRes.arrayBuffer();
            return new Response(buffer, {
                headers: {
                    "Content-Type": "application/x-zip-compressed",
                    "Content-Disposition": 'attachment; filename="image.zip"'
                }
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    if (path === "/api/generate-stream" && method === "POST") {
        if (!isAdmin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
        if (!env.NOVELAI_TOKEN) return new Response(JSON.stringify({ error: 'Novel AI API 토큰이 설정되지 않았습니다.' }), { status: 500 });
        
        try {
            const naiPayload = await request.json();
            const naiRes = await fetch("https://image.novelai.net/ai/generate-image-stream", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${env.NOVELAI_TOKEN}`,
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                    "Accept": "text/event-stream",
                    "Origin": "https://novelai.net",
                    "Referer": "https://novelai.net/"
                },
                body: JSON.stringify(naiPayload)
            });

            if (!naiRes.ok) {
                const errText = await naiRes.text();
                throw new Error(`[${naiRes.status}] ${errText}`);
            }

            return new Response(naiRes.body, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive"
                }
            });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    if (path === "/api/aliases" && method === "GET") {
        const prefix = url.searchParams.get('prefix') || '';
        let globalAliases = {};
        let projectAliases = {};
        
        try {
            const gObj = await env.imgBucket.get('.imggul_aliases.json');
            if (gObj) globalAliases = await gObj.json();
        } catch(e){}

        const parts = prefix.split('/').filter(Boolean);
        if (parts.length > 0) {
            const projectName = parts[0];
            try {
                const pObj = await env.imgBucket.get(`${projectName}/.aliases.json`);
                if (pObj) projectAliases = await pObj.json();
            } catch(e){}
        }

        return new Response(JSON.stringify({ global: globalAliases, project: projectAliases }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (path === "/api/aliases" && method === "POST") {
        if (!isAdmin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
        try {
            const body = await request.json(); 
            const fullPath = body.key;
            const newAlias = body.alias;
            
            const parts = fullPath.split('/').filter(Boolean);
            
            if (parts.length === 1) {
                let aliases = {};
                const object = await env.imgBucket.get('.imggul_aliases.json');
                if (object) aliases = await object.json();
                
                if (newAlias) aliases[fullPath] = newAlias;
                else delete aliases[fullPath];
                
                await env.imgBucket.put('.imggul_aliases.json', JSON.stringify(aliases), {
                    httpMetadata: { contentType: 'application/json' }
                });
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
                
            } else if (parts.length > 1) {
                const projectName = parts[0];
                const targetName = parts[parts.length - 1];
                
                let aliases = {};
                const aliasPath = `${projectName}/.aliases.json`;
                const object = await env.imgBucket.get(aliasPath);
                if (object) aliases = await object.json();
                
                if (newAlias) aliases[targetName] = newAlias;
                else delete aliases[targetName];
                
                await env.imgBucket.put(aliasPath, JSON.stringify(aliases), {
                    httpMetadata: { contentType: 'application/json' }
                });
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            }
            
            return new Response(JSON.stringify({ error: 'Invalid path' }), { status: 400 });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    if (path === "/api/manage" && method === "POST") {
        if (!isAdmin) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });

        try {
            const body = await request.json();
            const { action, key, newKey, isPublic, keys } = body;

            if (action === 'toggle_public') {
                if (isTextFile(key)) {
                    const { prefix: mPrefix, fileName: mFileName } = splitPath(key);
                    const memoObj = await env.imgBucket.get(mPrefix + '.memos.json');
                    if (memoObj) {
                        const memos = await memoObj.json();
                        if (memos[mFileName]) {
                            memos[mFileName].isPublic = isPublic;
                            await env.imgBucket.put(mPrefix + '.memos.json', JSON.stringify(memos), { httpMetadata: { contentType: 'application/json' }});
                            return new Response(JSON.stringify({ success: true }));
                        }
                    }
                }
                
                const object = await env.imgBucket.get(key);
                if (!object) throw new Error('File not found');
                const newMetadata = { ...object.customMetadata, ispublic: isPublic ? 'true' : 'false' };
                await env.imgBucket.put(key, object.body, {
                    httpMetadata: object.httpMetadata,
                    customMetadata: newMetadata
                });
                return new Response(JSON.stringify({ success: true }));
            }

            if (action === 'delete') {
                if (isTextFile(key)) {
                    const { prefix: mPrefix, fileName: mFileName } = splitPath(key);
                    const memoObj = await env.imgBucket.get(mPrefix + '.memos.json');
                    if (memoObj) {
                        const memos = await memoObj.json();
                        if (memos[mFileName]) {
                            delete memos[mFileName];
                            await env.imgBucket.put(mPrefix + '.memos.json', JSON.stringify(memos), { httpMetadata: { contentType: 'application/json' }});
                        }
                    }
                }
                try { await env.imgBucket.delete(key); } catch(e){}
                return new Response(JSON.stringify({ success: true }));
            }

            if (action === 'delete_multiple') {
                if (Array.isArray(body.keys) && body.keys.length > 0) {
                    await env.imgBucket.delete(body.keys);
                }
                return new Response(JSON.stringify({ success: true }));
            }

            if (action === 'delete_folder') {
                const prefix = key.endsWith('/') ? key : key + '/';
                let truncated = true;
                let cursor = undefined;
                while (truncated) {
                    const list = await env.imgBucket.list({ prefix: prefix, cursor: cursor });
                    truncated = list.truncated;
                    cursor = list.cursor;
                    const keysToDelete = list.objects.map(o => o.key);
                    if (keysToDelete.length > 0) await env.imgBucket.delete(keysToDelete);
                }
                try {
                    const obj = await env.imgBucket.get('.imggul_aliases.json');
                    if (obj) {
                        let aliases = await obj.json();
                        if (aliases[prefix]) {
                            delete aliases[prefix];
                            await env.imgBucket.put('.imggul_aliases.json', JSON.stringify(aliases), {
                                httpMetadata: { contentType: 'application/json' }
                            });
                        }
                    }
                    const parts = prefix.split('/').filter(Boolean);
                    if (parts.length > 1) {
                        const aliasPath = `${parts[0]}/.aliases.json`;
                        const aliasObj = await env.imgBucket.get(aliasPath);
                        if (aliasObj) {
                            let aliases = await aliasObj.json();
                            const targetName = parts[parts.length - 1];
                            if (aliases[targetName]) {
                                delete aliases[targetName];
                                await env.imgBucket.put(aliasPath, JSON.stringify(aliases), {
                                    httpMetadata: { contentType: 'application/json' }
                                });
                            }
                        }
                    }
                } catch(e){}
                return new Response(JSON.stringify({ success: true }));
            }

            if (action === 'rename_folder') {
                if (!key || !newKey) throw new Error('Folder paths are required');
                const oldPrefix = key.endsWith('/') ? key : key + '/';
                const newPrefix = newKey.endsWith('/') ? newKey : newKey + '/';
                if (oldPrefix === newPrefix) return new Response(JSON.stringify({ success: true, newKey: newPrefix }));
                if (newPrefix.startsWith(oldPrefix)) throw new Error('Cannot move a folder into itself');

                const existing = await env.imgBucket.list({ prefix: newPrefix, limit: 1 });
                if (existing.objects.length > 0 || (existing.delimitedPrefixes && existing.delimitedPrefixes.length > 0)) {
                    throw new Error('Destination folder already exists');
                }

                let truncated = true;
                let cursor = undefined;
                let movedKeys = [];

                while (truncated) {
                    const list = await env.imgBucket.list({ prefix: oldPrefix, cursor: cursor });
                    truncated = list.truncated;
                    cursor = list.cursor;

                    for (const objectInfo of list.objects) {
                        const targetKey = newPrefix + objectInfo.key.slice(oldPrefix.length);
                        const object = await env.imgBucket.get(objectInfo.key);
                        if (object) {
                            await env.imgBucket.put(targetKey, object.body, {
                                httpMetadata: object.httpMetadata,
                                customMetadata: object.customMetadata
                            });
                            movedKeys.push(objectInfo.key);
                        }
                    }
                }

                if (movedKeys.length > 0) {
                    await env.imgBucket.delete(movedKeys);
                }

                try {
                    const obj = await env.imgBucket.get('.imggul_aliases.json');
                    if (obj) {
                        let aliases = await obj.json();
                        if (aliases[oldPrefix]) {
                            aliases[newPrefix] = aliases[oldPrefix];
                            delete aliases[oldPrefix];
                            await env.imgBucket.put('.imggul_aliases.json', JSON.stringify(aliases), {
                                httpMetadata: { contentType: 'application/json' }
                            });
                        }
                    }
                    const oldParts = oldPrefix.split('/').filter(Boolean);
                    const newParts = newPrefix.split('/').filter(Boolean);
                    if (
                        oldParts.length > 1 &&
                        newParts.length > 1 &&
                        oldParts[0] === newParts[0]
                    ) {
                        const aliasPath = `${oldParts[0]}/.aliases.json`;
                        const aliasObj = await env.imgBucket.get(aliasPath);
                        if (aliasObj) {
                            let aliases = await aliasObj.json();
                            const oldName = oldParts[oldParts.length - 1];
                            const newName = newParts[newParts.length - 1];
                            if (aliases[oldName]) {
                                aliases[newName] = aliases[oldName];
                                delete aliases[oldName];
                                await env.imgBucket.put(aliasPath, JSON.stringify(aliases), {
                                    httpMetadata: { contentType: 'application/json' }
                                });
                            }
                        }
                    }
                } catch(e){}

                return new Response(JSON.stringify({ success: true, newKey: newPrefix }));
            }

            if (action === 'move') {
                if (!newKey) throw new Error('New path required');
                let movedVirtual = false;

                if (isTextFile(key)) {
                    const { prefix: mPrefix, fileName: mFileName } = splitPath(key);
                    const { prefix: nPrefix, fileName: nFileName } = splitPath(newKey);
                    
                    const memoObj = await env.imgBucket.get(mPrefix + '.memos.json');
                    if (memoObj) {
                        let memos = await memoObj.json();
                        if (memos[mFileName]) {
                            const memoData = memos[mFileName];
                            if (mPrefix === nPrefix) {
                                memos[nFileName] = memoData;
                                delete memos[mFileName];
                                await env.imgBucket.put(mPrefix + '.memos.json', JSON.stringify(memos), { httpMetadata: { contentType: 'application/json' }});
                            } else {
                                let newMemos = {};
                                const newMemoObj = await env.imgBucket.get(nPrefix + '.memos.json');
                                if (newMemoObj) newMemos = await newMemoObj.json();
                                newMemos[nFileName] = memoData;
                                delete memos[mFileName];
                                await env.imgBucket.put(nPrefix + '.memos.json', JSON.stringify(newMemos), { httpMetadata: { contentType: 'application/json' }});
                                await env.imgBucket.put(mPrefix + '.memos.json', JSON.stringify(memos), { httpMetadata: { contentType: 'application/json' }});
                            }
                            movedVirtual = true;
                        }
                    }
                }
                
                const object = await env.imgBucket.get(key);
                if (object) {
                    await env.imgBucket.put(newKey, object.body, {
                        httpMetadata: object.httpMetadata,
                        customMetadata: object.customMetadata
                    });
                    await env.imgBucket.delete(key);
                } else if (!movedVirtual) {
                    throw new Error('File not found');
                }
                
                try {
                    const obj = await env.imgBucket.get('.imggul_aliases.json');
                    if (obj) {
                        let al = await obj.json();
                        if (al[key]) {
                            al[newKey] = al[key];
                            delete al[key];
                            await env.imgBucket.put('.imggul_aliases.json', JSON.stringify(al), {httpMetadata:{contentType:'application/json'}});
                        }
                    }
                } catch(e){}

                return new Response(JSON.stringify({ success: true, newKey }));
            }

            return new Response('Invalid action', { status: 400 });
        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    if (path === "/api/list" && method === "GET") {
        const prefix = url.searchParams.get('prefix') || '';
        
        if (!isAdmin && prefix === '') {
             return new Response(JSON.stringify({ folders: [], files: [] }), { headers: { 'Content-Type': 'application/json' } });
        }

        try {
            let allFolders = new Set();
            let allFiles = [];
            let truncated = true;
            let cursor = undefined;

            while (truncated) {
                const options = { prefix: prefix, delimiter: '/', include: ['customMetadata'] };
                if (cursor) options.cursor = cursor;
                const listing = await env.imgBucket.list(options);
                
                if (listing.delimitedPrefixes) {
                    listing.delimitedPrefixes.forEach(p => allFolders.add(p));
                }
                
                listing.objects.forEach(o => {
                    if (!o.key.includes('.imggul_aliases.json') && !o.key.endsWith('.aliases.json') && !o.key.endsWith('.memos.json') && !o.key.endsWith('_meta.json')) {
                        allFiles.push({ 
                            key: o.key, 
                            size: o.size, 
                            uploaded: o.uploaded,
                            isPublic: o.customMetadata?.ispublic === 'true'
                        });
                    }
                });
                
                truncated = listing.truncated;
                cursor = listing.cursor;
            }

            try {
                const memoObj = await env.imgBucket.get(prefix + '.memos.json');
                if (memoObj) {
                    const memos = await memoObj.json();
                    for (const [mKey, mVal] of Object.entries(memos)) {
                        const fullKey = prefix + mKey;
                        if (!allFiles.find(f => f.key === fullKey)) {
                            allFiles.push({
                                key: fullKey,
                                size: mVal.content ? (new TextEncoder().encode(mVal.content)).length : 0,
                                uploaded: new Date(mVal.updated || Date.now()),
                                isPublic: !!mVal.isPublic
                            });
                        }
                    }
                }
            } catch(e){}

            if (!isAdmin) {
                allFiles = allFiles.filter(f => !isTextFile(f.key) || f.isPublic);
            }

            return new Response(JSON.stringify({
                folders: Array.from(allFolders),
                files: allFiles
            }), { headers: { 'Content-Type': 'application/json' } });

        } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500 });
        }
    }

    if (path === "/api/upload" && method === "PUT") {
      const userKeyHeader = request.headers.get('X-Custom-Auth-Key');
      if ((!secret || secret !== userKeyHeader) && !isAdmin) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403 });
      }

      const absolutePath = request.headers.get('X-Absolute-Path');
      let finalKey;

      if (absolutePath) {
          finalKey = decodeURIComponent(absolutePath);
          if (finalKey.startsWith('/')) finalKey = finalKey.slice(1);
      } else {
          const rawOriginalName = request.headers.get('X-File-Name') || 'image.png';
          const originalName = decodeURIComponent(rawOriginalName);
          finalKey = `${Date.now()}-${originalName}`;
      }

      try {
        if (isTextFile(finalKey)) {
            const { prefix: mPrefix, fileName: mFileName } = splitPath(finalKey);
            const memoPath = mPrefix + '.memos.json';
            
            let memos = {};
            try {
                const memoObj = await env.imgBucket.get(memoPath);
                if (memoObj) memos = await memoObj.json();
            } catch(e){}
            
            const content = await request.text();
            const isPublic = memos[mFileName] ? !!memos[mFileName].isPublic : false;
            
            memos[mFileName] = { content: content, isPublic: isPublic, updated: Date.now() };
            
            await env.imgBucket.put(memoPath, JSON.stringify(memos), {
                httpMetadata: { contentType: 'application/json' }
            });
            
            try { await env.imgBucket.delete(finalKey); } catch(e){}
            
            return new Response(JSON.stringify({ success: true, url: `/${finalKey}` }), { headers: { 'Content-Type': 'application/json' } });
            
        } else {
            await env.imgBucket.put(finalKey, request.body, {
              httpMetadata: { contentType: request.headers.get('Content-Type') || 'application/octet-stream' },
              customMetadata: { ispublic: 'false' }
            });
            return new Response(JSON.stringify({ success: true, url: `/${finalKey}` }), { headers: { 'Content-Type': 'application/json' } });
        }
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Upload failed: ' + err.message }), { status: 500 });
      }
    }

    // 4. 정적 자산(Static Assets) 서빙 여부 검사
    const hasExtension = path.includes(".");
    if (hasExtension) {
        // public 폴더 내 실제 정적 파일(js, css 등) 존재 여부 우선 검사
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) {
            return assetResponse;
        }

        // 정적 에셋에 없는 파일인 경우 R2에서 조회 및 다운로드 서빙
        let objectKey = null;
        if (path.startsWith("/i/")) objectKey = path.split("/i/")[1];
        else objectKey = path.slice(1);

        if (objectKey) {
            objectKey = decodeURIComponent(objectKey);

            if (objectKey.endsWith('_meta.json') && !isAdmin) {
                return new Response("Forbidden: You don't have permission to access this metadata.", { status: 403 });
            }

            try {
                let object = await env.imgBucket.get(objectKey);
                
                if (!object && isTextFile(objectKey)) {
                    const { prefix: mPrefix, fileName: mFileName } = splitPath(objectKey);
                    const memoObj = await env.imgBucket.get(mPrefix + '.memos.json');
                    if (memoObj) {
                        const memos = await memoObj.json();
                        if (memos[mFileName]) {
                            const mData = memos[mFileName];
                            if (!mData.isPublic && !isAdmin) {
                                return new Response("Access Denied: Private Text File", { status: 403 });
                            }
                            return new Response(mData.content, { 
                                headers: { 
                                    'Content-Type': 'text/plain; charset=UTF-8',
                                    'Cache-Control': 'no-cache'
                                } 
                            });
                        }
                    }
                }

                if (!object) return new Response("Not found", { status: 404 });

                if (isTextFile(objectKey)) {
                    const isPublic = object.customMetadata?.ispublic === 'true';
                    if (!isPublic && !isAdmin) {
                        return new Response("Access Denied: Private Text File", { status: 403 });
                    }
                }

                const headers = new Headers();
                object.writeHttpMetadata(headers);
                headers.set('etag', object.httpEtag);
                headers.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=86400');
                return new Response(object.body, { headers });

            } catch (e) { return new Response("Error", { status: 500 }); }
        }
    }

    // 5. 비인증 접속인데 로그인 페이지 또는 루트 요청일 때 처리
    if (!isAdmin && (path === "/login" || path === "/")) {
        const loginRes = await env.ASSETS.fetch(new URL('/login.html', request.url));
        let loginHtmlText = await loginRes.text();
        return new Response(loginHtmlText.replace('{{ERROR_STYLE}}', 'none'), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    // 6. 어드민 / 게스트 뷰 동적 바인딩 및 파라미터 주입 처리
    let initialPath = path === "/" ? "" : path.slice(1);
    if (initialPath && !initialPath.endsWith('/')) initialPath += '/';
    
    let isEmpty = false;

    if (isAdmin) {
        initialPath = ''; 
    } else {
        if (initialPath !== '') {
            const list = await env.imgBucket.list({ prefix: initialPath, limit: 1 });
            isEmpty = list.objects.length === 0;
        }
    }

    const templatePath = isAdmin ? '/app.html' : '/guest.html';
    const templateRes = await env.ASSETS.fetch(new URL(templatePath, request.url));
    let htmlContent = await templateRes.text();

    htmlContent = htmlContent.replace('{{IS_ADMIN}}', isAdmin ? 'true' : 'false');
    htmlContent = htmlContent.replace('{{INITIAL_PATH}}', initialPath);
    htmlContent = htmlContent.replace('{{IS_EMPTY}}', isEmpty ? 'true' : 'false');
    htmlContent = htmlContent.replaceAll('{{APP_VERSION}}', commitVersion);
    
    return new Response(htmlContent, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
}
