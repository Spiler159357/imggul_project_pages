// 팝업 창(업로드, 메모, 파일 미리보기, Import 탐색기) 제어

/**
 * 역할: 미리보기 모달의 현재 이미지를 다운로드하고 WebP는 PNG로 변환해 제공한다.
 * 매개변수: 없음.
 * 주요 변수: currentFileKey, downloadUrl, downloadName, btn, blob, canvas - 다운로드 대상과 변환 자원.
 * 반환값: 명시 반환 없음.
 */
window.downloadModalImage = async function() {
    if (!window.currentFileKey) return;

    let downloadUrl = `/${window.currentFileKey}?t=${Date.now()}`;
    let downloadName = window.currentFileKey.split('/').pop();
    const isWebp = downloadName.toLowerCase().endsWith('.webp');

    const btn = document.getElementById('modal-download-btn');
    let originalHtml = '';
    if (btn) {
        originalHtml = btn.innerHTML;
        btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span class="modal-action-label">변환</span>`;
        btn.disabled = true;
        if (window.lucide) window.lucide.createIcons();
    }

    if (isWebp) {
        try {
            const res = await fetch(downloadUrl);
            if (!res.ok) throw new Error("이미지 가져오기 실패");
            const blob = await res.blob();
            
            const img = new Image();
            const objectUrl = URL.createObjectURL(blob);
            
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = objectUrl;
            });
            
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            
            const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            downloadUrl = URL.createObjectURL(pngBlob);
            downloadName = downloadName.replace(/\.webp$/i, '.png');

            URL.revokeObjectURL(objectUrl);
        } catch (error) {
            console.error("PNG 변환 실패:", error);
            alert("PNG 변환에 실패하여 원본(WebP)을 다운로드합니다.");
        }
    }
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (downloadUrl.startsWith('blob:')) {
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    }

    if (btn) {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        if (window.lucide) window.lucide.createIcons();
    }
};

function normalizeImportedV4PromptRows(meta) {
    const extraCharacters = Array.isArray(meta?.['Extra Characters']) ? meta['Extra Characters'] : [];
    const negativeExtraCharacters = Array.isArray(meta?.['Negative Extra Characters']) ? meta['Negative Extra Characters'] : [];

    return extraCharacters.map((entry, idx) => {
        if (entry && typeof entry === 'object') {
            return {
                subject: entry.subject || entry.char_caption || entry.prompt || '',
                clothing: entry.clothing || '',
                expression: entry.expression || '',
                action: entry.action || '',
                negative: entry.negative || negativeExtraCharacters[idx] || ''
            };
        }

        return {
            subject: entry || '',
            clothing: '',
            expression: '',
            action: '',
            negative: negativeExtraCharacters[idx] || ''
        };
    });
}

function applyImportedMetadataToCraft(meta, options = {}) {
    const {
        optStyle = true,
        optComp = true,
        optChar = true,
        optCloth = true,
        optExp = true,
        optAct = true,
        optBg = true,
        optNegative = true
    } = options;

    const promptValues = {};
    const anyPromptOption = optStyle || optComp || optChar || optCloth || optExp || optAct || optBg;

    if (meta['Split Prompts']) {
        const sp = meta['Split Prompts'];
        if (optStyle && sp.style !== undefined) promptValues['prompt-style'] = sp.style;
        if (optComp && sp.composition !== undefined) promptValues['prompt-composition'] = sp.composition;
        if (optChar && sp.character !== undefined) promptValues['prompt-character'] = sp.character;
        if (optCloth && sp.clothing !== undefined) promptValues['prompt-clothing'] = sp.clothing;
        if (optExp && sp.expression !== undefined) promptValues['prompt-expression'] = sp.expression;
        if (optAct && sp.action !== undefined) promptValues['prompt-action'] = sp.action;
        if (optBg && sp.background !== undefined) promptValues['prompt-background'] = sp.background;
        if (anyPromptOption && sp.raw !== undefined) promptValues['prompt-raw'] = sp.raw;
    } else if (anyPromptOption && meta['Prompt']) {
        promptValues['prompt-raw'] = meta['Prompt'];
    }

    if (window.applyCraftPromptValues) {
        window.applyCraftPromptValues(promptValues, meta['Negative Prompt'] || '', {
            clearMissing: false,
            applyNegative: optNegative
        });
    }

    if (optChar && window.setCraftV4PromptRows) {
        window.setCraftV4PromptRows(normalizeImportedV4PromptRows(meta));
    }
}

/**
 * 역할: 선택 이미지의 저장된 메타데이터를 읽어 Craft 입력 폼과 생성 설정에 반영한다.
 * 매개변수: fileKey - 메타데이터를 가져올 이미지 경로.
 * 주요 변수: fileName, prefix, metaPath, meta, optStyle, optSettings - 조회 경로와 적용 옵션.
 * 반환값: 명시 반환 없음.
 */
window.importMetadata = async function(fileKey, applyOptions = getFullImportApplyOptions()) {
    const parts = fileKey.split('/');
    const fileName = parts.pop();
    const prefix = parts.length > 0 ? parts.join('/') + '/' : '';
    const metaPath = prefix + '_meta.json';
    
    try {
        const res = await fetch(`/api/db/file-metadata?folderPrefix=${encodeURIComponent(prefix)}&fileName=${encodeURIComponent(fileName)}&_t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error("해당 폴더에 메타데이터 파일(_meta.json)이 없거나 접근할 수 없습니다.");
        const payload = await res.json();
        const meta = payload.data;
        if (!meta) throw new Error("해당 이미지에 저장된 설정(프롬프트)이 없습니다.");
        
        if (meta['Raw Data'] && !meta['Prompt'] && !meta['Split Prompts']) {
            alert("이 이미지는 NovelAI 규격 메타데이터가 아닙니다. 텍스트 원본:\n" + meta['Raw Data']);
            return;
        }

        // Determine which metadata fields this import path should apply.
        const {
            optStyle,
            optComp,
            optChar,
            optCloth,
            optExp,
            optAct,
            optBg,
            optNegative,
            optRes,
            optSettings,
            optSeed
        } = normalizeImportApplyOptions(applyOptions);

        if (window.applyCraftPromptValues) {
            applyImportedMetadataToCraft(meta, { optStyle, optComp, optChar, optCloth, optExp, optAct, optBg, optNegative });
        } else {
        const toggle = document.getElementById('prompt-toggle-simple');

        if (meta['Split Prompts']) {
            if (toggle) toggle.checked = false;
            if (window.togglePromptMode) window.togglePromptMode();

            const sp = meta['Split Prompts'];
            if (optStyle && sp.style !== undefined) document.getElementById('prompt-style').value = sp.style;
            if (optComp && sp.composition !== undefined) document.getElementById('prompt-composition').value = sp.composition;
            if (optChar && sp.character !== undefined) document.getElementById('prompt-character').value = sp.character;
            if (optCloth && sp.clothing !== undefined) document.getElementById('prompt-clothing').value = sp.clothing;
            if (optExp && sp.expression !== undefined) document.getElementById('prompt-expression').value = sp.expression;
            if (optAct && sp.action !== undefined) document.getElementById('prompt-action').value = sp.action;
            if (optBg && sp.background !== undefined) document.getElementById('prompt-background').value = sp.background;

            if (sp.raw !== undefined && (optStyle || optComp || optChar || optCloth || optExp || optAct || optBg)) {
                const rawEl = document.getElementById('prompt-raw');
                if (rawEl) rawEl.value = sp.raw;
            }

            if (window.PROMPT_IDS) {
                window.PROMPT_IDS.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
                });
            }
        } else if (meta['Prompt']) {
            // 구형 모델(단일 프롬프트)인 경우, 프롬프트 관련 옵션이 하나라도 켜져있으면 덮어씌움
            if (optStyle || optComp || optChar || optCloth || optExp || optAct || optBg) {
                if (toggle) toggle.checked = true;
                if (window.togglePromptMode) window.togglePromptMode();
                const el = document.getElementById('prompt-raw');
                if (el) { el.value = meta['Prompt']; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
            }
        }
        
        // 다중 캐릭터 프롬프트 복원
        if (optChar) {
            const extraContainer = document.getElementById('extra-chars-container');
            if (extraContainer) extraContainer.innerHTML = '';
            window.EXTRA_CHAR_COUNT = 0;
            if (meta['Extra Characters']) {
                meta['Extra Characters'].forEach((charText, idx) => {
                    if (window.addExtraCharacter) window.addExtraCharacter();
                    const boxes = document.querySelectorAll('[id^="char-subject-"]');
                    const lastBox = boxes[boxes.length - 1];
                    if (lastBox) lastBox.value = charText;
                    
                    if (meta['Negative Extra Characters'] && meta['Negative Extra Characters'][idx]) {
                        const negBoxes = document.querySelectorAll('[id^="char-negative-"]');
                        const lastNegBox = negBoxes[negBoxes.length - 1];
                        if (lastNegBox) lastNegBox.value = meta['Negative Extra Characters'][idx];
                    }
                });
            }
        }
        
        if (optNegative && meta['Negative Prompt'] !== undefined) {
            const el = document.getElementById('nai-negative');
            if (el) { el.value = meta['Negative Prompt']; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
        }
        }

        if (optRes && meta['Resolution']) {
            const resVal = meta['Resolution'].replace(' x ', 'x');
            const radio = document.querySelector(`input[name="nai-res"][value="${resVal}"]`);
            if(radio) radio.checked = true;
        }

        if (optSeed && meta['Seed'] !== undefined) {
            const el = document.getElementById('nai-seed');
            if(el) el.value = meta['Seed'];
        }

        if (optSettings) {
            if (meta['Steps']) { const el = document.getElementById('nai-steps'); if(el) el.value = meta['Steps']; }
            if (meta['CFG Scale']) { const el = document.getElementById('nai-scale'); if(el) el.value = meta['CFG Scale']; }
            if (meta['Sampler']) { const el = document.getElementById('nai-sampler'); if(el) el.value = meta['Sampler']; }
            if (meta['SMEA'] !== undefined) { const el = document.getElementById('nai-sm'); if(el) el.checked = meta['SMEA']; }
            if (meta['SMEA DYN'] !== undefined) { const el = document.getElementById('nai-sm-dyn'); if(el) el.checked = meta['SMEA DYN']; }
        }
        
        if (window.updateModelSpecificUI) window.updateModelSpecificUI();
        if (window.saveCraftSettings) window.saveCraftSettings();
        if (window.switchTab) window.switchTab('craft');
        window.closeImportModal(null, true);
        
        alert('선택한 메타데이터를 성공적으로 불러왔습니다!');
        
    } catch (e) {
        alert('불러오기 실패: ' + e.message);
    }
};

