import { decodeMono16k, detectSpeechBlocks } from "@/lib/audio-tools";
import { compactSilence, splitAudio, toSource, type CompactAudio } from "@/lib/speech-plan";

export interface CaptionSegment {
  start: number;
  end: number;
  text: string;
}

/** timing individual de cada palavra devolvido pelo Whisper */
export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface TranscribeResult {
  /** frases completas (compatível com o fluxo antigo) */
  segments: CaptionSegment[];
  /** palavras com timing — vazio se o modelo não suportar */
  words: WordTiming[];
}

export interface TranscribeEvents {
  onStage?: (stage: "audio" | "model" | "transcribe" | "finalize") => void;
  /** progresso do download do modelo (0..1) */
  onDownload?: (progress: number) => void;
  /** progresso real da transcrição (0..1) */
  onProgress?: (progress: number) => void;
}

/**
 * Transcreve o áudio inteiramente no navegador (Whisper via Web Worker).
 * Devolve frases e, quando disponível, timestamps por palavra.
 */
export async function transcribe(
  blob: Blob,
  /** idioma fixo (padrão "portuguese") ou "auto" para detecção automática */
  language: string | "auto" = "portuguese",
  events: TranscribeEvents = {},
): Promise<TranscribeResult> {
  events.onStage?.("audio");
  const audio = await decodeMono16k(blob);
  if (!audio) throw new Error("Não encontrei áudio nesse vídeo.");
  return transcribeSamples(audio, language, events);
}

/**
 * Mesma transcrição, mas a partir de PCM mono 16 kHz já montado — é o caminho
 * usado pelo editor, que envia o áudio FINAL da timeline (já com os cortes).
 */
export async function transcribeSamples(
  audio: Float32Array,
  language: string | "auto" = "portuguese",
  events: TranscribeEvents = {},
): Promise<TranscribeResult> {
  const lang = !language || language === "auto" ? undefined : language;
  if (!audio || audio.length < 16000 * 0.3) {
    throw new Error("Não encontrei áudio nesse vídeo.");
  }


  // diagnóstico do áudio extraído (16 kHz, mono, PCM float32)
  const duration = audio.length / 16000;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < audio.length; i += 7) {
    const v = Math.abs(audio[i]);
    sum += v * v;
    if (v > peak) peak = v;
  }
  const rms = Math.sqrt(sum / Math.ceil(audio.length / 7));
  console.info(
    `[legendas] áudio: ${duration.toFixed(2)}s @16000Hz mono · rms=${rms.toFixed(5)} pico=${peak.toFixed(3)}`,
  );
  if (peak < 0.005 || rms < 0.0008) {
    throw new Error(
      "O áudio deste vídeo está praticamente mudo — não há fala audível para transcrever.",
    );
  }

  // só a fala vai para o modelo: pausas longas são retiradas e os tempos voltam depois
  const compact = compactSilence(audio);
  if (compact.audio !== audio) {
    console.info(
      `[legendas] silêncio removido: ${duration.toFixed(1)}s → ${(compact.audio.length / 16000).toFixed(1)}s`,
    );
  }

  const gpu = await hasWebGPU();
  try {
    return await transcribeParts(compact, lang, duration, events, !gpu);
  } catch (err) {
    // a GPU falhou ou gerou texto inválido: tenta de novo pela CPU (mais lenta, mais estável)
    if (err instanceof GpuFailure) {
      console.warn("[legendas] tentativa na GPU falhou, repetindo na CPU:", err.cause);
      return transcribeParts(compact, lang, duration, events, true);
    }
    throw err;
  }
}

