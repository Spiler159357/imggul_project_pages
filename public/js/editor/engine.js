import { PRESETS, uid, clone, newDocument, newLayer, presetFor, validateDocument, worldMatrix, multiply, inverse, point, identity } from "./model.js";
import { canvas, copy, decode, blobOf, maskCombine, invertMask, blur, maskMorph, colorSelection } from "./bitmap.js";
import { Renderer } from "./render.js";
class EditorEngine extends EventTarget {
  constructor(projectId = "", prefix = "") {
    super();
    this.doc = newDocument("square", projectId, prefix);
    this.retainedDocuments = /* @__PURE__ */ new Set();
    this.assets = /* @__PURE__ */ new Map();
    this.renderer = new Renderer(this.assets);
    this.undoStack = [];
    this.redoStack = [];
    this.stateId = uid();
    this.savedId = "";
    this.revision = 0;
    this.selected = [];
    this.target = "pixels";
    this.selection = null;
    this.historyBytes = 0;
    this.historyLimit = 96 * 1024 * 1024;
  }
  async whenIdle() {
    if (!this.isEditing) return;
    await new Promise((resolve) => {
      const done = () => {
        if (!this.isEditing) {
          this.removeEventListener("change", done);
          resolve();
        }
      };
      this.addEventListener("change", done);
    });
  }
  emit() {
    this.dispatchEvent(new Event("change"));
  }
  get dirty() {
    return this.stateId !== this.savedId;
  }
  layer() {
    return this.doc.layers.find((l) => l.id === this.selected[0]);
  }
  register(c, id = uid()) {
    this.assets.set(id, { canvas: c, version: 0 });
    return id;
  }
  transaction(label, fn) {
    const before = clone(this.doc), beforeId = this.stateId, beforeSelected = [...this.selected];
    try {
      fn();
      validateDocument(this.doc);
    } catch (error) {
      this.doc = before;
      throw error;
    }
    const after = clone(this.doc);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.stateId = uid();
    const command = { label, before, after, beforeId, afterId: this.stateId, beforeSelected, afterSelected: [...this.selected], bytes: (JSON.stringify(before).length + JSON.stringify(after).length) * 2 };
    this.undoStack.push(command);
    queueMicrotask(() => {
      if (this.stateId === command.afterId) command.afterSelected = [...this.selected];
    });
    this.redoStack = [];
    this.trim();
    this.renderer.clear();
    this.emit();
  }
  pixelCommand(label, assetId, before, after, x = 0, y = 0, beforeDoc = null) {
    if (before.data.length === after.data.length && before.data.every((value, index) => value === after.data[index])) {
      if (beforeDoc) this.doc = beforeDoc;
      this.selected = this.selected.filter((id) => this.doc.layers.some((layer) => layer.id === id));
      this.renderer.clear();
      this.emit();
      return;
    }
    const beforeId = this.stateId;
    this.stateId = uid();
    this.undoStack.push({ label, assetId, before, after, x, y, beforeDoc, afterDoc: beforeDoc ? clone(this.doc) : null, beforeId, afterId: this.stateId, bytes: before.data.byteLength + after.data.byteLength });
    this.redoStack = [];
    this.trim();
    this.touch(assetId);
  }
  trim() {
    this.historyBytes = this.undoStack.reduce((n, e) => n + e.bytes, 0);
    while (this.historyBytes > this.historyLimit && this.undoStack.length > 1) this.historyBytes -= this.undoStack.shift().bytes;
    this.collect();
  }
  collect() {
    const used = /* @__PURE__ */ new Set();
    const scan = (d) => {
      if (d.originalAssetId) used.add(d.originalAssetId);
      for (const l of d.layers) {
        if (l.data.assetId) used.add(l.data.assetId);
        if (l.mask) used.add(l.mask.assetId);
      }
      for (const c of d.candidates || []) {
        used.add(c.assetId);
        used.add(c.maskId);
        if (c.sourceDocument) scan(c.sourceDocument);
      }
    };
    scan(this.doc);
    for (const document of this.retainedDocuments) scan(document);
    for (const e of [...this.undoStack, ...this.redoStack]) {
      if (e.assetId) used.add(e.assetId);
      for (const d of [e.beforeDoc, e.afterDoc, e.assetId ? null : e.before, e.assetId ? null : e.after]) if (d) scan(d);
    }
    for (const id of this.assets.keys()) if (!used.has(id)) this.assets.delete(id);
  }
  touch(id) {
    const a = this.assets.get(id);
    if (a) a.version++;
    this.renderer.clear();
    this.emit();
  }
  history(direction) {
    const from = direction < 0 ? this.undoStack : this.redoStack, to = direction < 0 ? this.redoStack : this.undoStack, e = from.pop();
    if (!e) return;
    if (e.assetId) {
      const a = this.assets.get(e.assetId);
      a.canvas.getContext("2d").putImageData(direction < 0 ? e.before : e.after, e.x, e.y);
      a.version++;
      if (e.beforeDoc) this.doc = clone(direction < 0 ? e.beforeDoc : e.afterDoc);
    } else this.doc = clone(direction < 0 ? e.before : e.after);
    this.stateId = direction < 0 ? e.beforeId : e.afterId;
    to.push(e);
    this.selected = (direction < 0 ? e.beforeSelected || this.selected : e.afterSelected || this.selected).filter((id) => this.doc.layers.some((l) => l.id === id));
    if (this.selection && (this.selection.width !== this.doc.width || this.selection.height !== this.doc.height)) this.selection = null;
    this.renderer.clear();
    this.emit();
  }
  async addImage(blob, { original = false, key = "" } = {}) {
    const c = await decode(blob);
    const preset = presetFor(c.width, c.height);
    if (!preset) throw new Error("1216×832, 1024×1024, 832×1216 이미지만 열 수 있습니다.");
    const assetId = this.register(c), l = newLayer("image", c.width, c.height, { assetId, original });
    l.locked = original;
    l.name = original ? "원본 이미지" : "추가 이미지";
    this.transaction("이미지 추가", () => {
      if (original) {
        this.doc.width = c.width;
        this.doc.height = c.height;
        this.doc.preset = preset;
        this.doc.sourceKey = key;
        this.doc.originalAssetId = assetId;
        this.doc.title = key.split("/").pop() || "이미지 작업";
      }
      this.doc.layers.push(l);
      this.selected = [l.id];
    });
    this.selected = [l.id];
    this.emit();
    return l;
  }
  add(type, data = {}, width = this.doc.width, height = this.doc.height) {
    const l = newLayer(type, width, height, data);
    if (type === "paint") l.data.assetId = this.register(canvas(width, height));
    this.transaction("레이어 추가", () => {
      this.doc.layers.push(l);
      this.selected = [l.id];
      this.target = "pixels";
    });
    this.selected = [l.id];
    this.target = "pixels";
    this.emit();
    return l;
  }
  patch(patch, label = "속성 변경") {
    const ids = new Set(this.selected);
    this.transaction(label, () => {
      for (const l of this.doc.layers) if (ids.has(l.id) && (!l.locked || Object.keys(patch).every((k) => ["locked", "visible"].includes(k)))) Object.assign(l, clone(patch));
    });
  }
  descendants(ids) {
    const set = new Set(ids);
    let changed = true;
    while (changed) {
      changed = false;
      for (const l of this.doc.layers) if (set.has(l.parentId) && !set.has(l.id)) {
        set.add(l.id);
        changed = true;
      }
    }
    return set;
  }
  remove() {
    const ids = this.descendants(this.selected.filter((id) => !this.doc.layers.find((l) => l.id === id)?.locked));
    this.transaction("레이어 삭제", () => {
      this.doc.layers = this.doc.layers.filter((l) => !ids.has(l.id));
      this.selected = [];
    });
    this.selected = [];
  }
  duplicate() {
    const ids = this.descendants(this.selected), map = new Map([...ids].map((id) => [id, uid()])), copies = this.doc.layers.filter((l) => ids.has(l.id)).map((l) => {
      const c = clone(l);
      c.id = map.get(l.id);
      c.parentId = map.get(l.parentId) || l.parentId;
      c.name += " 복사";
      c.locked = false;
      if (c.data.original) c.data.original = false;
      if (c.type === "paint") c.data.assetId = this.register(copy(this.assets.get(l.data.assetId).canvas));
      if (c.mask) c.mask.assetId = this.register(copy(this.assets.get(l.mask.assetId).canvas));
      return c;
    });
    this.transaction("레이어 복제", () => {
      this.doc.layers.push(...copies);
      this.selected = copies.map((l) => l.id);
    });
    this.selected = copies.map((l) => l.id);
  }
  group() {
    const roots = this.selected.filter((id) => {
      let parentId = this.doc.layers.find((l) => l.id === id)?.parentId;
      while (parentId) {
        if (this.selected.includes(parentId)) return false;
        parentId = this.doc.layers.find((l) => l.id === parentId)?.parentId;
      }
      return true;
    });
    if (!roots.length) return;
    const g = newLayer("group", this.doc.width, this.doc.height);
    this.transaction("그룹 만들기", () => {
      for (const id of roots) {
        const l = this.doc.layers.find((l2) => l2.id === id);
        l.matrix = worldMatrix(this.doc, l);
        l.parentId = g.id;
      }
      this.doc.layers.push(g);
      this.selected = [g.id];
    });
    this.selected = [g.id];
  }
  ungroup() {
    const g = this.layer();
    if (g?.type !== "group") return;
    if (g.mask || g.vectorMask || g.clip || g.opacity !== 1 || g.blend !== "source-over" || g.effects.length || Object.values(g.style).some(Boolean)) throw new Error("그룹의 마스크·효과·혼합을 먼저 해제하거나 병합한 뒤 그룹을 해제하세요.");
    this.transaction("그룹 해제", () => {
      this.selected = this.doc.layers.filter((l) => l.parentId === g.id).map((l) => l.id);
      for (const l of this.doc.layers) if (l.parentId === g.id) {
        l.matrix = multiply(g.matrix, l.matrix);
        l.parentId = g.parentId;
      }
      this.doc.layers = this.doc.layers.filter((l) => l.id !== g.id);
    });
  }
  reorder(id, targetId, inside = false) {
    this.transaction("레이어 순서", () => {
      const i = this.doc.layers.findIndex((l2) => l2.id === id), target = this.doc.layers.find((l2) => l2.id === targetId);
      if (i < 0 || !target || this.descendants([id]).has(targetId)) return;
      const l = this.doc.layers[i], m = worldMatrix(this.doc, l);
      this.doc.layers.splice(i, 1);
      const parent = inside && target.type === "group" ? target : this.doc.layers.find((p) => p.id === target.parentId);
      l.matrix = parent ? multiply(inverse(worldMatrix(this.doc, parent)), m) : m;
      l.parentId = parent?.id || null;
      this.doc.layers.splice(this.doc.layers.indexOf(target), 0, l);
    });
  }
  merge() {
    const ids = this.descendants(this.selected);
    if (!ids.size) return;
    const sub = clone(this.doc);
    sub.layers = sub.layers.filter((l) => ids.has(l.id));
    for (const l of sub.layers) if (!ids.has(l.parentId)) {
      const original = this.doc.layers.find((v) => v.id === l.id);
      l.matrix = worldMatrix(this.doc, original);
      l.parentId = null;
    }
    const src = this.renderer.render(sub), layer = newLayer("paint", this.doc.width, this.doc.height, { assetId: this.register(src) });
    layer.name = "병합";
    this.transaction("선택 병합", () => {
      const top = Math.max(...this.doc.layers.map((v, i) => ids.has(v.id) ? i : -1)), insert = this.doc.layers.slice(0, top + 1).filter((v) => !ids.has(v.id)).length;
      this.doc.layers = this.doc.layers.filter((v) => !ids.has(v.id));
      this.doc.layers.splice(insert, 0, layer);
      this.selected = [layer.id];
    });
    this.selected = [layer.id];
    this.emit();
  }
  changePreset(preset, mode = "contain", rotate = false) {
    const [w, h] = PRESETS[preset], ow = this.doc.width, oh = this.doc.height;
    let m;
    if (rotate) m = [0, 1, -1, 0, w, 0];
    else {
      const s = (mode === "cover" ? Math.max : Math.min)(w / ow, h / oh);
      m = [s, 0, 0, s, (w - ow * s) / 2, (h - oh * s) / 2];
    }
    this.transaction("캔버스 구도 변경", () => {
      for (const l of this.doc.layers) {
        if (!l.parentId) l.matrix = multiply(m, l.matrix);
        if (l.mask?.linked === false) l.mask.matrix = multiply(m, l.mask.matrix);
      }
      this.doc.width = w;
      this.doc.height = h;
      this.doc.preset = preset;
    });
    if (this.selection) {
      const c = canvas(w, h), ctx = c.getContext("2d");
      ctx.setTransform(...m);
      ctx.drawImage(this.selection, 0, 0);
      this.selection = c;
    }
    this.emit();
  }
  hit(p) {
    for (const l of [...this.doc.layers].reverse()) {
      if (!l.visible || l.opacity <= 0 || l.type === "adjustment" || l.type === "group") continue;
      let parent = this.doc.layers.find((v) => v.id === l.parentId), hidden = false;
      while (parent) {
        if (!parent.visible || parent.opacity <= 0) hidden = true;
        parent = this.doc.layers.find((v) => v.id === parent.parentId);
      }
      if (hidden) continue;
      const q = point(inverse(worldMatrix(this.doc, l)), p);
      if (q.x >= 0 && q.y >= 0 && q.x < l.width && q.y < l.height) {
        const c = this.renderer.local(l), alpha = c.getContext("2d").getImageData(Math.floor(q.x), Math.floor(q.y), 1, 1).data[3];
        if (alpha) {
          const masks = [this.renderer.worldMask(this.doc, l), this.renderer.vectorMask(this.doc, l)].filter(Boolean), x = Math.floor(p.x), y = Math.floor(p.y);
          if (x >= 0 && y >= 0 && x < this.doc.width && y < this.doc.height && masks.some((mask) => !mask.getContext("2d").getImageData(x, y, 1, 1).data[3])) continue;
          return l;
        }
      }
    }
    return null;
  }
  selectMask(c, mode = "replace") {
    this.selection = maskCombine(this.selection, c, mode);
    this.emit();
  }
  selectionOp(action, value = 1) {
    if (action === "all") {
      this.selection = canvas(this.doc.width, this.doc.height);
      const ctx = this.selection.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, this.doc.width, this.doc.height);
    } else if (action === "clear") this.selection = null;
    else if (this.selection) {
      this.selection = action === "invert" ? invertMask(this.selection) : action === "feather" ? blur(this.selection, value) : maskMorph(this.selection, action === "shrink" ? -value : value);
    }
    this.emit();
  }
  colorSelect(p, tolerance, contiguous = true, mode = "replace") {
    this.selectMask(colorSelection(this.renderer.render(this.doc), p.x, p.y, tolerance, contiguous), mode);
  }
  addMask(fromSelection = true) {
    let l = this.layer();
    if (!l) return;
    if (l.locked) {
      if (l.data.original) {
        this.duplicate();
        l = this.layer();
      } else throw new Error("잠긴 레이어입니다.");
    }
    const c = canvas(l.width, l.height), ctx = c.getContext("2d");
    if (fromSelection && this.selection) {
      ctx.setTransform(...inverse(worldMatrix(this.doc, l)));
      ctx.drawImage(this.selection, 0, 0);
    } else {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
    }
    const assetId = this.register(c);
    this.transaction("마스크 추가", () => l.mask = { assetId, enabled: true, linked: true, density: 1, feather: 0 });
    this.target = "mask";
    this.emit();
  }
  maskOp(action) {
    const l = this.layer();
    if (!l?.mask) return;
    if (action === "selection") {
      this.selection = this.renderer.worldMask(this.doc, l);
      this.emit();
      return;
    }
    this.transaction("마스크 변경", () => {
      if (action === "invert") l.mask.assetId = this.register(invertMask(this.assets.get(l.mask.assetId).canvas));
      if (action === "toggle") l.mask.enabled = !l.mask.enabled;
      if (action === "link") {
        l.mask.matrix = worldMatrix(this.doc, l);
        l.mask.linked = l.mask.linked === false;
      }
      if (action === "delete") l.mask = null;
    });
  }
  async pack() {
    const document = clone(this.doc), blobs = [];
    const used = /* @__PURE__ */ new Set();
    const scan = (doc) => {
      if (doc.originalAssetId) used.add(doc.originalAssetId);
      for (const layer of doc.layers) {
        if (layer.data.assetId) used.add(layer.data.assetId);
        if (layer.mask) used.add(layer.mask.assetId);
      }
      for (const candidate of doc.candidates) {
        used.add(candidate.assetId);
        used.add(candidate.maskId);
        if (candidate.sourceDocument) scan(candidate.sourceDocument);
      }
    };
    scan(document);
    const pending = [...used].map((id) => {
      const a = this.assets.get(id);
      if (!a) throw new Error("누락된 자산이 있습니다.");
      const width = a.canvas.width, height = a.canvas.height;
      return blobOf(a.canvas).then((blob) => ({ id, blob, width, height }));
    });
    const preview = canvas(192, 192), previewCtx = preview.getContext("2d"), rendered = this.renderer.render(document), scale = Math.min(192 / rendered.width, 192 / rendered.height);
    previewCtx.drawImage(rendered, (192 - rendered.width * scale) / 2, (192 - rendered.height * scale) / 2, rendered.width * scale, rendered.height * scale);
    pending.push(blobOf(preview).then((blob) => ({ id: "preview", blob, width: 192, height: 192 })));
    for (const item of await Promise.all(pending)) {
      const bytes = await item.blob.arrayBuffer(), digest = await crypto.subtle.digest("SHA-256", bytes), hash = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
      const metadata = { hash, width: item.width, height: item.height, type: "image/png" };
      if (item.id === "preview") document.preview = metadata;
      else document.assets[item.id] = metadata;
      blobs.push({ ...item, hash });
    }
    for (const id of Object.keys(document.assets)) if (!used.has(id)) delete document.assets[id];
    return { document, blobs };
  }
  async hydrate(document, loader) {
    validateDocument(document);
    const staged = /* @__PURE__ */ new Map();
    await Promise.all(Object.entries(document.assets).map(async ([id, meta]) => {
      staged.set(id, { canvas: await decode(await loader(id, meta)), version: 0 });
    }));
    this.doc = clone(document);
    this.assets.clear();
    for (const [id, a] of staged) this.assets.set(id, a);
    this.undoStack = [];
    this.redoStack = [];
    this.selected = [];
    this.selection = null;
    this.stateId = uid();
    this.savedId = this.stateId;
    this.renderer.clear();
    this.emit();
  }
  destroy() {
    this.assets.clear();
    this.renderer.clear();
    this.undoStack = [];
    this.redoStack = [];
  }
}
export {
  EditorEngine
};
