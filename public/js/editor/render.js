import { worldMatrix, clamp, identity } from "./model.js";
import { canvas, copy, applyEffect, pathShape, traceBezier, blur, maskMorph } from "./bitmap.js";
function drawTriangle(ctx, source, a, b, c, u, v, w) {
  const det = u.x * (v.y - w.y) + v.x * (w.y - u.y) + w.x * (u.y - v.y);
  if (Math.abs(det) < 1e-8) return;
  const coeff = (p, q, r) => [(p * (v.y - w.y) + q * (w.y - u.y) + r * (u.y - v.y)) / det, (p * (w.x - v.x) + q * (u.x - w.x) + r * (v.x - u.x)) / det, (p * (v.x * w.y - w.x * v.y) + q * (w.x * u.y - u.x * w.y) + r * (u.x * v.y - v.x * u.y)) / det];
  const x = coeff(a.x, b.x, c.x), y = coeff(a.y, b.y, c.y);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(x[0], y[0], x[1], y[1], x[2], y[2]);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}
function warped(source, data) {
  const nodes = data.warp, px = clamp(data.perspectiveX || 0, -80, 80) / 200, py = clamp(data.perspectiveY || 0, -80, 80) / 200;
  if (!nodes && !px && !py) return source;
  const q = [{ x: Math.max(px, 0), y: Math.max(py, 0) }, { x: 1 - Math.max(px, 0), y: Math.max(-py, 0) }, { x: 1 - Math.max(-px, 0), y: 1 - Math.max(-py, 0) }, { x: Math.max(-px, 0), y: 1 - Math.max(py, 0) }];
  const dx1 = q[1].x - q[2].x, dx2 = q[3].x - q[2].x, dx3 = q[0].x - q[1].x + q[2].x - q[3].x;
  const dy1 = q[1].y - q[2].y, dy2 = q[3].y - q[2].y, dy3 = q[0].y - q[1].y + q[2].y - q[3].y, det = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(det) > 1e-9 ? (dx3 * dy2 - dx2 * dy3) / det : 0, h = Math.abs(det) > 1e-9 ? (dx1 * dy3 - dx3 * dy1) / det : 0;
  const a = q[1].x - q[0].x + g * q[1].x, b = q[3].x - q[0].x + h * q[3].x, d = q[1].y - q[0].y + g * q[1].y, e = q[3].y - q[0].y + h * q[3].y;
  const map = (u, v) => {
    const z = g * u + h * v + 1, p = { x: (a * u + b * v + q[0].x) / z * source.width, y: (d * u + e * v + q[0].y) / z * source.height };
    if (nodes) {
      const gx = Math.min(1, Math.floor(u * 2)), gy = Math.min(1, Math.floor(v * 2)), tx = u * 2 - gx, ty = v * 2 - gy;
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        const weight = (x ? tx : 1 - tx) * (y ? ty : 1 - ty), node = nodes[(gy + y) * 3 + gx + x];
        p.x += node.x * weight;
        p.y += node.y * weight;
      }
    }
    return p;
  };
  const out = canvas(source.width, source.height), ctx = out.getContext("2d"), steps = 16;
  for (let y = 0; y < steps; y++) for (let x = 0; x < steps; x++) {
    const uv = [{ x: x / steps * source.width, y: y / steps * source.height }, { x: (x + 1) / steps * source.width, y: y / steps * source.height }, { x: x / steps * source.width, y: (y + 1) / steps * source.height }, { x: (x + 1) / steps * source.width, y: (y + 1) / steps * source.height }], p = uv.map((v) => map(v.x / source.width, v.y / source.height));
    drawTriangle(ctx, source, p[0], p[1], p[2], uv[0], uv[1], uv[2]);
    drawTriangle(ctx, source, p[1], p[3], p[2], uv[1], uv[3], uv[2]);
  }
  return out;
}
function applyStyle(source, s = {}) {
  if (!s.strokeWidth && !s.shadowBlur && !s.shadowEnabled && !s.glowRadius && !s.overlayEnabled && !s.gradientEnabled) return source;
  const result = canvas(source.width, source.height), ctx = result.getContext("2d");
  if (s.glowRadius) {
    ctx.shadowColor = s.glowColor || "#89c7ff";
    ctx.shadowBlur = s.glowRadius;
    ctx.drawImage(source, 0, 0);
    ctx.shadowColor = "transparent";
  }
  if (s.strokeWidth) {
    const border = maskMorph(source, Math.min(20, s.strokeWidth)), bc = border.getContext("2d");
    bc.globalCompositeOperation = "source-in";
    bc.fillStyle = s.strokeColor || "#000000";
    bc.fillRect(0, 0, border.width, border.height);
    ctx.drawImage(border, 0, 0);
  }
  if (s.shadowBlur || s.shadowEnabled) {
    ctx.shadowColor = s.shadowColor || "#000000";
    ctx.shadowBlur = s.shadowBlur || 0;
    ctx.shadowOffsetX = s.shadowX || 0;
    ctx.shadowOffsetY = s.shadowY || 0;
  }
  ctx.drawImage(source, 0, 0);
  ctx.shadowColor = "transparent";
  ctx.globalCompositeOperation = "source-atop";
  if (s.overlayEnabled) {
    ctx.globalAlpha = s.overlayOpacity ?? 0.5;
    ctx.fillStyle = s.overlay || "#ffffff";
    ctx.fillRect(0, 0, result.width, result.height);
  }
  if (s.gradientEnabled) {
    const gradient = ctx.createLinearGradient(0, 0, result.width, result.height);
    gradient.addColorStop(0, s.gradientFrom || "#352a70");
    gradient.addColorStop(1, s.gradientTo || "#ffb388");
    ctx.fillStyle = gradient;
    ctx.globalAlpha = s.gradientOpacity ?? 0.5;
    ctx.fillRect(0, 0, result.width, result.height);
  }
  return result;
}
class Renderer {
  constructor(assets) {
    this.assets = assets;
    this.cache = /* @__PURE__ */ new Map();
  }
  raw(layer) {
    const c = canvas(layer.width, layer.height), ctx = c.getContext("2d"), d = layer.data;
    if (layer.type === "image" || layer.type === "paint") {
      const src = this.assets.get(d.assetId)?.canvas;
      if (src) ctx.drawImage(src, 0, 0);
    }
    if (layer.type === "text") {
      const size = Number(d.size || 40), lineHeight = size * Number(d.lineHeight || 1.4);
      ctx.font = `${d.italic ? "italic " : ""}${d.bold ? "700" : "400"} ${size}px "${d.font || "Noto Sans KR"}", sans-serif`;
      ctx.fillStyle = d.color || "#ffffff";
      ctx.textBaseline = "top";
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${Number(d.spacing || 0)}px`;
      let y = 0;
      for (const paragraph of String(d.text || "").split("\n")) {
        let line = "";
        const lines = [];
        for (const char of paragraph) {
          if (ctx.measureText(line + char).width > layer.width && line) {
            lines.push(line);
            line = "";
          }
          line += char;
        }
        lines.push(line);
        for (const row of lines) {
          const w = ctx.measureText(row).width, x = d.align === "center" ? (layer.width - w) / 2 : d.align === "right" ? layer.width - w : 0;
          ctx.fillText(row, x, y);
          y += lineHeight;
        }
      }
    }
    if (layer.type === "shape") {
      ctx.strokeStyle = d.stroke || "#ffffff";
      ctx.fillStyle = d.fill || "transparent";
      ctx.lineWidth = d.strokeWidth ?? 3;
      ctx.lineCap = "round";
      pathShape(ctx, d.shape, layer.width, layer.height, d);
      if (!["line", "arrow"].includes(d.shape) && d.fill !== "transparent") ctx.fill();
      ctx.stroke();
      if (d.shape === "arrow") {
        const a = { x: d.reverseX ? 0 : layer.width, y: d.reverseY ? 0 : layer.height }, b = { x: d.reverseX ? layer.width : 0, y: d.reverseY ? layer.height : 0 }, angle = Math.atan2(a.y - b.y, a.x - b.x), s = 12 + ctx.lineWidth;
        ctx.beginPath();
        ctx.moveTo(a.x - s * Math.cos(angle - 0.5), a.y - s * Math.sin(angle - 0.5));
        ctx.lineTo(a.x, a.y);
        ctx.lineTo(a.x - s * Math.cos(angle + 0.5), a.y - s * Math.sin(angle + 0.5));
        ctx.stroke();
      }
    }
    if (layer.type === "path") {
      ctx.beginPath();
      for (const [i, p] of (d.points || []).entries()) {
        if (!i) ctx.moveTo(p.x, p.y);
        else {
          const prev = d.points[i - 1];
          ctx.bezierCurveTo(prev.x + (prev.outX || 0), prev.y + (prev.outY || 0), p.x + (p.inX || 0), p.y + (p.inY || 0), p.x, p.y);
        }
      }
      if (d.closed && d.points?.length > 1) {
        const last = d.points.at(-1), first = d.points[0];
        ctx.bezierCurveTo(last.x + (last.outX || 0), last.y + (last.outY || 0), first.x + (first.inX || 0), first.y + (first.inY || 0), first.x, first.y);
        ctx.closePath();
      }
      ctx.fillStyle = d.fill || "transparent";
      ctx.strokeStyle = d.stroke || "#ffffff";
      ctx.lineWidth = d.strokeWidth || 3;
      if (d.fill !== "transparent") ctx.fill();
      ctx.stroke();
    }
    return c;
  }
  local(layer) {
    const version = this.assets.get(layer.data.assetId)?.version || 0, signature = JSON.stringify([layer.type, layer.width, layer.height, layer.data, layer.effects, layer.style, version]);
    const cached = this.cache.get(layer.id);
    if (cached?.signature === signature) return cached.canvas;
    let c = this.raw(layer);
    for (const effect of layer.effects) c = applyEffect(c, effect);
    c = warped(c, layer.data);
    c = applyStyle(c, layer.style);
    this.cache.set(layer.id, { signature, canvas: c });
    return c;
  }
  worldMask(doc, layer) {
    if (!layer.mask || layer.mask.enabled === false) return null;
    const source = this.assets.get(layer.mask.assetId)?.canvas;
    if (!source) return null;
    const c = canvas(doc.width, doc.height), ctx = c.getContext("2d"), m = layer.mask.linked === false ? layer.mask.matrix || identity() : worldMatrix(doc, layer);
    ctx.setTransform(...m);
    ctx.drawImage(layer.mask.linked === false ? source : warped(source, layer.data), 0, 0);
    ctx.resetTransform();
    let result = layer.mask.feather ? blur(c, layer.mask.feather) : c;
    if ((layer.mask.density ?? 1) < 1) {
      const b = canvas(doc.width, doc.height), bctx = b.getContext("2d");
      bctx.fillStyle = `rgba(255,255,255,${1 - clamp(layer.mask.density)})`;
      bctx.fillRect(0, 0, b.width, b.height);
      bctx.drawImage(result, 0, 0);
      result = b;
    }
    return result;
  }
  vectorMask(doc, layer) {
    if (!layer.vectorMask || layer.vectorMask.enabled === false) return null;
    let local = canvas(layer.width, layer.height);
    const lc = local.getContext("2d");
    traceBezier(lc, layer.vectorMask.points);
    lc.fillStyle = "#fff";
    lc.fill();
    local = warped(local, layer.data);
    const result = canvas(doc.width, doc.height), ctx = result.getContext("2d");
    ctx.setTransform(...worldMatrix(doc, layer));
    ctx.drawImage(local, 0, 0);
    return result;
  }
  render(doc, { onlyLayerId = null, original = false } = {}) {
    let allowed = null;
    if (onlyLayerId) {
      allowed = /* @__PURE__ */ new Set([onlyLayerId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const l of doc.layers) if (allowed.has(l.parentId) && !allowed.has(l.id)) {
          allowed.add(l.id);
          changed = true;
        }
      }
      const selected = doc.layers.find((l) => l.id === onlyLayerId);
      let parentId = selected?.parentId;
      while (parentId) {
        allowed.add(parentId);
        parentId = doc.layers.find((l) => l.id === parentId)?.parentId;
      }
    }
    const renderSiblings = (parentId) => {
      const out = canvas(doc.width, doc.height), ctx = out.getContext("2d"), scratch = canvas(doc.width, doc.height), siblings = doc.layers.filter((l) => l.parentId === parentId);
      let clipBase = null;
      for (const [index, layer] of siblings.entries()) {
        if (!layer.visible || allowed && !allowed.has(layer.id)) {
          if (!layer.clip) clipBase = null;
          continue;
        }
        if (layer.clip && !clipBase) continue;
        let item;
        if (layer.type === "adjustment") {
          item = copy(out);
          for (const effect of layer.effects) item = applyEffect(item, effect);
          let mask2 = this.worldMask(doc, layer);
          const vector2 = this.vectorMask(doc, layer);
          if (vector2) {
            if (mask2) {
              const ctx2 = mask2.getContext("2d");
              ctx2.globalCompositeOperation = "destination-in";
              ctx2.drawImage(vector2, 0, 0);
            } else mask2 = vector2;
          }
          const maskData = mask2?.getContext("2d").getImageData(0, 0, doc.width, doc.height).data;
          const clipData = layer.clip && clipBase ? clipBase.getContext("2d").getImageData(0, 0, doc.width, doc.height).data : null;
          const before = ctx.getImageData(0, 0, doc.width, doc.height), after = item.getContext("2d").getImageData(0, 0, doc.width, doc.height);
          for (let i = 0; i < before.data.length; i += 4) {
            const weight = clamp(layer.opacity) * (maskData ? maskData[i + 3] / 255 : 1) * (clipData ? clipData[i + 3] / 255 : 1);
            for (let k = 0; k < 3; k++) before.data[i + k] = before.data[i + k] * (1 - weight) + after.data[i + k] * weight;
          }
          ctx.putImageData(before, 0, 0);
          continue;
        }
        item = layer.type === "group" ? renderSiblings(layer.id) : scratch;
        if (layer.type === "group") {
          for (const effect of layer.effects) item = applyEffect(item, effect);
          item = applyStyle(item, layer.style);
        }
        if (layer.type !== "group") {
          const ic = item.getContext("2d");
          ic.resetTransform();
          ic.globalCompositeOperation = "source-over";
          ic.globalAlpha = 1;
          ic.clearRect(0, 0, doc.width, doc.height);
          ic.setTransform(...worldMatrix(doc, layer));
          ic.drawImage(this.local(layer), 0, 0);
        }
        let mask = this.worldMask(doc, layer);
        const vector = this.vectorMask(doc, layer);
        if (vector) {
          if (mask) {
            const ctx2 = mask.getContext("2d");
            ctx2.globalCompositeOperation = "destination-in";
            ctx2.drawImage(vector, 0, 0);
          } else mask = vector;
        }
        if (mask) {
          const ic = item.getContext("2d");
          ic.resetTransform();
          ic.globalCompositeOperation = "destination-in";
          ic.drawImage(mask, 0, 0);
        }
        if (layer.clip && clipBase) {
          const ic = item.getContext("2d");
          ic.resetTransform();
          ic.globalCompositeOperation = "destination-in";
          ic.drawImage(clipBase, 0, 0);
        }
        if (!layer.clip) clipBase = siblings[index + 1]?.clip ? copy(item) : null;
        ctx.save();
        ctx.globalAlpha = clamp(layer.opacity);
        ctx.globalCompositeOperation = layer.blend;
        ctx.drawImage(item, 0, 0);
        ctx.restore();
      }
      return out;
    };
    if (original) {
      const asset = this.assets.get(doc.originalAssetId)?.canvas;
      if (asset) {
        const out = canvas(doc.width, doc.height), ctx = out.getContext("2d"), scale = Math.min(doc.width / asset.width, doc.height / asset.height);
        ctx.drawImage(asset, (doc.width - asset.width * scale) / 2, (doc.height - asset.height * scale) / 2, asset.width * scale, asset.height * scale);
        return out;
      }
    }
    return renderSiblings(null);
  }
  clear() {
    this.cache.clear();
  }
}
export {
  Renderer
};
