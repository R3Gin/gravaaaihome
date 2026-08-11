import { useState } from "react";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { speechPlaceholders, transcribe } from "@/lib/captions";
import { useEditor } from "@/state/editor-store";
import { cn } from "@/lib/utils";

export function CaptionsPanel() {
  const sourceBlob = useEditor((s) => s.sourceBlob);
  const addCaptionClips = useEditor((s) => s.addCaptionClips);
  const clearCaptions = useEditor((s) => s.clearCaptions);
  const style = useEditor((s) => s.captionStyle);
  const setCaptionStyle = useEditor((s) => s.setCaptionStyle);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [download, setDownload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"auto" | "pt">("auto");

  const run = async () => {
    if (!sourceBlob) return;
    setBusy(true);
    setError(null);
    setDownload(0);
    try {
      const segs = await transcribe(sourceBlob, lang === "pt" ? "portuguese" : undefined, {
        onStage: (s) =>
          setStage(
            s === "audio"
              ? "Extraindo áudio…"
              : s === "model"
                ? "Carregando modelo (só na primeira vez)…"
                : "Transcrevendo…",
          ),
        onDownload: setDownload,
      });
      addCaptionClips(segs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não consegui gerar as legendas.");
    } finally {
      setBusy(false);
      setStage("");
    }
  };

  const runBlocks = async () => {
    if (!sourceBlob) return;
    setBusy(true);
    setError(null);
    try {
      addCaptionClips(await speechPlaceholders(sourceBlob));
    } catch {
      setError("Não consegui analisar o áudio desse vídeo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted-foreground)]">
        A transcrição roda no seu navegador com Whisper — nenhum áudio é enviado para servidores.
        O modelo (~150 MB) é baixado na primeira vez e fica em cache.
      </p>

      <div className="flex gap-1.5">
        {(["auto", "pt"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setLang(k)}
            className={cn(
              "flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold",
              lang === k
                ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                : "border-[var(--border)] text-[var(--muted-foreground)]",
            )}
          >
            {k === "auto" ? "Detectar idioma" : "Português"}
          </button>
        ))}
      </div>

      <button
        disabled={!sourceBlob || busy}
        onClick={() => void run()}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Gerar legendas automaticamente
      </button>

      {busy ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-[var(--muted-foreground)]">{stage}</p>
          {download > 0 && download < 1 ? (
            <div className="h-1 rounded bg-[var(--border)]">
              <div
                className="h-full rounded bg-[var(--brand)] transition-[width]"
                style={{ width: `${Math.round(download * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="space-y-2 rounded-lg bg-red-500/10 p-3 text-[11px] text-red-300">
          {error}
          <div className="flex gap-2">
            <button onClick={() => void run()} className="font-semibold underline">
              Tentar de novo
            </button>
            <button onClick={() => void runBlocks()} className="font-semibold underline">
              Marcar blocos de fala
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
          Estilo das legendas
        </span>
        <label className="block space-y-1">
          <span className="text-[11px] text-[var(--muted-foreground)]">
            Tamanho · {style.fontSize}
          </span>
          <input
            type="range"
            min={20}
            max={90}
            step={1}
            value={style.fontSize}
            onChange={(e) => setCaptionStyle({ fontSize: Number(e.target.value) })}
            className="w-full accent-[var(--brand)]"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-[var(--muted-foreground)]">Cor</span>
          <input
            type="color"
            value={style.color}
            onChange={(e) => setCaptionStyle({ color: e.target.value })}
            className="h-8 w-full rounded-lg border border-[var(--border)] bg-transparent"
          />
        </label>
        <div className="flex gap-1.5">
          {(["bottom", "middle", "top"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setCaptionStyle({ place: p })}
              className={cn(
                "flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold",
                style.place === p
                  ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)]",
              )}
            >
              {p === "bottom" ? "Rodapé" : p === "middle" ? "Meio" : "Topo"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[11px]">
          <input
            type="checkbox"
            checked={style.background}
            onChange={(e) => setCaptionStyle({ background: e.target.checked })}
            className="accent-[var(--brand)]"
          />
          Fundo atrás do texto
        </label>
      </div>

      <button
        onClick={clearCaptions}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] font-semibold text-[var(--muted-foreground)]"
      >
        <Trash2 className="h-3.5 w-3.5" /> Remover legendas
      </button>
    </div>
  );
}