/**
 * 역할: 현재 선택된 임시 이미지의 메타데이터 가져오기를 importMetadata로 위임한다.
 * 매개변수: 없음.
 * 주요 변수: CRAFT_ACTIVE_INDEX, imgData - 선택된 임시 이미지 정보.
 * 반환값: 명시 반환 없음.
 */
window.importTempImageMetadata = function() {
    if (window.CRAFT_ACTIVE_INDEX === null) return;
    const imgData = window.TEMP_IMAGES[window.CRAFT_ACTIVE_INDEX];
    if (!imgData) return;
    
    // 임시 보관함에서 직접 불러오기를 실행할 때도 동일한 로직을 경유합니다.
    window.importMetadata(imgData.key);
};

/**
 * 역할: 업로드 예정 파일명 입력값과 변환 확장자를 반영해 미리보기 파일명을 갱신한다.
 * 매개변수: 없음.
 * 주요 변수: galleryFileToUpload, finalName, ext, customName, previewName - 표시 파일명 구성값.
 * 반환값: 명시 반환 없음.
 */
window.updateGalleryPreviewText = function() {
    if (!window.galleryFileToUpload) return;
    let finalName = window.galleryFileToUpload.name;
    let ext = finalName.split('.').pop() || 'webp';
    if (window.galleryFileToUpload.type.startsWith('image/') && window.galleryFileToUpload.type !== 'image/gif' && window.galleryFileToUpload.type !== 'image/svg+xml') {
        ext = 'webp'; let baseName = finalName.replace(/\.[^/.]+$/, ""); finalName = baseName + ".webp";
    }
    const fileNameInput = document.getElementById('gallery-upload-filename'); const customName = fileNameInput ? fileNameInput.value.trim() : '';
    const previewName = document.getElementById('gallery-preview-filename');
    if(previewName) previewName.textContent = customName ? `${customName}.${ext}` : finalName;
};

/**
 * 역할: 갤러리 업로드 파일을 선택 상태에 저장하고 이미지 미리보기를 표시한다.
 * 매개변수: file - 사용자가 선택한 이미지 File 객체.
 * 주요 변수: galleryFileToUpload, preview, prompt, container, submitBtn - 업로드 상태와 UI 요소.
 * 반환값: 명시 반환 없음. 이미지가 아니면 alert 후 종료한다.
 */
window.showGalleryPreview = function(file) {
    if (!file.type.startsWith('image/')) return alert('이미지만 가능합니다.');
    window.galleryFileToUpload = file;
    const preview = document.getElementById('gallery-image-preview');
    if (preview && preview.src && preview.src.startsWith('blob:')) URL.revokeObjectURL(preview.src);
    if (preview) preview.src = URL.createObjectURL(file);
    const prompt = document.getElementById('gallery-upload-prompt'); const container = document.getElementById('gallery-preview-container'); const submitBtn = document.getElementById('gallery-upload-submit-btn');
    if (prompt) prompt.classList.add('hidden');
    if (container) { container.classList.remove('hidden'); container.classList.add('flex'); }
    if (submitBtn) submitBtn.disabled = false;
    window.updateGalleryPreviewText();
};

/**
 * 역할: 갤러리 업로드 파일 선택, 미리보기, 버튼 상태를 초기화한다.
 * 매개변수: 없음.
 * 주요 변수: galleryFileToUpload, fileInput, prompt, container, submitBtn, preview - 초기화 대상.
 * 반환값: 명시 반환 없음.
 */
window.clearGalleryUploadInputs = function() {
    window.galleryFileToUpload = null;
    const fileInput = document.getElementById('gallery-file-input'); const prompt = document.getElementById('gallery-upload-prompt'); const container = document.getElementById('gallery-preview-container'); const submitBtn = document.getElementById('gallery-upload-submit-btn'); const preview = document.getElementById('gallery-image-preview');
    if (fileInput) fileInput.value = '';
    if (prompt) prompt.classList.remove('hidden');
    if (container) { container.classList.add('hidden'); container.classList.remove('flex'); }
    if (submitBtn) submitBtn.disabled = true;
    if (preview && preview.src && preview.src.startsWith('blob:')) { URL.revokeObjectURL(preview.src); preview.src = ''; }
};

/**
 * 역할: 갤러리 업로드 입력 전체를 초기 상태로 되돌린다.
 * 매개변수: 없음.
 * 주요 변수: fileNameInput - 추가로 비울 사용자 지정 파일명 입력.
 * 반환값: 명시 반환 없음.
 */
window.resetGalleryUpload = function() {
    window.clearGalleryUploadInputs();
    const fileNameInput = document.getElementById('gallery-upload-filename');
    if (fileNameInput) fileNameInput.value = '';
};

/**
 * 역할: 현재 폴더 경로를 표시하며 갤러리 업로드 모달을 연다.
 * 매개변수: 없음.
 * 주요 변수: modal, pathDisplay, currentPrefix - 열 모달과 표시할 업로드 경로.
 * 반환값: 명시 반환 없음.
 */
window.openGalleryUploadModal = function() {
    const modal = document.getElementById('gallery-upload-modal'); const pathDisplay = document.getElementById('gallery-upload-path');
    if(!modal) return;
    pathDisplay.textContent = '/' + window.currentPrefix;
    modal.classList.remove('hidden'); window.resetGalleryUpload();
    history.pushState({ modal: 'upload' }, '', '#upload');
};

/**
 * 역할: 갤러리 업로드 모달을 닫고 입력을 초기화한다.
 * 매개변수: e - 닫기 이벤트 객체, skipHistory - history.back 생략 여부.
 * 주요 변수: modal - 닫을 업로드 모달.
 * 반환값: 명시 반환 없음.
 */
window.closeGalleryUploadModal = function(e, skipHistory = false) {
    if (e && e.target !== e.currentTarget && e.target.id !== 'close-gallery-btn') return;
    const modal = document.getElementById('gallery-upload-modal');
    if (modal && !modal.classList.contains('hidden')) { modal.classList.add('hidden'); window.resetGalleryUpload(); if (!skipHistory) history.back(); }
};

