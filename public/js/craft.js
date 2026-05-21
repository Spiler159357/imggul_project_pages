// 5. craft.js: 이미지 생성 큐, 설정 로직
export async function initGenerationQueue() {
    try {
        const savedQueue = localStorage.getItem('imggul_gen_queue');
        if (savedQueue) {
            window.GENERATION_QUEUE = JSON.parse(savedQueue);
            if (window.GENERATION_QUEUE.length > 0) {
                alert(`[안내] 이전에 브라우저 종료로 중단되었던 생성 작업(${window.GENERATION_QUEUE.length}개)을 안전하게 이어받아 백그라운드에서 재개합니다.`);
                window.IS_GENERATING = true; window.CANCEL_GENERATION = false;
                window.updateQueueUI(true); window.processNextQueueItem();
            }
        }
    } catch (e) { localStorage.removeItem('imggul_gen_queue'); }
}

export function saveQueueToStorage() { localStorage.setItem('imggul_gen_queue', JSON.stringify(window.GENERATION_QUEUE)); }

export function cancelNaiGeneration() {
    if (window.IS_GENERATING) {
        window.CANCEL_GENERATION = true; window.GENERATION_QUEUE = []; window.saveQueueToStorage();
        const floatText = document.getElementById('craft-floating-text'); const sideText = document.getElementById('craft-progress-text');
        if(floatText) floatText.innerText = '취소 중... (작업 중단 완료)'; if(sideText) sideText.innerText = '취소 대기 중...';
    }
}

export function updateQueueUI(show) {
    const genBtn = document.getElementById('nai-generate-btn'); const cancelBtn = document.getElementById('nai-cancel-btn');
    const sideContainer = document.getElementById('craft-progress-container'); const floatOverlay = document.getElementById('craft-progress-overlay');
    if (show) {
        if (genBtn) genBtn.classList.add('hidden'); if (cancelBtn) cancelBtn.classList.remove('hidden');
        if (sideContainer) { sideContainer.classList.remove('hidden'); sideContainer.classList.add('flex'); }
        if (floatOverlay) { floatOverlay.classList.remove('hidden'); floatOverlay.classList.add('flex'); }
    } else {
        if (genBtn) genBtn.classList.remove('hidden'); if (cancelBtn) cancelBtn.classList.add('hidden');
        if (sideContainer) { sideContainer.classList.add('hidden'); sideContainer.classList.remove('flex'); }
        if (floatOverlay) { floatOverlay.classList.remove('flex'); floatOverlay.classList.add('hidden'); }
    }
    lucide.createIcons();
}

export function calculateAnlas() {
    const resRadio = document.querySelector('input[name="nai-res"]:checked');
    const stepsInput = document.getElementById('nai-steps');
    const anlasDisplay = document.getElementById('nai-anlas-cost');
    if (!resRadio || !stepsInput || !anlasDisplay) return;

    const [width, height] = resRadio.value.split('x').map(Number);
    const steps = parseInt(stepsInput.value) || 28;
    const pixels = width * height;
    const model = document.getElementById('nai-model')?.value || '';

    let baseCost = 0;
    if (pixels <= 1048576 && steps <= 28) baseCost = 0;
    else baseCost = Math.max(1, Math.ceil((pixels * steps) / 65536 * 0.15));

    let extraCost = 0;
    if (model.includes('nai-diffusion-4-5') && window.PRECISE_IMAGE_FILE) extraCost += 5; 

    const totalCost = baseCost + extraCost;
    if (totalCost === 0) anlasDisplay.innerHTML = `<span class="text-green-500 font-bold">0 Anlas</span> (Opus 무료)`;
    else anlasDisplay.innerHTML = `<span class="text-orange-500 font-bold">${totalCost} Anlas</span> 소모 예상`;
}

