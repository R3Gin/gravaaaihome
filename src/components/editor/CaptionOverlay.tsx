import { memo, useEffect, useRef, useState } from "react";
import { clipAt, useEditor, type Clip, type CaptionStyle } from "@/state/editor-store";
import {
  renderCaptionWords,
  typewriterText,
  toSeconds,
  quantizeProgress,
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

interface CaptionTextProps {
  clip: Clip;
  progress: number;
  cs: CaptionStyle;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}

/** camada isolada: só re-renderiza quando o progresso quantizado ou o estilo muda */
const CaptionText = memo(function CaptionText({
  clip,
  progress,
  cs,
  selected,
  onPointerDown,
}: CaptionTextProps) {
  const full = clip.textContent ?? "";
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
      className="pointer-events-none absolute inset-0"
      style={{
        zIndex: 20,
        willChange: "transform, opacity",
        contain: "layout paint",
      }}
      aria-live="polite"
    >
      <div
        onPointerDown={onPointerDown}
        className={cn(
          "pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-move px-3 py-1",
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
          // contorno leve via text-stroke (não anima, sem repaint por frame)
          WebkitTextStroke: cs.outline ? "0.03em rgba(0,0,0,0.85)" : undefined,
          willChange: "transform, opacity",
          contain: "layout paint",
        }}
      >
        {words ? (
          <span className="inline-flex flex-wrap justify-center gap-[0.28em]">
            {words.map((w, i) => (
              <span key={`${clip.id}-${i}`} style={{ display: "inline-block", ...w.style }}>
                {w.text}
              </span>
            ))}
          </span>
        ) : (
          typewriterText(full, progress) || "\u200b"
        )}
      </div>
    </div>
  );
});

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onStartDrag: (clipId: string) => void;
}

/**
 * Overlay de legenda isolado do Preview: mantém o próprio loop de tempo
 * (rAF durante a reprodução, eventos do <video> quando parado).
 */
export function CaptionOverlay({ videoRef, onStartDrag }: Props) {
  const captionStyle = useEditor((s) => s.captionStyle);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const select = useEditor((s) => s.select);

  const [active, setActive] = useState<Clip | null>(null);
  const [progress, setProgress] = useState(0);
  const activeRef = useRef<Clip | null>(null);
  const progressRef = useRef(0);

  useEffect(() => {
    const v = videoRef.current;
    let raf: number | null = null;

    /** tempo na linha do tempo do editor, derivado do <video> quando possível */
    const timelineTime = () => {
      const s = useEditor.getState();
      if (!v || !s.playing) return s.currentTime;
      const clip = clipAt(s.tracks, "video", s.currentTime);
      return clip
        ? clip.startTime + (v.currentTime - clip.sourceInStart) / (clip.speed ?? 1)
        : s.currentTime;
    };

    const inRange = (c: Clip, t: number) => {
      const start = toSeconds(c.startTime);
      const end = start + toSeconds(c.duration) + CAPTION_END_BUFFER;
      return t >= start && t <= end;
    };

    const update = () => {
      const t = timelineTime();
      const ended = !!v && v.ended;
      let clip = activeRef.current;

      // só re-escaneia a lista quando o clipe atual deixou de valer
      if (ended) clip = null;
      else if (!clip || !inRange(clip, t)) {
        const all = useEditor.getState().tracks.flatMap((tr) => tr.clips);
        clip = all.find((c) => c.isCaption && inRange(c, t)) ?? null;
      }

      if (clip !== activeRef.current) {
        activeRef.current = clip;
        setActive(clip);
      }
      if (clip) {
        const start = toSeconds(clip.startTime);
        const dur = Math.max(0.01, toSeconds(clip.duration));
        const q = quantizeProgress((t - start) / dur);
        if (q !== progressRef.current) {
          progressRef.current = q;
          setProgress(q);
        }
      }
    };

    const loop = () => {
      update();
      raf = requestAnimationFrame(loop);
    };

    // rAF só enquanto realmente toca; senão, eventos pontuais
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.playing !== prev.playing || s.currentTime !== prev.currentTime) {
        if (s.playing) {
          if (raf == null) raf = requestAnimationFrame(loop);
        } else {
          if (raf != null) cancelAnimationFrame(raf);
          raf = null;
          update();
        }
      }
    });

    const events = ["timeupdate", "seeked", "pause", "ended", "loadedmetadata"];
    if (v) events.forEach((e) => v.addEventListener(e, update));
    if (useEditor.getState().playing) raf = requestAnimationFrame(loop);
    update();

    return () => {
      unsub();
      if (raf != null) cancelAnimationFrame(raf);
      if (v) events.forEach((e) => v.removeEventListener(e, update));
    };
  }, [videoRef]);

  if (!active) return null;

  return (
    <CaptionText
      clip={active}
      progress={progress}
      cs={captionStyle}
      selected={active.id === selectedClipId}
      onPointerDown={(e) => {
        e.stopPropagation();
        select(active.id);
        onStartDrag(active.id);
      }}
    />
  );
}
