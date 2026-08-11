import { decodeMono16k, detectSpeechBlocks } from "@/lib/audio-tools";

export interface CaptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscribeEvents {
  onStage?: (stage: "audio" | "model" | "transcribe") => void;
  onDownload?: (progress: number) => void;
}

/**
 * Transcreve o áudio inteiramente no navegador (Whisper via Web Worker).
 */
export async function transcribe(
  blob: Blob,
  language: string | undefined,
  events: TranscribeEvents = {},
): Promise<CaptionSegment[]> {
  events.onStage?.("audio");
  const audio = await decodeMono16k(blob);
  if (!audio || audio.length < 16000 * 0.3) {
    throw new Error("Não encontrei áudio nesse vídeo.");
  }

  const worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });

  try {
    return await new Promise<CaptionSegment[]>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as
          | { type: "stage"; stage: "model" | "transcribe" }
          | { type: "download"; progress: number }
          | { type: "done"; segments: CaptionSegment[] }
          | { type: "error"; message: string };
        if (msg.type === "stage") events.onStage?.(msg.stage);
        if (msg.type === "download") events.onDownload?.(msg.progress);
        if (msg.type === "done") resolve(msg.segments);
        if (msg.type === "error") reject(new Error(msg.message));
      };
      worker.onerror = () => reject(new Error("O modelo de transcrição não pôde ser carregado."));
      worker.postMessage({ type: "transcribe", audio, language }, [audio.buffer]);
    });
  } finally {
    worker.terminate();
  }
}

/** Alternativa sem modelo: blocos de fala vazios para preencher à mão. */
export async function speechPlaceholders(blob: Blob): Promise<CaptionSegment[]> {
  const blocks = await detectSpeechBlocks(blob);
  return blocks.map((b) => ({ ...b, text: "..." }));
}
