// Client-only helper — lazily loads ffmpeg.wasm (single-thread build) from a CDN
// via toBlobURL so we don't need COOP/COEP headers.
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import fixWebmDuration from "fix-webm-duration";

/**
 * MediaRecorder does NOT write the Segment `Duration` element into WebM files,
 * which makes every player (VLC, QuickTime, browsers) unable to seek and often
 * unable to read the total duration. We patch the header before doing anything
 * else with the blob. Safe to call with any WebM blob and an approximate
 * duration in milliseconds.
 */
export async function fixWebmSeekable(webm: Blob, durationMs: number): Promise<Blob> {
  try {
    const fixed = await fixWebmDuration(webm, Math.max(1, Math.round(durationMs)), {
      logger: false,
    });
    return fixed;
  } catch (err) {
    console.warn("[ffmpeg] fixWebmDuration falhou, usando blob original", err);
    return webm;
  }
}

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

// IMPORTANT: passamos as URLs do CDN DIRETO para ff.load (sem toBlobURL).
// O worker do @ffmpeg/ffmpeg usa `importScripts(coreURL)`, que aceita
// cross-origin quando o CDN devolve CORS (unpkg/jsdelivr devolvem).
// A abordagem via `toBlobURL` falha com "failed to import ffmpeg-core.js"
// porque o script convertido em blob perde o contexto necessário para
// resolver o wasm no mesmo worker.
// O @ffmpeg/ffmpeg 0.12.x cria o worker com `type: "module"`, então o
// worker NÃO usa importScripts — ele faz `await import(coreURL)`. Isso
// exige o build ESM do core, não o UMD.
const CORE_BASE_CDN = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
const CORE_BASE_CDN_FALLBACK = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const ff = new FFmpeg();
    ff.on("log", ({ message }) => {
      if (onLog) onLog(message);
      // Always surface ffmpeg logs to console for debugging.
      console.log("[ffmpeg]", message);
    });
    const tryLoadDirect = async (base: string) => {
      await ff.load({
        coreURL: `${base}/ffmpeg-core.js`,
        wasmURL: `${base}/ffmpeg-core.wasm`,
      });
    };
    const tryLoadBlob = async (base: string) => {
      await ff.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      });
    };
    // Ordem: CDN direto (mais estável) → fallback CDN direto → blob URL.
    try {
      await tryLoadDirect(CORE_BASE_CDN);
      console.log("[ffmpeg] core carregado (unpkg direto)");
    } catch (err1) {
      console.warn("[ffmpeg] unpkg direto falhou, tentando jsdelivr", err1);
      try {
        await tryLoadDirect(CORE_BASE_CDN_FALLBACK);
        console.log("[ffmpeg] core carregado (jsdelivr direto)");
      } catch (err2) {
        console.warn("[ffmpeg] jsdelivr direto falhou, tentando via blob", err2);
        await tryLoadBlob(CORE_BASE_CDN);
      }
    }
    ffmpegInstance = ff;
    return ff;
  })();
  try {
    return await loadPromise;
  } catch (err) {
    // Reset so the next attempt can retry from scratch.
    loadPromise = null;
    throw err;
  }
}

export async function convertWebmToMp4(
  webm: Blob,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const ff = await getFFmpeg();
  const progressHandler = ({ progress }: { progress: number }) => {
    if (onProgress) onProgress(Math.min(1, Math.max(0, progress)));
  };
  ff.on("progress", progressHandler);
  try {
    await ff.writeFile("input.webm", await fetchFile(webm));
    try {
      // Primeiro tenta exatamente o remux leve pedido para o fluxo de download:
      // se os codecs já forem compatíveis, só reescreve o metadata/moov no início.
      await ff.exec([
        "-y",
        "-i", "input.webm",
        "-c", "copy",
        "-movflags", "+faststart",
        "output.mp4",
      ]);
    } catch (copyErr) {
      console.warn("[ffmpeg] remux WebM→MP4 com -c copy falhou; reencodando para H.264/AAC", copyErr);
      try { await ff.deleteFile("output.mp4"); } catch { /* ignore */ }
      // WebM do MediaRecorder normalmente é VP8/VP9 + Opus, que MP4 não aceita
      // com `-c copy`. Fallback seguro: reencode + faststart para buscar/duração.
      await ff.exec([
        "-y",
        "-i", "input.webm",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "160k",
        "-movflags", "+faststart",
        "output.mp4",
      ]);
    }
    const data = (await ff.readFile("output.mp4")) as Uint8Array;
    const outputBuffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(outputBuffer).set(data);
    const finalBlob = new Blob([outputBuffer], { type: "video/mp4" });
    console.log(`[ffmpeg] Blob MP4 final gerado: ${finalBlob.size} bytes (MediaRecorder bruto: ${webm.size} bytes)`);
    return finalBlob;
  } finally {
    ff.off("progress", progressHandler);
    try { await ff.deleteFile("input.webm"); } catch { /* ignore */ }
    try { await ff.deleteFile("output.mp4"); } catch { /* ignore */ }
  }
}

