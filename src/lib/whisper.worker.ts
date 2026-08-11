/// <reference lib="webworker" />
/**
 * Transcrição local com Whisper (Transformers.js).
 * Roda em Web Worker: nada sai do dispositivo e a interface não trava.
 */
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

type InMsg = {
  type: "transcribe";
  audio: Float32Array;
  language?: string;
};

type Chunk = { timestamp: [number, number | null]; text: string };

let asr: AutomaticSpeechRecognitionPipeline | null = null;

type Attempt = { model: string; device: "webgpu" | "wasm"; dtype: "fp16" | "fp32" | "q8" };

async function hasWebGPU() {
  try {
    return (
      "gpu" in navigator &&
      Boolean(await (navigator as never as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter())
    );
  } catch {
    return false;
  }
}

async function ensureModel() {
  if (asr) return asr;
  const post = (data: unknown) => (self as unknown as Worker).postMessage(data);

  const attempts: Attempt[] = [];
  if (await hasWebGPU()) {
    attempts.push({ model: "onnx-community/whisper-base", device: "webgpu", dtype: "fp16" });
  }
  attempts.push({ model: "onnx-community/whisper-base", device: "wasm", dtype: "fp32" });
  attempts.push({ model: "onnx-community/whisper-tiny", device: "wasm", dtype: "fp32" });
  attempts.push({ model: "onnx-community/whisper-tiny", device: "wasm", dtype: "q8" });

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      post({ type: "stage", stage: "model", model: attempt.model });
      asr = (await pipeline("automatic-speech-recognition", attempt.model, {
        device: attempt.device,
        dtype: attempt.dtype,
        progress_callback: (p: { status: string; progress?: number; file?: string }) => {
          if (p.status === "progress" && typeof p.progress === "number") {
            post({ type: "download", progress: p.progress / 100, file: p.file, model: attempt.model });
          }
        },
      })) as AutomaticSpeechRecognitionPipeline;
      return asr;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Não foi possível carregar o modelo de legendas neste navegador. ${
      lastError instanceof Error ? lastError.message : ""
    }`.trim(),
  );
}


self.onmessage = async (event: MessageEvent<InMsg>) => {
  const post = (data: unknown) => (self as unknown as Worker).postMessage(data);
  const { audio, language } = event.data;
  try {
    post({ type: "stage", stage: "model" });
    const model = await ensureModel();
    post({ type: "stage", stage: "transcribe" });
    const result = (await model(audio, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(language ? { language, task: "transcribe" } : {}),
    })) as { text: string; chunks?: Chunk[] };

    const total = audio.length / 16000;
    const segments = (result.chunks ?? [])
      .map((c) => ({
        start: c.timestamp[0] ?? 0,
        end: c.timestamp[1] ?? Math.min(total, (c.timestamp[0] ?? 0) + 3),
        text: c.text,
      }))
      .filter((s) => s.text.trim().length > 0);

    post({ type: "done", segments: segments.length ? segments : [{ start: 0, end: total, text: result.text }] });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : "Falha na transcrição." });
  }
};
