import { useState } from "react";
import { Crosshair, X } from "lucide-react";
import { clipAt, findClip, useEditor, type Clip } from "@/state/editor-store";
import {
  CATEGORY_LABEL,
  DEFAULT_PARAMS,
  presetById,
  presetsFor,
  type EffectCategory,
  type PresetParams,
} from "@/lib/effect-presets";
import { EffectControls, fmtTime } from "./EffectControls";
import { cn } from "@/lib/utils";

const CATEGORIES: EffectCategory[] = ["zoom", "in", "out", "emphasis"];

/** Chips dos efeitos já aplicados no projeto. */
function AppliedChips() {
  const effects = useEditor((s) => s.effects);
  const selectedEffectId = useEditor((s) => s.selectedEffectId);
  const selectEffect = useEditor((s) => s.selectEffect);
  const remove = useEditor((s) => s.removeEffectPreset);

  if (effects.length === 0) return null;

  return (
    <div className="space-y-2">
      <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
        Efeitos aplicados ({effects.length})
      </span>
      <div className="flex flex-wrap gap-1.5">
        {effects.map((inst) => {
          const def = presetById(inst.presetId);
          const open = selectedEffectId === inst.id;
          return (
            <span
              key={inst.id}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold",
                open
                  ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                  : "border-[var(--border)] text-[var(--foreground)]",
              )}
            >
              <button onClick={() => selectEffect(open ? null : inst.id)}>
                {def?.label ?? inst.presetId}
                <span className="ml-1 text-[10px] font-normal text-[var(--muted-foreground)]">
                  {fmtTime(inst.start)} – {fmtTime(inst.end)}
                </span>
              </button>
              <button
                onClick={() => remove("", inst.id)}
                aria-label={`Remover ${def?.label ?? "efeito"}`}
                className="text-[var(--muted-foreground)] hover:text-[var(--brand)]"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
      </div>
      <p className="text-[10px] leading-relaxed text-[var(--muted-foreground)]">
        Clique num efeito (aqui ou na faixa <strong>Efeitos</strong> da timeline) para ajustar os
        parâmetros no painel da direita.
      </p>
    </div>
  );
}

/** Galeria de presets prontos — módulo "Efeitos" da barra lateral. */
export function EffectsLibraryPanel() {
  const tracks = useEditor((s) => s.tracks);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const currentTime = useEditor((s) =>
    s.playing ? Math.floor(s.currentTime * 4) / 4 : s.currentTime,
  );
  const apply = useEditor((s) => s.applyEffectPreset);
  const pending = useEditor((s) => s.pendingEffectPreset);
  const setPending = useEditor((s) => s.setPendingEffectPreset);
  const [params, setParams] = useState<PresetParams>(DEFAULT_PARAMS);

  const target: Clip | null =
    findClip(tracks, selectedClipId) ?? clipAt(tracks, "video", currentTime);

  if (!target) {
    return (
      <p className="text-xs text-[var(--muted-foreground)]">
        Posicione a agulha sobre um clipe (ou selecione um) para aplicar efeitos prontos.
      </p>
    );
  }

  const list = presetsFor(target);

  return (
    <div className="space-y-4">
      <AppliedChips />

      <div className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-[11px] font-semibold text-[var(--muted-foreground)]">
        Aplicar na agulha: <span className="text-[var(--brand)]">{fmtTime(currentTime)}</span>
        <span className="block text-[10px] font-normal">Saída sempre no fim do clipe</span>
      </div>

      <EffectControls
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
                const armed = pending?.mode !== "repoint" && pending?.presetId === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() =>
                      p.needsPoint
                        ? setPending(armed ? null : { presetId: p.id, params })
                        : apply(target.id, p.id, params)
                    }
                    className={cn(
                      "flex items-center gap-1 rounded-lg border px-2 py-2 text-left text-[11px] font-semibold transition-colors",
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
        Cada efeito vira uma barra na faixa <strong>Efeitos</strong> da timeline, com tempo próprio:
        arraste para mudar de lugar e puxe as bordas para esticar. Nos efeitos de zoom, clique no
        ponto do vídeo que deve ficar em destaque.
      </p>
    </div>
  );
}
