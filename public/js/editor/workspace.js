import { EditorEngine } from "./engine.js?v=editor-rework-20261117a";
import { ToolController } from "./tools.js?v=editor-rework-20261117a";
import { Persistence, api, queryFor, clearLegacyRecovery } from "./storage.js?v=editor-rework-20261117a";
import { createAssetFolderCard, createAssetImageCard, createAssetParentCard } from "../asset-picker-cards.js?v=selection-ui-20261106c";
import { getSelectionFolderImage, getSelectionFileAlias } from "../selection-ui.js?v=selection-ui-20261106c";
import { TOOL_HELP, HELP_HTML } from "./help.js?v=editor-rework-20261117a";
import { PRESETS, BLENDS, uid, clone, newLayer, worldMatrix, inverse, multiply, point, identity, clamp, validateDocument } from "./model.js?v=editor-rework-20261117a";
import { canvas, copy, blobOf, histogram, parseCube, colorSelection, invertMask, maskCombine, blur, maskMorph, decontaminate, traceBezier } from "./bitmap.js?v=editor-rework-20261117a";
import { segmentSubject } from "./subject.js?v=editor-rework-20261117a";
import { colorControl, EditorColorPicker } from "./color-picker.js?v=editor-rework-20261117a";
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const button = (action, label, extra = "") => `<button type="button" data-action="${action}" ${extra}>${label}</button>`;
const field = (path, label, value, type = "number", extra = "") => {
  const input = `<input data-field="${path}" type="${type}" ${type === "checkbox" ? value ? "checked" : "" : `value="${escape(value)}"`} ${extra}>`;
  const fill = path === "option.fill" || path === "layer.data.fill";
  return `<label>${label}${type === "color" || fill ? colorControl(input, value, label, fill) : input}</label>`;
};
const select = (path, label, value, items) => `<label>${label}<select data-field="${path}">${items.map((item) => {
  const [v, text] = Array.isArray(item) ? item : [item, item];
  return `<option value="${escape(v)}" ${String(v) === String(value) ? "selected" : ""}>${escape(text)}</option>`;
}).join("")}</select></label>`;
const TOOLS = [["이동", [["move", "이동 V"], ["transform", "변형"], ["warp", "워프"]]], ["선택", [["rect-select", "사각 M"], ["ellipse-select", "타원"], ["lasso", "올가미 L"], ["polygon", "다각선택"], ["wand", "색상선택"], ["selection-move", "선택이동"]]], ["구도", [["crop", "자르기"]]], ["페인트", [["brush", "브러시 B"], ["eraser", "지우개 E"], ["fill", "채우기"], ["gradient", "그라데이션"], ["eyedropper", "스포이트 I"]]], ["리터칭", [["clone", "도장"], ["heal", "힐링"], ["patch", "패치"], ["dodge", "닷지"], ["burn", "번"], ["smudge", "스머지"], ["blur-brush", "블러"], ["sharpen-brush", "샤픈"], ["liquify", "밀기"]]], ["표현", [["text", "문자 T"], ["rect", "사각형"], ["ellipse", "타원형"], ["line", "직선"], ["arrow", "화살표"], ["polygon-shape", "다각형"], ["pen", "펜/패스"]]], ["보기", [["hand", "손 Space"], ["zoom", "확대/축소"]]]];
const EFFECTS = [["brightness", "밝기/대비"], ["exposure", "노출"], ["hue", "색조/채도"], ["balance", "색상 균형"], ["grayscale", "흑백"], ["levels", "레벨"], ["curves", "커브"], ["gradient-map", "그라데이션 맵"], ["blur", "가우시안 블러"], ["sharpen", "샤픈"], ["mosaic", "모자이크"]];
const PARAMS = { brightness: [["brightness", "밝기", 0, -100, 100], ["contrast", "대비", 0, -100, 100]], exposure: [["exposure", "노출", 0, -5, 5]], hue: [["hue", "색조", 0, -180, 180], ["saturation", "채도", 100, 0, 300]], balance: [["red", "Red", 0, -255, 255], ["green", "Green", 0, -255, 255], ["blue", "Blue", 0, -255, 255]], levels: [["black", "검정", 0, 0, 254], ["white", "흰색", 255, 1, 255], ["gamma", "감마", 1, 0.1, 5]], blur: [["radius", "반경", 6, 0, 50]], sharpen: [["amount", "강도", 1, 0, 5], ["radius", "반경", 1, 1, 10]], mosaic: [["size", "블록", 12, 2, 80]] };
const BLEND_LABELS = { "source-over": "일반", multiply: "곱하기", screen: "스크린", overlay: "오버레이", "soft-light": "소프트 라이트", "hard-light": "하드 라이트", darken: "어둡게", lighten: "밝게", difference: "차이", hue: "색조", saturation: "채도", color: "색상", luminosity: "광도" };
const projects = /* @__PURE__ */ new Map();
let activeWorkspace = null;
let clipboard = null;
function projectSession(projectId, prefix) {
  if (!projects.has(projectId)) projects.set(projectId, { entries: [], current: null, prefix, projectId, view: null });
  const session = projects.get(projectId);
  session.prefix = prefix;
  return session;
}
function entryFor(session,preset='square',attach=true){
  if(session.entries.length>=8)throw new Error('열린 작업은 최대 8개입니다. 일부 작업을 닫아주세요.');
  const engine=new EditorEngine(session.projectId,session.prefix);engine.doc.preset=preset;[engine.doc.width,engine.doc.height]=PRESETS[preset];engine.baseline();
  const entry={engine,status:'작업 저장 전',collapsed:new Set()};
  entry.persistence=new Persistence(engine,text=>{entry.status=text;session.view?.updateStatus();});
  if(attach){session.entries.push(entry);session.current=entry;}return entry;
}

