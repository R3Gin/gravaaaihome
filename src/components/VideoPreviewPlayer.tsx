// Player compacto para pré-visualizar a gravação recém-finalizada.
// Usa direto o Blob URL do MediaRecorder/conversor — nada é reprocessado.

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";

function fmt(sec: number) {
  if (!Number.isFinite(sec)) return "00:00";
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function VideoPreviewPlayer({
  src,
  className,
  ownerDocument,
}: {
  src: string;
  className?: string;
  ownerDocument?: Document;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.volume = volume;
  }, [volume]);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const restart = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play();
  }, []);

  const fullscreen = useCallback(() => {
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!v) return;
    if (v.requestFullscreen) void v.requestFullscreen().catch(() => {});
    else v.webkitEnterFullscreen?.();
  }, []);

  const doc = ownerDocument;
  const canFullscreen =
    typeof document !== "undefined" && (doc ?? document).fullscreenEnabled !== false;

  return (
    <div className={className}>
      <video
        ref={videoRef}
        src={src}
        playsInline
        className="w-full rounded-lg bg-black"
        style={{ maxHeight: "50vh" }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onClick={toggle}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pausar" : "Reproduzir"}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--brand)] text-white"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">
          {fmt(current)} / {fmt(duration)}
        </span>
        <input
          type="range"
          min={0}
          max={Number.isFinite(duration) && duration > 0 ? duration : 0}
          step={0.05}
          value={current}
          onChange={(e) => {
            const v = videoRef.current;
            if (v) v.currentTime = Number(e.target.value);
          }}
          aria-label="Progresso"
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--brand)]"
        />
        <button
          type="button"
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            v.muted = !v.muted;
            setMuted(v.muted);
          }}
          aria-label={muted ? "Ativar som" : "Mutar"}
          className="text-[var(--muted-foreground)] hover:text-white"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Volume"
          className="h-1.5 w-16 cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--brand)]"
        />
        <button
          type="button"
          onClick={restart}
          aria-label="Assistir novamente"
          className="text-[var(--muted-foreground)] hover:text-white"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        {canFullscreen && (
          <button
            type="button"
            onClick={fullscreen}
            aria-label="Tela cheia"
            className="text-[var(--muted-foreground)] hover:text-white"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
