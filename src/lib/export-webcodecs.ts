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
import type { AspectRatio, CaptionStyle, Clip, MediaItem, Track } from "@/state/editor-store";

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
    const done = () => {
      v.removeEventListener("seeked", done);
      resolve();
    };
    v.addEventListener("seeked", done);
    v.currentTime = Math.max(0, t);
  });
}

/* ------------------------------------------------------------------ áudio */

interface AudioSourceClip {
  startTime: number;
  duration: number;
  srcStart: number;
  srcEnd: number;
  speed: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

function collectAudioClips(tracks: Track[]): AudioSourceClip[] {
  const audioTrack = tracks.find((t) => t.type === "audio");
  const videoTrack = tracks.find((t) => t.type === "video");
  const from = (c: Clip, vol: number): AudioSourceClip => ({
    startTime: c.startTime,
    duration: c.duration,
    srcStart: c.sourceInStart,
    srcEnd: c.sourceInEnd,
    speed: c.speed ?? 1,
    volume: vol,
    fadeIn: c.fadeIn ?? 0,
    fadeOut: c.fadeOut ?? 0,
  });
  const out: AudioSourceClip[] = [];
  if (audioTrack && audioTrack.clips.length > 0) {
    for (const c of audioTrack.clips) out.push(from(c, c.volume ?? 1));
    return out;
  }
  for (const c of videoTrack?.clips ?? []) {
    if (c.muted) continue;
    out.push(from(c, c.volume ?? 1));
  }
  return out;
}

async function renderTimelineAudio(
  source: Blob,
  clips: AudioSourceClip[],
  totalDuration: number,
): Promise<AudioBuffer | null> {
  if (clips.length === 0 || totalDuration <= 0) return null;
  try {
    const ctx = new AudioContext();
    const decoded = await ctx.decodeAudioData(await source.arrayBuffer());
    await ctx.close();
    if (decoded.length === 0) return null;

    const rate = 48000;
    const offline = new OfflineAudioContext(2, Math.ceil(totalDuration * rate) + rate, rate);
    for (const c of clips) {
      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.playbackRate.value = Math.max(0.25, c.speed);
      const gain = offline.createGain();
      const vol = Math.max(0, c.volume);
      gain.gain.setValueAtTime(vol, 0);
      const t0 = Math.max(0, c.startTime);
      const dur = Math.max(0.01, c.duration);
      if (c.fadeIn > 0.01) {
        const d = Math.min(c.fadeIn, dur);
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(vol, t0 + d);
      }
      if (c.fadeOut > 0.01) {
        const d = Math.min(c.fadeOut, dur);
        gain.gain.setValueAtTime(vol, t0 + dur - d);
        gain.gain.linearRampToValueAtTime(0, t0 + dur);
      }
      src.connect(gain).connect(offline.destination);
      const srcDur = Math.max(0.01, c.srcEnd - c.srcStart);
      src.start(t0, Math.max(0, c.srcStart), srcDur);
      src.stop(t0 + dur);
    }
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
  } = input;

  const preset = QUALITY_PRESETS[quality];
  const videoClips = [...(tracks.find((t) => t.type === "video")?.clips ?? [])].sort(
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

  const audioBuffer = await renderTimelineAudio(source, collectAudioClips(tracks), totalDuration);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    fastStart: "in-memory",
    video: { codec: codec.mux, width: W, height: H },
    ...(audioBuffer
      ? { audio: { codec: "aac" as const, numberOfChannels: 2, sampleRate: 48000 } }
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

  /**
   * Caminho rápido: reproduz o trecho em velocidade acelerada e codifica cada
   * quadro real entregue pelo decoder (sem nenhum seek). Roda tão rápido quanto
   * o decoder + encoder de hardware conseguem — normalmente 4x o tempo real.
   */
  const captureByPlayback = async (clip: Clip): Promise<boolean> => {
    const speed = clip.speed ?? 1;
    const srcStart = clip.sourceInStart;
    const srcEnd = Math.max(srcStart + 0.02, clip.sourceInEnd);
    await seekTo(video, srcStart);
    video.playbackRate = 4;
    let got = 0;
    let finished = false;
    let fail: Error | null = null;

    await new Promise<void>((resolve) => {
      let watchdog = window.setTimeout(() => {
        finished = true;
        video.pause();
        resolve();
      }, 3000);
      const bump = () => {
        window.clearTimeout(watchdog);
        watchdog = window.setTimeout(() => {
          finished = true;
          video.pause();
          resolve();
        }, 3000);
      };
      const stop = () => {
        finished = true;
        video.pause();
        window.clearTimeout(watchdog);
        resolve();
      };
      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        if (finished) return;
        const mt = meta.mediaTime;
        if (mt >= srcEnd - 0.001) return stop();
        if (mt >= srcStart - 0.02) {
          try {
            emit(clip.startTime + Math.max(0, mt - srcStart) / speed);
          } catch (e) {
            fail = e instanceof Error ? e : new Error(String(e));
            return stop();
          }
          got++;
          bump();
          // contrapressão: pausa se o encoder ficar para trás
          if (encoder.encodeQueueSize > 24) {
            video.pause();
            const resume = () => {
              if (finished) return;
              if (encoder.encodeQueueSize > 8) {
                window.setTimeout(resume, 8);
                return;
              }
              void video.play().catch(() => stop());
            };
            window.setTimeout(resume, 8);
          }
        }
        video.requestVideoFrameCallback(onFrame);
      };
      video.requestVideoFrameCallback(onFrame);
      video.onended = () => {
        if (!finished) stop();
      };
      void video.play().catch(() => stop());
    });

    video.onended = null;
    video.playbackRate = 1;
    if (fail) throw fail;
    return got > 0;
  };

  /** Fallback determinístico: seek quadro a quadro (usado se a reprodução falhar). */
  const captureBySeek = async (clip: Clip) => {
    const speed = clip.speed ?? 1;
    const steps = Math.max(1, Math.round(clip.duration * preset.fps));
    for (let i = 0; i < steps; i++) {
      const local = i / preset.fps;
      if (local > clip.duration) break;
      const src = clip.sourceInStart + local * speed;
      await seekTo(video, Math.min(src, clip.sourceInEnd - 0.001));
      emit(clip.startTime + local);
      if (encoder.encodeQueueSize > 12) {
        while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
      }
    }
  };

  try {
    for (const clip of videoClips) {
      const ok = await captureByPlayback(clip);
      if (!ok) await captureBySeek(clip);
    }


    await encoder.flush();
    encoder.close();
    if (encodeError) throw encodeError;

    if (audioBuffer) {
      await encodeAudio(audioBuffer, muxer);
    }

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

async function encodeAudio(buffer: AudioBuffer, muxer: Muxer<ArrayBufferTarget>) {
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
  enc.configure({ codec: "mp4a.40.2", sampleRate, numberOfChannels: channels, bitrate: 128000 });

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
