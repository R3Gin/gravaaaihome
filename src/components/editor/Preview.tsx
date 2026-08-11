import { useCallback, useEffect, useRef, useState } from "react";
import {
  clipAt,
  clipsAt,
  useEditor,
  zoomAt,
  type AspectRatio,
  type Clip,
} from "@/state/editor-store";
import { resolveClip } from "@/lib/keyframes";
import {
  renderCaptionWords,
  typewriterText,
  toSeconds,
  CAPTION_END_BUFFER,
} from "@/lib/caption-styles";
import { cn } from "@/lib/utils";

/** #rrggbb + alpha => rgba() */
function withAlpha(hex: string, alpha: number) {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}


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
  const tracks = useEditor((s) => s.tracks);
  const currentTime = useEditor((s) => s.currentTime);
  const playing = useEditor((s) => s.playing);
  const aspect = useEditor((s) => s.aspect);
  const captionStyle = useEditor((s) => s.captionStyle);

  const selectedClipId = useEditor((s) => s.selectedClipId);
  const setAspect = useEditor((s) => s.setAspect);
  const setCurrentTime = useEditor((s) => s.setCurrentTime);
  const setPlaying = useEditor((s) => s.setPlaying);
  const select = useEditor((s) => s.select);
  const updateClipLive = useEditor((s) => s.updateClipLive);
  const commit = useEditor((s) => s.commit);

  const stageRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<{ id: string; kind: "move" | "resize" } | null>(null);

  const [mediaTime, setMediaTime] = useState(0);
  const [ended, setEnded] = useState(false);

  const rawVideoClip = clipAt(tracks, "video", currentTime);
  const videoClip = rawVideoClip ? resolveClip(rawVideoClip, currentTime) : null;
  const textClips = clipsAt(tracks, "text", currentTime)
    .filter((c) => !c.isCaption)
    .map((c) => resolveClip(c, currentTime));
  const overlayClips = clipsAt(tracks, "overlay", currentTime).map((c) => resolveClip(c, currentTime));

  /* --- sincronia das legendas: fonte da verdade é o <video> (timeupdate/seek) --- */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => {
      setEnded(false);
      const s = useEditor.getState();
      const clip = clipAt(s.tracks, "video", s.currentTime);
      setMediaTime(
        clip
          ? clip.startTime + (v.currentTime - clip.sourceInStart) / (clip.speed ?? 1)
          : s.currentTime,
      );
    };
    const onEnded = () => setEnded(true);
    const events = ["timeupdate", "seeked", "seeking", "play", "pause", "loadedmetadata"];
    events.forEach((e) => v.addEventListener(e, sync));
    v.addEventListener("ended", onEnded);
    sync();
    return () => {
      events.forEach((e) => v.removeEventListener(e, sync));
      v.removeEventListener("ended", onEnded);
    };
  }, [videoRef, sourceUrl]);

  /* legenda ativa: apenas o segmento que contém o tempo atual */
  const captionTime = playing ? mediaTime : currentTime;
  const activeCaption = ended
    ? null
    : (tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.isCaption)
        .sort((a, b) => toSeconds(a.startTime) - toSeconds(b.startTime))
        .find((c) => {
          const start = toSeconds(c.startTime);
          const end = start + toSeconds(c.duration) + CAPTION_END_BUFFER;
          return captionTime >= start && captionTime <= end;
        }) ?? null);



  /* --- seek quando o playhead muda fora da reprodução --- */
  useEffect(() => {
    const v = videoRef.current;
    if (!v || playing) return;
    const clip = clipAt(useEditor.getState().tracks, "video", currentTime);
    if (!clip) return;
    const speed = clip.speed ?? 1;
    const target = clip.sourceInStart + (currentTime - clip.startTime) * speed;
    if (Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
  }, [currentTime, playing, videoRef]);

  /* --- diagnóstico de travamentos do elemento <video> --- */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const log = (e: Event) => {
      if (e.type === "error") console.error("[editor] video error", v.error);
      else if (import.meta.env.DEV) console.debug("[editor] video", e.type, v.currentTime);
    };
    const events = ["pause", "stalled", "waiting", "error", "ended", "suspend"];
    events.forEach((t) => v.addEventListener(t, log));
    return () => events.forEach((t) => v.removeEventListener(t, log));
  }, [videoRef, sourceUrl]);

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
      // o navegador pode pausar sozinho (troca de aba, buffer): retoma
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


  /* --- arraste de texto / overlay dentro do preview --- */
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

  const zoomStyle = (clip: Clip | null) => {
    if (!clip) return undefined;
    const z = zoomAt(clip, currentTime - clip.startTime);
    const scale = z.scale * (clip.scale ?? 1);
    const rotation = clip.rotation ?? 0;
    const parts: string[] = [];
    if (scale !== 1) parts.push(`scale(${scale})`);
    if (rotation) parts.push(`rotate(${rotation}deg)`);
    if (z.x || z.y) parts.push(`translate(${z.x * 100}%, ${z.y * 100}%)`);
    return {
      transform: parts.length ? parts.join(" ") : undefined,
      opacity: clip.opacity ?? 1,
    };
  };

  const filterStyle = videoClip
    ? {
        filter: `brightness(${1 + (videoClip.brightness ?? 0)}) contrast(${videoClip.contrast ?? 1}) saturate(${videoClip.saturation ?? 1})`,
        objectPosition: `${50 + (videoClip.position?.x ?? 0) * 50}% ${50 + (videoClip.position?.y ?? 0) * 50}%`,
      }
    : undefined;

  const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio ?? 16 / 9;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--background)]">
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div
          ref={stageRef}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onClick={(e) => {
            if (e.target === stageRef.current) select(null);
          }}
          className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-black shadow-lg"
          style={{
            aspectRatio: String(ratio),
            containerType: "size",
            width: "min(100%, 1100px)",
            maxWidth: "100%",
            maxHeight: "100%",
            margin: "auto",
          }}
        >
          {sourceUrl ? (
            <video
              ref={videoRef}
              src={sourceUrl}
              playsInline
              className="h-full w-full object-contain"
              style={{ ...filterStyle, ...zoomStyle(videoClip) }}
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-sm text-[var(--muted-foreground)]">
              Nenhum vídeo carregado
            </div>
          )}

          {overlayClips.map((clip) => {
            const r = clip.rect ?? { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
            const selected = clip.id === selectedClipId;
            const base = {
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
            } as const;
            return (
              <div
                key={clip.id}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  select(clip.id);
                  dragRef.current = { id: clip.id, kind: "move" };
                }}
                className={cn(
                  "absolute cursor-move",
                  selected && "outline outline-2 outline-[var(--brand)]",
                )}
                style={{
                  ...base,
                  opacity: clip.opacity ?? 1,
                  backdropFilter:
                    clip.overlayKind === "blur" ? `blur(${clip.strength ?? 12}px)` : undefined,
                  borderRadius: clip.overlayKind === "spotlight" ? "9999px" : undefined,
                  boxShadow:
                    clip.overlayKind === "spotlight"
                      ? `0 0 0 9999px rgba(0,0,0,${clip.strength ?? 0.7})`
                      : undefined,
                }}
              >
                {selected ? (
                  <span
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      dragRef.current = { id: clip.id, kind: "resize" };
                    }}
                    className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm bg-[var(--brand)]"
                  />
                ) : null}
              </div>
            );
          })}

          {textClips.map((clip) => {
            const selected = clip.id === selectedClipId;

            if (clip.isCaption) {
              const progress = Math.max(
                0,
                Math.min(1, (currentTime - clip.startTime) / Math.max(0.01, clip.duration)),
              );
              const full = clip.textContent ?? "";
              const cs = captionStyle;
              const words =
                cs.anim === "typewriter"
                  ? null
                  : renderCaptionWords(cs.anim, full, progress, {
                      color: cs.color,
                      highlight: cs.highlight,
                      wordByWord: cs.wordByWord,
                    });
              return (
                <div
                  key={clip.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    select(clip.id);
                    dragRef.current = { id: clip.id, kind: "move" };
                  }}
                  className={cn(
                    "absolute -translate-x-1/2 -translate-y-1/2 cursor-move px-3 py-1",
                    selected && "outline outline-2 outline-[var(--brand)]",
                  )}
                  style={{
                    left: `${(clip.position?.x ?? 0.5) * 100}%`,
                    top: `${(clip.position?.y ?? 0.85) * 100}%`,
                    maxWidth: "88%",
                    opacity: clip.opacity ?? 1,
                    textAlign: cs.align,
                    fontFamily: cs.fontFamily,
                    fontWeight: cs.bold ? 800 : 500,
                    fontStyle: cs.italic ? "italic" : "normal",
                    color: cs.color,
                    fontSize: `${(cs.fontSize / 720) * 100}cqh`,
                    lineHeight: 1.2,
                    borderRadius: "0.4em",
                    background: cs.background ? withAlpha(cs.highlight, cs.bgOpacity) : undefined,
                    WebkitTextStroke: cs.outline ? "0.03em rgba(0,0,0,0.85)" : undefined,
                    textShadow: cs.outline ? "0 0.04em 0.12em rgba(0,0,0,0.7)" : undefined,
                  }}
                >
                  {words ? (
                    <span className="inline-flex flex-wrap justify-center gap-[0.28em]">
                      {words.map((w, i) => (
                        <span
                          key={`${clip.id}-${i}`}
                          style={{ display: "inline-block", ...w.style }}
                        >
                          {w.text}
                        </span>
                      ))}
                    </span>
                  ) : (
                    (typewriterText(full, progress) || "\u200b")
                  )}
                </div>
              );
            }

            const reveal = Math.max(0, Math.min(1, clip.reveal ?? 1));
            const mode = clip.revealMode ?? "none";
            const full = clip.textContent ?? "";
            const shown =
              mode === "typewriter" ? full.slice(0, Math.round(full.length * reveal)) : full;
            const blur = clip.blur ?? 0;
            const scale = clip.scale ?? 1;
            return (
              <div
                key={clip.id}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  select(clip.id);
                  dragRef.current = { id: clip.id, kind: "move" };
                }}
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-1/2 cursor-move whitespace-pre px-3 py-1 font-semibold",
                  clip.background !== false && "rounded-md bg-black/55",
                  selected && "outline outline-2 outline-[var(--brand)]",
                )}
                style={{
                  left: `${(clip.position?.x ?? 0.5) * 100}%`,
                  top: `${(clip.position?.y ?? 0.82) * 100}%`,
                  opacity: clip.opacity ?? 1,
                  rotate: `${clip.rotation ?? 0}deg`,
                  scale: String(scale),
                  filter: blur > 0.01 ? `blur(${blur}px)` : undefined,
                  clipPath:
                    mode === "wipe" ? `inset(0 ${(1 - reveal) * 100}% 0 0)` : undefined,
                  color: clip.color ?? "#fff",
                  fontSize: `${((clip.fontSize ?? 48) / 720) * 100}cqh`,
                }}
              >
                {mode === "typewriter" ? shown || "\u200b" : full}
              </div>
            );
          })}


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
