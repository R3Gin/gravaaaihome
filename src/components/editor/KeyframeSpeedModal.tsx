import { useMemo, useState } from "react";
import { findClip, useEditor } from "@/state/editor-store";
import { propByKey, timecode, type TangentSpeed } from "@/lib/keyframes";

interface Props {
  clipId: string;
  prop: string;
  kfId: string;
  onClose: () => void;
}

const DEF: TangentSpeed = { x: 0, y: 0, influence: 33.33 };

function Field({
  label,
  value,
  suffix,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-[var(--muted-foreground)]">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={0.1}
          value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-24 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-right text-xs tabular-nums disabled:opacity-40"
        />
        {suffix ? <span className="text-[10px] text-[var(--muted-foreground)]">{suffix}</span> : null}
      </span>
    </label>
  );
}

/** Modal "Velocidade do quadro-chave" (equivalente ao do Premiere Pro). */
export function KeyframeSpeedModal({ clipId, prop, kfId, onClose }: Props) {
  const tracks = useEditor((s) => s.tracks);
  const setKeyframeSpeed = useEditor((s) => s.setKeyframeSpeed);
  const clip = findClip(tracks, clipId);
  const meta = propByKey(prop);
  const keys = clip?.keyframes?.[prop] ?? [];
  const index = keys.findIndex((k) => k.id === kfId);
  const kf = keys[index];

  const initial = useMemo(
    () => ({
      incoming: { ...DEF, ...kf?.incomingSpeed },
      outgoing: { ...DEF, ...kf?.outgoingSpeed },
      continuous: kf?.continuous ?? false,
    }),
    // valores iniciais congelados na abertura do modal
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kfId],
  );

  const [incoming, setIncoming] = useState<TangentSpeed>(initial.incoming);
  const [outgoing, setOutgoing] = useState<TangentSpeed>(initial.outgoing);
  const [continuous, setContinuous] = useState(initial.continuous);
  const [lockIn, setLockIn] = useState(true);
  const [lockOut, setLockOut] = useState(true);

  if (!clip || !kf || !meta) return null;

  const multi = meta.kind === "point";

  const patchIn = (p: Partial<TangentSpeed>) => {
    const next = { ...incoming, ...p };
    if (lockIn && multi) {
      if (p.x !== undefined) next.y = p.x;
      if (p.y !== undefined) next.x = p.y;
    }
    setIncoming(next);
    if (continuous) setOutgoing({ ...next });
  };

  const patchOut = (p: Partial<TangentSpeed>) => {
    const next = { ...outgoing, ...p };
    if (lockOut && multi) {
      if (p.x !== undefined) next.y = p.x;
      if (p.y !== undefined) next.x = p.y;
    }
    setOutgoing(next);
  };

  const confirm = () => {
    setKeyframeSpeed(clipId, prop, kfId, { incomingSpeed: incoming, outgoingSpeed: outgoing, continuous });
    onClose();
  };

  const Section = ({
    title,
    value,
    lock,
    setLock,
    patch,
    disabled,
  }: {
    title: string;
    value: TangentSpeed;
    lock: boolean;
    setLock: (v: boolean) => void;
    patch: (p: Partial<TangentSpeed>) => void;
    disabled?: boolean;
  }) => (
    <fieldset className="space-y-2 rounded-lg border border-[var(--border)] p-3">
      <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
        {title}
      </legend>
      <label className="flex items-center gap-2 text-[11px]">
        <input
          type="checkbox"
          checked={lock}
          disabled={!multi || disabled}
          onChange={(e) => setLock(e.target.checked)}
          className="accent-[var(--brand)]"
        />
        Bloquear dimensões
      </label>
      <Field
        label="Dimensão X"
        value={value.x}
        suffix="/s"
        disabled={disabled}
        onChange={(v) => patch({ x: v })}
      />
      <Field
        label="Dimensão Y"
        value={value.y}
        suffix="/s"
        disabled={!multi || disabled}
        onChange={(v) => patch({ y: v })}
      />
      <Field
        label="Influência"
        value={value.influence}
        suffix="%"
        disabled={disabled}
        onChange={(v) => patch({ influence: Math.min(100, Math.max(1, v)) })}
      />
    </fieldset>
  );

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[380px] max-w-full space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-2xl">
        <h2 className="text-sm font-bold">Velocidade do quadro-chave</h2>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          Tipo de quadro-chave: <span className="font-semibold text-[var(--foreground)]">{meta.label}</span>
        </p>

        <Section
          title="Velocidade de entrada"
          value={incoming}
          lock={lockIn}
          setLock={setLockIn}
          patch={patchIn}
        />
        <Section
          title="Velocidade de saída"
          value={continuous ? incoming : outgoing}
          lock={lockOut}
          setLock={setLockOut}
          patch={patchOut}
          disabled={continuous}
        />

        <label className="flex items-center gap-2 text-[11px]">
          <input
            type="checkbox"
            checked={continuous}
            onChange={(e) => {
              setContinuous(e.target.checked);
              if (e.target.checked) setOutgoing({ ...incoming });
            }}
            className="accent-[var(--brand)]"
          />
          Contínuo (bloquear saída para entrada)
        </label>

        <p className="text-[10px] text-[var(--muted-foreground)]">
          Para o quadro-chave #{index + 1} no tempo {timecode(clip.startTime + kf.time)}
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted-foreground)]"
          >
            Cancelar
          </button>
          <button
            onClick={confirm}
            className="rounded-lg bg-[var(--brand)] px-4 py-1.5 text-xs font-bold text-white"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
