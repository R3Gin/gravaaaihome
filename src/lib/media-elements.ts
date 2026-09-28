import type { Clip, MediaItem, Track } from "@/state/editor-store";
import { clipGain, resumePreviewAudio, setElementGain } from "@/lib/preview-audio";

type El = HTMLVideoElement | HTMLImageElement | HTMLAudioElement;

const els = new Map<string, El>();

/** Cria (uma vez) o elemento de mídia usado no preview para um item da biblioteca. */
export function getMediaEl(item: MediaItem): El {
  const found = els.get(item.id);
  if (found) return found;
  let el: El;
  if (item.kind === "image") {
    const img = new Image();
    img.src = item.url;
    el = img;
  } else if (item.kind === "audio") {
    const a = new Audio(item.url);
    a.preload = "auto";
    el = a;
  } else {
    const v = document.createElement("video");
    v.src = item.url;
    v.preload = "auto";
    v.muted = false;
    v.playsInline = true;
    el = v;
  }
  els.set(item.id, el);
  return el;
}

export function dropMediaEl(id: string) {
  const el = els.get(id);
  if (el && "pause" in el) el.pause();
  els.delete(id);
}

/** Fonte desenhável no canvas para um clipe da biblioteca (imagem/vídeo). */
export function mediaSourceFor(clip: Clip, library: MediaItem[]): CanvasImageSource | null {
  if (!clip.mediaId) return null;
  const item = library.find((m) => m.id === clip.mediaId);
  if (!item || item.kind === "audio") return null;
  const el = getMediaEl(item);
  if (el instanceof HTMLImageElement) return el.complete && el.naturalWidth > 0 ? el : null;
  if (el instanceof HTMLVideoElement) return el.videoWidth > 0 ? el : null;
  return null;
}

/**
 * Mantém vídeos/áudios importados em sincronia com a agulha da timeline.
 * Chamado a cada quadro do preview. Respeita velocidade, volume (até 200%,
 * com keyframes), fades e o "mudo" de cada clipe.
 */
export function syncMediaClips(
  tracks: Track[],
  library: MediaItem[],
  time: number,
  playing: boolean,
) {
  if (library.length === 0) return;
  const active = new Set<string>();

  for (const track of tracks) {
    for (const clip of track.clips) {
      if (!clip.mediaId) continue;
      const item = library.find((m) => m.id === clip.mediaId);
      if (!item || item.kind === "image") continue;
      const inside = time >= clip.startTime && time < clip.startTime + clip.duration;
      // o mesmo arquivo pode estar em dois clipes: só o que está sob a agulha manda
      if (!inside || active.has(item.id)) continue;
      const el = getMediaEl(item) as HTMLVideoElement | HTMLAudioElement;
      active.add(item.id);
      const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
      const target = clip.sourceInStart + (time - clip.startTime) * speed;
      if (target >= clip.sourceInEnd - 0.01) {
        if (!el.paused) el.pause();
        continue;
      }
      if (el.playbackRate !== speed) el.playbackRate = speed;
      // tocando, o elemento anda sozinho: só corrige quando escapa demais
      if (Math.abs(el.currentTime - target) > (playing ? 0.25 : 0.05)) {
        try {
          el.currentTime = target;
        } catch {
          /* ainda carregando */
        }
      }
      setElementGain(el, clipGain(clip, time));
      if (playing) resumePreviewAudio();
      if (playing && el.paused) void el.play().catch(() => undefined);
      if (!playing && !el.paused) el.pause();
    }
  }

  for (const [id, el] of els) {
    if (active.has(id)) continue;
    if (!(el instanceof HTMLImageElement) && !el.paused) el.pause();
  }
}
