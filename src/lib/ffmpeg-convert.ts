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