/**
 * 역할: 새 텍스트 메모 작성 모달을 초기화하고 연다.
 * 매개변수: 없음.
 * 주요 변수: modal, prefixEl, currentPrefix - 모달과 현재 저장 경로 표시값.
 * 반환값: 명시 반환 없음.
 */
window.openMemoCreateModal = function() {
    const modal = document.getElementById('memo-create-modal'); if(!modal) return;
    document.getElementById('memo-create-filename').value = ''; document.getElementById('memo-create-content').value = '';
    const prefixEl = document.getElementById('memo-create-prefix'); if (prefixEl) prefixEl.textContent = '/' + window.currentPrefix;
    modal.classList.remove('hidden'); history.pushState({ modal: 'memo' }, '', '#memo');
};

/**
 * 역할: 메모 작성 모달을 닫고 필요하면 브라우저 history를 되돌린다.
 * 매개변수: e - 닫기 이벤트 객체, skipHistory - history.back 생략 여부.
 * 주요 변수: modal - 닫을 메모 모달.
 * 반환값: 명시 반환 없음.
 */
window.closeMemoCreateModal = function(e, skipHistory = false) {
    if (e && e.target !== e.currentTarget && e.target.id !== 'close-memo-btn') return;
    const modal = document.getElementById('memo-create-modal');
    if (modal && !modal.classList.contains('hidden')) { modal.classList.add('hidden'); if (!skipHistory) history.back(); }
};

function capturePreviewModalScrollState() {
    const projectRoot = document.getElementById('main-project-content');
    const scrollables = projectRoot
        ? Array.from(projectRoot.querySelectorAll('.overflow-y-auto, [class*="overflow-y-auto"]'))
        : [];

    window.PREVIEW_MODAL_SCROLL_STATE = {
        windowX: window.scrollX,
        windowY: window.scrollY,
        entries: scrollables.map(el => ({ el, top: el.scrollTop, left: el.scrollLeft }))
    };
}

function restorePreviewModalScrollState() {
    const state = window.PREVIEW_MODAL_SCROLL_STATE;
    if (!state) return;

    const restore = () => {
        window.scrollTo(state.windowX || 0, state.windowY || 0);
        (state.entries || []).forEach(entry => {
            if (!entry.el?.isConnected) return;
            entry.el.scrollTop = entry.top || 0;
            entry.el.scrollLeft = entry.left || 0;
        });
    };

    restore();
    requestAnimationFrame(restore);
    setTimeout(restore, 0);
}

window.restorePreviewModalScrollState = restorePreviewModalScrollState;

/**
 * 역할: 파일 종류에 맞춰 미리보기 모달을 열고 이미지/텍스트/기타 파일 UI를 구성한다.
 * 매개변수: key - 파일 경로, url - 파일 URL, isImage - 이미지 여부, isText - 텍스트 여부, isPublic - 공개 여부, skipHistory - history push 생략 여부.
 * 주요 변수: currentFileKey, fileName, alias, imgEl, textEl, publicCheck - 모달 상태와 표시 대상.
 * 반환값: 명시 반환 없음.
 */
window.openModal = async function(key, url, isImage, isText, isPublic, skipHistory = false) {
    capturePreviewModalScrollState();
    window.currentFileKey = key;
    const fileName = key.split('/').pop(); const alias = window.getAliasOnly(key, false);
    document.getElementById('modal-title').innerHTML = alias ? `${alias} <span class="text-xs sm:text-sm font-normal text-gray-500 dark:text-gray-400 ml-1 sm:ml-2">(${fileName})</span>` : fileName;
    const modalKey = document.getElementById('modal-key'); if(modalKey) modalKey.innerText = key;
    
    const imgEl = document.getElementById('modal-img'); const textEl = document.getElementById('modal-text-editor');
    const imgActions = document.getElementById('img-actions'); const textActions = document.getElementById('text-actions'); const guestMsg = document.getElementById('modal-text-message'); const publicCheckWrapper = document.getElementById('public-check-wrapper');
    const publicCheck = document.getElementById('modal-public-check');
    if (publicCheck) { publicCheck.checked = isPublic; publicCheck.onclick = (e) => window.toggleFilePublic(e.target.checked); }

    if(imgEl) imgEl.classList.add('hidden'); if(textEl) textEl.classList.add('hidden'); if(imgActions) imgActions.classList.add('hidden'); if(textActions) textActions.classList.add('hidden'); if(guestMsg) guestMsg.classList.add('hidden'); if(publicCheckWrapper) publicCheckWrapper.classList.add('hidden'); 

    if (isImage) {
        if(imgEl) { imgEl.src = url; imgEl.classList.remove('hidden'); }
        if(imgActions) {
            imgActions.classList.remove('hidden'); imgActions.classList.add('flex');
            if (!document.getElementById('modal-inpaint-craft-btn')) {
                const inpaintBtn = document.createElement('button');
                inpaintBtn.id = 'modal-inpaint-craft-btn';
                inpaintBtn.className = 'modal-action-button flex-1 sm:flex-none flex justify-center items-center gap-1.5 text-xs sm:text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 px-3 py-2 border border-gray-200 dark:border-gray-600 sm:border-transparent rounded sm:hover:bg-gray-100 dark:hover:bg-gray-700 transition';
                inpaintBtn.title = '인페인트로 생성';
                inpaintBtn.innerHTML = `<i data-lucide="paintbrush" class="w-4 h-4"></i><span class="modal-action-label">인페인트</span>`;
                imgActions.appendChild(inpaintBtn);
            }
            const inpaintBtn = document.getElementById('modal-inpaint-craft-btn');
            if (inpaintBtn) inpaintBtn.onclick = () => window.openModalImageInInpaint(key);
            if (window.IS_ADMIN && !document.getElementById('import-meta-btn')) {
                const importBtn = document.createElement('button'); importBtn.id = 'import-meta-btn'; importBtn.className = 'modal-action-button flex-1 sm:flex-none flex justify-center items-center gap-1.5 text-xs sm:text-sm text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 px-3 py-2 border border-gray-200 dark:border-gray-600 sm:border-transparent rounded sm:hover:bg-gray-100 dark:hover:bg-gray-700 transition';
                importBtn.title = '메타데이터 불러오기';
                importBtn.innerHTML = `<i data-lucide="import" class="w-4 h-4"></i><span class="modal-action-label">메타데이터</span>`; importBtn.onclick = () => window.importMetadata(window.currentFileKey);
                imgActions.appendChild(importBtn); if (window.lucide) window.lucide.createIcons();
            }
            if (window.lucide) window.lucide.createIcons();
        }
    } else if (isText) {
        if(textEl) {
            textEl.classList.remove('hidden');
            if(window.IS_ADMIN && textActions) { textActions.classList.remove('hidden'); textActions.classList.add('flex'); if(publicCheckWrapper) publicCheckWrapper.classList.remove('hidden'); }
            try { textEl.value = "불러오는 중..."; const res = await fetch(url); if(res.ok) { textEl.value = await res.text(); } else { textEl.value = "내용을 불러올 수 없습니다. (비공개 파일)"; } } catch(e) { textEl.value = "오류 발생: " + e.message; }
        }
    } else {
        if(textEl) { textEl.value = "미리보기를 지원하지 않는 파일입니다."; textEl.classList.remove('hidden'); }
    }
    document.getElementById('modal-url').value = url.split('?')[0]; document.getElementById('preview-modal').classList.remove('hidden');
    if (!skipHistory) history.pushState({ modal: 'preview', key: key }, '', '#' + key);
};

/**
 * 역할: 현재 파일의 공개/비공개 상태를 서버에 저장하고 갤러리를 갱신한다.
 * 매개변수: isPublic - 새 공개 상태.
 * 주요 변수: currentFileKey, res, chk - 변경 대상과 실패 시 복구할 체크박스.
 * 반환값: 명시 반환 없음.
 */
window.toggleFilePublic = async function(isPublic) {
    try {
        const res = await fetch('/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle_public', key: window.currentFileKey, isPublic: isPublic }) });
        if (!res.ok) throw new Error('설정 변경 실패');
        alert(isPublic ? "파일이 [공개] 상태로 변경되었습니다." : "파일이 [비공개] 상태로 변경되었습니다."); window.refreshGallery();
    } catch(err) { alert('설정 토글 에러: ' + err.message); const chk = document.getElementById('modal-public-check'); if(chk) chk.checked = !isPublic; }
};

