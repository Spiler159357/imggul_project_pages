// 8. main.js: 애플리케이션 진입점 및 모듈 통합 관리
import './state.js';
import * as Api from './api.js';
import * as Ui from './ui.js';
import * as Explorer from './explorer.js';
import * as Craft from './craft.js';
import * as TempGallery from './temp_gallery.js';
import * as Modals from './modals.js';

// 모든 모듈의 Export 함수들을 window 객체에 바인딩하여 HTML 인라인 속성(onclick 등) 유지
Object.assign(window, Api, Ui, Explorer, Craft, TempGallery, Modals);

// 즉시 실행 (ES 모듈이므로 DOM은 이미 파싱된 상태에서 호출됨)
lucide.createIcons();
window.initDarkMode();
window.loadCraftSettings();
window.initGenerationQueue();

if (typeof window.ROOT_PATH === 'undefined') window.ROOT_PATH = '';
if (window.IS_ADMIN) {
    const textEditor = document.getElementById('modal-text-editor');
    if(textEditor) textEditor.removeAttribute('readonly');
} else {
    const textEditor = document.getElementById('modal-text-editor');
    if(textEditor) textEditor.setAttribute('readonly', 'true');
}

// [버그 수정] 사이트 진입 최초 시점에 기본 탭('explorer') 활성화 상태를 강제로 부여합니다
if (window.loadAliases) {
    window.loadAliases().then(() => {
        const initPath = window.INITIAL_PATH || '';
        history.replaceState({ tab: 'explorer', path: initPath }, '', '#' + initPath);
        window.loadPath(initPath, true);
        window.switchTab('explorer', true); // 최초 탭 상태 적용
    });
} else {
    const initPath = window.INITIAL_PATH || '';
    history.replaceState({ tab: 'explorer', path: initPath }, '', '#' + initPath);
    window.loadPath(initPath, true);
    window.switchTab('explorer', true); // 최초 탭 상태 적용
}

// ----------------------------------------------------
// 이벤트 리스너 등록
// ----------------------------------------------------

document.addEventListener('keydown', (e) => {
    const craftTab = document.getElementById('main-craft-content');
    if (!craftTab || craftTab.classList.contains('hidden')) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

    if (window.TEMP_IMAGES && window.TEMP_IMAGES.length > 0) {
        let currentIndex = window.CRAFT_ACTIVE_INDEX !== null ? window.CRAFT_ACTIVE_INDEX : 0;
        const grid = document.getElementById('craft-temp-grid');
        let cols = 1;
        
        if (grid && grid.children.length > 0) {
            let firstTop = grid.children[0].offsetTop;
            for (let i = 1; i < grid.children.length; i++) {
                if (grid.children[i].offsetTop > firstTop) { cols = i; break; }
            }
        }

        let newIndex = currentIndex; let handled = false;
        if (e.key === 'ArrowLeft') { newIndex = Math.max(0, currentIndex - 1); handled = true; } 
        else if (e.key === 'ArrowRight') { newIndex = Math.min(window.TEMP_IMAGES.length - 1, currentIndex + 1); handled = true; } 
        else if (e.key === 'ArrowUp') { newIndex = Math.max(0, currentIndex - cols); handled = true; } 
        else if (e.key === 'ArrowDown') { newIndex = Math.min(window.TEMP_IMAGES.length - 1, currentIndex + cols); handled = true; }

        if (handled) {
            e.preventDefault(); 
            if (newIndex !== currentIndex) {
                window.CRAFT_ACTIVE_INDEX = newIndex;
                window.renderTempGallery();
                if (grid && grid.children[window.CRAFT_ACTIVE_INDEX]) {
                    grid.children[window.CRAFT_ACTIVE_INDEX].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
        }
    }
});

document.querySelectorAll('.prompt-input, #nai-negative').forEach(textarea => {
    textarea.addEventListener('input', function() {
        this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px';
        window.saveCraftSettings();
    });
    textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.generateNaiImage(); }
    });
});

document.getElementById('prompt-toggle-simple')?.addEventListener('change', window.togglePromptMode);

['nai-model', 'nai-steps', 'nai-scale', 'nai-sampler', 'nai-seed'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', window.saveCraftSettings);
});

document.getElementById('nai-model')?.addEventListener('change', window.updateModelSpecificUI);