class EditorWorkspace {
  constructor(root, options = {}) {
    this.root = root;
    this.options = { size: 24, color: "#ef5350", background: "#ffffff", fill: "transparent", strokeWidth: 3, opacity: 1, flow: 1, hardness: 0.8, spacing: 0.15, pressure: true, selectionMode: "replace", tolerance: 32, contiguous: true, sampleMerged: true, radial: false, maskErase: false };
    this.viewport = { x: 40, y: 40, zoom: 0.7 };
    this.tool = "move";
    this.compare = false;
    this.split = false;
    this.cursor = null;
    this.raf = null;
    this.abort = new AbortController();
    this.session = projectSession(options.projectId || "global", options.projectPrefix || "");
    this.session.view = this;
    this.options={...this.options,...this.session.options};this.session.options=this.options;this.tool=this.session.tool||this.tool;
    this.root.innerHTML=`<section class="ed-workspace" aria-label="이미지 편집기"><header class="ed-header">${button('back','←','aria-label="프로젝트로 돌아가기" title="프로젝트로 돌아가기"')}<span class="ed-title" title="작업 이름">이미지 편집기</span><nav class="ed-menu">
      <details><summary>파일</summary><div>${button('new','새 작업')}${button('recent','작업 불러오기')}${button('save','작업 저장')}${button('save-as','다른 이름으로 저장')}</div></details>
      <details><summary>편집</summary><div>${button('undo','실행 취소')}${button('redo','다시 실행')}${button('copy','복사')}${button('copy-merged','합성 내용 복사')}${button('cut','잘라내기')}${button('paste','붙여넣기')}${button('commands','명령 검색')}</div></details>
      <details><summary>이미지</summary><div>${button('crop','구도·크기 변경')}${button('rotate-doc','90° 회전')}${button('subject','피사체 선택')}${button('auto-background','배경색으로 선택')}${button('refine','마스크 경계 다듬기')}${button('lut','LUT 불러오기')}</div></details>
      <details><summary>레이어</summary><div>${button('paint','페인트 레이어 만들기')}${button('duplicate','레이어 복제')}${button('group','그룹 만들기')}${button('ungroup','그룹 해제')}${button('merge','선택 레이어 병합')}${button('flatten','전체 병합')}${button('mask','선택으로 마스크 만들기')}${button('vector-mask','패스로 마스크 만들기')}${button('clip','아래 레이어에 클리핑')}${button('delete','레이어 삭제')}</div></details>
      <details><summary>선택</summary><div>${button('all','전체 선택')}${button('deselect','선택 해제')}${button('invert','선택 반전')}${button('selection-transform','선택 영역 변형')}${button('feather','경계 부드럽게')}${button('grow','선택 확장')}${button('shrink','선택 축소')}</div></details>
      <details><summary>보정</summary><div>${EFFECTS.map(([id,name])=>button('effect',name,`data-effect="${id}"`)).join('')}${button('histogram','히스토그램')}</div></details>
      <details><summary>보기</summary><div>${button('fit','화면에 맞추기')}${button('actual','100% 보기')}${button('compare','원본 비교')}${button('split','원본과 분할 비교')}${button('grid','픽셀 격자')}${button('guides','중앙 가이드')}${button('panel','속성 패널 접기/펼치기')}</div></details>
      </nav><span class="ed-header-spacer"></span>${button('save','작업 저장','class="ed-primary"')}${button('export','이미지 내보내기')}${button('help','도움말')}</header>
      <div class="ed-quick-actions">${button('new','새 작업')}${button('recent','작업 불러오기')}${button('add-images','이미지 불러오기')}${button('commands','모든 명령')}${button('panel','속성·레이어')}${button('sample-point','샘플 위치 선택','data-sample-button hidden')}</div>
      <div class="ed-options" aria-label="도구 옵션"></div><div class="ed-tabs" role="tablist" aria-label="열린 작업"></div>
      <div class="ed-body"><aside class="ed-tools" aria-label="편집 도구">${TOOLS.map(([name,items],i)=>`<details ${i===0||i===1||i===3?'open':''}><summary>${name}</summary>${items.map(([id,label])=>`<button type="button" data-tool="${id}" title="${label} · ${escape(TOOL_HELP[id]||'')}" aria-label="${label}">${label}</button>`).join('')}</details>`).join('')}${colorControl(`<input type="color" class="ed-foreground" aria-label="전경색" value="${this.options.color}">`,this.options.color,'전경색')}</aside>
      <div class="ed-stage" tabindex="0" aria-label="편집 캔버스"><canvas class="ed-image"></canvas><canvas class="ed-overlay"></canvas><div class="ed-start"><h2>이미지 편집기</h2><p>이미지로 새 작업을 시작하거나 저장한 작업을 불러오세요.</p><div>${button('new','새 작업','class="ed-primary"')}${button('recent','작업 불러오기')}</div><p>작업 저장은 레이어를 보존하고, 이미지 내보내기는 PNG·JPEG·WebP를 만듭니다.</p><p>지원 규격 · 가로형 1216×832 px · 정사각형 1024×1024 px · 세로형 832×1216 px</p>${button('help','사용 방법 보기')}</div></div>
      <aside class="ed-inspector"><div class="ed-width-resizer" role="separator" aria-label="패널 너비 조절"></div><div class="ed-panel-tabs"><strong>속성</strong>${button('panel','접기')}</div><div class="ed-properties"></div><div class="ed-resizer" role="separator" aria-label="패널 높이 조절"></div><div class="ed-layer-tabs">${button('layers-tab','레이어')}${button('history-tab','기록')}<canvas class="ed-navigator" width="96" height="64" title="클릭해 화면 이동"></canvas></div><div class="ed-layer-controls">${select('layer.blend','혼합','source-over',BLENDS.map(value=>[value,BLEND_LABELS[value]]))}${field('layer.opacity','불투명도',1,'number','min="0" max="1" step="0.05"')}</div><div class="ed-layers"></div><div class="ed-history" hidden></div><div class="ed-layer-actions">${button('paint','＋')}${button('duplicate','복제')}${button('mask','마스크')}${button('group','그룹')}${button('delete','삭제')}</div></aside></div>
      <footer class="ed-status">${button('fit','맞춤')}${button('actual','100%')}<span class="ed-document-info"></span><span class="ed-target"></span><span class="ed-location"></span><span class="ed-save-status" role="status" aria-live="polite"></span></footer></section>`;
    this.stage = root.querySelector(".ed-stage");
    this.image = root.querySelector(".ed-image");
    this.overlay = root.querySelector(".ed-overlay");
    this.palette = this.readThemeColors();
    this.themeObserver = new MutationObserver(() => {
      if (this.destroyed || !this.root.isConnected) return;
      this.palette = this.readThemeColors();
      for (const paint of this.curvePainters || []) paint();
      this.draw();
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    this.colorPicker = new EditorColorPicker(this);
    const signal = this.abort.signal;
    root.addEventListener("click", (event) => this.click(event), { signal });
    root.addEventListener("input", (event) => this.input(event), { signal });
    root.addEventListener("change", (event) => this.change(event), { signal });
    root.addEventListener("focusin", (event) => {
      if (this.engine && event.target.matches('[data-field^="layer."]')) this.propertyBefore = clone(this.engine.doc);
    }, { signal });
    document.addEventListener("keydown", (event) => this.key(event), { signal });
    document.addEventListener("keyup", (event) => {
      if (event.code === "Space" && this.controller) this.controller.space = false;
    }, { signal });
    window.addEventListener("blur", () => {
      this.cancelProperty();
      this.curveCancel?.();
      if(this.controller){this.controller.space=false;this.controller.cancel();}
    }, { signal });
    root.addEventListener("dragover", (event) => {
      event.preventDefault();
    }, { signal });
    root.addEventListener("drop", (event) => {
      if (event.dataTransfer.files.length) {
        event.preventDefault();
        void this.importFiles(event.dataTransfer.files, !!this.entry).catch((error) => this.notify(error.message));
      }
    }, { signal });
    root.addEventListener("paste", (event) => {
      if (event.target.closest("input,textarea,[contenteditable]")) return;
      const file = [...event.clipboardData.items].find((i) => i.type.startsWith("image/"))?.getAsFile();
      if (file) {
        event.preventDefault();
        void this.importFiles([file], !!this.entry).catch((error) => this.notify(error.message));
      }else if(clipboard&&this.entry){event.preventDefault();this.pasteInternal();}
    }, { signal });
    this.stage.addEventListener("wheel", (event) => {
      event.preventDefault();
      if(!this.controller)return;
      const p = this.controller.position(event);
      if (event.ctrlKey || event.metaKey || this.tool === "zoom") this.zoom(this.viewport.zoom * Math.exp(-event.deltaY * 2e-3), p);
      else {
        this.viewport.x -= event.deltaX;
        this.viewport.y -= event.deltaY;
        this.draw();
      }
    }, { signal, passive: false });
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this.stage);
    this.detachObserver = new MutationObserver(() => {
      if (!root.isConnected) this.destroy();
    });
    this.detachObserver.observe(document.body, { childList: true, subtree: true });
    this.useEntry(this.session.current || null);
    this.restoreLayout();
    this.bindResize();
    this.bindTouch();
    clearLegacyRecovery(message=>this.notify(message));
    window.addEventListener('pagehide',()=>{this.controller?.cancel();void this.flushEntries();},{signal});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){this.controller?.cancel();void this.flushEntries();}},{signal});
    document.addEventListener('pointerdown',event=>{const menu=event.target.closest('.ed-menu details');this.root.querySelectorAll('.ed-menu details[open]').forEach(details=>{if(details!==menu)details.open=false;});},{signal});

    if (options.sourceKey) void this.openKey(options.sourceKey, false).catch((error) => this.notify(error.message));
  }
  get engine() {
    return this.entry?.engine || null;
  }
  readThemeColors() {
    const style = getComputedStyle(this.root.querySelector(".ed-workspace"));
    const token = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
    return {
      background: token("--ed-bg", "#0a0a0a"),
      border: token("--ed-border", "#404040"),
      accent: token("--ed-accent", "#818cf8"),
      heading: token("--ed-heading", "#ffffff"),
      checkerBase: token("--ed-checker-base", "#262626"),
      checkerAlt: token("--ed-checker-alt", "#404040"),
      selection: token("--ed-selection-tint", "rgba(129,140,248,.22)"),
      handle: token("--ed-handle", "#e5e7eb"),
      cursor: token("--ed-cursor", "#f5f5f5"),
      guide: token("--ed-guide", "#a5b4fc")
    };
  }
  useEntry(entry){
    if(this.destroyed)return;
    this.cancelProperty();this.curveCancel?.();
    const previous=this.entry;if(previous)previous.engine.removeEventListener('change',this.onEngineChange);
    this.controller?.destroy();this.controller=null;
    if(previous)void previous.persistence.flush().catch(()=>{});
    this.entry=entry;this.session.current=entry;
    if(entry){
      this.controller=new ToolController(this,entry.engine);
      this.onEngineChange=()=>{this.update();this.draw();};entry.engine.addEventListener('change',this.onEngineChange);
      void this.readyFonts(entry.engine).then(()=>{entry.engine.renderer.clear();if(this.entry===entry)this.draw();});
    }
    this.update();if(entry)this.fit();
  }

  notify(message,dialog=null){
    if(this.destroyed)return;
    if(this.entry)this.entry.status=message;else this.homeStatus=message;
    this.updateStatus();
    const target=dialog||[...(this.dialogs||[])].reverse().find(d=>d.open);
    const status=target?.querySelector('.ed-dialog-status');if(status)status.textContent=message;
  }

  updateStatus(){
    if(this.destroyed)return;
    const status=this.root.querySelector('.ed-save-status');if(status)status.textContent=this.entry?.status||this.homeStatus||'';
  }

  update(){
    if(this.destroyed)return;
    const sampleButton=this.root.querySelector('[data-sample-button]');sampleButton.hidden=!this.entry||!['clone','heal'].includes(this.tool);
    const home=!this.entry;this.root.querySelector('.ed-workspace').classList.toggle('ed-home',home);
    this.root.querySelector('.ed-start').hidden=!home;
    const general=new Set(['new','recent','help','back','commands']);
    this.root.querySelectorAll('[data-action]').forEach(button=>{if(button.closest('.ed-header')||button.closest('.ed-quick-actions'))button.disabled=home&&!general.has(button.dataset.action);});
    this.root.querySelector('.ed-title').textContent=home?'이미지 편집기':this.engine.doc.title;
    this.renderTabs();this.updateStatus();
    if(home){this.curvePainters=[];this.root.querySelector('.ed-options').innerHTML='';for(const name of ['.ed-document-info','.ed-target','.ed-location'])this.root.querySelector(name).textContent='';return;}
    const e=this.engine,focused=e.isEditing||this.colorPicker.isOpen||this.root.contains(document.activeElement)&&document.activeElement.matches('input,textarea,select');
    this.root.querySelector('.ed-document-info').textContent=`${Math.round(this.viewport.zoom*100)}% · ${e.doc.width}×${e.doc.height} px · ${e.dirty?'미저장 변경':e.everSaved?'저장됨':'편집 전'}`;
    this.root.querySelector('.ed-target').textContent=`대상: ${e.target==='mask'?'마스크':e.target==='vector'?'벡터 마스크':'픽셀'} · ${e.layer()?.name||'선택 없음'}`;
    this.root.querySelector('.ed-location').textContent=e.everSaved?`${this.projectLabel()} / 편집 작업 / ${e.doc.title}`:'정식 저장 전 · 자동 저장은 임시 공간';
    if(!focused){this.renderProperties();this.renderLayers();}
    this.renderHistory();this.updateOptions();
    this.root.querySelectorAll('[data-tool]').forEach(button=>button.classList.toggle('active',button.dataset.tool===this.tool));
    this.root.querySelector('[data-sample-button]').hidden=!['clone','heal','patch'].includes(this.tool);
  }

  renderTabs(){
    this.root.querySelector('.ed-tabs').innerHTML=this.session.entries.map((entry,index)=>`<div class="ed-tab"><button role="tab" aria-selected="${entry===this.entry}" data-entry="${index}">${escape(entry.engine.doc.title)}${entry.engine.dirty?' •':''}</button><button type="button" data-close-entry="${index}" title="작업 닫기" aria-label="${escape(entry.engine.doc.title)} 닫기">×</button></div>`).join('');
  }

  updateOptions() {
    if (this.colorPicker.isOpen) return;
    const active = this.root.querySelector(".ed-options");
    if (!this.entry || active.contains(document.activeElement)) return;
    const o = this.options;
    active.innerHTML = `${this.controller?.pendingTransform ? button("apply-transform", "변형 적용") + button("cancel-transform", "변형 취소") : ""}<strong>${escape(TOOLS.flatMap((g) => g[1]).find((t) => t[0] === this.tool)?.[1] || this.tool)}</strong>${field("option.size", "크기", o.size, "number", 'min="1" max="240"')}${field("option.color", "색", o.color, "color")}${field("option.opacity", "불투명도", o.opacity, "number", 'min="0" max="1" step="0.05"')}${field("option.hardness", "경도", o.hardness, "number", 'min="0" max="1" step="0.05"')}${field("option.flow", "흐름", o.flow, "number", 'min="0" max="1" step="0.05"')}${field("option.spacing", "간격", o.spacing, "number", 'min="0.01" max="1" step="0.01"')}${field("option.pressure", "필압", o.pressure, "checkbox")}${field("option.smoothing", "선 보정", o.smoothing || 0, "number", 'min="0" max="0.9" step="0.1"')}${field("option.snap", "스냅", o.snap !== false, "checkbox")}${select("option.selectionMode", "선택", o.selectionMode, [["replace", "교체"], ["add", "추가"], ["subtract", "빼기"], ["intersect", "교차"]])}${field("option.tolerance", "허용치", o.tolerance, "number", 'min="0" max="255"')}${field("option.contiguous", "인접", o.contiguous, "checkbox")}${field("option.sampleMerged", "합성 샘플", o.sampleMerged, "checkbox")}${field("option.maskErase", "마스크 지우기", o.maskErase, "checkbox")}${field("option.fill", "도형 채우기", o.fill, "text")}${field("option.background", "배경색", o.background, "color")}${field("option.strokeWidth", "획", o.strokeWidth, "number", 'min="0" max="40"')}${field("option.radial", "방사형", o.radial, "checkbox")}`;
    if(["polygon","pen"].includes(this.tool))active.insertAdjacentHTML("beforeend",button("finish-path","선택·패스 완료"));
    let keys = [];
    if (["brush", "eraser", "clone", "heal", "patch", "dodge", "burn", "smudge", "blur-brush", "sharpen-brush", "liquify"].includes(this.tool)) keys = ["size", "color", "opacity", "hardness", "flow", "spacing", "pressure", "smoothing", "maskErase"];
    else if (["rect-select", "ellipse-select", "lasso", "polygon"].includes(this.tool)) keys = ["selectionMode"];
    else if (this.tool === "wand") keys = ["selectionMode", "tolerance", "contiguous", "sampleMerged"];
    else if (this.tool === "fill") keys = ["color", "opacity", "tolerance", "contiguous", "sampleMerged"];
    else if (this.tool === "gradient") keys = ["color", "background", "opacity", "radial"];
    else if (["rect", "ellipse", "line", "arrow", "polygon-shape", "pen"].includes(this.tool)) keys = ["color", "fill", "strokeWidth", "opacity"];
    else if (this.tool === "text") keys = ["color"];
    else if (["move", "transform", "warp"].includes(this.tool)) keys = ["snap"];
    active.querySelectorAll("[data-field]").forEach((input) => input.closest("label").hidden = !keys.includes(input.dataset.field.slice(7)));
    this.root.querySelector(".ed-foreground").value = o.color;
    this.colorPicker.refresh();
  }
  renderProperties() {
    this.curvePainters = [];
    const e = this.engine, l = e.layer(), target = this.root.querySelector(".ed-properties");
    if (!l) {
      target.innerHTML = `<h3>작업 속성</h3><p>레이어를 선택하면 속성을 편집할 수 있습니다.</p>${select("document.preset", "규격", e.doc.preset, Object.keys(PRESETS).map((k) => [k, PRESETS[k].join("×")]))}${button("crop", "구도 조절")}${button("histogram", "히스토그램")}`;
      return;
    }
    let html = `<h3>${escape(l.name)}</h3>${field("layer.name", "이름", l.name, "text")}${field("layer.visible", "표시", l.visible, "checkbox")}${field("layer.locked", "잠금", l.locked, "checkbox")}${field("layer.alphaLock", "알파 잠금", l.alphaLock, "checkbox")}<div class="ed-button-row">${button("pixels-target", "픽셀 선택")}${l.mask ? button("mask-target", "마스크 선택") : button("mask", "마스크 추가")}</div><fieldset ${l.locked ? "disabled" : ""}>`;
    html += field("layer.matrix.4", "X", Math.round(l.matrix[4])) + field("layer.matrix.5", "Y", Math.round(l.matrix[5])) + field("transform.scaleX", "가로 배율", Math.hypot(l.matrix[0], l.matrix[1]), "number", 'step="0.05" min="0.01"') + field("transform.scaleY", "세로 배율", Math.hypot(l.matrix[2], l.matrix[3]), "number", 'step="0.05" min="0.01"') + field("transform.rotation", "회전 °", Math.atan2(l.matrix[1], l.matrix[0]) * 180 / Math.PI, "number", 'step="1"');
    html += field("transform.width", "배치 폭", Math.round(l.width * Math.hypot(l.matrix[0], l.matrix[1]))) + field("transform.height", "배치 높이", Math.round(l.height * Math.hypot(l.matrix[2], l.matrix[3]))) + field("transform.skew", "기울이기 °", Math.atan2(l.matrix[2], l.matrix[3]) * 180 / Math.PI, "number", 'min="-70" max="70"') + field("transform.perspectiveX", "가로 원근", l.data.perspectiveX || 0, "number", 'min="-80" max="80"') + field("transform.perspectiveY", "세로 원근", l.data.perspectiveY || 0, "number", 'min="-80" max="80"');
    html += `<div class="ed-button-row">${button("flip-x", "좌우")}${button("flip-y", "상하")}${button("align-left", "왼쪽")}${button("align-center", "가운데")}${button("align-right", "오른쪽")}${button("align-top", "위")}${button("align-middle", "중앙")}${button("align-bottom", "아래")}</div>`;
    if (l.type === "text") html += `<label>내용<textarea data-field="layer.data.text">${escape(l.data.text)}</textarea></label>${select("layer.data.font", "폰트", l.data.font || "Noto Sans KR", [["Noto Sans KR", "Noto Sans KR"], ["sans-serif", "기본 산세리프"], ["serif", "기본 세리프"], ["monospace", "고정폭"]])}${field("layer.data.size", "크기", l.data.size || 40)}${field("layer.data.color", "색상", l.data.color || "#ffffff", "color")}${field("layer.data.bold", "굵게", l.data.bold, "checkbox")}${field("layer.data.italic", "기울임", l.data.italic, "checkbox")}${select("layer.data.align", "정렬", l.data.align || "left", ["left", "center", "right"])}${field("layer.data.lineHeight", "행간", l.data.lineHeight || 1.4, "number", 'step="0.1"')}${field("layer.data.spacing", "자간", l.data.spacing || 0)}${field("layer.width", "글상자 폭", l.width, "number", 'min="1" max="1216"')}${field("layer.height", "글상자 높이", l.height, "number", 'min="1" max="1216"')}`;
    if (l.type === "shape") html += select("layer.data.shape", "종류", l.data.shape, ["rect", "ellipse", "line", "arrow", "polygon"]) + field("layer.data.fill", "채우기", l.data.fill || "transparent", "text") + field("layer.data.stroke", "선 색상", l.data.stroke || "#ffffff", "color") + field("layer.data.strokeWidth", "선 굵기", l.data.strokeWidth ?? 3) + field("layer.data.radius", "모서리", l.data.radius || 0) + field("layer.data.sides", "변 수", l.data.sides || 5, "number", 'min="3" max="24"');
    if (l.type === "path") {
      const index = Math.min(Math.max(0, this.options.anchorIndex || 0), l.data.points.length - 1), anchor = l.data.points[index];
      html += field("option.anchorIndex", "선택 앵커", index, "number", `min="0" max="${l.data.points.length - 1}"`) + field(`layer.data.points.${index}.x`, "앵커 X", anchor.x) + field(`layer.data.points.${index}.y`, "앵커 Y", anchor.y) + field(`layer.data.points.${index}.inX`, "들어오는 핸들 X", anchor.inX || 0) + field(`layer.data.points.${index}.inY`, "들어오는 핸들 Y", anchor.inY || 0) + field(`layer.data.points.${index}.outX`, "나가는 핸들 X", anchor.outX || 0) + field(`layer.data.points.${index}.outY`, "나가는 핸들 Y", anchor.outY || 0) + field("layer.data.closed", "닫힌 패스", l.data.closed, "checkbox") + field("layer.data.stroke", "선 색상", l.data.stroke || "#ffffff", "color") + field("layer.data.fill", "채우기", l.data.fill || "transparent", "text") + button("anchor-delete", "앵커 삭제") + button("vector-mask", "패스로 마스크");
      html += "<p>펜 도구에서 앵커·핸들을 드래그합니다. Alt+앵커 드래그로 핸들을 늘립니다.</p>";
    }
    if (l.vectorMask) {
      html += `<h4>벡터 마스크</h4>${field("layer.vectorMask.enabled", "사용", l.vectorMask.enabled !== false, "checkbox")}${button("vector-target", "앵커 편집")}${button("vector-selection", "선택으로")}${button("vector-delete", "벡터 마스크 삭제")}`;
      if (e.target === "vector") {
        const index = Math.min(this.options.anchorIndex || 0, l.vectorMask.points.length - 1), anchor = l.vectorMask.points[index];
        html += field("option.anchorIndex", "선택 앵커", index, "number", `min="0" max="${l.vectorMask.points.length - 1}"`);
        for (const [key, label] of [["x", "앵커 X"], ["y", "앵커 Y"], ["inX", "들어오는 핸들 X"], ["inY", "들어오는 핸들 Y"], ["outX", "나가는 핸들 X"], ["outY", "나가는 핸들 Y"]]) html += field(`layer.vectorMask.points.${index}.${key}`, label, anchor[key] || 0);
      }
    }
    if (l.type === "image") html += button("replace-image", "이미지 교체");
    if (l.mask) html += `<h4>마스크</h4>${field("layer.mask.enabled", "사용", l.mask.enabled, "checkbox")}${field("layer.mask.density", "밀도", l.mask.density, "number", 'min="0" max="1" step="0.05"')}${field("layer.mask.feather", "페더", l.mask.feather, "number", 'min="0" max="30"')}${button("mask-invert", "반전")}${button("mask-link", l.mask.linked === false ? "변형 연결" : "변형 분리")}${button("mask-selection", "선택으로")}${button("mask-delete", "마스크 삭제")}`;
    html += `<h4>스타일</h4>${field("layer.style.strokeWidth", "테두리", l.style.strokeWidth || 0, "number", 'min="0" max="20"')}${field("layer.style.strokeColor", "테두리 색", l.style.strokeColor || "#000000", "color")}${field("layer.style.shadowBlur", "그림자 흐림", l.style.shadowBlur || 0, "number", 'min="0" max="30"')}${field("layer.style.shadowX", "그림자 X", l.style.shadowX || 0)}${field("layer.style.shadowY", "그림자 Y", l.style.shadowY || 0)}${field("layer.style.shadowColor", "그림자 색", l.style.shadowColor || "#000000", "color")}`;
    if (l.type !== "adjustment") html += field("layer.style.glowRadius", "광선 반경", l.style.glowRadius || 0, "number", 'min="0" max="30"') + field("layer.style.glowColor", "광선 색상", l.style.glowColor || "#89c7ff", "color") + field("layer.style.overlayEnabled", "색상 오버레이", l.style.overlayEnabled, "checkbox") + field("layer.style.overlay", "오버레이 색상", l.style.overlay || "#ffffff", "color") + field("layer.style.overlayOpacity", "오버레이 강도", l.style.overlayOpacity ?? 0.5, "number", 'min="0" max="1" step="0.05"') + field("layer.style.gradientEnabled", "그라데이션 오버레이", l.style.gradientEnabled, "checkbox") + field("layer.style.gradientFrom", "시작 색상", l.style.gradientFrom || "#352a70", "color") + field("layer.style.gradientTo", "끝 색상", l.style.gradientTo || "#ffb388", "color") + field("layer.style.gradientOpacity", "그라데이션 강도", l.style.gradientOpacity ?? 0.5, "number", 'min="0" max="1" step="0.05"');
    for (const [i, fx] of l.effects.entries()) {
      html += `<h4>${escape(EFFECTS.find((v) => v[0] === fx.type)?.[1] || fx.type)} ${button("effect-up", "↑", `data-index="${i}" title="앞으로"`)}${button("effect-down", "↓", `data-index="${i}" title="뒤로"`)}${button("remove-effect", "삭제", `data-index="${i}"`)}</h4>${field(`layer.effects.${i}.enabled`, "사용", fx.enabled !== false, "checkbox")}`;
      for (const [key, name, fallback, min, max] of PARAMS[fx.type] || []) html += field(`layer.effects.${i}.params.${key}`, name, fx.params[key] ?? fallback, "range", `min="${min}" max="${max}" step="${["gamma", "amount", "exposure"].includes(key) ? ".1" : "1"}"`);
      if (["levels", "curves"].includes(fx.type)) html += select(`layer.effects.${i}.params.channel`, "채널", fx.params.channel || "rgb", [["rgb", "RGB"], ["red", "Red"], ["green", "Green"], ["blue", "Blue"]]);
      if (fx.type === "curves") html += `<canvas class="ed-curve" width="256" height="160" data-curve="${i}" tabindex="0" aria-label="커브 편집" title="클릭 추가 · 드래그 이동 · 우클릭 삭제"></canvas><p>클릭으로 점 추가 · 드래그로 조절 · 우클릭으로 점 삭제</p>`;
      if (fx.type === "gradient-map") html += field(`layer.effects.${i}.params.from`, "어두운 색", fx.params.from || "#10152e", "color") + field(`layer.effects.${i}.params.to`, "밝은 색", fx.params.to || "#f5d8aa", "color");
      html += button("effect-up", "효과 위로", `data-index="${i}"`);
    }
    html += "</fieldset>";
    target.innerHTML = html;
    this.bindCurves();
    const controls = this.root.querySelector(".ed-layer-controls");
    controls.querySelector('[data-field="layer.blend"]').value = l.blend;
    controls.querySelector('[data-field="layer.opacity"]').value = l.opacity;
  }
  bindCurves() {
    this.root.querySelectorAll("[data-curve]").forEach((c) => {
      const e = this.engine, layerId = e.layer().id, index = Number(c.dataset.curve);
      let gesture = null;
      const coordinates = (event) => {
        const rect = c.getBoundingClientRect();
        return [clamp((event.clientX - rect.left) / rect.width * 255, 0, 255), clamp(255 - (event.clientY - rect.top) / rect.height * 255, 0, 255)];
      };
      const points = () => e.doc.layers.find((l) => l.id === layerId).effects[index].params.points;
      const paint = () => {
        const ctx = c.getContext("2d");
        ctx.clearRect(0, 0, 256, 160);
        ctx.fillStyle = this.palette.background;
        ctx.fillRect(0, 0, 256, 160);
        ctx.strokeStyle = this.palette.border;
        ctx.beginPath();
        for (let k = 1; k < 4; k++) {
          ctx.moveTo(k * 64, 0);
          ctx.lineTo(k * 64, 160);
          ctx.moveTo(0, k * 40);
          ctx.lineTo(256, k * 40);
        }
        ctx.stroke();
        ctx.strokeStyle = this.palette.accent;
        ctx.beginPath();
        for (const p of points().slice().sort((a, b) => a[0] - b[0])) ctx.lineTo(p[0], 160 - p[1] / 255 * 160);
        ctx.stroke();
        ctx.fillStyle = this.palette.heading;
        for (const p of points()) {
          ctx.beginPath();
          ctx.arc(p[0], 160 - p[1] / 255 * 160, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      c.onpointerdown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const p = coordinates(event), list = points();
        gesture = { before: clone(e.doc), point: list.find((v) => Math.hypot(v[0] - p[0], v[1] - p[1]) < 12) };
        if (!gesture.point) {
          gesture.point = p;
          list.push(p);
        }
        e.isEditing = true;
        c.setPointerCapture(event.pointerId);
        paint();
      };
      c.onpointermove = (event) => {
        if (!gesture) return;
        const p = coordinates(event);
        gesture.point[0] = p[0];
        gesture.point[1] = p[1];
        e.renderer.clear();
        paint();
        this.draw();
      };
      const finish = () => {
        if (!gesture) return;
        const after = clone(e.doc);
        e.doc = gesture.before;
        gesture = null;
        e.isEditing = false;
        e.transaction("커브 점 변경", () => e.doc = after);
      };
      const cancel = () => {
        if (gesture) {
          e.doc = gesture.before;
          gesture = null;
          e.isEditing = false;
          e.renderer.clear();
          e.emit();
          this.draw();
        }
      };
      c.onpointerup = finish;
      c.onpointercancel = cancel;
      this.curveCancel = cancel;
      c.oncontextmenu = (event) => {
        event.preventDefault();
        const p = coordinates(event), list = clone(points());
        if (list.length <= 2) return;
        let best = 0;
        for (let i = 1; i < list.length; i++) if (Math.hypot(list[i][0] - p[0], list[i][1] - p[1]) < Math.hypot(list[best][0] - p[0], list[best][1] - p[1])) best = i;
        list.splice(best, 1);
        e.transaction("커브 점 삭제", () => e.doc.layers.find((l) => l.id === layerId).effects[index].params.points = list);
      };
      this.curvePainters.push(paint);
      paint();
    });
  }
  renderLayers() {
    const e = this.engine;
    const depth = (l) => {
      let n = 0;
      while (l.parentId) {
        l = e.doc.layers.find((p) => p.id === l.parentId);
        if (!l) break;
        n++;
      }
      return n;
    };
    this.entry.collapsed ??= /* @__PURE__ */ new Set();
    const ordered = [];
    const visit = (parent) => {
      for (const layer of e.doc.layers.filter((l) => l.parentId === parent).reverse()) {
        ordered.push(layer);
        if (layer.type === "group" && !this.entry.collapsed.has(layer.id)) visit(layer.id);
      }
    };
    visit(null);
    this.root.querySelector(".ed-layers").innerHTML = ordered.map((l) => `<div class="ed-layer ${e.selected.includes(l.id) ? "active" : ""}" draggable="true" data-layer="${l.id}" style="padding-left:${8 + depth(l) * 12}px"><button data-layer-toggle="${l.id}" title="표시">${l.visible ? "◉" : "○"}</button><button data-layer-thumb="${l.id}"><canvas data-thumb="${l.id}" width="36" height="36"></canvas></button>${l.mask ? `<button data-mask-thumb="${l.id}" class="${e.selected[0] === l.id && e.target === "mask" ? "active" : ""}" title="마스크 편집"><canvas data-mask-preview="${l.id}" width="32" height="32"></canvas></button>` : ""}${l.type === "group" ? `<button data-collapse="${l.id}" title="그룹 접기/펼치기">${this.entry.collapsed.has(l.id) ? "▸" : "▾"}</button>` : ""}<span>${escape(l.name)}</span><small>${l.clip ? "↳ " : ""}${l.locked ? "🔒 " : ""}${{ image: "이미지", paint: "페인트", text: "문자", shape: "도형", adjustment: "조정", group: "그룹", path: "패스" }[l.type]}${l.data.generation ? " · AI" : ""}</small></div>`).join("");
    this.root.querySelectorAll("[data-thumb]").forEach((c) => {
      const l = e.doc.layers.find((l2) => l2.id === c.dataset.thumb);
      if (l.type !== "group" && l.type !== "adjustment") c.getContext("2d").drawImage(e.renderer.local(l), 0, 0, 36, 36);
    });
    this.root.querySelectorAll("[data-mask-preview]").forEach((c) => {
      const layer = e.doc.layers.find((l) => l.id === c.dataset.maskPreview), asset = e.assets.get(layer.mask.assetId);
      if (asset) c.getContext("2d").drawImage(asset.canvas, 0, 0, 32, 32);
    });
    this.root.querySelectorAll("[data-layer]").forEach((row) => {
      row.ondragstart = (event) => event.dataTransfer.setData("application/x-editor-layer", row.dataset.layer);
      row.ondragover = (event) => event.preventDefault();
      row.ondrop = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const id = event.dataTransfer.getData("application/x-editor-layer");
        if (id) this.run(() => e.reorder(id, row.dataset.layer, event.shiftKey));
      };
    });
  }
  renderHistory() {
    const e = this.engine;
    this.root.querySelector(".ed-history").innerHTML = [...e.undoStack.map((v, i) => button("history", `${i + 1} · ${escape(v.label)}`, `data-history="${i + 1}"`)), ...e.redoStack.slice().reverse().map((v, i) => button("history", `↪ ${escape(v.label)}`, `data-history="${e.undoStack.length + i + 1}"`))].join("");
  }
  input(event) {
    const el = event.target;
    if(!this.entry)return;
    if (el.classList.contains("ed-foreground")) {
      this.options.color = el.value;
      this.updateOptions();
      return;
    }
    if (el.classList.contains("ed-title")) return;
    const path = el.dataset.field;
    if (!path) return;
    const value = el.type === "checkbox" ? el.checked : el.hasAttribute("data-json") ? null : ["number", "range"].includes(el.type) ? Number(el.value) : el.value;
    if (path.startsWith("option.")) {
      this.options[path.slice(7)] = value;
      return;
    }
    if (path.startsWith("document.")) return;
    if (path.startsWith("layer.") || path.startsWith("transform.")) {
      if (!this.propertyBefore) this.propertyBefore = clone(this.engine.doc);
      const validBefore = clone(this.engine.doc);
      try {
        this.setProperty(path, el.hasAttribute("data-json") ? JSON.parse(el.value) : value);
        validateDocument(this.engine.doc);
        el.setCustomValidity("");
        this.engine.isEditing = true;
        this.engine.renderer.clear();
        this.draw();
      } catch (error) {
        this.engine.doc = validBefore;
        el.setCustomValidity(error.message);
      }
    }
  }
  change(event) {
    const el = event.target, path = el.dataset.field;
    if(!this.entry)return;
    if (path === "document.preset") {
      this.engine.changePreset(el.value);
      this.fit();
      return;
    }
    if (path?.startsWith("layer.") || path?.startsWith("transform.")) {
      if (!this.propertyBefore) return;
      const after = clone(this.engine.doc), before = this.propertyBefore;
      this.propertyBefore = null;
      this.engine.doc = before;
      this.engine.isEditing = false;
      if (!el.checkValidity()) {
        this.notify(el.validationMessage);
        this.engine.emit();
        return;
      }
      try {
        this.engine.transaction("속성 변경", () => this.engine.doc = after);
      } catch (error) {
        this.notify(error.message);
      }
    }
    if (path === "option.anchorIndex") this.renderProperties();
  }
  setProperty(path, value) {
    const l = this.engine.layer();
    if (!l) return;
    if (l.locked && !["layer.locked", "layer.visible"].includes(path)) throw new Error("잠긴 레이어입니다.");
    if (path.startsWith("transform.")) {
      const x = Math.hypot(l.matrix[0], l.matrix[1]), y = Math.hypot(l.matrix[2], l.matrix[3]);
      if (path.endsWith("perspectiveX") || path.endsWith("perspectiveY")) {
        l.data[path.split(".").at(-1)] = clamp(value, -80, 80);
        return;
      }
      if (path.endsWith("skew")) {
        l.matrix[2] = Math.tan(clamp(value, -70, 70) * Math.PI / 180) * l.matrix[3];
        return;
      }
      if (path.endsWith("width")) {
        l.matrix[0] *= Math.max(1, value) / l.width / x;
        l.matrix[1] *= Math.max(1, value) / l.width / x;
        return;
      }
      if (path.endsWith("height")) {
        l.matrix[2] *= Math.max(1, value) / l.height / y;
        l.matrix[3] *= Math.max(1, value) / l.height / y;
        return;
      }
      if (path.endsWith("rotation")) {
        const a = value * Math.PI / 180;
        l.matrix = [Math.cos(a) * x, Math.sin(a) * x, -Math.sin(a) * y, Math.cos(a) * y, l.matrix[4], l.matrix[5]];
      } else if (path.endsWith("scaleX")) {
        l.matrix[0] *= Math.max(0.01, value) / x;
        l.matrix[1] *= Math.max(0.01, value) / x;
      } else {
        l.matrix[2] *= Math.max(0.01, value) / y;
        l.matrix[3] *= Math.max(0.01, value) / y;
      }
      return;
    }
    const keys = path.split(".").slice(1);
    let target = l;
    for (const k of keys.slice(0, -1)) target = target[k] ??= /^[0-9]+$/.test(k) ? [] : {};
    target[keys.at(-1)] = value;
  }
  cancelProperty() {
    if (!this.propertyBefore || !this.entry) return;
    this.engine.doc = this.propertyBefore;
    this.propertyBefore = null;
    this.engine.isEditing = false;
    this.engine.renderer.clear();
    this.engine.emit();
  }
  run(fn) {
    return Promise.resolve().then(fn).catch((error) => {
      this.notify(error.message);
    });
  }
  click(event) {
    const close=event.target.closest("[data-close-entry]");if(close){event.stopPropagation();void this.run(()=>this.closeDocument(this.session.entries[Number(close.dataset.closeEntry)]));return;}
    const tool = event.target.closest("[data-tool]");
    if (tool && this.entry) {
      this.controller.cancel();
      this.tool = tool.dataset.tool;this.session.tool=this.tool;this.notify(TOOL_HELP[this.tool]||"도구를 선택했습니다.");
      this.update();
      return;
    }
    const row = event.target.closest("[data-layer]");
    if (row) {
      const id = row.dataset.layer;
      if (event.target.closest("[data-collapse]")) {
        if (this.entry.collapsed.has(id)) this.entry.collapsed.delete(id);
        else this.entry.collapsed.add(id);
        this.renderLayers();
        return;
      }
      if (event.target.closest("[data-layer-toggle]")) {
        const l = this.engine.doc.layers.find((l2) => l2.id === id);
        this.engine.transaction("레이어 표시", () => l.visible = !l.visible);
      } else {
        this.engine.selected = event.ctrlKey || event.metaKey ? this.engine.selected.includes(id) ? this.engine.selected.filter((v) => v !== id) : [...this.engine.selected, id] : [id];
        this.engine.target = event.target.closest("[data-mask-thumb]") ? "mask" : "pixels";
        this.engine.emit();
      }
      return;
    }
    const tab = event.target.closest("[data-entry]");
    if (tab) {
      this.useEntry(this.session.entries[Number(tab.dataset.entry)]);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (action) {
      if (!action.closest(".ed-inspector")) this.root.querySelectorAll(".ed-menu details").forEach((d) => d.open = false);
      void this.run(() => this.command(action.dataset.action, action.dataset));
    }
  }
  async command(action, data = {}) {
    if(action==='new')return this.newDialog();
    if(action==='recent')return this.recent();
    if(action==='help')return this.dialog('이미지 편집기 도움말',HELP_HTML);
    if(action==='commands')return this.commandPalette();
    if(action==='back'){await this.flushEntries();window.openProjectDetail?.(this.session.projectId,false);return;}
    const e=this.engine;if(!e){this.notify('새 작업을 시작하거나 작업을 불러오세요.');return;}const l=e.layer();
    if(!['apply-transform','cancel-transform','fit','actual','compare','split','panel','grid','guides'].includes(action))this.controller.commitTransform();
    switch (action) {
      case "apply-transform":
        this.controller.commitTransform();
        return;
      case "cancel-transform":
        this.controller.cancel();
        return;
      case 'add-images':return this.imagePicker(true);
      case 'save':return this.saveDocument();
      case 'save-as':return this.saveDocument(true);
      case 'export':return this.exportDialog();
      case 'sample-point':this.options.pickSample=true;this.notify('복사할 위치를 한 번 누른 뒤 수정할 곳을 문지르세요.');return;
      case 'finish-path':this.controller.finishPath();this.draw();return;
      case "undo":
        this.controller.cancel();
        e.history(-1);
        return;
      case "redo":
        this.controller.cancel();
        e.history(1);
        return;
      case "delete":
        e.remove();
        return;
      case "duplicate":
        e.duplicate();
        return;
      case "group":
        e.group();
        return;
      case "ungroup":
        e.ungroup();
        return;
      case "merge":
        e.merge();
        return;
      case "flatten":
        e.selected = e.doc.layers.map((l2) => l2.id);
        e.merge();
        return;
      case "paint":
        e.add("paint");
        return;
      case "mask":
        e.addMask();
        return;
      case "mask-target":
        e.target = "mask";
        e.emit();
        return;
      case "pixels-target":
        e.target = "pixels";
        e.emit();
        return;
      case "mask-invert":
        e.maskOp("invert");
        return;
      case "mask-link":
        e.maskOp("link");
        return;
      case "mask-selection":
        e.maskOp("selection");
        return;
      case "mask-delete":
        e.maskOp("delete");
        e.target = "pixels";
        return;
      case "clip":
        if (l) e.patch({ clip: !l.clip }, "클리핑");
        return;
      case "all":
        e.selectionOp("all");
        return;
      case "deselect":
        e.selectionOp("clear");
        return;
      case "invert":
        e.selectionOp("invert");
        return;
      case "selection-transform":
        return this.transformSelection();
      case "feather":
      case "grow":
      case "shrink":
        return this.numberDialog("선택 경계", 4, (value) => e.selectionOp(action, value));
      case "copy":
        return this.copySelection(false);
      case "copy-merged":
        return this.copySelection(false, true);
      case "cut":
        return this.copySelection(true);
      case "paste":
        return this.paste();
      case "anchor-delete":
        if (l?.type === "path" && l.data.points.length > 2) {
          const points = clone(l.data.points);
          points.splice(Math.min(this.options.anchorIndex || 0, points.length - 1), 1);
          this.options.anchorIndex = 0;
          e.patch({ data: { ...l.data, points } }, "앵커 삭제");
        }
        return;
      case "vector-target":
        if (l?.vectorMask) {
          e.target = "vector";
          this.tool = "pen";
          e.emit();
          this.draw();
        }
        return;
      case "vector-delete":
        if (l) e.patch({ vectorMask: null }, "벡터 마스크 삭제");
        e.target = "pixels";
        return;
      case "vector-selection":
        if (l?.vectorMask) {
          e.selectMask(e.renderer.vectorMask(e.doc, l));
        }
        return;
      case "vector-mask":
        return this.vectorMask();
      case "fit":
        this.fit();
        return;
      case "actual":
        this.zoom(1);
        return;
      case "compare":
        this.compare = !this.compare;
        this.draw();
        return;
      case "split":
        this.split = !this.split;
        this.draw();
        return;
      case "grid":
        this.grid = !this.grid;
        this.draw();
        return;
      case "guides":
        this.guides = !this.guides;
        this.draw();
        return;
      case "panel":
        if (matchMedia("(max-width:740px)").matches) this.root.classList.toggle("ed-panel-open");
        else this.root.classList.toggle("ed-panel-hidden");
        this.saveLayout();
        this.draw();
        return;
      case "layers-tab":
        this.root.querySelector(".ed-layers").hidden = false;
        this.root.querySelector(".ed-history").hidden = true;
        return;
      case "history-tab":
        this.root.querySelector(".ed-layers").hidden = true;
        this.root.querySelector(".ed-history").hidden = false;
        this.renderHistory();
        return;
      case "history": {
        const target = Number(data.history);
        while (e.undoStack.length > target) e.history(-1);
        while (e.undoStack.length < target && e.redoStack.length) e.history(1);
        return;
      }
      case "crop":
        return this.cropDialog();
      case "rotate-doc":
        e.changePreset({ landscape: "portrait", portrait: "landscape", square: "square" }[e.doc.preset], "contain", true);
        this.fit();
        return;
      case "flip-x":
      case "flip-y":
        if (l && !l.locked) e.patch({ matrix: multiply(l.matrix, action === "flip-x" ? [-1, 0, 0, 1, l.width, 0] : [1, 0, 0, -1, 0, l.height]) }, "반전");
        return;
      case "effect":
        return this.addEffect(data.effect);
      case "remove-effect":
        if (l) e.patch({ effects: l.effects.filter((_, i) => i !== Number(data.index)) });
        return;
      case "effect-up":
        if (l) {
          const fx = clone(l.effects), i = Number(data.index);
          if (i > 0) [fx[i - 1], fx[i]] = [fx[i], fx[i - 1]];
          e.patch({ effects: fx });
        }
        return;
      case "effect-down":
        if (l) {
          const effects = clone(l.effects), index = Number(data.index);
          if (index < effects.length - 1) {
            [effects[index], effects[index + 1]] = [effects[index + 1], effects[index]];
            e.patch({ effects }, "효과 순서");
          }
        }
        return;
      case "histogram":
        return this.histogramDialog();
      case "lut":
        return this.loadLut();
      case "replace-image":
        return this.pickFiles(true, true);
      case "subject":
        return this.subject();
      case "auto-background":
        return this.autoBackground();
      case "refine":
        return this.refineMask();
      default:
        if (action.startsWith("align-")) this.align(action.slice(6));
    }
  }
  fit() {
    if (this.destroyed || !this.entry) return;
    const r = this.stage.getBoundingClientRect();
    this.viewport.zoom = Math.min(1, Math.max(0.1, (r.width - 48) / this.engine.doc.width), Math.max(0.1, (r.height - 48) / this.engine.doc.height));
    this.viewport.x = (r.width - this.engine.doc.width * this.viewport.zoom) / 2;
    this.viewport.y = (r.height - this.engine.doc.height * this.viewport.zoom) / 2;
    this.draw();
  }
  zoom(value, p = { x: this.engine.doc.width / 2, y: this.engine.doc.height / 2 }) {
    const old = this.viewport.zoom, next = clamp(value, 0.1, 16);
    this.viewport.x += p.x * (old - next);
    this.viewport.y += p.y * (old - next);
    this.viewport.zoom = next;
    this.draw();
  }
  draw() {
    if (this.destroyed || !this.entry || this.raf || !this.root.isConnected) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.paintView();
    });
  }
  paintView() {
    if (this.destroyed || !this.entry) return;
    const r = this.stage.getBoundingClientRect(), ratio = window.devicePixelRatio || 1, e = this.engine, v = this.viewport;
    for (const c of [this.image, this.overlay]) {
      const w = Math.round(r.width * ratio), h = Math.round(r.height * ratio);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
    }
    const ctx = this.image.getContext("2d");
    ctx.resetTransform();
    ctx.clearRect(0, 0, this.image.width, this.image.height);
    ctx.scale(ratio, ratio);
    ctx.translate(v.x, v.y);
    ctx.scale(v.zoom, v.zoom);
    ctx.fillStyle = this.palette.checkerBase;
    ctx.fillRect(0, 0, e.doc.width, e.doc.height);
    const tile = 16;
    ctx.fillStyle = this.palette.checkerAlt;
    for (let y = 0; y < e.doc.height; y += tile) for (let x = 0; x < e.doc.width; x += tile) if ((x / tile + y / tile) % 2 === 0) ctx.fillRect(x, y, tile, tile);
    const rendered = e.renderer.render(e.doc, { original: this.compare });
    ctx.drawImage(rendered, 0, 0);
    if (this.split) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, e.doc.width / 2, e.doc.height);
      ctx.clip();
      ctx.clearRect(0, 0, e.doc.width / 2, e.doc.height);
      ctx.drawImage(e.renderer.render(e.doc, { original: true }), 0, 0);
      ctx.restore();
    }
    const oc = this.overlay.getContext("2d");
    oc.resetTransform();
    oc.clearRect(0, 0, this.overlay.width, this.overlay.height);
    oc.scale(ratio, ratio);
    oc.translate(v.x, v.y);
    oc.scale(v.zoom, v.zoom);
    oc.lineWidth = 1.5 / v.zoom;
    oc.strokeStyle = this.palette.accent;
    oc.setLineDash([5 / v.zoom, 4 / v.zoom]);
    if (e.selection) {
      const tint = copy(e.selection), tc = tint.getContext("2d");
      tc.globalCompositeOperation = "source-in";
      tc.fillStyle = this.palette.selection;
      tc.fillRect(0, 0, tint.width, tint.height);
      oc.drawImage(tint, 0, 0);
    }
    this.handles = [];
    for (const l of e.doc.layers.filter((l2) => e.selected.includes(l2.id))) {
      const m = worldMatrix(e.doc, l), corners = [point(m, { x: 0, y: 0 }), point(m, { x: l.width, y: 0 }), point(m, { x: l.width, y: l.height }), point(m, { x: 0, y: l.height })];
      oc.beginPath();
      corners.forEach((p) => oc.lineTo(p.x, p.y));
      oc.closePath();
      oc.stroke();
      if (l.id === e.selected[0]) {
        const rotate = point(m, { x: l.width / 2, y: -28 / v.zoom }), scale = corners[2];
        this.handles = [{ kind: "scale", ...scale }, { kind: "rotate", ...rotate }];
        if (this.tool === "warp") this.handles = Array.from({ length: 9 }, (_, i) => ({ kind: "warp", index: i, ...point(m, { x: i % 3 / 2 * l.width + (l.data.warp?.[i]?.x || 0), y: Math.floor(i / 3) / 2 * l.height + (l.data.warp?.[i]?.y || 0) }) }));
        if (this.tool === "pen" && (l.type === "path" || e.target === "vector" && l.vectorMask)) {
          this.handles = (e.target === "vector" ? l.vectorMask.points : l.data.points).flatMap((p, index) => [{ kind: "anchor", component: "point", index, ...point(m, p) }, { kind: "anchor", component: "in", index, ...point(m, { x: p.x + (p.inX || 0), y: p.y + (p.inY || 0) }) }, { kind: "anchor", component: "out", index, ...point(m, { x: p.x + (p.outX || 0), y: p.y + (p.outY || 0) }) }]);
          oc.setLineDash([]);
          for (let i = 0; i < this.handles.length; i += 3) {
            oc.beginPath();
            oc.moveTo(this.handles[i + 1].x, this.handles[i + 1].y);
            oc.lineTo(this.handles[i].x, this.handles[i].y);
            oc.lineTo(this.handles[i + 2].x, this.handles[i + 2].y);
            oc.stroke();
          }
        }
        for (const h of this.handles) {
          oc.fillStyle = this.palette.handle;
          oc.fillRect(h.x - 4 / v.zoom, h.y - 4 / v.zoom, 8 / v.zoom, 8 / v.zoom);
        }
      }
    }
    const d = this.controller.drag;
    if (d?.start && d.end) {
      oc.setLineDash([]);
      oc.strokeRect(d.start.x, d.start.y, d.end.x - d.start.x, d.end.y - d.start.y);
    }
    if (this.controller.path.length) {
      oc.beginPath();
      for (const p of this.controller.path) oc.lineTo(p.x, p.y);
      oc.stroke();
    }
    if (this.guides) {
      oc.setLineDash([4 / v.zoom, 4 / v.zoom]);
      oc.beginPath();
      oc.moveTo(e.doc.width / 2, 0);
      oc.lineTo(e.doc.width / 2, e.doc.height);
      oc.moveTo(0, e.doc.height / 2);
      oc.lineTo(e.doc.width, e.doc.height / 2);
      oc.stroke();
    }
    if (this.grid && v.zoom >= 4) {
      oc.lineWidth = 0.3 / v.zoom;
      oc.setLineDash([]);
      oc.beginPath();
      for (let x = 0; x <= e.doc.width; x++) {
        oc.moveTo(x, 0);
        oc.lineTo(x, e.doc.height);
      }
      for (let y = 0; y <= e.doc.height; y++) {
        oc.moveTo(0, y);
        oc.lineTo(e.doc.width, y);
      }
      oc.stroke();
    }
    if (this.cursor && ["brush", "eraser", "clone", "heal", "patch", "dodge", "burn", "smudge", "blur-brush", "sharpen-brush"].includes(this.tool)) {
      oc.setLineDash([]);
      oc.beginPath();
      oc.arc(this.cursor.x, this.cursor.y, this.options.size / 2, 0, Math.PI * 2);
      oc.stroke();
    }
    if (this.cursor && ["brush", "eraser", "clone", "heal", "dodge", "burn", "smudge", "blur-brush", "sharpen-brush", "liquify"].includes(this.tool)) {
      oc.setLineDash([]);
      oc.lineWidth = 1 / v.zoom;
      oc.strokeStyle = this.palette.cursor;
      oc.beginPath();
      oc.arc(this.cursor.x, this.cursor.y, this.options.size / 2, 0, Math.PI * 2);
      oc.stroke();
    }
    if (this.snapLines) {
      oc.strokeStyle = this.palette.guide;
      oc.setLineDash([3 / v.zoom, 3 / v.zoom]);
      oc.beginPath();
      if (this.snapLines.x != null) {
        oc.moveTo(this.snapLines.x, 0);
        oc.lineTo(this.snapLines.x, e.doc.height);
      }
      if (this.snapLines.y != null) {
        oc.moveTo(0, this.snapLines.y);
        oc.lineTo(e.doc.width, this.snapLines.y);
      }
      oc.stroke();
    }
    const nav = this.root.querySelector(".ed-navigator");
    nav.getContext("2d").clearRect(0, 0, 96, 64);
    nav.getContext("2d").drawImage(rendered, 0, 0, 96, 64);
    this.root.querySelector(".ed-document-info").textContent = `${Math.round(v.zoom * 100)}% · ${e.doc.width}×${e.doc.height} · ${e.dirty ? "미저장 변경" : e.everSaved ? "저장됨" : "편집 전"}`;
  }
  handleAt(p) {
    return this.handles?.find((h) => Math.hypot(h.x - p.x, h.y - p.y) < 10 / this.viewport.zoom);
  }
  key(event){
    if(this.destroyed||!this.root.isConnected||!this.root.getClientRects().length||event.isComposing||document.querySelector('.ed-dialog[open]'))return;
    const text=event.target.closest('input,textarea,select,[contenteditable]'),mod=event.ctrlKey||event.metaKey,k=event.key.toLowerCase();
    if(event.key==='Escape')this.root.querySelectorAll('.ed-menu details[open]').forEach(menu=>menu.open=false);
    if(mod&&['s','o'].includes(k)){event.preventDefault();if(k==='s'&&text){event.target.blur();}void this.run(()=>this.command(k==='o'?'recent':event.shiftKey?'save-as':'save'));return;}
    if(text)return;
    if(mod&&k==='v')return;
    if(mod){const action={z:event.shiftKey?'redo':'undo',y:'redo',c:event.shiftKey?'copy-merged':'copy',x:'cut',a:'all',d:'deselect',j:'duplicate',w:'close-document'}[k];if(action){event.preventDefault();void this.run(()=>action==='close-document'?this.closeDocument():this.command(action));}return;}
    if(event.key==='?'){event.preventDefault();void this.command('help');return;}
    if(!this.entry)return;
    if(event.code==='Space'){event.preventDefault();this.controller.space=true;return;}
    if(event.key==='Escape'){this.controller.cancel();return;}
    if(event.key==='Enter'){this.controller.commitTransform();this.controller.finishPath();return;}
    const tool={v:'move',b:'brush',e:'eraser',m:'rect-select',l:'lasso',t:'text',i:'eyedropper',h:'hand',p:'pen'}[k];
    if(tool){event.preventDefault();this.controller.cancel();this.tool=tool;this.session.tool=tool;this.update();this.notify(TOOL_HELP[tool]);}
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();this.engine.remove();}
    if(event.key==='['||event.key===']'){this.options.size=clamp(this.options.size+(event.key==='['?-2:2),1,240);this.updateOptions();}
  }

  saveLayout() {
    const panel = this.root.querySelector(".ed-inspector");
    try {
      localStorage.setItem("imggul-editor-layout", JSON.stringify({ hidden: this.root.classList.contains("ed-panel-hidden"), width: panel.style.width, propertyHeight: panel.style.getPropertyValue("--ed-prop-height") }));
    } catch {
    }
  }
  restoreLayout() {
    try {
      const layout = JSON.parse(localStorage.getItem("imggul-editor-layout") || "{}"), panel = this.root.querySelector(".ed-inspector");
      this.root.classList.toggle("ed-panel-hidden", !!layout.hidden);
      if (/^\d+px$/.test(layout.width || "")) panel.style.width = layout.width;
      if (/^\d+px$/.test(layout.propertyHeight || "")) panel.style.setProperty("--ed-prop-height", layout.propertyHeight);
    } catch {
    }
  }
  bindResize() {
    const handle = this.root.querySelector(".ed-resizer");
    let active = false;
    handle.addEventListener("pointerdown", (event) => {
      active = true;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", (event) => {
      if (active) {
        const top = this.root.querySelector(".ed-inspector").getBoundingClientRect().top;
        this.root.querySelector(".ed-inspector").style.setProperty("--ed-prop-height", `${clamp(event.clientY - top, 100, this.stage.clientHeight - 160)}px`);
      }
    });
    handle.addEventListener("pointerup", () => {
      active = false;
      this.saveLayout();
    });
    handle.addEventListener("pointercancel", () => active = false);
    const widthHandle = this.root.querySelector(".ed-width-resizer");
    let widthDrag = null;
    widthHandle.addEventListener("pointerdown", (event) => {
      widthDrag = { x: event.clientX, width: this.root.querySelector(".ed-inspector").getBoundingClientRect().width };
      widthHandle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    widthHandle.addEventListener("pointermove", (event) => {
      if (widthDrag) this.root.querySelector(".ed-inspector").style.width = `${clamp(widthDrag.width + widthDrag.x - event.clientX, 250, 400)}px`;
    });
    widthHandle.addEventListener("pointerup", () => {
      widthDrag = null;
      this.saveLayout();
    });
    widthHandle.addEventListener("pointercancel", () => widthDrag = null);
    this.root.querySelector(".ed-navigator").onclick = (event) => {
      const r = event.currentTarget.getBoundingClientRect();
      this.viewport.x = this.stage.clientWidth / 2 - (event.clientX - r.left) / r.width * this.engine.doc.width * this.viewport.zoom;
      this.viewport.y = this.stage.clientHeight / 2 - (event.clientY - r.top) / r.height * this.engine.doc.height * this.viewport.zoom;
      this.draw();
    };
  }
  bindTouch() {
    const fingers = /* @__PURE__ */ new Map(), signal = this.abort.signal;
    const center = () => {
      const values = [...fingers.values()];
      return { x: (values[0].x + values[1].x) / 2, y: (values[0].y + values[1].y) / 2, distance: Math.max(1, Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y)) };
    };
    this.overlay.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") return;
      if(this.controller?.pointerType==="pen"&&this.controller.pointerId!==null){event.preventDefault();event.stopImmediatePropagation();return;}
      if(!this.entry)return;
      fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (fingers.size === 2) {
        this.controller.cancel();
        const c = center(), r = this.stage.getBoundingClientRect();
        this.pinch = { ...c, zoom: this.viewport.zoom, anchor: { x: (c.x - r.left - this.viewport.x) / this.viewport.zoom, y: (c.y - r.top - this.viewport.y) / this.viewport.zoom } };
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, { signal, capture: true });
    this.overlay.addEventListener("pointermove", (event) => {
      if (!fingers.has(event.pointerId)) return;
      fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pinch && fingers.size >= 2) {
        const c = center(), r = this.stage.getBoundingClientRect(), zoom = clamp(this.pinch.zoom * c.distance / this.pinch.distance, 0.1, 16);
        this.viewport = { zoom, x: c.x - r.left - this.pinch.anchor.x * zoom, y: c.y - r.top - this.pinch.anchor.y * zoom };
        event.preventDefault();
        event.stopImmediatePropagation();
        this.draw();
      }
    }, { signal, capture: true });
    const end = (event) => {
      fingers.delete(event.pointerId);
      if (this.pinch) {
        this.pinch = null;
        this.controller.cancel();
        event.stopImmediatePropagation();
      }
    };
    this.overlay.addEventListener("pointerup", end, { signal, capture: true });
    this.overlay.addEventListener("pointercancel", end, { signal, capture: true });
  }
  dialog(title,content,bind){
    if(this.destroyed)throw new Error('편집 화면이 닫혔습니다.');
    const d=document.createElement('dialog');d.className='ed-dialog';this.dialogs??=new Set();this.dialogs.add(d);
    d.innerHTML=`<header><h2>${escape(title)}</h2><button type="button" data-close aria-label="닫기">×</button></header><div class="ed-dialog-content">${content}<div class="ed-dialog-status" role="status" aria-live="polite"></div></div>`;
    document.body.appendChild(d);d.querySelector('[data-close]').onclick=()=>d.close();
    d.addEventListener('close',()=>{this.dialogs.delete(d);d.remove();},{once:true});d.showModal();bind?.(d);return d;
  }

  numberDialog(title, value, commit) {
    this.dialog(title, `<form><label>값<input name="value" type="number" min="0" max="30" value="${value}"></label><button>적용</button></form>`, (d) => d.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      commit(Number(new FormData(event.currentTarget).get("value")));
      d.close();
    });
  }
  async flushEntries(){await Promise.allSettled(this.session.entries.map(entry=>entry.persistence.flush()));}
  projectLabel(){return window.getAliasOnly?.(this.session.prefix,true)||(window.PROJECTS||[]).find(p=>p.id===this.session.projectId)?.name||'현재 프로젝트';}
  folderLabel(prefix){const root=this.projectLabel();if(prefix===this.session.prefix)return root;const tail=prefix.slice(this.session.prefix.length).split('/').filter(Boolean);let path=this.session.prefix;return[root,...tail.map(part=>{path+=part+'/';return window.getAliasOnly?.(path,true)||part;})].join(' / ');}
  parentFolder(prefix){const parent=prefix.split('/').filter(Boolean).slice(0,-1).join('/')+'/';return parent.startsWith(this.session.prefix)?parent:this.session.prefix;}
  adoptEntry(entry){if(this.session.entries.length>=8){entry.persistence.stop();entry.engine.destroy();throw new Error('열린 작업은 최대 8개입니다.');}this.session.entries.push(entry);entry.started=true;this.useEntry(entry);}
  choose(title,message,buttons){return new Promise(resolve=>{let choice='cancel';const d=this.dialog(title,`<p>${escape(message)}</p><div class="ed-choice-actions">${buttons.map(([id,label])=>`<button data-choice="${id}" type="button">${escape(label)}</button>`).join('')}</div>`,dialog=>dialog.querySelectorAll('[data-choice]').forEach(button=>button.onclick=()=>{choice=button.dataset.choice;dialog.close();}));d.addEventListener('close',()=>resolve(choice),{once:true});});}
  async saveDocument(saveAs=false,entry=this.entry){
    if(!entry)throw new Error('먼저 새 작업을 시작하세요.');
    if(entry===this.entry)this.controller.commitTransform();
    if(!saveAs&&entry.engine.everSaved){await entry.persistence.save();this.notify('작업 저장됨');return true;}
    return new Promise(resolve=>{let completed=false;const d=this.dialog(saveAs?'다른 이름으로 저장':'작업 저장',`<form><label>작업 이름<input name="title" maxlength="200" value="${escape(entry.engine.doc.title==='제목 없음'?'':entry.engine.doc.title)}" placeholder="예: 캐릭터 표정 보정" required></label><p>저장 위치: ${escape(this.projectLabel())} / 편집 작업</p><p>레이어와 마스크를 보존합니다. 이미지 파일은 이미지 내보내기로 만듭니다.</p><button type="submit" class="ed-primary">작업 저장</button></form>`,dialog=>dialog.querySelector('form').onsubmit=event=>{event.preventDefault();const form=event.currentTarget,title=new FormData(form).get('title').trim();if(!title)return;void this.run(async()=>{const submit=form.querySelector('button');submit.disabled=true;dialog.querySelector('[data-close]').disabled=true;dialog.oncancel=event=>event.preventDefault();try{this.notify('작업 저장 중…',dialog);if(saveAs)await entry.persistence.saveAs(title);else await entry.persistence.save(title);completed=true;dialog.close();resolve(true);this.update();}finally{submit.disabled=false;dialog.querySelector('[data-close]').disabled=false;dialog.oncancel=null;}});});d.addEventListener('close',()=>{if(!completed)resolve(false);},{once:true});});
  }
  newDialog(){return this.imagePicker(false);}

  async pickFiles(add=false,replace=false){
    const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.multiple=add&&!replace;
    input.onchange=()=>void this.run(async()=>{
      if(!input.files.length)return;
      if(replace){const entry=this.entry,layer=entry?.engine.layer();if(layer?.type!=='image'||layer.locked)throw new Error('잠기지 않은 이미지 레이어를 선택하세요.');const stage=new EditorEngine();try{const added=await stage.addImage(input.files[0]);const c=copy(stage.assets.get(added.data.assetId).canvas);entry.engine.patch({data:{...layer.data,assetId:entry.engine.register(c)},width:c.width,height:c.height},'이미지 교체');}finally{stage.destroy();}}
      else await this.importFiles(input.files,add);
    });input.click();
  }

  async importFiles(files,add,guard=()=>!this.destroyed){
    const list=[...files];if(!list.length)return;
    let entry=add?this.entry:null;
    if(!entry){entry=entryFor(this.session,'square',false);try{await entry.engine.addImage(list.shift(),{original:true,guard});entry.engine.doc.title='제목 없음';entry.engine.baseline();this.adoptEntry(entry);}catch(error){entry.persistence.stop();entry.engine.destroy();throw error;}}
    for(const file of list)await entry.engine.addImage(file,{guard});
    if(this.entry===entry)this.fit();
  }

  async openKey(key,add,guard=()=>!this.destroyed){
    this.notify('이미지 불러오는 중…');const response=await fetch('/i/'+key.split('/').map(encodeURIComponent).join('/'),{cache:'no-store'});if(!response.ok)throw new Error('이미지를 불러오지 못했습니다.');
    const blob=await response.blob();
    if(!guard())throw new Error('이미지 불러오기가 취소되었습니다.');
    if(add&&this.entry){await this.engine.addImage(blob,{guard});this.fit();return;}
    const entry=entryFor(this.session,'square',false);try{await entry.engine.addImage(blob,{original:true,key,guard});entry.engine.doc.title='제목 없음';entry.engine.baseline();this.adoptEntry(entry);}catch(error){entry.persistence.stop();entry.engine.destroy();throw error;}
  }

  async imagePicker(add=false){
    if(add&&!this.entry)throw new Error('먼저 새 작업을 시작하세요.');
    const d=this.dialog(add?'현재 작업에 이미지 불러오기':'새 작업',`<p>${add?'이미지를 현재 작업의 새 레이어로 배치합니다.':'이미지로 시작하거나 빈 캔버스를 만드세요. 파일 선택을 취소하면 작업을 만들지 않습니다.'}</p><div class="ed-source-actions"><button type="button" data-local>내 기기 이미지 선택</button>${!add?`<details><summary>빈 캔버스로 시작</summary>${Object.entries(PRESETS).map(([id,size])=>`<button data-blank="${id}">${{landscape:'가로형',square:'정사각형',portrait:'세로형'}[id]} ${size.join('×')} px</button>`).join('')}</details>`:''}</div><h3>프로젝트 이미지에서 선택</h3><nav class="ed-library-path"></nav><input class="ed-search" type="search" placeholder="별명 · 파일 이름 검색" aria-label="이미지 검색"><div class="ed-library"></div>`);
    let prefix=this.session.prefix,records=[],loadVersion=0;
    const grid=d.querySelector('.ed-library');
    const filter=()=>{const q=d.querySelector('.ed-search').value.toLocaleLowerCase();for(const record of records)record.element.hidden=!record.search.includes(q);};
    const load=async()=>{
      const version=++loadVersion;this.notify('폴더와 이미지를 불러오는 중…',d);grid.replaceChildren();records=[];
      const response=await fetch(`/api/list?prefix=${encodeURIComponent(prefix)}`,{cache:'no-store'});if(!response.ok)throw new Error('프로젝트 목록을 불러오지 못했습니다.');const result=await response.json();if(!d.open||version!==loadVersion)return;
      d.querySelector('.ed-library-path').textContent=this.folderLabel(prefix);
      if(prefix!==this.session.prefix)grid.appendChild(createAssetParentCard(()=>{prefix=this.parentFolder(prefix);void this.run(load);}));
      for(const folder of (result.folders||[]).filter(path=>!path.split('/').some(part=>part.startsWith('__')))){
        const raw=folder.split('/').filter(Boolean).at(-1),alias=window.getAliasOnly?.(folder,true)||'',image=getSelectionFolderImage(folder);
        const element=createAssetFolderCard({folderName:raw,alias,image,onClick:()=>{prefix=folder;void this.run(load);}});grid.appendChild(element);records.push({element,search:`${alias} ${raw}`.toLocaleLowerCase()});
      }
      for(const file of (result.files||[]).filter(file=>/\.(png|jpe?g|webp)$/i.test(file.key))){
        const raw=file.key.split('/').at(-1),alias=getSelectionFileAlias(file.key);
        const element=createAssetImageCard({fileName:raw,alias,fileUrl:'/i/'+file.key.split('/').map(encodeURIComponent).join('/'),onClick:()=>void this.run(async()=>{element.disabled=true;try{await this.openKey(file.key,add,()=>d.open&&!this.destroyed);d.close();}finally{element.disabled=false;}})});grid.appendChild(element);records.push({element,search:`${alias} ${raw}`.toLocaleLowerCase()});
      }
      this.notify(records.length?'이미지를 선택하세요.':'이 폴더에는 불러올 이미지가 없습니다.',d);filter();
    };
    d.querySelector('[data-local]').onclick=()=>{const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp';input.multiple=add;input.onchange=()=>{if(!input.files.length)return;void this.run(async()=>{this.notify('이미지 불러오는 중…',d);await this.importFiles(input.files,add,()=>d.open&&!this.destroyed);d.close();});};input.click();};
    d.querySelectorAll('[data-blank]').forEach(button=>button.onclick=()=>{const entry=entryFor(this.session,button.dataset.blank);entry.started=true;this.useEntry(entry);d.close();});d.querySelector('.ed-search').oninput=filter;await load();
  }

  async recent(){
    const d=this.dialog('작업 불러오기',`<p>저장 위치: R2 · ${escape(this.projectLabel())} / 편집 작업</p><div class="ed-source-actions"><button data-kind="saved">저장한 작업</button><button data-kind="autosave">임시 편집 이어하기</button></div><div class="ed-work-list"></div><details><summary>이전 편집기 테스트 데이터 정리</summary><p>이전 편집기의 작업·복구본·백업을 삭제합니다. 현재 버전의 작업과 원본 이미지는 유지합니다.</p><label><input type="checkbox" data-outputs>이전 편집기가 만든 출력 이미지도 포함</label><button data-inspect>삭제 대상 확인</button><div data-inventory></div></details>`);
    let kind='saved',loadVersion=0;const projectId=encodeURIComponent(this.session.projectId);
    const load=async()=>{
      const version=++loadVersion;d.querySelector('.ed-work-list').replaceChildren();d.querySelectorAll('[data-kind]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.kind===kind)));
      this.notify('작업 목록을 불러오는 중…',d);const result=await api(`/documents?projectId=${projectId}&kind=${kind}`);if(!d.open||version!==loadVersion)return;
      const list=d.querySelector('.ed-work-list');list.replaceChildren();
      for(const row of result.documents){
        if(!row.id)continue;const item=document.createElement('div');item.className='ed-work-row';
        const query=new URLSearchParams({projectId:this.session.projectId,kind,...(row.sessionId?{sessionId:row.sessionId}:{})});
        item.innerHTML=`<button data-open><img class="ed-recent-preview" loading="lazy" src="/api/editor/v2/documents/${row.id}/preview?${query}" alt=""><span>${escape(row.title)}<small>${escape(new Date(row.updatedAt).toLocaleString())}</small></span></button><button data-delete aria-label="${escape(row.title)} 삭제">삭제</button>`;
        item.querySelector('[data-open]').onclick=()=>void this.run(async()=>{
          const opened=this.session.entries.find(entry=>entry.engine.doc.id===row.id);
          if(opened){this.useEntry(opened);d.close();this.notify('이미 열려 있는 작업으로 이동했습니다.');return;}
          const entry=entryFor(this.session,'square',false);try{await entry.persistence.open(row);if(!d.open||this.destroyed)throw new Error('작업 불러오기가 취소되었습니다.');this.adoptEntry(entry);d.close();}catch(error){entry.persistence.stop();entry.engine.destroy();throw error;}
        });
        item.querySelector('[data-delete]').onclick=()=>void this.run(async()=>{
          const answer=await this.choose('작업 삭제',`“${row.title}”${kind==='saved'?'와 연결된 임시 편집':' 임시 편집'}을 삭제합니다. 원본·내보낸 이미지는 유지합니다.`,[['delete','삭제'],['cancel','취소']]);if(answer!=='delete')return;
          const opened=this.session.entries.filter(entry=>entry.engine.doc.id===row.id&&(kind==='saved'||entry.persistence.sessionId===row.sessionId));
          for(const entry of opened){if(!await this.closeDocument(entry,true))return;}
          await api(`/documents/${row.id}?${query}`,{method:'DELETE'});this.notify('작업과 전용 이미지 자산을 삭제했습니다.',d);await load();
        });list.appendChild(item);
      }
      if(!list.children.length)list.textContent=kind==='saved'?'저장한 작업이 없습니다.':'이어할 임시 편집이 없습니다.';
      this.notify(kind==='saved'?'작업 저장은 레이어와 편집 정보를 보존합니다.':'임시 저장: 프로젝트당 10개 · 256 MiB · 마지막 저장 후 7일. 정식 저장과 구분됩니다.',d);
    };
    d.querySelector('[data-inspect]').onclick=()=>void this.run(async()=>{
      const includeOutputs=d.querySelector('[data-outputs]').checked;const inventory=await api('/maintenance/legacy?includeOutputs='+(includeOutputs?'1':'0'));
      const box=d.querySelector('[data-inventory]');box.innerHTML=`<p>${inventory.count}개 · ${(inventory.bytes/1048576).toFixed(1)} MiB</p><pre>${escape(inventory.keys.join('\n')||'삭제 대상 없음')}</pre><button data-clean ${inventory.count?'':'disabled'}>확인한 대상 모두 삭제</button>`;
      box.querySelector('[data-clean]').onclick=()=>void this.run(async()=>{if(await this.choose('이전 데이터 영구 삭제','확인한 이전 편집기 데이터를 삭제합니다. 되돌릴 수 없습니다.',[['delete','영구 삭제'],['cancel','취소']])!=='delete')return;const result=await api('/maintenance/legacy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:inventory.token,includeOutputs})});box.textContent=`${result.deleted}개 삭제됨`;this.notify('이전 데이터 정리 완료',d);});
    });d.querySelectorAll('[data-kind]').forEach(button=>button.onclick=()=>{kind=button.dataset.kind;void this.run(load);});await load();
  }

  addText(p) {
    this.dialog("텍스트 추가", '<form><textarea name="text" rows="5" placeholder="여러 줄 텍스트" required></textarea><button>레이어로 추가</button></form>', (d) => d.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      const text = new FormData(event.currentTarget).get("text"), l = newLayer("text", Math.min(600, this.engine.doc.width), Math.min(400, this.engine.doc.height), { text, font: "Noto Sans KR", size: 40, color: this.options.color, lineHeight: 1.4, align: "left" });
      l.matrix[4] = p.x;
      l.matrix[5] = p.y;
      l.opacity = this.options.opacity;
      this.engine.transaction("텍스트 추가", () => this.engine.doc.layers.push(l));
      this.engine.selected = [l.id];
      this.engine.emit();
      d.close();
    });
  }
  cropDialog() {
    const region = this.cropRegion;
    this.dialog("구도·출력 규격", `<form><label>규격<select name="preset">${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}" ${k === this.engine.doc.preset ? "selected" : ""}>${v.join("×")}</option>`).join("")}</select></label><label>맞추기<select name="mode"><option value="contain">전체 포함 · 여백</option><option value="cover">화면 채우기 · 넘침 숨김</option></select></label><p>${region ? "드래그한 영역을 새 구도로 사용합니다." : "현재 이미지 전체를 새 규격에 맞춥니다."}</p><button>적용</button></form>`, (d) => d.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget), preset = form.get("preset"), mode = form.get("mode");
      if (region) {
        const [w, h] = PRESETS[preset], s = (mode === "cover" ? Math.max : Math.min)(w / region.width, h / region.height), m = [s, 0, 0, s, (w - region.width * s) / 2 - region.x * s, (h - region.height * s) / 2 - region.y * s];
        this.engine.transaction("영역 크롭", () => {
          for (const l of this.engine.doc.layers) {
            if (!l.parentId) l.matrix = multiply(m, l.matrix);
            if (l.mask?.linked === false) l.mask.matrix = multiply(m, l.mask.matrix);
          }
          this.engine.doc.preset = preset;
          this.engine.doc.width = w;
          this.engine.doc.height = h;
        });
        this.engine.selection = null;
      } else this.engine.changePreset(preset, mode);
      this.cropRegion = null;
      this.fit();
      d.close();
    });
  }
  addEffect(type) {
    const e = this.engine, effect = { id: uid(), type, enabled: true, params: Object.fromEntries((PARAMS[type] || []).map(([key, , value]) => [key, value])) };
    if (type === "curves") effect.params.points = [[0, 0], [255, 255]];
    const layer = newLayer("adjustment", e.doc.width, e.doc.height);
    layer.name = EFFECTS.find((v) => v[0] === type)?.[1] || type;
    layer.effects = [effect];
    if (e.selection) layer.mask = { assetId: e.register(copy(e.selection)), enabled: true, linked: true, density: 1, feather: 0 };
    e.transaction("보정/효과 추가", () => e.doc.layers.push(layer));
    e.selected = [layer.id];
    e.target = layer.mask ? "mask" : "pixels";
    e.emit();
  }
  histogramDialog() {
    const bins = histogram(this.engine.renderer.render(this.engine.doc)), max = Math.max(...bins, 1);
    this.dialog("밝기 히스토그램", `<svg viewBox="0 0 256 120" aria-label="밝기 분포"><polyline class="ed-histogram-line" fill="none" points="${Array.from(bins, (v, i) => `${i},${120 - v / max * 115}`).join(" ")}"/></svg>`);
  }
  async loadLut() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".cube";
    input.onchange = () => {
      void this.run(async () => {
        const file = input.files[0];
        if (file.size > 3 * 1024 * 1024) throw new Error("LUT 파일이 너무 큽니다.");
        const lut = parseCube(await file.text()), l = this.engine.add("adjustment");
        this.engine.patch({ name: file.name, effects: [{ id: uid(), type: "lut", enabled: true, params: {}, lut }] });
      });
    };
    input.click();
  }
  align(mode) {
    const e = this.engine;
    e.transaction("레이어 정렬", () => {
      for (const id of e.selected) {
        const l = e.doc.layers.find((l2) => l2.id === id);
        if (!l || l.locked) continue;
        const m = worldMatrix(e.doc, l), corners = [point(m, { x: 0, y: 0 }), point(m, { x: l.width, y: 0 }), point(m, { x: 0, y: l.height }), point(m, { x: l.width, y: l.height })], xs = corners.map((p) => p.x), ys = corners.map((p) => p.y), minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        let dx = 0, dy = 0;
        if (mode === "left") dx = -minX;
        if (mode === "center") dx = (e.doc.width - minX - maxX) / 2;
        if (mode === "right") dx = e.doc.width - maxX;
        if (mode === "top") dy = -minY;
        if (mode === "middle") dy = (e.doc.height - minY - maxY) / 2;
        if (mode === "bottom") dy = e.doc.height - maxY;
        const parent = e.doc.layers.find((p) => p.id === l.parentId), inv = parent ? inverse(worldMatrix(e.doc, parent)) : identity();
        l.matrix = multiply(inv, multiply([1, 0, 0, 1, dx, dy], m));
      }
    });
  }
  transformSelection() {
    const e = this.engine;
    if (!e.selection) throw new Error("먼저 영역을 선택하세요.");
    const original = copy(e.selection);
    this.dialog("선택 영역 변형", '<form><label>X 이동<input name="x" type="number" value="0"></label><label>Y 이동<input name="y" type="number" value="0"></label><label>가로 배율<input name="sx" type="number" value="1" min="0.01" max="10" step="0.05"></label><label>세로 배율<input name="sy" type="number" value="1" min="0.01" max="10" step="0.05"></label><label>회전 °<input name="angle" type="number" value="0"></label><button>적용</button></form>', (dialog) => dialog.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget)), result = canvas(e.doc.width, e.doc.height), ctx = result.getContext("2d");
      ctx.translate(e.doc.width / 2 + Number(data.x), e.doc.height / 2 + Number(data.y));
      ctx.rotate(Number(data.angle) * Math.PI / 180);
      ctx.scale(Number(data.sx), Number(data.sy));
      ctx.drawImage(original, -original.width / 2, -original.height / 2);
      e.selectMask(result);
      dialog.close();
    });
  }
  async copySelection(cut, merged = false) {
    const e = this.engine, l = e.layer();
    let c = e.renderer.render(e.doc, merged || !l ? {} : { onlyLayerId: l.id });
    if (e.selection) {
      const ctx = c.getContext("2d");
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(e.selection, 0, 0);
    }
    clipboard = { canvas: c, width: c.width, height: c.height };
    let system=false;
    if(navigator.clipboard?.write&&window.ClipboardItem){try{await navigator.clipboard.write([new ClipboardItem({'image/png':blobOf(c)})]);system=true;}catch{}}
    if (cut) {
      if(this.engine!==e||this.destroyed)throw new Error('복사하는 동안 작업이 바뀌었습니다. 잘라내기를 다시 실행하세요.');
      if (!l || !["paint", "image"].includes(l.type)) throw new Error("이미지 또는 페인트 레이어를 선택하세요.");
      if (l.locked && !l.data.original) throw new Error("잠긴 레이어입니다.");
      if (l.type === "paint" && !l.locked) {
        const a = e.assets.get(l.data.assetId).canvas, ctx = a.getContext("2d"), before = ctx.getImageData(0, 0, a.width, a.height);
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.setTransform(...inverse(worldMatrix(e.doc, l)));
        ctx.drawImage(e.selection || this.solidMask(), 0, 0);
        ctx.restore();
        e.pixelCommand("선택 잘라내기", l.data.assetId, before, ctx.getImageData(0, 0, a.width, a.height));
      } else {
        const target = l.locked ? clone(l) : l, mask = l.mask ? copy(e.assets.get(l.mask.assetId).canvas) : canvas(l.width, l.height), ctx = mask.getContext("2d");
        if (!l.mask) {
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, mask.width, mask.height);
        }
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.setTransform(...inverse(l.mask?.linked === false ? l.mask.matrix : worldMatrix(e.doc, l)));
        ctx.drawImage(e.selection || this.solidMask(), 0, 0);
        ctx.restore();
        const assetId = e.register(mask);
        e.transaction("선택 잘라내기 · 마스크", () => {
          if (l.locked) {
            target.id = uid();
            target.name += " 잘라내기";
            target.locked = false;
            target.data.original = false;
            e.doc.layers.push(target);
            l.visible = false;
          }
          target.mask = { ...l.mask, assetId, enabled: true, linked: l.mask?.linked !== false, density: 1, feather: 0 };
        });
        e.selected = [target.id];
        e.target = "mask";
        e.emit();
      }
    }
    this.notify(system?"이미지를 시스템 클립보드에 복사했습니다.":"브라우저 권한 제한으로 편집기 안에 복사했습니다. 편집 메뉴의 붙여넣기를 사용할 수 있습니다.");
  }
  async paste(){
    if(navigator.clipboard?.read){try{const items=await navigator.clipboard.read();for(const item of items){const type=item.types.find(type=>type.startsWith('image/'));if(type){await this.importFiles([await item.getType(type)],!!this.entry);return;}}}catch{}}
    if(clipboard&&this.entry)return this.pasteInternal();throw new Error('붙여넣을 이미지가 없습니다. 이미지 파일을 복사한 뒤 Ctrl/Cmd+V를 사용하세요.');
  }
  pasteInternal() {
    if (!clipboard) return;
    const e = this.engine, l = newLayer("image", clipboard.width, clipboard.height, { assetId: e.register(copy(clipboard.canvas)) });
    l.name = "붙여넣은 이미지";
    e.transaction("붙여넣기", () => e.doc.layers.push(l));
    e.selected = [l.id];
    e.emit();
  }
  solidMask() {
    const c = canvas(this.engine.doc.width, this.engine.doc.height), ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  }
  vectorMask() {
    const e = this.engine, path = e.layer();
    if (path?.type !== "path") throw new Error("펜으로 만든 패스를 선택하세요.");
    const targets = e.doc.layers.filter((layer) => layer.id !== path.id && layer.type !== "path" && (!layer.locked || layer.data.original));
    if (!targets.length) throw new Error("마스크를 적용할 이미지나 레이어를 추가하세요.");
    this.dialog("패스로 벡터 마스크 만들기", `<form><label>대상 레이어<select name="target">${targets.map((layer) => `<option value="${layer.id}">${escape(layer.name)}</option>`).join("")}</select></label><p>잠긴 원본은 복제해 적용합니다. 마스크 앵커는 펜으로 계속 편집할 수 있습니다.</p><button>벡터 마스크 적용</button></form><button data-selection>선택 영역으로만 변환</button>`, (dialog) => {
      dialog.querySelector("[data-selection]").onclick = () => {
        const mask = canvas(e.doc.width, e.doc.height), ctx = mask.getContext("2d");
        ctx.setTransform(...worldMatrix(e.doc, path));
        traceBezier(ctx, path.data.points);
        ctx.fillStyle = "#fff";
        ctx.fill();
        e.selectMask(mask);
        dialog.close();
      };
      dialog.querySelector("form").onsubmit = (event) => {
        event.preventDefault();
        const id = new FormData(event.currentTarget).get("target"), original = e.doc.layers.find((layer) => layer.id === id), target = original.locked ? clone(original) : original, m = multiply(inverse(worldMatrix(e.doc, original)), worldMatrix(e.doc, path));
        const points = path.data.points.map((p) => {
          const anchor = point(m, p), input = point(m, { x: p.x + (p.inX || 0), y: p.y + (p.inY || 0) }), output = point(m, { x: p.x + (p.outX || 0), y: p.y + (p.outY || 0) });
          return { ...anchor, inX: input.x - anchor.x, inY: input.y - anchor.y, outX: output.x - anchor.x, outY: output.y - anchor.y };
        });
        e.transaction("벡터 마스크 적용", () => {
          if (original.locked) {
            target.id = uid();
            target.name += " 벡터 마스크";
            target.locked = false;
            target.data.original = false;
            e.doc.layers.push(target);
            original.visible = false;
          }
          target.vectorMask = { points, enabled: true };
          path.visible = false;
          e.selected = [target.id];
        });
        e.target = "vector";
        this.tool = "pen";
        e.emit();
        dialog.close();
        this.draw();
      };
    });
  }
  autoBackground() {
    const e = this.engine, source = e.renderer.render(e.doc);
    let background = null;
    for (const p of [{ x: 0, y: 0 }, { x: source.width - 1, y: 0 }, { x: 0, y: source.height - 1 }, { x: source.width - 1, y: source.height - 1 }]) background = maskCombine(background, colorSelection(source, p.x, p.y, this.options.tolerance, true), "add");
    e.selection = invertMask(background);
    if (e.layer() && !e.layer().locked) e.addMask();
    this.notify("가장자리 배경색으로 자동 분리했습니다. 복잡한 배경은 선택·마스크로 다듬으세요.");
    e.emit();
  }
  async subject() {
    const e = this.engine, source = e.renderer.render(e.doc), state = e.stateId, controller = new AbortController();
    const dialog = this.dialog("자동 피사체 선택", '<p>첫 실행에는 모델을 내려받습니다. 이미지는 이 기기에서 처리합니다.</p><p data-progress role="status">모델 준비 중</p><button data-cancel>취소</button>');
    dialog.querySelector("[data-cancel]").onclick = () => {
      controller.abort();
      dialog.close();
    };
    dialog.addEventListener("close", () => controller.abort(), { once: true });
    const mask = await segmentSubject(source, (text) => {
      const target = dialog.querySelector("[data-progress]");
      if (target) target.textContent = text;
    }, controller.signal);
    if (e.doc.width !== mask.width || e.doc.height !== mask.height) {
      dialog.close();
      throw new Error("처리 중 작업 규격이 바뀌었습니다. 현재 규격에서 다시 선택하세요.");
    }
    dialog.querySelector(".ed-dialog-content").innerHTML = "<p>피사체 마스크가 준비되었습니다. 적용 후 브러시로 경계를 수정할 수 있습니다.</p><button data-apply>선택 영역으로 적용</button>";
    dialog.querySelector("[data-apply]").onclick = () => {
      e.selection = mask;
      e.emit();
      dialog.close();
      if (e.stateId !== state) this.notify("이전 합성본 기준 선택을 적용했습니다. 경계를 확인하세요.");
    };
  }
  refineMask() {
    const e = this.engine, l = e.layer();
    if (!l?.mask) throw new Error("마스크가 있는 레이어를 선택하세요.");
    this.dialog("경계 다듬기", '<form><label>확장/축소<input name="radius" type="number" min="-20" max="20" value="-1"></label><label>페더<input name="feather" type="number" min="0" max="20" value="1"></label><label><input name="decontaminate" type="checkbox">경계 색 번짐 정리</label><button>적용</button></form>', (d) => d.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      const f = new FormData(event.currentTarget), source = e.assets.get(l.mask.assetId).canvas, r = Number(f.get("radius")), result = blur(r ? maskMorph(source, r) : source, Number(f.get("feather")));
      const patch = { mask: { ...l.mask, assetId: e.register(result), feather: 0 } };
      if (f.get("decontaminate") && l.data.assetId) {
        const image = e.assets.get(l.data.assetId).canvas;
        patch.data = { ...l.data, assetId: e.register(decontaminate(image, result)) };
      }
      e.patch(patch, "마스크 경계 다듬기");
      d.close();
    });
  }
  async closeDocument(entry=this.entry,discard=false){
    if(!entry)return true;
    if(entry===this.entry)this.controller?.cancel();
    clearTimeout(entry.persistence.timer);
    if(entry.engine.dirty&&!discard){
      const choice=await this.choose('작업 닫기','저장하지 않은 편집이 있습니다.',[['save','작업 저장 후 닫기'],['discard','저장하지 않고 닫기'],['cancel','취소']]);
      if(choice==='cancel')return false;
      if(choice==='save'&&!await this.saveDocument(false,entry))return false;
    }
    entry.persistence.suspended=true;
    try{if(entry.persistence.active)await entry.persistence.active.catch(()=>{});await entry.persistence.discardAuto();entry.persistence.stop();}
    catch(error){entry.persistence.suspended=false;entry.persistence.onChange();throw error;}
    const current=entry===this.entry;
    this.session.entries=this.session.entries.filter(value=>value!==entry);
    if(current)this.useEntry(this.session.entries.at(-1)||null);else this.renderTabs();
    entry.engine.destroy();return true;
  }

  commandPalette() {
    const items = [...this.root.querySelectorAll(".ed-menu [data-action]")].map((b) => ({ action: b.dataset.action, text: b.textContent, effect: b.dataset.effect })).filter((v) => v.action !== "commands");
    this.dialog("명령 검색", '<input class="ed-search" placeholder="명령 이름"><div class="ed-command-results"></div>', (d) => {
      const show = (query) => {
        const target = d.querySelector(".ed-command-results");
        target.innerHTML = items.filter((i) => i.text.includes(query)).map((v, i) => `<button data-index="${items.indexOf(v)}">${escape(v.text)}</button>`).join("");
        target.querySelectorAll("button").forEach((b) => b.onclick = () => {
          const item = items[Number(b.dataset.index)];
          d.close();
          void this.run(() => this.command(item.action, { effect: item.effect }));
        });
      };
      d.querySelector("input").oninput = (event) => show(event.target.value);
      show("");
    });
  }






  exportDialog(){
    const entry=this.entry,name=(entry.engine.doc.title||'edited').replace(/\.[^.]+$/,'')+'_edited';
    this.dialog('이미지 내보내기',`<form><label>형식<select name="format"><option value="png">PNG · 투명</option><option value="webp">WebP</option><option value="jpeg">JPEG · 배경색</option></select></label><label>품질<input name="quality" type="number" min="0.1" max="1" step="0.01" value="0.92"></label><label>JPEG 배경${colorControl('<input name="background" type="color" value="#ffffff">','#ffffff','JPEG 배경')}</label><label>파일명<input name="name" value="${escape(name)}" required></label><label>저장 위치<select name="destination"><option value="download">내 기기에 다운로드</option><option value="project">프로젝트 이미지 폴더</option></select></label><label>폴더<span data-path>${escape(this.folderLabel(this.session.prefix))}</span><input name="folder" type="hidden" value="${escape(this.session.prefix)}"></label><button type="button" data-folder>폴더 선택</button><p>현재 작업의 합성 이미지를 출력합니다. 레이어를 보존하려면 작업 저장을 사용하세요.</p><button type="submit">이미지 내보내기</button></form>`,d=>{
      d.querySelector('[data-folder]').onclick=()=>void this.run(()=>this.folderPicker(folder=>{d.querySelector('[name="folder"]').value=folder;d.querySelector('[data-path]').textContent=this.folderLabel(folder);}));
      d.querySelector('form').onsubmit=event=>{event.preventDefault();const form=event.currentTarget,settings=Object.fromEntries(new FormData(form)),submit=form.querySelector('[type="submit"]');void this.run(async()=>{submit.disabled=true;try{await this.exportEntry(entry,settings);d.close();}finally{submit.disabled=false;}});};
    });
  }
  async folderPicker(commit){
    const d=this.dialog('저장 폴더 선택','<p class="ed-folder-path"></p><div class="ed-library ed-folder-list"></div><button data-use>이 폴더 사용</button>');let prefix=this.session.prefix,loadVersion=0;
    const load=async()=>{
      const version=++loadVersion;this.notify('폴더를 불러오는 중…',d);d.querySelector('[data-use]').disabled=true;
      const response=await fetch(`/api/list?prefix=${encodeURIComponent(prefix)}`,{cache:'no-store'});if(!response.ok)throw new Error('폴더 목록을 불러오지 못했습니다.');const result=await response.json();if(!d.open||version!==loadVersion)return;
      d.querySelector('.ed-folder-path').textContent=this.folderLabel(prefix);const list=d.querySelector('.ed-folder-list');list.replaceChildren();
      if(prefix!==this.session.prefix)list.appendChild(createAssetParentCard(()=>{prefix=this.parentFolder(prefix);void this.run(load);}));
      for(const folder of (result.folders||[]).filter(path=>!path.split('/').some(part=>part.startsWith('__'))))list.appendChild(createAssetFolderCard({folderName:folder.split('/').filter(Boolean).at(-1),alias:window.getAliasOnly?.(folder,true)||'',image:getSelectionFolderImage(folder),onClick:()=>{prefix=folder;void this.run(load);}}));
      d.querySelector('[data-use]').disabled=false;this.notify('저장할 폴더를 선택하세요.',d);
    };
    d.querySelector('[data-use]').onclick=()=>{commit(prefix);d.close();};await load();
  }

  async readyFonts(engine) {
    const requests = engine.doc.layers.filter((l) => l.type === "text").map((l) => document.fonts.load(`${l.data.italic ? "italic " : ""}${l.data.bold ? "700" : "400"} ${l.data.size || 40}px "${l.data.font || "Noto Sans KR"}"`).catch(() => []));
    await Promise.all(requests);
    await document.fonts.ready;
  }
  async exportEntry(entry,settings){
    await this.readyFonts(entry.engine);const e=entry.engine,capturedId=e.stateId,c=e.renderer.render(e.doc),format=settings.format;
    if(format==='jpeg'){const ctx=c.getContext('2d');ctx.globalCompositeOperation='destination-over';ctx.fillStyle=settings.background;ctx.fillRect(0,0,c.width,c.height);}
    const blob=await blobOf(c,`image/${format}`,Number(settings.quality)),fileName=settings.name.replace(/[\\/\x00-\x1f]/g,'_')+(format==='jpeg'?'.jpg':'.'+format);
    if(settings.destination==='download'){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);this.notify('이미지 다운로드: '+fileName);return;}
    if(e.stateId!==capturedId)throw new Error('준비 중 편집이 변경되었습니다. 다시 내보내세요.');
    await entry.persistence.persist('autosave');
    if(e.stateId!==capturedId)throw new Error('준비 중 편집이 변경되었습니다. 다시 내보내세요.');
    const query=new URLSearchParams(queryFor(e,'autosave',entry.persistence.sessionId));query.set('key',settings.folder+fileName);query.set('format',format);
    const send=()=>api(`/documents/${e.doc.id}/export?${query}`,{method:'POST',body:blob,headers:{'X-Editor-Revision':entry.persistence.autoRevision,'X-Editor-Request':uid()}});
    let result;try{result=await send();}catch(error){
      if(error.code==='OUTPUT_METADATA_PENDING'){this.metadataRetry(error);throw new Error('이미지는 저장되었지만 정보 연결이 남았습니다. 열린 재시도 창에서 완료하세요.');}
      if(error.code!=='OUTPUT_EXISTS')throw error;
      if(await this.choose('이미지 덮어쓰기',`${settings.folder+fileName} 파일이 있습니다. 이전 이미지 1개를 백업하고 덮어쓸까요?`,[['overwrite','덮어쓰기'],['cancel','취소']])!=='overwrite')throw new Error('내보내기를 취소했습니다.');
      query.set('etag',error.etag);try{result=await send();}catch(retryError){if(retryError.code==='OUTPUT_METADATA_PENDING')this.metadataRetry(retryError);throw retryError;}
    }
    this.notify('프로젝트 이미지 저장됨: '+result.outputKey);window.refreshGallery?.();
  }
  metadataRetry(error){
    this.dialog('이미지 정보 저장 재시도',`<p>이미지 파일은 저장되었습니다. 작업 연결 정보 저장을 다시 시도하세요.</p><button data-retry>정보 저장 재시도</button>`,d=>d.querySelector('[data-retry]').onclick=()=>void this.run(async()=>{await api('/maintenance/output-repair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operationId:error.operationId})});this.notify('이미지 정보 저장 완료',d);window.refreshGallery?.();d.close();}));
  }

  destroy() {
    if (this.destroyed) return;
    this.cancelProperty();
    this.curveCancel?.();
    this.destroyed = true;
    this.abort.abort();
    this.controller?.destroy();
    this.resizeObserver.disconnect();
    this.detachObserver.disconnect();
    this.themeObserver.disconnect();
    this.curvePainters = [];
    this.engine?.removeEventListener("change", this.onEngineChange);
    if (this.raf) cancelAnimationFrame(this.raf);
    for (const entry of this.session.entries) if (entry.engine.dirty && (entry.started || entry.engine.doc.layers.length)) void entry.persistence.flush().catch(() => {
    });
    this.session.view = null;
    for (const dialog of this.dialogs || []) dialog.close();
  }
}
window.addEventListener("beforeunload", (event) => {
  for(const session of projects.values())for(const entry of session.entries)void entry.persistence.flush().catch(()=>{});
  if ([...projects.values()].some((session) => session.entries.some((entry) => (entry.started || entry.engine.doc.layers.length) && (entry.engine.dirty || entry.engine.isEditing)))) {
    event.preventDefault();
    event.returnValue = "";
  }
});
function mountEditor(root, options = {}) {
  activeWorkspace?.destroy();
  activeWorkspace = new EditorWorkspace(root, options);
  return activeWorkspace;
}
export {
  EditorWorkspace,
  mountEditor
};
