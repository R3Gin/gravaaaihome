// Camada de anotação em tempo real sobre o preview de captura.
// Suporta caneta livre, seta, retângulo, elipse, destaque, borracha e
// zoom ao vivo. Todas as anotações são guardadas em coordenadas
// NORMALIZADAS (0..1) do container do preview, o que permite redesenhá-las
// no <canvas> de composição (qualquer resolução) — por isso aparecem no MP4.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ArrowUpRight,
  Circle,
  Eraser,
  Highlighter,
  Pen,
  Square as SquareIcon,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type AnnotationTool =
  | "pen"
  | "arrow"
  | "rect"
  | "ellipse"
  | "highlight"
  | "eraser"
  | "zoom";

export interface Annotation {
  id: number;
  type: Exclude<AnnotationTool, "eraser" | "zoom">;
  color: string;
  /** Espessura normalizada pela altura do container (0..1). */
  sizeN: number;
  fill: boolean;
  /** Caneta: caminho. Formas: [inicio, fim]. */
  points: { x: number; y: number }[];
}

/** Compat: tipo antigo. */
export type Stroke = Annotation;

export const PEN_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ffffff"];

export const ANNOTATION_TOOLS: {
  id: AnnotationTool;
  label: string;
  key: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "pen", label: "Caneta", key: "P", Icon: Pen },
  { id: "arrow", label: "Seta", key: "A", Icon: ArrowUpRight },
  { id: "rect", label: "Retângulo", key: "R", Icon: SquareIcon },
  { id: "ellipse", label: "Círculo", key: "C", Icon: Circle },
  { id: "highlight", label: "Destaque", key: "H", Icon: Highlighter },
  { id: "zoom", label: "Zoom", key: "Z", Icon: ZoomIn },
  { id: "eraser", label: "Borracha", key: "E", Icon: Eraser },
];

/* ─────────────────────────── zoom ao vivo ─────────────────────────── */

export interface ZoomState {
  k: number;
  cx: number;
  cy: number;
}

interface ZoomAnim {
  from: ZoomState;
  to: ZoomState;
  start: number;
  dur: number;
}

const IDENTITY: ZoomState = { k: 1, cx: 0.5, cy: 0.5 };

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function clampCenter(z: ZoomState): ZoomState {
  if (z.k <= 1) return { k: 1, cx: 0.5, cy: 0.5 };
  const h = 0.5 / z.k;
  return {
    k: z.k,
    cx: Math.min(1 - h, Math.max(h, z.cx)),
    cy: Math.min(1 - h, Math.max(h, z.cy)),
  };
}

export function readZoom(anim: ZoomAnim, now = performance.now()): ZoomState {
  const t = anim.dur <= 0 ? 1 : Math.min(1, Math.max(0, (now - anim.start) / anim.dur));
  if (t >= 1) return anim.to;
  const e = easeInOut(t);
  return {
    k: anim.from.k + (anim.to.k - anim.from.k) * e,
    cx: anim.from.cx + (anim.to.cx - anim.from.cx) * e,
    cy: anim.from.cy + (anim.to.cy - anim.from.cy) * e,
  };
}

/** Aplica a transformação de zoom a um contexto 2D de tamanho W×H. */
export function applyZoomTransform(
  ctx: CanvasRenderingContext2D,
  z: ZoomState,
  W: number,
  H: number,
) {
  if (z.k === 1) return;
  ctx.translate(W / 2, H / 2);
  ctx.scale(z.k, z.k);
  ctx.translate(-z.cx * W, -z.cy * H);
}

export function zoomCssTransform(z: ZoomState) {
  if (z.k === 1) return "none";
  return `translate(${((0.5 - z.k * z.cx) * 100) / 1}%, ${(0.5 - z.k * z.cy) * 100}%) scale(${z.k})`;
}

/* ─────────────────────────── controller ─────────────────────────── */

