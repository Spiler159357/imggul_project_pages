import { clone, uid, newLayer, inverse, worldMatrix, point, multiply, identity, clamp } from "./model.js";
import { canvas, copy, colorSelection, pathShape, hexRgb } from "./bitmap.js";
function region(image, x, y, w, h) {
  const out = new ImageData(w, h);
  for (let row = 0; row < h; row++) out.data.set(image.data.subarray(((y + row) * image.width + x) * 4, ((y + row) * image.width + x + w) * 4), row * w * 4);
  return out;
}
class ToolController {
  constructor(view, engine) {
    this.view = view;
    this.e = engine;
    this.drag = null;
    this.path = [];
    this.sample = null;
    this.space = false;
    this.abort = new AbortController();
    const signal = this.abort.signal, c = view.overlay;
    c.addEventListener("pointerdown", (event) => this.safe(() => this.down(event)), { signal });
    c.addEventListener("pointermove", (event) => this.safe(() => this.move(event)), { signal });
    c.addEventListener("pointerup", (event) => this.safe(() => this.up(event)), { signal });
    c.addEventListener("pointercancel", () => this.cancel(), { signal });
    c.addEventListener("dblclick", () => this.finishPath(), { signal });
  }
  position(event) {
    const r = this.view.stage.getBoundingClientRect(), v = this.view.viewport;
    return { x: (event.clientX - r.left - v.x) / v.zoom, y: (event.clientY - r.top - v.y) / v.zoom };
  }
  down(event) {
    if (event.button !== 0 && event.button !== 1) return;
    this.view.stage.focus({ preventScroll: true });
    event.preventDefault();
    const p = this.position(event), e = this.e, o = this.view.options, tool = this.space || event.button === 1 || event.pointerType === "touch" ? "hand" : this.view.tool;
    if (tool === "clone" || tool === "heal" || tool === "patch") {
      if (event.altKey) {
        this.sample = p;
        this.view.notify("샘플 기준점을 지정했습니다.");
        return;
      }
    }
    this.view.overlay.setPointerCapture(event.pointerId);
    if (tool === "zoom") {
      this.view.zoom(this.view.viewport.zoom * (event.altKey ? 0.8 : 1.25), p);
      return;
    }
    if (tool === "hand") {
      this.drag = { kind: "hand", client: { x: event.clientX, y: event.clientY }, viewport: { ...this.view.viewport } };
      return;
    }
    if (tool === "eyedropper") {
      const image = e.renderer.render(e.doc), x = clamp(p.x, 0, image.width - 1), y = clamp(p.y, 0, image.height - 1), d = image.getContext("2d").getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      o.color = "#" + [...d.slice(0, 3)].map((n) => n.toString(16).padStart(2, "0")).join("");
      this.view.updateOptions();
      return;
    }
    if (tool === "wand") {
      const src = o.sampleMerged ? e.renderer.render(e.doc) : e.renderer.render(e.doc, { onlyLayerId: e.layer()?.id });
      e.selectMask(colorSelection(src, p.x, p.y, o.tolerance, o.contiguous), o.selectionMode);
      return;
    }
    if (tool === "pen") {
      if (e.layer()?.locked) return;
      const layer = e.layer(), handle = layer ? this.view.handleAt(p) : null;
      if ((layer?.type === "path" || e.target === "vector" && layer?.vectorMask) && handle?.kind === "anchor") {
        e.isEditing = true;
        this.drag = { kind: "anchor", before: clone(e.doc), layerId: layer.id, index: handle.index, component: handle.component === "point" && event.altKey ? "out" : handle.component, inv: inverse(worldMatrix(e.doc, layer)) };
        return;
      }
    }
    if (tool === "pen" && e.target === "vector") {
      this.view.notify("벡터 마스크의 앵커 또는 핸들을 드래그하세요.");
      return;
    }
    if (tool === "polygon" || tool === "pen") {
      this.path.push({ ...p, inX: 0, inY: 0, outX: 0, outY: 0 });
      this.drag = { kind: "path", start: p };
      this.view.draw();
      return;
    }
    if (["rect-select", "ellipse-select", "lasso", "crop"].includes(tool)) {
      this.drag = { kind: "selection", tool, start: p, points: [p], end: p };
      return;
    }
    if (tool === "selection-move" && e.selection) {
      this.drag = { kind: "selection-move", start: p, mask: copy(e.selection) };
      return;
    }
    if (tool === "move" || tool === "transform" || tool === "warp") {
      let l = e.layer(), handle = l ? this.view.handleAt(p) : null;
      if (!handle && tool === "move") {
        l = e.hit(p);
        if (l) {
          if (event.shiftKey) e.selected = e.selected.includes(l.id) ? e.selected.filter((id) => id !== l.id) : [...e.selected, l.id];
          else e.selected = [l.id];
        } else e.selected = [];
        e.target = "pixels";
        e.emit();
      }
      if (!l || l.locked) return;
      e.isEditing = true;
      this.drag = { kind: "transform", before: clone(e.doc), start: p, layerId: l.id, original: clone(l), world: worldMatrix(e.doc, l), handle, tool, targets: e.selected.filter((id) => {
        const target = e.doc.layers.find((v) => v.id === id);
        if (!target || target.locked) return false;
        let parentId = target.parentId;
        while (parentId) {
          if (e.selected.includes(parentId)) return false;
          parentId = e.doc.layers.find((v) => v.id === parentId)?.parentId;
        }
        return true;
      }) };
      return;
    }
    if (tool === "patch") {
      if (!e.selection) {
        this.view.notify("패치할 영역을 먼저 선택하고 복사할 위치로 드래그하세요.");
        return;
      }
      this.drag = { kind: "patch", start: p, end: p, source: e.renderer.render(e.doc), mask: copy(e.selection) };
      return;
    }
    if (["brush", "eraser", "clone", "heal", "dodge", "burn", "smudge", "blur-brush", "sharpen-brush", "liquify"].includes(tool)) return this.startStroke(p, event, tool);
    if (tool === "fill" || tool === "gradient") return this.startFill(p, tool);
    if (["text", "rect", "ellipse", "line", "arrow", "polygon-shape"].includes(tool)) {
      this.drag = { kind: "shape", tool, start: p, end: p };
      return;
    }
  }
  startStroke(p, event, tool) {
    if (!clamp(this.view.options.opacity) || !clamp(this.view.options.flow)) return;
    const e = this.e;
    if (e.target === "vector") {
      this.view.notify("벡터 마스크는 펜으로 앵커를 편집하세요.");
      return;
    }
    let beforeDoc = clone(e.doc);
    let l = e.layer();
    const sampled = e.renderer.render(e.doc, this.view.options.sampleMerged || !l ? {} : { onlyLayerId: l.id }), composite = e.renderer.render(e.doc);
    if (tool === "eraser" && e.target === "pixels" && l?.type === "image") {
      if (!l.mask) e.addMask(false);
      l = e.layer();
      e.target = "mask";
      beforeDoc = clone(e.doc);
    }
    if (e.target === "mask") {
      if (!l?.mask || l.locked) {
        this.view.notify("잠기지 않은 마스크를 선택하세요.");
        return;
      }
    } else if (!l || l.type !== "paint" || l.locked) {
      l = newLayer("paint", e.doc.width, e.doc.height, { assetId: e.register(canvas(e.doc.width, e.doc.height)) });
      l.name = ["clone", "heal", "patch"].includes(tool) ? "리터칭" : "페인트";
      e.doc.layers.push(l);
      e.selected = [l.id];
    }
    const assetId = e.target === "mask" ? l.mask.assetId : l.data.assetId, a = e.assets.get(assetId), m = e.target === "mask" && l.mask.linked === false ? l.mask.matrix : worldMatrix(e.doc, l), inv = inverse(m), before = a.canvas.getContext("2d").getImageData(0, 0, a.canvas.width, a.canvas.height);
    let selection = null;
    if (e.selection) {
      selection = canvas(a.canvas.width, a.canvas.height);
      const ctx = selection.getContext("2d");
      ctx.setTransform(...inv);
      ctx.drawImage(e.selection, 0, 0);
    }
    if (["clone", "heal", "patch"].includes(tool) && !this.sample) {
      e.doc = beforeDoc;
      this.view.notify("Alt+클릭으로 복사할 기준점을 지정하세요.");
      return;
    }
    e.isEditing = true;
    this.drag = { kind: "stroke", tool, layer: l, assetId, m, inv, before, beforeDoc: JSON.stringify(beforeDoc) !== JSON.stringify(e.doc) ? beforeDoc : null, last: p, start: p, bounds: { x: a.canvas.width, y: a.canvas.height, right: 0, bottom: 0 }, selection, sample: sampled, composite, previous: copy(a.canvas) };
    this.stamp(p, event.pressure || 0.5);
    e.emit();
  }
  stamp(p, pressure) {
    const d = this.drag, e = this.e, o = this.view.options, l = d.layer, a = e.assets.get(d.assetId), ctx = a.canvas.getContext("2d"), q = point(d.inv, p), scale = Math.max(0.05, Math.hypot(d.m[0], d.m[1])), size = o.size * (o.pressure ? 0.2 + 0.8 * pressure : 1) / scale, r = Math.max(0.5, size / 2), x = Math.max(0, Math.floor(q.x - r - 2)), y = Math.max(0, Math.floor(q.y - r - 2)), right = Math.min(a.canvas.width, Math.ceil(q.x + r + 2)), bottom = Math.min(a.canvas.height, Math.ceil(q.y + r + 2));
    if (right <= x || bottom <= y) return;
    const w = right - x, h = bottom - y, stamp = canvas(w, h), sc = stamp.getContext("2d");
    if (["clone", "heal", "patch"].includes(d.tool)) {
      const delta = { x: this.sample.x - d.start.x, y: this.sample.y - d.start.y }, src = canvas(w, h), sctx = src.getContext("2d");
      sctx.setTransform(...multiply([1, 0, 0, 1, -x, -y], d.inv));
      sctx.drawImage(d.sample, -delta.x, -delta.y);
      sc.drawImage(src, 0, 0);
      if (d.tool !== "clone") {
        const reference = canvas(w, h), referenceCtx = reference.getContext("2d");
        referenceCtx.setTransform(...multiply([1, 0, 0, 1, -x, -y], d.inv));
        referenceCtx.drawImage(d.composite, 0, 0);
        const target = referenceCtx.getImageData(0, 0, w, h), pixels = sc.getImageData(0, 0, w, h), means = [0, 0, 0, 0, 0, 0];
        let n = 0;
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
          const dist = Math.hypot(xx + x - q.x, yy + y - q.y);
          if (dist < r * 0.65 || dist > r) continue;
          const i = (yy * w + xx) * 4;
          if (!target.data[i + 3] || !pixels.data[i + 3]) continue;
          for (let k = 0; k < 3; k++) {
            means[k] += target.data[i + k];
            means[k + 3] += pixels.data[i + k];
          }
          n++;
        }
        if (n) for (let i = 0; i < pixels.data.length; i += 4) for (let k = 0; k < 3; k++) pixels.data[i + k] = clamp(pixels.data[i + k] + (means[k] - means[k + 3]) / n, 0, 255);
        sc.putImageData(pixels, 0, 0);
      }
    } else if (["dodge", "burn", "smudge", "blur-brush", "sharpen-brush", "liquify"].includes(d.tool)) {
      const sample = canvas(w, h), sampleCtx = sample.getContext("2d");
      sampleCtx.setTransform(...multiply([1, 0, 0, 1, -x, -y], d.inv));
      sampleCtx.drawImage(d.sample, 0, 0);
      sc.drawImage(sample, 0, 0);
      if (d.tool === "blur-brush") {
        sc.clearRect(0, 0, w, h);
        sc.filter = "blur(2px)";
        sc.drawImage(sample, 0, 0);
        sc.filter = "none";
      } else if (d.tool === "liquify") {
        const input = sampleCtx.getImageData(0, 0, w, h), output = sc.createImageData(w, h), last = point(d.inv, d.last), dx = (q.x - last.x) * 0.6, dy = (q.y - last.y) * 0.6;
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
          const falloff = Math.max(0, 1 - Math.hypot(xx + x - q.x, yy + y - q.y) / r) ** 2, sx = clamp(xx - dx * falloff, 0, w - 1), sy = clamp(yy - dy * falloff, 0, h - 1), x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0, dst = (yy * w + xx) * 4;
          for (let k = 0; k < 4; k++) {
            let value = 0;
            for (let b = 0; b < 2; b++) for (let a2 = 0; a2 < 2; a2++) value += input.data[(Math.min(h - 1, y0 + b) * w + Math.min(w - 1, x0 + a2)) * 4 + k] * (a2 ? tx : 1 - tx) * (b ? ty : 1 - ty);
            output.data[dst + k] = value;
          }
        }
        sc.putImageData(output, 0, 0);
      } else if (d.tool === "smudge") {
        sc.clearRect(0, 0, w, h);
        const last = point(d.inv, d.last);
        sc.drawImage(sample, q.x - last.x, q.y - last.y);
      } else {
        const im = sc.getImageData(0, 0, w, h), soft = canvas(w, h), softCtx = soft.getContext("2d");
        softCtx.filter = "blur(1px)";
        softCtx.drawImage(sample, 0, 0);
        const source = softCtx.getImageData(0, 0, w, h);
        for (let i = 0; i < im.data.length; i += 4) for (let k = 0; k < 3; k++) {
          const v = im.data[i + k];
          im.data[i + k] = d.tool === "dodge" ? v + (255 - v) * 0.15 : d.tool === "burn" ? v * 0.85 : clamp(v + (v - source.data[i + k]) * 0.8, 0, 255);
        }
        sc.putImageData(im, 0, 0);
      }
    } else {
      sc.fillStyle = e.target === "mask" ? "#fff" : o.color;
      sc.fillRect(0, 0, w, h);
    }
    const mask = canvas(w, h), mc = mask.getContext("2d"), hard = clamp(o.hardness);
    if (hard < 1) {
      const gradient = mc.createRadialGradient(q.x - x, q.y - y, r * hard, q.x - x, q.y - y, r);
      gradient.addColorStop(0, "#fff");
      gradient.addColorStop(1, "transparent");
      mc.fillStyle = gradient;
    } else mc.fillStyle = "#fff";
    mc.beginPath();
    mc.arc(q.x - x, q.y - y, r, 0, Math.PI * 2);
    mc.fill();
    if (d.selection) {
      mc.globalCompositeOperation = "destination-in";
      mc.drawImage(d.selection, -x, -y);
    }
    sc.globalCompositeOperation = "destination-in";
    sc.drawImage(mask, 0, 0);
    ctx.save();
    ctx.globalAlpha = clamp(o.opacity) * clamp(o.flow);
    ctx.globalCompositeOperation = d.tool === "eraser" || e.target === "mask" && o.maskErase ? "destination-out" : l.alphaLock && e.target !== "mask" ? "source-atop" : "source-over";
    ctx.drawImage(stamp, x, y);
    ctx.restore();
    if (["dodge", "burn", "smudge", "blur-brush", "sharpen-brush", "liquify"].includes(d.tool)) {
      const sampleCtx = d.sample.getContext("2d");
      sampleCtx.save();
      sampleCtx.setTransform(...d.m);
      sampleCtx.globalAlpha = clamp(o.opacity) * clamp(o.flow);
      sampleCtx.drawImage(stamp, x, y);
      sampleCtx.restore();
    }
    d.bounds.x = Math.min(d.bounds.x, x);
    d.bounds.y = Math.min(d.bounds.y, y);
    d.bounds.right = Math.max(d.bounds.right, right);
    d.bounds.bottom = Math.max(d.bounds.bottom, bottom);
    a.version++;
    e.renderer.cache.delete(l.id);
  }
  move(event) {
    const d = this.drag;
    let p = this.position(event);
    this.view.cursor = p;
    if (!d) {
      this.view.draw();
      return;
    }
    if (d.kind === "hand") {
      this.view.viewport.x = d.viewport.x + event.clientX - d.client.x;
      this.view.viewport.y = d.viewport.y + event.clientY - d.client.y;
    }
    if (d.kind === "path") {
      const last = this.path[this.path.length - 1];
      last.outX = p.x - last.x;
      last.outY = p.y - last.y;
      last.inX = -last.outX;
      last.inY = -last.outY;
    }
    if (d.kind === "selection" || d.kind === "shape" || d.kind === "patch") {
      d.end = p;
      if (d.tool === "lasso") d.points.push(p);
    }
    if (d.kind === "selection-move") {
      this.e.selection = canvas(d.mask.width, d.mask.height);
      this.e.selection.getContext("2d").drawImage(d.mask, p.x - d.start.x, p.y - d.start.y);
    }
    if (d.kind === "transform") this.transform(p, event);
    if (d.kind === "anchor") {
      const layer = this.e.doc.layers.find((l) => l.id === d.layerId), anchor = (this.e.target === "vector" ? layer.vectorMask.points : layer.data.points)[d.index], q = point(d.inv, p);
      if (d.component === "point") {
        anchor.x = q.x;
        anchor.y = q.y;
      } else {
        anchor[`${d.component}X`] = q.x - anchor.x;
        anchor[`${d.component}Y`] = q.y - anchor.y;
      }
      this.e.renderer.cache.delete(layer.id);
    }
    if (d.kind === "stroke") {
      const smooth = clamp(this.view.options.smoothing || 0, 0, 0.9);
      p = { x: d.last.x * smooth + p.x * (1 - smooth), y: d.last.y * smooth + p.y * (1 - smooth) };
      const distance = Math.hypot(p.x - d.last.x, p.y - d.last.y), step = Math.max(1, this.view.options.size * this.view.options.spacing), n = Math.max(1, Math.ceil(distance / step)), previous = { ...d.last };
      for (let i = 1; i <= n; i++) this.stamp({ x: previous.x + (p.x - previous.x) * i / n, y: previous.y + (p.y - previous.y) * i / n }, event.pressure || 0.5);
      d.last = p;
    }
    this.view.draw();
  }
  transform(p, event) {
    const d = this.drag, e = this.e, l = e.doc.layers.find((l2) => l2.id === d.layerId);
    if (!l) return;
    if (d.tool === "warp" && d.handle?.kind === "warp") {
      const q = point(inverse(d.world), p), initial = point(inverse(d.world), d.start);
      l.data.warp = clone(d.original.data.warp || Array.from({ length: 9 }, () => ({ x: 0, y: 0 })));
      l.data.warp[d.handle.index].x += q.x - initial.x;
      l.data.warp[d.handle.index].y += q.y - initial.y;
      e.renderer.cache.delete(l.id);
      return;
    }
    const parent = e.doc.layers.find((v) => v.id === l.parentId), parentInv = parent ? inverse(worldMatrix(e.doc, parent)) : identity();
    if (d.handle?.kind === "rotate") {
      const center = point(d.world, { x: l.width / 2, y: l.height / 2 }), angle = Math.atan2(p.y - center.y, p.x - center.x) - Math.atan2(d.start.y - center.y, d.start.x - center.x), a = event.shiftKey ? Math.round(angle / (Math.PI / 12)) * Math.PI / 12 : angle, c = Math.cos(a), s = Math.sin(a), rotation = [c, s, -s, c, center.x - c * center.x + s * center.y, center.y - s * center.x - c * center.y];
      l.matrix = multiply(parentInv, multiply(rotation, d.world));
    } else if (d.handle?.kind === "scale") {
      const q = point(inverse(d.world), p);
      let sx = Math.max(0.01, q.x / l.width), sy = Math.max(0.01, q.y / l.height);
      if (!event.shiftKey) sy = sx;
      l.matrix = multiply(d.original.matrix, [sx, 0, 0, sy, 0, 0]);
    } else {
      const delta = point(parentInv, { x: p.x - d.start.x, y: p.y - d.start.y }), zero = point(parentInv, { x: 0, y: 0 });
      l.matrix = [...d.original.matrix];
      l.matrix[4] += delta.x - zero.x;
      l.matrix[5] += delta.y - zero.y;
      if (event.shiftKey) {
        const axis = Math.abs(p.x - d.start.x) > Math.abs(p.y - d.start.y) ? 5 : 4;
        l.matrix[axis] = d.original.matrix[axis];
      }
    }
    this.view.snapLines = null;
    if (this.view.options.snap !== false && !d.handle && !event.altKey) {
      const m = worldMatrix(e.doc, l), corners = [point(m, { x: 0, y: 0 }), point(m, { x: l.width, y: 0 }), point(m, { x: 0, y: l.height }), point(m, { x: l.width, y: l.height })], xs = corners.map((p2) => p2.x), ys = corners.map((p2) => p2.y), ax = [Math.min(...xs), (Math.min(...xs) + Math.max(...xs)) / 2, Math.max(...xs)], ay = [Math.min(...ys), (Math.min(...ys) + Math.max(...ys)) / 2, Math.max(...ys)], gx = [0, e.doc.width / 2, e.doc.width], gy = [0, e.doc.height / 2, e.doc.height];
      for (const other of e.doc.layers) {
        if (!other.visible || e.selected.includes(other.id) || other.type === "adjustment" || other.type === "group") continue;
        const om = worldMatrix(e.doc, other), start = point(om, { x: 0, y: 0 }), end = point(om, { x: other.width, y: other.height });
        gx.push(start.x, (start.x + end.x) / 2, end.x);
        gy.push(start.y, (start.y + end.y) / 2, end.y);
      }
      const nearest = (anchors, guides) => {
        let best = null;
        for (const a of anchors) for (const g of guides) if (Math.abs(g - a) < 6 / this.view.viewport.zoom && (!best || Math.abs(g - a) < Math.abs(best.delta))) best = { delta: g - a, guide: g };
        return best;
      };
      const x = nearest(ax, gx), y = nearest(ay, gy);
      if (x || y) {
        l.matrix = multiply(parentInv, multiply([1, 0, 0, 1, x?.delta || 0, y?.delta || 0], m));
        this.view.snapLines = { x: x?.guide, y: y?.guide };
      }
    }
    const deltaWorld = multiply(worldMatrix(e.doc, l), inverse(d.world));
    for (const id of d.targets || []) {
      if (id === l.id) continue;
      const current = e.doc.layers.find((v) => v.id === id), original = d.before.layers.find((v) => v.id === id);
      if (!current || !original) continue;
      const parent2 = e.doc.layers.find((v) => v.id === current.parentId), parentInverse = parent2 ? inverse(worldMatrix(e.doc, parent2)) : identity();
      current.matrix = multiply(parentInverse, multiply(deltaWorld, worldMatrix(d.before, original)));
    }
  }
  up(event) {
    const d = this.drag;
    if (!d) return;
    const p = this.position(event);
    this.drag = null;
    this.view.snapLines = null;
    this.e.isEditing = false;
    if (this.view.overlay.hasPointerCapture(event.pointerId)) this.view.overlay.releasePointerCapture(event.pointerId);
    if (d.kind === "stroke") {
      const b = d.bounds;
      if (b.right > b.x && b.bottom > b.y) {
        const target = this.e.assets.get(d.assetId).canvas, w = b.right - b.x, h = b.bottom - b.y;
        this.e.pixelCommand("브러시/리터칭", d.assetId, region(d.before, b.x, b.y, w, h), target.getContext("2d").getImageData(b.x, b.y, w, h), b.x, b.y, d.beforeDoc);
      } else if (d.beforeDoc) this.e.doc = d.beforeDoc;
    }
    if (d.kind === "anchor") {
      const after = clone(this.e.doc);
      this.e.doc = d.before;
      this.e.transaction("패스 앵커 편집", () => this.e.doc = after);
    }
    if (d.kind === "transform" && (this.pendingTransform || JSON.stringify(d.before) !== JSON.stringify(this.e.doc))) {
      this.pendingTransform ??= d.before;
      this.e.isEditing = true;
      this.view.notify("변형 미리보기 · Enter 적용 / Esc 취소");
    }
    if (d.kind === "selection") {
      if (d.tool === "crop") {
        this.view.cropRegion = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), width: Math.max(1, Math.abs(p.x - d.start.x)), height: Math.max(1, Math.abs(p.y - d.start.y)) };
        this.view.cropDialog();
      } else {
        const c = canvas(this.e.doc.width, this.e.doc.height), ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        if (d.tool === "lasso") {
          for (const q of d.points) ctx.lineTo(q.x, q.y);
          ctx.closePath();
        } else if (d.tool === "ellipse-select") ctx.ellipse((d.start.x + p.x) / 2, (d.start.y + p.y) / 2, Math.abs(p.x - d.start.x) / 2, Math.abs(p.y - d.start.y) / 2, 0, 0, Math.PI * 2);
        else ctx.rect(Math.min(d.start.x, p.x), Math.min(d.start.y, p.y), Math.abs(p.x - d.start.x), Math.abs(p.y - d.start.y));
        ctx.fill();
        this.e.selectMask(c, this.view.options.selectionMode);
      }
    }
    if (d.kind === "shape") {
      if (d.tool === "text") this.view.addText(d.start);
      else {
        const w = Math.max(2, Math.abs(p.x - d.start.x)), h = Math.max(2, Math.abs(p.y - d.start.y)), o = this.view.options, l = newLayer("shape", w, h, { shape: d.tool === "polygon-shape" ? "polygon" : d.tool, stroke: o.color, fill: o.fill, strokeWidth: o.strokeWidth, reverseX: p.x < d.start.x, reverseY: p.y < d.start.y });
        l.opacity = o.opacity;
        l.matrix[4] = Math.min(p.x, d.start.x);
        l.matrix[5] = Math.min(p.y, d.start.y);
        this.e.transaction("도형 추가", () => this.e.doc.layers.push(l));
        this.e.selected = [l.id];
      }
    }
    if (d.kind === "fill" && d.tool === "gradient") this.commitFill(d, p);
    if (d.kind === "patch") {
      const c = canvas(d.source.width, d.source.height), ctx = c.getContext("2d");
      ctx.drawImage(d.source, d.start.x - p.x, d.start.y - p.y);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(d.mask, 0, 0);
      const l = newLayer("paint", c.width, c.height, { assetId: this.e.register(c) });
      l.name = "선택 영역 패치";
      this.e.transaction("영역 패치", () => this.e.doc.layers.push(l));
      this.e.selected = [l.id];
    }
    this.e.emit();
    this.view.draw();
  }
  startFill(p, tool) {
    if (!clamp(this.view.options.opacity)) return;
    const e = this.e;
    if (e.target === "mask") {
      this.view.notify("마스크는 브러시·반전·선택 변환으로 편집하세요.");
      return;
    }
    let l = e.layer();
    if (l?.locked) {
      this.view.notify("잠긴 레이어입니다.");
      return;
    }
    if (!l || l.type !== "paint") l = e.add("paint");
    const a = e.assets.get(l.data.assetId), before = a.canvas.getContext("2d").getImageData(0, 0, a.canvas.width, a.canvas.height);
    this.drag = { kind: "fill", tool, layer: l, assetId: l.data.assetId, start: p, before };
    if (tool === "fill") {
      this.commitFill(this.drag, p);
      this.drag = null;
    }
  }
  commitFill(d, p) {
    const e = this.e, o = this.view.options, l = d.layer, source = e.assets.get(d.assetId).canvas, c = canvas(source.width, source.height), ctx = c.getContext("2d"), inv = inverse(worldMatrix(e.doc, l)), start = point(inv, d.start), end = point(inv, p);
    if (d.tool === "gradient") {
      const g = o.radial ? ctx.createRadialGradient(start.x, start.y, 0, start.x, start.y, Math.max(1, Math.hypot(end.x - start.x, end.y - start.y))) : ctx.createLinearGradient(start.x, start.y, end.x, end.y);
      g.addColorStop(0, o.color);
      g.addColorStop(1, o.background);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, c.width, c.height);
    } else {
      const mask = colorSelection(o.sampleMerged ? e.renderer.render(e.doc) : source, o.sampleMerged ? d.start.x : start.x, o.sampleMerged ? d.start.y : start.y, o.tolerance, o.contiguous);
      ctx.fillStyle = o.color;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.globalCompositeOperation = "destination-in";
      if (o.sampleMerged) ctx.setTransform(...inv);
      ctx.drawImage(mask, 0, 0);
      ctx.resetTransform();
    }
    if (e.selection) {
      ctx.globalCompositeOperation = "destination-in";
      ctx.setTransform(...inv);
      ctx.drawImage(e.selection, 0, 0);
      ctx.resetTransform();
    }
    const target = source.getContext("2d");
    target.save();
    target.globalAlpha = o.opacity;
    target.drawImage(c, 0, 0);
    target.restore();
    e.pixelCommand(d.tool === "fill" ? "색 채우기" : "그라데이션", d.assetId, d.before, target.getImageData(0, 0, source.width, source.height));
  }
  finishPath() {
    if (this.path.length < 2) return;
    const points = this.path.splice(0);
    if (this.view.tool === "pen") {
      const l = newLayer("path", this.e.doc.width, this.e.doc.height, { points, closed: true, fill: this.view.options.fill, stroke: this.view.options.color, strokeWidth: this.view.options.strokeWidth });
      this.e.transaction("베지어 패스 추가", () => this.e.doc.layers.push(l));
      this.e.selected = [l.id];
    } else {
      const c = canvas(this.e.doc.width, this.e.doc.height), ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      for (const p of points) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fill();
      this.e.selectMask(c, this.view.options.selectionMode);
    }
    this.e.emit();
  }
  commitTransform() {
    if (!this.pendingTransform) return;
    const after = clone(this.e.doc), before = this.pendingTransform;
    this.pendingTransform = null;
    this.e.doc = before;
    this.e.isEditing = false;
    this.e.transaction("레이어 변형", () => this.e.doc = after);
    this.e.emit();
  }
  cancel() {
    const pending = this.pendingTransform;
    if (this.pendingTransform) {
      this.e.doc = this.pendingTransform;
      this.pendingTransform = null;
    }
    const d = this.drag;
    if (d?.kind === "stroke") {
      this.e.assets.get(d.assetId).canvas.getContext("2d").putImageData(d.before, 0, 0);
      if (d.beforeDoc) this.e.doc = d.beforeDoc;
      this.e.renderer.clear();
    }
    if (d?.kind === "transform" || d?.kind === "anchor") this.e.doc = pending || d.before;
    if (d?.kind === "selection-move") this.e.selection = d.mask;
    if (pending) this.e.doc = pending;
    this.drag = null;
    this.path = [];
    this.e.isEditing = false;
    this.e.emit();
  }
  destroy() {
    this.cancel();
    this.abort.abort();
  }
  safe(fn) {
    try {
      fn();
    } catch (error) {
      this.cancel();
      this.view.notify(error.message);
    }
  }
}
export {
  ToolController
};
