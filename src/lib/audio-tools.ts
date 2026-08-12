/**
 * Ferramentas de áudio 100% locais (Web Audio API):
 * - detecção de silêncio (para o cortador de silêncio)
 * - segmentação de fala (base para os blocos de legenda)
 */
import { silencesInWorker } from "@/lib/audio-worker-client";


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

/** RMS por janela de ~30ms, normalizado pelo pico (fallback local). */
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

function silencesFromEnvelope(
  env: { values: number[]; step: number; duration: number },
  sensitivity: number,
  minDuration: number,
): Segment[] {
  const threshold = 0.008 + sensitivity * 0.12;
  const segs: Segment[] = [];
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

/**
 * Detecta silêncios. O cálculo pesado (RMS) roda em Web Worker; a thread
 * principal só decodifica o áudio e recebe os intervalos prontos.
 * @param sensitivity 0 (pouco sensível) a 1 (muito sensível)
 */
export async function detectSilences(
  blob: Blob,
  sensitivity: number,
  minDuration = 0.4,
): Promise<Segment[]> {
  const buf = await decode(blob);
  if (!buf) return [];
  const copy = buf.getChannelData(0).slice();
  const res = await silencesInWorker(copy, buf.sampleRate, sensitivity, minDuration);
  if (res) return res.segments;
  const env = await envelope(blob);
  if (!env) return [];
  return silencesFromEnvelope(env, sensitivity, minDuration);
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

/** Áudio mono 16 kHz (formato esperado pelo Whisper). */
export async function decodeMono16k(blob: Blob): Promise<Float32Array | null> {
  const buf = await decode(blob);
  if (!buf) return null;
  const target = 16000;
  if (Math.abs(buf.sampleRate - target) < 1 && buf.numberOfChannels === 1) {
    return buf.getChannelData(0).slice();
  }
  const OfflineCtx =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!OfflineCtx) return buf.getChannelData(0).slice();
  const frames = Math.ceil(buf.duration * target);
  const ctx = new OfflineCtx(1, frames, target);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

/**
 * Toca um trecho do áudio original com ou sem tratamento de ruído
 * (high-pass + noise gate), para conferir antes de exportar.
 */
export async function playAudioPreview(
  blob: Blob,
  start: number,
  end: number,
  denoise: boolean,
): Promise<() => void> {
  const buf = await decode(blob);
  if (!buf) return () => {};
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return () => {};
  const ctx = new Ctx();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  let node: AudioNode = src;
  if (denoise) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 90;
    const gate = ctx.createDynamicsCompressor();
    gate.threshold.value = -45;
    gate.knee.value = 6;
    gate.ratio.value = 12;
    gate.attack.value = 0.003;
    gate.release.value = 0.15;
    const makeup = ctx.createGain();
    makeup.gain.value = 1.3;
    node.connect(hp);
    hp.connect(gate);
    gate.connect(makeup);
    node = makeup;
  }
  node.connect(ctx.destination);
  const dur = Math.max(0.2, Math.min(buf.duration - start, end - start));
  src.start(0, Math.max(0, start), dur);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      src.stop();
    } catch {
      /* já parou */
    }
    void ctx.close();
  };
  src.onended = stop;
  return stop;
}

/* ------------------------- RNNoise (pós-produção) ------------------------ */

/** Renderiza um trecho do áudio em mono 48 kHz (formato exigido pelo RNNoise). */
export async function renderMono48k(
  blob: Blob,
  start: number,
  end: number,
): Promise<Float32Array | null> {
  const buf = await decode(blob);
  if (!buf) return null;
  const OfflineCtx =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!OfflineCtx) return null;
  const dur = Math.max(0.1, Math.min(buf.duration - start, end - start));
  const ctx = new OfflineCtx(1, Math.ceil(dur * 48000), 48000);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start(0, Math.max(0, start), dur);
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

/** Aplica RNNoise no buffer inteiro dentro de um Web Worker. */
export function denoiseSamplesRnnoise(
  samples: Float32Array,
  sampleRate: number,
  onProgress?: (p: number) => void,
): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./rnnoise.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent) => {
      const data = e.data as { type: string; value?: number; samples?: Float32Array; message?: string };
      if (data.type === "progress") onProgress?.(data.value ?? 0);
      else if (data.type === "done") {
        worker.terminate();
        resolve(data.samples!);
      } else if (data.type === "error") {
        worker.terminate();
        reject(new Error(data.message ?? "Falha no RNNoise"));
      }
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || "Falha no worker do RNNoise"));
    };
    const copy = samples.slice();
    worker.postMessage({ samples: copy, sampleRate }, [copy.buffer]);
  });
}

/** Toca um Float32Array (mono) em 48 kHz e devolve uma função de parada. */
export function playSamples(samples: Float32Array, sampleRate = 48000): () => void {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return () => {};
  const ctx = new Ctx();
  const buf = ctx.createBuffer(1, samples.length, sampleRate);
  buf.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      src.stop();
    } catch {
      /* já parou */
    }
    void ctx.close();
  };
  src.onended = stop;
  return stop;
}
