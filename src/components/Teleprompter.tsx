// Mosaico Teleprompter: o roteiro roda em uma JANELA separada do sistema
// operacional (Document Picture-in-Picture). Como esse conteúdo vive fora do
// documento do Gravaai, ele nunca é capturado pelo getDisplayMedia — mesmo
// quando o usuário compartilha "esta aba" ou "esta janela".
// Fallback (navegadores sem Document PiP): overlay na própria página, com
// aviso persistente de que ele pode aparecer na gravação.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getProcessedMicStream } from "@/lib/mic-audio";
import { denoiseMicStream } from "@/lib/rnnoise";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Type,
} from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import { Wordmark } from "@/components/Brand";
import { VideoPreviewPlayer } from "@/components/VideoPreviewPlayer";
import { useRecorderCore } from "@/hooks/useRecorderCore";
import { useSpeechFollow } from "@/hooks/useSpeechFollow";
import { buildScriptModel, supportsSpeechRecognition } from "@/lib/speech-follow";
import { setEditorHandoff } from "@/lib/editor-handoff";
import { openPipWindow, supportsDocumentPip, type PipWindow } from "@/lib/document-pip";
import { cn } from "@/lib/utils";

const MAX_SECONDS = 30 * 60;
const WARN_SECONDS = MAX_SECONDS - 3 * 60;

