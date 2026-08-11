/**
 * Ferramentas de áudio 100% locais (Web Audio API):
 * - detecção de silêncio (para o cortador de silêncio)
 * - segmentação de fala (base para os blocos de legenda)
 */

export interface Segment {
  start: number;
  end: number;
}

let cachedKey: Blob | null = null;
let cachedBuffer: AudioBuffer | null = null;

async function decode(blob: Blob): Promise<AudioBuffer | null> {
  if (cachedKey === blob && cachedBuffer) return cachedBuffer;
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    void ctx.close();
    cachedKey = blob;
    cachedBuffer = buf;
    return buf;
  } catch {
    return null;
  }
}

/** RMS por janela de ~30ms, normalizado pelo pico. */
async function envelope(blob: Blob) {
  const buf = await decode(blob);
  if (!buf) return null;
  const data = buf.getChannelData(0);
  const rate = buf.sampleRate;
  const win = Math.max(1, Math.round(rate * 0.03));
  const out: number[] = [];
  let peak = 1e-6;
  for (let i = 0; i + win <= data.length; i += win) {
    let sum = 0;
    for (let j = 0; j < win; j += 4) {
      const v = data[i + j] ?? 0;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.ceil(win / 4));
    if (rms > peak) peak = rms;
    out.push(rms);
  }
  return { values: out.map((v) => v / peak), step: win / rate, duration: buf.duration };
}

/**
 * @param sensitivity 0 (pouco sensível) a 1 (muito sensível)
 */
export async function detectSilences(
  blob: Blob,
  sensitivity: number,
  minDuration = 0.4,
): Promise<Segment[]> {
  const env = await envelope(blob);
  if (!env) return [];
  // pouco sensível => limiar baixo (só corta silêncio absoluto)
  const threshold = 0.008 + sensitivity * 0.12;
  const segs: Segment[] = [];
  let runStart: number | null = null;
  for (let i = 0; i < env.values.length; i++) {
    const quiet = env.values[i] < threshold;
    const t = i * env.step;
    if (quiet && runStart === null) runStart = t;
    if (!quiet && runStart !== null) {
      if (t - runStart >= minDuration) segs.push({ start: runStart, end: t });
      runStart = null;
    }
  }
  if (runStart !== null && env.duration - runStart >= minDuration) {
    segs.push({ start: runStart, end: env.duration });
  }
  return segs;
}

/** Trechos com fala = complemento dos silêncios, fatiados em blocos curtos. */
export async function detectSpeechBlocks(
  blob: Blob,
  maxBlock = 4,
): Promise<Segment[]> {
  const env = await envelope(blob);
  if (!env) return [];
  const silences = await detectSilences(blob, 0.35, 0.35);
  const speech: Segment[] = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.start - cursor > 0.4) speech.push({ start: cursor, end: s.start });
    cursor = s.end;
  }
  if (env.duration - cursor > 0.4) speech.push({ start: cursor, end: env.duration });

  const blocks: Segment[] = [];
  for (const s of speech) {
    const len = s.end - s.start;
    const n = Math.max(1, Math.ceil(len / maxBlock));
    for (let i = 0; i < n; i++) {
      blocks.push({
        start: s.start + (len * i) / n,
        end: s.start + (len * (i + 1)) / n,
      });
    }
  }
  return blocks;
}
