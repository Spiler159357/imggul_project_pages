// 2. api.js: 백엔드/스토리지 데이터 교환 로직
export async function saveMetadataToDB(folderPrefix, fileName, metaDataObj) {
    if (!metaDataObj) return;
    const metaPath = folderPrefix + '_meta.json';
    let db = {};
    try {
        const res = await fetch(`/${metaPath}?_t=${Date.now()}`);
        if (res.ok) db = await res.json();
    } catch(e) {}
    
    db[fileName] = metaDataObj;
    
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json;charset=utf-8' });
    const buffer = await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsArrayBuffer(blob);
    });
    
    await fetch('/api/upload?_t=' + Date.now(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-File-Name': '_meta.json', 'X-Absolute-Path': encodeURIComponent(metaPath) },
        body: buffer, cache: 'no-store'
    });
}

export async function removeMetadataFromDB(folderPrefix, fileName) {
    const metaPath = folderPrefix + '_meta.json';
    try {
        const res = await fetch(`/${metaPath}?_t=${Date.now()}`);
        if (!res.ok) return;
        let db = await res.json();
        if (db[fileName]) {
            delete db[fileName];
            const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json;charset=utf-8' });
            const buffer = await new Promise((resolve, reject) => {
                const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsArrayBuffer(blob);
            });
            await fetch('/api/upload?_t=' + Date.now(), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-File-Name': '_meta.json', 'X-Absolute-Path': encodeURIComponent(metaPath) },
                body: buffer, cache: 'no-store'
            });
        }
    } catch(e) {}
}

export async function removeMultipleMetadataFromDB(folderPrefix, fileNamesArray) {
    const metaPath = folderPrefix + '_meta.json';
    try {
        const res = await fetch(`/${metaPath}?_t=${Date.now()}`);
        if (!res.ok) return;
        let db = await res.json();
        let changed = false;
        for(let name of fileNamesArray) {
            if (db[name]) { delete db[name]; changed = true; }
        }
        if (changed) {
            const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json;charset=utf-8' });
            const buffer = await new Promise((resolve, reject) => {
                const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsArrayBuffer(blob);
            });
            await fetch('/api/upload?_t=' + Date.now(), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-File-Name': '_meta.json', 'X-Absolute-Path': encodeURIComponent(metaPath) },
                body: buffer, cache: 'no-store'
            });
        }
    } catch(e) {}
}

export async function moveMetadataInDB(oldPrefix, oldName, newPrefix, newName) {
    let metaDataObj = null;
    const oldMetaPath = oldPrefix + '_meta.json';
    try {
        const res = await fetch(`/${oldMetaPath}?_t=${Date.now()}`);
        if (res.ok) {
            let db = await res.json();
            if (db[oldName]) {
                metaDataObj = db[oldName];
                delete db[oldName];
                const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json;charset=utf-8' });
                const buffer = await new Promise((resolve) => {
                    const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsArrayBuffer(blob);
                });
                await fetch('/api/upload?_t=' + Date.now(), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-File-Name': '_meta.json', 'X-Absolute-Path': encodeURIComponent(oldMetaPath) },
                    body: buffer, cache: 'no-store'
                });
            }
        }
    } catch(e) {}
    if (metaDataObj) { await window.saveMetadataToDB(newPrefix, newName, metaDataObj); }
}