/**
 * 역할: 미리보기 모달을 닫고 이미지/텍스트/교체 입력 상태를 초기화한다.
 * 매개변수: e - 닫기 이벤트 객체, skipHistory - history.back 생략 여부.
 * 주요 변수: modal, imgEl, textEl, replaceInput, currentFileKey - 초기화 대상.
 * 반환값: 명시 반환 없음.
 */
window.closeModal = function(e, skipHistory = false) {
    if (e && e.target !== e.currentTarget && e.target.id !== 'close-btn') return;
    const modal = document.getElementById('preview-modal');
    if (modal && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
        const imgEl = document.getElementById('modal-img'); if(imgEl) imgEl.src = '';
        const textEl = document.getElementById('modal-text-editor'); if(textEl) textEl.value = '';
        const replaceInput = document.getElementById('replace-input'); if(replaceInput) replaceInput.value = '';
        window.currentFileKey = '';
        restorePreviewModalScrollState();
        if (!skipHistory) {
            window.SKIP_NEXT_MODAL_CLOSE_ROUTE_RESTORE = true;
            history.back();
        }
    }
};

/**
 * 역할: 모달의 파일 URL을 클립보드에 복사하고 버튼 문구를 잠시 변경한다.
 * 매개변수: 없음.
 * 주요 변수: input, btn, originalText - 복사 대상과 버튼 상태.
 * 반환값: 명시 반환 없음.
 */
window.copyModalUrl = function() {
    const input = document.getElementById('modal-url'); input.select(); document.execCommand('copy');
    const btn = document.getElementById('modal-copy-btn'); const originalText = btn.innerText; btn.innerText = '완료!'; setTimeout(() => { btn.innerText = originalText; }, 1000);
};

/**
 * 역할: 텍스트 미리보기/편집기의 내용을 클립보드에 복사한다.
 * 매개변수: 없음.
 * 주요 변수: textEl - 복사할 텍스트 영역.
 * 반환값: 명시 반환 없음.
 */
window.copyTextContent = function() {
    const textEl = document.getElementById('modal-text-editor'); textEl.select(); document.execCommand('copy'); alert('내용이 복사되었습니다.');
};

/**
 * 역할: 현재 파일을 사용자가 선택한 새 파일로 교체하고 이미지 메타데이터를 갱신한다.
 * 매개변수: input - 교체 파일을 담은 file input 요소.
 * 주요 변수: file, btn, extractedMetadata, headers, buffer, res, newSrc - 교체 파일과 업로드 상태.
 * 반환값: 명시 반환 없음.
 */
window.handleReplaceFile = async function(input) {
    let file = input.files[0]; if (!file) return;
    if (!confirm(`현재 파일(${window.currentFileKey})을 선택한 파일로 교체하시겠습니까?`)) { input.value = ''; return; }
    const btn = input.nextElementSibling; let originalText = '';
    if (btn) { originalText = btn.innerHTML; btn.innerHTML = '교체 중...'; btn.disabled = true; }

    try {
        let extractedMetadata = null;
        if (file.type.startsWith('image/')) {
             if(btn) btn.innerHTML = '메타데이터 추출...'; extractedMetadata = await window.extractMetadata(file);
             if(btn) btn.innerHTML = 'WebP 변환 중...'; file = await window.convertToWebP(file);
             if(btn) btn.innerHTML = '교체 중...';
        }
        
        const headers = { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Absolute-Path': encodeURIComponent(window.currentFileKey) };
        const buffer = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error("FileReader 에러")); r.readAsArrayBuffer(file); });
        const res = await fetch('/api/upload?_t=' + Date.now(), { method: 'PUT', headers: headers, body: buffer, cache: 'no-store' });
        if (!res.ok) throw new Error('교체 실패');

        if (extractedMetadata) {
            const parts = window.currentFileKey.split('/'); const fileName = parts.pop(); const prefix = parts.length > 0 ? parts.join('/') + '/' : '';
            await window.saveMetadataToDB(prefix, fileName, extractedMetadata);
        }
        const newSrc = window.location.origin + '/' + window.currentFileKey + '?t=' + Date.now();
        const img = document.getElementById('modal-img'); if(img) img.src = newSrc;
        const gridItem = document.querySelector(`div[data-key="${window.currentFileKey}"] img`); if (gridItem) gridItem.src = newSrc;
        alert('파일이 교체되었습니다.'); window.refreshGallery();
    } catch (err) { alert('오류 발생: ' + err.message); } 
    finally { if (btn) { btn.innerHTML = originalText; btn.disabled = false; } input.value = ''; }
};

/**
 * 역할: 텍스트 모달에서 편집한 내용을 현재 파일 경로로 다시 저장한다.
 * 매개변수: 없음.
 * 주요 변수: content, blob, fileName, headers, buffer, res - 저장할 텍스트와 업로드 데이터.
 * 반환값: 명시 반환 없음.
 */
window.saveEditedText = async function() {
    if (!confirm('변경된 내용을 저장하시겠습니까?')) return;
    const content = document.getElementById('modal-text-editor').value; const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const fileName = window.currentFileKey.split('/').pop();
    try {
        const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'X-File-Name': encodeURIComponent(fileName), 'X-Absolute-Path': encodeURIComponent(window.currentFileKey) };
        const buffer = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsArrayBuffer(blob); });
        const res = await fetch('/api/upload?_t=' + Date.now(), { method: 'PUT', headers: headers, body: buffer, cache: 'no-store' });
        if (!res.ok) throw new Error('저장 실패');
        alert('저장되었습니다.'); window.refreshGallery();
    } catch (err) { alert(err.message); }
};

/**
 * 역할: Craft 프로젝트/캐릭터 선택값을 기준으로 메타데이터 가져오기 모달을 연다.
 * 매개변수: 없음.
 * 주요 변수: projSelect, charSelect, proj, char, IMPORT_BASE_PREFIX, targetPath - 탐색 시작 경로.
 * 반환값: 명시 반환 없음.
 */
function getFullImportApplyOptions() {
    return {
        optStyle: true,
        optComp: true,
        optChar: true,
        optCloth: true,
        optExp: true,
        optAct: true,
        optBg: true,
        optNegative: true,
        optRes: true,
        optSettings: true,
        optSeed: false
    };
}

function normalizeImportApplyOptions(options = {}) {
    return {
        ...getFullImportApplyOptions(),
        ...(options || {}),
        optSeed: false
    };
}

function getImportApplyOptions() {
    return {
        optStyle: document.getElementById('import-opt-style')?.checked ?? true,
        optComp: document.getElementById('import-opt-composition')?.checked ?? true,
        optChar: document.getElementById('import-opt-character')?.checked ?? true,
        optCloth: document.getElementById('import-opt-clothing')?.checked ?? true,
        optExp: document.getElementById('import-opt-expression')?.checked ?? true,
        optAct: document.getElementById('import-opt-action')?.checked ?? true,
        optBg: document.getElementById('import-opt-background')?.checked ?? true,
        optNegative: document.getElementById('import-opt-negative')?.checked ?? true,
        optRes: document.getElementById('import-opt-res')?.checked ?? true,
        optSettings: document.getElementById('import-opt-settings')?.checked ?? false,
        optSeed: false
    };
}

function applyImportedMetadataObject(meta, applyOptions = getImportApplyOptions()) {
    if (!meta) throw new Error('불러올 메타데이터가 없습니다.');
    if (meta['Raw Data'] && !meta['Prompt'] && !meta['Split Prompts']) {
        alert('지원되는 NovelAI 메타데이터 형식이 아닙니다. 원본 텍스트:\n' + meta['Raw Data']);
        return false;
    }

    const options = normalizeImportApplyOptions(applyOptions);
    applyImportedMetadataToCraft(meta, options);

    if (options.optRes && meta['Resolution']) {
        const resVal = meta['Resolution'].replace(' x ', 'x');
        const radio = document.querySelector(`input[name="nai-res"][value="${resVal}"]`);
        if (radio) radio.checked = true;
    }

    if (options.optSeed && meta['Seed'] !== undefined) {
        const el = document.getElementById('nai-seed');
        if (el) el.value = meta['Seed'];
    }

    if (options.optSettings) {
        if (meta['Steps']) { const el = document.getElementById('nai-steps'); if (el) el.value = meta['Steps']; }
        if (meta['CFG Scale']) { const el = document.getElementById('nai-scale'); if (el) el.value = meta['CFG Scale']; }
        if (meta['Sampler']) { const el = document.getElementById('nai-sampler'); if (el) el.value = meta['Sampler']; }
        if (meta['SMEA'] !== undefined) { const el = document.getElementById('nai-sm'); if (el) el.checked = meta['SMEA']; }
        if (meta['SMEA DYN'] !== undefined) { const el = document.getElementById('nai-sm-dyn'); if (el) el.checked = meta['SMEA DYN']; }
    }

    if (window.updateModelSpecificUI) window.updateModelSpecificUI();
    if (window.saveCraftSettings) window.saveCraftSettings();
    if (window.switchTab) window.switchTab('craft');
    return true;
}

