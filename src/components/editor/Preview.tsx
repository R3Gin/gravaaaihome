import { useCallback, useEffect, useRef } from "react";
import { clipAt, useEditor, type AspectRatio } from "@/state/editor-store";
import { buildFrame, drawFrame, type HitRegion } from "@/lib/preview-compose";
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

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const drawRafRef = useRef<number | null>(null);
  const hitsRef = useRef<HitRegion[]>([]);
  const dragRef = useRef<{ id: string; kind: "move" | "resize" } | null>(null);

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

  /* --- loop de reprodução: fonte da verdade é o <video> --- */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!playing) {
      v.pause();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const state = useEditor.getState();
    const videoClips = () =>
      [...(useEditor.getState().tracks.find((t) => t.type === "video")?.clips ?? [])].sort(
        (a, b) => a.startTime - b.startTime,
      );
    const startClip =
      clipAt(state.tracks, "video", state.currentTime) ??
      videoClips().find((c) => c.startTime + c.duration > state.currentTime) ??
      null;
    if (!startClip) {
      setPlaying(false);
      return;
    }
    if (state.currentTime < startClip.startTime) setCurrentTime(startClip.startTime + 0.001);
    v.playbackRate = startClip.speed ?? 1;
    void v.play().catch(() => setPlaying(false));

    let activeId = startClip.id;

    const tick = () => {
      const s = useEditor.getState();
      const clips = videoClips();
      const clip =
        clipAt(s.tracks, "video", s.currentTime) ??
        clips.find((c) => c.id === activeId) ??
        clips.find((c) => c.startTime + c.duration > s.currentTime) ??
        null;
      if (!clip) {
        setPlaying(false);
        return;
      }
      activeId = clip.id;
      const speed = clip.speed ?? 1;
      if (v.playbackRate !== speed) v.playbackRate = speed;
      if (v.paused && !v.ended) void v.play().catch(() => undefined);

      if (v.currentTime >= clip.sourceInEnd - 0.02) {
        const next = clips.find(
          (c) => c.startTime >= clip.startTime + clip.duration - 0.01 && c.id !== clip.id,
        );
        if (!next) {
          setCurrentTime(clip.startTime + clip.duration);
          setPlaying(false);
          return;
        }
        activeId = next.id;
        v.currentTime = next.sourceInStart;
        setCurrentTime(next.startTime + 0.001);
      } else {
        setCurrentTime(clip.startTime + (v.currentTime - clip.sourceInStart) / speed);
      }
      rafRef.current = requestAnimationFrame(tick);
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
      const hit = [...hitsRef.current]
        .reverse()
        .find((h) => px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h);
      if (!hit) {
        select(null);
        return;
      }
      select(hit.id);
      const corner =
        hit.kind === "overlay" && px > hit.x + hit.w - 16 && py > hit.y + hit.h - 16;
      dragRef.current = { id: hit.id, kind: corner ? "resize" : "move" };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [select],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      const box = stageRef.current?.getBoundingClientRect();
      if (!drag || !box) return;
      const nx = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width));
      const ny = Math.max(0, Math.min(1, (e.clientY - box.top) / box.height));
      const clip = useEditor.getState().tracks.flatMap((t) => t.clips).find((c) => c.id === drag.id);
      if (!clip) return;
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
    [updateClipLive],
  );

  const endDrag = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null;
      commit();
    }
  }, [commit]);

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
          className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-black shadow-lg"
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