export function updateModelSpecificUI() {
    const model = document.getElementById('nai-model')?.value || '';
    const v3 = document.getElementById('setting-v3'); const v4 = document.getElementById('setting-v4'); const v45 = document.getElementById('setting-v45');
    if(v3) { v3.classList.add('hidden'); v3.classList.remove('flex'); }
    if(v4) { v4.classList.add('hidden'); v4.classList.remove('flex'); }
    if(v45) { v45.classList.add('hidden'); v45.classList.remove('flex'); }

    if (model.includes('nai-diffusion-3')) { if(v3) { v3.classList.remove('hidden'); v3.classList.add('flex'); } } 
    else if (model.includes('nai-diffusion-4-5')) {
        if(v3) { v3.classList.remove('hidden'); v3.classList.add('flex'); }
        if(v4) { v4.classList.remove('hidden'); v4.classList.add('flex'); }
        if(v45) { v45.classList.remove('hidden'); v45.classList.add('flex'); }
    } 
    else if (model.includes('nai-diffusion-4')) {
        if(v3) { v3.classList.remove('hidden'); v3.classList.add('flex'); }
        if(v4) { v4.classList.remove('hidden'); v4.classList.add('flex'); }
    }
    window.calculateAnlas();
}

export function clearPrompts() {
    window.PROMPT_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.style.height = 'auto'; }
    });
    const rawEl = document.getElementById('prompt-raw');
    if (rawEl) { rawEl.value = ''; rawEl.style.height = 'auto'; }
    window.saveCraftSettings();
}

export function togglePromptMode() {
    const isSimple = document.getElementById('prompt-toggle-simple')?.checked;
    const rawEl = document.getElementById('prompt-raw');
    const detailedEl = document.getElementById('prompt-detailed-container');
    if (isSimple) {
        if (rawEl) { rawEl.classList.remove('hidden'); rawEl.classList.add('block'); }
        if (detailedEl) { detailedEl.classList.add('hidden'); detailedEl.classList.remove('block'); }
    } else {
        if (rawEl) { rawEl.classList.add('hidden'); rawEl.classList.remove('block'); }
        if (detailedEl) { detailedEl.classList.remove('hidden'); detailedEl.classList.add('block'); }
    }
    window.saveCraftSettings();
}

export function loadCraftSettings() {
    try {
        const saved = localStorage.getItem('naiCraftSettings');
        if (saved) {
            const settings = JSON.parse(saved);
            if (settings.simpleMode !== undefined) {
                const toggle = document.getElementById('prompt-toggle-simple');
                if (toggle) { toggle.checked = settings.simpleMode; window.togglePromptMode(); }
            }
            if (settings.prompts) {
                window.PROMPT_IDS.forEach(id => { if (document.getElementById(id)) document.getElementById(id).value = settings.prompts[id] || ''; });
                if (settings.prompts['prompt-raw'] && document.getElementById('prompt-raw')) document.getElementById('prompt-raw').value = settings.prompts['prompt-raw'];
            }
            if(document.getElementById('nai-negative')) document.getElementById('nai-negative').value = settings.negative || '';
            if(settings.res) { const radio = document.querySelector(`input[name="nai-res"][value="${settings.res}"]`); if(radio) radio.checked = true; }
            if(settings.model && document.getElementById('nai-model')) document.getElementById('nai-model').value = settings.model;
            if(settings.steps && document.getElementById('nai-steps')) document.getElementById('nai-steps').value = settings.steps;
            if(settings.scale && document.getElementById('nai-scale')) document.getElementById('nai-scale').value = settings.scale;
            if(settings.sampler && document.getElementById('nai-sampler')) document.getElementById('nai-sampler').value = settings.sampler;
            if(settings.sm !== undefined && document.getElementById('nai-sm')) document.getElementById('nai-sm').checked = settings.sm;
            if(settings.sm_dyn !== undefined && document.getElementById('nai-sm-dyn')) document.getElementById('nai-sm-dyn').checked = settings.sm_dyn;
            if(settings.seed !== undefined && document.getElementById('nai-seed')) document.getElementById('nai-seed').value = settings.seed || '';
            window.updateModelSpecificUI();
        }
    } catch(e) {}
}

