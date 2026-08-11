import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_TRANSITION_DURATION,
  useEditor,
  type Clip,
  type TransitionDir,
  type TransitionKind,
} from "@/state/editor-store";
import { cn } from "@/lib/utils";

const LIBRARY: { id: TransitionKind; label: string; hint: string; dirs: boolean }[] = [
  { id: "none", label: "Corte", hint: "Troca instantânea, sem efeito", dirs: false },
  { id: "fade", label: "Fade", hint: "Cross-fade entre os dois clipes", dirs: false },
  { id: "slide", label: "Slide", hint: "Um clipe empurra o outro", dirs: true },
  { id: "zoom", label: "Zoom", hint: "Zoom in saindo, zoom out entrando", dirs: false },
  { id: "wipe", label: "Wipe", hint: "Revelação em linha reta", dirs: true },
];

const DIRS: { id: TransitionDir; label: string }[] = [
  { id: "left", label: "Esquerda" },
  { id: "right", label: "Direita" },
  { id: "up", label: "Cima" },
  { id: "down", label: "Baixo" },
];

/** Mini-preview animado do efeito, só com transform/opacity/clip-path. */
function Thumb({ kind }: { kind: TransitionKind }) {
  return (
    <div className="relative h-10 w-full overflow-hidden rounded-md bg-black/60">
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--brand)]/70 to-[var(--brand)]/20" />
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-br from-sky-400/70 to-sky-400/20",
          kind === "none" && "opacity-0",
          kind === "fade" && "animate-[fade-in_1.6s_ease-in-out_infinite_alternate]",
          kind === "slide" && "animate-[slide-in-right_1.6s_ease-in-out_infinite_alternate]",
          kind === "zoom" && "animate-[scale-in_1.6s_ease-in-out_infinite_alternate]",
          kind === "wipe" && "animate-[fade-in_1.6s_linear_infinite_alternate]",
        )}
        style={kind === "wipe" ? { clipPath: "inset(0 40% 0 0)" } : undefined}
      />
    </div>
  );
}

export function TransitionsPanel() {
  const tracks = useEditor((s) => s.tracks);
  const setTransition = useEditor((s) => s.setTransition);
  const select = useEditor((s) => s.select);
  const setCurrentTime = useEditor((s) => s.setCurrentTime);

  const clips = useMemo<Clip[]>(
    () =>
      [...(tracks.find((t) => t.type === "video")?.clips ?? [])].sort(
        (a, b) => a.startTime - b.startTime,
      ),
    [tracks],
  );
  // pontos de encontro: entrada de cada clipe a partir do segundo
  const junctions = clips.slice(1);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (junctions.length === 0) setActiveId(null);
    else if (!junctions.some((c) => c.id === activeId)) setActiveId(junctions[0].id);
  }, [junctions, activeId]);

  const active = junctions.find((c) => c.id === activeId) ?? null;

  if (junctions.length === 0) {
    return (
      <p className="text-xs text-[var(--muted-foreground)]">
        Divida o vídeo em dois ou mais clipes (tecla S) para aplicar transições entre eles.
      </p>
    );
  }

  const applyTo = (kind: TransitionKind) => {
    if (!active) return;
    setTransition(active.id, { kind });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
          Ponto de encontro
        </span>
        <div className="space-y-1">
          {junctions.map((c, i) => (
            <button
              key={c.id}
              onClick={() => {
                setActiveId(c.id);
                select(c.id);
                setCurrentTime(Math.max(0, c.startTime - 0.05));
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-[11px] font-semibold",
                activeId === c.id
                  ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)]",
              )}
            >
              <span>
                Clipe {i + 1} → {i + 2}
              </span>
              <span className="tabular-nums">{c.startTime.toFixed(1)}s</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {LIBRARY.map((t) => (
          <button
            key={t.id}
            onClick={() => applyTo(t.id)}
            title={t.hint}
            className={cn(
              "space-y-1 rounded-lg border p-1.5 text-left",
              (active?.transition ?? "none") === t.id
                ? "border-[var(--brand)] bg-[var(--brand)]/10"
                : "border-[var(--border)]",
            )}
          >
            <Thumb kind={t.id} />
            <span className="block text-[11px] font-semibold">{t.label}</span>
          </button>
        ))}
      </div>

      {active && (active.transition ?? "none") !== "none" ? (
        <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">
              Duração da transição
            </span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.1}
                max={2}
                step={0.05}
                value={active.transitionDuration ?? DEFAULT_TRANSITION_DURATION}
                onChange={(e) =>
                  setTransition(active.id, { duration: Number(e.target.value) })
                }
                className="w-full accent-[var(--brand)]"
              />
              <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-[var(--muted-foreground)]">
                {(active.transitionDuration ?? DEFAULT_TRANSITION_DURATION).toFixed(2)}s
              </span>
            </div>
          </div>

          {LIBRARY.find((t) => t.id === active.transition)?.dirs ? (
            <div className="grid grid-cols-4 gap-1">
              {DIRS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setTransition(active.id, { dir: d.id })}
                  className={cn(
                    "rounded-md border px-1 py-1 text-[10px] font-semibold",
                    (active.transitionDir ?? "left") === d.id
                      ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                      : "border-[var(--border)] text-[var(--muted-foreground)]",
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
