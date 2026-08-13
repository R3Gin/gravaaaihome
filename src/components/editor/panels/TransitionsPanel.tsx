import { useEffect, useMemo, useState } from "react";
import { useEditor, type Clip } from "@/state/editor-store";
import { ClipTransitionControls } from "./ClipTransitionControls";
import { cn } from "@/lib/utils";

export function TransitionsPanel() {
  const tracks = useEditor((s) => s.tracks);
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
                "flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors",
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

      {active ? <ClipTransitionControls clip={active} /> : null}
    </div>
  );
}
