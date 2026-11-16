let pipelinePromise;
self.addEventListener("message", async (event) => {
  const { width, height, pixels } = event.data;
  try {
    if (![1216 * 832, 1024 * 1024].includes(width * height)) throw new Error("지원 규격이 아닙니다.");
    const { pipeline, RawImage, env } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js");
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;
    pipelinePromise ??= pipeline("background-removal", "Xenova/modnet", {
      dtype: "fp32",
      device: "wasm",
      progress_callback: (progress) => self.postMessage({ status: "progress", message: progress.status === "progress" ? `모델 로딩 ${Math.round(progress.progress || 0)}%` : "피사체 모델 준비 중" })
    });
    const segmenter = await pipelinePromise;
    self.postMessage({ status: "progress", message: "기기에서 피사체 마스크 계산 중" });
    const image = new RawImage(new Uint8ClampedArray(pixels), width, height, 4);
    const results = await segmenter(image), mask = results[0];
    if (!mask?.data || !mask.width || !mask.height) throw new Error("피사체 마스크가 비어 있습니다.");
    const data = new Uint8Array(mask.data);
    self.postMessage({ status: "result", width: mask.width, height: mask.height, channels: mask.channels, pixels: data.buffer }, [data.buffer]);
  } catch (error) {
    self.postMessage({ status: "error", message: error.message || "피사체 분리 실패" });
  }
});