export async function remuxMp4FastStart(
  mp4: Blob,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const ff = await getFFmpeg();
  const progressHandler = ({ progress }: { progress: number }) => {
    if (onProgress) onProgress(Math.min(1, Math.max(0, progress)));
  };
  ff.on("progress", progressHandler);
  try {
    await ff.writeFile("input.mp4", await fetchFile(mp4));
    // Native MP4 MediaRecorder output can still miss/late-place moov metadata.
    // Remux only: no re-encode, just rewrite headers/index for correct seek.
    await ff.exec([
      "-y",
      "-i", "input.mp4",
      "-c", "copy",
      "-movflags", "+faststart",
      "output.mp4",
    ]);
    const data = (await ff.readFile("output.mp4")) as Uint8Array;
    const outputBuffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(outputBuffer).set(data);
    const finalBlob = new Blob([outputBuffer], { type: "video/mp4" });
    console.log(`[ffmpeg] Blob MP4 final gerado: ${finalBlob.size} bytes (MediaRecorder bruto: ${mp4.size} bytes)`);
    return finalBlob;
  } finally {
    ff.off("progress", progressHandler);
    try { await ff.deleteFile("input.mp4"); } catch { /* ignore */ }
    try { await ff.deleteFile("output.mp4"); } catch { /* ignore */ }
  }
}

export interface EditSegment {
  start: number;
  end: number;
}

export interface EditFilters {
  brightness: number; // -1..1 (0 = neutro)
  contrast: number; // 0..2 (1 = neutro)
  saturation: number; // 0..3 (1 = neutro)
}

function eqExpr(f: EditFilters) {
  return `eq=brightness=${f.brightness.toFixed(3)}:contrast=${f.contrast.toFixed(3)}:saturation=${f.saturation.toFixed(3)}`;
}

/**
 * Aplica cortes (mantendo apenas os segmentos informados, em ordem) e ajustes
 * de imagem, exportando um MP4 H.264/AAC pronto para download. Tudo local.
 */
export async function exportEditedMp4(
  source: Blob,
  segments: EditSegment[],
  filters: EditFilters,
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const ff = await getFFmpeg();
  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(Math.min(1, Math.max(0, progress)));
  };
  ff.on("progress", progressHandler);
  const inputName = "edit-input";
  try {
    await ff.writeFile(inputName, await fetchFile(source));

    const keep = segments
      .filter((s) => s.end - s.start > 0.05)
      .sort((a, b) => a.start - b.start);
    if (keep.length === 0) throw new Error("Nenhum trecho selecionado para exportar.");

    const run = async (withAudio: boolean) => {
      const parts: string[] = [];
      keep.forEach((s, i) => {
        parts.push(
          `[0:v]trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=PTS-STARTPTS,${eqExpr(filters)}[v${i}]`,
        );
        if (withAudio) {
          parts.push(
            `[0:a]atrim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`,
          );
        }
      });
      const refs = keep
        .map((_, i) => (withAudio ? `[v${i}][a${i}]` : `[v${i}]`))
        .join("");
      parts.push(
        `${refs}concat=n=${keep.length}:v=1:a=${withAudio ? 1 : 0}${withAudio ? "[vout][aout]" : "[vout]"}`,
      );
      const args = [
        "-y",
        "-i", inputName,
        "-filter_complex", parts.join(";"),
        "-map", "[vout]",
      ];
      if (withAudio) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "160k");
      args.push(
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "edit-output.mp4",
      );
      await ff.exec(args);
    };

    try {
      await run(true);
    } catch (audioErr) {
      console.warn("[ffmpeg] export com áudio falhou, tentando somente vídeo", audioErr);
      try { await ff.deleteFile("edit-output.mp4"); } catch { /* ignore */ }
      await run(false);
    }

    const data = (await ff.readFile("edit-output.mp4")) as Uint8Array;
    const buf = new ArrayBuffer(data.byteLength);
    new Uint8Array(buf).set(data);
    return new Blob([buf], { type: "video/mp4" });
  } finally {
    ff.off("progress", progressHandler);
    try { await ff.deleteFile(inputName); } catch { /* ignore */ }
    try { await ff.deleteFile("edit-output.mp4"); } catch { /* ignore */ }
  }
}

