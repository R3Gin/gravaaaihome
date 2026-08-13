import {
  DEFAULT_TRANSITION_DURATION,
  useEditor,
  type Clip,
  type TransitionDir,
  type TransitionKind,
} from "@/state/editor-store";
import { cn } from "@/lib/utils";

export const TRANSITION_LIBRARY: {
  id: TransitionKind;
  label: string;
  hint: string;
  dirs: boolean;
}[] = [
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
export function TransitionThumb({ kind }: { kind: TransitionKind }) {
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

/** Escolha de transição + duração/direção para um clipe (o ponto de encontro é a entrada dele). */
export function ClipTransitionControls({ clip }: { clip: Clip }) {
  const setTransition = useEditor((s) => s.setTransition);
  const kind = clip.transition ?? "none";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {TRANSITION_LIBRARY.map((t) => (
          <button
            key={t.id}
            onClick={() => setTransition(clip.id, { kind: t.id })}
            title={t.hint}
            className={cn(
              "space-y-1 rounded-lg border p-1.5 text-left transition-colors",
              kind === t.id ? "border-[var(--brand)] bg-[var(--brand)]/10" : "border-[var(--border)]",
            )}
          >
            <TransitionThumb kind={t.id} />
            <span className="block text-[11px] font-semibold">{t.label}</span>
          </button>
        ))}
      </div>

      {kind !== "none" ? (
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
                value={clip.transitionDuration ?? DEFAULT_TRANSITION_DURATION}
                onChange={(e) => setTransition(clip.id, { duration: Number(e.target.value) })}
                className="w-full accent-[var(--brand)]"
              />
              <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-[var(--muted-foreground)]">
                {(clip.transitionDuration ?? DEFAULT_TRANSITION_DURATION).toFixed(2)}s
              </span>
            </div>
          </div>

          {TRANSITION_LIBRARY.find((t) => t.id === kind)?.dirs ? (
            <div className="grid grid-cols-4 gap-1">
              {DIRS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setTransition(clip.id, { dir: d.id })}
                  className={cn(
                    "rounded-md border px-1 py-1 text-[10px] font-semibold transition-colors",
                    (clip.transitionDir ?? "left") === d.id
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
