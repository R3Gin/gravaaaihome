/**
 * Extração de picos de amplitude para desenhar a waveform na timeline.
 * Roda 100% no navegador com AudioContext.decodeAudioData e mantém cache
 * por Blob para não decodificar o mesmo arquivo várias vezes.
 */

export type Peaks = {
  /** picos normalizados (0..1), um por bucket */
  data: Float32Array;
  /** duração total do áudio em segundos */
  duration: number;
};

const cache = new WeakMap<Blob, Promise<Peaks | null>>();

const BUCKETS_PER_SECOND = 80;

async function compute(blob: Blob): Promise<Peaks | null> {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    void ctx.close();

    const channel = buffer.getChannelData(0);
    const duration = buffer.duration;
    const buckets = Math.max(1, Math.round(duration * BUCKETS_PER_SECOND));
    const per = Math.max(1, Math.floor(channel.length / buckets));
    const data = new Float32Array(buckets);
    let max = 0.0001;
    for (let i = 0; i < buckets; i++) {
      const from = i * per;
      const to = Math.min(channel.length, from + per);
      let peak = 0;
      for (let j = from; j < to; j++) {
        const v = Math.abs(channel[j]!);
        if (v > peak) peak = v;
      }
      data[i] = peak;
      if (peak > max) max = peak;
    }
    for (let i = 0; i < buckets; i++) data[i] = data[i]! / max;
    return { data, duration };
  } catch {
    return null;
  }
}

export function getPeaks(blob: Blob): Promise<Peaks | null> {
  const hit = cache.get(blob);
  if (hit) return hit;
  const promise = compute(blob);
  cache.set(blob, promise);
  return promise;
}

export const peaksPerSecond = BUCKETS_PER_SECOND;
