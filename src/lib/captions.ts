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
  const lang = !language || language === "auto" ? undefined : language;
  events.onStage?.("audio");
  const audio = await decodeMono16k(blob);
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
      "Não foi possível transcrever este áudio — tente novamente ou verifique se há fala audível no vídeo.",
    );
  }

  const worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });

  try {
    const result = await new Promise<TranscribeResult>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as
          | { type: "stage"; stage: "model" | "transcribe" | "finalize" }
          | { type: "download"; progress: number }
          | { type: "progress"; progress: number }
          | { type: "done"; segments: CaptionSegment[]; words?: WordTiming[] }
          | { type: "error"; message: string };
        if (msg.type === "stage") events.onStage?.(msg.stage);
        if (msg.type === "download") events.onDownload?.(msg.progress);
        if (msg.type === "progress") events.onProgress?.(msg.progress);
        if (msg.type === "done") resolve({ segments: msg.segments, words: msg.words ?? [] });
        if (msg.type === "error") reject(new Error(msg.message));
      };
      worker.onerror = () => reject(new Error("O modelo de transcrição não pôde ser carregado."));
      worker.postMessage({ type: "transcribe", audio, language: lang }, [audio.buffer]);
    });
    return validateTranscript(result, duration);
  } finally {
    worker.terminate();
  }
}

const TRANSCRIBE_FAILED =
  "Não foi possível transcrever este áudio — tente novamente ou verifique se há fala audível no vídeo.";

/** texto suspeito: vazio, só símbolos/tokens especiais ou uma letra solta. */
function isJunk(text: string) {
  const t = text.trim();
  if (t.length === 0) return true;
  if (/^[<[(].*[>\])]$/.test(t)) return true; // tokens tipo <|nospeech|>, [Música]
  const letters = t.replace(/[^\p{L}\p{N}]/gu, "");
  if (letters.length === 0) return true;
  if (letters.length < 2) return true; // "N", "."
  if (/^(.)\1+$/u.test(letters)) return true; // "aaaa", "....."
  return false;
}

/**
 * Descarta segmentos inválidos e rejeita resultados globalmente degradados
 * (ex.: um único bloco cobrindo o vídeo inteiro com texto placeholder).
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
    `[legendas] whisper: ${result.segments.length} segmentos brutos → ${segments.length} válidos · ${words.length} palavras com timing`,
  );

  if (segments.length === 0) throw new Error(TRANSCRIBE_FAILED);

  // densidade mínima de texto: fala real gera ~8+ caracteres por segundo falado
  const chars = segments.reduce((n, s) => n + s.text.trim().length, 0);
  const covered = segments.reduce((n, s) => n + (s.end - s.start), 0);
  if (chars < Math.max(6, Math.min(audioDuration, covered) * 1.2)) {
    console.warn(`[legendas] texto curto demais (${chars} caracteres para ${covered.toFixed(1)}s)`);
    throw new Error(TRANSCRIBE_FAILED);
  }

  // um único bloco cobrindo praticamente todo o áudio = segmentação colapsada
  if (
    segments.length === 1 &&
    audioDuration > 8 &&
    segments[0].end - segments[0].start > audioDuration * 0.9 &&
    words.length === 0
  ) {
    console.warn("[legendas] segmentação colapsada em um único bloco — resultado rejeitado");
    throw new Error(TRANSCRIBE_FAILED);
  }

  return { segments, words };
}



/** Alternativa sem modelo: blocos de fala vazios para preencher à mão. */
export async function speechPlaceholders(blob: Blob): Promise<CaptionSegment[]> {
  const blocks = await detectSpeechBlocks(blob);
  return blocks.map((b) => ({ ...b, text: "..." }));
}
