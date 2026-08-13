import { Crosshair, Trash2 } from "lucide-react";
import { useEditor } from "@/state/editor-store";
import { DEFAULT_PARAMS, presetById } from "@/lib/effect-presets";
import { EffectControls, fmtTime } from "./EffectControls";
import { cn } from "@/lib/utils";

/** Painel direito quando um efeito da timeline está selecionado. */
export function EffectInspector({ effectId }: { effectId: string }) {
  const effect = useEditor((s) => s.effects.find((e) => e.id === effectId) ?? null);
  const update = useEditor((s) => s.updateEffectPresetParams);
  const remove = useEditor((s) => s.removeEffectPreset);
  const resize = useEditor((s) => s.resizeEffect);
  const pending = useEditor((s) => s.pendingEffectPreset);
  const setPending = useEditor((s) => s.setPendingEffectPreset);

  if (!effect) return null;
  const def = presetById(effect.presetId);
  const repointing = pending?.mode === "repoint" && pending.effectId === effect.id;
  const params = { ...DEFAULT_PARAMS, ...effect.params };

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-lg border border-[var(--border)] p-3">
        <span className="block text-xs font-bold text-[var(--brand)]">
          {def?.label ?? effect.presetId}
        </span>
        <span className="block text-[10px] tabular-nums text-[var(--muted-foreground)]">
          {fmtTime(effect.start)} – {fmtTime(effect.end)} · {(effect.end - effect.start).toFixed(1)}s
        </span>
      </div>

      <label className="block space-y-1">
        <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">
          Duração do efeito: {(effect.end - effect.start).toFixed(1)}s
        </span>
        <input
          type="range"
          min={0.2}
          max={20}
          step={0.1}
          value={Math.min(20, effect.end - effect.start)}
          onChange={(e) => resize(effect.id, effect.start, effect.start + Number(e.target.value))}
          className="w-full accent-[var(--brand)]"
        />
      </label>

      {def ? (
        <EffectControls
          controls={def.controls}
          params={params}
          onChange={(patch) => update("", effect.id, patch)}
        />
      ) : null}

      {def?.category === "zoom" && def.needsPoint ? (
        <div className="space-y-1.5">
          <span className="block text-[10px] font-semibold text-[var(--muted-foreground)]">
            Ponto do zoom:{" "}
            {effect.params.point
              ? `x ${Math.round(effect.params.point.x * 100)}% · y ${Math.round(
                  effect.params.point.y * 100,
                )}%`
              : "centro"}
          </span>
          <button
            onClick={() =>
              setPending(repointing ? null : { mode: "repoint", effectId: effect.id })
            }
            className={cn(
              "flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[10px] font-semibold transition-colors",
              repointing
                ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                : "border-[var(--border)] hover:border-[var(--brand)] hover:text-[var(--brand)]",
            )}
          >
            <Crosshair className="h-3 w-3" />
            {repointing ? "Clique no vídeo…" : "Marcar ponto no vídeo"}
          </button>
        </div>
      ) : null}

      <button
        onClick={() => remove("", effect.id)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-2 text-[11px] font-semibold text-[var(--muted-foreground)] transition-colors hover:border-red-500/60 hover:text-red-400"
      >
        <Trash2 className="h-3.5 w-3.5" /> Remover efeito
      </button>

      <p className="text-[10px] leading-relaxed text-[var(--muted-foreground)]">
        Arraste a barra na faixa <strong>Efeitos</strong> da timeline para mudar quando ele acontece
        e puxe as bordas para esticar — inclusive por cima de vários cortes.
      </p>
    </div>
  );
}
