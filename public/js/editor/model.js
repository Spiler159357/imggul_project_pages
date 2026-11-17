const PRESETS = Object.freeze({ landscape: [1216, 832], square: [1024, 1024], portrait: [832, 1216] });
const BLENDS = ["source-over", "multiply", "screen", "overlay", "soft-light", "hard-light", "darken", "lighten", "difference", "hue", "saturation", "color", "luminosity"];
const uid = () => crypto.randomUUID();
const clone = (value) => structuredClone(value);
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number(value) || 0));
const identity = () => [1, 0, 0, 1, 0, 0];
function presetFor(width, height) {
  return Object.keys(PRESETS).find((key) => PRESETS[key][0] === width && PRESETS[key][1] === height);
}
function newDocument(preset = "square", projectId = "", prefix = "") {
  const [width, height] = PRESETS[preset] || PRESETS.square;
  return { schemaVersion: 1, id: uid(), projectId, prefix, title: "제목 없음", width, height, preset, sourceKey: "", layers: [], assets: {}, background: "transparent" };
}
function newLayer(type, width, height, data = {}) {
  return {
    id: uid(),
    name: { image: "이미지", paint: "페인트", text: "텍스트", shape: "도형", adjustment: "색 보정", group: "그룹", path: "패스" }[type] || type,
    type,
    width,
    height,
    parentId: null,
    visible: true,
    locked: false,
    alphaLock: false,
    opacity: 1,
    blend: "source-over",
    matrix: identity(),
    mask: null,
    clip: false,
    effects: [],
    style: {},
    data
  };
}
function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function inverse(m) {
  const d = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(d) < 1e-9) throw new Error("크기가 0인 변형은 사용할 수 없습니다.");
  return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d];
}
const point = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
function worldMatrix(doc, layer, depth = 0) {
  if (depth > 64) throw new Error("그룹 깊이를 초과했습니다.");
  const parent = doc.layers.find((item) => item.id === layer.parentId);
  return parent ? multiply(worldMatrix(doc, parent, depth + 1), layer.matrix) : layer.matrix;
}
function validateDocument(doc) {
  if (!doc || doc.schemaVersion !== 1 || !/^[a-zA-Z0-9_-]{1,80}$/.test(doc.id || "") || presetFor(doc.width, doc.height) !== doc.preset) throw new Error("지원하지 않는 편집 문서입니다.");
  if (!Array.isArray(doc.layers) || doc.layers.length > 200 || !doc.assets || typeof doc.assets !== "object" || Array.isArray(doc.assets)) throw new Error("레이어 또는 자산 정보가 잘못되었습니다.");
  const ids = /* @__PURE__ */ new Set();
  for (const layer of doc.layers) {
    if (ids.has(layer.id) || !/^[a-zA-Z0-9_-]{1,80}$/.test(layer.id || "") || !["image", "paint", "text", "shape", "adjustment", "group", "path"].includes(layer.type)) throw new Error("레이어 정보가 잘못되었습니다.");
    ids.add(layer.id);
    if (!Array.isArray(layer.matrix) || layer.matrix.length !== 6 || !layer.matrix.every(Number.isFinite) || !Number.isFinite(layer.width) || !Number.isFinite(layer.height) || layer.width < 1 || layer.height < 1 || layer.width > 1216 || layer.height > 1216 || !BLENDS.includes(layer.blend)) throw new Error("레이어 크기/변형이 잘못되었습니다.");
    if (Math.abs(layer.matrix[0] * layer.matrix[3] - layer.matrix[1] * layer.matrix[2]) < 1e-9) throw new Error("레이어 배율이 0입니다.");
    if (!Array.isArray(layer.effects) || layer.effects.length > 20) throw new Error("효과 수를 초과했습니다.");
    if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 || !layer.data || typeof layer.data !== "object") throw new Error("레이어 속성이 잘못되었습니다.");
    if (layer.type === "path" && (!Array.isArray(layer.data.points) || layer.data.points.length > 1e3 || layer.data.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) throw new Error("패스 앵커가 잘못되었습니다.");
    if (layer.mask && (!Number.isFinite(layer.mask.density) || layer.mask.density < 0 || layer.mask.density > 1 || !Number.isFinite(layer.mask.feather) || layer.mask.feather < 0 || layer.mask.feather > 50)) throw new Error("마스크 속성이 잘못되었습니다.");
    if (layer.data.warp && (!Array.isArray(layer.data.warp) || layer.data.warp.length !== 9 || layer.data.warp.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) throw new Error("워프 점이 잘못되었습니다.");
    for (const axis of ["perspectiveX", "perspectiveY"]) if (layer.data[axis] !== void 0 && (!Number.isFinite(layer.data[axis]) || Math.abs(layer.data[axis]) > 80)) throw new Error("원근 범위를 초과했습니다.");
    if (layer.vectorMask && (!Array.isArray(layer.vectorMask.points) || layer.vectorMask.points.length < 2 || layer.vectorMask.points.length > 1e3 || layer.vectorMask.points.some((p) => ["x", "y", "inX", "inY", "outX", "outY"].some((k) => p[k] !== void 0 && !Number.isFinite(p[k]))))) throw new Error("벡터 마스크 좌표가 잘못되었습니다.");
    for (const effect of layer.effects) {
      if (!effect.params || typeof effect.params !== "object") throw new Error("효과 설정이 잘못되었습니다.");
      if (effect.type === "curves" && (!Array.isArray(effect.params.points) || effect.params.points.length < 2 || effect.params.points.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((v) => !Number.isFinite(v) || v < 0 || v > 255)))) throw new Error("커브 점은 0~255 좌표의 쌍이어야 합니다.");
    }
  }
  for (const layer of doc.layers) {
    const seen = /* @__PURE__ */ new Set([layer.id]);
    let parentId = layer.parentId;
    while (parentId) {
      const parent = doc.layers.find((item) => item.id === parentId);
      if (!parent || parent.type !== "group" || seen.has(parent.id) || seen.size > 64) throw new Error("그룹 관계가 잘못되었습니다.");
      seen.add(parent.id);
      parentId = parent.parentId;
    }
  }
  return doc;
}
export {
  BLENDS,
  PRESETS,
  clamp,
  clone,
  identity,
  inverse,
  multiply,
  newDocument,
  newLayer,
  point,
  presetFor,
  uid,
  validateDocument,
  worldMatrix
};
