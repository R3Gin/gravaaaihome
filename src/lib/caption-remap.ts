export interface TimeRange {
  start: number;
  end: number;
}

/** Converte "00:01:23", "1:23" ou número em segundos. */
export function toSeconds(value: number | string): number {
  if (typeof value === "number") return value;
  const parts = String(value).trim().split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Recalcula os tempos das legendas depois que trechos foram removidos do vídeo.
 * `removed` deve conter TODOS os trechos removidos na mesma operação, em tempo
 * original, para evitar deslocamento duplicado.
 */
export function remapCaptionsAfterCuts<T extends { start: number | string; end: number | string }>(
  captions: T[],
  removed: TimeRange[],
): (T & { start: number; end: number })[] {
  const sorted = [...removed]
    .map((r) => ({ start: toSeconds(r.start), end: toSeconds(r.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  const out: (T & { start: number; end: number })[] = [];

  for (const caption of captions) {
    const start = toSeconds(caption.start);
    const end = toSeconds(caption.end);
    let newStart = start;
    let newEnd = end;
    let dropped = false;

    for (const seg of sorted) {
      const removedDuration = seg.end - seg.start;

      // legenda inteiramente dentro do trecho removido → descarta
      if (start >= seg.start && end <= seg.end) {
        dropped = true;
        break;
      }

      if (start >= seg.end) {
        // depois do corte → desloca para a esquerda
        newStart -= removedDuration;
        newEnd -= removedDuration;
      } else if (start < seg.start && end > seg.start) {
        // atravessa o corte → encurta o fim
        newEnd -= Math.min(removedDuration, end - seg.start);
      } else if (start >= seg.start && start < seg.end) {
        // começa dentro do corte e termina depois → começa no ponto do corte
        newStart -= start - seg.start;
        newEnd -= removedDuration;
      }
    }

    if (dropped) continue;
    newStart = Math.max(0, newStart);
    newEnd = Math.max(newStart, newEnd);
    if (newEnd - newStart < 0.15) continue;
    out.push({ ...caption, start: newStart, end: newEnd });
  }

  return out.sort((a, b) => a.start - b.start);
}

/** Converte um tempo da linha do tempo atual de volta para o tempo do vídeo original. */
export function toOriginalTime(t: number, removed: TimeRange[]): number {
  let out = t;
  for (const r of [...removed].sort((a, b) => a.start - b.start)) {
    if (r.start <= out) out += r.end - r.start;
  }
  return out;
}
