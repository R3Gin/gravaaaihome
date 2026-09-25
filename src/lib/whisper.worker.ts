/// <reference lib="webworker" />
/**
 * Transcrição local com Whisper (Transformers.js).
 * Roda em Web Worker: nada sai do dispositivo e a interface não trava.
 *
 * O worker fica vivo entre transcrições (ver captions.ts), então o modelo é
 * carregado uma vez só por sessão.
 */
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

type InMsg = {
  type: "transcribe";
  audio: Float32Array;
  language?: string;
  /** ignora a GPU (usado quando a tentativa na GPU gerou texto inválido) */
  forceWasm?: boolean;
};

type Chunk = { timestamp: [number, number | null]; text: string };
type Word = { word: string; start: number; end: number };
type Segment = { start: number; end: number; text: string };

type Device = "webgpu" | "wasm";
type Dtype = "fp32" | "fp16" | "q8" | "q4";
type Attempt = {
  model: string;
  device: Device;
  dtype: Dtype | { encoder_model: Dtype; decoder_model_merged: Dtype };
};

const post = (data: unknown) => (self as unknown as Worker).postMessage(data);

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let asrDevice: Device | null = null;
/** chamado a cada janela de 30s decodificada (progresso real) */
let onChunkDone: (() => void) | null = null;

