import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  GripVertical,
  Link2,
  Music,
  Sparkles,
  Type,
  Video,
  ZoomIn,
  ZoomOut,
  Play,
  Pause,
} from "lucide-react";

import { applySnap, freeStart, snapReleaseTolerance, snapTargets, snapTolerance } from "@/lib/snap";
import {
  MIN_CLIP,

  findClip,
  selectionGroup,
  useEditor,
  type Clip,
  type TimelineEffect,
  type Track,
} from "@/state/editor-store";


import {
  EASINGS,
  animatedProps,
  modifiedProps,
  type AnimProp,
  type Easing,
} from "@/lib/keyframes";
import { KeyframeSpeedModal } from "@/components/editor/KeyframeSpeedModal";
import { getPeaks, type Peaks } from "@/lib/waveform";
import { subscribeFilmstrip, type Filmstrip } from "@/lib/filmstrip";
import { cn } from "@/lib/utils";
import { SIDE_W } from "@/components/editor/layout";

const ANNOTATION_LABEL: Record<string, string> = {
  pen: "caneta",
  arrow: "seta",
  rect: "retângulo",
  ellipse: "círculo",
  highlight: "destaque",
};


const LABEL_W = SIDE_W;
const TL_MIN_H = 180;
const TL_DEFAULT_H = 280;
const TL_HEIGHT_KEY = "gravaai:timeline-height";
const LANE_H = 44;
const KF_H = 22;
const FX_H = 34;

/** barra de um efeito com janela própria (arrastar move, bordas esticam) */
const EffectBar = memo(function EffectBar({ fx, row = 0 }: { fx: TimelineEffect; row?: number }) {
  const zoom = useEditor((s) => s.zoom);
  const moveEffect = useEditor((s) => s.moveEffect);
  const resizeEffect = useEditor((s) => s.resizeEffect);
  const selectEffect = useEditor((s) => s.selectEffect);
  const removeEffect = useEditor((s) => s.removeEffectPreset);
  const selected = useEditor((s) => s.selectedEffectId) === fx.id;

  const drag = (mode: "move" | "start" | "end") => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    selectEffect(fx.id);
    const x0 = e.clientX;
    const { start, end } = fx;
    const move = (ev: PointerEvent) => {
      const d = (ev.clientX - x0) / zoom;
      if (mode === "move") moveEffect(fx.id, Math.max(0, start + d));
      else if (mode === "start") resizeEffect(fx.id, Math.max(0, start + d), end);
      else resizeEffect(fx.id, start, Math.max(start + 0.2, end + d));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      useEditor.getState().commit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const left = fx.start * zoom;
  const width = Math.max(18, (fx.end - fx.start) * zoom);

  return (
    <div
      data-no-marquee
      onPointerDown={drag("move")}
      title={`${fx.label} — arraste para mover, puxe as bordas para esticar`}
      className={cn(
        "absolute flex cursor-grab items-center gap-1 overflow-hidden rounded-md border px-2 text-[10px] font-semibold transition-colors",
        selected
          ? "border-[var(--brand)] bg-[var(--brand)]/30 text-[var(--foreground)]"
          : "border-amber-400/60 bg-amber-400/20 text-amber-100",
      )}
      style={{ left, width, height: FX_H - 8, top: row * FX_H + 4 }}
    >
      <span
        onPointerDown={drag("start")}
        className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-amber-300/60"
      />
      <Sparkles className="ml-1.5 h-3 w-3 shrink-0" />
      <span className="truncate">{fx.label}</span>
      <button
        data-no-marquee
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => removeEffect("", fx.id)}
        aria-label="Remover efeito"
        className="ml-auto shrink-0 pr-1.5 opacity-70 hover:opacity-100"
      >
        ×
      </button>
      <span
        onPointerDown={drag("end")}
        className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-amber-300/60"
      />
    </div>
  );
});


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

  /* A onda segue os clipes da própria faixa de áudio; se ela estiver vazia
     (projetos antigos), cai de volta para os clipes de vídeo. */
  const waveClips = useMemo(() => {
    const audio = tracks.find((t) => t.type === "audio")?.clips ?? [];
    if (audio.length > 0) return audio;
    return tracks.find((t) => t.type === "video")?.clips ?? [];
  }, [tracks]);


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
    for (const clip of waveClips) {
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
  }, [peaks, waveClips, winLeft, winWidth, zoom]);

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



