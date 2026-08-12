/**
 * Pipeline única de composição do preview.
 *
 * Todo o frame (vídeo + transição + overlays + texto + legenda) é calculado
 * UMA vez por quadro em `buildFrame` e desenhado em UMA passagem no mesmo
 * <canvas> por `drawFrame`. Nada de camadas DOM animadas em paralelo.
 */
import {
  clipAt,
  clipsAt,
  zoomAt,
  type CaptionStyle,
  type Clip,
  type Track,
} from "@/state/editor-store";
import { resolveClip } from "@/lib/keyframes";
import { captionWordFx, toSeconds, CAPTION_END_BUFFER, typewriterText } from "@/lib/caption-styles";

export interface TransitionFx {
  opacity: number;
  scale: number;
  tx: number; // fração da largura
  ty: number; // fração da altura
  /** inset de recorte em frações: [top, right, bottom, left] */
  inset: [number, number, number, number] | null;
}

export interface VideoFx {
  clip: Clip;
  brightness: number;
  contrast: number;
  saturation: number;
  opacity: number;
  scale: number;
  rotation: number;
  panX: number;
  panY: number;
  transition: TransitionFx | null;
}

export interface FrameData {
  video: VideoFx | null;
  overlays: Clip[];
  texts: Clip[];
  caption: { clip: Clip; progress: number } | null;
  captionStyle: CaptionStyle;
  selectedId: string | null;
}

const NO_TRANSITION: TransitionFx = { opacity: 1, scale: 1, tx: 0, ty: 0, inset: null };

function transitionAt(clip: Clip, time: number): TransitionFx | null {
  const kind = clip.transition ?? "none";
  if (kind === "none") return null;
  const d = Math.max(0.1, Math.min(clip.transitionDuration ?? 0.5, clip.duration));
  const p = (time - clip.startTime) / d;
  if (p < 0 || p >= 1) return null;
  const dir = clip.transitionDir ?? "left";
  const off = 1 - p;
  if (kind === "fade") return { ...NO_TRANSITION, opacity: p };
  if (kind === "zoom") return { ...NO_TRANSITION, opacity: p, scale: 0.7 + 0.3 * p };
  if (kind === "slide") {
    const tx = dir === "right" ? -off : dir === "left" ? off : 0;
    const ty = dir === "up" ? off : dir === "down" ? -off : 0;
    return { ...NO_TRANSITION, tx, ty };
  }
  const inset: [number, number, number, number] =
    dir === "right"
      ? [0, 0, 0, off]
      : dir === "up"
        ? [off, 0, 0, 0]
        : dir === "down"
          ? [0, 0, off, 0]
          : [0, off, 0, 0];
  return { ...NO_TRANSITION, inset };
}

/** Estado consolidado do quadro: uma passagem de interpolação por frame. */
export function buildFrame(
  tracks: Track[],
  captionStyle: CaptionStyle,
  time: number,
  selectedId: string | null,
): FrameData {
  const raw = clipAt(tracks, "video", time);
  let video: VideoFx | null = null;
  if (raw) {
    const c = resolveClip(raw, time);
    const z = zoomAt(c, time - c.startTime);
    video = {
      clip: c,
      brightness: 1 + (c.brightness ?? 0),
      contrast: c.contrast ?? 1,
      saturation: c.saturation ?? 1,
      opacity: c.opacity ?? 1,
      scale: (c.scale ?? 1) * z.scale,
      rotation: c.rotation ?? 0,
      panX: (c.position?.x ?? 0) + z.x,
      panY: (c.position?.y ?? 0) + z.y,
      transition: transitionAt(raw, time),
    };
  }

  const textTrack = clipsAt(tracks, "text", time);
  const texts = textTrack.filter((c) => !c.isCaption).map((c) => resolveClip(c, time));
  const overlays = clipsAt(tracks, "overlay", time).map((c) => resolveClip(c, time));

  let caption: FrameData["caption"] = null;
  for (const c of tracks.flatMap((t) => t.clips)) {
    if (!c.isCaption) continue;
    const start = toSeconds(c.startTime);
    const end = start + toSeconds(c.duration) + CAPTION_END_BUFFER;
    if (time >= start && time <= end) {
      const dur = Math.max(0.01, toSeconds(c.duration));
      caption = { clip: c, progress: Math.max(0, Math.min(1, (time - start) / dur)) };
      break;
    }
  }

  return { video, overlays, texts, caption, captionStyle, selectedId };
}

export interface HitRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "text" | "overlay";
}

