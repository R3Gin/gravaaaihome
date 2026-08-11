import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { findClip, useEditor } from "@/state/editor-store";
import { playAudioPreview } from "@/lib/audio-tools";
import { cn } from "@/lib/utils";

function AudioSection({ clipId }: { clipId: string }) {
  const tracks = useEditor((s) => s.tracks);
  const sourceBlob = useEditor((s) => s.sourceBlob);
  const updateClip = useEditor((s) => s.updateClip);
  const clip = findClip(tracks, clipId);
  const [playingMode, setPlayingMode] = useState<"raw" | "clean" | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopRef.current?.(), []);

  if (!clip) return null;

  const preview = async (mode: "raw" | "clean") => {
    stopRef.current?.();
    if (playingMode === mode) {
      setPlayingMode(null);
      return;
    }
    if (!sourceBlob) return;
    setPlayingMode(mode);
    const start = clip.sourceInStart;
    const end = Math.min(clip.sourceInEnd, start + 6);
    stopRef.current = await playAudioPreview(sourceBlob, start, end, mode === "clean");
    window.setTimeout(() => setPlayingMode(null), (end - start) * 1000 + 200);
  };

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
      <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
        Áudio
      </span>
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
            disabled={!sourceBlob}
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
      <p className="text-[10px] leading-relaxed text-[var(--muted-foreground)]">
        Prévia dos primeiros 6 segundos do clipe. Na exportação é aplicado filtro passa-alta,
        redução de ruído e normalização.
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">{label}</span>
      {children}
    </label>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
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
      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-[var(--muted-foreground)]">
        {value.toFixed(2)}
      </span>
    </div>
  );
}

export function Inspector() {
  const tracks = useEditor((s) => s.tracks);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const currentTime = useEditor((s) => s.currentTime);
  const updateClip = useEditor((s) => s.updateClip);
  const addZoomKeyframe = useEditor((s) => s.addZoomKeyframe);
  const removeZoomKeyframe = useEditor((s) => s.removeZoomKeyframe);
  const clip = findClip(tracks, selectedClipId);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface-2)]">
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-3 text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
        {clip ? `Clipe · ${clip.type}` : "Propriedades"}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {!clip ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            Selecione um clipe na timeline para editar suas propriedades.
          </p>
        ) : null}

        {clip?.type === "video" ? (
          <>
            <Row label="Brilho">
              <Slider
                value={clip.brightness ?? 0}
                min={-0.5}
                max={0.5}
                step={0.01}
                onChange={(v) => updateClip(clip.id, { brightness: v })}
              />
            </Row>
            <Row label="Contraste">
              <Slider
                value={clip.contrast ?? 1}
                min={0.5}
                max={2}
                step={0.01}
                onChange={(v) => updateClip(clip.id, { contrast: v })}
              />
            </Row>
            <Row label="Saturação">
              <Slider
                value={clip.saturation ?? 1}
                min={0}
                max={2.5}
                step={0.01}
                onChange={(v) => updateClip(clip.id, { saturation: v })}
              />
            </Row>
            <Row label="Velocidade">
              <Slider
                value={clip.speed ?? 1}
                min={0.5}
                max={2}
                step={0.05}
                onChange={(v) => {
                  const oldSpeed = clip.speed ?? 1;
                  const duration = (clip.duration * oldSpeed) / v;
                  updateClip(clip.id, { speed: v, duration });
                }}
              />
            </Row>
            <AudioSection clipId={clip.id} />
            <Row label="Volume">
              <Slider
                value={clip.volume ?? 1}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => updateClip(clip.id, { volume: v })}
              />
            </Row>
            <Row label="Transição de entrada">
              <div className="flex gap-1.5">
                {(["none", "fade", "slide"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => updateClip(clip.id, { transition: k })}
                    className={cn(
                      "flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold",
                      (clip.transition ?? "none") === k
                        ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                        : "border-[var(--border)] text-[var(--muted-foreground)]",
                    )}
                  >
                    {k === "none" ? "Corte" : k === "fade" ? "Fade" : "Slide"}
                  </button>
                ))}
              </div>
            </Row>
            <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold">Zoom com keyframes</span>
                <button
                  onClick={() => addZoomKeyframe(clip.id, currentTime)}
                  className="rounded-md bg-[var(--brand)] px-2 py-1 text-[11px] font-semibold text-white"
                >
                  + Keyframe
                </button>
              </div>
              {(clip.zoomKeyframes ?? []).length === 0 ? (
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  Posicione o playhead e adicione pontos de zoom.
                </p>
              ) : (
                (clip.zoomKeyframes ?? []).map((k, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-10 text-[11px] tabular-nums">{k.time.toFixed(1)}s</span>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.05}
                      value={k.scale}
                      onChange={(e) => {
                        const keys = [...(clip.zoomKeyframes ?? [])];
                        keys[i] = { ...k, scale: Number(e.target.value) };
                        updateClip(clip.id, { zoomKeyframes: keys });
                      }}
                      className="w-full accent-[var(--brand)]"
                    />
                    <button
                      onClick={() => removeZoomKeyframe(clip.id, i)}
                      className="text-[11px] text-[var(--muted-foreground)]"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        ) : null}

        {clip?.type === "text" ? (
          <>
            <Row label="Texto">
              <textarea
                value={clip.textContent ?? ""}
                onChange={(e) => updateClip(clip.id, { textContent: e.target.value })}
                rows={3}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
              />
            </Row>
            <Row label="Tamanho da fonte">
              <Slider
                value={clip.fontSize ?? 48}
                min={16}
                max={140}
                step={1}
                onChange={(v) => updateClip(clip.id, { fontSize: v })}
              />
            </Row>
            <Row label="Cor">
              <input
                type="color"
                value={clip.color ?? "#ffffff"}
                onChange={(e) => updateClip(clip.id, { color: e.target.value })}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-transparent"
              />
            </Row>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={clip.background !== false}
                onChange={(e) => updateClip(clip.id, { background: e.target.checked })}
                className="accent-[var(--brand)]"
              />
              Fundo atrás do texto
            </label>
          </>
        ) : null}

        {clip?.type === "overlay" ? (
          <>
            <p className="text-xs text-[var(--muted-foreground)]">
              {clip.overlayKind === "blur"
                ? "Arraste e redimensione a área desfocada no preview."
                : "Arraste o destaque no preview para escolher a área iluminada."}
            </p>
            <Row label={clip.overlayKind === "blur" ? "Intensidade do blur" : "Escurecimento"}>
              <Slider
                value={clip.strength ?? (clip.overlayKind === "blur" ? 12 : 0.7)}
                min={clip.overlayKind === "blur" ? 2 : 0.1}
                max={clip.overlayKind === "blur" ? 40 : 0.95}
                step={clip.overlayKind === "blur" ? 1 : 0.05}
                onChange={(v) => updateClip(clip.id, { strength: v })}
              />
            </Row>
          </>
        ) : null}
      </div>
    </aside>
  );
}
