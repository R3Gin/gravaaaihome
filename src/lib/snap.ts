import type { Track } from "@/state/editor-store";

/** Alvo de imantação com prioridade (0 = mais forte). */
export type SnapTarget = { time: number; priority: number };

/**
 * Pontos de referência para a imantação (snap) na timeline:
 * bordas de todos os clipes (prioridade 0), agulha (1),
 * tempo 0 / fim da timeline (2) e keyframes do clipe selecionado (1).
 */
export function snapTargets(
  tracks: Track[],
  opts: { excludeClipId?: string | null; playhead?: number; duration?: number; selectedClipId?: string | null },
): SnapTarget[] {
  const out: SnapTarget[] = [{ time: 0, priority: 2 }];
  if (typeof opts.playhead === "number") out.push({ time: opts.playhead, priority: 1 });
  if (typeof opts.duration === "number" && opts.duration > 0)
    out.push({ time: opts.duration, priority: 2 });
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.id === opts.excludeClipId) continue;
      out.push({ time: clip.startTime, priority: 0 });
      out.push({ time: clip.startTime + clip.duration, priority: 0 });
      if (clip.id === opts.selectedClipId && clip.keyframes) {
        for (const keys of Object.values(clip.keyframes)) {
          for (const k of keys ?? []) out.push({ time: clip.startTime + k.time, priority: 1 });
        }
      }
    }
  }
  return out;
}

/**
 * Aproxima `time` do alvo mais próximo dentro da tolerância (em segundos).
 * Alvos com prioridade menor (bordas de clipes) ganham de alvos distantes
 * de menor importância, mesmo estando um pouco mais longe.
 */
export function applySnap(
  time: number,
  targets: (SnapTarget | number)[],
  tolerance: number,
): { time: number; guide: number | null } {
  let best: number | null = null;
  let bestScore = Infinity;
  for (const raw of targets) {
    const t = typeof raw === "number" ? raw : raw.time;
    const priority = typeof raw === "number" ? 0 : raw.priority;
    const d = Math.abs(t - time);
    if (d > tolerance) continue;
    const score = d * (1 + priority * 0.6) + priority * tolerance * 0.15;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  if (best == null) return { time, guide: null };
  return { time: best, guide: best };
}

/** Zona de atração durante o arraste: ~28px de tela, independente do zoom. */
export function snapTolerance(zoom: number) {
  return 28 / Math.max(1, zoom);
}

/** Zona ampliada aplicada no momento de soltar o clipe: ~40px de tela. */
export function snapReleaseTolerance(zoom: number) {
  return 40 / Math.max(1, zoom);
}


/**
 * Posição válida mais próxima de `desired` para um clipe de `duration`
 * segundos, sem sobrepor os demais clipes da faixa (que ficam parados).
 * Substitui o antigo "empurra tudo para a direita", que devolvia o clipe
 * arrastado para o lugar de origem sempre que havia um vizinho à esquerda.
 */
export function freeStart(
  others: { startTime: number; duration: number }[],
  desired: number,
  duration: number,
): number {
  const want = Math.max(0, desired);
  const sorted = [...others].sort((a, b) => a.startTime - b.startTime);
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const c of sorted) {
    if (c.startTime - cursor >= duration - 1e-6) gaps.push([cursor, c.startTime - duration]);
    cursor = Math.max(cursor, c.startTime + c.duration);
  }
  gaps.push([cursor, Infinity]);
  let best = cursor;
  let bestDist = Infinity;
  for (const [lo, hi] of gaps) {
    const candidate = hi === Infinity ? Math.max(want, lo) : Math.min(Math.max(want, lo), hi);
    const d = Math.abs(candidate - want);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return Math.max(0, best);
}