const vibeDropZone = document.getElementById('vibe-image-dropzone'); const vibeFileInput = document.getElementById('vibe-image-input');
if (vibeDropZone && vibeFileInput) {
    vibeDropZone.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') vibeFileInput.click(); });
    vibeDropZone.addEventListener('dragover', (e) => { e.preventDefault(); vibeDropZone.classList.add('border-indigo-500'); });
    vibeDropZone.addEventListener('dragleave', (e) => { e.preventDefault(); vibeDropZone.classList.remove('border-indigo-500'); });
    vibeDropZone.addEventListener('drop', (e) => { e.preventDefault(); vibeDropZone.classList.remove('border-indigo-500'); if (e.dataTransfer.files.length) window.handleVibeImageUpload(e.dataTransfer.files[0]); });
    vibeFileInput.addEventListener('change', (e) => { if (e.target.files.length) window.handleVibeImageUpload(e.target.files[0]); });
}

const preciseDropZone = document.getElementById('precise-image-dropzone'); const preciseFileInput = document.getElementById('precise-image-input');
if (preciseDropZone && preciseFileInput) {
    preciseDropZone.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') preciseFileInput.click(); });
    preciseDropZone.addEventListener('dragover', (e) => { e.preventDefault(); preciseDropZone.classList.add('border-indigo-500'); });
    preciseDropZone.addEventListener('dragleave', (e) => { e.preventDefault(); preciseDropZone.classList.remove('border-indigo-500'); });
    preciseDropZone.addEventListener('drop', (e) => { e.preventDefault(); preciseDropZone.classList.remove('border-indigo-500'); if (e.dataTransfer.files.length) window.handlePreciseImageUpload(e.dataTransfer.files[0]); });
    preciseFileInput.addEventListener('change', (e) => { if (e.target.files.length) window.handlePreciseImageUpload(e.target.files[0]); });
}

['vibe-strength', 'vibe-info', 'precise-strength', 'precise-fidelity'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', (e) => { document.getElementById(`${id}-val`).innerText = parseFloat(e.target.value).toFixed(1); });
});

['nai-sm', 'nai-sm-dyn'].forEach(id => { document.getElementById(id)?.addEventListener('change', window.saveCraftSettings); });
document.querySelectorAll('input[name="nai-res"]')?.forEach(radio => { radio.addEventListener('change', window.saveCraftSettings); });

document.getElementById('nai-steps')?.addEventListener('input', window.calculateAnlas);
document.querySelectorAll('input[name="nai-res"]')?.forEach(radio => { radio.addEventListener('change', window.calculateAnlas); });

const dropZone = document.getElementById('gallery-drop-zone'); const fileInput = document.getElementById('gallery-file-input');
const removeBtn = document.getElementById('gallery-remove-btn'); const submitBtn = document.getElementById('gallery-upload-submit-btn');
const fileNameInput = document.getElementById('gallery-upload-filename');

if (dropZone) {
    dropZone.addEventListener('click', (e) => { if (e.target !== removeBtn) fileInput.click(); });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-active'); });
    dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('drag-active'); });
    document.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag-active'); if (e.dataTransfer.files.length) window.showGalleryPreview(e.dataTransfer.files[0]); });
}

if (removeBtn) removeBtn.addEventListener('click', (e) => { e.stopPropagation(); window.resetGalleryUpload(); });
if (fileInput) fileInput.addEventListener('change', (e) => { if (e.target.files.length) window.showGalleryPreview(e.target.files[0]); });
if (fileNameInput) fileNameInput.addEventListener('input', window.updateGalleryPreviewText);

