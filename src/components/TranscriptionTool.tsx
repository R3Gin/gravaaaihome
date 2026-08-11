import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Copy,
  Download,
  FileDown,
  FileText,
  Loader2,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { transcribe, type CaptionSegment } from "@/lib/captions";
import { takeTranscriptHandoff } from "@/lib/transcript-handoff";
import { summarizeTranscript } from "@/lib/summarize.functions";
import { downloadTranscriptPdf } from "@/lib/transcript-pdf";

const MAX_SECONDS = 15 * 60;

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function downloadText(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function mediaDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const d = el.duration;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) ? d : 0);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    el.src = url;
  });
}

export function TranscriptionTool() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [working, setWorking] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [progress, setProgress] = useState(0);

  const [segments, setSegments] = useState<CaptionSegment[] | null>(null);

  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const startedRef = useRef(false);

  const fullText = useMemo(
    () => (segments ?? []).map((s) => `${fmt(s.start)} — ${s.text.trim()}`).join("\n"),
    [segments],
  );

  const run = useCallback(async (blob: Blob, name: string) => {
    setError(null);
    setSegments(null);
    setSummary(null);
    setFileName(name);

    const isMedia =
      blob.type.startsWith("video/") ||
      blob.type.startsWith("audio/") ||
      /\.(mp4|webm|mov|mkv|mp3|wav|m4a|ogg)$/i.test(name);
    if (!isMedia) {
      setError("Arquivo não suportado. Envie um vídeo (MP4/WebM) ou áudio (MP3, WAV, M4A).");
      return;
    }

    const duration = await mediaDuration(blob);
    if (duration > MAX_SECONDS) {
      setError("Arquivo acima de 15 minutos. Envie um trecho menor para transcrever localmente.");
      return;
    }

    setWorking(true);
    setProgress(0);
    setStage("Preparando áudio…");
    try {
      const result = await transcribe(blob, "portuguese", {
        onStage: (s) =>
          setStage(
            s === "audio"
              ? "Preparando áudio…"
              : s === "model"
                ? "Baixando modelo de transcrição…"
                : "Transcrevendo…",
          ),
        onDownload: (p) => setProgress(p),
      });
      setSegments(result);
      if (result.length === 0) setError("Nenhuma fala reconhecida neste arquivo.");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Falha na transcrição.");
    } finally {
      setWorking(false);
      setStage("");
      setProgress(0);
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const handoff = takeTranscriptHandoff();
    if (handoff) void run(handoff.blob, handoff.name);
  }, [run]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) void run(file, file.name);
    },
    [run],
  );

  const editSegment = useCallback((index: number, text: string) => {
    setSegments((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[index] = { ...next[index], text };
      return next;
    });
  }, []);

  const copy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado`);
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }, []);

  const generateSummary = useCallback(async () => {
    if (!fullText.trim()) return;
    setSummarizing(true);
    setError(null);
    try {
      const plain = (segments ?? []).map((s) => s.text.trim()).join(" ");
      const res = await summarizeTranscript({ data: { text: plain } });
      setSummary(res.summary);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Falha ao gerar o resumo.");
    } finally {
      setSummarizing(false);
    }
  }, [fullText, segments]);

  const baseName = (fileName?.replace(/\.[^.]+$/, "") || "transcricao");

  const downloadAll = useCallback(() => {
    const parts = [`TRANSCRIÇÃO — ${baseName}`, "", fullText];
    if (summary) parts.push("", "RESUMO", "", summary);
    downloadText(`${baseName}-completo.txt`, parts.join("\n"));
  }, [baseName, fullText, summary]);

  const downloadPdf = useCallback(() => {
    downloadTranscriptPdf(`${baseName}.pdf`, {
      title: "Transcrição e Resumo",
      summary,
      segments: (segments ?? []).map((s) => ({ start: s.start, text: s.text })),
    });
  }, [baseName, segments, summary]);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <header className="mb-6 flex items-start justify-between gap-3">
          <div>
            <Link
              to="/"
              className="mb-2 inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar
            </Link>
            <h1 className="font-display text-2xl font-bold tracking-tight">Transcrição e Resumo</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Transforme sua gravação em texto e gere um resumo automático.
            </p>
          </div>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--brand)]/15 text-[var(--brand)]">
            <FileText className="h-6 w-6" />
          </span>
        </header>

        {error ? (
          <div className="mb-4 rounded-lg border border-[var(--brand)]/40 bg-[var(--brand)]/10 px-4 py-3 text-sm text-[var(--brand)]">
            {error}
          </div>
        ) : null}

        {!segments && !working ? (
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-14 text-center transition-colors ${
              dragOver
                ? "border-[var(--brand)] bg-[var(--brand)]/10"
                : "border-white/15 bg-[var(--surface)] hover:border-white/30"
            }`}
          >
            <Upload className="h-8 w-8 text-[var(--brand)]" />
            <div className="text-sm font-medium">Arraste um vídeo ou áudio aqui</div>
            <div className="text-xs text-[var(--muted-foreground)]">
              MP4, WebM, MP3, WAV ou M4A · até 15 minutos (a transcrição roda no seu navegador)
            </div>
            <span className="mt-2 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white">
              Selecionar arquivo
            </span>
            <input
              type="file"
              accept="video/*,audio/*"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </label>
        ) : null}

        {working ? (
          <div className="rounded-2xl border border-white/10 bg-[var(--surface)] p-6">
            <div className="mb-3 flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--brand)]" />
              {stage || "Processando…"}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-[var(--brand)] transition-[width]"
                style={{ width: progress > 0 ? `${Math.round(progress * 100)}%` : "35%" }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              Pode levar de alguns segundos a poucos minutos, dependendo do tamanho e da sua máquina.
            </p>
          </div>
        ) : null}

        {segments && !working ? (
          <div className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-[var(--surface)] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Transcrição · {segments.length} blocos</h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void copy(fullText, "Texto")}
                    className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
                  >
                    <Copy className="h-4 w-4" /> Copiar texto completo
                  </button>
                  <button
                    onClick={() => downloadText(`${baseName}.txt`, fullText)}
                    className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
                  >
                    <Download className="h-4 w-4" /> Baixar .txt
                  </button>
                </div>
              </div>

              <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
                {segments.map((s, i) => (
                  <div key={`${s.start}-${i}`} className="flex gap-3">
                    <span className="mt-2 w-12 shrink-0 font-mono text-xs text-[var(--brand)]">
                      {fmt(s.start)}
                    </span>
                    <textarea
                      value={s.text}
                      onChange={(e) => editSegment(i, e.target.value)}
                      rows={Math.max(1, Math.ceil(s.text.length / 90))}
                      className="w-full resize-y rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[var(--surface)] p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Resumo</h2>
                <button
                  onClick={() => void generateSummary()}
                  disabled={summarizing || fullText.trim().length < 20}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {summarizing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {summarizing ? "Gerando resumo…" : summary ? "Gerar novamente" : "Gerar resumo"}
                </button>
              </div>
              <p className="mb-3 text-xs text-[var(--muted-foreground)]">
                Esta etapa usa IA externa para gerar o resumo — apenas o texto transcrito é enviado,
                nunca o vídeo ou o áudio. O restante da ferramenta roda 100% no seu navegador.
              </p>

              {summarizing ? (
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--brand)]" />
                </div>
              ) : null}

              {summary ? (
                <div className="space-y-3">
                  <div className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 text-sm leading-relaxed">
                    {summary}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => void copy(summary, "Resumo")}
                      className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
                    >
                      <Copy className="h-4 w-4" /> Copiar resumo
                    </button>
                    <button
                      onClick={() => downloadText(`${baseName}-resumo.txt`, summary)}
                      className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
                    >
                      <Download className="h-4 w-4" /> Baixar resumo
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={downloadAll}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white"
              >
                <FileDown className="h-4 w-4" /> Baixar tudo (.txt)
              </button>
              <button
                onClick={downloadPdf}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white"
              >
                <FileDown className="h-4 w-4" /> Baixar PDF
              </button>
              <button
                onClick={() => {
                  setSegments(null);
                  setSummary(null);
                  setFileName(null);
                  setError(null);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
              >
                Trocar arquivo
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
