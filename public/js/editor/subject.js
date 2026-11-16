import { canvas } from "./bitmap.js";
import { presetFor } from "./model.js";
function segmentSubject(source, onProgress, signal) {
  if (!presetFor(source.width, source.height)) return Promise.reject(new Error("지원하지 않는 이미지 규격입니다."));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./subject-worker.js", import.meta.url), { type: "module" });
    const finish = (error, value) => {
      clearTimeout(timer);
      worker.terminate();
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(new DOMException("피사체 분리 취소", "AbortError"));
    const timer = setTimeout(() => finish(new Error("모델 로딩 또는 처리가 오래 걸립니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.")), 18e4);
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(new Error("피사체 모델을 불러오지 못했습니다. 모델 다운로드와 Worker 지원을 확인하세요."));
    worker.onmessage = (event) => {
      const result = event.data;
      if (result.status === "progress") {
        onProgress(result.message);
        return;
      }
      if (result.status === "error") {
        finish(new Error(result.message));
        return;
      }
      try {
        const c = canvas(result.width, result.height), ctx = c.getContext("2d"), image = ctx.createImageData(c.width, c.height), pixels2 = new Uint8Array(result.pixels);
        if (![1, 3, 4].includes(result.channels) || pixels2.length !== c.width * c.height * result.channels) throw new Error("마스크 데이터 규격이 잘못되었습니다.");
        for (let i = 0; i < c.width * c.height; i++) {
          image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = 255;
          image.data[i * 4 + 3] = pixels2[i * result.channels + (result.channels === 4 ? 3 : 0)];
        }
        ctx.putImageData(image, 0, 0);
        const mask = canvas(source.width, source.height);
        mask.getContext("2d").drawImage(c, 0, 0, mask.width, mask.height);
        finish(null, mask);
      } catch (error) {
        finish(error);
      }
    };
    const pixels = source.getContext("2d").getImageData(0, 0, source.width, source.height).data;
    worker.postMessage({ width: source.width, height: source.height, pixels: pixels.buffer }, [pixels.buffer]);
  });
}
export {
  segmentSubject
};
