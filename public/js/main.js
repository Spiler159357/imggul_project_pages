// 8. main.js: 애플리케이션 진입점 및 모듈 통합 관리
import './state.js?v=craft-layout-20260521b';
import * as Api from './api.js?v=temp-meta-trace-20260521';
import * as Ui from './ui.js?v=craft-layout-20260521b';
import * as Explorer from './explorer.js';
import * as Craft from './craft.js?v=temp-meta-trace-20260521';
import * as TempGallery from './temp_gallery.js?v=temp-meta-trace-20260521';
import * as Modals from './modals.js';

// 모든 모듈의 Export 함수들을 window 객체에 바인딩하여 HTML 인라인 속성(onclick 등) 유지
Object.assign(window, Api, Ui, Explorer, Craft, TempGallery, Modals);

// 즉시 실행
window.initSidebarControls();
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

// [버그 해결] 찰나의 시간차가 없도록, DOMContentLoaded 가 끝나자마자 강제 탭 초기화를 진행합니다.
/**
 * 역할: DOM 로드가 끝난 뒤 기본 탭을 explorer로 초기화하는 이벤트 콜백이다.
 * 매개변수: 없음.
 * 주요 변수: switchTab - 초기 탭 표시 함수.
 * 반환값: 명시 반환 없음.
 */
document.addEventListener('DOMContentLoaded', () => {
    window.switchTab('explorer', true);
});

if (window.loadAliases) {
    window.loadAliases().then(() => {
        const initPath = window.INITIAL_PATH || '';
        history.replaceState({ tab: 'explorer', path: initPath }, '', '#' + initPath);
        window.loadPath(initPath, true);
    });
} else {
    const initPath = window.INITIAL_PATH || '';
    history.replaceState({ tab: 'explorer', path: initPath }, '', '#' + initPath);
    window.loadPath(initPath, true);
}

// ----------------------------------------------------
// 이벤트 리스너 등록
// ----------------------------------------------------

/**
 * 역할: Craft 탭에서 방향키로 임시 이미지 선택 인덱스를 이동하는 키보드 이벤트 콜백이다.
 * 매개변수: e - keydown 이벤트 객체.
 * 주요 변수: craftTab, currentIndex, grid, cols, newIndex, handled - 키 이동 계산값.
 * 반환값: 명시 반환 없음.
 */
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

/**
 * 역할: 프롬프트 textarea마다 자동 높이 조절과 Enter 생성 단축 동작을 등록한다.
 * 매개변수: textarea - 반복 중인 textarea DOM 요소.
 * 주요 변수: textarea, saveCraftSettings, generateNaiImage - 입력 저장과 생성 실행 함수.
 * 반환값: 명시 반환 없음.
 */
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

/**
 * 역할: 생성 설정 input 목록에 설정 저장 이벤트를 일괄 등록한다.
 * 매개변수: id - 반복 중인 input 요소 id.
 * 주요 변수: id, saveCraftSettings - 이벤트 대상과 저장 함수.
 * 반환값: 명시 반환 없음.
 */
['nai-model', 'nai-steps', 'nai-scale', 'nai-sampler', 'nai-seed'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', window.saveCraftSettings);
});

document.getElementById('nai-model')?.addEventListener('change', window.updateModelSpecificUI);

const vibeDropZone = document.getElementById('vibe-image-dropzone'); const vibeFileInput = document.getElementById('vibe-image-input');
if (vibeDropZone && vibeFileInput) {
    /**
     * 역할: Vibe 이미지 드롭존의 클릭/드래그/파일 변경 이벤트에서 참조 이미지를 선택한다.
     * 매개변수: e - 각 DOM 이벤트 객체.
     * 주요 변수: vibeDropZone, vibeFileInput, handleVibeImageUpload - 입력 요소와 처리 함수.
     * 반환값: 명시 반환 없음.
     */
    vibeDropZone.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') vibeFileInput.click(); });
    vibeDropZone.addEventListener('dragover', (e) => { e.preventDefault(); vibeDropZone.classList.add('border-indigo-500'); });
    vibeDropZone.addEventListener('dragleave', (e) => { e.preventDefault(); vibeDropZone.classList.remove('border-indigo-500'); });
    vibeDropZone.addEventListener('drop', (e) => { e.preventDefault(); vibeDropZone.classList.remove('border-indigo-500'); if (e.dataTransfer.files.length) window.handleVibeImageUpload(e.dataTransfer.files[0]); });
    vibeFileInput.addEventListener('change', (e) => { if (e.target.files.length) window.handleVibeImageUpload(e.target.files[0]); });
}

