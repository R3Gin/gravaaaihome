import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Download,
  Film,
  Loader2,
  Play,
  Pause,
  RotateCcw,
  Upload,
} from "lucide-react";
import { takeGifHandoff } from "@/lib/gif-handoff";
import { videoToGif, type GifQuality } from "@/lib/ffmpeg-convert";

const MAX_VIDEO_SECONDS = 15 * 60;
const MAX_CLIP_SECONDS = 15;

const QUALITIES: { id: GifQuality; label: string; hint: string }[] = [
  { id: "leve", label: "Leve", hint: "320px · 8 fps" },
  { id: "media", label: "Média", hint: "480px · 12 fps" },
  { id: "alta", label: "Alta qualidade", hint: "640px · 15 fps" },
];

const SPEEDS = [0.5, 1, 1.5, 2];

function fmt(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VideoToGif() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);

  const [speed, setSpeed] = useState(1);
  const [quality, setQuality] = useState<GifQuality>("media");

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [gifSize, setGifSize] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const gifUrlRef = useRef<string | null>(null);

  const clipDuration = Math.max(0, end - start);
  const tooLong = clipDuration > MAX_CLIP_SECONDS + 0.01;

  const resetGif = useCallback(() => {
    if (gifUrlRef.current) URL.revokeObjectURL(gifUrlRef.current);
    gifUrlRef.current = null;
    setGifUrl(null);
    setGifSize(0);
    setProgress(0);
  }, []);

  const loadBlob = useCallback(
    (file: Blob, name: string) => {
      setError(null);
      resetGif();
      const type = file.type || "";
      const isVideo = type.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(name);
      if (!isVideo) {
        setError("Arquivo não suportado. Envie um vídeo (MP4, WebM ou MOV).");
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      setLoading(true);
      setBlob(file);
      setFileName(name);
      setVideoUrl(url);
      setDuration(0);
      setStart(0);
      setEnd(0);
      setCurrent(0);
      setPlaying(false);
    },
    [resetGif],
  );

  useEffect(() => {
    const handoff = takeGifHandoff();
    if (handoff) loadBlob(handoff.blob, handoff.name);
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      if (gifUrlRef.current) URL.revokeObjectURL(gifUrlRef.current);
    };
  }, [loadBlob]);

  const onLoadedMetadata = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    let d = el.duration;
    if (!Number.isFinite(d) || d <= 0) {
      // WebM sem duração: força seek pro fim para descobrir.
      el.currentTime = 1e6;
      return;
    }
    setLoading(false);
    if (d > MAX_VIDEO_SECONDS) {
      setError("Vídeo acima de 15 minutos. Escolha um arquivo menor.");
      setVideoUrl(null);
      setBlob(null);
      setFileName(null);
      return;
    }
    d = Math.max(0.1, d);
    setDuration(d);
    setStart(0);
    setEnd(Math.min(MAX_CLIP_SECONDS, d));
  }, []);

  const onDurationChange = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (Number.isFinite(el.duration) && el.duration > 0 && duration === 0) {
      el.currentTime = 0;
      onLoadedMetadata();
    }
  }, [duration, onLoadedMetadata]);

  // Loop de reprodução dentro do trecho selecionado.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onTime = () => {
      setCurrent(el.currentTime);
      if (el.currentTime >= end - 0.02 && playing) {
        el.currentTime = start;
      }
    };
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [start, end, playing]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      if (el.currentTime < start || el.currentTime > end) el.currentTime = start;
      void el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }, [start, end]);

  const seek = useCallback((time: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = time;
    setCurrent(time);
  }, []);

  const posFromEvent = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || duration <= 0) return 0;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration],
  );

  const startDrag = useCallback(
    (handle: "start" | "end" | "playhead") => (event: React.PointerEvent) => {
      event.preventDefault();
      (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
      const move = (e: PointerEvent | React.PointerEvent) => {
        const t = posFromEvent("clientX" in e ? e.clientX : 0);
        if (handle === "playhead") {
          seek(t);
          return;
        }
        resetGif();
        if (handle === "start") {
          const next = Math.min(t, end - 0.2);
          setStart(Math.max(0, next));
          seek(Math.max(0, next));
        } else {
          const next = Math.max(t, start + 0.2);
          setEnd(Math.min(duration, next));
        }
      };
      move(event);
      const onMove = (e: PointerEvent) => move(e);
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [duration, end, start, posFromEvent, resetGif, seek],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      loadBlob(file, file.name);
    },
    [loadBlob],
  );

  const generate = useCallback(async () => {
    if (!blob || tooLong || clipDuration < 0.2) return;
    setGenerating(true);
    setProgress(0);
    setStage("Preparando…");
    setError(null);
    resetGif();
    try {
      const gif = await videoToGif(
        blob,
        { start, end, speed, quality },
        (r, s) => {
          setProgress(r);
          if (s) setStage(s);
        },
      );
      const url = URL.createObjectURL(gif);
      gifUrlRef.current = url;
      setGifUrl(url);
      setGifSize(gif.size);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Não foi possível gerar o GIF. Tente um trecho menor ou qualidade mais leve.",
      );
    } finally {
      setGenerating(false);
    }
  }, [blob, clipDuration, end, quality, resetGif, speed, start, tooLong]);

  const downloadGif = useCallback(() => {
    if (!gifUrl) return;
    const a = document.createElement("a");
    a.href = gifUrl;
    a.download = (fileName?.replace(/\.[^.]+$/, "") || "gravaai") + ".gif";
    a.click();
  }, [gifUrl, fileName]);

  const pct = useCallback(
    (t: number) => (duration > 0 ? (t / duration) * 100 : 0),
    [duration],
  );

  const sizeLabel = useMemo(
    () => (gifSize > 0 ? `${(gifSize / 1024 / 1024).toFixed(2)} MB` : ""),
    [gifSize],
  );

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div>
            <Link
              to="/"
              className="mb-2 inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar
            </Link>
            <h1 className="font-display text-2xl font-bold tracking-tight">Vídeo para GIF</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Transforme um trecho da sua gravação em GIF, direto no navegador.
            </p>
          </div>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--brand)]/15 text-[var(--brand)]">
            <Film className="h-6 w-6" />
          </span>
        </header>

        {error ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--brand)]/40 bg-[var(--brand)]/10 px-4 py-3 text-sm text-[var(--brand)]">
            <span>{error}</span>
            <button
              onClick={() => void generate()}
              disabled={generating || !blob}
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Tentar novamente
            </button>
          </div>
        ) : null}

        {!videoUrl ? (
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-14 text-center transition-colors ${
              dragOver
                ? "border-[var(--brand)] bg-[var(--brand)]/10"
                : "border-white/15 bg-[var(--surface)] hover:border-white/30"
            }`}
          >
            <Upload className="h-8 w-8 text-[var(--brand)]" />
            <div className="text-sm font-medium">Arraste um vídeo aqui</div>
            <div className="text-xs text-[var(--muted-foreground)]">
              MP4, WebM ou MOV · até 15 minutos
            </div>
            <span className="mt-2 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white">
              Selecionar arquivo
            </span>
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </label>
        ) : (
          <div className="space-y-5">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
              <video
                ref={videoRef}
                src={videoUrl}
                onLoadedMetadata={onLoadedMetadata}
                onDurationChange={onDurationChange}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                className="mx-auto max-h-[46vh] w-full object-contain"
                playsInline
              />
            </div>

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando vídeo…
              </div>
            ) : null}

            <div className="rounded-2xl border border-white/10 bg-[var(--surface)] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <button
                  onClick={togglePlay}
                  className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
                >
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {playing ? "Pausar" : "Reproduzir trecho"}
                </button>
                <div
                  className={`text-sm font-semibold ${
                    tooLong ? "text-[var(--brand)]" : "text-[var(--foreground)]"
                  }`}
                >
                  {clipDuration.toFixed(1)}s selecionados
                  <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">
                    máx. {MAX_CLIP_SECONDS}s
                  </span>
                </div>
              </div>

              <div
                ref={trackRef}
                onPointerDown={startDrag("playhead")}
                className="relative h-14 w-full cursor-pointer rounded-lg bg-black/50"
              >
                <div
                  className="absolute inset-y-0 rounded-md bg-[var(--brand)]/25 ring-1 ring-[var(--brand)]/60"
                  style={{ left: `${pct(start)}%`, width: `${pct(end - start)}%` }}
                />
                <div
                  onPointerDown={startDrag("start")}
                  className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize rounded-l bg-[var(--brand)]"
                  style={{ left: `${pct(start)}%` }}
                />
                <div
                  onPointerDown={startDrag("end")}
                  className="absolute inset-y-0 -ml-1.5 w-3 cursor-ew-resize rounded-r bg-[var(--brand)]"
                  style={{ left: `${pct(end)}%` }}
                />
                <div
                  className="pointer-events-none absolute inset-y-0 w-0.5 bg-white"
                  style={{ left: `${pct(current)}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-[var(--muted-foreground)]">
                <span>{fmt(start)}</span>
                <span>{fmt(duration)}</span>
              </div>

              {tooLong ? (
                <p className="mt-3 rounded-lg border border-[var(--brand)]/40 bg-[var(--brand)]/10 px-3 py-2 text-xs text-[var(--brand)]">
                  Trecho acima de {MAX_CLIP_SECONDS}s. Reduza a seleção para gerar o GIF.
                </p>
              ) : null}
            </div>

            <div className="grid gap-4 rounded-2xl border border-white/10 bg-[var(--surface)] p-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Velocidade
                </div>
                <div className="flex gap-2">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setSpeed(s);
                        resetGif();
                      }}
                      className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                        speed === s
                          ? "bg-[var(--brand)] font-semibold text-white"
                          : "bg-white/10 hover:bg-white/15"
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  Qualidade
                </div>
                <div className="flex flex-wrap gap-2">
                  {QUALITIES.map((q) => (
                    <button
                      key={q.id}
                      onClick={() => {
                        setQuality(q.id);
                        resetGif();
                      }}
                      title={q.hint}
                      className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                        quality === q.id
                          ? "bg-[var(--brand)] font-semibold text-white"
                          : "bg-white/10 hover:bg-white/15"
                      }`}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => void generate()}
                  disabled={generating || tooLong || clipDuration < 0.2}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Film className="h-4 w-4" />
                  )}
                  {generating ? "Gerando GIF…" : gifUrl ? "Gerar novamente" : "Gerar prévia do GIF"}
                </button>
                <button
                  onClick={() => {
                    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
                    urlRef.current = null;
                    setVideoUrl(null);
                    setBlob(null);
                    setFileName(null);
                    setDuration(0);
                    resetGif();
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
                >
                  <RotateCcw className="h-4 w-4" /> Trocar vídeo
                </button>
              </div>

              {generating ? (
                <div className="mt-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[var(--brand)] transition-[width]"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted-foreground)]">
                    {Math.round(progress * 100)}% — {stage || "processamento local"}
                  </div>
                </div>
              ) : null}

              {gifUrl ? (
                <div className="mt-5 space-y-3">
                  <div className="rounded-xl border border-white/10 bg-black p-3">
                    <img
                      src={gifUrl}
                      alt="Prévia do GIF gerado a partir do vídeo"
                      className="mx-auto max-h-[40vh] w-auto"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={downloadGif}
                      className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white"
                    >
                      <Download className="h-4 w-4" /> Baixar GIF
                    </button>
                    <span className="text-xs text-[var(--muted-foreground)]">{sizeLabel}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