async function hasWebGPU() {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

/**
 * Quantas partes transcrever ao mesmo tempo na CPU. Sem isolamento de origem o
 * ONNX Runtime usa uma thread só por worker, então vários workers aproveitam
 * os outros núcleos. Cada um carrega o modelo (~300 MB), por isso o limite.
 */
function cpuParallelism(seconds: number) {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  const byHardware = Math.min(3, Math.floor(cores / 2), memory >= 8 ? 3 : memory >= 4 ? 2 : 1);
  const byLength = Math.floor(seconds / 45); // parte com menos de ~45s não compensa
  return Math.max(1, Math.min(byHardware, byLength));
}

async function transcribeParts(
  compact: CompactAudio,
  language: string | undefined,
  duration: number,
  events: TranscribeEvents,
  forceWasm: boolean,
): Promise<TranscribeResult> {
  const seconds = compact.audio.length / 16000;
  const parts = splitAudio(compact.audio, forceWasm ? cpuParallelism(seconds) : 1);
  if (parts.length > 1) console.info(`[legendas] transcrevendo em ${parts.length} partes paralelas`);

  const done = parts.map(() => 0);
  const weights = parts.map((p) => p.audio.length / compact.audio.length);
  const reportProgress = () =>
    events.onProgress?.(done.reduce((sum, v, i) => sum + v * weights[i]!, 0));

  // a 1ª parte carrega (e baixa, se preciso) o modelo; as outras só começam
  // depois, lendo o modelo do cache em vez de baixá-lo de novo
  let modelReady!: () => void;
  const ready = new Promise<void>((r) => (modelReady = r));
  const extras: Slot[] = [];

  let aborted = false;

  const jobs = parts.map(async (part, i) => {
    const partEvents: TranscribeEvents = {
      onStage: (stage) => {
        if (stage === "transcribe") modelReady();
        if (i === 0 && stage !== "finalize") events.onStage?.(stage);
      },
      onDownload: i === 0 ? events.onDownload : undefined,
      onProgress: (p) => {
        done[i] = p;
        reportProgress();
      },
    };
    if (i === 0) return { ...(await mainSlot.run(part.audio, language, forceWasm, partEvents)), offset: 0 };

    await ready;
    if (aborted) throw new Error("cancelado");
    const slot = new Slot();
    extras.push(slot);
    try {
      return { ...(await slot.run(part.audio, language, forceWasm, partEvents)), offset: part.offset };
    } catch (err) {
      if (aborted || err instanceof GpuFailure) throw err;
      // worker extra não aguentou (memória, por exemplo): faz esta parte no principal
      console.warn("[legendas] parte paralela falhou, refazendo no worker principal:", err);
      slot.kill();
      done[i] = 0;
      return { ...(await mainSlot.run(part.audio, language, forceWasm, partEvents)), offset: part.offset };
    }
  });

  let results: Awaited<(typeof jobs)[number]>[];
  try {
    results = await Promise.all(jobs);
  } catch (err) {
    aborted = true;
    throw err;
  } finally {
    modelReady();
    for (const s of extras) s.kill();
  }
  events.onStage?.("finalize");

  // junta as partes e leva os tempos de volta para o áudio original
  const map = (t: number, offset: number, isEnd = false) =>
    toSource(compact.pieces, t + offset, isEnd);
  const merged: TranscribeResult = {
    segments: results.flatMap((r) =>
      r.segments.map((s) => ({
        ...s,
        start: map(s.start, r.offset),
        end: map(s.end, r.offset, true),
      })),
    ),
    words: results.flatMap((r) =>
      r.words.map((w) => ({
        ...w,
        start: map(w.start, r.offset),
        end: map(w.end, r.offset, true),
      })),
    ),
  };
  try {
    return validateTranscript(merged, duration);
  } catch (err) {
    if (!forceWasm && results.some((r) => r.device === "webgpu")) {
      throw new GpuFailure("gpu", { cause: err });
    }
    throw err;
  }
}

/** erro vindo da tentativa na GPU; `cause` guarda o erro original */
class GpuFailure extends Error {}

/** sem nenhuma mensagem do worker por esse tempo = travado */
const STALL_MS = 3 * 60 * 1000;

type RawResult = TranscribeResult & { device?: "webgpu" | "wasm" };

/**
 * Um worker do Whisper com fila própria. O principal fica vivo entre
 * transcrições para não recarregar o modelo a cada clique; os extras (partes
 * paralelas) são encerrados ao fim de cada geração.
 */
class Slot {
  private worker: Worker | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  kill() {
    this.worker?.terminate();
    this.worker = null;
  }

  run(
    audio: Float32Array,
    language: string | undefined,
    forceWasm: boolean,
    events: TranscribeEvents,
  ): Promise<RawResult> {
    const job = this.queue.then(
      () =>
        new Promise<RawResult>((resolve, reject) => {
          const worker = (this.worker ??= new Worker(new URL("./whisper.worker.ts", import.meta.url), {
            type: "module",
          }));
          let timer = 0;
          const arm = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
              finish();
              this.kill();
              reject(
                new Error(
                  "A transcrição parou de responder. Feche outras abas pesadas e tente de novo, ou use “Marcar blocos de fala”.",
                ),
              );
            }, STALL_MS);
          };
          const finish = () => {
            window.clearTimeout(timer);
            worker.onmessage = null;
            worker.onerror = null;
          };

          worker.onmessage = (e: MessageEvent) => {
            arm();
            const msg = e.data as
              | { type: "stage"; stage: "model" | "transcribe" | "finalize" }
              | { type: "download"; progress: number }
              | { type: "progress"; progress: number }
              | {
                  type: "done";
                  segments: CaptionSegment[];
                  words?: WordTiming[];
                  device?: "webgpu" | "wasm";
                }
              | { type: "error"; message: string; retryOnCpu?: boolean };
            if (msg.type === "stage") events.onStage?.(msg.stage);
            if (msg.type === "download") events.onDownload?.(msg.progress);
            if (msg.type === "progress") events.onProgress?.(msg.progress);
            if (msg.type === "done") {
              finish();
              resolve({ segments: msg.segments, words: msg.words ?? [], device: msg.device });
            }
            if (msg.type === "error") {
              finish();
              const err = new Error(msg.message);
              reject(msg.retryOnCpu && !forceWasm ? new GpuFailure("gpu", { cause: err }) : err);
            }
          };
          worker.onerror = (e) => {
            console.error("[legendas] worker quebrou:", e.message);
            finish();
            this.kill();
            reject(
              forceWasm
                ? new Error("O modelo de transcrição não pôde ser carregado neste navegador.")
                : new GpuFailure("gpu", { cause: e }),
            );
          };
          arm();
          // copia: o buffer é transferido e pode ser preciso repetir na CPU
          const copy = audio.slice();
          worker.postMessage({ type: "transcribe", audio: copy, language, forceWasm }, [copy.buffer]);
        }),
    );
    this.queue = job.catch(() => undefined);
    return job;
  }
}