const preciseDropZone = document.getElementById('precise-image-dropzone'); const preciseFileInput = document.getElementById('precise-image-input');
if (preciseDropZone && preciseFileInput) {
    /**
     * 역할: Precise 이미지 드롭존의 클릭/드래그/파일 변경 이벤트에서 참조 이미지를 선택한다.
     * 매개변수: e - 각 DOM 이벤트 객체.
     * 주요 변수: preciseDropZone, preciseFileInput, handlePreciseImageUpload - 입력 요소와 처리 함수.
     * 반환값: 명시 반환 없음.
     */
    preciseDropZone.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') preciseFileInput.click(); });
    preciseDropZone.addEventListener('dragover', (e) => { e.preventDefault(); preciseDropZone.classList.add('border-indigo-500'); });
    preciseDropZone.addEventListener('dragleave', (e) => { e.preventDefault(); preciseDropZone.classList.remove('border-indigo-500'); });
    preciseDropZone.addEventListener('drop', (e) => { e.preventDefault(); preciseDropZone.classList.remove('border-indigo-500'); if (e.dataTransfer.files.length) window.handlePreciseImageUpload(e.dataTransfer.files[0]); });
    preciseFileInput.addEventListener('change', (e) => { if (e.target.files.length) window.handlePreciseImageUpload(e.target.files[0]); });
}

const inpaintDropZone = document.getElementById('inpaint-image-dropzone'); const inpaintFileInput = document.getElementById('inpaint-image-input');
if (inpaintDropZone && inpaintFileInput) {
    inpaintDropZone.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') inpaintFileInput.click(); });
    inpaintDropZone.addEventListener('dragover', (e) => { e.preventDefault(); inpaintDropZone.classList.add('border-indigo-500'); });
    inpaintDropZone.addEventListener('dragleave', (e) => { e.preventDefault(); inpaintDropZone.classList.remove('border-indigo-500'); });
    inpaintDropZone.addEventListener('drop', (e) => { e.preventDefault(); inpaintDropZone.classList.remove('border-indigo-500'); if (e.dataTransfer.files.length) window.handleInpaintImageUpload(e.dataTransfer.files[0]); });
    inpaintFileInput.addEventListener('change', (e) => { if (e.target.files.length) window.handleInpaintImageUpload(e.target.files[0]); });
}

const inpaintMaskCanvas = document.getElementById('inpaint-mask-canvas');
if (inpaintMaskCanvas) {
    inpaintMaskCanvas.addEventListener('pointerdown', window.handleInpaintPointerDown);
    inpaintMaskCanvas.addEventListener('pointermove', window.handleInpaintPointerMove);
    inpaintMaskCanvas.addEventListener('pointerup', window.handleInpaintPointerUp);
    inpaintMaskCanvas.addEventListener('pointercancel', window.handleInpaintPointerUp);
    inpaintMaskCanvas.addEventListener('pointerleave', window.handleInpaintPointerUp);
}

/**
 * 역할: 참조 이미지 슬라이더 값 변경 시 옆의 표시 숫자를 갱신한다.
 * 매개변수: id - 반복 중인 slider id, e - input 이벤트 객체.
 * 주요 변수: id, target.value - 표시할 슬라이더 값.
 * 반환값: 명시 반환 없음.
 */
['vibe-strength', 'vibe-info', 'precise-strength', 'precise-fidelity'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', (e) => { document.getElementById(`${id}-val`).innerText = parseFloat(e.target.value).toFixed(1); });
});

document.getElementById('inpaint-brush-size')?.addEventListener('input', (e) => { document.getElementById('inpaint-brush-size-val').innerText = parseInt(e.target.value).toString(); });
document.getElementById('inpaint-strength')?.addEventListener('input', (e) => {
    document.getElementById('inpaint-strength-val').innerText = parseFloat(e.target.value).toFixed(2);
    window.saveCraftSettings();
});

