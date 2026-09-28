/**
 * Motor de exportação rápido baseado em WebCodecs.
 *
 * Em vez de reencodar tudo com x264 em WebAssembly (1 núcleo, muito lento),
 * desenhamos cada quadro no mesmo pipeline do preview (`buildFrame`/`drawFrame`)
 * e codificamos com o encoder de hardware do sistema (`VideoEncoder`), mixando
 * o áudio offline e empacotando em MP4 com `mp4-muxer`.
 */
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { buildFrame, drawFrame } from "@/lib/preview-compose";
import { mediaSourceFor } from "@/lib/media-elements";
import { denoiseSamplesRnnoise } from "@/lib/audio-tools";
import { clipGain } from "@/lib/preview-audio";
import {
  mainTrack,
  type AspectRatio,
  type CaptionStyle,
  type Clip,
  type MediaItem,
  type Track,
} from "@/state/editor-store";

export type ExportQuality = "rapida" | "padrao" | "alta";

export const QUALITY_PRESETS: Record<
  ExportQuality,
  { label: string; height: number; bitratePerPixel: number; fps: number }
> = {
  rapida: { label: "Rápida (720p)", height: 720, bitratePerPixel: 0.07, fps: 30 },
  padrao: { label: "Padrão (1080p)", height: 1080, bitratePerPixel: 0.09, fps: 30 },
  alta: { label: "Alta (1080p+)", height: 1080, bitratePerPixel: 0.16, fps: 60 },
};

export interface WebCodecsExportInput {
  source: Blob;
  tracks: Track[];
  captionStyle: CaptionStyle;
  aspect: AspectRatio;
  videoSize: { width: number; height: number };
  mediaLibrary?: MediaItem[];
  quality?: ExportQuality;
  onProgress?: (ratio: number) => void;
  /** permite cancelar a exportação em andamento */
  signal?: AbortSignal;
}

/** Erro lançado quando o usuário cancela a exportação. */
export class ExportAbortedError extends Error {
  constructor() {
    super("Exportação cancelada.");
    this.name = "ExportAbortedError";
  }
}


export function webcodecsAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder === "function" &&
    typeof (window as unknown as { VideoFrame?: unknown }).VideoFrame === "function" &&
    typeof HTMLVideoElement !== "undefined" &&
    "requestVideoFrameCallback" in HTMLVideoElement.prototype
  );
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function outputSize(aspect: AspectRatio, videoSize: { width: number; height: number }, maxH: number) {
  const srcH = videoSize.height || 720;
  const srcW = videoSize.width || 1280;
  const h = even(Math.min(maxH, Math.max(360, srcH)));
  if (aspect === "9:16") return { W: even((h * 9) / 16), H: h };
  if (aspect === "1:1") return { W: h, H: h };
  const ratio = srcW / srcH || 16 / 9;
  return { W: even(h * ratio), H: h };
}

/** H.264 é a prioridade; VP9 em MP4 só entra se o navegador não codificar AVC. */
const CODEC_CANDIDATES: { codec: string; mux: "avc" | "vp9" }[] = [
  { codec: "avc1.640028", mux: "avc" },
  { codec: "avc1.4D4028", mux: "avc" },
  { codec: "avc1.42E01E", mux: "avc" },
  { codec: "vp09.00.10.08", mux: "vp9" },
];

async function pickVideoCodec(width: number, height: number, bitrate: number, framerate: number) {
  for (const cand of CODEC_CANDIDATES) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: cand.codec,
        width,
        height,
        bitrate,
        framerate,
      });
      if (support.supported) return cand;
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}

/** Espera o vídeo ter metadados carregados. */
function whenReady(v: HTMLVideoElement): Promise<void> {
  if (v.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    v.onloadeddata = () => resolve();
    v.onerror = () => reject(new Error("Não foi possível ler o vídeo de origem."));
  });
}

function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    // segurança: se o navegador não avisar o seek (aba de fundo), segue em frente
    const timer = window.setTimeout(() => done(), 4000);
    function done() {
      window.clearTimeout(timer);
      v.removeEventListener("seeked", done);
      resolve();
    }
    v.addEventListener("seeked", done);
    v.currentTime = Math.max(0, t);
  });
}