async function loadFileMetadataForImport(fileKey) {
    const parts = String(fileKey || '').split('/');
    const fileName = parts.pop();
    const prefix = parts.length > 0 ? parts.join('/') + '/' : '';
    if (!fileName) throw new Error('파일 경로가 올바르지 않습니다.');

    const res = await fetch(`/api/db/file-metadata?folderPrefix=${encodeURIComponent(prefix)}&fileName=${encodeURIComponent(fileName)}&_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('해당 이미지에 저장된 메타데이터가 없습니다.');

    const payload = await res.json();
    if (!payload.data) throw new Error('해당 이미지에 저장된 메타데이터가 없습니다.');
    return payload.data;
}

window.openModalImageInInpaint = async function(fileKey = window.currentFileKey) {
    const key = String(fileKey || '');
    if (!/\.(jpg|jpeg|png|webp)$/i.test(key.split('/').pop() || '')) {
        alert('이미지 파일만 인페인트로 보낼 수 있습니다.');
        return;
    }

    const btn = document.getElementById('modal-inpaint-craft-btn');
    const originalHtml = btn?.innerHTML || '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span class="modal-action-label">준비</span>';
        if (window.lucide) window.lucide.createIcons();
    }

    try {
        try {
            const meta = await loadFileMetadataForImport(key);
            const applied = applyImportedMetadataObject(meta, getFullImportApplyOptions());
            if (!applied && window.switchTab) window.switchTab('craft');
        } catch (err) {
            console.warn('Prompt metadata could not be imported for inpaint handoff:', err);
            if (window.switchTab) window.switchTab('craft');
        }

        try {
            localStorage.setItem('imggul_inpaint_upload_source_key', key);
        } catch {}
        window.CRAFT_UPLOAD_INPAINT_SOURCE_KEY = key;

        if (window.closeModal) window.closeModal(null, true);
        if (window.setInpaintImageFromKey) window.setInpaintImageFromKey(key);
        else alert('인페인트 기능을 초기화할 수 없습니다.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
            if (window.lucide) window.lucide.createIcons();
        }
    }
};

const IMPORT_CONTEXT_STORAGE_KEY = 'imggul_craft_upload_context';

function normalizeImportPath(path) {
    return path && !path.endsWith('/') ? `${path}/` : (path || '');
}

function readImportContextCache() {
    try {
        return JSON.parse(localStorage.getItem(IMPORT_CONTEXT_STORAGE_KEY) || '{}') || {};
    } catch {
        return {};
    }
}

function writeImportContextCache(cache) {
    try {
        localStorage.setItem(IMPORT_CONTEXT_STORAGE_KEY, JSON.stringify(cache || {}));
    } catch {}
}

function cacheImportProjectContext({ projectPath, characterPath, situationId, characterVariantId, situationVariantId, backgroundPromptId } = {}) {
    const normalizedProject = normalizeImportPath(projectPath);
    if (!normalizedProject) return;
    const cache = readImportContextCache();
    cache.projectPath = normalizedProject;
    cache.byProject = cache.byProject || {};
    const projectCache = {
        ...(cache.byProject[normalizedProject] || {}),
        characterPath: normalizeImportPath(characterPath),
        situationId: situationId || ''
    };
    if (characterVariantId !== undefined) projectCache.characterVariantId = characterVariantId || '';
    if (situationVariantId !== undefined) projectCache.situationVariantId = situationVariantId || '';
    if (backgroundPromptId !== undefined) projectCache.backgroundPromptId = backgroundPromptId || '';
    cache.byProject[normalizedProject] = projectCache;
    writeImportContextCache(cache);
    if (window.cacheCraftUploadSelection) {
        window.cacheCraftUploadSelection({ projectPath: normalizedProject, characterPath, situationId });
    }
}

function makeImportPickerItem({ type, label, subLabel = '', active = false, onClick }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.pickerType = type;
    button.dataset.searchText = `${label} ${subLabel}`.toLowerCase();
    button.className = 'w-full flex items-center text-left gap-2 px-2.5 py-2 rounded-md border border-transparent hover:border-indigo-300 dark:hover:border-indigo-700 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 transition min-w-0';
    button.onclick = onClick;
    button.innerHTML = `
        <span class="min-w-0 flex-1">
            <span class="block text-xs font-bold truncate">${label}</span>
            ${subLabel ? `<span class="block text-[10px] text-gray-500 dark:text-gray-400 truncate">${subLabel}</span>` : ''}
        </span>
        <i data-lucide="check" class="w-3.5 h-3.5 text-indigo-500 ${active ? '' : 'invisible'}"></i>
    `;
    return button;
}

function setImportListMessage(id, message) {
    const list = document.getElementById(id);
    if (list) list.innerHTML = `<div class="py-5 text-center text-xs text-gray-500 dark:text-gray-400">${message}</div>`;
}

function getImportSituationLabel(situation, index) {
    const number = Number.isFinite(Number(situation?.imageNumber)) ? Number(situation.imageNumber) : index;
    const name = situation?.alias || situation?.name || situation?.id || `상황 ${number}`;
    return `${number} - ${name}`;
}

function getSelectedImportCharacter(state = window.IMPORT_PROJECT_PICKER_STATE || {}) {
    return (state.characters || []).find(character => character.prefix === state.characterPath) || null;
}

function getSelectedImportSituation(state = window.IMPORT_PROJECT_PICKER_STATE || {}) {
    return (state.situations || []).find((situation, index) => {
        const id = situation.id || situation.folderName || `situation-${index + 1}`;
        return String(id) === String(state.situationId);
    }) || null;
}

function setImportVariantSelect(type, items = [], selectedId = '') {
    const id = type === 'background' ? 'import-background-select' : `import-${type}-variant-select`;
    const select = document.getElementById(id);
    if (!select) return;
    const emptyMessage = {
        background: '프로젝트를 먼저 선택하세요',
        character: '캐릭터를 먼저 선택하세요',
        situation: '상황을 먼저 선택하세요'
    }[type] || '선택 항목이 없습니다.';

    select.innerHTML = '';
    if (!items.length) {
        select.disabled = true;
        select.appendChild(new Option(emptyMessage, ''));
        return;
    }

    select.disabled = false;
    items.forEach(item => {
        select.appendChild(new Option(item.name || item.label || item.id || 'Default', item.id || 'default'));
    });
    select.value = items.some(item => item.id === selectedId) ? selectedId : (items[0]?.id || '');
}

async function loadImportCharacterVariants(characterPath, restoreCached = false) {
    const state = window.IMPORT_PROJECT_PICKER_STATE || {};
    state.characterPath = normalizeImportPath(characterPath);
    state.characterVariants = [];
    state.characterVariantId = '';
    window.IMPORT_PROJECT_PICKER_STATE = state;
    setImportVariantSelect('character', []);

    const character = getSelectedImportCharacter(state);
    if (!character) {
        updateImportProjectSummary();
        return;
    }

    const meta = window.loadCharacterMeta ? await window.loadCharacterMeta(character).catch(() => ({})) : {};
    const variants = window.normalizeCharacterPromptVariants ? window.normalizeCharacterPromptVariants(meta) : [];
    const cache = readImportContextCache();
    const projectCache = cache.byProject?.[state.projectPath] || {};
    const cachedId = restoreCached ? projectCache.characterVariantId : '';
    const selectedId = variants.some(variant => variant.id === cachedId)
        ? cachedId
        : (meta.activePromptVariantId || variants[0]?.id || 'default');

    state.characterMeta = meta;
    state.characterVariants = variants;
    state.characterVariantId = selectedId;
    window.IMPORT_PROJECT_PICKER_STATE = state;
    setImportVariantSelect('character', variants, selectedId);
    updateImportProjectSummary();
}

function loadImportSituationVariants(situationId, restoreCached = false) {
    const state = window.IMPORT_PROJECT_PICKER_STATE || {};
    state.situationId = situationId || '';
    const situation = getSelectedImportSituation(state);
    const variants = situation && window.normalizeSituationPromptVariants ? window.normalizeSituationPromptVariants(situation) : [];
    const cache = readImportContextCache();
    const projectCache = cache.byProject?.[state.projectPath] || {};
    const cachedId = restoreCached ? projectCache.situationVariantId : '';
    const selectedId = variants.some(variant => variant.id === cachedId)
        ? cachedId
        : (situation?.activePromptVariantId || variants[0]?.id || 'default');

    state.situationVariants = variants;
    state.situationVariantId = selectedId;
    window.IMPORT_PROJECT_PICKER_STATE = state;
    setImportVariantSelect('situation', variants, selectedId);
    updateImportProjectSummary();
}

async function loadImportBackgroundOptions(project, restoreCached = false) {
    const state = window.IMPORT_PROJECT_PICKER_STATE || {};
    const data = window.loadProjectBackgroundPrompts
        ? await window.loadProjectBackgroundPrompts(project).catch(() => null)
        : null;
    const backgrounds = data?.backgrounds || [];
    const cache = readImportContextCache();
    const projectCache = cache.byProject?.[state.projectPath] || {};
    const cachedId = restoreCached ? projectCache.backgroundPromptId : '';
    const selectedId = backgrounds.some(background => background.id === cachedId)
        ? cachedId
        : (data?.activeBackgroundId || backgrounds[0]?.id || '');

    state.backgrounds = backgrounds;
    state.backgroundPromptId = selectedId;
    window.IMPORT_PROJECT_PICKER_STATE = state;
    setImportVariantSelect('background', backgrounds, selectedId);
    updateImportProjectSummary();
}

async function initImportProjectPicker() {
    const cache = readImportContextCache();
    const projectPath = normalizeImportPath(cache.projectPath || document.getElementById('craft-project-select')?.value || '');
    const projectCache = cache.byProject?.[projectPath] || {};
    window.IMPORT_PROJECT_PICKER_STATE = {
        projects: [],
        characters: [],
        situations: [],
        projectPath,
        characterPath: normalizeImportPath(projectCache.characterPath || document.getElementById('craft-char-select')?.value || ''),
        situationId: projectCache.situationId || document.getElementById('craft-situation-select')?.value || '',
        characterVariants: [],
        situationVariants: [],
        backgrounds: [],
        characterVariantId: projectCache.characterVariantId || '',
        situationVariantId: projectCache.situationVariantId || '',
        backgroundPromptId: projectCache.backgroundPromptId || ''
    };
    await loadImportProjectList();
    if (projectPath) await loadImportProjectTargets(projectPath, true);
    updateImportProjectSummary();
}

async function loadImportProjectList() {
    setImportListMessage('import-project-list', '불러오는 중...');
    try {
        const state = window.IMPORT_PROJECT_PICKER_STATE || {};
        state.projects = window.loadProjects ? await window.loadProjects() : [];
        window.IMPORT_PROJECT_PICKER_STATE = state;
        renderImportProjectList('project');
    } catch (err) {
        setImportListMessage('import-project-list', err.message || '프로젝트 목록을 불러오지 못했습니다.');
    }
}

async function loadImportProjectTargets(projectPath, restoreCached = false) {
    const state = window.IMPORT_PROJECT_PICKER_STATE || {};
    state.projectPath = normalizeImportPath(projectPath);
    if (!restoreCached) {
        state.characterPath = '';
        state.situationId = '';
        state.characterVariantId = '';
        state.situationVariantId = '';
        state.backgroundPromptId = '';
    }
    state.characterVariants = [];
    state.situationVariants = [];
    state.backgrounds = [];
    window.IMPORT_PROJECT_PICKER_STATE = state;
    setImportListMessage('import-character-list', '불러오는 중...');
    setImportListMessage('import-situation-list', '불러오는 중...');
    setImportVariantSelect('character', []);
    setImportVariantSelect('situation', []);
    setImportVariantSelect('background', []);

    try {
        const project = window.getProjectByPrefix ? window.getProjectByPrefix(state.projectPath) : null;
        if (!project) throw new Error('선택한 프로젝트를 찾을 수 없습니다.');
        const cache = readImportContextCache();
        const projectCache = cache.byProject?.[state.projectPath] || {};
        await Promise.all([
            window.loadProjectCharacters(project, true),
            window.loadProjectSituations(project, true),
            loadImportBackgroundOptions(project, restoreCached)
        ]);
        state.characters = window.getProjectItems ? window.getProjectItems(project, 'characters') : [];
        state.situations = window.getProjectItems ? window.getProjectItems(project, 'situations') : [];
        if (restoreCached && projectCache.characterPath && state.characters.some(item => item.prefix === projectCache.characterPath)) state.characterPath = projectCache.characterPath;
        if (restoreCached && projectCache.situationId && state.situations.some(item => String(item.id || item.folderName) === String(projectCache.situationId))) state.situationId = projectCache.situationId;
        window.IMPORT_PROJECT_PICKER_STATE = state;
        renderImportProjectList('project');
        renderImportProjectList('character');
        renderImportProjectList('situation');
        if (state.characterPath) await loadImportCharacterVariants(state.characterPath, restoreCached);
        if (state.situationId) loadImportSituationVariants(state.situationId, restoreCached);
        updateImportProjectSummary();
    } catch (err) {
        setImportListMessage('import-character-list', err.message || '캐릭터 목록을 불러오지 못했습니다.');
        setImportListMessage('import-situation-list', err.message || '상황 목록을 불러오지 못했습니다.');
    }
}

function renderImportProjectList(type) {
    const state = window.IMPORT_PROJECT_PICKER_STATE || {};
    const list = document.getElementById(`import-${type}-list`);
    if (!list) return;
    list.innerHTML = '';
    if (type === 'project') {
        (state.projects || []).forEach(project => {
            list.appendChild(makeImportPickerItem({
                type,
                label: project.name || project.folderName,
                subLabel: project.prefix,
                active: project.prefix === state.projectPath,
                onClick: async () => loadImportProjectTargets(project.prefix)
            }));
        });
    } else if (type === 'character') {
        (state.characters || []).forEach(character => {
            list.appendChild(makeImportPickerItem({
                type,
                label: character.name || character.alias || character.folderName || character.id,
                subLabel: character.prefix,
                active: character.prefix === state.characterPath,
                onClick: async () => {
                    state.characterPath = character.prefix;
                    window.IMPORT_PROJECT_PICKER_STATE = state;
                    renderImportProjectList('character');
                    await loadImportCharacterVariants(character.prefix);
                }
            }));
        });
    } else if (type === 'situation') {
        (state.situations || []).forEach((situation, index) => {
            const id = situation.id || situation.folderName || `situation-${index + 1}`;
            list.appendChild(makeImportPickerItem({
                type,
                label: getImportSituationLabel(situation, index),
                subLabel: String(id),
                active: String(id) === String(state.situationId),
                onClick: () => {
                    state.situationId = String(id);
                    window.IMPORT_PROJECT_PICKER_STATE = state;
                    renderImportProjectList('situation');
                    loadImportSituationVariants(String(id));
                }
            }));
        });
    }
    if (!list.children.length) setImportListMessage(list.id, '선택 가능한 항목이 없습니다.');
    if (window.lucide) window.lucide.createIcons();
}

window.filterImportProjectList = function(type, value = '') {
    const q = String(value || '').trim().toLowerCase();
    document.querySelectorAll(`#import-${type}-list [data-picker-type="${type}"]`).forEach(item => {
        item.classList.toggle('hidden', q && !item.dataset.searchText.includes(q));
    });
};