/* ------------------------------------------------------------------ *
 * Exportação da timeline multi-faixas (clipes, velocidade, zoom com
 * keyframes, transições, ajustes de imagem e camadas de texto).
 * ------------------------------------------------------------------ */

export type TransitionKind = "none" | "fade" | "slide";

export interface ZoomKey {
  /** segundos, relativo ao início do clipe já com a velocidade aplicada */
  t: number;
  /** 1 = 100% */
  scale: number;
}

export interface TimelineClip {
  srcStart: number;
  srcEnd: number;
  speed: number;
  filters: EditFilters;
  transition: TransitionKind;
  zoomKeys: ZoomKey[];
  /** redução de ruído de fundo (afftdn) */
  denoise?: boolean;
}

export interface TextOverlayImage {
  png: Blob;
  start: number;
  end: number;
  x: number;
  y: number;
}

/** Região retangular desfocada, em pixels do vídeo de origem. */
export interface BlurRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  strength: number;
  start: number;
  end: number;
}

export interface OutputFrame {
  width: number;
  height: number;
  /** deslocamento do conteúdo dentro do quadro, -1..1 (0 = centralizado) */
  offsetX: number;
  offsetY: number;
}

export interface ExportOptions {
  blurs?: BlurRegion[];
  frame?: OutputFrame;
}

const TRANSITION_DURATION = 0.5;

function zoomExpr(keys: ZoomKey[]): string {
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  if (sorted.length === 1) return sorted[0].scale.toFixed(3);
  let expr = sorted[sorted.length - 1].scale.toFixed(3);
  for (let i = sorted.length - 2; i >= 0; i--) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const span = Math.max(0.001, b.t - a.t);
    const lerp = `(${a.scale.toFixed(3)}+(${(b.scale - a.scale).toFixed(3)})*(t-${a.t.toFixed(3)})/${span.toFixed(3)})`;
    expr = `if(lt(t,${b.t.toFixed(3)}),${lerp},${expr})`;
  }
  const first = sorted[0];
  return `if(lt(t,${first.t.toFixed(3)}),${first.scale.toFixed(3)},${expr})`;
}

function atempoChain(speed: number): string {
  let remaining = speed;
  const parts: string[] = [];
  while (remaining > 2) {
    parts.push("atempo=2.0");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    parts.push("atempo=0.5");
    remaining *= 2;
  }
  parts.push(`atempo=${remaining.toFixed(4)}`);
  return parts.join(",");
}

