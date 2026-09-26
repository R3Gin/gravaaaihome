/**
 * Miniaturas do vídeo ao longo do tempo (filmstrip) para desenhar dentro dos
 * clipes da timeline. Extraídas no navegador com um <video> oculto, em segundo
 * plano, e guardadas em cache por URL. Os quadros chegam aos poucos: quem
 * assina recebe a lista parcial a cada novo quadro.
 */

export type Filmstrip = {
  /** intervalo, em segundos de mídia, entre um quadro e o próximo */
  step: number;
  /** URL de imagem de cada quadro (índice i = tempo i * step); vazio enquanto não extraído */
  frames: string[];
  done: boolean;
};

const MAX_FRAMES = 160;
const MIN_STEP = 0.5;
const FRAME_H = 72;

type Entry = { strip: Filmstrip; listeners: Set<(s: Filmstrip) => void> };
const cache = new Map<string, Entry>();

function seek(video: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.addEventListener("error", done);
    video.currentTime = t;
  });
}

async function extract(url: string, duration: number, entry: Entry) {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("filmstrip: vídeo ilegível"));
    });
    const w = Math.max(1, Math.round((FRAME_H * (video.videoWidth || 16)) / (video.videoHeight || 9)));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = FRAME_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { step, frames } = entry.strip;
    for (let i = 0; i < frames.length; i++) {
      if (!cache.has(url)) return; // descartado no meio do caminho
      await seek(video, Math.min(duration - 0.05, i * step + 0.01));
      ctx.drawImage(video, 0, 0, w, FRAME_H);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.6));
      if (!blob) continue;
      frames[i] = URL.createObjectURL(blob);
      entry.strip = { ...entry.strip, frames: [...frames] };
      entry.listeners.forEach((fn) => fn(entry.strip));
    }
  } catch {
    /* sem miniaturas: a timeline continua com os clipes coloridos */
  } finally {
    entry.strip = { ...entry.strip, done: true };
    entry.listeners.forEach((fn) => fn(entry.strip));
    video.removeAttribute("src");
    video.load();
  }
}

/** Assina as miniaturas de um vídeo; começa a extração na primeira vez. */
export function subscribeFilmstrip(
  url: string,
  duration: number,
  fn: (s: Filmstrip) => void,
): () => void {
  let entry = cache.get(url);
  if (!entry) {
    const step = Math.max(MIN_STEP, duration / MAX_FRAMES);
    const count = Math.max(1, Math.ceil(duration / step));
    entry = {
      strip: { step, frames: new Array<string>(count).fill(""), done: false },
      listeners: new Set(),
    };
    cache.set(url, entry);
    void extract(url, duration, entry);
  }
  entry.listeners.add(fn);
  fn(entry.strip);
  const e = entry;
  return () => {
    e.listeners.delete(fn);
  };
}

/** Libera as miniaturas de um vídeo que saiu do projeto. */
export function dropFilmstrip(url: string) {
  const entry = cache.get(url);
  if (!entry) return;
  cache.delete(url);
  entry.strip.frames.forEach((f) => f && URL.revokeObjectURL(f));
}