type Position = "top" | "center" | "bottom";
type FollowMode = "scroll" | "voice";


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
  const [pipWindow, setPipWindow] = useState<PipWindow | null>(null);
  const [pipSupported, setPipSupported] = useState(true);

  // Controles do teleprompter
  const [wpm, setWpm] = useState(140);
  const [fontSize, setFontSize] = useState(34);
  const [opacity, setOpacity] = useState(70);
  const [position, setPosition] = useState<Position>("center");
  const [scrolling, setScrolling] = useState(true);
  const [followMode, setFollowMode] = useState<FollowMode>("scroll");
  const [voiceSupported, setVoiceSupported] = useState(true);


  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  // Composição: a gravação SEMPRE sai do canvas, nunca da stream crua.
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositeVideoRef = useRef<HTMLVideoElement | null>(null);
  const compositeRafRef = useRef(0);
  const compositeStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);


  const recorder = useRecorderCore({ fileNameBase: "gravaai-teleprompter" });
  const { status, elapsed, stopRecording, startRecording, download, reset } = recorder;

  const recording = status === "recording";

  useEffect(() => {
    setPipSupported(supportsDocumentPip());
    setVoiceSupported(supportsSpeechRecognition());
  }, []);

  // Modelo de segmentos do roteiro (memoizado — só recalcula ao mudar o texto).
  const scriptModel = useMemo(() => buildScriptModel(script), [script]);
  const voiceActive = mode === "live" && followMode === "voice" && recording;
  const {
    segmentIndex,
    listenState,
    unsupported: voiceBlocked,
    stepSegment,
    resetFollow,
  } = useSpeechFollow(scriptModel, voiceActive);
  const segmentRefs = useRef<Array<HTMLSpanElement | null>>([]);

  // Mantém o segmento atual na zona confortável de leitura, sem saltos bruscos.
  useEffect(() => {
    if (followMode !== "voice" || mode !== "live") return;
    const el = scrollerRef.current;
    const target = segmentRefs.current[segmentIndex];
    if (!el || !target) return;
    const top = target.offsetTop - el.clientHeight * 0.35;
    el.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [segmentIndex, followMode, mode]);


  const closePip = useCallback(() => {
    setPipWindow((w) => {
      try {
        w?.close();
      } catch {
        /* noop */
      }
      return null;
    });
  }, []);

  const stopTracks = useCallback(() => {
    if (compositeRafRef.current) cancelAnimationFrame(compositeRafRef.current);
    compositeRafRef.current = 0;
    compositeStreamRef.current?.getTracks().forEach((t) => t.stop());
    compositeStreamRef.current = null;
    if (compositeVideoRef.current) compositeVideoRef.current.srcObject = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current = null;
    micStreamRef.current = null;
  }, []);


  useEffect(
    () => () => {
      stopTracks();
      closePip();
    },
    [stopTracks, closePip],
  );

  // Rolagem automática baseada em palavras por minuto.
  useEffect(() => {
    if (mode !== "live" || !scrolling || !recording || followMode !== "scroll") return;
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
  }, [mode, scrolling, recording, wpm, fontSize, pipWindow, followMode]);

  const nudge = useCallback(
    (dir: 1 | -1) => {
      if (followMode === "voice") {
        stepSegment(dir);
        return;
      }
      const el = scrollerRef.current;
      if (el) el.scrollTop += dir * fontSize * 3;
    },
    [fontSize, followMode, stepSegment],
  );

  const restart = useCallback(() => {
    resetFollow();
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [resetFollow]);


  // Atalhos de teclado (na página e também dentro da janela PiP)
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
    pipWindow?.addEventListener("keydown", onKey as EventListener);
    return () => {
      window.removeEventListener("keydown", onKey);
      pipWindow?.removeEventListener("keydown", onKey as EventListener);
    };
  }, [mode, nudge, pipWindow]);

  const start = useCallback(async () => {
    setCaptureError(null);
    // 1) Abre o teleprompter em janela própria ANTES de pedir a captura, para
    //    que ele já esteja fora do documento que será compartilhado.
    let pip: PipWindow | null = null;
    if (supportsDocumentPip()) {
      pip = await openPipWindow({ width: 560, height: 420 });
      if (pip) {
        pip.addEventListener("pagehide", () => setPipWindow(null));
        setPipWindow(pip);
      }
    }
    try {
      // 2) Só depois o usuário escolhe a fonte de captura.
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      displayStreamRef.current = display;
      let mic: MediaStream | null = null;
      try {
        mic = await getProcessedMicStream();
        micStreamRef.current = mic;
        try {
          const denoised = await denoiseMicStream(mic);
          mic = denoised.stream;
        } catch {
          /* segue com o microfone bruto */
        }
      } catch {
        /* segue sem microfone */
      }
      // 3) Composição em canvas: o vídeo gravado sai SEMPRE do canvas.
      const videoTrack = display.getVideoTracks()[0]!;
      const settings = videoTrack.getSettings();
      const outW = settings.width ?? 1280;
      const outH = settings.height ?? 720;

      let dv = compositeVideoRef.current;
      if (!dv) {
        dv = document.createElement("video");
        dv.muted = true;
        dv.playsInline = true;
        compositeVideoRef.current = dv;
      }
      dv.srcObject = new MediaStream([videoTrack]);
      await dv.play().catch(() => {});

      let canvas = compositeCanvasRef.current;
      if (!canvas) {
        canvas = document.createElement("canvas");
        compositeCanvasRef.current = canvas;
      }
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d")!;
      if (compositeRafRef.current) cancelAnimationFrame(compositeRafRef.current);
      const drawFrame = () => {
        try {
          ctx.drawImage(dv!, 0, 0, canvas!.width, canvas!.height);
        } catch {
          /* frame ainda não pronto */
        }
        compositeRafRef.current = requestAnimationFrame(drawFrame);
      };
      compositeRafRef.current = requestAnimationFrame(drawFrame);

      const canvasStream = canvas.captureStream(30);
      compositeStreamRef.current = canvasStream;

      const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
      const audioTracks = [...display.getAudioTracks(), ...(mic?.getAudioTracks() ?? [])];
      if (audioTracks.length > 1 && typeof AudioContext !== "undefined") {
        const actx = new AudioContext();
        audioCtxRef.current = actx;
        const dest = actx.createMediaStreamDestination();
        audioTracks.forEach((t) => {
          actx.createMediaStreamSource(new MediaStream([t])).connect(dest);
        });
        tracks.push(...dest.stream.getAudioTracks());
      } else {
        tracks.push(...audioTracks);
      }
      videoTrack.addEventListener("ended", () => stopRecording());
      setMode("live");
      setScrolling(true);
      restart();
      startRecording(new MediaStream(tracks));

    } catch (err) {
      console.error("[teleprompter] captura falhou", err);
      if (pip) closePip();
      setCaptureError(
        "Não foi possível iniciar a captura de tela. Permita o compartilhamento e tente novamente.",
      );
    }
  }, [closePip, restart, startRecording, stopRecording]);

  const stop = useCallback(() => {
    // A janela PiP permanece aberta: ela passa a exibir o preview do vídeo.
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
            Cole ou escreva o texto abaixo. Ao iniciar, o teleprompter abre em uma janela separada
            do sistema — assim ele nunca entra no vídeo, mesmo que você compartilhe esta aba.
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

          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Como o roteiro deve avançar
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["scroll", "voice"] as FollowMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setFollowMode(m)}
                  disabled={m === "voice" && !voiceSupported}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-40",
                    followMode === m
                      ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-foreground)] hover:text-white",
                  )}
                >
                  {m === "scroll" ? "Rolagem automática" : "Acompanhar minha fala"}
                </button>
              ))}
            </div>
            {!voiceSupported && (
              <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                Seu navegador não oferece suporte ao acompanhamento por voz. Use a rolagem
                automática.
              </p>
            )}
          </div>


          {pipSupported ? (
            <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--muted-foreground)]">
              Dica: se você compartilhar a <strong>tela inteira</strong>, posicione a janela do
              teleprompter fora da área/monitor compartilhado — ou prefira compartilhar apenas uma
              janela específica.
            </p>
          ) : (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-[var(--brand)]/40 bg-[var(--brand)]/10 p-3 text-sm text-[var(--brand)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Seu navegador não suporta abrir o teleprompter em janela separada. Ele pode aparecer
              na gravação se você compartilhar esta aba ou a tela inteira — recomendamos
              compartilhar apenas outra janela/aplicativo específico.
            </p>
          )}

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

  const listenLabel =
    listenState === "following"
      ? "Acompanhando sua fala"
      : listenState === "waiting"
        ? "Aguardando você continuar"
        : "Ouvindo";

  const controls = (
    <div className={cn("flex flex-wrap items-end gap-4", pipWindow ? "px-3 pb-3" : "mx-auto max-w-5xl")}>
      <div className="flex flex-wrap gap-2">
        {followMode === "scroll" ? (
          <ActionButton
            tone={scrolling ? "neutral" : "record"}
            icon={scrolling ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            onClick={() => setScrolling((s) => !s)}
          >
            {scrolling ? "Pausar" : "Rolar"}
          </ActionButton>
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
              listenState === "following"
                ? "bg-[var(--brand)]/15 text-[var(--brand)]"
                : "bg-white/5 text-[var(--muted-foreground)]",
            )}
          >
            <Mic className="h-3.5 w-3.5" />
            {listenLabel}
          </span>
        )}
        <ActionButton icon={<RotateCcw className="h-4 w-4" />} onClick={restart}>
          Reiniciar
        </ActionButton>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setFollowMode("scroll")}
          className={cn(
            "rounded-md border px-2 py-1 text-[11px]",
            followMode === "scroll"
              ? "border-[var(--brand)] text-[var(--brand)]"
              : "border-[var(--border)] text-[var(--muted-foreground)]",
          )}
        >
          Rolagem
        </button>
        <button
          type="button"
          disabled={!voiceSupported}
          onClick={() => setFollowMode("voice")}
          className={cn(
            "rounded-md border px-2 py-1 text-[11px] disabled:opacity-40",
            followMode === "voice"
              ? "border-[var(--brand)] text-[var(--brand)]"
              : "border-[var(--border)] text-[var(--muted-foreground)]",
          )}
        >
          Acompanhar minha fala
        </button>
      </div>
      {followMode === "scroll" && (
        <Slider label="Velocidade" value={wpm} min={60} max={300} step={10} suffix=" ppm" onChange={setWpm} />
      )}
      <Slider label="Fonte" value={fontSize} min={18} max={72} suffix="px" onChange={setFontSize} />
      {!pipWindow && (
        <>
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
        </>
      )}
      {followMode === "voice" && voiceBlocked && (
        <span className="w-full text-[11px] text-[var(--muted-foreground)]">
          Não foi possível ouvir o microfone neste navegador. Use a rolagem automática.
        </span>
      )}
      <span className="w-full text-[11px] text-[var(--muted-foreground)]">
        Atalhos: espaço = play/pause da rolagem · setas = avançar/retroceder
      </span>
    </div>
  );

  const scroller = (
    <div
      ref={scrollerRef}
      className={cn(
        "overflow-y-auto whitespace-pre-wrap text-center leading-relaxed",
        pipWindow ? "flex-1" : "max-h-[45vh]",
      )}
      style={{ fontSize, lineHeight: 1.5 }}
    >
      {followMode === "voice" && scriptModel.segments.length ? (
        <p className="whitespace-pre-wrap">
          {scriptModel.segments.map((seg, i) => (
            <span
              key={seg.index}
              ref={(el) => {
                segmentRefs.current[i] = el;
              }}
              className={cn(
                "transition-opacity duration-300",
                i < segmentIndex
                  ? "text-[var(--muted-foreground)] opacity-45"
                  : i === segmentIndex
                    ? "font-semibold text-white"
                    : "text-white/70",
              )}
            >
              {seg.text}{" "}
            </span>
          ))}
        </p>
      ) : (
        script
      )}
      <div style={{ height: pipWindow ? "60%" : "40vh" }} />
    </div>
  );

  const finished = status === "ready" && recorder.downloadUrl;

  const previewPanel = finished ? (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-3">
      <p className="text-sm font-semibold text-white">Gravação concluída</p>
      <VideoPreviewPlayer
        src={recorder.downloadUrl!}
        ownerDocument={pipWindow?.document}
      />
      <div className="flex flex-wrap gap-2">
        <ActionButton tone="download" icon={<Download className="h-4 w-4" />} onClick={download}>
          Baixar MP4
        </ActionButton>
        <ActionButton
          onClick={() => {
            reset();
            resetFollow();
            closePip();
            setMode("prep");
          }}
        >
          Nova gravação
        </ActionButton>
      </div>
    </div>
  ) : null;


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

      {pipWindow ? (
        <>
          {createPortal(
            <div className="flex h-full w-full flex-col bg-[var(--background)] p-4 text-[var(--foreground)]">
              <p className="mb-2 shrink-0 text-[11px] font-semibold text-[var(--muted-foreground)]">
                Teleprompter · janela separada (não entra na gravação)
              </p>
              {scroller}
              <div className="mt-3 shrink-0 border-t border-[var(--border)] pt-3">{controls}</div>
            </div>,
            pipWindow.document.body,
          )}
          <main className="flex flex-1 items-center justify-center px-6 text-center">
            <div className="max-w-md text-sm text-[var(--muted-foreground)]">
              <p className="font-semibold text-[var(--foreground)]">
                O roteiro está rolando na janela do teleprompter.
              </p>
              <p className="mt-2">
                Ela vive fora desta página, então não aparece no vídeo. Se estiver compartilhando a
                tela inteira, mova essa janela para fora da área/monitor capturado.
              </p>
            </div>
          </main>
        </>
      ) : (
        <>
          <div className="flex items-start gap-2 bg-[var(--brand)]/15 px-4 py-2 text-xs text-[var(--brand)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Seu navegador não suporta abrir o teleprompter em janela separada. Ele pode aparecer na
            gravação se você compartilhar esta aba ou a tela inteira — prefira compartilhar outra
            janela/aplicativo específico.
          </div>
          <main className={cn("relative flex flex-1 justify-center px-4", positionClass)}>
            <div
              className="w-full max-w-4xl rounded-2xl border border-white/10 p-6"
              style={{ backgroundColor: `rgba(0,0,0,${opacity / 100})` }}
            >
              {scroller}
            </div>
          </main>
          <footer className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">{controls}</footer>
        </>
      )}
    </div>
  );
}
