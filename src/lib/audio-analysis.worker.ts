/**
 * Worker de análise de áudio: todo o cálculo pesado (RMS/envelope para detectar
 * silêncio e picos para a waveform) roda aqui, fora da thread principal.
 * A thread principal só decodifica (assíncrono) e envia o Float32Array.
 */

export type AnalysisRequest =
  | {
      id: number;
      type: "silences";
      channel: Float32Array;
      sampleRate: number;
      sensitivity: number;
      minDuration: number;
    }
  | {
      id: number;
      type: "peaks";
      channel: Float32Array;
      sampleRate: number;
      bucketsPerSecond: number;
    };

export type AnalysisResponse =
  | { id: number; type: "silences"; segments: { start: number; end: number }[] }
  | { id: number; type: "peaks"; data: Float32Array; duration: number };

function envelope(channel: Float32Array, sampleRate: number) {
  const win = Math.max(1, Math.round(sampleRate * 0.03));
  const count = Math.max(1, Math.floor(channel.length / win));
  const values = new Float32Array(count);
  let peak = 1e-6;
  for (let i = 0; i < count; i++) {
    const from = i * win;
    let sum = 0;
    let n = 0;
    for (let j = from; j < from + win; j += 4) {
      const v = channel[j] ?? 0;
      sum += v * v;
      n++;
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    values[i] = rms;
    if (rms > peak) peak = rms;
  }
  for (let i = 0; i < count; i++) values[i] = values[i]! / peak;
  return { values, step: win / sampleRate, duration: channel.length / sampleRate };
}

function silences(
  channel: Float32Array,
  sampleRate: number,
  sensitivity: number,
  minDuration: number,
) {
  const env = envelope(channel, sampleRate);
  const threshold = 0.008 + sensitivity * 0.12;
  const segs: { start: number; end: number }[] = [];
  let runStart: number | null = null;
  for (let i = 0; i < env.values.length; i++) {
    const quiet = env.values[i]! < threshold;
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

function peaks(channel: Float32Array, sampleRate: number, bucketsPerSecond: number) {
  const duration = channel.length / sampleRate;
  const buckets = Math.max(1, Math.round(duration * bucketsPerSecond));
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
}

self.onmessage = (e: MessageEvent<AnalysisRequest>) => {
  const msg = e.data;
  if (msg.type === "silences") {
    const segments = silences(msg.channel, msg.sampleRate, msg.sensitivity, msg.minDuration);
    (self as unknown as Worker).postMessage({
      id: msg.id,
      type: "silences",
      segments,
    } satisfies AnalysisResponse);
    return;
  }
  const out = peaks(msg.channel, msg.sampleRate, msg.bucketsPerSecond);
  (self as unknown as Worker).postMessage(
    { id: msg.id, type: "peaks", data: out.data, duration: out.duration } satisfies AnalysisResponse,
    [out.data.buffer],
  );
};