if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
        if (!window.galleryFileToUpload) return;
        submitBtn.disabled = true;
        let extractedMetadata = null;

        try {
            let finalFile = window.galleryFileToUpload;
            if (finalFile.type.startsWith('image/')) {
                submitBtn.textContent = '데이터 추출 중...';
                extractedMetadata = await window.extractMetadata(finalFile);
                submitBtn.textContent = 'WebP 변환 중...';
                finalFile = await window.convertToWebP(finalFile);
            }

            submitBtn.textContent = '업로드 중...';
            let baseName = finalFile.name; const ext = baseName.split('.').pop();
            const customName = fileNameInput ? fileNameInput.value.trim() : '';
            let fileName = customName ? `${customName}.${ext}` : baseName;
            const finalPath = window.currentPrefix + fileName;

            const headers = { 'X-File-Name': encodeURIComponent(fileName), 'Content-Type': finalFile.type || 'application/octet-stream', 'X-Absolute-Path': encodeURIComponent(finalPath) };
            const buffer = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error("FileReader ArrayBuffer 에러")); r.readAsArrayBuffer(finalFile); });
            const res = await fetch('/api/upload?_t=' + Date.now(), { method: 'PUT', headers: headers, body: buffer, cache: 'no-store' });
            if (!res.ok) { const errTxt = await res.text(); throw new Error(`서버 응답 오류 (상태코드: ${res.status}, 내용: ${errTxt})`); }
            if (extractedMetadata) await window.saveMetadataToDB(window.currentPrefix, fileName, extractedMetadata);
            
            alert('현재 폴더에 업로드 되었습니다.');
            window.closeGalleryUploadModal(); window.refreshGallery();
        } catch (err) { alert('업로드 실패: ' + err.message); } 
        finally { if(submitBtn) { submitBtn.textContent = '업로드 하기'; submitBtn.disabled = false; } }
    });
}

const memoSubmitBtn = document.getElementById('memo-create-submit-btn');
if (memoSubmitBtn) {
    memoSubmitBtn.addEventListener('click', async () => {
        const content = document.getElementById('memo-create-content').value; const fname = document.getElementById('memo-create-filename').value.trim();
        if (!content) return alert('내용을 입력해주세요.');
        memoSubmitBtn.disabled = true; memoSubmitBtn.textContent = '저장 중...';

        try {
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const fileName = (fname || `memo_${Date.now()}`) + '.txt';
            const finalPath = window.currentPrefix + fileName;

            const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'X-File-Name': encodeURIComponent(fileName), 'X-Absolute-Path': encodeURIComponent(finalPath) };
            const buffer = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("FileReader ArrayBuffer 에러")); reader.readAsArrayBuffer(blob); });
            const res = await fetch('/api/upload?_t=' + Date.now(), { method: 'PUT', headers: headers, body: buffer, cache: 'no-store' });
            if (!res.ok) throw new Error('저장 실패');
            
            alert('메모가 저장되었습니다.'); window.closeMemoCreateModal(); window.refreshGallery();
        } catch (err) { alert('오류 발생: ' + err.message); } 
        finally { memoSubmitBtn.textContent = '저장하기'; memoSubmitBtn.disabled = false; }
    });
}

window.addEventListener('popstate', (e) => {
    const previewModal = document.getElementById('preview-modal'); const uploadModal = document.getElementById('gallery-upload-modal');
    const memoModal = document.getElementById('memo-create-modal'); const importModal = document.getElementById('import-modal');
    let modalClosed = false;
    
    if (previewModal && !previewModal.classList.contains('hidden')) { window.closeModal(null, true); modalClosed = true; }
    if (uploadModal && !uploadModal.classList.contains('hidden')) { window.closeGalleryUploadModal(null, true); modalClosed = true; }
    if (memoModal && !memoModal.classList.contains('hidden')) { window.closeMemoCreateModal(null, true); modalClosed = true; }
    if (importModal && !importModal.classList.contains('hidden')) { window.closeImportModal(null, true); modalClosed = true; }

    if (modalClosed) return; 

    if (e.state && e.state.tab === 'craft') { window.switchTab('craft', true); return; } 
    else if (e.state && e.state.tab === 'project') { window.switchTab('project', true); return; }
    else if (e.state && e.state.tab === 'explorer') {
        window.switchTab('explorer', true);
        if (e.state.path !== undefined && e.state.path !== window.currentPrefix) window.loadPath(e.state.path, true);
        return;
    }

    if (e.state && e.state.path !== undefined) {
        if (e.state.path !== window.currentPrefix) window.loadPath(e.state.path, true);
    } else {
        if (window.currentPrefix !== window.ROOT_PATH && window.currentPrefix !== '') {
            const parts = window.currentPrefix.split('/').filter(Boolean); parts.pop();
            const parentPrefix = parts.length > 0 ? parts.join('/') + '/' : window.ROOT_PATH;
            if (parentPrefix !== window.currentPrefix) window.loadPath(parentPrefix, true);
        } else {
            if (window.currentPrefix !== window.ROOT_PATH) window.loadPath(window.ROOT_PATH, true);
        }
    }
});