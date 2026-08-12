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

    const total = audio.length / 16000;
    // cada chunk cobre ~20s úteis (30s - 2x5s de stride)
    const expectedChunks = Math.max(1, Math.ceil(total / 20));
    let seen = 0;
    const resetProgress = () => {
      seen = 0;
    };
    const chunk_callback = () => {
      seen += 1;
      post({ type: "progress", progress: Math.min(0.99, seen / expectedChunks) });
    };

    const base = {
      chunk_length_s: 30,
      stride_length_s: 5,
      chunk_callback,
      ...(language ? { language, task: "transcribe" } : {}),
    };

    let words: { word: string; start: number; end: number }[] = [];
    let result: { text: string; chunks?: Chunk[] };

    try {
      // 1ª tentativa: timestamps por PALAVRA (blocos curtos estilo CapCut)
      result = (await model(audio, { ...base, return_timestamps: "word" })) as {
        text: string;
        chunks?: Chunk[];
      };
      words = (result.chunks ?? [])
        .filter((c) => c.text.trim().length > 0 && typeof c.timestamp?.[0] === "number")
        .map((c) => ({
          word: c.text.trim(),
          start: c.timestamp[0] ?? 0,
          end: c.timestamp[1] ?? Math.min(total, (c.timestamp[0] ?? 0) + 0.3),
        }));
    } catch {
      words = [];
      result = { text: "" };
    }

    if (words.length === 0) {
      // fallback: timestamps por frase
      resetProgress();
      result = (await model(audio, { ...base, return_timestamps: true })) as {
        text: string;
        chunks?: Chunk[];
      };
    }

    post({ type: "progress", progress: 1 });
    post({ type: "stage", stage: "finalize" });


    // segmentos por frase: das palavras (agrupando por pontuação forte) ou dos chunks
    let segments: { start: number; end: number; text: string }[];
    if (words.length) {
      segments = [];
      let buf: typeof words = [];
      for (const w of words) {
        buf.push(w);
        if (/[.!?…]$/.test(w.word) || buf.length >= 18) {
          segments.push({
            start: buf[0].start,
            end: buf[buf.length - 1].end,
            text: buf.map((b) => b.word).join(" "),
          });
          buf = [];
        }
      }
      if (buf.length) {
        segments.push({
          start: buf[0].start,
          end: buf[buf.length - 1].end,
          text: buf.map((b) => b.word).join(" "),
        });
      }
    } else {
      segments = (result.chunks ?? [])
        .map((c) => ({
          start: c.timestamp[0] ?? 0,
          end: c.timestamp[1] ?? Math.min(total, (c.timestamp[0] ?? 0) + 3),
          text: c.text,
        }))
        .filter((s) => s.text.trim().length > 0);
    }

    post({
      type: "done",
      segments: segments.length ? segments : [{ start: 0, end: total, text: result.text }],
      words,
    });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : "Falha na transcrição." });
  }
};