export function useDrawing() {
  const [active, setActive] = useState(false);
  const [tool, setToolState] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [size, setSize] = useState(6);
  const [fillShapes, setFillShapes] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(2);
  const [zoomActive, setZoomActive] = useState(false);
  const [version, setVersion] = useState(0);

  const itemsRef = useRef<Annotation[]>([]);
  const zoomAnimRef = useRef<ZoomAnim>({ from: IDENTITY, to: IDENTITY, start: 0, dur: 0 });

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const clear = useCallback(() => {
    itemsRef.current = [];
    bump();
  }, [bump]);

  const setTool = useCallback((t: AnnotationTool) => {
    setToolState(t);
    setActive(true);
  }, []);

  const zoomTo = useCallback((cx: number, cy: number, k: number, dur = 420) => {
    const now = performance.now();
    const current = readZoom(zoomAnimRef.current, now);
    zoomAnimRef.current = {
      from: current,
      to: clampCenter({ k, cx, cy }),
      start: now,
      dur,
    };
    setZoomActive(k > 1);
  }, []);

  const resetZoom = useCallback(() => {
    const now = performance.now();
    zoomAnimRef.current = {
      from: readZoom(zoomAnimRef.current, now),
      to: IDENTITY,
      start: now,
      dur: 420,
    };
    setZoomActive(false);
  }, []);

  const getZoom = useCallback((now?: number) => readZoom(zoomAnimRef.current, now), []);

  // Compat com código antigo (strokes = anotações).
  const strokesRef = itemsRef;
  const eraser = tool === "eraser";
  const setEraser = useCallback(
    (v: boolean) => setToolState(v ? "eraser" : "pen"),
    [],
  );

  return {
    active,
    setActive,
    tool,
    setTool,
    color,
    setColor,
    size,
    setSize,
    fillShapes,
    setFillShapes,
    zoomLevel,
    setZoomLevel,
    zoomActive,
    zoomTo,
    resetZoom,
    getZoom,
    itemsRef,
    strokesRef,
    version,
    bump,
    clear,
    eraser,
    setEraser,
    strokeCount: itemsRef.current.length,
  };
}

export type DrawingController = ReturnType<typeof useDrawing>;

