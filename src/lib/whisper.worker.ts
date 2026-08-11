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

async function ensureModel() {
  if (asr) return asr;
  const post = (data: unknown) => (self as unknown as Worker).postMessage(data);
  const load = async (device: "webgpu" | "wasm") =>
    (await pipeline("automatic-speech-recognition", "onnx-community/whisper-small", {
      device,
      dtype: device === "webgpu" ? "fp16" : "q8",
      progress_callback: (p: { status: string; progress?: number; file?: string }) => {
        if (p.status === "progress" && typeof p.progress === "number") {
          post({ type: "download", progress: p.progress / 100, file: p.file });
        }
      },
    })) as AutomaticSpeechRecognitionPipeline;

  try {
    const hasGpu = "gpu" in navigator && Boolean(await (navigator as never as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter());
    asr = await load(hasGpu ? "webgpu" : "wasm");
  } catch {
    asr = await load("wasm");
  }
  return asr;
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
