import { useEffect, useState } from "react";
import { Loader2, Scissors } from "lucide-react";
import { toast } from "sonner";
import { detectSilences } from "@/lib/audio-tools";
import { useEditor } from "@/state/editor-store";

export function SilencePanel({ onClose }: { onClose: () => void }) {
  const sourceBlob = useEditor((s) => s.sourceBlob);
  const silences = useEditor((s) => s.silences);
  const setSilences = useEditor((s) => s.setSilences);
  const cutRanges = useEditor((s) => s.cutRanges);

  const [sensitivity, setSensitivity] = useState(0.35);
  const [minDur, setMinDur] = useState(0.5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceBlob) return;
    let alive = true;
    setBusy(true);
    setError(null);
    const id = setTimeout(() => {
      void detectSilences(sourceBlob, sensitivity, minDur)
        .then((segs) => {
          if (!alive) return;
          setSilences(segs);
          if (segs.length === 0) setError("Nenhum silêncio encontrado com esses ajustes.");
        })
        .catch(() => alive && setError("Não consegui analisar o áudio desse vídeo."))
        .finally(() => alive && setBusy(false));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [minDur, sensitivity, setSilences, sourceBlob]);

  useEffect(() => () => setSilences([]), [setSilences]);

  const total = silences.reduce((sum, s) => sum + (s.end - s.start), 0);

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted-foreground)]">
        Os trechos silenciosos aparecem sombreados na timeline.
      </p>

      <label className="block space-y-1.5">
        <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">
          Sensibilidade
        </span>
        <input
          type="range"
          min={0.05}
          max={0.9}
          step={0.05}
          value={sensitivity}
          onChange={(e) => setSensitivity(Number(e.target.value))}
          className="w-full accent-[var(--brand)]"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">
          Silêncio mínimo · {minDur.toFixed(1)}s
        </span>
        <input
          type="range"
          min={0.2}
          max={2}
          step={0.1}
          value={minDur}
          onChange={(e) => setMinDur(Number(e.target.value))}
          className="w-full accent-[var(--brand)]"
        />
      </label>

      <div className="rounded-lg border border-[var(--border)] p-3 text-xs">
        {busy ? (
          <span className="flex items-center gap-2 text-[var(--muted-foreground)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analisando áudio…
          </span>
        ) : error ? (
          <span className="text-[var(--muted-foreground)]">{error}</span>
        ) : (
          <>
            <strong>{silences.length}</strong> trecho(s) · {total.toFixed(1)}s a remover
          </>
        )}
      </div>

      {applying !== null ? (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
            <div
              className="h-full bg-[var(--brand)] transition-[width]"
              style={{ width: `${Math.round(applying * 100)}%` }}
            />
          </div>
          <span className="text-[11px] text-[var(--muted-foreground)]">
            Aplicando cortes… {Math.round(applying * 100)}%
          </span>
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          disabled={busy || applying !== null || silences.length === 0}
          onClick={() => void apply()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          <Scissors className="h-3.5 w-3.5" /> Remover todos
        </button>
        <button
          onClick={() => {
            setSilences([]);
            onClose();
          }}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--muted-foreground)]"
        >
          Cancelar
        </button>
      </div>

    </div>
  );
}