/* ------------------------------------------------------------------ áudio */

interface AudioSourceClip {
  clip: Clip;
  /** arquivo de onde sai o som: o vídeo principal ou um item da biblioteca */
  blob: Blob;
  denoise: boolean;
}

/**
 * Tudo o que soa na timeline: o áudio do vídeo principal (faixa "Áudio", ou os
 * clipes de vídeo não mudos em projetos sem ela), as faixas de música e o som
 * dos vídeos importados como sobreposição.
 */
function collectAudioClips(
  tracks: Track[],
  source: Blob,
  library: MediaItem[],
): AudioSourceClip[] {
  const out: AudioSourceClip[] = [];
  const blobOf = (c: Clip) =>
    c.mediaId ? (library.find((m) => m.id === c.mediaId)?.blob ?? null) : source;
  const push = (c: Clip) => {
    if (c.muted || c.duration <= 0.01) return;
    const blob = blobOf(c);
    if (blob) out.push({ clip: c, blob, denoise: c.denoise === true });
  };
  const main = mainTrack(tracks, "audio");
  if (main && main.clips.length > 0) main.clips.forEach(push);
  else mainTrack(tracks, "video")?.clips.forEach(push);
  for (const t of tracks) {
    if (t === main) continue;
    if (t.type === "audio") t.clips.forEach(push);
    if (t.type === "overlay")
      for (const c of t.clips) {
        const item = c.mediaId ? library.find((m) => m.id === c.mediaId) : null;
        if (item?.kind === "video") push(c);
      }
  }
  return out;
}

/** Versão sem ruído (RNNoise, mono 48 kHz) de um áudio já decodificado. */
async function denoiseBuffer(buf: AudioBuffer): Promise<AudioBuffer | null> {
  try {
    const rate = 48000;
    const mono = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * rate)), rate);
    const src = mono.createBufferSource();
    src.buffer = buf;
    src.connect(mono.destination);
    src.start();
    const rendered = await mono.startRendering();
    const clean = await denoiseSamplesRnnoise(rendered.getChannelData(0), rate);
    const out = new AudioBuffer({ length: clean.length, numberOfChannels: 1, sampleRate: rate });
    out.getChannelData(0).set(clean);
    return out;
  } catch (err) {
    console.warn("[export] redução de ruído indisponível, usando o áudio original", err);
    return null;
  }
}

async function renderTimelineAudio(
  clips: AudioSourceClip[],
  totalDuration: number,
): Promise<AudioBuffer | null> {
  if (clips.length === 0 || totalDuration <= 0) return null;
  try {
    // cada arquivo é decodificado uma vez só, mesmo cortado em vários clipes
    const decoded = new Map<Blob, AudioBuffer | null>();
    const ctx = new AudioContext();
    try {
      for (const c of clips) {
        if (decoded.has(c.blob)) continue;
        try {
          const buf = await ctx.decodeAudioData(await c.blob.arrayBuffer());
          decoded.set(c.blob, buf.length > 0 ? buf : null);
        } catch {
          decoded.set(c.blob, null); // arquivo sem trilha de áudio
        }
      }
    } finally {
      void ctx.close();
    }
    const clean = new Map<Blob, AudioBuffer | null>();
    for (const c of clips) {
      const buf = decoded.get(c.blob);
      if (!c.denoise || !buf || clean.has(c.blob)) continue;
      clean.set(c.blob, await denoiseBuffer(buf));
    }

    const rate = 48000;
    const offline = new OfflineAudioContext(2, Math.ceil(totalDuration * rate) + rate, rate);
    // limitador na saída: voz + música acima de 100% não estouram (sem distorção)
    const limiter = offline.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    limiter.connect(offline.destination);
    let any = false;
    for (const { clip: c, blob, denoise } of clips) {
      const buf = (denoise ? clean.get(blob) : null) ?? decoded.get(blob);
      if (!buf) continue;
      const speed = Math.max(0.25, c.speed ?? 1);
      const t0 = Math.max(0, c.startTime);
      const dur = Math.max(0.01, c.duration);
      const offset = Math.max(0, Math.min(c.sourceInStart, buf.duration));
      const span = Math.min(c.sourceInEnd, buf.duration) - offset;
      if (span <= 0.01) continue;
      const src = offline.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = speed;
      // volume (com keyframes) e fades numa curva só, igual ao que o player toca
      const gain = offline.createGain();
      const n = Math.max(2, Math.min(20000, Math.ceil(dur * 100)));
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) curve[i] = clipGain(c, c.startTime + (i / (n - 1)) * dur);
      gain.gain.setValueAtTime(curve[0]!, 0);
      gain.gain.setValueCurveAtTime(curve, t0, dur);
      src.connect(gain).connect(limiter);
      src.start(t0, offset, span);
      src.stop(t0 + dur);
      any = true;
    }
    if (!any) return null;
    return await offline.startRendering();
  } catch (err) {
    console.warn("[export] áudio não pôde ser processado, exportando sem som", err);
    return null;
  }
}