/* ─────────────────────────── render ─────────────────────────── */

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w: number,
) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.max(w * 3.2, 10);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - len * Math.cos(ang - Math.PI / 7), y1 - len * Math.sin(ang - Math.PI / 7));
  ctx.lineTo(x1 - len * Math.cos(ang + Math.PI / 7), y1 - len * Math.sin(ang + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

/** Desenha todas as anotações em um canvas de tamanho W×H. */
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  items: Annotation[],
  W: number,
  H: number,
) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const it of items) {
    const pts = it.points;
    if (pts.length === 0) continue;
    const lw = Math.max(1, it.sizeN * H);
    ctx.lineWidth = lw;
    ctx.strokeStyle = it.color;
    ctx.fillStyle = it.color;
    ctx.globalAlpha = 1;

    if (it.type === "pen") {
      ctx.beginPath();
      ctx.moveTo(pts[0].x * W, pts[0].y * H);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * W, pts[i].y * H);
      if (pts.length === 1) ctx.lineTo(pts[0].x * W + 0.1, pts[0].y * H);
      ctx.stroke();
      continue;
    }

    const a = pts[0];
    const b = pts[pts.length - 1];
    const x0 = a.x * W;
    const y0 = a.y * H;
    const x1 = b.x * W;
    const y1 = b.y * H;

    if (it.type === "arrow") {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      drawArrowHead(ctx, x0, y0, x1, y1, lw);
    } else if (it.type === "rect") {
      const x = Math.min(x0, x1);
      const y = Math.min(y0, y1);
      const w = Math.abs(x1 - x0);
      const h = Math.abs(y1 - y0);
      if (it.fill) {
        ctx.globalAlpha = 0.2;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
      }
      ctx.strokeRect(x, y, w, h);
    } else if (it.type === "ellipse") {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const rx = Math.abs(x1 - x0) / 2;
      const ry = Math.abs(y1 - y0) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (it.fill) {
        ctx.globalAlpha = 0.2;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.stroke();
    } else if (it.type === "highlight") {
      const x = Math.min(x0, x1);
      const y = Math.min(y0, y1);
      const w = Math.abs(x1 - x0);
      const h = Math.abs(y1 - y0);
      ctx.globalAlpha = 0.32;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

/** Compat: assinatura antiga usada pelo compositor. */
export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  items: Annotation[],
  W: number,
  H: number,
) {
  drawAnnotations(ctx, items, W, H);
}

function hitsAnnotation(it: Annotation, x: number, y: number, r: number) {
  if (it.type === "pen") {
    return it.points.some((p) => Math.hypot(p.x - x, p.y - y) <= r);
  }
  const a = it.points[0];
  const b = it.points[it.points.length - 1];
  const minX = Math.min(a.x, b.x) - r;
  const maxX = Math.max(a.x, b.x) + r;
  const minY = Math.min(a.y, b.y) - r;
  const maxY = Math.max(a.y, b.y) + r;
  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

/* ─────────────────────────── overlay canvas ─────────────────────────── */

/** Canvas transparente por cima do preview: captura as anotações do usuário. */
export function DrawingCanvas({
  controller,
  containerRef,
  zoomTargetRef,
}: {
  controller: DrawingController;
  containerRef: RefObject<HTMLDivElement | null>;
  /** Elemento (vídeo do preview) que recebe o zoom via CSS. */
  zoomTargetRef?: RefObject<HTMLElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draftRef = useRef<Annotation | null>(null);
  const zoomDragRef = useRef<{ x: number; y: number } | null>(null);
  const [zoomDrag, setZoomDrag] = useState<{ x: number; y: number; x2: number; y2: number } | null>(
    null,
  );
  const {
    active,
    itemsRef,
    color,
    size,
    tool,
    fillShapes,
    zoomLevel,
    bump,
    version,
    getZoom,
    zoomTo,
    resetZoom,
  } = controller;

  const stateRef = useRef({ active, tool, color, size, fillShapes, zoomLevel });
  stateRef.current = { active, tool, color, size, fillShapes, zoomLevel };

  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const z = getZoom();
    ctx.save();
    applyZoomTransform(ctx, z, w, h);
    drawAnnotations(ctx, itemsRef.current, w, h);
    ctx.restore();

    // Retângulo guia do zoom (apenas preview local, não vai pro MP4).
    const zd = zoomDragRef.current ? zoomDrag : null;
    if (zd) {
      ctx.save();
      ctx.strokeStyle = "#ef4444";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(
        Math.min(zd.x, zd.x2) * w,
        Math.min(zd.y, zd.y2) * h,
        Math.abs(zd.x2 - zd.x) * w,
        Math.abs(zd.y2 - zd.y) * h,
      );
      ctx.restore();
    }

    // Zoom em CSS no vídeo do preview (o MP4 recebe o zoom no compositor).
    const target = zoomTargetRef?.current;
    if (target) {
      target.style.transformOrigin = "0 0";
      target.style.transform = zoomCssTransform(z);
    }
  }, [containerRef, itemsRef, getZoom, zoomDrag, zoomTargetRef]);

  // Loop de pintura: mantém zoom animado e traços sempre atualizados.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      repaint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [repaint]);

  useEffect(() => {
    repaint();
  }, [repaint, version]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / Math.max(1, rect.width);
    const py = (e.clientY - rect.top) / Math.max(1, rect.height);
    // Converte para o espaço das anotações (desfaz o zoom atual).
    const z = getZoom();
    if (z.k === 1) return { x: px, y: py };
    return {
      x: z.cx + (px - 0.5) / z.k,
      y: z.cy + (py - 0.5) / z.k,
    };
  };

  const rawPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / Math.max(1, rect.width),
      y: (e.clientY - rect.top) / Math.max(1, rect.height),
    };
  };

  const eraseAt = (p: { x: number; y: number }) => {
    const before = itemsRef.current.length;
    itemsRef.current = itemsRef.current.filter((it) => !hitsAnnotation(it, p.x, p.y, 0.02));
    if (before !== itemsRef.current.length) bump();
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    if (tool === "zoom") {
      const p = rawPoint(e);
      zoomDragRef.current = p;
      setZoomDrag({ x: p.x, y: p.y, x2: p.x, y2: p.y });
      return;
    }
    const p = pointFrom(e);
    if (tool === "eraser") {
      eraseAt(p);
      return;
    }
    const container = containerRef.current;
    const h = container?.getBoundingClientRect().height ?? 720;
    const item: Annotation = {
      id: Date.now() + Math.random(),
      type: tool,
      color,
      sizeN: size / Math.max(1, h),
      fill: fillShapes,
      points: [p, p],
    };
    if (tool === "pen") item.points = [p];
    draftRef.current = item;
    itemsRef.current = [...itemsRef.current, item];
    bump();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || e.buttons === 0) return;
    if (tool === "zoom") {
      if (!zoomDragRef.current) return;
      const p = rawPoint(e);
      setZoomDrag({ ...zoomDragRef.current, x2: p.x, y2: p.y });
      return;
    }
    const p = pointFrom(e);
    if (tool === "eraser") {
      eraseAt(p);
      return;
    }
    const item = draftRef.current;
    if (!item) return;
    if (item.type === "pen") item.points.push(p);
    else item.points[1] = p;
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (tool === "zoom" && zoomDragRef.current) {
      const start = zoomDragRef.current;
      const end = rawPoint(e);
      zoomDragRef.current = null;
      setZoomDrag(null);
      const w = Math.abs(end.x - start.x);
      const h = Math.abs(end.y - start.y);
      if (w > 0.04 && h > 0.04) {
        const k = Math.min(6, Math.max(1.1, Math.min(1 / w, 1 / h)));
        zoomTo((start.x + end.x) / 2, (start.y + end.y) / 2, k);
      } else if (getZoom().k > 1.02) {
        resetZoom();
      } else {
        zoomTo(start.x, start.y, zoomLevel);
      }
      return;
    }
    draftRef.current = null;
    bump();
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className="absolute inset-0 z-40 h-full w-full"
      style={{
        pointerEvents: active ? "auto" : "none",
        touchAction: active ? "none" : undefined,
        cursor: !active
          ? undefined
          : tool === "eraser"
            ? "cell"
            : tool === "zoom"
              ? "zoom-in"
              : "crosshair",
      }}
    />
  );
}

