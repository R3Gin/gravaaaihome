import {
  INTENSITY_LABEL,
  SPEED_LABEL,
  type IntensityName,
  type PresetParams,
  type SpeedName,
} from "@/lib/effect-presets";
import { cn } from "@/lib/utils";

/** Controles simples compartilhados (velocidade / intensidade / zoom / duração). */
export function EffectControls({
  controls,
  params,
  onChange,
}: {
  controls: string[];
  params: PresetParams;
  onChange: (patch: PresetParams) => void;
}) {
  return (
    <div className="space-y-2">
      {controls.includes("speed") ? (
        <div className="space-y-1">
          <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">Velocidade</span>
          <div className="flex gap-1">
            {(["slow", "medium", "fast"] as SpeedName[]).map((s) => (
              <button
                key={s}
                onClick={() => onChange({ speed: s })}
                className={cn(
                  "flex-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold transition-colors",
                  params.speed === s
                    ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)]",
                )}
              >
                {SPEED_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {controls.includes("intensity") ? (
        <div className="space-y-1">
          <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">Intensidade</span>
          <div className="flex gap-1">
            {(["subtle", "medium", "strong"] as IntensityName[]).map((s) => (
              <button
                key={s}
                onClick={() => onChange({ intensity: s })}
                className={cn(
                  "flex-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold transition-colors",
                  params.intensity === s
                    ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)]",
                )}
              >
                {INTENSITY_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {controls.includes("zoomLevel") ? (
        <div className="space-y-1">
          <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">Zoom</span>
          <div className="flex gap-1">
            {[1.2, 1.5, 2].map((z) => (
              <button
                key={z}
                onClick={() => onChange({ zoomLevel: z })}
                className={cn(
                  "flex-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold transition-colors",
                  params.zoomLevel === z
                    ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                    : "border-[var(--border)] text-[var(--muted-foreground)]",
                )}
              >
                {z}x
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {controls.includes("duration") ? (
        <label className="block space-y-1">
          <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">
            Tempo com zoom: {(params.duration ?? 2).toFixed(1)}s
          </span>
          <input
            type="range"
            min={1}
            max={5}
            step={0.5}
            value={params.duration ?? 2}
            onChange={(e) => onChange({ duration: Number(e.target.value) })}
            className="w-full accent-[var(--brand)]"
          />
        </label>
      ) : null}
    </div>
  );
}

export function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