/* ---------------------------------------------------------------- exportar */

export async function exportWithWebCodecs(input: WebCodecsExportInput): Promise<Blob> {
  const {
    source,
    tracks,
    captionStyle,
    aspect,
    videoSize,
    mediaLibrary = [],
    quality = "rapida",
    onProgress,
    signal,
  } = input;

  const throwIfAborted = () => {
    if (signal?.aborted) throw new ExportAbortedError();
  };
  throwIfAborted();


  const preset = QUALITY_PRESETS[quality];
  const videoClips = [...(mainTrack(tracks, "video")?.clips ?? [])].sort(
    (a, b) => a.startTime - b.startTime,
  );
  if (videoClips.length === 0) throw new Error("Nenhum clipe de vídeo na timeline.");

  const totalDuration = Math.max(
    ...videoClips.map((c) => c.startTime + c.duration),
    ...tracks.flatMap((t) => t.clips.map((c) => c.startTime + c.duration)),
    0.1,
  );

  const { W, H } = outputSize(aspect, videoSize, preset.height);
  const bitrate = Math.round(W * H * preset.fps * preset.bitratePerPixel);
  const codec = await pickVideoCodec(W, H, bitrate, preset.fps);
  if (!codec) throw new Error("Este navegador não tem encoder H.264 disponível.");

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) throw new Error("Canvas indisponível.");

  const url = URL.createObjectURL(source);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await whenReady(video);

  const audioBuffer = await renderTimelineAudio(
    collectAudioClips(tracks, source, mediaLibrary),
    totalDuration,
  );
  const audioCodec = audioBuffer ? await pickAudioCodec() : null;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    fastStart: "in-memory",
    // a timeline pode começar depois de 0 (ou o primeiro quadro chegar atrasado)
    firstTimestampBehavior: "offset",
    video: { codec: codec.mux, width: W, height: H },
    ...(audioBuffer && audioCodec
      ? { audio: { codec: audioCodec.mux, numberOfChannels: 2, sampleRate: 48000 } }
      : {}),
  });

  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encodeError = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure({
    codec: codec.codec,
    width: W,
    height: H,
    bitrate,
    framerate: preset.fps,
    latencyMode: "quality",
    ...(codec.mux === "avc" ? { avc: { format: "avc" as const } } : {}),
  });

  const getMedia = (clip: Clip) => mediaSourceFor(clip, mediaLibrary);
  const frameDur = Math.round(1e6 / preset.fps);
  let lastTs = -1;
  let lastKey = -Infinity;
  let framesDone = 0;
  const expectedFrames = Math.max(1, Math.round(totalDuration * preset.fps));

  /** Desenha o estado da timeline em `timelineTime` e codifica o quadro. */
  const emit = (timelineTime: number) => {
    throwIfAborted();
    if (encodeError) throw encodeError;

    let ts = Math.round(timelineTime * 1e6);
    if (ts <= lastTs) ts = lastTs + 1000;
    const data = buildFrame(tracks, captionStyle, timelineTime, null);
    drawFrame(ctx, video, data, W, H, getMedia);
    const keyFrame = ts - lastKey >= 2_000_000;
    if (keyFrame) lastKey = ts;
    const vf = new VideoFrame(canvas, { timestamp: ts, duration: frameDur });
    encoder.encode(vf, { keyFrame });
    vf.close();
    lastTs = ts;
    framesDone++;
    if (framesDone % 4 === 0) onProgress?.(Math.min(0.92, (framesDone / expectedFrames) * 0.9));
  };

  /** espera o encoder esvaziar a fila (por evento: timers são lentos em aba de fundo) */
  const drainTo = async (limit: number) => {
    while (encoder.encodeQueueSize > limit) {
      await new Promise<void>((r) => {
        const t = window.setTimeout(r, 50);
        encoder.addEventListener(
          "dequeue",
          () => {
            window.clearTimeout(t);
            r();
          },
          { once: true },
        );
      });
    }
  };

  /**
   * Caminho rápido: reproduz o trecho em velocidade acelerada e codifica cada
   * quadro real entregue pelo decoder (sem nenhum seek). Roda tão rápido quanto
   * o decoder + encoder de hardware conseguem — normalmente 4x o tempo real.
   * Só funciona com a aba visível (o navegador para de entregar quadros em
   * segundo plano); devolve até onde chegou no arquivo de origem.
   */
  const captureByPlayback = async (clip: Clip, from: number): Promise<number> => {
    const speed = clip.speed ?? 1;
    const srcStart = clip.sourceInStart;
    const srcEnd = Math.max(srcStart + 0.02, clip.sourceInEnd);
    await seekTo(video, from);
    video.playbackRate = 4;
    let reached = from;
    let finished = false;
    let fail: Error | null = null;

    await new Promise<void>((resolve) => {
      let watchdog = window.setTimeout(() => stop(), 3000);
      const bump = () => {
        window.clearTimeout(watchdog);
        watchdog = window.setTimeout(() => stop(), 3000);
      };
      const onHidden = () => {
        if (document.hidden) stop();
      };
      function stop() {
        if (finished) return;
        finished = true;
        video.pause();
        window.clearTimeout(watchdog);
        document.removeEventListener("visibilitychange", onHidden);
        resolve();
      }
      document.addEventListener("visibilitychange", onHidden);
      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        if (finished) return;
        const mt = meta.mediaTime;
        if (mt >= srcEnd - 0.001) {
          reached = srcEnd;
          return stop();
        }
        if (mt >= from - 0.02) {
          try {
            emit(clip.startTime + Math.max(0, mt - srcStart) / speed);
          } catch (e) {
            fail = e instanceof Error ? e : new Error(String(e));
            return stop();
          }
          reached = Math.max(reached, mt + (speed / preset.fps) * 0.5);
          bump();
          // contrapressão: pausa se o encoder ficar para trás
          if (encoder.encodeQueueSize > 24) {
            video.pause();
            void drainTo(8).then(() => {
              if (!finished) void video.play().catch(() => stop());
            });
          }
        }
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
      video.onended = () => {
        reached = srcEnd;
        stop();
      };
      void video.play().catch(() => stop());
    });

    video.onended = null;
    video.playbackRate = 1;
    if (fail) throw fail;
    return reached;
  };

  /**
   * Seek quadro a quadro: mais lento, mas funciona com a aba em segundo plano.
   * Com `untilVisible`, devolve o controle quando a aba volta a ficar visível
   * (para retomar o caminho rápido). Devolve até onde chegou na origem.
   */
  const captureBySeek = async (clip: Clip, from: number, untilVisible: boolean) => {
    const speed = clip.speed ?? 1;
    const srcEnd = clip.sourceInEnd;
    const step = speed / preset.fps;
    let src = from;
    let frames = 0;
    while (src < srcEnd - 0.001) {
      throwIfAborted();
      await seekTo(video, Math.min(src, srcEnd - 0.001));
      emit(clip.startTime + (src - clip.sourceInStart) / speed);
      frames++;
      src += step;
      if (encoder.encodeQueueSize > 12) await drainTo(6);
      if (untilVisible && !document.hidden && frames >= preset.fps) break;
    }
    return Math.min(src, srcEnd);
  };

  try {
    for (const clip of videoClips) {
      throwIfAborted();
      const end = clip.sourceInEnd - 0.001;
      let from = clip.sourceInStart;
      let playbackWorks = true;
      // alterna: rápido enquanto a aba está visível, seek quando vai para o fundo
      while (from < end) {
        throwIfAborted();
        if (playbackWorks && !document.hidden) {
          const reached = await captureByPlayback(clip, from);
          if (reached > from + 0.001) {
            from = reached;
            continue;
          }
          if (!document.hidden) playbackWorks = false;
        }
        from = await captureBySeek(clip, from, playbackWorks);
      }
    }

    throwIfAborted();
    await encoder.flush();
    encoder.close();
    if (encodeError) throw encodeError;

    if (audioBuffer && audioCodec) {
      throwIfAborted();
      try {
        await encodeAudio(audioBuffer, muxer, audioCodec.codec);
      } catch (err) {
        if (err instanceof ExportAbortedError) throw err;
        console.warn("[export] falha ao codificar o áudio, exportando sem som", err);
      }
    }

    throwIfAborted();


    onProgress?.(0.99);
    muxer.finalize();
    const { buffer } = target;
    onProgress?.(1);
    return new Blob([buffer], { type: "video/mp4" });
  } finally {
    try {
      if (encoder.state !== "closed") encoder.close();
    } catch {
      /* ignore */
    }
    video.pause();
    video.src = "";
    URL.revokeObjectURL(url);
  }
}