window.selectImportProjectVariant = function(type, value = '') {
    const state = window.IMPORT_PROJECT_PICKER_STATE || {};
    if (type === 'character') state.characterVariantId = value || '';
    else if (type === 'situation') state.situationVariantId = value || '';
    else if (type === 'background') state.backgroundPromptId = value || '';
    window.IMPORT_PROJECT_PICKER_STATE = state;
    updateImportProjectSummary();
};

function updateImportProjectSummary() {
    const state = window.IMPORT_PROJECT_PICKER_STATE || {};
    setImportVariantSelect('background', state.backgrounds || [], state.backgroundPromptId || '');
    setImportVariantSelect('character', state.characterVariants || [], state.characterVariantId || '');
    setImportVariantSelect('situation', state.situationVariants || [], state.situationVariantId || '');
}

window.showImportMode = async function(mode = 'hub') {
    const hub = document.getElementById('import-hub');
    const options = document.getElementById('import-options-panel');
    const r2Panel = document.getElementById('import-modal-content');
    const projectPanel = document.getElementById('import-project-panel');
    const externalPanel = document.getElementById('import-external-panel');
    const backBtn = document.getElementById('import-back-btn');
    const title = document.getElementById('import-modal-title');
    const subtitle = document.getElementById('import-modal-subtitle');
    const pathPanel = document.getElementById('import-path-panel');

    [hub, options, r2Panel, projectPanel, externalPanel].forEach(el => {
        if (!el) return;
        el.classList.add('hidden');
        if (el === options) el.classList.remove('flex');
    });
    if (backBtn) backBtn.classList.toggle('hidden', mode === 'hub');

    if (mode !== 'hub' && options) {
        options.classList.remove('hidden');
        options.classList.add('flex');
    }
    if (pathPanel) pathPanel.classList.toggle('hidden', mode !== 'r2');

    if (mode === 'r2') {
        if (title) title.textContent = '저장 이미지에서 불러오기';
        if (subtitle) subtitle.textContent = '프로젝트 R2 저장소 이미지의 메타데이터를 읽습니다.';
        if (r2Panel) r2Panel.classList.remove('hidden');
        const projSelect = document.getElementById('craft-project-select');
        const charSelect = document.getElementById('craft-char-select');
        const proj = projSelect ? projSelect.value : '';
        const char = charSelect ? charSelect.value : '';
        if (!proj) return alert('먼저 상단 바에서 프로젝트를 선택해주세요.');
        window.IMPORT_BASE_PREFIX = proj.endsWith('/') ? proj : proj + '/';
        let targetPath = char ? char : proj;
        if (targetPath && !targetPath.endsWith('/')) targetPath += '/';
        await window.loadImportPath(targetPath);
    } else if (mode === 'project') {
        if (title) title.textContent = '프로젝트 데이터 조합';
        if (subtitle) subtitle.textContent = 'D1에 저장된 그림체, 캐릭터, 상황 데이터를 조합합니다.';
        if (projectPanel) projectPanel.classList.remove('hidden');
        await initImportProjectPicker();
    } else if (mode === 'external') {
        if (title) title.textContent = '외부 이미지에서 추출';
        if (subtitle) subtitle.textContent = '로컬 이미지 파일에 포함된 메타데이터를 읽습니다.';
        if (externalPanel) externalPanel.classList.remove('hidden');
    } else {
        if (title) title.textContent = 'Import';
        if (subtitle) subtitle.textContent = '불러올 데이터의 출처를 선택하세요.';
        if (hub) hub.classList.remove('hidden');
    }

    if (window.lucide) window.lucide.createIcons();
};

