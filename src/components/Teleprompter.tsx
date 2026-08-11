// Mosaico Teleprompter: roteiro rolando na tela do app enquanto o usuário grava
// outra tela/janela/aba. O overlay vive nesta página — logo, não entra no vídeo
// quando a captura é de outra superfície.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Type,
} from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import { Wordmark } from "@/components/Brand";
import { useRecorderCore } from "@/hooks/useRecorderCore";
import { setEditorHandoff } from "@/lib/editor-handoff";
import { cn } from "@/lib/utils";

const MAX_SECONDS = 30 * 60;
const WARN_SECONDS = MAX_SECONDS - 3 * 60;

type Position = "top" | "center" | "bottom";

function formatTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex min-w-[150px] flex-1 flex-col gap-1 text-[11px] text-[var(--muted-foreground)]">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="font-semibold text-[var(--foreground)]">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-[var(--brand)]"
      />
    </label>
  );
}

export function Teleprompter() {
  const navigate = useNavigate();
  const [script, setScript] = useState("");
  const [mode, setMode] = useState<"prep" | "live">("prep");
  const [captureError, setCaptureError] = useState<string | null>(null);

  // Controles do teleprompter
  const [wpm, setWpm] = useState(140);
  const [fontSize, setFontSize] = useState(34);
  const [opacity, setOpacity] = useState(70);
  const [position, setPosition] = useState<Position>("center");
  const [scrolling, setScrolling] = useState(true);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);

  const recorder = useRecorderCore({ fileNameBase: "gravaai-teleprompter" });
  const { status, elapsed, stopRecording, startRecording, download, reset } = recorder;

  const recording = status === "recording";

  const stopTracks = useCallback(() => {
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current = null;
    micStreamRef.current = null;
  }, []);

  useEffect(() => () => stopTracks(), [stopTracks]);

  // Rolagem automática baseada em palavras por minuto.
  useEffect(() => {
    if (mode !== "live" || !scrolling || !recording) return;
    const el = scrollerRef.current;
    if (!el) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      // ~1 linha por 9 palavras; converte wpm em px/s pela altura da linha.
      const lineHeight = fontSize * 1.5;
      const pxPerSec = (wpm / 9 / 60) * lineHeight;
      el.scrollTop = Math.min(el.scrollTop + pxPerSec * dt, el.scrollHeight);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [mode, scrolling, recording, wpm, fontSize]);

  const nudge = useCallback((dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (el) el.scrollTop += dir * fontSize * 3;
  }, [fontSize]);

  const restart = useCallback(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, []);

  // Atalhos de teclado
  useEffect(() => {
    if (mode !== "live") return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea/i.test(target.tagName)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setScrolling((s) => !s);
      } else if (e.code === "ArrowDown" || e.code === "ArrowRight") {
        e.preventDefault();
        nudge(1);
      } else if (e.code === "ArrowUp" || e.code === "ArrowLeft") {
        e.preventDefault();
        nudge(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, nudge]);

  const start = useCallback(async () => {
    setCaptureError(null);
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      displayStreamRef.current = display;
      let mic: MediaStream | null = null;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = mic;
      } catch {
        /* segue sem microfone */
      }
      const tracks: MediaStreamTrack[] = [...display.getVideoTracks()];
      const audioTracks = [...display.getAudioTracks(), ...(mic?.getAudioTracks() ?? [])];
      if (audioTracks.length > 1 && typeof AudioContext !== "undefined") {
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        audioTracks.forEach((t) => {
          ctx.createMediaStreamSource(new MediaStream([t])).connect(dest);
        });
        tracks.push(...dest.stream.getAudioTracks());
      } else {
        tracks.push(...audioTracks);
      }
      display.getVideoTracks()[0]?.addEventListener("ended", () => stopRecording());
      setMode("live");
      setScrolling(true);
      restart();
      startRecording(new MediaStream(tracks));
    } catch (err) {
      console.error("[teleprompter] captura falhou", err);
      setCaptureError("Não foi possível iniciar a captura de tela. Permita o compartilhamento e tente novamente.");
    }
  }, [restart, startRecording, stopRecording]);

  const stop = useCallback(() => {
    stopRecording();
    stopTracks();
  }, [stopRecording, stopTracks]);

  // Limite de 30 minutos
  useEffect(() => {
    if (recording && elapsed >= MAX_SECONDS) stop();
  }, [recording, elapsed, stop]);

  const sendToEditor = useCallback(async () => {
    if (!recorder.downloadUrl) return;
    const blob = await fetch(recorder.downloadUrl).then((r) => r.blob());
    setEditorHandoff(blob, "teleprompter.mp4");
    navigate({ to: "/mosaicos/editor" });
  }, [navigate, recorder.downloadUrl]);

  const words = useMemo(() => script.trim().split(/\s+/).filter(Boolean).length, [script]);
  const nearLimit = recording && elapsed >= WARN_SECONDS;

  const positionClass =
    position === "top" ? "items-start pt-6" : position === "bottom" ? "items-end pb-6" : "items-center";

  if (mode === "prep") {
    return (
      <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
        <header className="border-b border-[var(--border)] px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-3xl items-center justify-between">
            <Wordmark />
            <span className="text-xs text-[var(--muted-foreground)]">Teleprompter</span>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            Leia seu roteiro enquanto grava
          </h1>
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">
            Cole ou escreva o texto abaixo. Durante a gravação ele rola nesta página — e não aparece
            no vídeo se você compartilhar outra aba, janela ou tela.
          </p>

          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="Cole aqui o roteiro que você vai narrar…"
            className="mt-6 h-72 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-relaxed outline-none focus:border-[var(--brand)]"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
            <span>{words} palavra{words === 1 ? "" : "s"} · ~{Math.max(1, Math.round(words / 140))} min de leitura</span>
            <span>Limite de gravação: 30 minutos</span>
          </div>

          {captureError && (
            <p className="mt-4 rounded-lg border border-[var(--brand)]/40 bg-[var(--brand)]/10 p-3 text-sm text-[var(--brand)]">
              {captureError}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <ActionButton tone="record" icon={<Type className="h-4 w-4" />} disabled={!script.trim()} onClick={start}>
              Iniciar gravação com teleprompter
            </ActionButton>
            <ActionButton icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate({ to: "/" })}>
              Voltar
            </ActionButton>
          </div>
          {!script.trim() && (
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">Escreva o roteiro para liberar a gravação.</p>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)] text-[var(--foreground)]">
      {/* Barra de status da gravação */}
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <Wordmark />
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold",
            recording ? "bg-[var(--brand)]/15 text-[var(--brand)]" : "bg-white/5 text-[var(--muted-foreground)]",
          )}
        >
          {recording && <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--brand)]" />}
          {status === "converting" ? "Convertendo…" : status === "ready" ? "Gravação finalizada" : "Gravando"}
          {" · "}
          {formatTime(elapsed)}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {recording && (
            <ActionButton tone="stop" onClick={stop}>
              Parar gravação
            </ActionButton>
          )}
          {status === "ready" && (
            <>
              <ActionButton tone="download" icon={<Download className="h-4 w-4" />} onClick={download}>
                Baixar MP4
              </ActionButton>
              <ActionButton icon={<Scissors className="h-4 w-4" />} onClick={sendToEditor}>
                Enviar para o editor
              </ActionButton>
              <ActionButton
                onClick={() => {
                  reset();
                  setMode("prep");
                }}
              >
                Nova gravação
              </ActionButton>
            </>
          )}
        </div>
      </header>

      {nearLimit && (
        <div className="flex items-center gap-2 bg-[var(--brand)]/15 px-4 py-2 text-xs text-[var(--brand)]">
          <AlertTriangle className="h-4 w-4" />
          Faltam menos de 3 minutos para o limite de 30 minutos.
        </div>
      )}
      {status === "converting" && (
        <div className="px-4 py-2 text-xs text-[var(--muted-foreground)]">
          Gerando MP4… {Math.round(recorder.convertProgress * 100)}%
        </div>
      )}
      {recorder.error && (
        <div className="px-4 py-2 text-xs text-[var(--brand)]">{recorder.error}</div>
      )}

      {/* Palco do teleprompter */}
      <main className={cn("relative flex flex-1 justify-center px-4", positionClass)}>
        <div
          className="w-full max-w-4xl rounded-2xl border border-white/10 p-6"
          style={{ backgroundColor: `rgba(0,0,0,${opacity / 100})` }}
        >
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-[var(--muted-foreground)]">
            Este texto não aparece na sua gravação
          </p>
          <div
            ref={scrollerRef}
            className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap text-center leading-relaxed"
            style={{ fontSize, lineHeight: 1.5 }}
          >
            {script}
            <div style={{ height: "40vh" }} />
          </div>
        </div>
      </main>

      {/* Controles */}
      <footer className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end gap-4">
          <div className="flex gap-2">
            <ActionButton
              tone={scrolling ? "neutral" : "record"}
              icon={scrolling ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              onClick={() => setScrolling((s) => !s)}
            >
              {scrolling ? "Pausar" : "Rolar"}
            </ActionButton>
            <ActionButton icon={<RotateCcw className="h-4 w-4" />} onClick={restart}>
              Reiniciar
            </ActionButton>
          </div>
          <Slider label="Velocidade" value={wpm} min={60} max={300} step={10} suffix=" ppm" onChange={setWpm} />
          <Slider label="Fonte" value={fontSize} min={18} max={72} suffix="px" onChange={setFontSize} />
          <Slider label="Opacidade do fundo" value={opacity} min={0} max={100} suffix="%" onChange={setOpacity} />
          <label className="flex flex-col gap-1 text-[11px] text-[var(--muted-foreground)]">
            Posição
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as Position)}
              className="h-[34px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-sm text-[var(--foreground)]"
            >
              <option value="top">Topo</option>
              <option value="center">Centro</option>
              <option value="bottom">Base</option>
            </select>
          </label>
          <span className="w-full text-[11px] text-[var(--muted-foreground)]">
            Atalhos: espaço = play/pause da rolagem · setas = avançar/retroceder
          </span>
        </div>
      </footer>
    </div>
  );
}