const mainSlot = new Slot();

const NO_SPEECH =
  "O modelo não encontrou fala neste áudio. Verifique se há voz audível ou use “Marcar blocos de fala”.";

/** texto suspeito: vazio, só símbolos/tokens especiais ou repetição infinita. */
function isJunk(text: string) {
  const t = text.trim();
  if (t.length === 0) return true;
  if (/^[<[(].*[>\])]$/.test(t)) return true; // tokens tipo <|nospeech|>, [Música]
  const letters = t.replace(/[^\p{L}\p{N}]/gu, "");
  if (letters.length === 0) return true;
  if (/^(.)\1{5,}$/u.test(letters)) return true; // "aaaaaaaa"
  return false;
}

/**
 * Descarta apenas segmentos claramente inválidos. Transcrições curtas ou com
 * poucas falas são legítimas e NÃO são rejeitadas.
 */
export function validateTranscript(
  result: TranscribeResult,
  audioDuration: number,
): TranscribeResult {
  const segments = result.segments.filter(
    (s) =>
      Number.isFinite(s.start) &&
      Number.isFinite(s.end) &&
      s.end > s.start &&
      !isJunk(s.text),
  );
  const words = result.words.filter(
    (w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.word.trim().length > 0,
  );

  console.info(
    `[legendas] whisper: ${result.segments.length} segmentos brutos → ${segments.length} válidos · ${words.length} palavras com timing · áudio ${audioDuration.toFixed(1)}s`,
  );

  if (segments.length === 0) throw new Error(NO_SPEECH);

  /* Guarda de densidade: o Whisper às vezes devolve um resto de token ("e A")
     cobrindo dezenas de segundos. Isso NÃO é legenda válida — vira erro
     explícito em vez de aparecer silenciosamente na timeline. */
  const covered = segments.reduce((n, s) => n + (s.end - s.start), 0);
  const letters = segments.reduce(
    (n, s) => n + s.text.replace(/[^\p{L}\p{N}]/gu, "").length,
    0,
  );
  const density = covered > 0 ? letters / covered : 0;
  console.info(
    `[legendas] densidade: ${letters} letras em ${covered.toFixed(1)}s → ${density.toFixed(2)} letras/s`,
  );
  if (covered > 3 && density < 1.5) {
    throw new Error(
      `A transcrição saiu inconsistente (${letters} caracteres para ${covered.toFixed(0)}s de áudio). ` +
        "Isso costuma acontecer quando o áudio está muito baixo ou o idioma escolhido não bate com a fala. " +
        "Confira o idioma e tente de novo.",
    );
  }


  return { segments, words };
}




/** Alternativa sem modelo: blocos de fala vazios para preencher à mão. */
export async function speechPlaceholders(blob: Blob): Promise<CaptionSegment[]> {
  const blocks = await detectSpeechBlocks(blob);
  return blocks.map((b) => ({ ...b, text: "..." }));
}