export function saveCraftSettings() {
    let promptsObj = {};
    window.PROMPT_IDS.forEach(id => { promptsObj[id] = document.getElementById(id)?.value || ''; });
    promptsObj['prompt-raw'] = document.getElementById('prompt-raw')?.value || '';
    const settings = {
        simpleMode: document.getElementById('prompt-toggle-simple')?.checked || false,
        prompts: promptsObj,
        negative: document.getElementById('nai-negative')?.value || '',
        res: document.querySelector('input[name="nai-res"]:checked')?.value || '832x1216',
        model: document.getElementById('nai-model')?.value || 'nai-diffusion-4-5-full',
        steps: document.getElementById('nai-steps')?.value || '28',
        scale: document.getElementById('nai-scale')?.value || '5.0',
        sampler: document.getElementById('nai-sampler')?.value || 'k_euler_ancestral',
        sm: document.getElementById('nai-sm')?.checked || false,
        sm_dyn: document.getElementById('nai-sm-dyn')?.checked || false,
        seed: document.getElementById('nai-seed')?.value || ''
    };
    localStorage.setItem('naiCraftSettings', JSON.stringify(settings));
}

export async function updateCraftFolderList() {
    const projSelect = document.getElementById('craft-project-select');
    if (!projSelect) return;
    const prevProj = projSelect.value; projSelect.innerHTML = '<option value="">스캔 중...</option>';
    try {
        const rootRes = await fetch(`/api/list?prefix=`); const rootData = await rootRes.json();
        let optionsHtml = `<option value="">프로젝트 선택</option>`;
        const filteredFolders = rootData.folders.filter(f => !f.startsWith(window.TEMP_FOLDER) && !f.startsWith('logs/'));
        for (let proj of filteredFolders) {
            const parts = proj.split('/').filter(Boolean); const folderName = parts[parts.length - 1];
            const alias = window.getAliasOnly(proj, true); const displayText = alias ? `${alias} (${folderName})` : folderName;
            optionsHtml += `<option value="${proj}">${displayText}</option>`;
        }
        projSelect.innerHTML = optionsHtml;
        if (prevProj && projSelect.querySelector(`option[value="${prevProj}"]`)) { projSelect.value = prevProj; await window.onCraftProjectChange(); }
    } catch (e) { projSelect.innerHTML = '<option value="">목록 로드 실패</option>'; }
}

export async function onCraftProjectChange() {
    const projSelect = document.getElementById('craft-project-select'); const charSelect = document.getElementById('craft-char-select');
    if (!projSelect || !charSelect) return;
    const proj = projSelect.value; charSelect.innerHTML = '<option value="">캐릭터 선택</option>';
    if (!proj) { charSelect.disabled = true; return; }
    charSelect.disabled = false; charSelect.innerHTML = '<option value="">스캔 중...</option>';
    try {
        const [listRes, aliasRes] = await Promise.all([ fetch(`/api/list?prefix=${encodeURIComponent(proj)}`), fetch(`/api/aliases?prefix=${encodeURIComponent(proj)}`) ]);
        if (aliasRes.ok) {
            const aliasData = await aliasRes.json();
            window.GLOBAL_ALIASES = Object.assign(window.GLOBAL_ALIASES || {}, aliasData.global || {});
            window.PROJECT_ALIASES = Object.assign(window.PROJECT_ALIASES || {}, aliasData.project || {});
        }
        const data = await listRes.json();
        let optionsHtml = `<option value="">(선택하지 않음 - 루트 저장)</option>`;
        for (let charF of data.folders) {
            const parts = charF.split('/').filter(Boolean); const folderName = parts[parts.length - 1];
            const alias = window.getAliasOnly(charF, true); const displayText = alias ? `${alias} (${folderName})` : folderName;
            optionsHtml += `<option value="${charF}">${displayText}</option>`;
        }
        charSelect.innerHTML = optionsHtml;
    } catch (e) { charSelect.innerHTML = '<option value="">로드 실패</option>'; }
}