/**
 * 역할: 체크박스형 생성 옵션 변경 시 현재 설정을 저장한다.
 * 매개변수: id - 반복 중인 checkbox id.
 * 주요 변수: id, saveCraftSettings - 이벤트 대상과 저장 함수.
 * 반환값: 명시 반환 없음.
 */
['nai-sm', 'nai-sm-dyn'].forEach(id => { document.getElementById(id)?.addEventListener('change', window.saveCraftSettings); });
/**
 * 역할: 해상도 radio 변경 시 현재 설정을 저장한다.
 * 매개변수: radio - 반복 중인 해상도 radio 요소.
 * 주요 변수: radio, saveCraftSettings - 이벤트 대상과 저장 함수.
 * 반환값: 명시 반환 없음.
 */
document.querySelectorAll('input[name="nai-res"]')?.forEach(radio => { radio.addEventListener('change', window.saveCraftSettings); });

document.getElementById('nai-steps')?.addEventListener('input', window.calculateAnlas);
/**
 * 역할: 해상도 radio 변경 시 예상 Anlas 비용을 다시 계산한다.
 * 매개변수: radio - 반복 중인 해상도 radio 요소.
 * 주요 변수: radio, calculateAnlas - 이벤트 대상과 비용 계산 함수.
 * 반환값: 명시 반환 없음.
 */
document.querySelectorAll('input[name="nai-res"]')?.forEach(radio => { radio.addEventListener('change', window.calculateAnlas); });

const dropZone = document.getElementById('gallery-drop-zone'); const fileInput = document.getElementById('gallery-file-input');
const removeBtn = document.getElementById('gallery-remove-btn'); const submitBtn = document.getElementById('gallery-upload-submit-btn');
const fileNameInput = document.getElementById('gallery-upload-filename');

if (dropZone) {
    /**
     * 역할: 갤러리 업로드 드롭존의 클릭/드래그/드롭 이벤트에서 업로드 파일 미리보기를 준비한다.
     * 매개변수: e - 각 DOM 이벤트 객체.
     * 주요 변수: dropZone, fileInput, removeBtn, showGalleryPreview - 입력 요소와 미리보기 함수.
     * 반환값: 명시 반환 없음.
     */
    dropZone.addEventListener('click', (e) => { if (e.target !== removeBtn) fileInput.click(); });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-active'); });
    dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('drag-active'); });
    document.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag-active'); if (e.dataTransfer.files.length) window.showGalleryPreview(e.dataTransfer.files[0]); });
}

if (removeBtn) removeBtn.addEventListener('click', (e) => { e.stopPropagation(); window.resetGalleryUpload(); });
if (fileInput) fileInput.addEventListener('change', (e) => { if (e.target.files.length) window.showGalleryPreview(e.target.files[0]); });
if (fileNameInput) fileNameInput.addEventListener('input', window.updateGalleryPreviewText);

if (submitBtn) {
    /**
     * 역할: 갤러리 업로드 버튼 클릭 시 파일 변환, 메타데이터 추출, 서버 업로드를 수행한다.
     * 매개변수: 없음.
     * 주요 변수: finalFile, extractedMetadata, fileName, finalPath, headers, buffer, res - 업로드 처리 데이터.
     * 반환값: 명시 반환 없음.
     */
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
    /**
     * 역할: 메모 작성 버튼 클릭 시 텍스트 내용을 .txt 파일로 업로드한다.
     * 매개변수: 없음.
     * 주요 변수: content, fname, blob, fileName, finalPath, headers, buffer, res - 메모 저장 데이터.
     * 반환값: 명시 반환 없음.
     */
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

/**
 * 역할: 브라우저 뒤로가기/앞으로가기에서 모달 닫기와 탭/경로 복원을 처리한다.
 * 매개변수: e - popstate 이벤트 객체.
 * 주요 변수: previewModal, uploadModal, memoModal, importModal, modalClosed, e.state - 복원 대상 상태.
 * 반환값: 명시 반환 없음.
 */
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