/* ─────────────────────── atalhos de teclado ─────────────────────── */

export function useAnnotationShortcuts(controller: DrawingController, enabled = true) {
  const { setTool, setActive, resetZoom } = controller;
  useEffect(() => {
    if (!enabled) return;
    const map: Record<string, AnnotationTool> = {
      p: "pen",
      a: "arrow",
      r: "rect",
      c: "ellipse",
      h: "highlight",
      z: "zoom",
      e: "eraser",
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const el = ev.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const k = ev.key.toLowerCase();
      if (k === "escape") {
        setActive(false);
        return;
      }
      if (k === "0") {
        resetZoom();
        return;
      }
      const tool = map[k];
      if (!tool) return;
      ev.preventDefault();
      setTool(tool);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, setTool, setActive, resetZoom]);
}

/* ─────────────────────── toolbar (uso na página) ─────────────────── */

export function DrawingToolbar({ controller }: { controller: DrawingController }) {
  const {
    active,
    setActive,
    tool,
    setTool,
    color,
    setColor,
    size,
    setSize,
    fillShapes,
    setFillShapes,
    zoomLevel,
    setZoomLevel,
    zoomActive,
    resetZoom,
    clear,
    itemsRef,
    version,
  } = controller;
  const count = useMemo(() => itemsRef.current.length, [itemsRef, version]);
  if (!active) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand)]">
        <Pen className="h-3.5 w-3.5" /> Anotar
      </span>
      <div className="flex items-center gap-1">
        {ANNOTATION_TOOLS.map(({ id, label, key, Icon }) => (
          <button
            key={id}
            type="button"
            title={`${label} (${key})`}
            aria-label={label}
            onClick={() => setTool(id)}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
              tool === id
                ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                : "border-[var(--border)] text-[var(--foreground)] hover:bg-white/5",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        {PEN_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={`Cor ${c}`}
            aria-label={`Cor ${c}`}
            onClick={() => setColor(c)}
            className={cn(
              "h-5 w-5 rounded-full border transition-transform",
              color === c ? "scale-110 border-white" : "border-white/20",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          title="Cor personalizada"
          className="h-5 w-6 cursor-pointer rounded border border-white/20 bg-transparent p-0"
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
        Espessura
        <input
          type="range"
          min={2}
          max={24}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--brand)]"
        />
        <span className="w-6 text-[var(--foreground)]">{size}</span>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
        <input
          type="checkbox"
          checked={fillShapes}
          onChange={(e) => setFillShapes(e.target.checked)}
          className="accent-[var(--brand)]"
        />
        Preencher formas
      </label>
      <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
        Zoom {zoomLevel.toFixed(1)}x
        <input
          type="range"
          min={1.2}
          max={4}
          step={0.1}
          value={zoomLevel}
          onChange={(e) => setZoomLevel(Number(e.target.value))}
          className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--brand)]"
        />
      </label>
      {zoomActive && (
        <button
          type="button"
          onClick={resetZoom}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--brand)] px-2.5 text-xs font-semibold text-[var(--brand)]"
        >
          Resetar zoom
        </button>
      )}
      <button
        type="button"
        onClick={clear}
        disabled={count === 0}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-white/5 disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" /> Limpar tudo
      </button>
      <button
        type="button"
        onClick={() => setActive(false)}
        className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-white/5"
      >
        <X className="h-3.5 w-3.5" /> Sair
      </button>
    </div>
  );
}
