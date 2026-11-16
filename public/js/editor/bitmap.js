import { clamp } from "./model.js";
function canvas(width, height) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
function copy(source) {
  const c = canvas(source.width, source.height);
  c.getContext("2d").drawImage(source, 0, 0);
  return c;
}
function blobOf(c, type = "image/png", quality = 0.92) {
  return new Promise((resolve, reject) => c.toBlob((blob) => blob && blob.type === type ? resolve(blob) : reject(new Error("이 브라우저에서 해당 형식의 인코딩을 지원하지 않습니다.")), type, quality));
}
async function decode(blob) {
  const image = await createImageBitmap(blob, { imageOrientation: "from-image" });
  if (image.width > 1216 || image.height > 1216) {
    image.close();
    throw new Error("지원 크기를 초과한 이미지입니다.");
  }
  const c = canvas(image.width, image.height);
  c.getContext("2d").drawImage(image, 0, 0);
  image.close();
  return c;
}
function blur(source, radius) {
  const c = canvas(source.width, source.height);
  const ctx = c.getContext("2d");
  ctx.filter = `blur(${Math.max(0, radius)}px)`;
  ctx.drawImage(source, 0, 0);
  return c;
}
function maskCombine(base, added, mode) {
  if (mode === "replace" || !base) return copy(added);
  const c = copy(base), ctx = c.getContext("2d");
  ctx.globalCompositeOperation = { add: "source-over", subtract: "destination-out", intersect: "destination-in" }[mode] || "source-over";
  ctx.drawImage(added, 0, 0);
  return c;
}
function invertMask(source) {
  const c = canvas(source.width, source.height), ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(source, 0, 0);
  return c;
}
function maskMorph(source, radius) {
  const w = source.width, h = source.height, c = canvas(w, h), ctx = c.getContext("2d"), input = source.getContext("2d").getImageData(0, 0, w, h), out = ctx.createImageData(w, h), r = Math.min(30, Math.abs(Math.round(radius))), grow = radius > 0;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = input.data[i * 4 + 3];
  const pass = (source2, horizontal) => {
    const result = new Uint8Array(w * h), length = horizontal ? w : h, lines = horizontal ? h : w, positions = new Int32Array(length + r * 2 + 2), values = new Uint8Array(length + r * 2 + 2);
    for (let line = 0; line < lines; line++) {
      let head = 0, tail = 0;
      for (let i = -r; i < length + r; i++) {
        const v = i < 0 || i >= length ? 0 : source2[horizontal ? line * w + i : i * w + line];
        while (tail > head && (grow ? values[tail - 1] <= v : values[tail - 1] >= v)) tail--;
        positions[tail] = i;
        values[tail++] = v;
        while (tail > head && positions[head] < i - r * 2) head++;
        const center = i - r;
        if (center >= 0 && center < length) result[horizontal ? line * w + center : center * w + line] = values[head];
      }
    }
    return result;
  };
  const filtered = pass(pass(alpha, true), false);
  for (let i = 0; i < filtered.length; i++) {
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = 255;
    out.data[i * 4 + 3] = filtered[i];
  }
  ctx.putImageData(out, 0, 0);
  return c;
}
function colorSelection(source, x, y, tolerance = 32, contiguous = true) {
  const w = source.width, h = source.height, c = canvas(w, h), ctx = c.getContext("2d"), d = source.getContext("2d").getImageData(0, 0, w, h), o = ctx.createImageData(w, h);
  x = Math.max(0, Math.min(w - 1, Math.floor(x)));
  y = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const start = y * w + x, target = Array.from(d.data.slice(start * 4, start * 4 + 4)), seen = new Uint8Array(w * h), queue = new Int32Array(w * h);
  let tail = 0, head = 0;
  const matches = (i) => Math.max(...target.map((v, k) => Math.abs(v - d.data[i * 4 + k]))) <= tolerance;
  const set = (i) => {
    o.data[i * 4] = o.data[i * 4 + 1] = o.data[i * 4 + 2] = 255;
    o.data[i * 4 + 3] = 255;
  };
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (matches(i)) set(i);
  } else {
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const i = queue[head++];
      if (!matches(i)) continue;
      set(i);
      for (const n of [i % w ? i - 1 : -1, i % w < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < w * (h - 1) ? i + w : -1]) if (n >= 0 && !seen[n]) {
        seen[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  ctx.putImageData(o, 0, 0);
  return c;
}
function pathShape(ctx, shape, w, h, data = {}) {
  ctx.beginPath();
  if (shape === "ellipse") ctx.ellipse(w / 2, h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
  else if (shape === "line" || shape === "arrow") {
    ctx.moveTo(data.reverseX ? w : 0, data.reverseY ? h : 0);
    ctx.lineTo(data.reverseX ? 0 : w, data.reverseY ? 0 : h);
  } else if (shape === "polygon") {
    const n = Math.max(3, Math.min(24, data.sides || 5));
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(w / 2 + Math.cos(a) * w / 2, h / 2 + Math.sin(a) * h / 2);
    }
    ctx.closePath();
  } else ctx.roundRect(0, 0, w, h, Math.min(data.radius || 0, w / 2, h / 2));
}
function traceBezier(ctx, points, closed = true) {
  ctx.beginPath();
  for (const [index, p] of points.entries()) {
    if (!index) ctx.moveTo(p.x, p.y);
    else {
      const previous = points[index - 1];
      ctx.bezierCurveTo(previous.x + (previous.outX || 0), previous.y + (previous.outY || 0), p.x + (p.inX || 0), p.y + (p.inY || 0), p.x, p.y);
    }
  }
  if (closed && points.length > 1) {
    const last = points.at(-1), first = points[0];
    ctx.bezierCurveTo(last.x + (last.outX || 0), last.y + (last.outY || 0), first.x + (first.inX || 0), first.y + (first.inY || 0), first.x, first.y);
    ctx.closePath();
  }
}
function curveTable(points = [[0, 0], [255, 255]]) {
  const p = [...points].sort((a, b) => a[0] - b[0]), out = new Uint8Array(256);
  for (let x = 0; x < 256; x++) {
    let a = p[0], b = p[p.length - 1];
    for (let i = 1; i < p.length; i++) if (x <= p[i][0]) {
      a = p[i - 1];
      b = p[i];
      break;
    }
    out[x] = clamp(a[1] + (b[1] - a[1]) * clamp((x - a[0]) / Math.max(1, b[0] - a[0])), 0, 255);
  }
  return out;
}
function processPixels(source, effect) {
  const c = copy(source), ctx = c.getContext("2d"), im = ctx.getImageData(0, 0, c.width, c.height), d = im.data, p = effect.params || {};
  const curve = curveTable(p.points), lut = effect.lut;
  let smooth = null;
  if (["sharpen", "unsharp"].includes(effect.type)) smooth = blur(source, p.radius || 1).getContext("2d").getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (effect.type === "brightness") {
      const k = 1 + Number(p.contrast || 0) / 100, add = Number(p.brightness || 0) * 2.55;
      r = (r - 128) * k + 128 + add;
      g = (g - 128) * k + 128 + add;
      b = (b - 128) * k + 128 + add;
    }
    if (effect.type === "exposure") {
      const k = 2 ** Number(p.exposure || 0);
      r *= k;
      g *= k;
      b *= k;
    }
    if (effect.type === "balance") {
      r += Number(p.red || 0);
      g += Number(p.green || 0);
      b += Number(p.blue || 0);
    }
    if (effect.type === "grayscale") {
      r = g = b = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    const originalChannels = [r, g, b];
    if (effect.type === "levels") {
      const lo = Number(p.black || 0), hi = Math.max(lo + 1, Number(p.white ?? 255)), gamma = Math.max(0.1, Number(p.gamma || 1));
      [r, g, b] = [r, g, b].map((v) => 255 * clamp((v - lo) / (hi - lo)) ** (1 / gamma));
    }
    if (effect.type === "curves") [r, g, b] = [r, g, b].map((v) => curve[clamp(Math.round(v), 0, 255)]);
    if (["levels", "curves"].includes(effect.type) && p.channel && p.channel !== "rgb") {
      const selected = { red: 0, green: 1, blue: 2 }[p.channel], changed = [r, g, b];
      [r, g, b] = originalChannels.map((v, k) => k === selected ? changed[k] : v);
    }
    if (smooth) {
      const amount = Number(p.amount ?? 1);
      r += (r - smooth[i]) * amount;
      g += (g - smooth[i + 1]) * amount;
      b += (b - smooth[i + 2]) * amount;
    }
    if (effect.type === "gradient-map") {
      const t = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, a = hexRgb(p.from || "#10152e"), z = hexRgb(p.to || "#f5d8aa");
      [r, g, b] = a.map((v, k) => v + (z[k] - v) * t);
    }
    if (effect.type === "lut" && lut) {
      const n = lut.size, rr = clamp(r / 255) * (n - 1), gg = clamp(g / 255) * (n - 1), bb = clamp(b / 255) * (n - 1), base = [Math.floor(rr), Math.floor(gg), Math.floor(bb)], frac = [rr - base[0], gg - base[1], bb - base[2]], rgb = [0, 0, 0];
      for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
        const k = (Math.min(n - 1, base[2] + z) * n * n + Math.min(n - 1, base[1] + y) * n + Math.min(n - 1, base[0] + x)) * 3, weight = (x ? frac[0] : 1 - frac[0]) * (y ? frac[1] : 1 - frac[1]) * (z ? frac[2] : 1 - frac[2]);
        for (let ch = 0; ch < 3; ch++) rgb[ch] += lut.values[k + ch] * 255 * weight;
      }
      [r, g, b] = rgb;
    }
    d[i] = clamp(r, 0, 255);
    d[i + 1] = clamp(g, 0, 255);
    d[i + 2] = clamp(b, 0, 255);
  }
  ctx.putImageData(im, 0, 0);
  return c;
}
function hexRgb(value) {
  const hex = value.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
}
function applyEffect(source, effect) {
  if (effect.enabled === false) return source;
  const p = effect.params || {};
  if (effect.type === "blur") return blur(source, p.radius || 0);
  if (effect.type === "mosaic") {
    const c = canvas(source.width, source.height), ctx = c.getContext("2d"), size = Math.max(2, p.size || 12), small = canvas(Math.ceil(c.width / size), Math.ceil(c.height / size));
    small.getContext("2d").drawImage(source, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, c.width, c.height);
    return c;
  }
  if (effect.type === "hue") {
    const c = canvas(source.width, source.height), ctx = c.getContext("2d");
    ctx.filter = `hue-rotate(${Number(p.hue || 0)}deg) saturate(${Math.max(0, Number(p.saturation ?? 100))}%)`;
    ctx.drawImage(source, 0, 0);
    return c;
  }
  return processPixels(source, effect);
}
function histogram(source) {
  const d = source.getContext("2d").getImageData(0, 0, source.width, source.height).data, bins = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]) bins[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
  return bins;
}
function parseCube(text) {
  let size = 0;
  const values = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    if (line.startsWith("LUT_3D_SIZE")) size = Number(line.split(/\s+/)[1]);
    else if (/^[-+.\d]/.test(line)) values.push(...line.split(/\s+/).map(Number));
    else if (/^DOMAIN_/.test(line) && !/^DOMAIN_MIN\s+0\s+0\s+0$|^DOMAIN_MAX\s+1\s+1\s+1$/.test(line)) throw new Error("LUT의 입력 범위는 0~1이어야 합니다.");
  }
  if (size < 2 || size > 32 || values.length !== size ** 3 * 3 || !values.every(Number.isFinite)) throw new Error("올바른 3D .cube LUT가 아닙니다.");
  return { size, values };
}
function decontaminate(source, mask) {
  const out = copy(source), ctx = out.getContext("2d"), image = ctx.getImageData(0, 0, out.width, out.height), alpha = mask.getContext("2d").getImageData(0, 0, mask.width, mask.height).data;
  const trusted = canvas(out.width, out.height), tc = trusted.getContext("2d"), clean = tc.createImageData(out.width, out.height);
  for (let i = 0; i < image.data.length; i += 4) {
    if (alpha[i + 3] > 240) {
      clean.data[i] = image.data[i];
      clean.data[i + 1] = image.data[i + 1];
      clean.data[i + 2] = image.data[i + 2];
      clean.data[i + 3] = 255;
    }
  }
  tc.putImageData(clean, 0, 0);
  const colors = blur(trusted, 4).getContext("2d").getImageData(0, 0, out.width, out.height).data;
  for (let i = 0; i < image.data.length; i += 4) {
    const a = alpha[i + 3];
    if (a > 0 && a < 250 && colors[i + 3] > 4) {
      const weight = 1 - a / 255;
      for (let k = 0; k < 3; k++) image.data[i + k] = image.data[i + k] * (1 - weight) + colors[i + k] * weight;
    }
  }
  ctx.putImageData(image, 0, 0);
  return out;
}
export {
  applyEffect,
  blobOf,
  blur,
  canvas,
  colorSelection,
  copy,
  curveTable,
  decode,
  decontaminate,
  hexRgb,
  histogram,
  invertMask,
  maskCombine,
  maskMorph,
  parseCube,
  pathShape,
  processPixels,
  traceBezier
};