/** AAC é o padrão em MP4; Opus entra quando o navegador não codifica AAC. */
async function pickAudioCodec(): Promise<{ codec: string; mux: "aac" | "opus" } | null> {
  const AudioEncoderCtor = (window as unknown as { AudioEncoder?: typeof AudioEncoder }).AudioEncoder;
  if (!AudioEncoderCtor) return null;
  const candidates: { codec: string; mux: "aac" | "opus" }[] = [
    { codec: "mp4a.40.2", mux: "aac" },
    { codec: "opus", mux: "opus" },
  ];
  for (const cand of candidates) {
    try {
      const support = await AudioEncoderCtor.isConfigSupported({
        codec: cand.codec,
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128000,
      });
      if (support.supported) return cand;
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}

async function encodeAudio(buffer: AudioBuffer, muxer: Muxer<ArrayBufferTarget>, codec: string) {
  const AudioEncoderCtor = (window as unknown as { AudioEncoder?: typeof AudioEncoder }).AudioEncoder;
  if (!AudioEncoderCtor) return;
  const sampleRate = buffer.sampleRate;
  const channels = Math.min(2, buffer.numberOfChannels);
  let err: Error | null = null;
  const enc = new AudioEncoderCtor({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => {
      err = e instanceof Error ? e : new Error(String(e));
    },
  });
  enc.configure({ codec, sampleRate, numberOfChannels: channels, bitrate: 128000 });

  const chunkFrames = 4096;
  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : left;
  for (let offset = 0; offset < buffer.length; offset += chunkFrames) {
    const count = Math.min(chunkFrames, buffer.length - offset);
    const interleaved = new Float32Array(count * channels);
    for (let i = 0; i < count; i++) {
      interleaved[i * channels] = left[offset + i];
      if (channels > 1) interleaved[i * channels + 1] = right[offset + i];
    }
    const data = new AudioData({
      format: "f32",
      sampleRate,
      numberOfFrames: count,
      numberOfChannels: channels,
      timestamp: Math.round((offset / sampleRate) * 1e6),
      data: interleaved,
    });
    enc.encode(data);
    data.close();
    if (enc.encodeQueueSize > 16) {
      while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
    }
  }
  await enc.flush();
  enc.close();
  if (err) throw err;
}