const ClipBox = memo(function ClipBox({ clip, track }: { clip: Clip; track: Track }) {
  const zoom = useEditor((s) => s.zoom);
  const tool = useEditor((s) => s.tool);
  const selected = useEditor((s) => s.selectedClipIds.includes(clip.id));
  const select = useEditor((s) => s.select);
  const toggleSelect = useEditor((s) => s.toggleSelect);
  const selectMany = useEditor((s) => s.selectMany);
  const splitAt = useEditor((s) => s.splitAt);
  const trimClip = useEditor((s) => s.trimClip);
  const moveSelection = useEditor((s) => s.moveSelection);


  const [ghost, setGhost] = useState<Ghost>(null);
  const [dragging, setDragging] = useState(false);
  const [magnetized, setMagnetized] = useState(false);
  const clipRef = useRef(clip);
  clipRef.current = clip;

  const timeAt = (clientX: number) => {
    const lane = document.getElementById("tl-scroll");
    if (!lane) return 0;
    const box = lane.getBoundingClientRect();
    return Math.max(0, (clientX - box.left + lane.scrollLeft) / zoom);
  };

  /** imantação: aproxima o tempo das bordas vizinhas, agulha e início/fim */
  const snap = (start: number, dur: number | null, tolerance?: number) => {
    const s = useEditor.getState();
    if (!s.snapEnabled || e2eDisableSnapRef.current) return { start, guide: null };
    const targets = snapTargets(s.tracks, {
      excludeClipId: clipRef.current.id,
      playhead: s.currentTime,
      duration: s.duration,
    });
    const tol = tolerance ?? snapTolerance(s.zoom);
    const a = applySnap(start, targets, tol);
    const b = dur != null ? applySnap(start + dur, targets, tol) : { time: start, guide: null };
    // escolhe a borda (esquerda ou direita) que está mais perto de um alvo
    const da = a.guide != null ? Math.abs(a.time - start) : Infinity;
    const db = b.guide != null ? Math.abs(b.time - (start + (dur ?? 0))) : Infinity;
    if (da <= db && a.guide != null) return { start: a.time, guide: a.guide };
    if (b.guide != null && dur != null) return { start: b.time - dur, guide: b.guide };
    return { start, guide: null };
  };

  /** posição livre mais próxima na faixa (mesma regra aplicada no store) */
  const place = (start: number, dur: number) => {
    const s = useEditor.getState();
    const others =
      s.tracks.find((t) => t.id === clipRef.current.trackId)?.clips.filter(
        (c) => c.id !== clipRef.current.id,
      ) ?? [];
    return freeStart(others, start, dur);
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
      setMagnetized(snapped.guide != null);
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
      setMagnetized(false);
      useEditor.getState().setSnapGuide(null);
      const rel = snap(last, null, snapReleaseTolerance(useEditor.getState().zoom));
      trimClip(clipRef.current.id, side, Math.max(0, rel.start));
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

    if (e.metaKey || e.ctrlKey) {
      toggleSelect(clip.id);
      return;
    }
    if (e.shiftKey) {
      const anchor = findClip(useEditor.getState().tracks, useEditor.getState().selectedClipId);
      if (anchor && anchor.trackId === clip.trackId) {
        const lo = Math.min(anchor.startTime, clip.startTime);
        const hi = Math.max(anchor.startTime, clip.startTime);
        selectMany(
          track.clips.filter((c) => c.startTime >= lo && c.startTime <= hi).map((c) => c.id),
          true,
        );
      } else selectMany([clip.id], true);
      return;
    }
    if (!useEditor.getState().selectedClipIds.includes(clip.id)) select(clip.id);

    const grabOffset = timeAt(e.clientX) - clip.startTime;
    let moved = false;
    let last = clip.startTime;
    const groupSize = () => {
      const s = useEditor.getState();
      return selectionGroup(s.tracks, s.selectedClipIds, clipRef.current.id).length;
    };
    const move = (ev: PointerEvent) => {
      moved = true;
      setDragging(true);
      e2eDisableSnapRef.current = ev.altKey;
      const raw = Math.max(0, timeAt(ev.clientX) - grabOffset);
      const dur = clipRef.current.duration;
      const snapped = snap(raw, dur);
      const multi = groupSize() > 1;
      const start = multi ? Math.max(0, snapped.start) : place(Math.max(0, snapped.start), dur);
      const stuck = snapped.guide != null && Math.abs(start - snapped.start) < 1e-6;
      // guia só aparece quando a posição imantada sobreviveu à checagem de colisão
      useEditor.getState().setSnapGuide(stuck ? snapped.guide : null);
      setMagnetized(stuck);
      last = start;
      setGhost({ start, duration: dur });

    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGhost(null);
      setDragging(false);
      setMagnetized(false);
      useEditor.getState().setSnapGuide(null);
      if (moved) {
        // ao soltar, zona de atração ampliada: encaixa exato se couber
        const dur = clipRef.current.duration;
        const rel = snap(last, dur, snapReleaseTolerance(useEditor.getState().zoom));
        if (groupSize() > 1) {
          moveSelection(clipRef.current.id, Math.max(0, rel.start));
        } else {
          const target = place(Math.max(0, rel.start), dur);
          moveSelection(clipRef.current.id, Math.abs(target - rel.start) < 1e-6 ? target : last);
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };



  const color =
    track.type === "video"
      ? "bg-[#7a2a24] border-[#b8453a]"
      : track.type === "text"
        ? "bg-[#1f4f7a] border-[#3a7fbf]"
        : track.type === "overlay"
          ? "bg-[#7a5418] border-[#b88327]"
          : "bg-emerald-600/35 border-emerald-500/60";
  const strip = useFilmstrip(clip.type === "video" ? clip.sourceUrl : null);

  const start = ghost?.start ?? clip.startTime;
  const dur = ghost?.duration ?? clip.duration;

  return (
    <div
      data-clip-id={clip.id}
      onPointerDown={onPointerDown}
      className={cn(
        "absolute top-[3px] flex h-[calc(100%-6px)] touch-none select-none items-center gap-1 overflow-hidden rounded-[5px] border px-1.5 text-[11px] font-medium text-white animate-scale-in",
        color,
        !dragging && "transition-[left,width] duration-150 ease-out",
        tool === "blade" ? "cursor-crosshair" : dragging ? "cursor-grabbing" : "cursor-grab",
        selected && "border-white ring-1 ring-white",
        dragging && "opacity-80",
        magnetized && "brightness-125 ring-2 ring-[var(--brand)]",
      )}
      style={{
        left: start * zoom + 1,
        // clipes muito curtos não podem "vazar" por cima do vizinho: no máximo
        // a própria largura real, com 2px de piso só para continuarem visíveis.
        width: Math.max(2, Math.min(dur * zoom - 2, Math.max(2, dur * zoom - 2))),
        paddingLeft: dur * zoom < 24 ? 0 : undefined,
        paddingRight: dur * zoom < 24 ? 0 : undefined,
        zIndex: dragging ? 20 : selected ? 10 : 1,
      }}

    >
      {strip ? (
        <FilmstripTiles
          strip={strip}
          width={dur * zoom}
          from={clip.sourceInStart}
          to={clip.sourceInEnd}
        />
      ) : null}
      {clip.linkGroupId && !strip && dur * zoom >= 40 ? (
        <Link2 className="pointer-events-none relative h-3 w-3 shrink-0 opacity-80" />
      ) : null}
      <span
        className={cn(
          "pointer-events-none relative truncate",
          strip && "self-start mt-0.5 rounded-sm bg-black/55 px-1 text-[10px] leading-4",
        )}
      >
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
            className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize rounded-l-[4px] bg-white"
          />
          <span
            onPointerDown={startTrim("end")}
            className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize rounded-r-[4px] bg-white"
          />
        </>
      ) : null}
    </div>
  );
});

/** Miniaturas de um vídeo (null enquanto não é vídeo ou não há duração conhecida). */
function useFilmstrip(url: string | null | undefined): Filmstrip | null {
  const duration = useEditor((s) =>
    !url
      ? 0
      : url === s.sourceUrl
        ? s.sourceDuration
        : (s.mediaLibrary.find((m) => m.url === url)?.duration ?? 0),
  );
  const [strip, setStrip] = useState<Filmstrip | null>(null);
  useEffect(() => {
    if (!url || !duration) {
      setStrip(null);
      return;
    }
    return subscribeFilmstrip(url, duration, setStrip);
  }, [url, duration]);
  return strip;
}

const TILE_W = 64;

/** Quadros do vídeo lado a lado dentro do clipe (como no CapCut). */
const FilmstripTiles = memo(function FilmstripTiles({
  strip,
  width,
  from,
  to,
}: {
  strip: Filmstrip;
  width: number;
  from: number;
  to: number;
}) {
  const count = Math.min(300, Math.max(1, Math.ceil(width / TILE_W)));
  const span = Math.max(0, to - from);
  const tiles: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = from + ((i * TILE_W) / Math.max(1, width)) * span;
    const idx = Math.min(strip.frames.length - 1, Math.max(0, Math.round(t / strip.step)));
    tiles.push(strip.frames[idx] ?? "");
  }
  return (
    <div className="pointer-events-none absolute inset-0 flex overflow-hidden opacity-80">
      {tiles.map((src, i) =>
        src ? (
          <img
            key={i}
            src={src}
            alt=""
            draggable={false}
            className="h-full shrink-0 object-cover"
            style={{ width: TILE_W }}
          />
        ) : (
          <span key={i} className="h-full shrink-0" style={{ width: TILE_W }} />
        ),
      )}
    </div>
  );
});