export function addExtraCharacter() {
    if (window.EXTRA_CHAR_COUNT >= 6) return alert('최대 6명까지만 추가할 수 있습니다.');
    window.EXTRA_CHAR_COUNT++;
    const id = Date.now() + Math.floor(Math.random() * 10000);
    const container = document.getElementById('extra-chars-container');
    const div = document.createElement('div'); div.id = `char-box-${id}`;
    div.className = 'bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-700 shadow-sm relative';
    div.innerHTML = `<div class="flex justify-between items-center mb-2"><span class="text-[10px] font-bold text-gray-700 dark:text-gray-300">추가 캐릭터</span><button onclick="window.removeExtraCharacter(${id})" class="text-[10px] text-red-500 hover:text-red-700"><i data-lucide="trash-2" class="w-3 h-3"></i></button></div><div class="space-y-1.5"><input type="text" id="char-subject-${id}" class="w-full p-1.5 text-[10px] border rounded bg-gray-50 dark:bg-gray-700 dark:text-white dark:border-gray-600" placeholder="캐릭터 (예: 1girl, blonde hair...)"><input type="text" id="char-clothing-${id}" class="w-full p-1.5 text-[10px] border rounded bg-gray-50 dark:bg-gray-700 dark:text-white dark:border-gray-600" placeholder="의상 (예: school uniform...)"><input type="text" id="char-expression-${id}" class="w-full p-1.5 text-[10px] border rounded bg-gray-50 dark:bg-gray-700 dark:text-white dark:border-gray-600" placeholder="표정 (예: smiling, crying...)"><input type="text" id="char-action-${id}" class="w-full p-1.5 text-[10px] border rounded bg-gray-50 dark:bg-gray-700 dark:text-white dark:border-gray-600" placeholder="행위 (예: running, sitting...)"><div class="pt-1 mt-1 border-t border-gray-100 dark:border-gray-600"><input type="text" id="char-negative-${id}" class="w-full p-1.5 text-[10px] border border-red-200 dark:border-red-900 rounded bg-red-50/50 dark:bg-red-900/10 text-red-700 dark:text-red-300" placeholder="전용 부정 프롬프트 (옵션)"></div></div>`;
    container.appendChild(div); lucide.createIcons();
}

export function removeExtraCharacter(id) {
    const el = document.getElementById(`char-box-${id}`);
    if (el) { el.remove(); window.EXTRA_CHAR_COUNT--; }
}