window.openImportModal = async function() {
    const modal = document.getElementById('import-modal'); if (!modal) return;
    modal.classList.remove('hidden'); history.pushState({ modal: 'import' }, '', '#import');
    await window.showImportMode('hub');
};

window.importProjectPromptData = async function() {
    try {
        const pickerState = window.IMPORT_PROJECT_PICKER_STATE || {};
        if (!pickerState.projectPath) throw new Error('프로젝트를 선택하세요.');
        const project = window.getProjectByPrefix ? window.getProjectByPrefix(pickerState.projectPath) : null;
        if (!project) throw new Error('선택한 프로젝트를 찾을 수 없습니다.');
        await Promise.all([
            window.loadProjectCharacters(project, true).catch(() => []),
            window.loadProjectSituations(project, true).catch(() => [])
        ]);

        const options = getImportApplyOptions();
        const characterPrefix = pickerState.characterPath || '';
        const situationId = pickerState.situationId || '';
        const character = characterPrefix && window.getCharacterById ? window.getCharacterById(project, characterPrefix) : null;
        const situation = situationId && window.getSituationById ? window.getSituationById(project, situationId) : null;
        const [projectStyle, characterMeta, backgroundData] = await Promise.all([
            window.loadProjectStylePrompt ? window.loadProjectStylePrompt(project).catch(() => '') : Promise.resolve(''),
            character && window.loadCharacterMeta ? window.loadCharacterMeta(character).catch(() => ({})) : Promise.resolve({}),
            window.loadProjectBackgroundPrompts ? window.loadProjectBackgroundPrompts(project).catch(() => ({ backgrounds: [] })) : Promise.resolve({ backgrounds: [] })
        ]);

        const characterVariants = window.normalizeCharacterPromptVariants ? window.normalizeCharacterPromptVariants(characterMeta) : [];
        const characterVariant = characterVariants.find(variant => variant.id === pickerState.characterVariantId)
            || characterVariants.find(variant => variant.id === characterMeta.activePromptVariantId)
            || characterVariants[0]
            || {};
        const situationVariants = situation && window.normalizeSituationPromptVariants ? window.normalizeSituationPromptVariants(situation) : [];
        const situationVariant = situationVariants.find(variant => variant.id === pickerState.situationVariantId)
            || situationVariants.find(variant => variant.id === situation?.activePromptVariantId)
            || situationVariants[0]
            || {};
        const background = (backgroundData.backgrounds || []).find(item => item.id === pickerState.backgroundPromptId)
            || (backgroundData.backgrounds || []).find(item => item.id === backgroundData.activeBackgroundId)
            || (backgroundData.backgrounds || [])[0]
            || null;

        const characterParts = characterVariant.parts || characterMeta.parts || {};
        const situationPrompt = situationVariant.prompt || (window.getSituationPrompt ? window.getSituationPrompt(situation) : {});
        const situationGeneration = situationVariant.generation || (window.getSituationGeneration ? window.getSituationGeneration(situation) : {});
        const isNsfwSituation = window.getSituationRating
            ? window.getSituationRating(situation) === 'nsfw'
            : false;
        const promptValues = {};

        if (options.optStyle) promptValues['prompt-style'] = projectStyle || '';
        if (options.optComp) promptValues['prompt-composition'] = situationPrompt.composition || '';
        if (options.optChar) promptValues['prompt-character'] = characterParts.character || characterMeta.prompt || '';
        if (options.optCloth) {
            promptValues['prompt-clothing'] = isNsfwSituation
                ? (situationPrompt.clothing || '')
                : (characterParts.clothing || '');
        }
        if (options.optExp) promptValues['prompt-expression'] = situationPrompt.expression || '';
        if (options.optAct) promptValues['prompt-action'] = situationPrompt.action || '';
        if (options.optBg) promptValues['prompt-background'] = background?.prompt || situationPrompt.background || '';

        const negativeParts = [characterParts.negative, situationPrompt.negative].filter(Boolean);
        const negative = window.combinePromptParts
            ? window.combinePromptParts(characterParts.negative, situationPrompt.negative)
            : negativeParts.join(', ');

        if (window.applyCraftPromptValues) {
            window.applyCraftPromptValues(promptValues, negative, {
                clearMissing: false,
                applyNegative: options.optNegative
            });
        }
        if (options.optChar && window.setCraftV4PromptRows) {
            window.setCraftV4PromptRows(situationGeneration.v4PromptCharacters || situationGeneration.v4_prompt || []);
        }

        if (window.updateModelSpecificUI) window.updateModelSpecificUI();
        if (window.saveCraftSettings) window.saveCraftSettings();
        if (window.switchTab) window.switchTab('craft');
        cacheImportProjectContext({
            projectPath: project.prefix,
            characterPath: characterPrefix,
            situationId,
            characterVariantId: characterVariant.id || '',
            situationVariantId: situationVariant.id || '',
            backgroundPromptId: background?.id || ''
        });
        window.closeImportModal(null, true);
        alert('프로젝트 데이터를 조합해서 불러왔습니다.');
    } catch (err) {
        alert('프로젝트 조합 불러오기 실패: ' + (err.message || err));
    }
};

