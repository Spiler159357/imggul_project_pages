import loginHtml from './login.html';
import appHtml from './app.html';
import guestHtml from './guest.html';
import styleCss from './style.css';

// ES Modules: 번들러(Wrangler, Vite 등) 환경에 따라 raw 텍스트로 가져오도록 확장자나 옵션을 주의하세요.
import stateJs from './js/state.js.txt';
import apiJs from './js/api.js.txt';
import uiJs from './js/ui.js.txt';
import explorerJs from './js/explorer.js.txt';
import craftJs from './js/craft.js.txt';
import tempGalleryJs from './js/temp_gallery.js.txt';
import modalsJs from './js/modals.js.txt';
import mainJs from './js/main.js.txt';

function isTextFile(key) {
    return key.toLowerCase().endsWith('.txt');
}

function splitPath(key) {
    const parts = key.split('/');
    const fileName = parts.pop();
    const prefix = parts.length > 0 ? parts.join('/') + '/' : '';
    return { prefix, fileName };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const secret = env.secretKey;

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

    if (path === "/style.css" && method === "GET") {
        return new Response(styleCss, { headers: { "Content-Type": "text/css; charset=UTF-8" } });
    }
    
    // JS 모듈 파일별 개별 라우팅 처리
    if (path === "/js/state.js" && method === "GET") return new Response(stateJs, { headers: { "Content-Type": "application/javascript; charset=UTF-8" } });
    if (path === "/js/api.js" && method === "GET") return new Response(apiJs, { headers: { "Content-Type": "application/javascript; charset=UTF-8" } });
    if (path === "/js/ui.js" && method === "GET") return new Response(uiJs, { headers: { "Content-Type": "application/javascript; charset=UTF-8" } });
    if (path === "/js/explorer.js" && method === "GET") return new Response(explorerJs, { headers: { "Content-Type": "application/javascript; charset=UTF-8" } });
    if (path === "/js/craft.js" && method === "GET") return new Response(craftJs, { headers: { "Content-Type": "application/javascript; charset=UTF-8" } });
    if (path === "/js/temp_gallery.js" && method === "GET") return new Response(tempGalleryJs, { headers: { "Content-Type": "application/javascript; charset=UTF-8" } });
    if (path === "/js/modals.js" && method === "GET") return new Response(modalsJs, { headers: { "Content-Type": "application/javascript; charset=UTF-8" } });
    if (path === "/js/main.js" && method === "GET") return new Response(mainJs, { headers: { "Content-Type": "application/javascript; charset=UTF-8" } });

    if (path === "/" || path === "/login") {
        if (method === "GET") {
            if (!isAdmin && path === "/login") {
                return new Response(loginHtml.replace('{{ERROR_STYLE}}', 'none'), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
            } else if (!isAdmin) {
                return new Response(loginHtml.replace('{{ERROR_STYLE}}', 'none'), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
            }
        } else if (method === "POST" && path === "/login") {
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
    }

    if (path === "/logout" && method === "GET") {
        return new Response(null, {
            status: 302,
            headers: { 'Location': '/', 'Set-Cookie': `auth=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` }
        });
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
                return new Response(JSON.stringify({ success: true }));
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

    let objectKey = null;
    if (path.startsWith("/i/")) objectKey = path.split("/i/")[1];
    else if (path.includes(".") && !path.startsWith("/api")) objectKey = path.slice(1);

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

    const isApiOrFile = path.startsWith("/api") || (path.includes(".") && !path.startsWith("/api"));
    
    if (!isApiOrFile && path !== "/login") {
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
        
        let htmlContent = isAdmin ? appHtml : guestHtml;
        htmlContent = htmlContent.replace('{{IS_ADMIN}}', isAdmin ? 'true' : 'false');
        htmlContent = htmlContent.replace('{{INITIAL_PATH}}', initialPath);
        htmlContent = htmlContent.replace('{{IS_EMPTY}}', isEmpty ? 'true' : 'false');
        
        return new Response(htmlContent, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }
    
    return new Response("Not Found", { status: 404 });
  }
};