export async function generateNaiImage() {
    if (window.IS_GENERATING) return;
    window.saveCraftSettings();

    const batchCount = parseInt(document.getElementById('nai-batch-count')?.value) || 1;
    let baseSeedInput = document.getElementById('nai-seed')?.value;
    const isRandomSeed = !baseSeedInput || isNaN(parseInt(baseSeedInput));

    let splitPrompts = {}; let promptParts = [];
    const isSimpleMode = document.getElementById('prompt-toggle-simple')?.checked;

    if (isSimpleMode) {
        const rawVal = (document.getElementById('prompt-raw')?.value || '').trim();
        if (rawVal) { splitPrompts['raw'] = rawVal; promptParts.push(rawVal); }
    } else {
        window.PROMPT_IDS.forEach((id) => {
            let val = (document.getElementById(id)?.value || '').trim();
            if (val) { const cleanId = id.replace('prompt-', ''); splitPrompts[cleanId] = val; promptParts.push(val); }
        });
    }

    let combinedPrompt = promptParts.join(', ');
    const qualityTags = "masterpiece, best quality, very aesthetic, no text";
    if (!combinedPrompt) combinedPrompt = qualityTags;
    else combinedPrompt += ", " + qualityTags;
    
    const negativeText = (document.getElementById('nai-negative')?.value || '').trim();
    const resRadio = document.querySelector('input[name="nai-res"]:checked');
    const [width, height] = resRadio ? resRadio.value.split('x').map(Number) : [832, 1216];
    const model = document.getElementById('nai-model')?.value || 'nai-diffusion-4-5-full';
    const steps = parseInt(document.getElementById('nai-steps')?.value) || 28;
    const scale = parseFloat(document.getElementById('nai-scale')?.value) || 5.0;
    const sampler = document.getElementById('nai-sampler')?.value || 'k_euler_ancestral';

    const vibeInfo = parseFloat(document.getElementById('vibe-info')?.value) || 1.0;
    const vibeStrength = parseFloat(document.getElementById('vibe-strength')?.value) || 0.6;
    const pStrength = parseFloat(document.getElementById('precise-strength')?.value) || 1.0;
    const pFidelityUI = parseFloat(document.getElementById('precise-fidelity')?.value) || 0.5;
    const pType = document.getElementById('precise-type')?.value || "character&style";
    const invertedFidelity = 1.0 - pFidelityUI; 

    window.updateQueueUI(true);

    let currentBaseSeed = isRandomSeed ? Math.floor(Math.random() * 4294967296) : parseInt(baseSeedInput);

    const processVibeImage = async (file) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                let w = img.width, h = img.height; const max = 1024;
                if (w > max || h > max) { if (w > h) { h = Math.round(h * (max / w)); w = max; } else { w = Math.round(w * (max / h)); h = max; } }
                w = Math.round(w / 64) * 64; h = Math.round(h / 64) * 64;
                if (w === 0) w = 64; if (h === 0) h = 64;
                const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h); resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
            };
            img.onerror = reject; img.src = URL.createObjectURL(file);
        });
    };

    const processDirectorImage = async (file) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                let targetW = 1472, targetH = 1472; const ratio = img.width / img.height;
                if (ratio > 1.2) { targetW = 1536; targetH = 1024; } else if (ratio < 0.8) { targetW = 1024; targetH = 1536; } 
                const canvas = document.createElement('canvas'); canvas.width = targetW; canvas.height = targetH;
                const ctx = canvas.getContext('2d');
                let drawW = targetW, drawH = targetH, offsetX = 0, offsetY = 0;
                if (ratio > (targetW / targetH)) { drawH = targetW / ratio; offsetY = (targetH - drawH) / 2; } else { drawW = targetH * ratio; offsetX = (targetW - drawW) / 2; }
                ctx.drawImage(img, offsetX, offsetY, drawW, drawH); resolve(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
            };
            img.onerror = reject; img.src = URL.createObjectURL(file);
        });
    };

    let preloadedVibeBase64 = null; let preloadedDirectorBase64 = null;
    try {
        if (model.includes('nai-diffusion-3') || model.includes('nai-diffusion-4')) { if (window.VIBE_IMAGE_FILE) preloadedVibeBase64 = await processVibeImage(window.VIBE_IMAGE_FILE); }
        if (model.includes('nai-diffusion-4-5') && window.PRECISE_IMAGE_FILE) { preloadedDirectorBase64 = await processDirectorImage(window.PRECISE_IMAGE_FILE); }
    } catch (err) { alert('이미지 전처리 실패: ' + err.message); window.updateQueueUI(false); return; }

    let charCaptionsArray = []; let negCharCaptionsArray = [];
    const extraCharBoxes = document.querySelectorAll('[id^="char-box-"]');
    extraCharBoxes.forEach(box => {
        const id = box.id.replace('char-box-', '');
        const c_sub = (document.getElementById(`char-subject-${id}`)?.value || '').trim();
        const c_clo = (document.getElementById(`char-clothing-${id}`)?.value || '').trim();
        const c_exp = (document.getElementById(`char-expression-${id}`)?.value || '').trim();
        const c_act = (document.getElementById(`char-action-${id}`)?.value || '').trim();
        const c_neg = (document.getElementById(`char-negative-${id}`)?.value || '').trim();
        const mergedCharPrompt = [c_sub, c_clo, c_exp, c_act].filter(v => v.length > 0).join(', ');
        if (mergedCharPrompt) charCaptionsArray.push({ char_caption: mergedCharPrompt, centers: [{"x": 0.5, "y": 0.5}] });
        if (c_neg) negCharCaptionsArray.push({ char_caption: c_neg, centers: [{"x": 0.5, "y": 0.5}] });
    });

    window.GENERATION_QUEUE = [];
    for (let i = 0; i < batchCount; i++) {
        let loopSeed = isRandomSeed ? Math.floor(Math.random() * 4294967296) : ((currentBaseSeed + i) % 4294967296);
        window.GENERATION_QUEUE.push({ id: Date.now() + i, index: i + 1, total: batchCount, prompt: combinedPrompt, splitPrompts: splitPrompts, negative: negativeText, width: width, height: height, model: model, steps: steps, sampler: sampler, scale: scale, seed: loopSeed, preloadedVibeBase64: preloadedVibeBase64, preloadedDirectorBase64: preloadedDirectorBase64, charCaptionsArray: charCaptionsArray, negCharCaptionsArray: negCharCaptionsArray, vibeInfo, vibeStrength, pStrength, invertedFidelity, pType });
    }
    window.saveQueueToStorage(); window.IS_GENERATING = true; window.CANCEL_GENERATION = false; window.processNextQueueItem();
}

