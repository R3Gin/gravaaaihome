import { decodeMono16k, detectSpeechBlocks } from "@/lib/audio-tools";

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

  try {
    return await runWorker(audio, lang, duration, events, false);
  } catch (err) {
    // a GPU falhou ou gerou texto inválido: tenta de novo pela CPU (mais lenta, mais estável)
    if (err instanceof GpuFailure) {
      console.warn("[legendas] tentativa na GPU falhou, repetindo na CPU:", err.cause);
      return runWorker(audio, lang, duration, events, true);
    }
    throw err;
  }
}

/** erro vindo da tentativa na GPU; `cause` guarda o erro original */
class GpuFailure extends Error {}

/*
 * O worker fica vivo entre transcrições para não recarregar o modelo a cada
 * clique. Só é descartado quando trava ou quebra.
 */
let sharedWorker: Worker | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getWorker() {
  sharedWorker ??= new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  return sharedWorker;
}

function killWorker() {
  sharedWorker?.terminate();
  sharedWorker = null;
}

/** sem nenhuma mensagem do worker por esse tempo = travado */
const STALL_MS = 3 * 60 * 1000;

function runWorker(
  audio: Float32Array,
  language: string | undefined,
  duration: number,
  events: TranscribeEvents,
  forceWasm: boolean,
): Promise<TranscribeResult> {
  const job = queue.then(
    () =>
      new Promise<TranscribeResult>((resolve, reject) => {
        const worker = getWorker();
        let timer = 0;
        const arm = () => {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            finish();
            killWorker();
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
            try {
              resolve(validateTranscript({ segments: msg.segments, words: msg.words ?? [] }, duration));
            } catch (err) {
              reject(msg.device === "webgpu" && !forceWasm ? new GpuFailure("gpu", { cause: err }) : err);
            }
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
          killWorker();
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
  queue = job.catch(() => undefined);
  return job;
}

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
