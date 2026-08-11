import { useMemo, useRef, useState } from "react";
import { Copy, Scissors, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { MIN_CLIP, useEditor, type Clip, type Track } from "@/state/editor-store";
import { cn } from "@/lib/utils";

const LABEL_W = 96;
const LANE_H = 56;

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

type Ghost = { start: number; duration: number } | null;

function ClipBox({ clip, track }: { clip: Clip; track: Track }) {
  const zoom = useEditor((s) => s.zoom);
  const tool = useEditor((s) => s.tool);
  const selected = useEditor((s) => s.selectedClipId === clip.id);
  const select = useEditor((s) => s.select);
  const splitAt = useEditor((s) => s.splitAt);
  const trimClip = useEditor((s) => s.trimClip);
  const moveClip = useEditor((s) => s.moveClip);

  const [ghost, setGhost] = useState<Ghost>(null);
  const [dragging, setDragging] = useState(false);
  const clipRef = useRef(clip);
  clipRef.current = clip;

  const timeAt = (clientX: number) => {
    const lane = document.getElementById("tl-scroll");
    if (!lane) return 0;
    const box = lane.getBoundingClientRect();
    return Math.max(0, (clientX - box.left + lane.scrollLeft) / zoom);
  };

  const startTrim = (side: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    select(clip.id);
    setDragging(true);
    let last = side === "start" ? clip.startTime : clip.startTime + clip.duration;
    const move = (ev: PointerEvent) => {
      const c = clipRef.current;
      const t = timeAt(ev.clientX);
      last = t;
      if (side === "start") {
        const start = Math.min(t, c.startTime + c.duration - MIN_CLIP);
        setGhost({ start: Math.max(0, start), duration: c.startTime + c.duration - Math.max(0, start) });
      } else {
        setGhost({ start: c.startTime, duration: Math.max(MIN_CLIP, t - c.startTime) });
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGhost(null);
      setDragging(false);
      trimClip(clipRef.current.id, side, Math.max(0, last));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (tool === "blade") {
      e.stopPropagation();
      splitAt(clip.id, timeAt(e.clientX));
      return;
    }
    e.stopPropagation();
    select(clip.id);

    const grabOffset = timeAt(e.clientX) - clip.startTime;
    let moved = false;
    let last = clip.startTime;
    const move = (ev: PointerEvent) => {
      moved = true;
      setDragging(true);
      const start = Math.max(0, timeAt(ev.clientX) - grabOffset);
      last = start;
      setGhost({ start, duration: clipRef.current.duration });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGhost(null);
      setDragging(false);
      if (moved) moveClip(clipRef.current.id, last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const color =
    track.type === "video"
      ? "from-[var(--brand)]/50 to-[var(--brand)]/20 border-[var(--brand)]/50"
      : track.type === "text"
        ? "from-sky-500/40 to-sky-500/15 border-sky-400/50"
        : track.type === "overlay"
          ? "from-amber-500/40 to-amber-500/15 border-amber-400/50"
          : "from-emerald-500/40 to-emerald-500/15 border-emerald-400/50";

  const start = ghost?.start ?? clip.startTime;
  const dur = ghost?.duration ?? clip.duration;

  return (
    <div
      data-clip-id={clip.id}
      onPointerDown={onPointerDown}
      className={cn(
        "absolute top-1 flex h-[calc(100%-8px)] touch-none select-none items-center overflow-hidden rounded-md border bg-gradient-to-b px-2 text-[11px] font-semibold text-white",
        color,
        tool === "blade" ? "cursor-crosshair" : dragging ? "cursor-grabbing" : "cursor-grab",
        selected && "ring-2 ring-[var(--brand)] ring-offset-1 ring-offset-[var(--surface-2)]",
        dragging && "opacity-80",
      )}
      style={{
        left: start * zoom + 1,
        width: Math.max(6, dur * zoom - 2),
        zIndex: dragging ? 20 : selected ? 10 : 1,
      }}
    >
      <span className="pointer-events-none truncate">
        {clip.type === "text" ? clip.textContent : clip.overlayKind ?? track.label}
      </span>
      {selected && tool !== "blade" ? (
        <>
          <span
            onPointerDown={startTrim("start")}
            className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize bg-white/70"
          />
          <span
            onPointerDown={startTrim("end")}
            className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize bg-white/70"
          />
        </>
      ) : null}
    </div>
  );
}


export function Timeline() {
  const tracks = useEditor((s) => s.tracks);
  const zoom = useEditor((s) => s.zoom);
  const duration = useEditor((s) => s.duration);
  const currentTime = useEditor((s) => s.currentTime);
  const tool = useEditor((s) => s.tool);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const setZoom = useEditor((s) => s.setZoom);
  const setCurrentTime = useEditor((s) => s.setCurrentTime);
  const setTool = useEditor((s) => s.setTool);
  const select = useEditor((s) => s.select);
  const removeClip = useEditor((s) => s.removeClip);
  const duplicateClip = useEditor((s) => s.duplicateClip);
  const splitPlayhead = useEditor((s) => s.splitPlayhead);

  const scrollRef = useRef<HTMLDivElement>(null);
  const width = Math.max(600, (duration + 4) * zoom);

  const ticks = useMemo(() => {
    const step = zoom > 120 ? 1 : zoom > 50 ? 2 : zoom > 25 ? 5 : 10;
    const out: number[] = [];
    for (let t = 0; t <= duration + 4; t += step) out.push(t);
    return out;
  }, [duration, zoom]);


  const seekFromEvent = (e: React.PointerEvent) => {
    const lane = scrollRef.current;
    if (!lane) return;
    const box = lane.getBoundingClientRect();
    setCurrentTime(Math.max(0, (e.clientX - box.left + lane.scrollLeft) / zoom));
  };

  return (
    <div className="flex h-[280px] shrink-0 flex-col border-t border-[var(--border)] bg-[var(--surface-2)]">
      {/* barra de ações */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3">
        <button
          onClick={() => setTool(tool === "blade" ? "select" : "blade")}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold",
            tool === "blade"
              ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
              : "border-[var(--border)] text-[var(--muted-foreground)]",
          )}
          title="Dividir: ative e clique no clipe"
        >
          <Scissors className="h-4 w-4" /> Dividir
        </button>
        <button
          onClick={splitPlayhead}
          className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--muted-foreground)]"
        >
          Dividir no playhead
        </button>
        <button
          disabled={!selectedClipId}
          onClick={() => selectedClipId && duplicateClip(selectedClipId)}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] disabled:opacity-40"
        >
          <Copy className="h-4 w-4" /> Duplicar
        </button>
        <button
          disabled={!selectedClipId}
          onClick={() => selectedClipId && removeClip(selectedClipId)}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" /> Deletar
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setZoom(zoom / 1.4)} className="rounded-md border border-[var(--border)] p-1.5">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-14 text-center text-[11px] tabular-nums text-[var(--muted-foreground)]">
            {Math.round(zoom)} px/s
          </span>
          <button onClick={() => setZoom(zoom * 1.4)} className="rounded-md border border-[var(--border)] p-1.5">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* rótulos das faixas */}
        <div className="shrink-0 border-r border-[var(--border)]" style={{ width: LABEL_W }}>
          <div className="h-7 border-b border-[var(--border)]" />
          <div className="overflow-hidden">
            {tracks.map((t) => (
              <div
                key={t.id}
                className="flex items-center border-b border-[var(--border)] px-3 text-[11px] font-semibold text-[var(--muted-foreground)]"
                style={{ height: LANE_H }}
              >
                {t.label}
              </div>
            ))}
          </div>
        </div>

        <div id="tl-scroll" ref={scrollRef} className="relative min-w-0 flex-1 overflow-auto">
          <div style={{ width }} className="relative">
            {/* régua */}
            <div
              onPointerDown={seekFromEvent}
              className="sticky top-0 z-30 h-7 cursor-pointer border-b border-[var(--border)] bg-[var(--surface-2)]"
            >
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute top-1 text-[10px] tabular-nums text-[var(--muted-foreground)]"
                  style={{ left: t * zoom + 3 }}
                >
                  {fmt(t)}
                </span>
              ))}
            </div>

            <DndContext sensors={sensors} onDragEnd={onDragEnd}>
              <div onPointerDown={(e) => e.target === e.currentTarget && select(null)}>
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    onPointerDown={(e) => e.target === e.currentTarget && select(null)}
                    className="relative border-b border-[var(--border)]"
                    style={{ height: LANE_H }}
                  >
                    {track.clips.map((clip) => (
                      <ClipBox key={clip.id} clip={clip} track={track} />
                    ))}
                  </div>
                ))}
              </div>
            </DndContext>

            {/* playhead */}
            <div
              className="pointer-events-none absolute top-0 z-40 w-px bg-[var(--brand)]"
              style={{ left: currentTime * zoom, height: 28 + tracks.length * LANE_H }}
            >
              <span className="absolute -left-1.5 -top-0.5 h-2 w-3 rounded-sm bg-[var(--brand)]" />
            </div>
          </div>
        </div>
      </div>
      <span className="hidden">{MIN_CLIP}</span>
    </div>
  );
}