async function hasWebGPU() {
  try {
    return (
      "gpu" in navigator &&
      Boolean(
        await (navigator as never as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter(),
      )
    );
  } catch {
    return false;
  }
}

async function disposeModel() {
  const old = asr;
  asr = null;
  asrDevice = null;
  try {
    await old?.dispose();
  } catch {
    /* nada a liberar */
  }
}

/*
 * Os modelos "_timestamped" trazem as cabeças de alinhamento, então UMA única
 * passada devolve texto + tempo de cada palavra (antes eram duas passadas
 * completas, o que dobrava o tempo). O encoder fica em fp32 porque quantizá-lo
 * estraga a transcrição; o decoder quantizado é bem menor e mais rápido.
 */
async function ensureModel(forceWasm: boolean) {
  if (asr && !(forceWasm && asrDevice === "webgpu")) return asr;
  await disposeModel();

  const attempts: Attempt[] = [];
  if (!forceWasm && (await hasWebGPU())) {
    attempts.push({
      model: "onnx-community/whisper-base_timestamped",
      device: "webgpu",
      dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
    });
  }
  attempts.push(
    {
      model: "onnx-community/whisper-base_timestamped",
      device: "wasm",
      dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
    },
    // reservas: os modelos que já eram usados antes (só frases, sem tempo por palavra)
    { model: "onnx-community/whisper-base", device: "wasm", dtype: "fp32" },
    { model: "onnx-community/whisper-tiny", device: "wasm", dtype: "q8" },
  );

  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      post({ type: "stage", stage: "model", model: attempt.model });
      const loaded = (await pipeline("automatic-speech-recognition", attempt.model, {
        device: attempt.device,
        dtype: attempt.dtype,
        progress_callback: (p: { status: string; progress?: number; file?: string }) => {
          if (p.status === "progress" && typeof p.progress === "number") {
            post({ type: "download", progress: p.progress / 100, file: p.file, model: attempt.model });
          }
        },
      })) as AutomaticSpeechRecognitionPipeline;

      // o pipeline chama generate() uma vez por janela de 30s: é o nosso progresso
      const model = loaded.model as unknown as { generate: (...a: unknown[]) => Promise<unknown> };
      const generate = model.generate.bind(model);
      model.generate = async (...args: unknown[]) => {
        const out = await generate(...args);
        onChunkDone?.();
        return out;
      };

      console.info("[legendas] modelo carregado:", attempt.model, attempt.device);
      asr = loaded;
      asrDevice = attempt.device;
      return asr;
    } catch (err) {
      console.warn("[legendas] falha ao carregar", attempt.model, attempt.device, err);
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
function segmentsFromChunks(chunks: Chunk[], total: number): Segment[] {
  const usable = chunks.filter((c) => (c.text ?? "").trim().length > 0);
  if (usable.length === 0) return [];

  const hasTiming = usable.some((c) => typeof c.timestamp?.[0] === "number");
  if (!hasTiming) {
    const totalChars = usable.reduce((n, c) => n + c.text.trim().length, 0) || 1;
    let cursor = 0;
    return usable.map((c) => {
      const share = (c.text.trim().length / totalChars) * total;
      const start = cursor;
      cursor = Math.min(total, cursor + share);
      return { start, end: Math.max(start + 0.2, cursor), text: c.text.trim() };
    });
  }

  const out: Segment[] = [];
  for (let i = 0; i < usable.length; i++) {
    const c = usable[i]!;
    const prev = out[out.length - 1];
    const start = typeof c.timestamp?.[0] === "number" ? c.timestamp[0]! : (prev?.end ?? 0);
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

function wordsFromChunks(chunks: Chunk[], total: number): Word[] {
  return chunks
    .filter((c) => (c.text ?? "").trim().length > 0 && typeof c.timestamp?.[0] === "number")
    .map((c) => {
      const start = c.timestamp[0] ?? 0;
      const end = typeof c.timestamp[1] === "number" ? c.timestamp[1] : Math.min(total, start + 0.3);
      return { word: c.text.trim(), start, end: Math.max(end, start + 0.05) };
    });
}

/** frases a partir das palavras: quebra em pontuação forte, pausa longa ou ~8s */
function segmentsFromWords(words: Word[]): Segment[] {
  const out: Segment[] = [];
  let buf: Word[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    out.push({
      start: buf[0]!.start,
      end: buf[buf.length - 1]!.end,
      text: buf.map((w) => w.word).join(" "),
    });
    buf = [];
  };
  for (const w of words) {
    const last = buf[buf.length - 1];
    if (last && (w.start - last.end > 0.8 || w.end - buf[0]!.start > 8)) flush();
    buf.push(w);
    if (/[.!?…]["')\]]?$/.test(w.word)) flush();
  }
  flush();
  return out;
}

self.onmessage = async (event: MessageEvent<InMsg>) => {
  const { audio, language, forceWasm = false } = event.data;
  try {
    post({ type: "stage", stage: "model" });
    const model = await ensureModel(forceWasm);
    post({ type: "stage", stage: "transcribe" });

    const total = audio.length / 16000;
    // janelas de 30s andando 20s (30 - 2x5 de sobreposição), igual ao pipeline
    const expectedChunks = total <= 30 ? 1 : 1 + Math.ceil((total - 30) / 20);
    let seen = 0;
    onChunkDone = () => {
      seen += 1;
      post({ type: "progress", progress: Math.min(0.99, seen / expectedChunks) });
    };
    post({ type: "progress", progress: 0 });

    const base = {
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(language ? { language, task: "transcribe" } : {}),
    };

    let segments: Segment[] = [];
    let words: Word[] = [];
    let text = "";

    // 1) uma passada só, com tempo por palavra (as frases saem das palavras)
    try {
      const r = (await model(audio, { ...base, return_timestamps: "word" })) as {
        text?: string;
        chunks?: Chunk[];
      };
      text = r.text ?? "";
      words = wordsFromChunks(r.chunks ?? [], total);
      segments = segmentsFromWords(words);
    } catch (err) {
      // 2) modelo sem alinhamento por palavra: frases com tempo
      console.warn("[legendas] tempo por palavra indisponível, usando frases:", err);
      seen = 0;
      words = [];
      try {
        const r = (await model(audio, { ...base, return_timestamps: true })) as {
          text?: string;
          chunks?: Chunk[];
        };
        text = r.text ?? "";
        segments = segmentsFromChunks(r.chunks ?? [], total);
      } catch (err2) {
        console.warn("[legendas] transcrição com timestamps falhou, tentando sem:", err2);
        seen = 0;
        const r = (await model(audio, base)) as { text?: string };
        text = r.text ?? "";
      }
    }

    // sem chunks mas com texto: um bloco cobrindo o áudio (melhor que erro)
    if (segments.length === 0 && text.trim().length > 0) {
      segments = [{ start: 0, end: Math.max(0.5, total), text: text.trim() }];
    }

    post({ type: "progress", progress: 1 });
    post({ type: "stage", stage: "finalize" });

    console.info(
      "[legendas] worker:",
      asrDevice,
      "| segmentos =",
      segments.length,
      "| palavras =",
      words.length,
      "| duração áudio =",
      total.toFixed(2),
      "s",
    );

    post({ type: "done", segments, words, device: asrDevice });
  } catch (err) {
    // falha no meio da inferência na GPU: descarta o modelo para a próxima tentativa ir pela CPU
    const onGpu = asrDevice === "webgpu";
    if (onGpu) await disposeModel();
    post({
      type: "error",
      message: err instanceof Error ? err.message : "Falha na transcrição.",
      retryOnCpu: onGpu,
    });
  } finally {
    onChunkDone = null;
  }
};
