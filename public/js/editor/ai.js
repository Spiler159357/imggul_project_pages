import { uid, clone, newLayer, PRESETS } from "./model.js";
import { canvas, copy, decode, blobOf } from "./bitmap.js";
import { NAI_MODEL_PROFILES, buildNovelAiBaseParameters, getNovelAiInpaintModel } from "../nai-models.js?v=novelai-v5-20260823d";
import { calculateNovelAiRepeatedRequestCost } from "../nai-pricing.js?v=novelai-v5-20260823d";
const MODELS = Object.entries(NAI_MODEL_PROFILES).map(([id, p]) => [id, p.label]);
function estimate(settings, width, height, subscription = null) {
  const profile = NAI_MODEL_PROFILES[settings.model];
  return calculateNovelAiRepeatedRequestCost({ model: settings.model, parameters: { width, height, steps: settings.steps || profile.defaultSteps, n_samples: 1, mask: true, image: true, inpaintImg2ImgStrength: settings.strength }, subscription, requestCount: settings.count || 1 });
}
class InpaintSession {
  constructor(engine, notify, changed) {
    this.e = engine;
    this.notify = notify;
    this.changed = changed;
    this.running = false;
    this.status = "영역을 선택한 뒤 생성하세요.";
    this.controller = null;
  }
  cancel() {
    this.controller?.abort();
    this.status = "결과 수신 중단 · 제공자 실행/과금은 취소되지 않을 수 있습니다.";
    this.changed();
  }
  async generate(settings, approvedMaximum) {
    if (this.running) throw new Error("이미 생성 중입니다.");
    this.running = true;
    this.controller = new AbortController();
    this.changed();
    try {
      return await this.generateRequest(settings, approvedMaximum);
    } catch (error) {
      this.status = error.name === "AbortError" ? "결과 수신 중단 · 제공자 실행/과금은 취소되지 않을 수 있습니다." : `생성 실패: ${error.message}`;
      throw error;
    } finally {
      this.running = false;
      this.changed();
    }
  }
  async generateRequest(settings, approvedMaximum) {
    const e = this.e;
    await e.whenIdle();
    if (this.controller.signal.aborted) throw new DOMException("결과 수신 중단", "AbortError");
    if (!e.selection) throw new Error("재생성할 영역을 선택하세요.");
    const mask = copy(e.selection), data = mask.getContext("2d").getImageData(0, 0, mask.width, mask.height);
    if (!data.data.some((v, i) => i % 4 === 3 && v)) throw new Error("선택 영역이 비어 있습니다.");
    const sourceRevision = e.revision;
    const snapshot = clone(e.doc), source = e.renderer.render(snapshot, settings.input === "original" ? { original: true } : {}), stateId = e.stateId;
    const opaqueMask = canvas(mask.width, mask.height), mctx = opaqueMask.getContext("2d"), pixels = mctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = data.data[i + 3];
      pixels.data[i + 3] = 255;
    }
    mctx.putImageData(pixels, 0, 0);
    const image = source.toDataURL("image/png").split(",")[1], maskPayload = opaqueMask.toDataURL("image/png").split(",")[1];
    snapshot.candidates = [];
    snapshot.assets = {};
    const remap = /* @__PURE__ */ new Map();
    const frozen = (id) => {
      if (!id) return id;
      if (!remap.has(id)) remap.set(id, e.register(copy(e.assets.get(id).canvas)));
      return remap.get(id);
    };
    snapshot.originalAssetId = frozen(snapshot.originalAssetId);
    for (const layer of snapshot.layers) {
      if (layer.data.assetId) layer.data.assetId = frozen(layer.data.assetId);
      if (layer.mask) layer.mask.assetId = frozen(layer.mask.assetId);
    }
    e.retainedDocuments.add(snapshot);
    try {
      for (let index = 0; index < Math.min(8, Math.max(1, settings.count)); index++) {
        if (this.controller.signal.aborted) break;
        const subscription = await window.refreshNovelAiSubscription?.({ force: true }), cost = estimate({ ...settings, count: 1 }, snapshot.width, snapshot.height, subscription);
        if (cost.maximum > approvedMaximum) {
          this.status = `예상 비용이 ${cost.maximum} Anlas/회로 변경됐습니다. 설정과 비용을 확인한 뒤 다시 생성하세요.`;
          break;
        }
        this.status = `생성 응답 대기 ${index + 1}/${settings.count}`;
        this.changed();
        const seed = settings.seed < 0 ? crypto.getRandomValues(new Uint32Array(1))[0] : Number(settings.seed) + index >>> 0;
        const base = buildNovelAiBaseParameters({ model: settings.model, width: snapshot.width, height: snapshot.height, steps: settings.steps, scale: settings.scale, seed, negativePrompt: settings.negative });
        Object.assign(base.parameters, { image, mask: maskPayload, add_original_image: true, extra_noise_seed: seed, inpaintImg2ImgStrength: settings.strength });
        if (settings.strength < 1) base.parameters.img2img = { strength: settings.strength, color_correct: true };
        if (!base.profile.supportsStructuredPrompt) {
          base.parameters.strength = settings.strength;
          base.parameters.noise = 0;
        } else {
          base.parameters.v4_prompt = { caption: { base_caption: settings.prompt, char_captions: [] }, use_coords: false, use_order: true };
          base.parameters.v4_negative_prompt = { caption: { base_caption: settings.negative, char_captions: [] }, use_coords: false, use_order: true };
        }
        const body = { input: settings.prompt, model: getNovelAiInpaintModel(settings.model), action: "infill", parameters: base.parameters };
        if (base.profile.family === "v5") body.use_new_shared_trial = true;
        const timer = setTimeout(() => this.controller.abort(), 17e4);
        let result;
        try {
          const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json", "X-Request-Id": uid() }, body: JSON.stringify(body), signal: this.controller.signal });
          if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || `생성 실패 (${response.status})`);
          }
          result = await response.blob();
        } finally {
          clearTimeout(timer);
        }
        if (this.controller.signal.aborted) break;
        if (!window.JSZip) throw new Error("생성 결과 압축 해제 도구를 찾을 수 없습니다.");
        const zip = await window.JSZip.loadAsync(result), entry = Object.values(zip.files).find((f) => !f.dir && /\.(png|webp|jpe?g)$/i.test(f.name));
        if (!entry) throw new Error("생성 결과 이미지가 없습니다.");
        const bitmap = await decode(await entry.async("blob"));
        if (bitmap.width !== snapshot.width || bitmap.height !== snapshot.height) throw new Error("생성 응답 규격이 작업 규격과 다릅니다.");
        await e.whenIdle();
        if (this.controller.signal.aborted) break;
        const assetId = e.register(bitmap), maskId = e.register(copy(mask)), candidate = { id: uid(), assetId, maskId, width: snapshot.width, height: snapshot.height, sourceState: stateId, sourceRevision, sourceDocument: snapshot, documentId: snapshot.id, settings: { ...settings, seed }, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
        e.transaction("AI 후보 보관", () => e.doc.candidates.push(candidate));
        this.status = `후보 ${index + 1} 준비됨 · 레이어로 추가하면 적용됩니다.`;
        this.changed();
      }
    } catch (error) {
      this.status = error.name === "AbortError" ? "결과 수신 중단 · 제공자 실행/과금은 취소되지 않을 수 있습니다." : `생성 실패: ${error.message}`;
      throw error;
    } finally {
      e.retainedDocuments.delete(snapshot);
      e.collect();
      this.running = false;
      this.changed();
    }
  }
  add(candidate) {
    const e = this.e;
    if (!candidate) throw new Error("후보를 찾을 수 없습니다.");
    if (candidate.width !== e.doc.width || candidate.height !== e.doc.height) throw new Error("요청 당시와 문서 규격이 다릅니다. 같은 규격의 복제 작업에서 후보를 여세요.");
    const l = newLayer("image", candidate.width, candidate.height, { assetId: candidate.assetId, generation: clone(candidate.settings) });
    l.name = "AI 수정 결과";
    l.mask = { assetId: e.register(copy(e.assets.get(candidate.maskId).canvas)), enabled: true, linked: true, density: 1, feather: 0 };
    e.transaction("AI 결과 레이어 추가", () => e.doc.layers.push(l));
    e.selected = [l.id];
    e.emit();
  }
}
export {
  InpaintSession,
  MODELS,
  estimate
};
