import { useEffect, useRef, useState } from "react";
import { Check, Download, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { exportProject } from "@/lib/export-project";
import {
  ExportAbortedError,
  QUALITY_PRESETS,
  type ExportQuality,
} from "@/lib/export-webcodecs";
import type { AspectRatio, CaptionStyle, MediaItem, Track } from "@/state/editor-store";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceBlob: Blob | null;
  tracks: Track[];
  aspect: AspectRatio;
  videoSize: { width: number; height: number };
  captionStyle: CaptionStyle;
  mediaLibrary: MediaItem[];
  duration: number;
  projectName: string;
}

type Phase = "config" | "running" | "done" | "error";

const QUALITIES = Object.keys(QUALITY_PRESETS) as ExportQuality[];

/** Estimativa de tamanho do arquivo com base no bitrate do preset. */
function estimateSize(quality: ExportQuality, size: { width: number; height: number }, dur: number) {
  const p = QUALITY_PRESETS[quality];
  const ratio = (size.width || 1280) / (size.height || 720);
  const h = p.height;
  const w = Math.round(h * ratio);
  const bitrate = w * h * p.fps * p.bitratePerPixel + 128_000;
  const bytes = (bitrate * Math.max(1, dur)) / 8;
  const mb = bytes / 1e6;
  return mb >= 1000 ? `~${(mb / 1000).toFixed(1)} GB` : `~${Math.max(1, Math.round(mb))} MB`;
}

export function ExportDialog({
  open,
  onOpenChange,
  sourceBlob,
  tracks,
  aspect,
  videoSize,
  captionStyle,
  mediaLibrary,
  duration,
  projectName,
}: Props) {
  const [quality, setQuality] = useState<ExportQuality>("rapida");
  const [fileName, setFileName] = useState(projectName || "projeto");
  const [phase, setPhase] = useState<Phase>("config");
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase("config");
    setProgress(0);
    setEta(null);
    setError(null);
    setFileName(projectName || "projeto");
  }, [open, projectName]);

  const running = phase === "running";

  const start = async () => {
    if (!sourceBlob) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("running");
    setProgress(0);
    setEta(null);
    setError(null);
    const startedAt = performance.now();

    try {
      const out = await exportProject(
        sourceBlob,
        tracks,
        aspect,
        videoSize,
        (ratio) => {
          setProgress(ratio);
          const elapsed = (performance.now() - startedAt) / 1000;
          if (ratio > 0.02 && elapsed > 2) {
            const left = Math.max(0, elapsed / ratio - elapsed);
            setEta(left > 90 ? `~${Math.ceil(left / 60)} min` : `~${Math.ceil(left)}s`);
          }
        },
        { quality, captionStyle, mediaLibrary, signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName.trim() || "projeto"}.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setProgress(1);
      setPhase("done");
    } catch (err) {
      if (err instanceof ExportAbortedError || controller.signal.aborted) {
        setPhase("config");
        setProgress(0);
        setEta(null);
        return;
      }
      setError(err instanceof Error ? err.message : "Não consegui exportar o vídeo.");
      setPhase("error");
    } finally {
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    setPhase("config");
    setProgress(0);
    setEta(null);
  };

  const close = () => {
    if (running) return;
    onOpenChange(false);
  };

  const pct = Math.round(progress * 100);

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent
        onInteractOutside={(e) => {
          if (running) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (running) e.preventDefault();
        }}

        className="max-w-md border-[var(--border)] bg-[var(--surface-2)]/80 backdrop-blur-xl"
      >
        <DialogHeader>
          <DialogTitle>Exportar vídeo</DialogTitle>
          <DialogDescription>
            Escolha a qualidade e o nome do arquivo. A exportação acontece no seu navegador.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[var(--muted-foreground)]">
              Nome do arquivo
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)]/60 px-3">
              <input
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                disabled={running}
                className="w-full bg-transparent py-2 text-sm outline-none disabled:opacity-50"
              />
              <span className="text-xs text-[var(--muted-foreground)]">.mp4</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-[var(--muted-foreground)]">Qualidade</label>
            <div className="grid gap-2">
              {QUALITIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuality(q)}
                  disabled={running}
                  className={cn(
                    "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                    quality === q
                      ? "border-[var(--brand)] bg-[var(--brand)]/15"
                      : "border-[var(--border)] hover:border-[var(--brand)]/50",
                  )}
                >
                  <span className="font-medium">{QUALITY_PRESETS[q].label}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {QUALITY_PRESETS[q].fps} fps · {estimateSize(q, videoSize, duration)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {running ? (
            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-[var(--background)]">
                <div
                  className="h-full rounded-full bg-[var(--brand)] transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                Exportando {pct}%{eta ? ` · restam ${eta}` : ""}
              </p>
            </div>
          ) : null}

          {phase === "done" ? (
            <p className="flex items-center gap-2 rounded-lg bg-[var(--brand)]/15 px-3 py-2 text-xs text-[var(--brand)]">
              <Check className="h-4 w-4" /> Vídeo exportado e baixado.
            </p>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-red-500/15 px-3 py-2 text-xs text-red-300">{error}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          {running ? (
            <button
              onClick={cancel}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold"
            >
              <X className="h-4 w-4" /> Cancelar exportação
            </button>
          ) : (
            <>
              <button
                onClick={close}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold"
              >
                Fechar
              </button>
              <button
                onClick={start}
                disabled={!sourceBlob}
                className="flex items-center gap-2 rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                {phase === "done" ? (
                  <Download className="h-4 w-4" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {phase === "done" ? "Exportar novamente" : "Exportar MP4"}
              </button>
            </>
          )}
        </div>

        {running ? (
          <p className="flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
            <Loader2 className="h-3 w-3 animate-spin" /> Mantenha esta aba aberta até terminar.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