window.handleExternalImportFile = async function(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return alert('이미지 파일만 선택할 수 있습니다.');

    const previewWrap = document.getElementById('import-external-preview');
    const previewImg = document.getElementById('import-external-preview-img');
    const fileName = document.getElementById('import-external-file-name');
    const status = document.getElementById('import-external-status');
    const applyBtn = document.getElementById('import-external-apply-btn');

    if (window.EXTERNAL_IMPORT_PREVIEW_URL) URL.revokeObjectURL(window.EXTERNAL_IMPORT_PREVIEW_URL);
    window.EXTERNAL_IMPORT_PREVIEW_URL = URL.createObjectURL(file);
    window.EXTERNAL_IMPORT_METADATA = null;

    if (previewImg) previewImg.src = window.EXTERNAL_IMPORT_PREVIEW_URL;
    if (fileName) fileName.textContent = file.name || 'selected image';
    if (status) status.textContent = '메타데이터를 추출하는 중...';
    if (applyBtn) applyBtn.classList.add('hidden');
    if (previewWrap) previewWrap.classList.remove('hidden');

    try {
        const meta = window.extractMetadata ? await window.extractMetadata(file) : null;
        if (!meta) {
            if (status) status.textContent = '읽을 수 있는 메타데이터가 없습니다.';
            return;
        }
        window.EXTERNAL_IMPORT_METADATA = meta;
        if (status) status.textContent = meta['Raw Data'] ? '원본 텍스트 메타데이터를 찾았습니다.' : '메타데이터를 찾았습니다. 적용할 수 있습니다.';
        if (applyBtn) applyBtn.classList.remove('hidden');
    } catch (err) {
        if (status) status.textContent = '메타데이터 추출 실패: ' + (err.message || err);
    }

    if (window.lucide) window.lucide.createIcons();
};

window.applyExternalImportMetadata = function() {
    try {
        if (applyImportedMetadataObject(window.EXTERNAL_IMPORT_METADATA)) {
            window.closeImportModal(null, true);
            alert('외부 이미지 메타데이터를 불러왔습니다.');
        }
    } catch (err) {
        alert('외부 이미지 불러오기 실패: ' + (err.message || err));
    }
};

/**
 * 역할: 메타데이터 가져오기 모달을 닫고 필요하면 브라우저 history를 되돌린다.
 * 매개변수: e - 닫기 이벤트 객체, skipHistory - history.back 생략 여부.
 * 주요 변수: modal - 닫을 가져오기 모달.
 * 반환값: 명시 반환 없음.
 */
window.closeImportModal = function(e, skipHistory = false) {
    if (e && e.target !== e.currentTarget && e.target.id !== 'close-import-btn') return;
    const modal = document.getElementById('import-modal');
    if (modal && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
        if (window.EXTERNAL_IMPORT_PREVIEW_URL) URL.revokeObjectURL(window.EXTERNAL_IMPORT_PREVIEW_URL);
        window.EXTERNAL_IMPORT_PREVIEW_URL = null;
        window.EXTERNAL_IMPORT_METADATA = null;
        const externalInput = document.getElementById('import-external-file-input');
        const externalPreview = document.getElementById('import-external-preview');
        if (externalInput) externalInput.value = '';
        if (externalPreview) externalPreview.classList.add('hidden');
        if (!skipHistory) history.back();
    }
};

/**
 * 역할: 메타데이터 가져오기 모달에서 지정 prefix의 폴더/이미지 목록을 렌더링한다.
 * 매개변수: prefix - 탐색할 폴더 경로.
 * 주요 변수: IMPORT_CURRENT_PREFIX, pathDisplay, grid, listRes, aliasRes, files, folders - 탐색 상태와 렌더링 데이터.
 * 반환값: 명시 반환 없음.
 */
window.loadImportPath = async function(prefix) {
    window.IMPORT_CURRENT_PREFIX = prefix;
    const pathDisplay = document.getElementById('import-modal-path'); const grid = document.getElementById('import-grid');
    const loader = document.getElementById('import-loading'); const emptyState = document.getElementById('import-empty');
    
    pathDisplay.textContent = '/' + prefix; grid.innerHTML = ''; grid.classList.add('hidden'); emptyState.classList.add('hidden');
    loader.classList.remove('hidden'); loader.classList.add('flex');

    try {
        const [listRes, aliasRes] = await Promise.all([
            fetch(`/api/list?prefix=${encodeURIComponent(prefix)}`),
            fetch(`/api/aliases?prefix=${encodeURIComponent(prefix)}`)
        ]);
        
        if (!listRes.ok) throw new Error('목록을 불러오지 못했습니다.');
        
        if (aliasRes.ok) {
            const aliasData = await aliasRes.json();
            window.GLOBAL_ALIASES = aliasData.global || {};
            window.PROJECT_ALIASES = aliasData.project || {};
        }

        const data = await listRes.json();
        let files = data.files.filter(f => !f.key.endsWith('.keep') && !/\.(txt|log)$/i.test(f.key) && !f.key.endsWith('_meta.json'));
        let folders = data.folders;
        
        files.sort((a, b) => { const nameA = a.key.split('/').pop(); const nameB = b.key.split('/').pop(); return nameB.localeCompare(nameA); });

        grid.innerHTML = '';
        if (prefix !== window.IMPORT_BASE_PREFIX && prefix.length > window.IMPORT_BASE_PREFIX.length && prefix.startsWith(window.IMPORT_BASE_PREFIX)) {
            const parts = prefix.split('/').filter(Boolean); parts.pop(); 
            const parentPrefix = parts.length > 0 ? parts.join('/') + '/' : window.IMPORT_BASE_PREFIX;
            const div = document.createElement('div');
            div.className = 'relative w-full aspect-[3/4] bg-gray-200 dark:bg-gray-700 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-600 transition group border border-gray-300 dark:border-gray-600 shadow-sm';
            div.onclick = () => window.loadImportPath(parentPrefix);
            div.innerHTML = `<i data-lucide="corner-left-up" class="w-8 h-8 text-gray-500 mb-2"></i><span class="text-xs font-bold text-gray-600 dark:text-gray-300">상위 폴더</span>`;
            grid.appendChild(div);
        }

        folders.forEach(folderPrefix => {
            const folderName = folderPrefix.split('/').filter(Boolean).pop();
            const alias = window.getAliasOnly(folderPrefix, true); 
            
            const div = document.createElement('div');
            div.className = 'relative w-full aspect-[3/4] bg-yellow-50 dark:bg-yellow-900/20 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-yellow-100 dark:hover:bg-yellow-900/40 transition border border-yellow-200 dark:border-yellow-700/50 shadow-sm p-2';
            div.onclick = () => window.loadImportPath(folderPrefix);
            div.innerHTML = `
                <i data-lucide="folder" class="w-10 h-10 text-yellow-500 fill-current mb-2"></i>
                <div class="flex flex-col items-center w-full overflow-hidden px-1">
                    <span class="text-xs font-bold text-yellow-800 dark:text-yellow-200 truncate w-full text-center">${alias || folderName}</span>
                    ${alias ? `<span class="text-[9px] text-yellow-600/70 dark:text-yellow-400/70 truncate w-full text-center">(${folderName})</span>` : ''}
                </div>
            `;
            grid.appendChild(div);
        });

        files.forEach(file => {
            const fileName = file.key.split('/').pop();
            if (!/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(fileName)) return;
            
            const alias = window.getAliasOnly(file.key, false); 
            const fileUrl = window.location.origin + '/' + file.key + '?t=' + (file.uploaded ? new Date(file.uploaded).getTime() : Date.now());
            
            const div = document.createElement('div');
            div.className = 'relative w-full aspect-[3/4] bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden shadow-sm border border-gray-200 dark:border-gray-700 cursor-pointer hover:border-indigo-500 hover:ring-2 hover:ring-indigo-500/50 transition-all group';
            div.onclick = async () => { await window.importMetadata(file.key, getImportApplyOptions()); };
            div.innerHTML = `
                <img src="${fileUrl}" class="absolute inset-0 object-cover w-full h-full transition-opacity duration-200 opacity-80 group-hover:opacity-100" loading="lazy">
                <div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-2 flex flex-col items-center">
                    <span class="text-[10px] text-white truncate w-full text-center font-medium">${alias || fileName}</span>
                    ${alias ? `<span class="text-[8px] text-gray-300 truncate w-full text-center">(${fileName})</span>` : ''}
                </div>
            `;
            grid.appendChild(div);
        });
        
        if (grid.children.length === 0) { emptyState.classList.remove('hidden'); emptyState.classList.add('flex'); } else { grid.classList.remove('hidden'); }
        if (window.lucide) window.lucide.createIcons();
    } catch (err) { alert(err.message); emptyState.classList.remove('hidden'); emptyState.classList.add('flex'); } 
    finally { loader.classList.add('hidden'); loader.classList.remove('flex'); }
};
