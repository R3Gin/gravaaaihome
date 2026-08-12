import { useCallback, useEffect, useRef } from "react";
import { clipAt, useEditor, type AspectRatio } from "@/state/editor-store";
import { buildFrame, drawFrame, type HitRegion } from "@/lib/preview-compose";
import {
  drawAnnotation,
  translateAnnotation,
  type Annotation,
} from "@/lib/annotations";
import { cn } from "@/lib/utils";

const ASPECTS: { id: AspectRatio; label: string; ratio: number }[] = [
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "1:1", label: "1:1", ratio: 1 },
];

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function Preview({ videoRef }: Props) {
  const sourceUrl = useEditor((s) => s.sourceUrl);
  const playing = useEditor((s) => s.playing);
  const aspect = useEditor((s) => s.aspect);

  const setAspect = useEditor((s) => s.setAspect);
  const setCurrentTime = useEditor((s) => s.setCurrentTime);
  const setPlaying = useEditor((s) => s.setPlaying);
  const select = useEditor((s) => s.select);
  const updateClipLive = useEditor((s) => s.updateClipLive);
  const commit = useEditor((s) => s.commit);
  const addAnnotationClip = useEditor((s) => s.addAnnotationClip);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const drawRafRef = useRef<number | null>(null);
  const hitsRef = useRef<HitRegion[]>([]);
  const dragRef = useRef<{
    id: string;
    kind: "move" | "resize" | "annotation-move";
    lastX?: number;
    lastY?: number;
  } | null>(null);
  const draftRef = useRef<Annotation | null>(null);
  const diagnosticActiveClipRef = useRef<string | null>(null);
  const annotationTool = useEditor((s) => s.annotationTool);
  const pendingEffectPreset = useEditor((s) => s.pendingEffectPreset);
  const setPendingEffectPreset = useEditor((s) => s.setPendingEffectPreset);




  /* Esc cancela o modo "clique no ponto" dos presets de zoom */
  useEffect(() => {
    if (!pendingEffectPreset) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingEffectPreset(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingEffectPreset, setPendingEffectPreset]);


  /* ---------------- pipeline única de render ---------------- */
  const paint = useCallback(() => {
    drawRafRef.current = null;
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(stage.clientWidth));
    const H = Math.max(1, Math.round(stage.clientHeight));
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const s = useEditor.getState();
    const v = videoRef.current;
    // tempo consolidado: durante a reprodução o <video> é a fonte da verdade
    let time = s.currentTime;
    if (v && s.playing) {
      const clip = clipAt(s.tracks, "video", s.currentTime);
      if (clip) time = clip.startTime + (v.currentTime - clip.sourceInStart) / (clip.speed ?? 1);
    }
    const frame = buildFrame(s.tracks, s.captionStyle, time, s.selectedClipId);
    hitsRef.current = drawFrame(ctx, v, frame, W, H);
    if (draftRef.current) drawAnnotation(ctx, draftRef.current, W, H);
  }, [videoRef]);

  const schedulePaint = useCallback(() => {
    if (drawRafRef.current == null) drawRafRef.current = requestAnimationFrame(paint);
  }, [paint]);

  /* redesenha ao mudar o estado, ao redimensionar e enquanto toca */
  useEffect(() => {
    schedulePaint();
    const unsub = useEditor.subscribe(schedulePaint);
    const ro = new ResizeObserver(schedulePaint);
    if (stageRef.current) ro.observe(stageRef.current);
    const v = videoRef.current;
    const events = ["seeked", "loadeddata", "timeupdate"];
    if (v) events.forEach((e) => v.addEventListener(e, schedulePaint));
    return () => {
      unsub();
      ro.disconnect();
      if (v) events.forEach((e) => v.removeEventListener(e, schedulePaint));
      if (drawRafRef.current != null) cancelAnimationFrame(drawRafRef.current);
      drawRafRef.current = null;
    };
  }, [schedulePaint, videoRef, sourceUrl]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      paint();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, paint]);

  /* --- seek quando o playhead muda fora da reprodução --- */
  const currentTime = useEditor((s) => s.currentTime);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || playing) return;
    const clip = clipAt(useEditor.getState().tracks, "video", currentTime);
    if (!clip) return;
    const speed = clip.speed ?? 1;
    const target = clip.sourceInStart + (currentTime - clip.startTime) * speed;
    if (Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
  }, [currentTime, playing, videoRef]);

  /* --- trocar de aba apenas pausa: o estado do editor é preservado --- */
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden && useEditor.getState().playing) setPlaying(false);
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [setPlaying]);

  /* --- loop de reprodução: contínuo, nunca pausa ao trocar de clipe --- */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!playing) {
      v.pause();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const videoClips = () =>
      [...(useEditor.getState().tracks.find((t) => t.type === "video")?.clips ?? [])].sort(
        (a, b) => a.startTime - b.startTime,
      );

    const state = useEditor.getState();
    const clips0 = videoClips();
    const startClip =
      clipAt(state.tracks, "video", state.currentTime) ??
      clips0.find((c) => c.startTime + c.duration > state.currentTime) ??
      null;
    if (!startClip) {
      setPlaying(false);
      return;
    }
    if (state.currentTime < startClip.startTime) setCurrentTime(startClip.startTime + 0.001);
    v.playbackRate = startClip.speed ?? 1;
    // sempre parte do ponto correto dentro do arquivo de origem
    const startSource =
      startClip.sourceInStart +
      Math.max(0, state.currentTime - startClip.startTime) * (startClip.speed ?? 1);
    if (Math.abs(v.currentTime - startSource) > 0.05) v.currentTime = startSource;
    void v.play().catch(() => setPlaying(false));

    let activeId = startClip.id;

    /** Salta para o próximo clipe da timeline sem pausar o elemento <video>. */
    const jumpTo = (next: (typeof clips0)[number]) => {
      activeId = next.id;
      const rate = next.speed ?? 1;
      if (v.playbackRate !== rate) v.playbackRate = rate;
      // Só reposiciona o arquivo quando o próximo clipe NÃO é contíguo:
      // trechos contíguos continuam tocando sem seek algum.
      if (Math.abs(v.currentTime - next.sourceInStart) > 0.06) {
        v.currentTime = next.sourceInStart;
      }
      setCurrentTime(next.startTime + 0.001);
      if (v.paused) void v.play().catch(() => undefined);
    };

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const s = useEditor.getState();
      const clips = videoClips();
      if (clips.length === 0) {
        setPlaying(false);
        return;
      }
      // clipe "ativo" é só uma referência conceitual: trocar não toca no <video>
      const clip =
        clips.find((c) => c.id === activeId) ??
        clipAt(s.tracks, "video", s.currentTime) ??
        clips.find((c) => c.startTime + c.duration > s.currentTime) ??
        clips[clips.length - 1]!;
      activeId = clip.id;
      const speed = clip.speed ?? 1;
      if (v.playbackRate !== speed) v.playbackRate = speed;
      // o navegador pode pausar por buffering/seek: retomamos sempre
      if (v.paused && !v.seeking) void v.play().catch(() => undefined);

      const reachedEnd = v.currentTime >= clip.sourceInEnd - 0.02 || (v.ended && !v.seeking);
      if (reachedEnd) {
        const next = clips.find((c) => c.startTime + 0.001 >= clip.startTime + clip.duration);
        if (next) {
          jumpTo(next);
          return;
        }
        setCurrentTime(clip.startTime + clip.duration);
        setPlaying(false);
        return;
      }
      setCurrentTime(clip.startTime + (v.currentTime - clip.sourceInStart) / speed);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, setCurrentTime, setPlaying, videoRef]);


  /* --- interação: hit-test das áreas desenhadas no canvas --- */
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const box = stageRef.current?.getBoundingClientRect();
      if (!box) return;
      const px = e.clientX - box.left;
      const py = e.clientY - box.top;
      const nx = Math.max(0, Math.min(1, px / box.width));
      const ny = Math.max(0, Math.min(1, py / box.height));
      const s = useEditor.getState();
      const pending = s.pendingEffectPreset;
      if (pending) {
        const target = s.selectedClipId ?? clipAt(s.tracks, "video", s.currentTime)?.id ?? null;
        if (target) {
          if (!s.selectedClipId) s.select(target);
          s.applyEffectPreset(target, pending.presetId, {
            ...pending.params,
            point: { x: nx, y: ny },
          });
        }
        s.setPendingEffectPreset(null);
        return;
      }
      const tool = s.annotationTool;


      if (tool) {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        if (tool === "eraser") {
          const hit = [...hitsRef.current]
            .reverse()
            .find(
              (h) =>
                h.kind === "annotation" &&
                px >= h.x &&
                px <= h.x + h.w &&
                py >= h.y &&
                py <= h.y + h.h,
            );
          if (hit) s.removeClip(hit.id);
          return;
        }
        draftRef.current = {
          type: tool,
          color: s.annotationColor,
          sizeN: s.annotationSize / 720,
          fill: s.annotationFill,
          points: [{ x: nx, y: ny }],
        };
        schedulePaint();
        return;
      }

      const hit = [...hitsRef.current]
        .reverse()
        .find((h) => px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h);
      if (!hit) {
        select(null);
        return;
      }
      select(hit.id);
      if (hit.kind === "annotation") {
        dragRef.current = { id: hit.id, kind: "annotation-move", lastX: nx, lastY: ny };
      } else {
        const corner =
          hit.kind === "overlay" && px > hit.x + hit.w - 16 && py > hit.y + hit.h - 16;
        dragRef.current = { id: hit.id, kind: corner ? "resize" : "move" };
      }
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [schedulePaint, select],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const box = stageRef.current?.getBoundingClientRect();
      if (!box) return;
      const nx = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
      const ny = Math.max(0, Math.min(1, (e.clientY - box.top) / box.height));

      const draft = draftRef.current;
      if (draft) {
        if (draft.type === "pen") draft.points.push({ x: nx, y: ny });
        else draft.points[1] = { x: nx, y: ny };
        schedulePaint();
        return;
      }

      const drag = dragRef.current;
      if (!drag) return;
      const clip = useEditor.getState().tracks.flatMap((t) => t.clips).find((c) => c.id === drag.id);
      if (!clip) return;
      if (drag.kind === "annotation-move") {
        if (!clip.annotation) return;
        const dx = nx - (drag.lastX ?? nx);
        const dy = ny - (drag.lastY ?? ny);
        drag.lastX = nx;
        drag.lastY = ny;
        updateClipLive(clip.id, { annotation: translateAnnotation(clip.annotation, dx, dy) });
        return;
      }
      if (drag.kind === "move") {
        if (clip.type === "text") updateClipLive(clip.id, { position: { x: nx, y: ny } });
        else if (clip.rect)
          updateClipLive(clip.id, {
            rect: { ...clip.rect, x: nx - clip.rect.w / 2, y: ny - clip.rect.h / 2 },
          });
      } else if (clip.rect) {
        updateClipLive(clip.id, {
          rect: {
            ...clip.rect,
            w: Math.max(0.05, nx - clip.rect.x),
            h: Math.max(0.05, ny - clip.rect.y),
          },
        });
      }
    },
    [schedulePaint, updateClipLive],
  );

  const endDrag = useCallback(() => {
    const draft = draftRef.current;
    if (draft) {
      draftRef.current = null;
      const pts = draft.points;
      const enough =
        draft.type === "pen"
          ? pts.length > 1
          : pts.length > 1 &&
            (Math.abs(pts[1].x - pts[0].x) > 0.01 || Math.abs(pts[1].y - pts[0].y) > 0.01);
      if (enough) addAnnotationClip(draft);
      schedulePaint();
      return;
    }
    if (dragRef.current) {
      dragRef.current = null;
      commit();
    }
  }, [addAnnotationClip, commit, schedulePaint]);

  const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio ?? 16 / 9;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--background)]">
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          className={cn(
            "relative overflow-hidden rounded-xl border border-[var(--border)] bg-black shadow-lg",
            annotationTool && annotationTool !== "eraser" && "cursor-crosshair",
            annotationTool === "eraser" && "cursor-cell",
            pendingEffectPreset && "cursor-crosshair ring-2 ring-[var(--brand)]",

          )}
          style={{
            aspectRatio: String(ratio),
            width: "min(100%, 1100px)",
            maxWidth: "100%",
            maxHeight: "100%",
            margin: "auto",
          }}
        >
          {/* elemento de mídia: só decodifica áudio/vídeo, nunca é exibido */}
          {sourceUrl ? (
            <video
              ref={videoRef}
              src={sourceUrl}
              playsInline
              className="pointer-events-none absolute h-px w-px opacity-0"
              style={{ left: 0, top: 0 }}
            />
          ) : null}

          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

          {!sourceUrl ? (
            <div className="absolute inset-0 grid place-items-center text-sm text-[var(--muted-foreground)]">
              Nenhum vídeo carregado
            </div>
          ) : null}

          {pendingEffectPreset ? (
            <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-2">
              <span className="rounded-full bg-[var(--brand)] px-3 py-1 text-[11px] font-semibold text-white shadow">
                Clique no ponto do vídeo para dar zoom · Esc cancela
              </span>
            </div>
          ) : null}

        </div>
      </div>

      <div className="flex shrink-0 items-center justify-center gap-2 pb-3">
        {ASPECTS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAspect(a.id)}
            className={cn(
              "rounded-lg border px-3 py-1 text-xs font-semibold",
              aspect === a.id
                ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                : "border-[var(--border)] text-[var(--muted-foreground)]",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