export async function exportTimeline(
  source: Blob,
  clips: TimelineClip[],
  texts: TextOverlayImage[],
  size: { width: number; height: number },
  onProgress?: (ratio: number) => void,
  options: ExportOptions = {},
): Promise<Blob> {
  if (clips.length === 0) throw new Error("Nenhum clipe na timeline.");
  const ff = await getFFmpeg();
  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress?.(Math.min(1, Math.max(0, progress)));
  };
  ff.on("progress", progressHandler);

  const W = Math.max(2, Math.round(size.width / 2) * 2);
  const H = Math.max(2, Math.round(size.height / 2) * 2);
  const inputName = "tl-input";
  const textNames = texts.map((_, i) => `tl-text-${i}.png`);

  try {
    await ff.writeFile(inputName, await fetchFile(source));
    for (let i = 0; i < texts.length; i++) {
      await ff.writeFile(textNames[i], await fetchFile(texts[i].png));
    }

    const build = (withAudio: boolean) => {
      const parts: string[] = [];
      const durations: number[] = [];

      clips.forEach((clip, i) => {
        const speed = clip.speed || 1;
        const dur = Math.max(0.05, (clip.srcEnd - clip.srcStart) / speed);
        durations.push(dur);
        const chain = [
          `trim=start=${clip.srcStart.toFixed(3)}:end=${clip.srcEnd.toFixed(3)}`,
          `setpts=(PTS-STARTPTS)/${speed.toFixed(4)}`,
          `scale=${W}:${H}`,
        ];
        if (clip.zoomKeys.length > 0) {
          const z = zoomExpr(clip.zoomKeys);
          chain.push(
            `crop=w='iw/(${z})':h='ih/(${z})':x='(iw-ow)/2':y='(ih-oh)/2'`,
            `scale=${W}:${H}`,
          );
        }
        chain.push(eqExpr(clip.filters), "setsar=1", "format=yuv420p");
        parts.push(`[0:v]${chain.join(",")}[cv${i}]`);
        if (withAudio) {
          const achain = [
            `atrim=start=${clip.srcStart.toFixed(3)}:end=${clip.srcEnd.toFixed(3)}`,
            "asetpts=PTS-STARTPTS",
          ];
          if (Math.abs(speed - 1) > 0.001) achain.push(atempoChain(speed));
          if (clip.denoise) achain.push("highpass=f=90", "afftdn=nf=-25", "dynaudnorm=p=0.9:m=8");
          achain.push("aformat=sample_rates=48000:channel_layouts=stereo");
          parts.push(`[0:a]${achain.join(",")}[ca${i}]`);
        }
      });

      let vLabel = "cv0";
      let aLabel = "ca0";
      let acc = durations[0];
      for (let i = 1; i < clips.length; i++) {
        const kind = clips[i].transition;
        const outV = `mv${i}`;
        const outA = `ma${i}`;
        if (kind === "none") {
          parts.push(`[${vLabel}][cv${i}]concat=n=2:v=1:a=0[${outV}]`);
          if (withAudio) parts.push(`[${aLabel}][ca${i}]concat=n=2:v=0:a=1[${outA}]`);
          acc += durations[i];
        } else {
          const d = Math.min(TRANSITION_DURATION, durations[i - 1] / 2, durations[i] / 2);
          const transition = kind === "slide" ? "slideleft" : "fade";
          parts.push(
            `[${vLabel}][cv${i}]xfade=transition=${transition}:duration=${d.toFixed(3)}:offset=${Math.max(0, acc - d).toFixed(3)}[${outV}]`,
          );
          if (withAudio) {
            parts.push(`[${aLabel}][ca${i}]acrossfade=d=${d.toFixed(3)}[${outA}]`);
          }
          acc += durations[i] - d;
        }
        vLabel = outV;
        if (withAudio) aLabel = outA;
      }

      const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
      (options.blurs ?? []).forEach((b, i) => {
        const bw = even(Math.min(b.w, W));
        const bh = even(Math.min(b.h, H));
        const bx = Math.max(0, Math.min(W - bw, Math.round(b.x)));
        const by = Math.max(0, Math.min(H - bh, Math.round(b.y)));
        const sigma = Math.max(2, Math.round(b.strength));
        parts.push(`[${vLabel}]split=2[bs${i}][bc${i}]`);
        parts.push(
          `[bc${i}]crop=${bw}:${bh}:${bx}:${by},boxblur=${sigma}:2,format=yuv420p[bb${i}]`,
        );
        parts.push(
          `[bs${i}][bb${i}]overlay=x=${bx}:y=${by}:enable='between(t,${b.start.toFixed(3)},${b.end.toFixed(3)})'[bo${i}]`,
        );
        vLabel = `bo${i}`;
      });

      texts.forEach((t, i) => {
        const out = `tx${i}`;
        parts.push(
          `[${vLabel}][${i + 1}:v]overlay=x=${Math.round(t.x)}:y=${Math.round(t.y)}:enable='between(t,${t.start.toFixed(3)},${t.end.toFixed(3)})'[${out}]`,
        );
        vLabel = out;
      });

      const frame = options.frame;
      if (frame) {
        const FW = even(frame.width);
        const FH = even(frame.height);
        const ox = `((ow-iw)/2+${(frame.offsetX / 2).toFixed(4)}*ow)`;
        const oy = `((oh-ih)/2+${(frame.offsetY / 2).toFixed(4)}*oh)`;
        parts.push(
          `[${vLabel}]scale=${FW}:${FH}:force_original_aspect_ratio=decrease,pad=${FW}:${FH}:x='${ox}':y='${oy}':color=black,setsar=1[fr]`,
        );
        vLabel = "fr";
      }

      parts.push(`[${vLabel}]format=yuv420p[vout]`);

      const args = ["-y", "-i", inputName];
      for (const name of textNames) args.push("-i", name);
      args.push("-filter_complex", parts.join(";"), "-map", "[vout]");
      if (withAudio) args.push("-map", `[${aLabel}]`, "-c:a", "aac", "-b:a", "160k");
      args.push(
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "tl-output.mp4",
      );
      return args;
    };

    try {
      await ff.exec(build(true));
    } catch (audioErr) {
      console.warn("[ffmpeg] export com áudio falhou, tentando somente vídeo", audioErr);
      try { await ff.deleteFile("tl-output.mp4"); } catch { /* ignore */ }
      await ff.exec(build(false));
    }

    const data = (await ff.readFile("tl-output.mp4")) as Uint8Array;
    const buf = new ArrayBuffer(data.byteLength);
    new Uint8Array(buf).set(data);
    return new Blob([buf], { type: "video/mp4" });
  } finally {
    ff.off("progress", progressHandler);
    try { await ff.deleteFile(inputName); } catch { /* ignore */ }
    try { await ff.deleteFile("tl-output.mp4"); } catch { /* ignore */ }
    for (const name of textNames) {
      try { await ff.deleteFile(name); } catch { /* ignore */ }
    }
  }
}