/** Tempo atual / duração, no formato 00:00:00. */
function Timecode() {
  const currentTime = useEditor((s) => s.currentTime);
  const duration = useEditor((s) => s.duration);
  const tc = (t: number) => {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const sec = Math.floor(t % 60);
    return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
  };
  return (
    <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">
      {tc(currentTime)}
      <span className="text-[var(--muted-foreground)]"> / {tc(duration)}</span>
    </span>
  );
}

/** Agulha: componente próprio para só ela redesenhar a cada quadro durante o play. */
function Playhead({
  height,
  onPointerDown,
}: {
  height: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const zoom = useEditor((s) => s.zoom);
  const currentTime = useEditor((s) => s.currentTime);
  return (
    <div
      onPointerDown={onPointerDown}
      className="absolute left-0 top-0 z-40 w-px cursor-ew-resize bg-[var(--brand)] will-change-transform"
      style={{ transform: `translateX(${currentTime * zoom}px)`, height }}
    >
      <span className="absolute -left-2 -top-1 h-4 w-4 cursor-ew-resize rounded-sm bg-[var(--brand)]" />
      <span className="absolute -left-2 top-0 h-full w-4" />
    </div>
  );
}

function readTimelineHeight() {
  try {
    const v = Number(localStorage.getItem(TL_HEIGHT_KEY));
    return Number.isFinite(v) && v >= TL_MIN_H ? v : TL_DEFAULT_H;
  } catch {
    return TL_DEFAULT_H;
  }
}

export function Timeline() {
  const tracks = useEditor((s) => s.tracks);
  const zoom = useEditor((s) => s.zoom);
  const duration = useEditor((s) => s.duration);
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const selectedClipIds = useEditor((s) => s.selectedClipIds);
  const setZoom = useEditor((s) => s.setZoom);
  const setCurrentTime = useEditor((s) => s.setCurrentTime);
  const select = useEditor((s) => s.select);
  const selectMany = useEditor((s) => s.selectMany);
  const silences = useEditor((s) => s.silences);
  const sourceUrl = useEditor((s) => s.sourceUrl);

  /* faixas vazias ficam ocultas; reaparecem ao arrastar mídia da biblioteca */
  const [mediaDragging, setMediaDragging] = useState(false);
  useEffect(() => {
    const on = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("application/x-gravaai-media")) setMediaDragging(true);
    };
    const off = () => setMediaDragging(false);
    window.addEventListener("dragover", on);
    window.addEventListener("drop", off);
    window.addEventListener("dragend", off);
    return () => {
      window.removeEventListener("dragover", on);
      window.removeEventListener("drop", off);
      window.removeEventListener("dragend", off);
    };
  }, []);

  const visibleTracks = useMemo(
    () => tracks.filter((t) => t.clips.length > 0 || mediaDragging),
    [tracks, mediaDragging],
  );


  const scrollRef = useRef<HTMLDivElement>(null);
  const contentWidth = Math.max(600, (duration + 4) * zoom);

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

  /** a área das faixas ocupa pelo menos a largura visível */
  const width = Math.max(contentWidth, view.width);

  const visible = useMemo(() => {
    const margin = 600; // px de folga fora da tela
    return {
      from: Math.max(0, (view.left - margin) / zoom),
      to: (view.left + view.width + margin) / zoom,
    };
  }, [view, zoom]);

  /* --- zoom ancorado: o ponto sob o mouse (ou a agulha) fica parado na tela --- */
  const zoomAnchor = useRef<{ time: number; px: number } | null>(null);
  const zoomAround = useCallback(
    (next: number, clientX?: number) => {
      const el = scrollRef.current;
      const s = useEditor.getState();
      if (el) {
        const box = el.getBoundingClientRect();
        const playheadPx = s.currentTime * s.zoom - el.scrollLeft;
        const px =
          clientX != null
            ? clientX - box.left
            : playheadPx >= 0 && playheadPx <= el.clientWidth
              ? playheadPx
              : el.clientWidth / 2;
        zoomAnchor.current = { time: (px + el.scrollLeft) / s.zoom, px };
      }
      setZoom(next);
    },
    [setZoom],
  );
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const el = scrollRef.current;
    zoomAnchor.current = null;
    if (a && el) el.scrollLeft = Math.max(0, a.time * zoom - a.px);
  }, [zoom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? el.clientWidth : 1;
      if (e.ctrlKey || e.metaKey) {
        // Ctrl/⌘ + roda (ou pinça no trackpad): zoom na posição do mouse
        e.preventDefault();
        const z = useEditor.getState().zoom;
        zoomAround(z * Math.exp(-e.deltaY * unit * 0.002), e.clientX);
        return;
      }
      // sem faixas para rolar na vertical, a roda anda na linha do tempo
      if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollHeight <= el.clientHeight + 1) {
        e.preventDefault();
        el.scrollLeft += e.deltaY * unit;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAround]);

  /* durante o play a linha do tempo acompanha a agulha */
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        if (!s.playing || s.currentTime === prev.currentTime) return;
        const el = scrollRef.current;
        if (!el) return;
        const x = s.currentTime * s.zoom;
        if (x > el.scrollLeft + el.clientWidth - 24 || x < el.scrollLeft)
          el.scrollLeft = Math.max(0, x - el.clientWidth * 0.15);
      }),
    [],
  );

  /* altura da linha do tempo: arraste a borda de cima */
  const [panelH, setPanelH] = useState(TL_DEFAULT_H);
  useEffect(() => setPanelH(readTimelineHeight()), []);
  const startResize = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const y0 = e.clientY;
    const h0 = panelH;
    let h = h0;
    const max = () => Math.max(TL_MIN_H, window.innerHeight * 0.75);
    const move = (ev: PointerEvent) => {
      h = Math.round(Math.min(max(), Math.max(TL_MIN_H, h0 + (y0 - ev.clientY))));
      setPanelH(h);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(TL_HEIGHT_KEY, String(h));
      } catch {
        /* sem armazenamento: só não lembra a altura */
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

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

  const effects = useEditor((s) => s.effects);
  /** empilha efeitos que se sobrepõem em linhas próprias (como faixas) */
  const fxRows = useMemo(() => {
    const ends: number[] = [];
    const map = new Map<string, number>();
    for (const fx of [...effects].sort((a, b) => a.start - b.start)) {
      let row = ends.findIndex((end) => fx.start >= end - 1e-3);
      if (row === -1) {
        row = ends.length;
        ends.push(fx.end);
      } else ends[row] = fx.end;
      map.set(fx.id, row);
    }
    return { map, count: Math.max(ends.length, effects.length ? 1 : 0) };
  }, [effects]);
  const fxHeight = fxRows.count * FX_H;
  const lanesHeight = visibleTracks.length * LANE_H + kfRows.length * KF_H + fxHeight;


  const snapGuide = useEditor((s) => s.snapGuide);
  const addMediaClip = useEditor((s) => s.addMediaClip);

  /* --- reordenar faixas (arraste vertical nos rótulos) --- */
  const reorderTracks = useEditor((s) => s.reorderTracks);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [dragTrack, setDragTrack] = useState<{ id: string; index: number; overIndex: number } | null>(
    null,
  );

  /* --- laço de seleção (marquee) sobre as faixas --- */
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null,
  );

  const startMarquee = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // pode começar em qualquer área vazia da timeline (inclusive fora das faixas),
    // mas nunca por cima de clipes, botões, régua/agulha ou rótulos.
    if (
      target.closest(
        "[data-clip-id],button,input,select,textarea,[data-no-marquee],.cursor-ew-resize,.cursor-grab,.cursor-grabbing",
      )
    )
      return;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!additive) select(null);
    const x1 = e.clientX;
    const y1 = e.clientY;
    let box = { x1, y1, x2: x1, y2: y1 };
    setMarquee(box);
    const move = (ev: PointerEvent) => {
      box = { x1, y1, x2: ev.clientX, y2: ev.clientY };
      setMarquee(box);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      const left = Math.min(box.x1, box.x2);
      const right = Math.max(box.x1, box.x2);
      const top = Math.min(box.y1, box.y2);
      const bottom = Math.max(box.y1, box.y2);
      if (right - left < 4 && bottom - top < 4) {
        // clique simples no vazio da faixa: leva a agulha até ali
        const lane = scrollRef.current?.getBoundingClientRect();
        if (!additive && lane && x1 >= lane.left && y1 > lane.top + 28)
          setCurrentTime(timeFromClientX(x1));
        return;
      }
      const ids: string[] = [];
      document.querySelectorAll<HTMLElement>("[data-clip-id]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right < left || r.left > right || r.bottom < top || r.top > bottom) return;
        const id = el.dataset.clipId;
        if (id) ids.push(id);
      });
      if (ids.length) selectMany(ids, additive);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };


  const rowHeights = useMemo(
    () =>
      visibleTracks.map(
        (t) => LANE_H + (selectedClip?.trackId === t.id ? kfRows.length * KF_H : 0),
      ),
    [visibleTracks, selectedClip, kfRows.length],
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
    const track = visibleTracks[index];
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
      const target = visibleTracks[over];
      if (over !== index && target)
        reorderTracks(tracks.indexOf(track), tracks.indexOf(target));
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };






  return (
    <div
      onPointerDown={startMarquee}
      className="relative flex shrink-0 flex-col border-t border-[var(--border)] bg-[var(--surface)]"
      style={{ height: panelH }}
    >
      <div
        data-no-marquee
        onPointerDown={startResize}
        onDoubleClick={() => setPanelH(TL_DEFAULT_H)}
        title="Arraste para aumentar ou diminuir a linha do tempo (duplo clique volta ao padrão)"
        className="absolute inset-x-0 -top-1 z-50 h-2 cursor-row-resize hover:bg-[var(--brand)]/40"
      />
      <div className="flex min-h-0 flex-1">
        {/* rótulos das faixas (arraste vertical para reordenar) */}
        <div className="shrink-0 border-r border-[var(--border)]" style={{ width: LABEL_W }}>
          <div className="flex h-7 items-center gap-1 border-b border-[var(--border)] pl-1.5 pr-1">
            <button
              onClick={() => setPlaying(!playing)}
              disabled={!sourceUrl}
              title="Reproduzir / pausar (Espaço)"
              aria-label={playing ? "Pausar" : "Reproduzir"}
              className="grid h-6 w-6 place-items-center rounded text-[var(--foreground)] hover:bg-white/10 disabled:opacity-30"
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <Timecode />
            <span className="ml-auto" />
            <button
              onClick={() => zoomAround(zoom / 1.4)}
              title="Diminuir zoom (Ctrl + roda do mouse)"
              aria-label="Diminuir zoom"
              className="grid h-6 w-6 place-items-center rounded text-[var(--muted-foreground)] hover:bg-white/10 hover:text-[var(--foreground)]"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => zoomAround(zoom * 1.4)}
              title="Aumentar zoom (Ctrl + roda do mouse)"
              aria-label="Aumentar zoom"
              className="grid h-6 w-6 place-items-center rounded text-[var(--muted-foreground)] hover:bg-white/10 hover:text-[var(--foreground)]"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
          <div ref={labelsRef} className="overflow-hidden">
            {visibleTracks.map((t, i) => (
              <div key={t.id} className="animate-fade-in">
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
                  {t.type === "video" ? (
                    <Video className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                  ) : t.type === "audio" ? (
                    <Music className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  ) : t.type === "text" ? (
                    <Type className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  )}
                  <span className="truncate">{t.label}</span>
                  {t.clips.length > 1 ? (
                    <span className="ml-auto shrink-0 rounded bg-[var(--border)] px-1 text-[9px] tabular-nums">
                      {t.clips.length}
                    </span>
                  ) : null}
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
            {effects.length ? (
              <div
                className="flex animate-fade-in items-start gap-1.5 border-b border-[var(--border)] px-2 pt-2 text-[11px] font-semibold text-amber-300"
                style={{ height: fxHeight }}
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Efeitos</span>
                <span className="ml-auto shrink-0 rounded bg-[var(--border)] px-1 text-[9px] tabular-nums">
                  {effects.length}
                </span>
              </div>
            ) : null}
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

            <div onPointerDown={startMarquee}>
              {visibleTracks.length === 0 ? (
                <div className="px-3 py-6 text-xs text-[var(--muted-foreground)]">
                  As faixas aparecem aqui conforme você adiciona vídeo, áudio, texto ou efeitos.
                </div>
              ) : null}
              {visibleTracks.map((track) => (
                <div key={track.id} className="animate-fade-in">
                  <div
                    onPointerDown={startMarquee}

                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes("application/x-gravaai-media")) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "copy";
                    }}
                    onDrop={(e) => {
                      const id = e.dataTransfer.getData("application/x-gravaai-media");
                      if (!id) return;
                      e.preventDefault();
                      const lane = scrollRef.current;
                      if (!lane) return;
                      const box = lane.getBoundingClientRect();
                      const raw = Math.max(0, (e.clientX - box.left + lane.scrollLeft) / zoom);
                      const s = useEditor.getState();
                      const start = s.snapEnabled
                        ? applySnap(
                            raw,
                            snapTargets(s.tracks, { playhead: s.currentTime, duration: s.duration }),
                            snapTolerance(zoom),
                          ).time
                        : raw;
                      addMediaClip(id, start);
                    }}
                    className="relative border-b border-[var(--border)]"
                    style={{ height: LANE_H }}
                  >
                    {track.type === "audio" ? (
                      <AudioWaveform width={width} viewLeft={view.left} viewWidth={view.width} />
                    ) : null}
                    {track.clips
                      .filter(
                        (clip) =>
                          selectedClipIds.includes(clip.id) ||
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
              {effects.length ? (
                <div
                  className="relative animate-fade-in border-b border-[var(--border)] bg-[var(--surface-2)]/40"
                  style={{ height: fxHeight }}
                >
                  {effects.map((fx) => (
                    <EffectBar key={fx.id} fx={fx} row={fxRows.map.get(fx.id) ?? 0} />
                  ))}
                </div>
              ) : null}
            </div>



            {/* linha-guia da imantação */}
            {snapGuide != null ? (
              <div
                className="pointer-events-none absolute top-0 z-40 w-px bg-amber-300"
                style={{ left: snapGuide * zoom, height: 28 + lanesHeight }}
              />
            ) : null}

            {/* playhead — arrastável */}
            <Playhead height={28 + lanesHeight} onPointerDown={startScrub} />
          </div>
        </div>
      </div>

      {/* laço de seleção múltipla */}
      {marquee ? (
        <div
          className="pointer-events-none fixed z-50 rounded-sm border border-[var(--brand)] bg-[var(--brand)]/15"
          style={{
            left: Math.min(marquee.x1, marquee.x2),
            top: Math.min(marquee.y1, marquee.y2),
            width: Math.abs(marquee.x2 - marquee.x1),
            height: Math.abs(marquee.y2 - marquee.y1),
          }}
        />
      ) : null}



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
