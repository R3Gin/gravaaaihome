// Camada de desenho livre (caneta) sobreposta ao preview de captura.
// Os traços são guardados em coordenadas do container e redesenhados no
// <canvas> de composição — por isso aparecem na gravação final.

import { useCallback, useRef, useState, type RefObject } from "react";
import { Eraser, Pen, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Stroke {
  color: string;
  size: number;
  points: { x: number; y: number }[];
}

export const PEN_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ffffff"];

export function useDrawing() {
  const [active, setActive] = useState(false);
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [size, setSize] = useState(6);
  const [eraser, setEraser] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const strokesRef = useRef<Stroke[]>([]);

  const clear = useCallback(() => {
    strokesRef.current = [];
    setStrokeCount(0);
  }, []);

  return {
    active,
    setActive,
    color,
    setColor,
    size,
    setSize,
    eraser,
    setEraser,
    strokesRef,
    strokeCount,
    setStrokeCount,
    clear,
  };
}

export type DrawingController = ReturnType<typeof useDrawing>;

export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  sx: number,
  sy: number,
) {
  const scale = Math.min(sx, sy);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size * scale;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x * sx, stroke.points[0].y * sy);
    for (const p of stroke.points.slice(1)) ctx.lineTo(p.x * sx, p.y * sy);
    if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x * sx + 0.1, stroke.points[0].y * sy);
    ctx.stroke();
  }
  ctx.restore();
}

function hitsStroke(stroke: Stroke, x: number, y: number, radius: number) {
  return stroke.points.some((p) => Math.hypot(p.x - x, p.y - y) <= radius + stroke.size);
}

/** Canvas transparente por cima do preview: captura o desenho do usuário. */
export function DrawingCanvas({
  controller,
  containerRef,
}: {
  controller: DrawingController;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<Stroke | null>(null);
  const { active, strokesRef, color, size, eraser, setStrokeCount } = controller;

  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    if (canvas.width !== Math.round(rect.width) || canvas.height !== Math.round(rect.height)) {
      canvas.width = Math.round(rect.width);
      canvas.height = Math.round(rect.height);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawStrokes(ctx, strokesRef.current, 1, 1);
  }, [containerRef, strokesRef]);

  const pointFrom = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointFrom(e);
    if (eraser) {
      strokesRef.current = strokesRef.current.filter((s) => !hitsStroke(s, p.x, p.y, 12));
      setStrokeCount(strokesRef.current.length);
      repaint();
      return;
    }
    const stroke: Stroke = { color, size, points: [p] };
    drawingRef.current = stroke;
    strokesRef.current = [...strokesRef.current, stroke];
    setStrokeCount(strokesRef.current.length);
    repaint();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || e.buttons === 0) return;
    const p = pointFrom(e);
    if (eraser) {
      const before = strokesRef.current.length;
      strokesRef.current = strokesRef.current.filter((s) => !hitsStroke(s, p.x, p.y, 12));
      if (before !== strokesRef.current.length) setStrokeCount(strokesRef.current.length);
      repaint();
      return;
    }
    const stroke = drawingRef.current;
    if (!stroke) return;
    stroke.points.push(p);
    repaint();
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  // Mantém o canvas redesenhado quando a lista muda (limpar, borracha, resize).
  useEffect(() => {
    repaint();
    window.addEventListener("resize", repaint);
    return () => window.removeEventListener("resize", repaint);
  }, [repaint, strokesRef.current.length, controller.strokeCount, active]);


  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className={cn(
        "absolute inset-0 z-20 h-full w-full",
        active ? "touch-none" : "pointer-events-none",
      )}
      style={
        active
          ? {
              cursor: eraser
                ? "cell"
                : "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round'><path d='M12 19l7-7-4-4-7 7-1 5z'/></svg>\") 2 22, crosshair",
            }
          : undefined
      }
    />
  );
}

/** Barra de controles da caneta (cores, espessura, borracha, limpar). */
export function DrawingToolbar({ controller }: { controller: DrawingController }) {
  const { active, setActive, color, setColor, size, setSize, eraser, setEraser, clear, strokeCount } =
    controller;
  if (!active) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand)]">
        <Pen className="h-3.5 w-3.5" /> Modo desenho
      </span>
      <div className="flex items-center gap-1.5">
        {PEN_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={`Cor ${c}`}
            aria-label={`Cor ${c}`}
            onClick={() => {
              setColor(c);
              setEraser(false);
            }}
            className={cn(
              "h-5 w-5 rounded-full border transition-transform",
              color === c && !eraser ? "scale-110 border-white" : "border-white/20",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => {
            setColor(e.target.value);
            setEraser(false);
          }}
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
      <button
        type="button"
        onClick={() => setEraser(!eraser)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
          eraser
            ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
            : "border-[var(--border)] text-[var(--foreground)] hover:bg-white/5",
        )}
      >
        <Eraser className="h-3.5 w-3.5" /> Borracha
      </button>
      <button
        type="button"
        onClick={clear}
        disabled={strokeCount === 0}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--foreground)] transition-colors hover:bg-white/5 disabled:opacity-40"
      >
        <Trash2 className="h-3.5 w-3.5" /> Limpar tudo
      </button>
      <button
        type="button"
        onClick={() => setActive(false)}
        className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-xs font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-white/5"
      >
        <X className="h-3.5 w-3.5" /> Sair do desenho
      </button>
    </div>
  );
}