export async function extractMetadata(file) {
    try {
        const buffer = await file.arrayBuffer();
        const view = new DataView(buffer);
        let metadataStr = "";
        let metadataObj = null;

        const formatNaiJson = (jsonStr) => {
            try {
                const data = JSON.parse(jsonStr);
                if (data.prompt) {
                    let negativePrompt = "";
                    if (data.v4_negative_prompt && data.v4_negative_prompt.caption && data.v4_negative_prompt.caption.base_caption) {
                        negativePrompt = data.v4_negative_prompt.caption.base_caption;
                    } else if (data.uc) {
                        negativePrompt = data.uc;
                    }
                    let extraCharacters = [];
                    if (data.v4_prompt && data.v4_prompt.caption && Array.isArray(data.v4_prompt.caption.char_captions)) {
                        extraCharacters = data.v4_prompt.caption.char_captions.map(c => c.char_caption);
                    }
                    let negativeExtraCharacters = [];
                    if (data.v4_negative_prompt && data.v4_negative_prompt.caption && Array.isArray(data.v4_negative_prompt.caption.char_captions)) {
                        negativeExtraCharacters = data.v4_negative_prompt.caption.char_captions.map(c => c.char_caption);
                    }

                    const cleanData = {
                        "Prompt": data.prompt,
                        "Negative Prompt": negativePrompt,
                        "Extra Characters": extraCharacters.length > 0 ? extraCharacters : null,
                        "Negative Extra Characters": negativeExtraCharacters.length > 0 ? negativeExtraCharacters : null,
                        "Resolution": `${data.width || 0} x ${data.height || 0}`,
                        "Seed": data.seed,
                        "Steps": data.steps,
                        "Sampler": data.sampler,
                        "CFG Scale": data.scale,
                        "SMEA": data.sm || false,
                        "SMEA DYN": data.sm_dyn || false
                    };
                    Object.keys(cleanData).forEach(key => { if (cleanData[key] === null) delete cleanData[key]; });
                    return cleanData; 
                }
            } catch(e) {}
            return null;
        };

        if (view.byteLength > 8 && view.getUint32(0) === 0x89504E47) { 
            let offset = 8;
            while (offset < view.byteLength) {
                const length = view.getUint32(offset);
                const type = String.fromCharCode(view.getUint8(offset+4), view.getUint8(offset+5), view.getUint8(offset+6), view.getUint8(offset+7));
                
                if (type === 'tEXt' || type === 'iTXt') {
                    const chunkData = new Uint8Array(buffer, offset + 8, length);
                    let keyword = "";
                    let text = "";
                    
                    if (type === 'tEXt') {
                        let textStartIdx = 0;
                        for (let i = 0; i < chunkData.length; i++) { if (chunkData[i] === 0) { textStartIdx = i + 1; break; } }
                        keyword = new TextDecoder('utf-8').decode(chunkData.slice(0, textStartIdx - 1));
                        text = new TextDecoder('utf-8').decode(chunkData.slice(textStartIdx));
                    } else if (type === 'iTXt') {
                        let nullCount = 0;
                        let keywordEndIdx = 0;
                        let textStartIdx = 0;
                        for (let i = 0; i < chunkData.length; i++) {
                            if (chunkData[i] === 0) {
                                nullCount++;
                                if (nullCount === 1) keywordEndIdx = i;
                                if (nullCount === 4) { textStartIdx = i + 1; break; }
                            }
                        }
                        keyword = new TextDecoder('utf-8').decode(chunkData.slice(0, keywordEndIdx));
                        text = new TextDecoder('utf-8').decode(chunkData.slice(textStartIdx));
                    }
                    
                    if (['parameters', 'Comment', 'Description', 'prompt'].includes(keyword)) {
                        const formattedObj = formatNaiJson(text);
                        if (formattedObj) metadataObj = formattedObj;
                        else metadataStr += `[${keyword}]\n${text}\n\n`;
                    }
                }
                offset += 12 + length;
            }
        } else {
            const text = new TextDecoder('utf-8', {fatal: false}).decode(buffer);
            const sdMatch = text.match(/(?:parameters|UserComment)[\s\S]{0,20}?([A-Za-z0-9\s,\.\(\)\[\]\{\}\-_\+:]+Negative prompt:[\s\S]*?(?:Steps: \d+,.*?)(?:\x00|$))/i);
            if (sdMatch && sdMatch[1]) {
                 metadataStr += "[parameters]\n" + sdMatch[1].trim() + "\n\n";
            } else {
                const naiMatch = text.match(/\{"prompt":[\s\S]*?\}/i);
                if (naiMatch) {
                    const formattedObj = formatNaiJson(naiMatch[0]);
                    if (formattedObj) metadataObj = formattedObj;
                    else metadataStr += "[Comment]\n" + naiMatch[0] + "\n\n";
                }
            }
        }
        return metadataObj || (metadataStr.trim() ? { "Raw Data": metadataStr.trim() } : null);
    } catch (e) {
        console.error("Metadata extraction error", e);
        return null;
    }
}

export async function convertToWebP(file) {
    if (!file) throw new Error("파일이 없습니다.");
    if (!file.type.startsWith('image/')) return file;
    if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
    
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        
        img.onload = () => {
            img.onload = null;
            img.onerror = null;
            try {
                let width = img.width;
                let height = img.height;
                
                const ratio = width / height;
                if (Math.abs(ratio - 1) <= 0.05) { width = 1024; height = 1024; }
                else if (ratio > 1) { width = 1216; height = 832; }
                else { width = 832; height = 1216; }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                
                if (!ctx) {
                    URL.revokeObjectURL(objectUrl);
                    return reject(new Error("캔버스를 생성할 수 없습니다. (메모리 부족)"));
                }
                ctx.drawImage(img, 0, 0, width, height);
                URL.revokeObjectURL(objectUrl);
                img.src = '';
                
                canvas.toBlob((blob) => {
                    canvas.width = 0; canvas.height = 0;
                    if (!blob) return reject(new Error("WebP 변환에 실패했습니다. (Blob 생성 실패)"));
                    let baseName = file.name || 'image';
                    baseName = baseName.replace(/\.[^/.]+$/, "");
                    resolve(new File([blob], baseName + ".webp", { type: 'image/webp', lastModified: Date.now() }));
                }, 'image/webp', 0.8);
            } catch (err) {
                URL.revokeObjectURL(objectUrl);
                reject(new Error("WebP 인코딩 중 오류: " + err.message));
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("이미지 디코딩에 실패했습니다. 손상된 파일이거나 지원하지 않는 형식입니다."));
        };
        img.src = objectUrl;
    });
}

export async function uploadFileWithKey(key, file, isFolder = false) {
    try {
        let finalHeaders = {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
            'X-Absolute-Path': encodeURIComponent(key)
        };
        const buffer = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(new Error("ArrayBuffer 변환 실패"));
            r.readAsArrayBuffer(file);
        });

        const res = await fetch('/api/upload?_t=' + Date.now(), { method: 'PUT', headers: finalHeaders, body: buffer, cache: 'no-store' });
        if (!res.ok) throw new Error('작업 실패');
        window.refreshGallery();
    } catch(e) { alert(e.message); }
}