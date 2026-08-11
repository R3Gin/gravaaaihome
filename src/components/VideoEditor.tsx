import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Download,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import { exportEditedMp4, type EditSegment } from "@/lib/ffmpeg-convert";
import { cn } from "@/lib/utils";

const NEUTRAL = { brightness: 0, contrast: 1, saturation: 1 };
const THUMB_COUNT = 12;

function fmt(t: number) {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${cs}`;
}

function subtract(segments: EditSegment[], from: number, to: number): EditSegment[] {
  const out: EditSegment[] = [];
  for (const seg of segments) {
    if (to <= seg.start || from >= seg.end) {
      out.push(seg);
      continue;
    }
    if (from > seg.start) out.push({ start: seg.start, end: Math.min(from, seg.end) });
    if (to < seg.end) out.push({ start: Math.max(to, seg.start), end: seg.end });
  }
  return out.filter((s) => s.end - s.start > 0.05);
}

function intersect(segments: EditSegment[], from: number, to: number): EditSegment[] {
  return segments
    .map((s) => ({ start: Math.max(s.start, from), end: Math.min(s.end, to) }))
    .filter((s) => s.end - s.start > 0.05);
}

export function VideoEditor() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<EditSegment[]>([]);
  const [sel, setSel] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [filters, setFilters] = useState(NEUTRAL);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const sourceBlobRef = useRef<Blob | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<"start" | "end" | null>(null);

  useEffect(
    () => () => {
      if (srcUrl) URL.revokeObjectURL(srcUrl);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    },
    [srcUrl, resultUrl],
  );

  const cssFilter = useMemo(
    () =>
      `brightness(${(1 + filters.brightness).toFixed(3)}) contrast(${filters.contrast.toFixed(
        3,
      )}) saturate(${filters.saturation.toFixed(3)})`,
    [filters],
  );

  const removed = useMemo(() => {
    if (duration <= 0) return [] as EditSegment[];
    let gaps: EditSegment[] = [{ start: 0, end: duration }];
    for (const s of segments) gaps = subtract(gaps, s.start, s.end);
    return gaps;
  }, [segments, duration]);

  const keptDuration = useMemo(
    () => segments.reduce((acc, s) => acc + (s.end - s.start), 0),
    [segments],
  );

  const generateThumbs = useCallback(async (url: string) => {
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.preload = "auto";
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("thumb"));
    });
    const dur = v.duration;
    const canvas = document.createElement("canvas");
    const h = 64;
    const ratio = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9;
    canvas.height = h;
    canvas.width = Math.round(h * ratio);
    const ctx = canvas.getContext("2d")!;
    const out: string[] = [];
    for (let i = 0; i < THUMB_COUNT; i++) {
      const t = (dur * (i + 0.5)) / THUMB_COUNT;
      await new Promise<void>((resolve) => {
        v.onseeked = () => resolve();
        v.currentTime = Math.min(Math.max(0, t), Math.max(0, dur - 0.05));
      });
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      out.push(canvas.toDataURL("image/jpeg", 0.6));
    }
    v.src = "";
    return out;
  }, []);

  const loadFile = useCallback(
    async (file: File) => {
      const okType =
        file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name);
      if (!okType) {
        setError("Formato não suportado. Envie um arquivo de vídeo MP4.");
        return;
      }
      setError(null);
      setLoading(true);
      setResultUrl(null);
      setThumbs([]);
      setFilters(NEUTRAL);
      try {
        if (srcUrl) URL.revokeObjectURL(srcUrl);
        const url = URL.createObjectURL(file);
        sourceBlobRef.current = file;
        setSrcUrl(url);
        setFileName(file.name);
        const list = await generateThumbs(url).catch(() => [] as string[]);
        setThumbs(list);
      } catch (err) {
        console.error(err);
        setError("Não foi possível ler este vídeo. Tente outro arquivo MP4.");
      } finally {
        setLoading(false);
      }
    },
    [generateThumbs, srcUrl],
  );

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void loadFile(f);
    e.target.value = "";
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) void loadFile(f);
  };

  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    setDuration(v.duration);
    setSegments([{ start: 0, end: v.duration }]);
    setSel({ start: 0, end: v.duration });
  };

  // Pula os trechos removidos durante a pré-visualização.
  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    const gap = removed.find((g) => t >= g.start && t < g.end - 0.02);
    if (gap) {
      const next = segments.find((s) => s.start >= gap.end - 0.01);
      if (next) v.currentTime = next.start;
      else {
        v.pause();
        v.currentTime = segments[0]?.start ?? 0;
      }
    }
    setCurrent(v.currentTime);
  };

  const posFromEvent = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration],
  );

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(0, t), duration);
    setCurrent(v.currentTime);
  };

  const onHandleDown = (which: "start" | "end") => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = which;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onTrackMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const t = posFromEvent(e.clientX);
    setSel((prev) =>
      dragRef.current === "start"
        ? { start: Math.min(t, prev.end - 0.1), end: prev.end }
        : { start: prev.start, end: Math.max(t, prev.start + 0.1) },
    );
  };

  const onTrackUp = () => {
    dragRef.current = null;
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
    }
  };

  const keepSelection = () => {
    setSegments((s) => intersect(s, sel.start, sel.end));
    setResultUrl(null);
  };

  const removeSelection = () => {
    setSegments((s) => subtract(s, sel.start, sel.end));
    setResultUrl(null);
  };

  const resetCuts = () => {
    setSegments([{ start: 0, end: duration }]);
    setSel({ start: 0, end: duration });
    setResultUrl(null);
  };

  const runExport = async () => {
    const blob = sourceBlobRef.current;
    if (!blob || segments.length === 0) return;
    setExporting(true);
    setProgress(0);
    setError(null);
    try {
      const out = await exportEditedMp4(blob, segments, filters, (r) => setProgress(r));
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(out));
      setProgress(1);
    } catch (err) {
      console.error(err);
      setError("Falha ao exportar o vídeo. Tente novamente.");
    } finally {
      setExporting(false);
    }
  };

  const downloadResult = () => {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = `gravaai-editado.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-black/50 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--brand)]/15 text-[var(--brand)]">
              <Scissors className="h-4 w-4" />
            </span>
            <h1 className="font-display truncate text-sm font-bold tracking-tight sm:text-base">
              Editor Simplificado
            </h1>
            {fileName ? (
              <span className="hidden truncate text-xs text-[var(--muted-foreground)] sm:block">
                {fileName}
              </span>
            ) : null}
          </div>
          {srcUrl ? (
            <ActionButton
              tone="neutral"
              icon={<Upload className="h-4 w-4" />}
              onClick={() => inputRef.current?.click()}
            >
              Trocar vídeo
            </ActionButton>
          ) : null}
        </div>
      </header>

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/*"
        className="hidden"
        onChange={onPick}
      />

      <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6">
        {error ? (
          <div className="mb-4 rounded-lg border border-[var(--brand)]/40 bg-[var(--brand)]/10 px-4 py-3 text-sm text-[var(--brand)]">
            {error}
          </div>
        ) : null}

        {!srcUrl ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/15 bg-[var(--surface)] px-6 py-20 text-center"
          >
            {loading ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-[var(--brand)]" />
                <p className="text-sm text-[var(--muted-foreground)]">Carregando vídeo…</p>
              </>
            ) : (
              <>
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--brand)]/15 text-[var(--brand)]">
                  <Video className="h-7 w-7" />
                </span>
                <div>
                  <h2 className="font-display text-xl font-bold tracking-tight">
                    Importe um vídeo para começar
                  </h2>
                  <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                    Arraste um MP4 aqui ou selecione um arquivo. Tudo é processado no seu
                    navegador, sem upload.
                  </p>
                </div>
                <ActionButton
                  tone="record"
                  icon={<Upload className="h-4 w-4" />}
                  onClick={() => inputRef.current?.click()}
                >
                  Selecionar arquivo
                </ActionButton>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-black">
              <video
                ref={videoRef}
                src={srcUrl}
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
                onPause={() => setPlaying(false)}
                onPlay={() => setPlaying(true)}
                controls={false}
                playsInline
                style={{ filter: cssFilter }}
                className="aspect-video w-full bg-black object-contain"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <ActionButton
                tone="neutral"
                icon={playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                onClick={togglePlay}
              >
                {playing ? "Pausar" : "Reproduzir"}
              </ActionButton>
              <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
                {fmt(current)} / {fmt(duration)} · final: {fmt(keptDuration)}
              </span>
            </div>

            {/* Timeline */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div
                ref={trackRef}
                onPointerMove={onTrackMove}
                onPointerUp={onTrackUp}
                onPointerLeave={onTrackUp}
                onClick={(e) => {
                  if (dragRef.current) return;
                  seekTo(posFromEvent(e.clientX));
                }}
                className="relative h-16 w-full cursor-pointer select-none overflow-hidden rounded-lg border border-white/10 bg-black"
              >
                <div className="absolute inset-0 flex">
                  {(thumbs.length ? thumbs : Array.from({ length: THUMB_COUNT })).map((t, i) =>
                    typeof t === "string" ? (
                      <img
                        key={i}
                        src={t}
                        alt=""
                        draggable={false}
                        className="h-full flex-1 object-cover opacity-80"
                      />
                    ) : (
                      <div key={i} className="h-full flex-1 bg-[var(--surface-2)]" />
                    ),
                  )}
                </div>

                {/* Trechos removidos */}
                {removed.map((g, i) => (
                  <div
                    key={`gap-${i}`}
                    className="absolute inset-y-0 bg-[var(--brand)]/45 backdrop-grayscale"
                    style={{ left: `${pct(g.start)}%`, width: `${pct(g.end - g.start)}%` }}
                  >
                    <div className="h-full w-full border-x border-[var(--brand)]" />
                  </div>
                ))}

                {/* Seleção */}
                <div
                  className="absolute inset-y-0 border-y-2 border-white/70 bg-white/10"
                  style={{ left: `${pct(sel.start)}%`, width: `${pct(sel.end - sel.start)}%` }}
                />
                {(["start", "end"] as const).map((which) => (
                  <div
                    key={which}
                    onPointerDown={onHandleDown(which)}
                    className="absolute inset-y-0 z-10 -ml-2 w-4 cursor-ew-resize touch-none"
                    style={{ left: `${pct(which === "start" ? sel.start : sel.end)}%` }}
                    aria-label={which === "start" ? "Início da seleção" : "Fim da seleção"}
                  >
                    <div className="mx-auto h-full w-1.5 rounded-full bg-white shadow-lg" />
                  </div>
                ))}

                {/* Playhead */}
                <div
                  className="pointer-events-none absolute inset-y-0 w-0.5 bg-[var(--info,#3b82f6)]"
                  style={{ left: `${pct(current)}%` }}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-[var(--muted-foreground)]">
                  Seleção: {fmt(sel.start)} → {fmt(sel.end)}
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                  <ActionButton
                    tone="neutral"
                    icon={<Scissors className="h-4 w-4" />}
                    onClick={keepSelection}
                  >
                    Cortar (manter seleção)
                  </ActionButton>
                  <ActionButton
                    tone="neutral"
                    icon={<Trash2 className="h-4 w-4" />}
                    onClick={removeSelection}
                  >
                    Remover seleção
                  </ActionButton>
                  <ActionButton
                    tone="neutral"
                    icon={<RotateCcw className="h-4 w-4" />}
                    onClick={resetCuts}
                  >
                    Desfazer cortes
                  </ActionButton>
                </div>
              </div>
            </div>

            {/* Ajustes de imagem */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-sm font-bold tracking-tight">
                  Ajustes de imagem
                </h2>
                <ActionButton
                  tone="neutral"
                  icon={<RotateCcw className="h-4 w-4" />}
                  onClick={() => setFilters(NEUTRAL)}
                >
                  Resetar
                </ActionButton>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {(
                  [
                    { key: "brightness", label: "Brilho", min: -0.5, max: 0.5, step: 0.01 },
                    { key: "contrast", label: "Contraste", min: 0.5, max: 2, step: 0.01 },
                    { key: "saturation", label: "Saturação", min: 0, max: 2.5, step: 0.01 },
                  ] as const
                ).map((f) => (
                  <label key={f.key} className="block">
                    <span className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                      {f.label}
                      <span className="tabular-nums">{filters[f.key].toFixed(2)}</span>
                    </span>
                    <input
                      type="range"
                      min={f.min}
                      max={f.max}
                      step={f.step}
                      value={filters[f.key]}
                      onChange={(e) =>
                        setFilters((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))
                      }
                      className="mt-2 w-full accent-[var(--brand)]"
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Exportar */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-center gap-3">
                <ActionButton
                  tone="record"
                  icon={
                    exporting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Scissors className="h-4 w-4" />
                    )
                  }
                  onClick={runExport}
                  disabled={exporting || segments.length === 0}
                >
                  {exporting ? "Processando…" : "Exportar MP4"}
                </ActionButton>
                {resultUrl ? (
                  <ActionButton
                    tone="download"
                    icon={<Download className="h-4 w-4" />}
                    onClick={downloadResult}
                  >
                    Baixar resultado
                  </ActionButton>
                ) : null}
                <span className="text-xs text-[var(--muted-foreground)]">
                  Processamento 100% local, sem upload.
                </span>
              </div>
              {exporting || progress > 0 ? (
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div
                    className={cn("h-full bg-[var(--brand)] transition-all")}
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              ) : null}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
