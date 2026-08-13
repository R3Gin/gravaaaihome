import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Copy, GripVertical, Scissors, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { MIN_CLIP, findClip, useEditor, type Clip, type Track } from "@/state/editor-store";
import {
  EASINGS,
  animatedProps,
  modifiedProps,
  type AnimProp,
  type Easing,
} from "@/lib/keyframes";
import { KeyframeSpeedModal } from "@/components/editor/KeyframeSpeedModal";
import { getPeaks, type Peaks } from "@/lib/waveform";
import { cn } from "@/lib/utils";

const ANNOTATION_LABEL: Record<string, string> = {
  pen: "caneta",
  arrow: "seta",
  rect: "retângulo",
  ellipse: "círculo",
  highlight: "destaque",
};


const LABEL_W = 96;
const LANE_H = 56;
const KF_H = 22;

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

type Ghost = { start: number; duration: number } | null;
type KfMenu = { x: number; y: number; prop: string; kfId: string } | null;
type KfSpeed = { prop: string; kfId: string } | null;


/** Sub-linha com os keyframes de uma propriedade do clipe selecionado. */
function KeyframeLane({
  clip,
  prop,
  onMenu,
  onSpeed,
}: {
  clip: Clip;
  prop: AnimProp;
  onMenu: (menu: KfMenu) => void;
  onSpeed: (target: KfSpeed) => void;
}) {
  const zoom = useEditor((s) => s.zoom);
  const selected = useEditor((s) => s.selectedKeyframes);
  const selectKeyframe = useEditor((s) => s.selectKeyframe);
  const moveKeyframes = useEditor((s) => s.moveKeyframes);
  const setKeyframeSpeed = useEditor((s) => s.setKeyframeSpeed);
  const keys = clip.keyframes?.[prop.key] ?? [];

  /** Alt/Option + arrastar: ajusta visualmente as tangentes do keyframe. */
  const startTangentDrag = (kfId: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    selectKeyframe(prop.key, kfId);
    const kf = keys.find((k) => k.id === kfId);
    const baseIn = kf?.incomingSpeed ?? { x: 0, y: 0, influence: 33.33 };
    const baseOut = kf?.outgoingSpeed ?? { x: 0, y: 0, influence: 33.33 };
    const x0 = e.clientX;
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / 3; // influência
      const dy = -(ev.clientY - y0) / 40; // velocidade
      const side = ev.clientX < x0 ? "in" : "out";
      const influence = Math.min(100, Math.max(1, (side === "in" ? baseIn : baseOut).influence + Math.abs(dx)));
      setKeyframeSpeed(
        clip.id,
        prop.key,
        kfId,
        side === "in"
          ? { incomingSpeed: { ...baseIn, influence, x: baseIn.x + dy, y: baseIn.y + dy } }
          : { outgoingSpeed: { ...baseOut, influence, x: baseOut.x + dy, y: baseOut.y + dy } },
        true,
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      useEditor.getState().commit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startDrag = (kfId: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (e.altKey) {
      startTangentDrag(kfId)(e);
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const already = useEditor.getState().selectedKeyframes.some((k) => k.kfId === kfId);
    if (!already || additive) selectKeyframe(prop.key, kfId, additive);

    const lane = document.getElementById("tl-scroll");
    const startTime = keys.find((k) => k.id === kfId)?.time ?? 0;
    const timeAt = (clientX: number) => {
      if (!lane) return 0;
      const box = lane.getBoundingClientRect();
      return Math.max(0, (clientX - box.left + lane.scrollLeft) / zoom) - clip.startTime;
    };
    const grab = timeAt(e.clientX) - startTime;
    const group = useEditor.getState().selectedKeyframes;
    const batch =
      group.length > 1 && group.some((k) => k.kfId === kfId)
        ? group
        : [{ prop: prop.key, kfId }];
    const origins = batch.map((sel) => {
      const list = clip.keyframes?.[sel.prop] ?? [];
      return { ...sel, time: list.find((k) => k.id === sel.kfId)?.time ?? 0 };
    });
    let delta = 0;
    let moved = false;

    const move = (ev: PointerEvent) => {
      moved = true;
      delta = timeAt(ev.clientX) - grab - startTime;
      moveKeyframes(
        clip.id,
        origins.map((o) => ({ prop: o.prop, kfId: o.kfId, time: o.time + delta })),
        true,
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved)
        moveKeyframes(
          clip.id,
          origins.map((o) => ({ prop: o.prop, kfId: o.kfId, time: o.time + delta })),
        );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const laneRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<{ x1: number; x2: number } | null>(null);

  /** arrastar no vazio da trilha: caixa de seleção (marquee) */
  const startMarquee = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = laneRef.current;
    if (!el) return;
    e.stopPropagation();
    const box = el.getBoundingClientRect();
    const x0 = e.clientX - box.left;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!additive) useEditor.getState().clearKeyframeSelection();
    let x1 = x0;
    let dragged = false;
    setMarquee({ x1: x0, x2: x0 });

    const move = (ev: PointerEvent) => {
      x1 = ev.clientX - box.left;
      if (Math.abs(x1 - x0) > 3) dragged = true;
      setMarquee({ x1: Math.min(x0, x1), x2: Math.max(x0, x1) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      if (!dragged) return;
      const from = Math.min(x0, x1);
      const to = Math.max(x0, x1);
      const hits = keys
        .filter((k) => {
          const x = (clip.startTime + k.time) * zoom;
          return x >= from && x <= to;
        })
        .map((k) => ({ prop: prop.key, kfId: k.id }));
      useEditor.getState().selectKeyframes(hits, additive);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={laneRef}
      onPointerDown={startMarquee}
      className="relative border-b border-[var(--border)]/60 bg-[var(--surface-2)]"
      style={{ height: KF_H }}
    >
      <span
        className="absolute inset-y-0 left-0 border-l-2 border-[var(--brand)]/30"
        style={{ left: clip.startTime * zoom, width: Math.max(4, clip.duration * zoom) }}
      />
      {/* linhas conectando keyframes consecutivos */}
      {keys.slice(0, -1).map((k, i) => {
        const next = keys[i + 1];
        const x1 = (clip.startTime + k.time) * zoom;
        const x2 = (clip.startTime + next.time) * zoom;
        const bothSel =
          selected.some((s) => s.kfId === k.id) && selected.some((s) => s.kfId === next.id);
        return (
          <span
            key={`ln-${k.id}`}
            className={cn(
              "pointer-events-none absolute top-1/2 -translate-y-1/2",
              bothSel ? "h-[3px] rounded-full bg-amber-300" : "h-px bg-[var(--brand)]/60",
            )}
            style={{ left: x1, width: Math.max(0, x2 - x1) }}
          />
        );
      })}
      {marquee ? (
        <span
          className="pointer-events-none absolute inset-y-1 border border-amber-300/70 bg-amber-300/15"
          style={{ left: marquee.x1, width: Math.max(1, marquee.x2 - marquee.x1) }}
        />
      ) : null}
      {keys.map((k) => {
        const isSel = selected.some((s) => s.kfId === k.id);
        return (
          <span
            key={k.id}
            data-kf-id={k.id}
            title={`${prop.label} · ${k.time.toFixed(2)}s · ${k.easing}\nClique: selecionar · Shift/Ctrl+clique: somar à seleção · Duplo clique: velocidade · Alt+arrastar: tangentes`}
            onPointerDown={startDrag(k.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onSpeed({ prop: prop.key, kfId: k.id });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              onMenu({ x: e.clientX, y: e.clientY, prop: prop.key, kfId: k.id });
            }}
            className={cn(
              "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize border",
              isSel
                ? "z-10 h-3.5 w-3.5 border-2 border-amber-300 bg-white shadow-[0_0_0_2px_rgba(253,224,71,0.45)]"
                : "h-2.5 w-2.5 border-[var(--brand)] bg-[var(--brand)]",
              k.easing === "hold" && "rounded-none",
              k.easing === "custom" && !isSel && "ring-1 ring-sky-300",
            )}
            style={{ left: (clip.startTime + k.time) * zoom }}
          />
        );
      })}
    </div>
  );
}



/** Waveform do áudio do vídeo, desenhada na faixa "Áudio". */
function AudioWaveform({
  width,
  viewLeft,
  viewWidth,
}: {
  width: number;
  viewLeft: number;
  viewWidth: number;
}) {

  const sourceBlob = useEditor((s) => s.sourceBlob);
  const zoom = useEditor((s) => s.zoom);
  const tracks = useEditor((s) => s.tracks);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const videoClips = useMemo(
    () => tracks.find((t) => t.type === "video")?.clips ?? [],
    [tracks],
  );

  useEffect(() => {
    if (!sourceBlob) {
      setPeaks(null);
      return;
    }
    let alive = true;
    setLoading(true);
    void getPeaks(sourceBlob).then((p) => {
      if (!alive) return;
      setPeaks(p);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [sourceBlob]);

  /* Só a janela visível vai para o canvas: em vídeos longos a largura total
     estoura o limite de pixels do navegador e come memória à toa. */
  const winLeft = Math.max(0, Math.min(viewLeft, Math.max(0, width - 1)));
  const winWidth = Math.max(1, Math.min(viewWidth || 1200, width - winLeft));

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const dpr = window.devicePixelRatio || 1;
    const h = LANE_H - 10;
    canvas.width = Math.max(1, Math.floor(winWidth * dpr));
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${winWidth}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, winWidth, h);
    ctx.fillStyle = "rgba(16,185,129,0.75)";

    const mid = h / 2;
    for (const clip of videoClips) {
      const x0 = clip.startTime * zoom - winLeft;
      const w = clip.duration * zoom;
      if (w < 1 || x0 + w < 0 || x0 > winWidth) continue;
      const cols = Math.max(1, Math.floor(w));
      for (let i = 0; i < cols; i++) {
        const x = x0 + i;
        if (x < 0 || x > winWidth) continue;
        const t = clip.sourceInStart + ((i / cols) * (clip.sourceInEnd - clip.sourceInStart));
        const idx = Math.min(peaks.data.length - 1, Math.max(0, Math.round((t / peaks.duration) * peaks.data.length)));
        const amp = (peaks.data[idx] ?? 0) * (mid - 2);
        ctx.fillRect(x, mid - amp, 1, Math.max(1, amp * 2));
      }
    }
  }, [peaks, videoClips, winLeft, winWidth, zoom]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => draw());
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, [draw]);

  if (!sourceBlob) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[5px]">
      {loading ? (
        <span className="absolute left-2 top-2 text-[10px] text-[var(--muted-foreground)]">
          Analisando áudio…
        </span>
      ) : null}
      <canvas ref={canvasRef} className="block absolute" style={{ left: winLeft }} />
    </div>
  );
}



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

  /** imantação: aproxima o tempo das bordas vizinhas, agulha e início/fim */
  const snap = (start: number, dur: number | null) => {
    const s = useEditor.getState();
    if (!s.snapEnabled || (e2eDisableSnapRef.current ?? false)) return { start, guide: null };
    const targets = snapTargets(s.tracks, {
      excludeClipId: clipRef.current.id,
      playhead: s.currentTime,
      duration: s.duration,
    });
    const tol = snapTolerance(s.zoom);
    const a = applySnap(start, targets, tol);
    if (a.guide != null) return { start: a.time, guide: a.guide };
    if (dur != null) {
      const b = applySnap(start + dur, targets, tol);
      if (b.guide != null) return { start: b.time - dur, guide: b.guide };
    }
    return { start, guide: null };
  };

  const e2eDisableSnapRef = useRef(false);

  const startTrim = (side: "start" | "end") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    select(clip.id);
    setDragging(true);
    let last = side === "start" ? clip.startTime : clip.startTime + clip.duration;
    const move = (ev: PointerEvent) => {
      const c = clipRef.current;
      e2eDisableSnapRef.current = ev.altKey;
      const snapped = snap(timeAt(ev.clientX), null);
      useEditor.getState().setSnapGuide(snapped.guide);
      const t = snapped.start;
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
      useEditor.getState().setSnapGuide(null);
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
      e2eDisableSnapRef.current = ev.altKey;
      const raw = Math.max(0, timeAt(ev.clientX) - grabOffset);
      const snapped = snap(raw, clipRef.current.duration);
      useEditor.getState().setSnapGuide(snapped.guide);
      const start = Math.max(0, snapped.start);
      last = start;
      setGhost({ start, duration: clipRef.current.duration });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGhost(null);
      setDragging(false);
      useEditor.getState().setSnapGuide(null);
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
        {clip.type === "text"
          ? clip.textContent
          : clip.overlayKind === "annotation"
            ? ANNOTATION_LABEL[clip.annotation?.type ?? "pen"]
            : (clip.overlayKind ?? track.label)}
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
  const silences = useEditor((s) => s.silences);
  const sourceUrl = useEditor((s) => s.sourceUrl);

  const scrollRef = useRef<HTMLDivElement>(null);
  const width = Math.max(600, (duration + 4) * zoom);

  /* --- virtualização: só renderiza o que está na janela visível --- */
  const [view, setView] = useState({ left: 0, width: 1200 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      setView((v) =>
        v.left === el.scrollLeft && v.width === el.clientWidth
          ? v
          : { left: el.scrollLeft, width: el.clientWidth },
      );
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const visible = useMemo(() => {
    const margin = 600; // px de folga fora da tela
    return {
      from: Math.max(0, (view.left - margin) / zoom),
      to: (view.left + view.width + margin) / zoom,
    };
  }, [view, zoom]);

  const ticks = useMemo(() => {
    const step = zoom > 120 ? 1 : zoom > 50 ? 2 : zoom > 25 ? 5 : 10;
    const out: number[] = [];
    const first = Math.floor(visible.from / step) * step;
    for (let t = Math.max(0, first); t <= Math.min(duration + 4, visible.to); t += step) out.push(t);
    return out;
  }, [duration, zoom, visible]);



  const [scrubbing, setScrubbing] = useState(false);

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const lane = scrollRef.current;
      if (!lane) return 0;
      const box = lane.getBoundingClientRect();
      return Math.max(0, (clientX - box.left + lane.scrollLeft) / zoom);
    },
    [zoom],
  );

  /* arrasto da agulha: listeners no document para funcionar fora do elemento */
  const startScrub = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      setScrubbing(true);
      setCurrentTime(timeFromClientX(e.clientX));
    },
    [setCurrentTime, timeFromClientX],
  );

  useEffect(() => {
    if (!scrubbing) return;
    const move = (ev: PointerEvent) => setCurrentTime(timeFromClientX(ev.clientX));
    const up = () => setScrubbing(false);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
  }, [scrubbing, setCurrentTime, timeFromClientX]);

  /* --- sub-linhas de keyframes (atalho U / UU) --- */
  const kfExpanded = useEditor((s) => s.kfExpanded);
  const setKeyframeEasing = useEditor((s) => s.setKeyframeEasing);
  const removeKeyframe = useEditor((s) => s.removeKeyframe);
  const cycleKeyframeRows = useEditor((s) => s.cycleKeyframeRows);
  const [menu, setMenu] = useState<KfMenu>(null);
  const [speedTarget, setSpeedTarget] = useState<KfSpeed>(null);


  const selectedClip = findClip(tracks, selectedClipId);
  const kfRows: AnimProp[] = useMemo(() => {
    if (!selectedClip || kfExpanded === "none") return [];
    return kfExpanded === "all" ? modifiedProps(selectedClip) : animatedProps(selectedClip);
  }, [kfExpanded, selectedClip]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  const lanesHeight = tracks.length * LANE_H + kfRows.length * KF_H;

  /* --- reordenar faixas (arraste vertical nos rótulos) --- */
  const reorderTracks = useEditor((s) => s.reorderTracks);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [dragTrack, setDragTrack] = useState<{ id: string; index: number; overIndex: number } | null>(
    null,
  );

  const rowHeights = useMemo(
    () =>
      tracks.map(
        (t) => LANE_H + (selectedClip?.trackId === t.id ? kfRows.length * KF_H : 0),
      ),
    [tracks, selectedClip, kfRows.length],
  );

  const indexFromY = useCallback(
    (clientY: number) => {
      const box = labelsRef.current?.getBoundingClientRect();
      if (!box) return 0;
      let y = clientY - box.top;
      for (let i = 0; i < rowHeights.length; i++) {
        const h = rowHeights[i] ?? LANE_H;
        if (y < h / 2) return i;
        if (y < h) return i;
        y -= h;
      }
      return rowHeights.length - 1;
    },
    [rowHeights],
  );

  const startTrackDrag = (index: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const track = tracks[index];
    if (!track) return;
    let over = index;
    setDragTrack({ id: track.id, index, overIndex: index });
    const move = (ev: PointerEvent) => {
      over = indexFromY(ev.clientY);
      setDragTrack((d) => (d ? { ...d, overIndex: over } : d));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragTrack(null);
      if (over !== index) reorderTracks(index, over);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
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
          disabled={!sourceUrl}
          onClick={() => window.dispatchEvent(new CustomEvent("editor:open-panel", { detail: "silence" }))}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--muted-foreground)] disabled:opacity-40"
        >
          <AudioLines className="h-4 w-4" /> Detectar silêncios
        </button>
        <button
          onClick={splitPlayhead}
          title="Dividir no playhead (atalho: S)"
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--muted-foreground)]"
        >
          Dividir no playhead
          <kbd className="rounded border border-[var(--border)] px-1 text-[10px] font-bold text-[var(--foreground)]">S</kbd>
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
        {/* rótulos das faixas (arraste vertical para reordenar) */}
        <div className="shrink-0 border-r border-[var(--border)]" style={{ width: LABEL_W }}>
          <div className="h-7 border-b border-[var(--border)]" />
          <div ref={labelsRef} className="overflow-hidden">
            {tracks.map((t, i) => (
              <div key={t.id}>
                <div
                  onPointerDown={startTrackDrag(i)}
                  title="Arraste para cima ou para baixo para reordenar"
                  className={cn(
                    "group flex cursor-grab select-none items-center gap-1.5 border-b border-[var(--border)] px-2 text-[11px] font-semibold text-[var(--muted-foreground)] transition-colors",
                    dragTrack?.id === t.id && "cursor-grabbing bg-[var(--brand)]/20 text-[var(--foreground)]",
                    dragTrack && dragTrack.id !== t.id && dragTrack.overIndex === i && "bg-[var(--brand)]/10",
                  )}
                  style={{ height: LANE_H }}
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 opacity-40 group-hover:opacity-90" />
                  <span className="truncate">{t.label}</span>
                </div>
                {selectedClip?.trackId === t.id
                  ? kfRows.map((p) => (
                      <div
                        key={p.key}
                        title={p.label}
                        className="flex items-center gap-1 border-b border-[var(--border)]/60 pl-5 pr-2 text-[10px] text-[var(--brand)]"
                        style={{ height: KF_H }}
                      >
                        <span className="h-1.5 w-1.5 rotate-45 bg-[var(--brand)]" />
                        <span className="truncate">{p.label}</span>
                      </div>
                    ))
                  : null}
              </div>
            ))}
          </div>
        </div>


        <div id="tl-scroll" ref={scrollRef} className="relative min-w-0 flex-1 overflow-auto">
          <div style={{ width }} className="relative">
            {/* régua */}
            <div
              onPointerDown={startScrub}
              className="sticky top-0 z-30 h-7 cursor-ew-resize border-b border-[var(--border)] bg-[var(--surface-2)]"
            >
              {ticks.map((t) => (
                <span
                  key={t}
                  className="pointer-events-none absolute top-1 text-[10px] tabular-nums text-[var(--muted-foreground)]"
                  style={{ left: t * zoom + 3 }}
                >
                  {fmt(t)}
                </span>
              ))}
            </div>

            {/* trechos silenciosos detectados */}
            {silences.length > 0 ? (
              <div
                className="pointer-events-none absolute left-0 z-20"
                style={{ top: 28, height: lanesHeight, width }}
              >
                {silences
                  .filter((s) => s.end >= visible.from && s.start <= visible.to)
                  .map((s, i) => (
                  <span
                    key={i}
                    className="absolute top-0 h-full border-x border-amber-300/50 bg-amber-300/20"
                    style={{ left: s.start * zoom, width: Math.max(2, (s.end - s.start) * zoom) }}
                  />
                ))}
              </div>
            ) : null}

            <div onPointerDown={(e) => e.target === e.currentTarget && select(null)}>
              {tracks.map((track) => (
                <div key={track.id}>
                  <div
                    onPointerDown={(e) => e.target === e.currentTarget && select(null)}
                    className="relative border-b border-[var(--border)]"
                    style={{ height: LANE_H }}
                  >
                    {track.type === "audio" ? (
                      <AudioWaveform width={width} viewLeft={view.left} viewWidth={view.width} />
                    ) : null}
                    {track.clips
                      .filter(
                        (clip) =>
                          clip.id === selectedClipId ||
                          (clip.startTime + clip.duration >= visible.from &&
                            clip.startTime <= visible.to),
                      )
                      .map((clip) => (
                        <ClipBox key={clip.id} clip={clip} track={track} />
                      ))}

                  </div>
                  {selectedClip?.trackId === track.id
                    ? kfRows.map((p) => (
                        <KeyframeLane
                          key={p.key}
                          clip={selectedClip}
                          prop={p}
                          onMenu={setMenu}
                          onSpeed={setSpeedTarget}
                        />

                      ))
                    : null}
                </div>
              ))}
            </div>


            {/* playhead — arrastável */}
            <div
              onPointerDown={startScrub}
              className="absolute top-0 z-40 w-px cursor-ew-resize bg-[var(--brand)]"
              style={{ left: currentTime * zoom, height: 28 + lanesHeight }}
            >
              <span className="absolute -left-2 -top-1 h-4 w-4 cursor-ew-resize rounded-sm bg-[var(--brand)]" />
              <span className="absolute -left-2 top-0 h-full w-4" />
            </div>
          </div>
        </div>
      </div>

      {/* menu do keyframe (duplo clique ou botão direito) */}
      {menu && selectedClip ? (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed z-50 w-52 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)] py-1 text-xs shadow-xl"
          style={{ left: menu.x, top: Math.max(8, menu.y - 180) }}
        >
          <span className="block px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
            Interpolação
          </span>
          {EASINGS.map((e) => (
            <button
              key={e.id}
              onClick={() => {
                setKeyframeEasing(selectedClip.id, menu.prop, menu.kfId, e.id as Easing);
                setMenu(null);
              }}
              className="block w-full px-3 py-1.5 text-left hover:bg-[var(--brand)]/15"
            >
              {e.label}
            </button>
          ))}
          <button
            onClick={() => {
              setSpeedTarget({ prop: menu.prop, kfId: menu.kfId });
              setMenu(null);
            }}
            className="mt-1 block w-full border-t border-[var(--border)] px-3 py-1.5 text-left hover:bg-[var(--brand)]/15"
          >
            Velocidade do quadro-chave…
          </button>
          <button
            onClick={() => {
              removeKeyframe(selectedClip.id, menu.prop, menu.kfId);
              setMenu(null);
            }}
            className="mt-1 block w-full border-t border-[var(--border)] px-3 py-1.5 text-left text-[var(--brand)] hover:bg-[var(--brand)]/15"
          >
            Deletar keyframe
          </button>
        </div>
      ) : null}

      {speedTarget && selectedClip ? (
        <KeyframeSpeedModal
          clipId={selectedClip.id}
          prop={speedTarget.prop}
          kfId={speedTarget.kfId}
          onClose={() => setSpeedTarget(null)}
        />
      ) : null}



      <button className="hidden" onClick={() => cycleKeyframeRows()}>
        {MIN_CLIP}
      </button>
    </div>

  );
}
