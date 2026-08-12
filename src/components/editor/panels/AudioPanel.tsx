import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { findClip, useEditor } from "@/state/editor-store";
import {
  denoiseSamplesRnnoise,
  playAudioPreview,
  playSamples,
  renderMono48k,
} from "@/lib/audio-tools";
import { cn } from "@/lib/utils";

function Slider({
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--brand)]"
      />
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-[var(--muted-foreground)]">
        {suffix}
      </span>
    </div>
  );
}

/** Módulo de Áudio: volume, redução de ruído e fades do clipe selecionado. */
export function AudioPanel() {
  const tracks = useEditor((s) => s.tracks);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const sourceBlob = useEditor((s) => s.sourceBlob);
  const updateClip = useEditor((s) => s.updateClip);
  const clip = findClip(tracks, selectedClipId);
  const [playingMode, setPlayingMode] = useState<"raw" | "clean" | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  if (!clip || (clip.type !== "video" && clip.type !== "audio")) {
    return (
      <p className="text-xs text-[var(--muted-foreground)]">
        Selecione um clipe com áudio na timeline.
      </p>
    );
  }

  const preview = async (mode: "raw" | "clean") => {
    stopRef.current?.();
    if (playingMode === mode) {
      setPlayingMode(null);
      return;
    }
    if (!sourceBlob) return;
    const start = clip.sourceInStart;
    const end = Math.min(clip.sourceInEnd, start + 6);

    if (mode === "raw") {
      setPlayingMode("raw");
      stopRef.current = await playAudioPreview(sourceBlob, start, end, false);
      window.setTimeout(() => setPlayingMode(null), (end - start) * 1000 + 200);
      return;
    }

    // "Depois": RNNoise (WASM) em Web Worker, carregado sob demanda.
    setNotice(null);
    setProgress(0);
    try {
      const samples = await renderMono48k(sourceBlob, start, end);
      if (!samples) throw new Error("Não foi possível ler o áudio do clipe.");
      const clean = await denoiseSamplesRnnoise(samples, 48000, (p) => setProgress(p));
      setProgress(null);
      setPlayingMode("clean");
      stopRef.current = playSamples(clean, 48000);
      window.setTimeout(() => setPlayingMode(null), (end - start) * 1000 + 200);
    } catch (err) {
      console.warn("[rnnoise] fallback para filtro simples:", err);
      setProgress(null);
      setNotice("Versão avançada indisponível — usando o filtro simples.");
      setPlayingMode("clean");
      stopRef.current = await playAudioPreview(sourceBlob, start, end, true);
      window.setTimeout(() => setPlayingMode(null), (end - start) * 1000 + 200);
    }
  };

  const volume = clip.volume ?? 1;
  const maxFade = Math.max(0.1, clip.duration / 2);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">Volume</span>
        <Slider
          value={volume}
          min={0}
          max={2}
          step={0.01}
          suffix={`${Math.round(volume * 100)}%`}
          onChange={(v) => updateClip(clip.id, { volume: v })}
        />
      </div>

      <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={clip.denoise === true}
            onChange={(e) => updateClip(clip.id, { denoise: e.target.checked })}
            className="accent-[var(--brand)]"
          />
          Reduzir ruído de fundo
        </label>
        <div className="flex gap-1.5">
          {(["raw", "clean"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => void preview(mode)}
              disabled={!sourceBlob || progress !== null}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-semibold disabled:opacity-40",
                playingMode === mode
                  ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)]",
              )}
            >
              {playingMode === mode ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {mode === "raw" ? "Antes" : "Depois"}
            </button>
          ))}
        </div>
        {progress !== null && (
          <div className="space-y-1">
            <p className="text-[10px] text-[var(--muted-foreground)]">
              Carregando processador de áudio… {Math.round(progress * 100)}%
            </p>
            <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--border)]">
              <div
                className="h-full bg-[var(--brand)] transition-[width]"
                style={{ width: `${Math.max(4, progress * 100)}%` }}
              />
            </div>
          </div>
        )}
        {notice && <p className="text-[10px] text-[var(--brand)]">{notice}</p>}
        <p className="text-[10px] leading-relaxed text-[var(--muted-foreground)]">
          Prévia dos primeiros 6 segundos com RNNoise (IA local, roda no seu navegador). Na
          exportação é aplicada redução de ruído e normalização.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
          Fades
        </span>
        <div className="space-y-1.5">
          <span className="text-[11px] text-[var(--muted-foreground)]">Fade in</span>
          <Slider
            value={Math.min(clip.fadeIn ?? 0, maxFade)}
            min={0}
            max={maxFade}
            step={0.05}
            suffix={`${(clip.fadeIn ?? 0).toFixed(2)}s`}
            onChange={(v) => updateClip(clip.id, { fadeIn: v })}
          />
        </div>
        <div className="space-y-1.5">
          <span className="text-[11px] text-[var(--muted-foreground)]">Fade out</span>
          <Slider
            value={Math.min(clip.fadeOut ?? 0, maxFade)}
            min={0}
            max={maxFade}
            step={0.05}
            suffix={`${(clip.fadeOut ?? 0).toFixed(2)}s`}
            onChange={(v) => updateClip(clip.id, { fadeOut: v })}
          />
        </div>
      </div>
    </div>
  );
}
