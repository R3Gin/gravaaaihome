import {
  exportTimeline,
  type BlurRegion,
  type OutputFrame,
  type TextOverlayImage,
  type TimelineClip,
} from "@/lib/ffmpeg-convert";
import type { AspectRatio, Clip, Track } from "@/state/editor-store";
import { drawAnnotation } from "@/lib/annotations";

function frameSize(aspect: AspectRatio, base: { width: number; height: number }): OutputFrame {
  const h = Math.max(360, Math.min(1080, base.height || 720));
  if (aspect === "9:16") return { width: Math.round((h * 9) / 16), height: h, offsetX: 0, offsetY: 0 };
  if (aspect === "1:1") return { width: h, height: h, offsetX: 0, offsetY: 0 };
  return { width: Math.round((h * 16) / 9), height: h, offsetX: 0, offsetY: 0 };
}

async function textToPng(clip: Clip, W: number, H: number): Promise<TextOverlayImage | null> {
  const text = (clip.textContent ?? "").trim();
  if (!text) return null;
  const fontSize = Math.round(((clip.fontSize ?? 48) / 720) * H);
  const pad = Math.round(fontSize * 0.35);
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return null;
  measure.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
  const width = Math.ceil(measure.measureText(text).width) + pad * 2;
  const height = fontSize + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, width);
  canvas.height = Math.max(2, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (clip.background !== false) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = clip.color ?? "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, pad, canvas.height / 2);
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) return null;
  const cx = (clip.position?.x ?? 0.5) * W - canvas.width / 2;
  const cy = (clip.position?.y ?? 0.82) * H - canvas.height / 2;
  return {
    png,
    start: clip.startTime,
    end: clip.startTime + clip.duration,
    x: Math.max(0, Math.min(W - canvas.width, cx)),
    y: Math.max(0, Math.min(H - canvas.height, cy)),
  };
}

async function annotationToPng(clip: Clip, W: number, H: number): Promise<TextOverlayImage | null> {
  if (!clip.annotation) return null;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  drawAnnotation(ctx, clip.annotation, W, H);
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) return null;
  return {
    png,
    start: clip.startTime,
    end: clip.startTime + clip.duration,
    x: 0,
    y: 0,
  };
}

/**
 * Traduz o estado central do projeto em uma exportação ffmpeg.wasm real.
 */
export async function exportProject(
  source: Blob,
  tracks: Track[],
  aspect: AspectRatio,
  videoSize: { width: number; height: number },
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const videoClips = [...(tracks.find((t) => t.type === "video")?.clips ?? [])].sort(
    (a, b) => a.startTime - b.startTime,
  );
  if (videoClips.length === 0) throw new Error("Nenhum clipe de vídeo na timeline.");

  const W = Math.max(2, Math.round((videoSize.width || 1280) / 2) * 2);
  const H = Math.max(2, Math.round((videoSize.height || 720) / 2) * 2);

  const timeline: TimelineClip[] = videoClips.map((c) => {
    const scaleKeys = (c.keyframes?.scale ?? []).filter((k) => typeof k.value === "number");
    const rotKeys = (c.keyframes?.rotation ?? []).filter((k) => typeof k.value === "number");
    const zoomKeys = (c.zoomKeyframes ?? []).map((k) => ({ t: k.time, scale: k.scale }));
    // escala animada entra no mesmo caminho de zoom da exportação
    for (const k of scaleKeys) {
      zoomKeys.push({ t: k.time, scale: Math.max(0.05, k.value as number) });
    }
    for (const k of c.keyframes?.zoom ?? []) {
      if (typeof k.value === "number") zoomKeys.push({ t: k.time, scale: Math.max(0.05, k.value) });
    }
    zoomKeys.sort((a, b) => a.t - b.t);

    // pan animado (posição do clipe de vídeo + pan do zoom legado)
    const panX: { t: number; value: number }[] = [];
    const panY: { t: number; value: number }[] = [];
    for (const k of c.zoomKeyframes ?? []) {
      if (k.x || k.y) {
        panX.push({ t: k.time, value: k.x ?? 0 });
        panY.push({ t: k.time, value: k.y ?? 0 });
      }
    }
    for (const k of c.keyframes?.position ?? []) {
      const v = k.value as { x?: number; y?: number } | undefined;
      if (v && typeof v === "object") {
        panX.push({ t: k.time, value: v.x ?? 0 });
        panY.push({ t: k.time, value: v.y ?? 0 });
      }
    }
    panX.sort((a, b) => a.t - b.t);
    panY.sort((a, b) => a.t - b.t);

    const opacityKeys = (c.keyframes?.opacity ?? [])
      .filter((k) => typeof k.value === "number")
      .map((k) => ({ t: k.time, value: Math.max(0, Math.min(1, k.value as number)) }))
      .sort((a, b) => a.t - b.t);

    return {
      srcStart: c.sourceInStart,
      srcEnd: c.sourceInEnd,
      speed: c.speed ?? 1,
      filters: {
        brightness: c.brightness ?? 0,
        contrast: c.contrast ?? 1,
        saturation: c.saturation ?? 1,
      },
      transition: c.transition ?? "none",
      transitionDuration: c.transitionDuration,
      transitionDir: c.transitionDir,
      zoomKeys,
      rotateKeys: rotKeys.map((k) => ({ t: k.time, value: k.value as number })),
      panXKeys: panX,
      panYKeys: panY,
      opacityKeys,
      denoise: c.denoise ?? false,
      // áudio separado: o volume vem do clipe da faixa de áudio vinculado
      volume: c.muted
        ? (audioClips.find((a) => a.linkGroupId && a.linkGroupId === c.linkGroupId)?.volume ?? 0)
        : (c.volume ?? 1),

      fadeIn: c.fadeIn ?? 0,
      fadeOut: c.fadeOut ?? 0,
    };
  });

  const textClips = tracks.find((t) => t.type === "text")?.clips ?? [];
  const texts: TextOverlayImage[] = [];
  for (const clip of textClips) {
    const png = await textToPng(clip, W, H);
    if (png) texts.push(png);
  }

  const overlayClips = tracks.find((t) => t.type === "overlay")?.clips ?? [];
  for (const clip of overlayClips) {
    if (clip.overlayKind !== "annotation") continue;
    const png = await annotationToPng(clip, W, H);
    if (png) texts.push(png);
  }

  const blurs: BlurRegion[] = (overlayClips)
    .filter((c) => c.overlayKind === "blur" && c.rect)
    .map((c) => ({
      x: (c.rect!.x) * W,
      y: (c.rect!.y) * H,
      w: (c.rect!.w) * W,
      h: (c.rect!.h) * H,
      strength: c.strength ?? 12,
      start: c.startTime,
      end: c.startTime + c.duration,
    }));

  const frame = aspect === "16:9" ? undefined : frameSize(aspect, { width: W, height: H });

  return exportTimeline(source, timeline, texts, { width: W, height: H }, onProgress, {
    blurs,
    frame,
  });
}
