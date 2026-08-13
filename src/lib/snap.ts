import type { Track } from "@/state/editor-store";

/**
 * Pontos de referência para a imantação (snap) na timeline:
 * bordas de todos os clipes (qualquer faixa), agulha, tempo 0,
 * fim da timeline e keyframes do clipe selecionado.
 */
export function snapTargets(
  tracks: Track[],
  opts: { excludeClipId?: string | null; playhead?: number; duration?: number; selectedClipId?: string | null },
): number[] {
  const out: number[] = [0];
  if (typeof opts.playhead === "number") out.push(opts.playhead);
  if (typeof opts.duration === "number" && opts.duration > 0) out.push(opts.duration);
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.id === opts.excludeClipId) continue;
      out.push(clip.startTime, clip.startTime + clip.duration);
      if (clip.id === opts.selectedClipId && clip.keyframes) {
        for (const keys of Object.values(clip.keyframes)) {
          for (const k of keys ?? []) out.push(clip.startTime + k.time);
        }
      }
    }
  }
  return out;
}

/** Aproxima `time` do alvo mais próximo dentro da tolerância (em segundos). */
export function applySnap(
  time: number,
  targets: number[],
  tolerance: number,
): { time: number; guide: number | null } {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    const d = Math.abs(t - time);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  if (best == null || bestDist > tolerance) return { time, guide: null };
  return { time: best, guide: best };
}

/** Tolerância em segundos equivalente a ~9px de tela, independente do zoom. */
export function snapTolerance(zoom: number) {
  return 9 / Math.max(1, zoom);
}
