import { useMemo, useState } from "react";
import { Copy, ClipboardPaste, Trash2 } from "lucide-react";
import { findClip, useEditor, type Clip } from "@/state/editor-store";
import { EASINGS, propByKey, type Easing, type KeyValue } from "@/lib/keyframes";

/* ------------------------------------------------------------------ *
 * Editor dos keyframes selecionados na timeline: tempo, valor, easing,
 * ações em lote (mover / deletar / copiar / colar).
 * Vale para TODAS as propriedades animáveis (posição, escala, rotação,
 * zoom, opacidade…) — a lógica é a mesma para todas.
 * ------------------------------------------------------------------ */

/** Converte o valor bruto do keyframe para a unidade exibida. */
function unitFor(prop: string) {
  if (prop === "rotation") return { suffix: "°", factor: 1, step: 1 };
  if (prop === "scale" || prop === "zoom" || prop === "opacity" || prop === "position")
    return { suffix: "%", factor: 100, step: 1 };
  return { suffix: "", factor: 1, step: 0.01 };
}

function NumberField({
  label,
  value,
  step,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  step: number;
  suffix?: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(Number(value.toFixed(3)));
  return (
    <label className="space-y-1">
      <span className="text-[10px] text-[var(--muted-foreground)]">
        {label}
        {suffix ? ` (${suffix})` : ""}
      </span>
      <input
        type="number"
        step={step}
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== "") onCommit(Number(draft));
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(null);
        }}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs tabular-nums"
      />
    </label>
  );
}

export function KeyframeEditor({ clip }: { clip: Clip }) {
  const selected = useEditor((s) => s.selectedKeyframes);
  const tracks = useEditor((s) => s.tracks);
  const setKeyframeTime = useEditor((s) => s.setKeyframeTime);
  const setKeyframeValue = useEditor((s) => s.setKeyframeValue);
  const setKeyframeEasing = useEditor((s) => s.setKeyframeEasing);
  const removeSelectedKeyframes = useEditor((s) => s.removeSelectedKeyframes);
  const nudgeSelectedKeyframes = useEditor((s) => s.nudgeSelectedKeyframes);
  const copySelectedKeyframes = useEditor((s) => s.copySelectedKeyframes);
  const pasteKeyframes = useEditor((s) => s.pasteKeyframes);
  const clipboard = useEditor((s) => s.kfClipboard);
  const setCurrentTime = useEditor((s) => s.setCurrentTime);
  const [shift, setShift] = useState(0.1);

  const live = findClip(tracks, clip.id) ?? clip;

  const items = useMemo(
    () =>
      selected.flatMap((sel) => {
        const kf = live.keyframes?.[sel.prop]?.find((k) => k.id === sel.kfId);
        return kf ? [{ prop: sel.prop, kf }] : [];
      }),
    [selected, live],
  );

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
        Nenhum keyframe selecionado. Pressione <strong>U</strong> para ver as trilhas de keyframes
        na timeline, clique num losango para selecionar, use <strong>Shift+clique</strong> para
        somar à seleção ou arraste uma caixa sobre a trilha.
        {clipboard.length > 0 ? (
          <button
            onClick={() => pasteKeyframes()}
            className="mt-2 flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--foreground)]"
          >
            <ClipboardPaste className="h-3 w-3" /> Colar {clipboard.length} no playhead
          </button>
        ) : null}
      </div>
    );
  }

  const single = items.length === 1 ? items[0] : null;
  const meta = single ? propByKey(single.prop) : undefined;
  const unit = single ? unitFor(single.prop) : null;

  return (
    <div className="space-y-3 rounded-lg border border-amber-300/40 bg-amber-300/5 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-amber-300">
          {items.length === 1
            ? `Keyframe · ${meta?.label ?? single?.prop}`
            : `${items.length} keyframes selecionados`}
        </span>
        <button
          onClick={() => removeSelectedKeyframes()}
          title="Deletar selecionados (Delete)"
          className="grid h-6 w-6 place-items-center rounded text-[var(--muted-foreground)] hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {single && meta && unit ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Tempo"
              suffix="s"
              step={0.01}
              value={single.kf.time}
              onCommit={(v) => {
                setKeyframeTime(clip.id, single.prop, single.kf.id, v);
                setCurrentTime(clip.startTime + Math.max(0, v));
              }}
            />
            {meta.kind === "number" ? (
              <NumberField
                label="Valor"
                suffix={unit.suffix}
                step={unit.step}
                value={(typeof single.kf.value === "number" ? single.kf.value : 0) * unit.factor}
                onCommit={(v) =>
                  setKeyframeValue(clip.id, single.prop, single.kf.id, v / unit.factor)
                }
              />
            ) : null}
          </div>

          {meta.kind === "point" ? (
            <div className="grid grid-cols-2 gap-2">
              {(["x", "y"] as const).map((axis) => {
                const p =
                  typeof single.kf.value === "number"
                    ? { x: single.kf.value, y: single.kf.value }
                    : single.kf.value;
                return (
                  <NumberField
                    key={axis}
                    label={axis.toUpperCase()}
                    suffix={unit.suffix}
                    step={unit.step}
                    value={p[axis] * unit.factor}
                    onCommit={(v) => {
                      const next: KeyValue = { ...p, [axis]: v / unit.factor };
                      setKeyframeValue(clip.id, single.prop, single.kf.id, next);
                    }}
                  />
                );
              })}
            </div>
          ) : null}

          <label className="block space-y-1">
            <span className="text-[10px] text-[var(--muted-foreground)]">Easing</span>
            <select
              value={single.kf.easing}
              onChange={(e) =>
                setKeyframeEasing(clip.id, single.prop, single.kf.id, e.target.value as Easing)
              }
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
            >
              {EASINGS.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <NumberField
              label="Mover no tempo"
              suffix="s"
              step={0.05}
              value={shift}
              onCommit={setShift}
            />
            <button
              onClick={() => nudgeSelectedKeyframes(shift)}
              className="h-[26px] shrink-0 rounded-md bg-[var(--brand)] px-2 text-[11px] font-semibold text-white"
            >
              Aplicar
            </button>
          </div>
          <p className="text-[10px] text-[var(--muted-foreground)]">
            O espaçamento relativo entre os keyframes é mantido. Valores individuais só podem ser
            editados com um único keyframe selecionado.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => copySelectedKeyframes()}
          className="flex flex-1 items-center justify-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--foreground)]"
        >
          <Copy className="h-3 w-3" /> Copiar
        </button>
        <button
          disabled={clipboard.length === 0}
          onClick={() => pasteKeyframes()}
          className="flex flex-1 items-center justify-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--foreground)] disabled:opacity-40"
        >
          <ClipboardPaste className="h-3 w-3" /> Colar no playhead
        </button>
      </div>
      <p className="text-[10px] text-[var(--muted-foreground)]">
        Atalhos: Delete apaga · Ctrl/Cmd+C copia · Ctrl/Cmd+V cola · ← / → pulam para o keyframe
        anterior/próximo.
      </p>
    </div>
  );
}
