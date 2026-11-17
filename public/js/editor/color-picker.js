const MOBILE_COLOR_QUERY = "(max-width: 740px), (pointer: coarse)";
const RECENT_KEY = "imggul-editor-recent-colors";
const SWATCHES = [
  ["#000000", "검정"], ["#ffffff", "흰색"], ["#ef4444", "빨강"],
  ["#f97316", "주황"], ["#facc15", "노랑"], ["#22c55e", "초록"],
  ["#06b6d4", "청록"], ["#3b82f6", "파랑"], ["#6366f1", "인디고"], ["#a855f7", "보라"]
];
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
function hexColor(value) {
  const match = String(value).trim().match(/^#?([a-f\d]{3}|[a-f\d]{6})$/i);
  if (!match) return null;
  const hex = match[1].toLowerCase();
  return "#" + (hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex);
}
function rgbHex(rgb) {
  return "#" + rgb.map((n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0")).join("");
}
function displayColor(value) {
  const hex = hexColor(value);
  if (hex) return hex;
  if (String(value).trim().toLowerCase() === "transparent") return "transparent";
  // Fill fields on desktop also accept named/rgb() CSS colors.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillStyle = String(value);
  ctx.fillRect(0, 0, 1, 1);
  const rgba = ctx.getImageData(0, 0, 1, 1).data;
  return rgba[3] ? rgbHex([...rgba.slice(0, 3)]) : "transparent";
}
function rgbHsv(rgb) {
  const [r, g, b] = rgb.map((n) => n / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = 0;
  if (delta) h = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: h * 60, s: max ? delta / max : 0, v: max };
}
function hsvRgb({ h, s, v }) {
  const sector = h / 60, i = Math.floor(sector), f = sector - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6].map((n) => Math.round(n * 255));
}
function hexRgb(hex) {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}
function recentColors() {
  try {
    const colors = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(colors) ? [...new Set(colors.map(hexColor).filter(Boolean))].slice(0, 5) : [];
  } catch { return []; }
}
function rememberColor(color) {
  if (!hexColor(color)) return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([color, ...recentColors().filter((old) => old !== color)].slice(0, 5))); } catch { /* Picking a color must still work without local storage. */ }
}
export function colorControl(input, value, label, allowTransparent = false) {
  const color = displayColor(value), name = color === "transparent" ? "없음" : color.toUpperCase();
  return `<span class="ed-color-control" data-color-label="${escape(label)}" ${allowTransparent ? "data-color-transparent" : ""}>${input}<button type="button" class="ed-color-open" data-color-open aria-label="${escape(label)} 선택, 현재 ${name}" aria-haspopup="dialog"><span class="ed-color-dot" style="--ed-swatch:${color}" aria-hidden="true"></span><span class="ed-color-value">${name}</span></button></span>`;
}
export class EditorColorPicker {
  constructor(workspace) {
    this.workspace = workspace;
    this.active = null;
    document.addEventListener('pointerdown',event=>{
      this.pointerType=event.pointerType;
      if(!['touch','pen'].includes(event.pointerType))return;
      const control=event.target.closest('.ed-color-control');if(!control||!this.owns(control))return;
      event.preventDefault();event.stopPropagation();control.classList.add('ed-touch-color-control');
      const input=control.querySelector('input');if(!this.active&&input&&!input.disabled){try{this.open(input,control);}catch(error){workspace.notify(error.message);}}
    },{capture:true,signal:workspace.abort.signal});
    document.addEventListener("click", (event) => {
      if (!matchMedia(MOBILE_COLOR_QUERY).matches&&!["touch","pen"].includes(this.pointerType)&&!event.target.closest("[data-color-open]")) return;
      const trigger = event.target.closest("[data-color-open],.ed-color-control>input"), control = trigger?.closest(".ed-color-control");
      if (!control || !this.owns(control)) return;
      const input = control.querySelector("input");
      if (!input || input.matches(":disabled")) return;
      event.preventDefault();
      event.stopPropagation();
      if (!this.active) {
        try { this.open(input, control); } catch (error) { workspace.notify(error.message); }
      }
    }, { capture: true, signal: workspace.abort.signal });
    document.addEventListener("input", (event) => {
      if (event.target.matches(".ed-color-control>input") && this.owns(event.target)) this.refreshControl(event.target);
    }, { capture: true, signal: workspace.abort.signal });
  }
  get isOpen() { return !!this.active; }
  owns(element) {
    return this.workspace.root.contains(element) || this.workspace.dialogs?.has(element.closest(".ed-dialog"));
  }
  refreshControl(input) {
    const control = input.closest(".ed-color-control");
    if (!control) return;
    const color = displayColor(input.value), name = color === "transparent" ? "없음" : color.toUpperCase();
    control.querySelector(".ed-color-dot").style.setProperty("--ed-swatch", color);
    control.querySelector(".ed-color-value").textContent = name;
    control.querySelector("[data-color-open]").setAttribute("aria-label", `${control.dataset.colorLabel} 선택, 현재 ${name}`);
  }
  refresh() {
    for (const root of [this.workspace.root, ...(this.workspace.dialogs || [])]) {
      root.querySelectorAll(".ed-color-control>input").forEach((input) => this.refreshControl(input));
    }
  }
  open(input, control) {
    const workspace = this.workspace, entry = workspace.entry, original = input.value, initial = displayColor(original), allowNone = control.hasAttribute("data-color-transparent");
    const layerId = input.dataset.field?.startsWith("layer.") ? workspace.engine.layer()?.id : null;
    let color = initial === "transparent" ? "#000000" : initial, none = allowNone && initial === "transparent", hsv = rgbHsv(hexRgb(color)), touched = false, pointer = null;
    this.active = { input };
    try { workspace.controller.commitTransform(); } catch (error) { this.active = null; throw error; }
    if (!workspace.engine.isEditing) workspace.propertyBefore = null;
    const swatches = (items) => items.map(([hex, label]) => `<button type="button" data-swatch="${hex}" aria-label="${label} ${hex}" aria-pressed="false"><span class="ed-color-dot" style="--ed-swatch:${hex}" aria-hidden="true"></span></button>`).join("");
    const recent = recentColors();
    const content = `<div class="ed-color-previews"><button type="button" data-original><span class="ed-color-dot" style="--ed-swatch:${initial}"></span><span>원래 색</span></button><div><span class="ed-color-dot" data-preview></span><span data-value></span></div></div>
      <div class="ed-color-sv" tabindex="0" role="slider" aria-label="채도와 명도, 좌우 키로 채도, 상하 키로 명도 조절" aria-valuemin="0" aria-valuemax="100"><span class="ed-color-handle" aria-hidden="true"></span></div>
      <label class="ed-color-hue-label">색조<input data-hue type="range" min="0" max="360" step="1" aria-label="색조"></label>
      <label class="ed-color-hex-label">HEX<input data-hex type="text" maxlength="7" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" enterkeyhint="done" aria-label="HEX 색상 코드"></label>
      <details class="ed-color-rgb"><summary>RGB 값으로 입력</summary><div>${["R", "G", "B"].map((name) => `<label>${name}<input data-rgb type="number" min="0" max="255" step="1" inputmode="numeric" aria-label="${name} 색상 값"></label>`).join("")}</div></details>
      <p class="ed-color-error" role="status" aria-live="polite"></p>
      ${allowNone ? '<button type="button" class="ed-color-none" data-none aria-pressed="false">채우기 없음 · 투명</button>' : ""}
      <section class="ed-color-palette" aria-label="기본 색상"><h3>기본 색상</h3><div class="ed-color-swatches">${swatches(SWATCHES)}</div></section>
      ${recent.length ? `<section class="ed-color-palette" aria-label="최근 색상"><h3>최근 사용</h3><div class="ed-color-swatches">${swatches(recent.map((hex) => [hex, "최근 색상"]))}</div></section>` : ""}`;
    let dialog;
    try {
      dialog = workspace.dialog(`${control.dataset.colorLabel} 선택`, content);
    } catch (error) { this.active = null; throw error; }
    dialog.classList.add("ed-color-picker");
    this.active.dialog = dialog;
    const actions = document.createElement("footer");
    actions.className = "ed-color-actions";
    actions.innerHTML = '<button type="button" data-cancel>취소</button><button type="button" data-apply class="ed-primary">색상 적용</button>';
    dialog.appendChild(actions);
    const sv = dialog.querySelector(".ed-color-sv"), handle = dialog.querySelector(".ed-color-handle"), hue = dialog.querySelector("[data-hue]"), hex = dialog.querySelector("[data-hex]"), rgb = [...dialog.querySelectorAll("[data-rgb]")], apply = actions.querySelector("[data-apply]"), error = dialog.querySelector(".ed-color-error");
    const invalid = (message = "") => { error.textContent = message; apply.disabled = !!message; };
    const update = (skip = "") => {
      color = rgbHex(hsvRgb(hsv));
      const result = none ? "transparent" : color;
      sv.style.setProperty("--ed-hue", rgbHex(hsvRgb({ h: hsv.h, s: 1, v: 1 })));
      handle.style.left = `${hsv.s * 100}%`; handle.style.top = `${(1 - hsv.v) * 100}%`;
      sv.setAttribute("aria-valuenow", String(Math.round(hsv.s * 100)));
      sv.setAttribute("aria-valuetext", `채도 ${Math.round(hsv.s * 100)}%, 명도 ${Math.round(hsv.v * 100)}%`);
      hue.value = String(hsv.h);
      dialog.querySelector("[data-preview]").style.setProperty("--ed-swatch", result);
      dialog.querySelector("[data-value]").textContent = none ? "채우기 없음" : color.toUpperCase();
      if (skip !== "hex") { hex.value = color.toUpperCase(); hex.setCustomValidity(""); }
      if (skip !== "rgb") rgb.forEach((el, i) => { el.value = String(hsvRgb(hsv)[i]); el.setCustomValidity(""); });
      dialog.querySelectorAll("[data-swatch]").forEach((button) => button.setAttribute("aria-pressed", String(!none && button.dataset.swatch === color)));
      dialog.querySelector("[data-none]")?.setAttribute("aria-pressed", String(none));
      invalid();
    };
    const choose = (value) => { none = allowNone && value === "transparent"; hsv = rgbHsv(hexRgb(none ? color : value)); touched = true; update(); };
    const drag = (event) => {
      const rect = sv.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      hsv.s = clamp((event.clientX - rect.left) / rect.width); hsv.v = 1 - clamp((event.clientY - rect.top) / rect.height);
      none = false; touched = true; update();
    };
    sv.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || pointer !== null) return;
      event.preventDefault(); pointer = event.pointerId; sv.setPointerCapture(pointer); drag(event);
    });
    sv.addEventListener("pointermove", (event) => { if (event.pointerId === pointer) drag(event); });
    const end = (event) => { if (event.pointerId === pointer) { pointer = null; if (sv.hasPointerCapture(event.pointerId)) sv.releasePointerCapture(event.pointerId); } };
    sv.addEventListener("pointerup", end); sv.addEventListener("pointercancel", end); sv.addEventListener("lostpointercapture", () => pointer = null);
    sv.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 0.1 : 0.01;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") hsv.s = clamp(hsv.s + (event.key === "ArrowRight" ? step : -step));
      else hsv.v = clamp(hsv.v + (event.key === "ArrowUp" ? step : -step));
      none = false; touched = true; update();
    });
    hue.oninput = () => { hsv.h = Number(hue.value); none = false; touched = true; update(); };
    hex.oninput = () => {
      const value = hexColor(hex.value);
      hex.setCustomValidity(value ? "" : "HEX 코드는 #RGB 또는 #RRGGBB 형식으로 입력하세요.");
      if (!value) { invalid(hex.validationMessage); return; }
      hsv = rgbHsv(hexRgb(value)); none = false; touched = true; update("hex");
    };
    for (const el of rgb) el.oninput = () => {
      let valid = true;
      for (const channel of rgb) {
        const ok = /^\d{1,3}$/.test(channel.value) && Number(channel.value) <= 255;
        channel.setCustomValidity(ok ? "" : "RGB 값은 0~255 정수로 입력하세요."); valid &&= ok;
      }
      if (!valid) { invalid("RGB 값은 0~255 정수로 입력하세요."); return; }
      hsv = rgbHsv(rgb.map((channel) => Number(channel.value))); none = false; touched = true; update("rgb");
    };
    dialog.querySelectorAll("[data-swatch]").forEach((button) => button.onclick = () => choose(button.dataset.swatch));
    dialog.querySelector("[data-original]").onclick = () => {
      none = allowNone && initial === "transparent";
      hsv = rgbHsv(hexRgb(initial === "transparent" ? "#000000" : initial));
      touched = false;
      update();
    };
    dialog.querySelector("[data-none]")?.addEventListener("click", () => choose("transparent"));
    actions.querySelector("[data-cancel]").onclick = () => dialog.close();
    apply.onclick = () => {
      if (workspace.destroyed || workspace.entry !== entry || !input.isConnected || input.matches(":disabled") || layerId && workspace.engine.layer()?.id !== layerId) {
        dialog.close(); workspace.notify("편집 대상이 바뀌었습니다. 색상을 다시 선택하세요."); return;
      }
      if (touched) {
        const result = none ? "transparent" : color;
        if (result !== original) {
          input.value = result;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        rememberColor(result);
      }
      dialog.close();
    };
    hex.onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); if (!apply.disabled) apply.click(); } };
    dialog.addEventListener("close", () => {
      this.active = null;
      if (!workspace.destroyed) { workspace.update(); workspace.draw(); this.refresh(); }
    }, { once: true });
    update();
    sv.focus({ preventScroll: true });
  }
}
