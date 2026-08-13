import { useCallback, useEffect, useRef } from "react";
import { clipAt, useEditor, type AspectRatio } from "@/state/editor-store";
import { buildFrame, drawFrame, type HitRegion } from "@/lib/preview-compose";
import { mediaSourceFor, syncMediaClips } from "@/lib/media-elements";
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
    syncMediaClips(s.tracks, s.mediaLibrary, time, s.playing);
    hitsRef.current = drawFrame(ctx, v, frame, W, H, (clip) =>
      mediaSourceFor(clip, s.mediaLibrary),
    );
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
    if (Math.abs(v.currentTime - target) > 0.04) {
      v.currentTime = target;
    }
  }, [currentTime, playing, videoRef]);

  /* --- pool de decodificadores: evita seek (e congelamento) nas emendas --- */
  const videoARef = useRef<HTMLVideoElement | null>(null);
  const videoBRef = useRef<HTMLVideoElement | null>(null);
  const videoCRef = useRef<HTMLVideoElement | null>(null);
  /** reservas por clipe: elemento já posicionado no início do corte seguinte */
  const videoPrepRef = useRef<Map<string, { el: HTMLVideoElement; ready: boolean }>>(new Map());


  /* --- áudio separado do vídeo: dois <audio> alternados (sem pausa na emenda) --- */

  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);
  const audioActiveRef = useRef<HTMLAudioElement | null>(null);
  const audioPrepRef = useRef<{ clipId: string; ready: boolean } | null>(null);
  const audioClipRef = useRef<string | null>(null);
  useEffect(() => {
    const sync = () => {
      const a = audioActiveRef.current ?? audioARef.current;
      audioActiveRef.current = a;
      const v = videoRef.current;
      const s = useEditor.getState();
      const videoClip = clipAt(s.tracks, "video", s.currentTime);
      if (v) v.muted = Boolean(videoClip?.muted);
      if (!a) return;
      const audioClips = [...(s.tracks.find((t) => t.type === "audio")?.clips ?? [])].sort(
        (x, y) => x.startTime - y.startTime,
      );
      const audioClip = clipAt(s.tracks, "audio", s.currentTime);
      const standby = a === audioARef.current ? audioBRef.current : audioARef.current;

      if (!audioClip || !audioClip.sourceUrl) {
        if (!a.paused) a.pause();
        if (standby && !standby.paused) standby.pause();
        audioClipRef.current = null;
        return;
      }

      // troca de clipe: usa o elemento de reserva já posicionado, se houver
      if (audioClipRef.current !== audioClip.id) {
        if (standby && audioPrepRef.current?.clipId === audioClip.id && audioPrepRef.current.ready) {
          a.pause();
          audioActiveRef.current = standby;
          audioPrepRef.current = null;
        }
        audioClipRef.current = audioClip.id;
      }

      const act = audioActiveRef.current!;
      const other = act === audioARef.current ? audioBRef.current : audioARef.current;
      if (other && !other.paused) other.pause();
      act.volume = Math.max(0, Math.min(1, audioClip.volume ?? 1));
      act.playbackRate = audioClip.speed ?? 1;
      const target =
        audioClip.sourceInStart + (s.currentTime - audioClip.startTime) * (audioClip.speed ?? 1);
      if (Math.abs(act.currentTime - target) > 0.12) act.currentTime = target;
      if (s.playing && act.paused) void act.play().catch(() => undefined);
      if (!s.playing && !act.paused) act.pause();

      // pré-posiciona o próximo clipe de áudio assim que o atual começa:
      // o seek pode demorar mais de 1 s, tempo que uma janela curta não daria
      if (!s.playing || !other) return;
      const idx = audioClips.findIndex((c) => c.id === audioClip.id);
      const next = idx >= 0 ? audioClips[idx + 1] : undefined;
      if (!next) return;
      const remaining = audioClip.startTime + audioClip.duration - s.currentTime;
      if (remaining < 0) return;
      if (audioPrepRef.current?.clipId === next.id) return;

      audioPrepRef.current = { clipId: next.id, ready: false };
      other.pause();
      other.volume = Math.max(0, Math.min(1, next.volume ?? 1));
      other.playbackRate = next.speed ?? 1;
      const onSeeked = () => {
        other.removeEventListener("seeked", onSeeked);
        if (audioPrepRef.current?.clipId === next.id) audioPrepRef.current.ready = true;
      };
      other.addEventListener("seeked", onSeeked);
      try {
        other.currentTime = next.sourceInStart;
      } catch {
        audioPrepRef.current = null;
      }
    };
    sync();
    const unsub = useEditor.subscribe(sync);
    const id = window.setInterval(sync, 250);
    return () => {
      unsub();
      window.clearInterval(id);
      audioARef.current?.pause();
      audioBRef.current?.pause();
    };
  }, [videoRef, sourceUrl]);


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
    const pool = () =>
      [videoARef.current, videoBRef.current, videoCRef.current].filter(
        (el): el is HTMLVideoElement => Boolean(el),
      );
    if (!playing) {
      pool().forEach((el) => el.pause());
      videoPrepRef.current.clear();
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
    if (Math.abs(v.currentTime - startSource) > 0.05) {
      v.currentTime = startSource;
    }
    void v.play().catch(() => setPlaying(false));

    let activeId = startClip.id;
    const preps = videoPrepRef.current;

    /**
     * Reserva um decodificador livre e o posiciona no início do corte.
     * O preparo começa assim que o clipe atual entra em cena: o seek de um
     * arquivo grande pode levar mais de 1 s, tempo que uma janela curta não dá.
     */
    const prepare = (cur: HTMLVideoElement, next: (typeof clips0)[number]) => {
      if (preps.has(next.id)) return;
      const busy = new Set<HTMLVideoElement>([cur, ...[...preps.values()].map((p) => p.el)]);
      const free = pool().find((el) => !busy.has(el));
      if (!free) return;
      const entry = { el: free, ready: false };
      preps.set(next.id, entry);
      free.pause();
      free.muted = true;
      const onSeeked = () => {
        free.removeEventListener("seeked", onSeeked);
        entry.ready = true;
      };
      free.addEventListener("seeked", onSeeked);
      try {
        free.currentTime = next.sourceInStart;
      } catch {
        preps.delete(next.id);
      }
    };




    /** Salta para o próximo clipe da timeline sem pausar o elemento <video>. */
    const jumpTo = (cur: HTMLVideoElement, next: (typeof clips0)[number]) => {
      activeId = next.id;
      const rate = next.speed ?? 1;
      const contiguous = Math.abs(cur.currentTime - next.sourceInStart) <= 0.06;
      const prep = preps.get(next.id);



      if (!contiguous && prep && prep.ready) {

        // corte descontínuo: o decodificador reserva já está no ponto certo
        prep.el.playbackRate = rate;
        prep.el.muted = Boolean(next.muted);
        cur.pause();
        cur.muted = true;
        videoRef.current = prep.el;
        preps.delete(next.id);
        setCurrentTime(next.startTime + 0.001);
        void prep.el.play().catch(() => undefined);
        return;
      }

      if (prep) preps.delete(next.id);
      if (cur.playbackRate !== rate) cur.playbackRate = rate;
      if (!contiguous) cur.currentTime = next.sourceInStart;
      setCurrentTime(next.startTime + 0.001);
      if (cur.paused) void cur.play().catch(() => undefined);
    };

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const s = useEditor.getState();
      const cur = videoRef.current;
      if (!cur) return;
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
      if (cur.playbackRate !== speed) cur.playbackRate = speed;
      cur.muted = Boolean(clip.muted);
      // o navegador pode pausar por buffering/seek: retomamos sempre
      if (cur.paused && !cur.seeking) {
        void cur.play().catch(() => undefined);
      }

      const idx = clips.findIndex((c) => c.id === clip.id);
      const next = idx >= 0 ? clips[idx + 1] : undefined;
      const next2 = idx >= 0 ? clips[idx + 2] : undefined;
      const reachedEnd = cur.currentTime >= clip.sourceInEnd - 0.02 || (cur.ended && !cur.seeking);
      if (reachedEnd) {
        if (next) {
          jumpTo(cur, next);
          return;
        }
        setCurrentTime(clip.startTime + clip.duration);
        setPlaying(false);
        return;
      }
      // preparo imediato dos dois próximos cortes: o seek roda em paralelo
      const upcoming = new Set([next?.id, next2?.id].filter(Boolean) as string[]);
      preps.forEach((_, id) => {
        if (!upcoming.has(id)) preps.delete(id);
      });
      if (next && Math.abs(cur.currentTime - next.sourceInStart) > 0.06) prepare(cur, next);
      if (next2 && preps.get(next?.id ?? "")?.ready !== false) prepare(cur, next2);
      setCurrentTime(clip.startTime + (cur.currentTime - clip.sourceInStart) / speed);
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
            <>
              <video
                ref={(el) => {
                  videoARef.current = el;
                  if (el && !videoRef.current) videoRef.current = el;
                }}
                src={sourceUrl}
                playsInline
                className="pointer-events-none absolute h-px w-px opacity-0"
                style={{ left: 0, top: 0 }}
              />
              {/* decodificadores reserva: pré-posicionam os próximos cortes */}
              <video
                ref={videoBRef}
                src={sourceUrl}
                playsInline
                muted
                preload="auto"
                className="pointer-events-none absolute h-px w-px opacity-0"
                style={{ left: 0, top: 0 }}
              />
              <video
                ref={videoCRef}
                src={sourceUrl}
                playsInline
                muted
                preload="auto"
                className="pointer-events-none absolute h-px w-px opacity-0"
                style={{ left: 0, top: 0 }}
              />

              {/* faixa de áudio separada do vídeo (quando o usuário desanexa) */}
              <audio ref={audioARef} src={sourceUrl} className="hidden" />
              <audio ref={audioBRef} src={sourceUrl} className="hidden" />
            </>
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
