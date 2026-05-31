// 2. api.js: 백엔드/스토리지 데이터 교환 로직
/**
 * 역할: 저장 전 메타데이터 객체에서 불필요한 모델 필드를 재귀적으로 제거한다.
 * 매개변수: metaDataObj - 배열, 객체, 원시값 형태의 메타데이터.
 * 주요 변수: sanitized - 재귀 정리 후 복사된 메타데이터.
 * 반환값: Model/model 필드가 제거된 값 또는 원본 원시값.
 */
function sanitizeMetadataForStorage(metaDataObj) {
    if (!metaDataObj || typeof metaDataObj !== 'object') return metaDataObj;
    const sanitized = Array.isArray(metaDataObj)
        ? metaDataObj.map(item => sanitizeMetadataForStorage(item))
        : Object.fromEntries(Object.entries(metaDataObj).map(([key, value]) => [key, sanitizeMetadataForStorage(value)]));
    delete sanitized.Model;
    delete sanitized.model;
    return sanitized;
}

/**
 * 역할: 폴더 단위 _meta.json에서 특정 파일의 메타데이터를 읽고 확장자 대체 이름까지 탐색한다.
 * 매개변수: folderPrefix - 대상 폴더 prefix, fileName - 조회할 파일명.
 * 주요 변수: metaPath, db, baseName, extFallbacks - 조회 경로와 대체 확장자 후보.
 * 반환값: 정리된 메타데이터 객체, 없거나 실패하면 null.
 */
export async function loadMetadataFromDB(folderPrefix, fileName) {
    try {
        const res = await fetch(`/api/db/file-metadata?folderPrefix=${encodeURIComponent(folderPrefix)}&fileName=${encodeURIComponent(fileName)}&_t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return null;
        const result = await res.json();
        return result.data ? sanitizeMetadataForStorage(result.data) : null;
    } catch(e) {}
    return null;
}

/**
 * 역할: 특정 파일의 메타데이터를 폴더 _meta.json에 병합 저장한다.
 * 매개변수: folderPrefix - 저장 폴더 prefix, fileName - 저장 키, metaDataObj - 저장할 메타데이터.
 * 주요 변수: metaPath, db, blob, buffer, uploadRes - 기존 DB와 업로드 요청 데이터.
 * 반환값: 명시 반환 없음. 업로드 실패 시 Error를 throw한다.
 */
export async function saveMetadataToDB(folderPrefix, fileName, metaDataObj) {
    if (!metaDataObj) return;
    const sanitizedMetaData = sanitizeMetadataForStorage(metaDataObj);

    const uploadRes = await fetch('/api/db/file-metadata?_t=' + Date.now(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ folderPrefix, fileName, metadata: sanitizedMetaData }),
        cache: 'no-store'
    });
    if (!uploadRes.ok) throw new Error(`메타데이터 저장 실패 (${uploadRes.status})`);
}

/**
 * 역할: 폴더 _meta.json에서 특정 파일과 같은 basename의 이미지 메타데이터를 제거한다.
 * 매개변수: folderPrefix - 대상 폴더 prefix, fileName - 제거 기준 파일명.
 * 주요 변수: metaPath, db, namesToDelete, changed - 삭제 후보와 변경 여부.
 * 반환값: 명시 반환 없음. 실패는 내부에서 무시한다.
 */
export async function removeMetadataFromDB(folderPrefix, fileName) {
    try {
        await fetch('/api/db/file-metadata?_t=' + Date.now(), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ folderPrefix, fileNames: [fileName] }),
            cache: 'no-store'
        });
    } catch(e) {}
}

/**
 * 역할: 여러 파일명의 메타데이터를 한 번에 _meta.json에서 제거한다.
 * 매개변수: folderPrefix - 대상 폴더 prefix, fileNamesArray - 제거할 파일명 배열.
 * 주요 변수: metaPath, db, changed, buffer - 메타데이터 저장소와 갱신 데이터.
 * 반환값: 명시 반환 없음. 실패는 내부에서 무시한다.
 */
export async function removeMultipleMetadataFromDB(folderPrefix, fileNamesArray) {
    try {
        await fetch('/api/db/file-metadata?_t=' + Date.now(), {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ folderPrefix, fileNames: fileNamesArray || [] }),
            cache: 'no-store'
        });
    } catch(e) {}
}

/**
 * 역할: 파일 이동 시 기존 _meta.json의 메타데이터를 새 위치의 _meta.json으로 옮긴다.
 * 매개변수: oldPrefix, oldName - 원본 위치/파일명, newPrefix, newName - 새 위치/파일명.
 * 주요 변수: metaDataObj, oldMetaPath, db, buffer - 이동할 메타데이터와 원본 DB 갱신 데이터.
 * 반환값: 명시 반환 없음. 이동할 메타데이터가 있으면 saveMetadataToDB를 호출한다.
 */
export async function moveMetadataInDB(oldPrefix, oldName, newPrefix, newName) {
    try {
        await fetch('/api/db/file-metadata/move?_t=' + Date.now(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ oldPrefix, oldName, newPrefix, newName }),
            cache: 'no-store'
        });
    } catch(e) {}
}

/**
 * 역할: 업로드/생성 이미지 파일에서 PNG 텍스트 청크 또는 바이너리 문자열의 프롬프트 메타데이터를 추출한다.
 * 매개변수: file - 브라우저 File 객체.
 * 주요 변수: buffer, view, metadataStr, metadataObj - 원본 바이트와 추출 결과.
 * 반환값: 구조화된 메타데이터 객체, 원문 메타데이터 객체, 또는 null.
 */
export async function extractMetadata(file) {
    try {
        const buffer = await file.arrayBuffer();
        const view = new DataView(buffer);
        let metadataStr = "";
        let metadataObj = null;

        /**
         * 역할: NovelAI JSON 문자열을 UI에서 쓰는 표준 메타데이터 필드로 변환한다.
         * 매개변수: jsonStr - NovelAI 메타데이터 JSON 문자열.
         * 주요 변수: data, negativePrompt, extraCharacters, cleanData - 파싱 결과와 정규화 필드.
         * 반환값: 변환된 메타데이터 객체, 형식이 맞지 않으면 null.
         */
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

/**
 * 역할: 일반 이미지 파일을 정해진 해상도 규칙에 맞춰 WebP File로 변환한다.
 * 매개변수: file - 변환할 브라우저 File 객체.
 * 주요 변수: img, objectUrl, canvas, ctx, width, height - 이미지 로드와 캔버스 변환 자원.
 * 반환값: WebP File을 resolve하는 Promise. GIF/SVG 등 제외 대상은 원본 file을 반환한다.
 */
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

/**
 * 역할: 지정한 R2 key로 파일을 업로드하고 갤러리를 새로고침한다.
 * 매개변수: key - 업로드 대상 경로, file - 업로드 파일, isFolder - 폴더 생성용 호출 여부.
 * 주요 변수: finalHeaders, buffer, res - 업로드 헤더와 전송 데이터.
 * 반환값: 명시 반환 없음. 오류는 alert로 사용자에게 알린다.
 */
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