export async function processNextQueueItem() {
    if (window.CANCEL_GENERATION || window.GENERATION_QUEUE.length === 0) {
        window.IS_GENERATING = false; window.CANCEL_GENERATION = false; window.GENERATION_QUEUE = [];
        window.saveQueueToStorage(); window.updateQueueUI(false); return;
    }

    const task = window.GENERATION_QUEUE[0]; const totalCount = task.total; const currentIdx = task.index;
    const batchStatus = document.getElementById('nai-batch-status'); if (batchStatus) batchStatus.innerText = `${currentIdx}/${totalCount}`;

    const sideBar = document.getElementById('craft-progress-bar'); const sideText = document.getElementById('craft-progress-text'); const sidePercent = document.getElementById('craft-progress-percent');
    const floatBar = document.getElementById('craft-floating-bar'); const floatText = document.getElementById('craft-floating-text'); const floatPercent = document.getElementById('craft-floating-percent');

    let progress = 0; let expectedMs = task.steps * 200; if(expectedMs < 4000) expectedMs = 4000;
    const updateInterval = 100; const increment = 100 / (expectedMs / updateInterval);
    
    const updateProgress = (txt, prog) => {
        const fullMsg = `[${currentIdx}/${totalCount}] ${txt}`;
        if (sideText) sideText.innerText = fullMsg; if (floatText) floatText.innerText = fullMsg;
        if (prog !== null) {
            const pct = `${Math.floor(prog)}%`;
            if (sideBar) sideBar.style.width = pct; if (sidePercent) sidePercent.innerText = pct;
            if (floatBar) floatBar.style.width = pct; if (floatPercent) floatPercent.innerText = pct;
        }
    };

    updateProgress('초기화 중...', 0);
    const progressTimer = setInterval(() => { progress += increment; if (progress > 95) progress = 95; updateProgress('추론 진행 중...', progress); }, updateInterval);

    try {
        const requestBody = {
            input: task.prompt, model: task.model, action: "generate",
            parameters: { params_version: 3, width: task.width, height: task.height, steps: task.steps, sampler: task.sampler, scale: task.scale, cfg_rescale: 0.0, seed: task.seed, noise_schedule: "native", legacy_v3_extend: false, skip_cfg_above_sigma: 58.0 }
        };

        if (task.model.includes('nai-diffusion-4')) {
            requestBody.parameters.v4_prompt = { caption: { base_caption: task.prompt, char_captions: task.charCaptionsArray || [] }, use_coords: ((task.charCaptionsArray || []).length > 0), use_order: true };
            requestBody.parameters.v4_negative_prompt = { caption: { base_caption: task.negative, char_captions: task.negCharCaptionsArray || [] } };
        }

        if (task.preloadedVibeBase64) {
            requestBody.parameters.reference_image_multiple = [task.preloadedVibeBase64];
            requestBody.parameters.reference_information_extracted_multiple = [task.vibeInfo];
            requestBody.parameters.reference_strength_multiple = [task.vibeStrength];
        }

        if (task.preloadedDirectorBase64) {
            requestBody.parameters.director_reference_images = [task.preloadedDirectorBase64];
            requestBody.parameters.director_reference_descriptions = [{ caption: { base_caption: task.pType, char_captions: [] } }];
            requestBody.parameters.director_reference_strength_values = [task.pStrength];
            requestBody.parameters.director_reference_secondary_strength_values = [task.invertedFidelity];
            requestBody.parameters.director_reference_information_extracted = [1.0];
            if (requestBody.parameters.v4_prompt) requestBody.parameters.v4_prompt.use_coords = true;
        }

        const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) });
        if (!res.ok) {
            let errStr = "서버 통신 오류 발생"; const rawText = await res.text();
            try { const errJson = JSON.parse(rawText); errStr = errJson.error || errJson.message || rawText; } catch(e) { errStr = rawText; }
            throw new Error(`[HTTP ${res.status}] ${errStr}`);
        }

        clearInterval(progressTimer); updateProgress('다운로드 완료! 파일 압축 해제 중...', 98);

        const blob = await res.blob();
        if (!window.JSZip) throw new Error("압축 해제 라이브러리를 찾을 수 없습니다.");
        const zip = await JSZip.loadAsync(blob);
        const filename = Object.keys(zip.files)[0];
        if (!filename) throw new Error("결과 압축 파일이 비어 있습니다.");
        const fileData = await zip.files[filename].async("blob");
        
        const d = new Date(); const pad = (n) => n.toString().padStart(2, '0');
        const dateString = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const newFileName = `nai_${dateString}_${Date.now().toString().slice(-4)}.png`;
        const generatedFile = new File([fileData], newFileName, { type: "image/png" });
        
        updateProgress('최적화 및 임시 저장소 업로드 중...', 99);
        let extractedMetadata = await window.extractMetadata(generatedFile);
        if (extractedMetadata && task.splitPrompts && Object.keys(task.splitPrompts).length > 0) { extractedMetadata["Split Prompts"] = task.splitPrompts; delete extractedMetadata["Prompt"]; }

        const tempKey = window.TEMP_FOLDER + newFileName;
        const uploadHeaders = { 'X-File-Name': encodeURIComponent(newFileName), 'Content-Type': 'image/png', 'X-Absolute-Path': encodeURIComponent(tempKey) };
        const buffer = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error("FileReader 에러")); r.readAsArrayBuffer(generatedFile); });
        const uploadRes = await fetch('/api/upload?_t=' + Date.now(), { method: 'PUT', headers: uploadHeaders, body: buffer, cache: 'no-store' });
        if (!uploadRes.ok) throw new Error("서버 임시 저장소 동기화에 실패했습니다.");

        if (extractedMetadata) await window.saveMetadataToDB(window.TEMP_FOLDER, newFileName, extractedMetadata);

        updateProgress('완료!', 100);
        window.TEMP_IMAGES.unshift({ key: tempKey, uploaded: new Date().toISOString() });
        
        if (window.TEMP_IMAGES.length > 100) {
            const toDelete = window.TEMP_IMAGES.pop();
            try {
                await fetch('/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', key: toDelete.key }) });
                await window.removeMetadataFromDB(window.TEMP_FOLDER, toDelete.key.split('/').pop());
            } catch(err) { if (window.logErrorToStorage) window.logErrorToStorage("로컬 기반 오래된 파일 삭제 에러", err); }
        }
        
        window.CRAFT_ACTIVE_INDEX = 0;
        window.renderTempGallery();
        window.processDelayedWebPConversion();

        window.GENERATION_QUEUE.shift();
        window.saveQueueToStorage();
        await new Promise(r => setTimeout(r, 500));
        window.processNextQueueItem(); 

    } catch (e) {
        clearInterval(progressTimer); console.error('배치 생성 중 에러:', e);
        updateProgress(`생성 실패: ${e.message}`, 0);
        if (window.logErrorToStorage) window.logErrorToStorage('이미지 생성 큐 처리 중 에러', e);
        window.GENERATION_QUEUE.shift(); window.saveQueueToStorage();
        await new Promise(r => setTimeout(r, 2000));
        window.processNextQueueItem();
    } finally { clearInterval(progressTimer); }
}
