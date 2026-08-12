import { useState } from "react";
import { Crosshair, X } from "lucide-react";
import { useEditor, type Clip } from "@/state/editor-store";
import {
  CATEGORY_LABEL,
  DEFAULT_PARAMS,
  INTENSITY_LABEL,
  SPEED_LABEL,
  presetById,
  presetsFor,
  type EffectCategory,
  type IntensityName,
  type PresetParams,
  type SpeedName,
} from "@/lib/effect-presets";
import { cn } from "@/lib/utils";

const CATEGORIES: EffectCategory[] = ["zoom", "in", "out", "emphasis"];

function Chips({ clip }: { clip: Clip }) {
  const remove = useEditor((s) => s.removeEffectPreset);
  const update = useEditor((s) => s.updateEffectPresetParams);
  const [open, setOpen] = useState<string | null>(null);
  const applied = clip.effectPresets ?? [];
  if (applied.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {applied.map((inst) => {
          const def = presetById(inst.presetId);
          return (
            <span
              key={inst.id}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold",
                open === inst.id
                  ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                  : "border-[var(--border)] text-[var(--foreground)]",
              )}
            >
              <button onClick={() => setOpen(open === inst.id ? null : inst.id)}>
                {def?.label ?? inst.presetId}
                {inst.edited ? " (editado)" : ""}
              </button>
              <button
                onClick={() => remove(clip.id, inst.id)}
                aria-label={`Remover ${def?.label ?? "efeito"}`}
                className="text-[var(--muted-foreground)] hover:text-[var(--brand)]"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
      </div>

      {applied.map((inst) => {
        if (open !== inst.id) return null;
        const def = presetById(inst.presetId);
        if (!def) return null;
        return (
          <div key={inst.id} className="rounded-lg border border-[var(--border)] p-2">
            <Controls
              controls={def.controls}
              params={{ ...DEFAULT_PARAMS, ...inst.params }}
              onChange={(patch) => update(clip.id, inst.id, patch)}
            />
          </div>
        );
      })}
    </div>
  );
}

function Controls({
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
                  "flex-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold",
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
                  "flex-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold",
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
                  "flex-1 rounded-md border px-1.5 py-1 text-[10px] font-semibold",
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

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function EffectsSimplePanel({ clip }: { clip: Clip }) {
  const apply = useEditor((s) => s.applyEffectPreset);
  const pending = useEditor((s) => s.pendingEffectPreset);
  const setPending = useEditor((s) => s.setPendingEffectPreset);
  const currentTime = useEditor((s) => s.currentTime);
  const [params, setParams] = useState<PresetParams>(DEFAULT_PARAMS);
  const list = presetsFor(clip);
  const anchor = Math.max(0, Math.min(clip.duration, currentTime - clip.startTime));

  return (
    <div className="space-y-4">
      <Chips clip={clip} />

      <div className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-[11px] font-semibold text-[var(--muted-foreground)]">
        Aplicar na agulha:{" "}
        <span className="text-[var(--brand)]">{fmt(clip.startTime + anchor)}</span>
        <span className="text-[10px] font-normal"> (Saída sempre no fim do clipe)</span>
      </div>

      <Controls
        controls={["speed", "intensity", "zoomLevel", "duration"]}
        params={params}
        onChange={(patch) => setParams((p) => ({ ...p, ...patch }))}
      />


      {CATEGORIES.map((cat) => {
        const items = list.filter((p) => p.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat} className="space-y-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
              {CATEGORY_LABEL[cat]}
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {items.map((p) => {
                const armed = pending?.presetId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() =>
                      p.needsPoint
                        ? setPending(armed ? null : { presetId: p.id, params })
                        : apply(clip.id, p.id, params)
                    }
                    className={cn(
                      "flex items-center gap-1 rounded-lg border px-2 py-2 text-left text-[11px] font-semibold transition",
                      armed
                        ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                        : "border-[var(--border)] hover:border-[var(--brand)] hover:text-[var(--brand)]",
                    )}
                  >
                    {p.needsPoint ? <Crosshair className="h-3 w-3 shrink-0" /> : null}
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="text-[10px] leading-relaxed text-[var(--muted-foreground)]">
        Clique num efeito para aplicá-lo. Nos efeitos de zoom, depois clique no ponto do vídeo que
        deve ficar em destaque. Para ajustes finos, use a aba Avançado.
      </p>
    </div>
  );
}