function withAlpha(hex: string, alpha: number) {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** retângulo "object-contain" do vídeo dentro do palco, com pan. */
function containRect(vw: number, vh: number, W: number, H: number, panX: number, panY: number) {
  const s = Math.min(W / vw, H / vh);
  const w = vw * s;
  const h = vh * s;
  return {
    x: (W - w) / 2 + panX * ((W - w) / 2 || w / 2),
    y: (H - h) / 2 + panY * ((H - h) / 2 || h / 2),
    w,
    h,
  };
}

/**
 * Desenha o quadro inteiro em uma passagem e devolve as áreas clicáveis
 * (para arraste de texto/overlay direto no canvas).
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  frame: FrameData,
  W: number,
  H: number,
): HitRegion[] {
  const hits: HitRegion[] = [];
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);

  const fx = frame.video;
  let rect = { x: 0, y: 0, w: W, h: H };

  if (fx && video && video.videoWidth > 0) {
    const t = fx.transition;
    rect = containRect(video.videoWidth, video.videoHeight, W, H, fx.panX, fx.panY);
    ctx.save();
    if (t?.inset) {
      const [top, right, bottom, left] = t.inset;
      ctx.beginPath();
      ctx.rect(left * W, top * H, W * (1 - left - right), H * (1 - top - bottom));
      ctx.clip();
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, fx.opacity * (t?.opacity ?? 1)));
    ctx.filter = `brightness(${fx.brightness}) contrast(${fx.contrast}) saturate(${fx.saturation})`;
    ctx.translate(W / 2 + (t?.tx ?? 0) * W, H / 2 + (t?.ty ?? 0) * H);
    if (fx.rotation) ctx.rotate((fx.rotation * Math.PI) / 180);
    const scale = fx.scale * (t?.scale ?? 1);
    if (scale !== 1) ctx.scale(scale, scale);
    try {
      ctx.drawImage(video, rect.x - W / 2, rect.y - H / 2, rect.w, rect.h);
    } catch {
      /* frame ainda não disponível */
    }
    ctx.restore();
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  }

  /* ---------- overlays (blur / spotlight) ---------- */
  for (const clip of frame.overlays) {
    const r = clip.rect ?? { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
    const px = { x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H };
    hits.push({ id: clip.id, kind: "overlay", ...px });
    ctx.save();
    ctx.globalAlpha = clip.opacity ?? 1;
    if (clip.overlayKind === "spotlight") {
      ctx.fillStyle = `rgba(0,0,0,${clip.strength ?? 0.7})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.ellipse(px.x + px.w / 2, px.y + px.h / 2, px.w / 2, px.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (video && video.videoWidth > 0) {
      ctx.beginPath();
      ctx.rect(px.x, px.y, px.w, px.h);
      ctx.clip();
      ctx.filter = `blur(${clip.strength ?? 12}px)`;
      try {
        ctx.drawImage(video, rect.x, rect.y, rect.w, rect.h);
      } catch {
        /* ignore */
      }
    }
    ctx.restore();
    if (clip.id === frame.selectedId) {
      ctx.save();
      ctx.strokeStyle = "#e53935";
      ctx.lineWidth = 2;
      ctx.strokeRect(px.x, px.y, px.w, px.h);
      ctx.restore();
    }
  }

  /* ---------- textos ---------- */
  for (const clip of frame.texts) {
    const size = ((clip.fontSize ?? 48) / 720) * H;
    const mode = clip.revealMode ?? "none";
    const reveal = Math.max(0, Math.min(1, clip.reveal ?? 1));
    const full = clip.textContent ?? "";
    const shown = mode === "typewriter" ? full.slice(0, Math.round(full.length * reveal)) : full;
    const cx = (clip.position?.x ?? 0.5) * W;
    const cy = (clip.position?.y ?? 0.82) * H;

    ctx.save();
    ctx.globalAlpha = clip.opacity ?? 1;
    if ((clip.blur ?? 0) > 0.01) ctx.filter = `blur(${clip.blur}px)`;
    ctx.translate(cx, cy);
    if (clip.rotation) ctx.rotate((clip.rotation * Math.PI) / 180);
    const s = clip.scale ?? 1;
    if (s !== 1) ctx.scale(s, s);
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = ctx.measureText(shown || " ").width;
    const padX = size * 0.35;
    const padY = size * 0.22;
    const boxW = w + padX * 2;
    const boxH = size * 1.2 + padY * 2;
    if (clip.background !== false) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, size * 0.18);
      ctx.fill();
    }
    if (mode === "wipe") {
      ctx.beginPath();
      ctx.rect(-boxW / 2, -boxH / 2, boxW * reveal, boxH);
      ctx.clip();
    }
    ctx.fillStyle = clip.color ?? "#fff";
    ctx.fillText(shown, 0, 0);
    ctx.restore();

    hits.push({
      id: clip.id,
      kind: "text",
      x: cx - (boxW * s) / 2,
      y: cy - (boxH * s) / 2,
      w: boxW * s,
      h: boxH * s,
    });
    if (clip.id === frame.selectedId) {
      ctx.save();
      ctx.strokeStyle = "#e53935";
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - (boxW * s) / 2, cy - (boxH * s) / 2, boxW * s, boxH * s);
      ctx.restore();
    }
  }

  /* ---------- legenda animada ---------- */
  if (frame.caption) {
    const cs = frame.captionStyle;
    const { clip, progress } = frame.caption;
    const size = (cs.fontSize / 720) * H;
    const cx = (clip.position?.x ?? 0.5) * W;
    const cy = (clip.position?.y ?? 0.85) * H;
    const weight = cs.bold ? 800 : 500;
    const style = cs.italic ? "italic " : "";
    ctx.save();
    ctx.font = `${style}${weight} ${size}px ${cs.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = clip.opacity ?? 1;

    const full = clip.textContent ?? "";
    if (cs.anim === "typewriter") {
      const shown = typewriterText(full, progress);
      const w = ctx.measureText(shown || " ").width;
      const padX = size * 0.35;
      const padY = size * 0.2;
      if (cs.background) {
        ctx.fillStyle = withAlpha(cs.highlight, cs.bgOpacity);
        roundRect(ctx, cx - w / 2 - padX, cy - size * 0.6 - padY, w + padX * 2, size * 1.2 + padY * 2, size * 0.2);
        ctx.fill();
      }
      if (cs.outline) {
        ctx.lineWidth = size * 0.06;
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.strokeText(shown, cx, cy);
      }
      ctx.fillStyle = cs.color;
      ctx.fillText(shown, cx, cy);
      ctx.restore();
    } else {
      const fx2 = captionWordFx(cs.anim, full, progress, {
        color: cs.color,
        highlight: cs.highlight,
        wordByWord: cs.wordByWord,
      });
      const gap = size * 0.28;
      const widths = fx2.map((w) => ctx.measureText(w.text).width);
      const maxW = W * 0.88;
      // quebra em linhas
      const lines: { from: number; to: number; width: number }[] = [];
      let from = 0;
      let acc = 0;
      for (let i = 0; i < fx2.length; i++) {
        const add = widths[i] + (i > from ? gap : 0);
        if (acc + add > maxW && i > from) {
          lines.push({ from, to: i, width: acc });
          from = i;
          acc = widths[i];
        } else acc += add;
      }
      lines.push({ from, to: fx2.length, width: acc });

      const lineH = size * 1.25;
      const totalH = lines.length * lineH;
      if (cs.background) {
        const padX = size * 0.35;
        const bw = Math.max(...lines.map((l) => l.width)) + padX * 2;
        ctx.fillStyle = withAlpha(cs.highlight, cs.bgOpacity);
        roundRect(ctx, cx - bw / 2, cy - totalH / 2 - size * 0.15, bw, totalH + size * 0.3, size * 0.22);
        ctx.fill();
      }

      lines.forEach((line, li) => {
        const y = cy - totalH / 2 + lineH * (li + 0.5);
        let x = cx - line.width / 2;
        for (let i = line.from; i < line.to; i++) {
          const w = fx2[i];
          const cxw = x + widths[i] / 2;
          ctx.save();
          ctx.globalAlpha = (clip.opacity ?? 1) * w.alpha;
          ctx.translate(cxw, y + w.dy * size);
          if (w.rotate) ctx.rotate((w.rotate * Math.PI) / 180);
          if (w.scale !== 1) ctx.scale(w.scale, w.scale);
          if (w.glow) {
            ctx.shadowColor = w.color;
            ctx.shadowBlur = size * 0.45;
          }
          if (cs.outline) {
            ctx.lineWidth = size * 0.06;
            ctx.strokeStyle = "rgba(0,0,0,0.85)";
            ctx.strokeText(w.text, 0, 0);
          }
          ctx.fillStyle = w.color;
          ctx.fillText(w.text, 0, 0);
          ctx.restore();
          x += widths[i] + gap;
        }
      });
      ctx.restore();

      const bw = Math.max(...lines.map((l) => l.width)) + size * 0.7;
      hits.push({ id: clip.id, kind: "text", x: cx - bw / 2, y: cy - totalH / 2, w: bw, h: totalH });
      if (clip.id === frame.selectedId) {
        ctx.save();
        ctx.strokeStyle = "#e53935";
        ctx.lineWidth = 2;
        ctx.strokeRect(cx - bw / 2, cy - totalH / 2, bw, totalH);
        ctx.restore();
      }
    }
  }

  return hits;
}
