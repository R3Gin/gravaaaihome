import { ChevronLeft, ChevronRight, Diamond, Plus } from "lucide-react";
import { findClip, useEditor, type Clip } from "@/state/editor-store";
import {
  animatablePropsFor,
  resolveClip,
  type AnimProp,
  type KeyValue,
} from "@/lib/keyframes";
import {
  DEFAULT_PRESET,
  TEXT_PRESETS,
  type PresetConfig,
  type PresetId,
} from "@/lib/text-presets";
import { cn } from "@/lib/utils";


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

/* ------------------------------------------------------------------ *
 * Linha de propriedade animável: cronômetro (losango) + navegação
 * entre keyframes + controle do valor.
 * ------------------------------------------------------------------ */
function AnimRow({ clip, prop }: { clip: Clip; prop: AnimProp }) {
  const currentTime = useEditor((s) => s.currentTime);
  const setCurrentTime = useEditor((s) => s.setCurrentTime);
  const setPropValue = useEditor((s) => s.setPropValue);
  const toggle = useEditor((s) => s.togglePropertyAnimation);
  const addKeyframeAt = useEditor((s) => s.addKeyframeAt);

  const keys = clip.keyframes?.[prop.key] ?? [];
  const animated = keys.length > 0;
  const local = currentTime - clip.startTime;
  const onKey = animated && keys.some((k) => Math.abs(k.time - local) <= 0.03);
  const live = resolveClip(clip, currentTime);
  const value = prop.get(live);

  const jump = (dir: -1 | 1) => {
    const target =
      dir < 0
        ? [...keys].reverse().find((k) => k.time < local - 0.01)
        : keys.find((k) => k.time > local + 0.01);
    if (target) setCurrentTime(clip.startTime + target.time);
  };

  const change = (v: KeyValue) => setPropValue(clip.id, prop.key, v);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => toggle(clip.id, prop.key)}
          title={animated ? "Remover todos os keyframes desta propriedade" : "Animar esta propriedade"}
          aria-label={`Animar ${prop.label}`}
          data-kf-toggle={prop.key}
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded",
            animated ? "text-[var(--brand)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
          )}
        >
          <Diamond className={cn("h-3 w-3", animated && onKey && "fill-[var(--brand)]")} />
        </button>
        {animated ? (
          <>
            <button
              onClick={() => jump(-1)}
              title="Keyframe anterior"
              className="grid h-5 w-4 place-items-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => jump(1)}
              title="Próximo keyframe"
              className="grid h-5 w-4 place-items-center text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}
        <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">{prop.label}</span>
        <button
          onClick={() => addKeyframeAt(clip.id, prop.key)}
          title="Adicionar keyframe no playhead com o valor atual"
          className="ml-auto flex items-center gap-0.5 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
        >
          <Plus className="h-2.5 w-2.5" /> Keyframe
        </button>
        {animated ? (
          <span className="text-[10px] tabular-nums text-[var(--brand)]">{keys.length}</span>
        ) : null}
      </div>

      {prop.kind === "point" ? (
        <div className="space-y-1 pl-6">
          {(["x", "y"] as const).map((axis) => {
            const point = typeof value === "number" ? { x: value, y: value } : value;
            return (
              <div key={axis} className="flex items-center gap-2">
                <span className="w-3 text-[10px] uppercase text-[var(--muted-foreground)]">{axis}</span>
                <Slider
                  value={point[axis]}
                  min={prop.min}
                  max={prop.max}
                  step={prop.step}
                  onChange={(v) => change({ ...point, [axis]: v })}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="pl-6">
          <Slider
            value={typeof value === "number" ? value : 0}
            min={prop.min}
            max={prop.max}
            step={prop.step}
            onChange={(v) => change(v)}
          />
        </div>
      )}
    </div>
  );
}

function AnimSection({ clip }: { clip: Clip }) {
  const props = animatablePropsFor(clip).filter((p) =>
    clip.type === "overlay" && p.key === "strength"
      ? true
      : clip.type === "overlay" && p.key === "position"
        ? false
        : true,
  );
  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
          Propriedades animáveis
        </span>
        <kbd className="rounded border border-[var(--border)] px-1 text-[10px] font-bold">U</kbd>
      </div>
      {props.map((p) => (
        <AnimRow key={p.key} clip={clip} prop={p} />
      ))}
      <p className="text-[10px] leading-relaxed text-[var(--muted-foreground)]">
        Clique no losango para ativar a animação: um keyframe é criado no playhead e cada mudança
        de valor gera (ou atualiza) um keyframe. Pressione U para ver os keyframes na timeline.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Presets de animação de entrada/saída (texto).
 * ------------------------------------------------------------------ */
function PresetSection({ clip, side }: { clip: Clip; side: "in" | "out" }) {
  const setTextPreset = useEditor((s) => s.setTextPreset);
  const cfg: PresetConfig = { ...DEFAULT_PRESET, ...(side === "in" ? clip.animIn : clip.animOut) };

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
      <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
        {side === "in" ? "Animação de entrada" : "Animação de saída"}
      </span>
      <select
        value={cfg.preset}
        onChange={(e) => setTextPreset(clip.id, side, { preset: e.target.value as PresetId })}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs"
      >
        {TEXT_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      {cfg.preset !== "none" ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-[10px] text-[var(--muted-foreground)]">Duração (s)</span>
            <input
              type="number"
              min={0.05}
              step={0.05}
              value={cfg.duration}
              onChange={(e) => setTextPreset(clip.id, side, { duration: Number(e.target.value) })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs tabular-nums"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-[var(--muted-foreground)]">
              {side === "in" ? "Velocidade de entrada (%)" : "Velocidade de saída (%)"}
            </span>
            <input
              type="number"
              min={10}
              max={400}
              step={10}
              value={cfg.speed}
              onChange={(e) => setTextPreset(clip.id, side, { speed: Number(e.target.value) })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs tabular-nums"
            />
          </label>
        </div>
      ) : null}
      <p className="text-[10px] leading-relaxed text-[var(--muted-foreground)]">
        Os keyframes são gerados automaticamente. Ajuste fino: duplo clique no losango na timeline.
      </p>
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
        ) : (
          <AnimSection clip={clip} />
        )}

        {clip?.type === "video" ? (
          <>
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
            <p className="rounded-lg border border-[var(--border)] p-3 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
              Volume, redução de ruído e fades ficam no módulo <strong>Áudio</strong>; efeitos de
              troca entre clipes, no módulo <strong>Transições</strong> (sidebar esquerda).
            </p>
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
            <PresetSection clip={clip} side="in" />
            <PresetSection clip={clip} side="out" />
          </>

        ) : null}

        {clip?.type === "overlay" ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            {clip.overlayKind === "annotation"
              ? "Arraste a anotação no preview para reposicioná-la. Ajuste as bordas do clipe na timeline para definir quando ela aparece."
              : clip.overlayKind === "blur"
                ? "Arraste e redimensione a área desfocada no preview."
                : "Arraste o destaque no preview para escolher a área iluminada."}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