export type GifQuality = "leve" | "media" | "alta";

const GIF_PRESETS: Record<GifQuality, { width: number; fps: number }> = {
  leve: { width: 320, fps: 8 },
  media: { width: 480, fps: 12 },
  alta: { width: 640, fps: 15 },
};

/**
 * Gera um GIF animado de um trecho do vídeo, 100% local (ffmpeg.wasm),
 * usando palettegen/paletteuse em duas passadas para boa qualidade de cor.
 */
export async function videoToGif(
  source: Blob,
  opts: {
    start: number;
    end: number;
    speed: number;
    quality: GifQuality;
  },
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const ff = await getFFmpeg();
  const { width, fps } = GIF_PRESETS[opts.quality];
  const duration = Math.max(0.1, opts.end - opts.start);
  const speed = opts.speed > 0 ? opts.speed : 1;

  let phase = 0; // 0 = palette, 1 = gif
  const progressHandler = ({ progress }: { progress: number }) => {
    const p = Math.min(1, Math.max(0, progress));
    onProgress?.(phase === 0 ? p * 0.3 : 0.3 + p * 0.7);
  };
  ff.on("progress", progressHandler);

  const inputName = "gif-input";
  try {
    await ff.writeFile(inputName, await fetchFile(source));
    const chain = `fps=${fps},scale=${width}:-1:flags=lanczos,setpts=PTS/${speed.toFixed(3)}`;

    await ff.exec([
      "-y",
      "-ss", opts.start.toFixed(3),
      "-t", duration.toFixed(3),
      "-i", inputName,
      "-vf", `${chain},palettegen=stats_mode=diff`,
      "gif-palette.png",
    ]);

    phase = 1;
    await ff.exec([
      "-y",
      "-ss", opts.start.toFixed(3),
      "-t", duration.toFixed(3),
      "-i", inputName,
      "-i", "gif-palette.png",
      "-lavfi", `${chain}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
      "-loop", "0",
      "gif-output.gif",
    ]);

    const data = (await ff.readFile("gif-output.gif")) as Uint8Array;
    const buf = new ArrayBuffer(data.byteLength);
    new Uint8Array(buf).set(data);
    onProgress?.(1);
    return new Blob([buf], { type: "image/gif" });
  } finally {
    ff.off("progress", progressHandler);
    for (const f of [inputName, "gif-palette.png", "gif-output.gif"]) {
      try { await ff.deleteFile(f); } catch { /* ignore */ }
    }
  }
}
