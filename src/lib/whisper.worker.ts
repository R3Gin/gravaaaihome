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
      console.warn("[legendas] falha ao carregar", attempt.model, attempt.device, attempt.dtype, err);
      lastError = err;
    }
  }
  throw new Error(
    `Não foi possível carregar o modelo de legendas neste navegador. ${
      lastError instanceof Error ? lastError.message : ""
    }`.trim(),
  );
}

/**
 * Converte os chunks do Whisper em segmentos com tempo garantido.
 * Blocos sem fim herdam o início do próximo (ou o fim do áudio); se nenhum
 * bloco tiver tempo, o texto é distribuído proporcionalmente na duração.
 */
function segmentsFromChunks(chunks: Chunk[], total: number) {
  const usable = chunks.filter((c) => (c.text ?? "").trim().length > 0);
  if (usable.length === 0) return [];

  const hasTiming = usable.some((c) => typeof c.timestamp?.[0] === "number");
  if (!hasTiming) {
    // sem nenhum timestamp: reparte pelo tamanho do texto
    const totalChars = usable.reduce((n, c) => n + c.text.trim().length, 0) || 1;
    let cursor = 0;
    return usable.map((c) => {
      const share = (c.text.trim().length / totalChars) * total;
      const start = cursor;
      cursor = Math.min(total, cursor + share);
      return { start, end: Math.max(start + 0.2, cursor), text: c.text.trim() };
    });
  }

  const out: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < usable.length; i++) {
    const c = usable[i]!;
    const prev = out[out.length - 1];
    const start =
      typeof c.timestamp?.[0] === "number" ? c.timestamp[0]! : (prev?.end ?? 0);
    let end = typeof c.timestamp?.[1] === "number" ? c.timestamp[1]! : NaN;
    if (!Number.isFinite(end) || end <= start) {
      const nextStart = usable
        .slice(i + 1)
        .map((n) => n.timestamp?.[0])
        .find((t): t is number => typeof t === "number");
      end = Number.isFinite(nextStart) ? nextStart! : total;
    }
    if (!(end > start)) end = Math.min(total, start + 2);
    out.push({ start, end, text: c.text.trim() });
  }
  return out;
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

    // 1) caminho estável: timestamps por FRASE
    let result: { text?: string; chunks?: Chunk[] };
    try {
      result = (await model(audio, { ...base, return_timestamps: true })) as {
        text?: string;
        chunks?: Chunk[];
      };
    } catch (err) {
      console.warn("[legendas] transcrição com timestamps falhou, tentando sem:", err);
      result = (await model(audio, base)) as { text?: string; chunks?: Chunk[] };
    }

    let segments = segmentsFromChunks(result.chunks ?? [], total);

    // sem chunks mas com texto: um bloco cobrindo o áudio (melhor que erro)
    if (segments.length === 0 && (result.text ?? "").trim().length > 0) {
      segments = [{ start: 0, end: Math.max(0.5, total), text: (result.text ?? "").trim() }];
    }

    post({ type: "progress", progress: 1 });
    post({ type: "stage", stage: "finalize" });

    if (segments.length === 0) {
      post({
        type: "error",
        message:
          "O modelo não encontrou fala neste áudio. Verifique se há voz audível ou use “Marcar blocos de fala”.",
      });
      return;
    }

    // 2) enriquecimento opcional: timestamps por PALAVRA (blocos curtos estilo Reels)
    let words: { word: string; start: number; end: number }[] = [];
    try {
      const byWord = (await model(audio, { ...base, return_timestamps: "word" })) as {
        chunks?: Chunk[];
      };
      words = (byWord.chunks ?? [])
        .filter((c) => c.text.trim().length > 0 && typeof c.timestamp?.[0] === "number")
        .map((c) => ({
          word: c.text.trim(),
          start: c.timestamp[0] ?? 0,
          end: c.timestamp[1] ?? Math.min(total, (c.timestamp[0] ?? 0) + 0.3),
        }));
    } catch (err) {
      console.warn("[legendas] timestamps por palavra indisponíveis neste modelo:", err);
      words = [];
    }

    console.info(
      "[legendas] worker: segmentos =",
      segments.length,
      "| palavras =",
      words.length,
      "| duração áudio =",
      total.toFixed(2),
      "s",
    );

    post({ type: "done", segments, words });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : "Falha na transcrição." });
  }
};
