import { useMemo, useState } from "react";
import { Loader2, Play, Sparkles, Trash2 } from "lucide-react";
import { speechPlaceholders, transcribe } from "@/lib/captions";
import { CAPTION_ANIMS } from "@/lib/caption-styles";
import { useEditor } from "@/state/editor-store";
import { cn } from "@/lib/utils";

const FONTS = [
  { label: "Inter (padrão)", value: "Inter, system-ui, sans-serif" },
  { label: "Sistema", value: "system-ui, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Impact", value: "Impact, Haettenschweiler, sans-serif" },
  { label: "Courier", value: "'Courier New', monospace" },
  { label: "Trebuchet", value: "'Trebuchet MS', sans-serif" },
];

const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const c = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
};

function StylePreview({ id }: { id: string }) {
  const anim = CAPTION_ANIMS.find((a) => a.id === id);
  if (!anim) return null;
  if (id === "typewriter") {
    return <span className={cn("whitespace-nowrap", anim.previewClass)}>Legenda ativa</span>;
  }
  return (
    <span className={cn("whitespace-nowrap", anim.previewClass)}>
      <span>Le</span> <span>gen</span> <span>da</span>
    </span>
  );
}

export function CaptionsPanel() {
  const sourceBlob = useEditor((s) => s.sourceBlob);
  const tracks = useEditor((s) => s.tracks);
  const addCaptionClips = useEditor((s) => s.addCaptionClips);
  const clearCaptions = useEditor((s) => s.clearCaptions);
  const style = useEditor((s) => s.captionStyle);
  const setCaptionStyle = useEditor((s) => s.setCaptionStyle);
  const updateClip = useEditor((s) => s.updateClip);
  const setCurrentTime = useEditor((s) => s.setCurrentTime);
  const select = useEditor((s) => s.select);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [download, setDownload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lang, setLang] = useState<"auto" | "pt">("auto");
  const [tab, setTab] = useState<"estilo" | "lista">("estilo");

  const captions = useMemo(
    () =>
      tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.isCaption)
        .sort((a, b) => a.startTime - b.startTime),
    [tracks],
  );

  const run = async () => {
    if (!sourceBlob) return;
    setBusy(true);
    setError(null);
    setDownload(0);
    try {
      const res = await transcribe(sourceBlob, lang === "pt" ? "portuguese" : undefined, {
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
      addCaptionClips(res.segments, res.words);
      setTab("lista");
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
      setTab("lista");
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
      </p>

      <div className="flex gap-1.5">
        {(["auto", "pt"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setLang(k)}
            className={cn(
              "flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors",
              lang === k
                ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                : "border-[var(--border)] text-[var(--muted-foreground)]",
            )}
          >
            {k === "auto" ? "Detectar idioma" : "Português"}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
          Tamanho do bloco
        </span>
        <div className="flex gap-1.5">
          {(
            [
              { id: "curto", label: "Curto", hint: "3-4 palavras" },
              { id: "medio", label: "Médio", hint: "5-6 palavras" },
              { id: "longo", label: "Longo", hint: "frase quase inteira" },
            ] as const
          ).map((b) => (
            <button
              key={b.id}
              title={b.hint}
              onClick={() => setCaptionStyle({ blockSize: b.id })}
              className={cn(
                "flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors",
                (style.blockSize ?? "medio") === b.id
                  ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)]",
              )}
            >
              {b.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-[var(--muted-foreground)]">
          Os blocos são cortados nas pausas reais da fala.
        </p>
      </div>

      <button
        disabled={!sourceBlob || busy}
        onClick={() => void run()}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-40"
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

      {/* --- abas --- */}
      <div className="flex gap-1 rounded-lg bg-white/5 p-1">
        {(["estilo", "lista"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors",
              tab === t ? "bg-[var(--brand)] text-white" : "text-[var(--muted-foreground)]",
            )}
          >
            {t === "estilo" ? "Estilo" : `Legendas (${captions.length})`}
          </button>
        ))}
      </div>

      {tab === "estilo" ? (
        <div className="space-y-4 animate-fade-in">
          {/* galeria de animações */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
              Estilo animado
            </span>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {CAPTION_ANIMS.map((a) => (
                <button
                  key={a.id}
                  title={a.hint}
                  onClick={() => setCaptionStyle({ anim: a.id })}
                  className={cn(
                    "w-[104px] shrink-0 rounded-lg border p-2 text-left transition-colors",
                    style.anim === a.id
                      ? "border-[var(--brand)] bg-[var(--brand)]/10"
                      : "border-[var(--border)] hover:border-white/25",
                  )}
                >
                  <span className="grid h-10 place-items-center overflow-hidden rounded bg-black text-[10px] font-bold text-white">
                    <StylePreview id={a.id} />
                  </span>
                  <span className="mt-1 block text-[10px] font-semibold text-[var(--foreground)]">
                    {a.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
            <label className="block space-y-1">
              <span className="text-[11px] text-[var(--muted-foreground)]">Fonte</span>
              <select
                value={style.fontFamily}
                onChange={(e) => setCaptionStyle({ fontFamily: e.target.value })}
                className="w-full rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 text-[11px]"
              >
                {FONTS.map((f) => (
                  <option key={f.value} value={f.value} className="bg-[#1a1a1a]">
                    {f.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] text-[var(--muted-foreground)]">
                Tamanho · {style.fontSize}px
              </span>
              <input
                type="range"
                min={12}
                max={72}
                step={1}
                value={style.fontSize}
                onChange={(e) => setCaptionStyle({ fontSize: Number(e.target.value) })}
                className="w-full accent-[var(--brand)]"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[11px] text-[var(--muted-foreground)]">Cor do texto</span>
                <input
                  type="color"
                  value={style.color}
                  onChange={(e) => setCaptionStyle({ color: e.target.value })}
                  className="h-8 w-full rounded-lg border border-[var(--border)] bg-transparent"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-[var(--muted-foreground)]">Realce / fundo</span>
                <input
                  type="color"
                  value={style.highlight}
                  onChange={(e) => setCaptionStyle({ highlight: e.target.value })}
                  className="h-8 w-full rounded-lg border border-[var(--border)] bg-transparent"
                />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-[11px] text-[var(--muted-foreground)]">
                Opacidade do fundo · {Math.round(style.bgOpacity * 100)}%
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(style.bgOpacity * 100)}
                onChange={(e) => setCaptionStyle({ bgOpacity: Number(e.target.value) / 100 })}
                className="w-full accent-[var(--brand)]"
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

            <div className="flex gap-1.5">
              {(["left", "center", "right"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setCaptionStyle({ align: a })}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold",
                    style.align === a
                      ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                      : "border-[var(--border)] text-[var(--muted-foreground)]",
                  )}
                >
                  {a === "left" ? "Esquerda" : a === "center" ? "Centro" : "Direita"}
                </button>
              ))}
            </div>

            <div className="flex gap-1.5">
              {(
                [
                  ["bold", "N"],
                  ["italic", "I"],
                  ["outline", "Contorno"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setCaptionStyle({ [key]: !style[key] } as never)}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1.5 text-[11px]",
                    key === "bold" && "font-black",
                    key === "italic" && "italic font-semibold",
                    key === "outline" && "font-semibold",
                    style[key]
                      ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                      : "border-[var(--border)] text-[var(--muted-foreground)]",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex gap-1.5">
              {([true, false] as const).map((v) => (
                <button
                  key={String(v)}
                  onClick={() => setCaptionStyle({ wordByWord: v })}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold",
                    style.wordByWord === v
                      ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                      : "border-[var(--border)] text-[var(--muted-foreground)]",
                  )}
                >
                  {v ? "Palavra por palavra" : "Linha inteira"}
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
        </div>
      ) : (
        <div className="space-y-2 animate-fade-in">
          {captions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center text-[11px] text-[var(--muted-foreground)]">
              Nenhuma legenda ainda. Gere as legendas para editar aqui.
            </p>
          ) : (
            captions.map((c) => (
              <div
                key={c.id}
                className="space-y-1.5 rounded-lg border border-[var(--border)] p-2 transition-colors hover:border-white/25"
              >
                <div className="flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
                  <span className="font-mono">
                    {fmt(c.startTime)} → {fmt(c.startTime + c.duration)}
                  </span>
                  <button
                    onClick={() => {
                      select(c.id);
                      setCurrentTime(c.startTime + 0.01);
                    }}
                    className="flex items-center gap-1 font-semibold text-[var(--brand)]"
                  >
                    <Play className="h-3 w-3" /> Ir
                  </button>
                </div>
                <input
                  value={c.textContent ?? ""}
                  onChange={(e) => updateClip(c.id, { textContent: e.target.value })}
                  className="w-full rounded-md bg-white/5 px-2 py-1 text-[11px] text-[var(--foreground)] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                />
              </div>
            ))
          )}
        </div>
      )}

      <button
        onClick={clearCaptions}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-[11px] font-semibold text-[var(--muted-foreground)]"
      >
        <Trash2 className="h-3.5 w-3.5" /> Remover legendas
      </button>
    </div>
  );
}
