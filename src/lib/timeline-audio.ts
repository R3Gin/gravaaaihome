/**
 * Monta o ÁUDIO FINAL da linha do tempo (pós-cortes) em PCM mono 16 kHz.
 *
 * É este buffer — e não o arquivo original — que deve ser enviado ao Whisper:
 * assim os timestamps já nascem na linha do tempo editada e não precisam de
 * nenhum remapeamento posterior.
 */

export interface AudioClipRef {
  id: string;
  type: string;
  sourceUrl: string;
  startTime: number;
  duration: number;
  sourceInStart: number;
  sourceInEnd: number;
  speed?: number;
  volume?: number;
  muted?: boolean;
}

const RATE = 16000;

/** assinatura do arranjo de áudio: muda sempre que um corte altera a linha */
export function timelineAudioSignature(clips: AudioClipRef[]): string {
  return audible(clips)
    .map(
      (c) =>
        `${c.sourceUrl}|${c.startTime.toFixed(3)}|${c.duration.toFixed(3)}|${c.sourceInStart.toFixed(3)}|${(c.speed ?? 1).toFixed(2)}`,
    )
    .join(";");
}

function audible(clips: AudioClipRef[]) {
  return clips
    .filter(
      (c) =>
        (c.type === "video" || c.type === "audio") &&
        !c.muted &&
        c.sourceUrl &&
        c.duration > 0.02,
    )
    .sort((a, b) => a.startTime - b.startTime);
}

const decoded = new Map<string, AudioBuffer>();

async function decodeUrl(url: string, fallback: Blob | null): Promise<AudioBuffer | null> {
  const hit = decoded.get(url);
  if (hit) return hit;
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    let blob: Blob | null = null;
    try {
      blob = await (await fetch(url)).blob();
    } catch {
      blob = fallback;
    }
    if (!blob) return null;
    const ctx = new Ctx();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    void ctx.close();
    decoded.set(url, buf);
    return buf;
  } catch {
    return null;
  }
}

export interface ComposedAudio {
  audio: Float32Array;
  duration: number;
  /** trechos da linha do tempo que contêm áudio (para diagnóstico) */
  covered: { start: number; end: number }[];
}

/**
 * Renderiza todos os clipes audíveis na posição em que estão na timeline.
 * O resultado tem exatamente a duração da timeline editada.
 */
export async function composeTimelineAudio(
  clips: AudioClipRef[],
  fallbackBlob: Blob | null,
): Promise<ComposedAudio | null> {
  const list = audible(clips);
  if (list.length === 0) return null;

  const total = Math.max(...list.map((c) => c.startTime + c.duration));
  if (!Number.isFinite(total) || total <= 0.05) return null;

  const OfflineCtx =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!OfflineCtx) return null;

  const urls = [...new Set(list.map((c) => c.sourceUrl))];
  const buffers = new Map<string, AudioBuffer>();
  for (const url of urls) {
    const buf = await decodeUrl(url, fallbackBlob);
    if (buf) buffers.set(url, buf);
  }
  if (buffers.size === 0) return null;

  const ctx = new OfflineCtx(1, Math.ceil(total * RATE), RATE);
  const covered: { start: number; end: number }[] = [];

  for (const c of list) {
    const buf = buffers.get(c.sourceUrl);
    if (!buf) continue;
    const speed = c.speed ?? 1;
    const offset = Math.max(0, Math.min(c.sourceInStart, buf.duration));
    const span = Math.max(0, Math.min(c.sourceInEnd, buf.duration) - offset);
    if (span <= 0.02) continue;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = speed;
    const gain = ctx.createGain();
    gain.gain.value = c.volume ?? 1;
    src.connect(gain).connect(ctx.destination);
    src.start(Math.max(0, c.startTime), offset, span);
    covered.push({ start: c.startTime, end: c.startTime + span / speed });
  }

  const rendered = await ctx.startRendering();
  return { audio: rendered.getChannelData(0).slice(), duration: total, covered };
}
