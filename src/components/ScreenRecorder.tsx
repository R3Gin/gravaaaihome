import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionButton } from "./ActionButton";
import { Toggle } from "./Toggle";
import { convertWebmToMp4, fixWebmSeekable, remuxMp4FastStart } from "@/lib/ffmpeg-convert";
import { cn } from "@/lib/utils";
import { setEditorHandoff } from "@/lib/editor-handoff";
import { setGifHandoff } from "@/lib/gif-handoff";
import { useNavigate } from "@tanstack/react-router";
import {
  CameraPipBubble,
  useCameraPip,
  drawCameraPipCircle,
} from "./CameraPip";
import { Button } from "@/components/ui/button";
import {
  DrawingCanvas,
  DrawingToolbar,
  drawStrokes,
  useDrawing,
} from "./DrawingLayer";
import {
  FloatingRecorderPanel,
  type FloatingRecorderPanelHandle,
} from "./FloatingRecorderPanel";

type Status = "idle" | "capturing" | "recording" | "converting" | "ready";

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
    </svg>
  );
}
function GifIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M11 9.5A2.5 2.5 0 1 0 11 15h1v-2" />
      <path d="M15 9v6" />
      <path d="M18 15V9h3" />
      <path d="M18 12h2" />
    </svg>
  );
}

function ScissorsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.12 15.88" /><path d="M14.47 14.48 20 20" /><path d="M8.12 8.12 12 12" />
    </svg>
  );
}
function PenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M12 19l7-7-4-4-7 7-1 5z" /><path d="m16 5 3 3" />
    </svg>
  );
}
function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <rect x="2" y="4" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" />
    </svg>
  );
}
function ScreenShareIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={cn("h-6 w-6", className)}>
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M12 14V8" />
      <path d="m9 11 3-3 3 3" />
    </svg>
  );
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function ScreenRecorder() {
  const [supported] = useState(
    () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia,
  );
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("idle");
  const [screenAudio, setScreenAudio] = useState(true);
  const [micAudio, setMicAudio] = useState(false);
  const [paused, setPaused] = useState(false);
  const [screenAudioEnabled, setScreenAudioEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [convertProgress, setConvertProgress] = useState(0);
  const [downloadExt, setDownloadExt] = useState<"mp4" | "webm">("mp4");

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const screenSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const screenGainRef = useRef<GainNode | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const outputStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const downloadBlobRef = useRef<Blob | null>(null);
  const rawRecordingSizeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef = useRef<Status>("idle");
  const recordStartedAtRef = useRef<number>(0);
  const pausedAccumRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);

  // Pipeline de composição (tela + bolha da câmera) via <canvas>.
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayVideoRef = useRef<HTMLVideoElement | null>(null);
  const compositeStreamRef = useRef<MediaStream | null>(null);
  const compositeRafRef = useRef<number>(0);

  const camera = useCameraPip({ initial: { x: 16, y: 16, size: 140 } });
  const drawing = useDrawing();
  const drawStrokesRef = drawing.strokesRef;
  const panelRef = useRef<FloatingRecorderPanelHandle | null>(null);
  const bubbleRef = useRef(camera.bubble);
  useEffect(() => {
    bubbleRef.current = camera.bubble;
  }, [camera.bubble]);
  const cameraActiveRef = useRef(camera.active);
  useEffect(() => {
    cameraActiveRef.current = camera.active;
  }, [camera.active]);
  const cameraEffectRef = useRef(camera.effect);
  useEffect(() => {
    cameraEffectRef.current = camera.effect;
  }, [camera.effect]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const cleanupAudioGraph = useCallback(() => {
    try { screenSourceRef.current?.disconnect(); } catch { /* noop */ }
    try { micSourceRef.current?.disconnect(); } catch { /* noop */ }
    try { screenGainRef.current?.disconnect(); } catch { /* noop */ }
    try { micGainRef.current?.disconnect(); } catch { /* noop */ }
    try { destRef.current?.disconnect(); } catch { /* noop */ }
    screenSourceRef.current = null;
    micSourceRef.current = null;
    screenGainRef.current = null;
    micGainRef.current = null;
    destRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const stopEverything = useCallback((options?: { keepPreview?: boolean }) => {
    const keepPreview = options?.keepPreview ?? statusRef.current === "ready";
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current = null;
    micStreamRef.current = null;
    outputStreamRef.current = null;
    cleanupAudioGraph();
    if (compositeRafRef.current) cancelAnimationFrame(compositeRafRef.current);
    compositeRafRef.current = 0;
    compositeStreamRef.current?.getTracks().forEach((t) => t.stop());
    compositeStreamRef.current = null;
    if (displayVideoRef.current) displayVideoRef.current.srcObject = null;
    if (previewRef.current && !keepPreview) {
      previewRef.current.removeAttribute("src");
      previewRef.current.srcObject = null;
      previewRef.current.controls = false;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [cleanupAudioGraph]);

  useEffect(() => () => stopEverything(), [stopEverything]);

  // Rebuild output MediaStream from current display video track + mixed audio.
  const rebuildOutputStream = useCallback(() => {
    // Usamos o canvas composto (tela + bolha) como fonte de vídeo quando ele
    // existe. Isso permite ligar/desligar a câmera durante a gravação sem
    // precisar parar o MediaRecorder.
    const videoTrack =
      compositeStreamRef.current?.getVideoTracks()[0] ??
      displayStreamRef.current?.getVideoTracks()[0];
    if (!videoTrack) return null;
    const audioTrack = destRef.current?.stream.getAudioTracks()[0];
    const stream = new MediaStream();
    stream.addTrack(videoTrack);
    if (audioTrack) stream.addTrack(audioTrack);
    outputStreamRef.current = stream;
    return stream;
  }, []);

  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioCtxRef.current = new Ctx();
      destRef.current = audioCtxRef.current.createMediaStreamDestination();
    }
    return { ctx: audioCtxRef.current!, dest: destRef.current! };
  }, []);

  const attachScreenAudio = useCallback(() => {
    const stream = displayStreamRef.current;
    if (!stream || stream.getAudioTracks().length === 0) return;
    const { ctx, dest } = ensureAudioContext();
    if (screenSourceRef.current) return;
    const audioOnly = new MediaStream(stream.getAudioTracks());
    const src = ctx.createMediaStreamSource(audioOnly);
    const gain = ctx.createGain();
    gain.gain.value = 0.7;
    src.connect(gain).connect(dest);
    screenSourceRef.current = src;
    screenGainRef.current = gain;
  }, [ensureAudioContext]);

  const detachScreenAudio = useCallback(() => {
    try { screenSourceRef.current?.disconnect(); } catch { /* noop */ }
    try { screenGainRef.current?.disconnect(); } catch { /* noop */ }
    screenSourceRef.current = null;
    screenGainRef.current = null;
    displayStreamRef.current?.getAudioTracks().forEach((t) => {
      t.stop();
      displayStreamRef.current?.removeTrack(t);
    });
  }, []);

  const attachMic = useCallback(async () => {
    if (micStreamRef.current) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = stream;
    const { ctx, dest } = ensureAudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain();
    gain.gain.value = 0.7;
    src.connect(gain).connect(dest);
    micSourceRef.current = src;
    micGainRef.current = gain;
  }, [ensureAudioContext]);

  const detachMic = useCallback(() => {
    try { micSourceRef.current?.disconnect(); } catch { /* noop */ }
    try { micGainRef.current?.disconnect(); } catch { /* noop */ }
    micSourceRef.current = null;
    micGainRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }, []);

  // Inicia (ou reinicia) o loop de composição: desenha o frame do vídeo de
  // tela no canvas e sobrepõe a bolha da câmera quando ativa. O
  // captureStream() do canvas vira a faixa de vídeo enviada ao MediaRecorder.
  const startComposite = useCallback(async () => {
    const display = displayStreamRef.current;
    if (!display) return null;
    const videoTrack = display.getVideoTracks()[0];
    if (!videoTrack) return null;
    const s = videoTrack.getSettings();
    const outW = s.width ?? 1280;
    const outH = s.height ?? 720;

    let dv = displayVideoRef.current;
    if (!dv) {
      dv = document.createElement("video");
      dv.muted = true;
      dv.playsInline = true;
      displayVideoRef.current = dv;
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
      } catch { /* frame não pronto */ }
      const camVideo = camera.videoRef.current;
      const camCanvas = camera.effectCanvasRef.current;
      const hasEffect = cameraEffectRef.current !== "none" && !!camCanvas;
      const camSource = hasEffect ? camCanvas! : camVideo;
      const camReady = hasEffect
        ? !!camCanvas && camCanvas.width > 0
        : !!camVideo && camVideo.readyState >= 2 && camVideo.videoWidth > 0;
      if (
        cameraActiveRef.current &&
        camSource &&
        camReady
      ) {
        const container = previewContainerRef.current;
        const rect = container?.getBoundingClientRect();
        const sx = rect && rect.width > 0 ? canvas!.width / rect.width : 1;
        const sy = rect && rect.height > 0 ? canvas!.height / rect.height : 1;
        const b = bubbleRef.current;
        const bx = b.x * sx;
        const by = b.y * sy;
        const bs = b.size * Math.min(sx, sy);
        drawCameraPipCircle(ctx, camSource, bx, by, bs);
      }
      // Traços da caneta (mesma escala do container do preview) — vão para o MP4.
      if (drawStrokesRef.current.length > 0) {
        const container = previewContainerRef.current;
        const rect = container?.getBoundingClientRect();
        const sx = rect && rect.width > 0 ? canvas!.width / rect.width : 1;
        const sy = rect && rect.height > 0 ? canvas!.height / rect.height : 1;
        drawStrokes(ctx, drawStrokesRef.current, sx, sy);
      }
      compositeRafRef.current = requestAnimationFrame(drawFrame);
    };
    compositeRafRef.current = requestAnimationFrame(drawFrame);

    const stream = canvas.captureStream(30);
    compositeStreamRef.current = stream;
    return stream.getVideoTracks()[0] ?? null;
  }, [camera, drawStrokesRef]);

  const startCapture = useCallback(async () => {
    setError(null);
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }
    downloadBlobRef.current = null;
    rawRecordingSizeRef.current = 0;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: screenAudio,
        // Impede que o próprio app (incluindo a janela flutuante de PiP)
        // apareça como opção no picker/captura.
        // @ts-expect-error - constraint experimental (Chromium)
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        systemAudio: screenAudio ? "include" : "exclude",
      });
      displayStreamRef.current = stream;
      // If user stops sharing from the browser bar
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        } else {
          stopEverything();
          setStatus("idle");
        }
      });
      if (screenAudio) attachScreenAudio();
      if (micAudio) await attachMic();
      await startComposite();
      // O output composto (canvas → captureStream) alimenta a gravação, mas
      // o PREVIEW mostra apenas a tela crua para evitar bolha duplicada
      // (a bolha HTML sobreposta já aparece por cima do preview).
      rebuildOutputStream();
      if (previewRef.current) {
        const previewVideo = displayStreamRef.current?.getVideoTracks()[0];
        if (previewVideo) {
          previewRef.current.srcObject = new MediaStream([previewVideo]);
          previewRef.current.muted = true;
          previewRef.current.play().catch(() => {});
        }
      }
      setStatus("capturing");
      // Devolve o foco para a janela do Gravaai após a seleção do picker.
      try { window.focus(); } catch { /* noop */ }
      setTimeout(() => { try { window.focus(); } catch { /* noop */ } }, 100);
    } catch (err) {
      console.error(err);
      setError("Não foi possível iniciar a captura. Verifique as permissões e tente novamente.");
      stopEverything();
      setStatus("idle");
    }
  }, [screenAudio, micAudio, attachScreenAudio, attachMic, rebuildOutputStream, stopEverything, downloadUrl, startComposite]);

  // React to toggle changes while capturing/recording.
  const handleScreenAudioToggle = useCallback(
    async (v: boolean) => {
      setScreenAudio(v);
      const hasDisplay = !!displayStreamRef.current;
      if (!hasDisplay) return;
      try {
        if (v) {
          // Re-request display media just for audio isn't possible without picker;
          // if no audio track exists, we need a new getDisplayMedia call.
          const existingAudio = displayStreamRef.current?.getAudioTracks().length ?? 0;
          if (existingAudio === 0) {
            const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            // Replace video track and take audio track from the new stream.
            const newVideo = s.getVideoTracks()[0];
            const newAudio = s.getAudioTracks()[0];
            displayStreamRef.current?.getVideoTracks().forEach((t) => t.stop());
            const combined = new MediaStream();
            combined.addTrack(newVideo);
            if (newAudio) combined.addTrack(newAudio);
            displayStreamRef.current = combined;
            newVideo.addEventListener("ended", () => {
              if (recorderRef.current && recorderRef.current.state !== "inactive") {
                recorderRef.current.stop();
              }
            });
          }
          attachScreenAudio();
        } else {
          detachScreenAudio();
        }
        const output = rebuildOutputStream();
        if (previewRef.current && output) previewRef.current.srcObject = output;
        // If recording, replace the audio track on the recorder is not trivial —
        // MediaRecorder captures the stream reference on start(); we bake the
        // output stream at start time. Live audio changes during recording take
        // effect via the shared MediaStreamDestination automatically because
        // the audio track object stays the same.
      } catch (err) {
        console.error(err);
        setError("Não foi possível alternar o áudio da tela.");
      }
    },
    [attachScreenAudio, detachScreenAudio, rebuildOutputStream],
  );

  const handleMicToggle = useCallback(
    async (v: boolean) => {
      setMicAudio(v);
      if (!displayStreamRef.current) return;
      try {
        if (v) await attachMic();
        else detachMic();
        const output = rebuildOutputStream();
        if (previewRef.current && output) previewRef.current.srcObject = output;
      } catch (err) {
        console.error(err);
        setError("Não foi possível acessar o microfone.");
        setMicAudio(false);
      }
    },
    [attachMic, detachMic, rebuildOutputStream],
  );

  const startRecording = useCallback(() => {
    const stream = outputStreamRef.current ?? rebuildOutputStream();
    if (!stream) {
      setError("Nenhuma captura ativa. Clique em \"Iniciar captura\" antes de gravar.");
      return;
    }
    if (stream.getVideoTracks().length === 0) {
      setError("A captura de tela não tem faixa de vídeo ativa. Reinicie a captura.");
      return;
    }
    chunksRef.current = [];
    setDownloadUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setElapsed(0);
    // Prioriza MP4 nativo (Chrome 130+/Safari) para evitar a conversão via
    // ffmpeg.wasm. Cai para WebM em navegadores como Firefox — nesse caso o
    // pipeline de conversão continua rodando como fallback.
    const mimeCandidates = [
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    // Alguns navegadores retornam isTypeSupported=true para MP4 mas lançam
    // NotSupportedError no `new MediaRecorder(...)`. Vamos tentando na ordem
    // até um construtor realmente funcionar.
    let rec: MediaRecorder | null = null;
    let chosenMime = "";
    for (const candidate of mimeCandidates) {
      if (!MediaRecorder.isTypeSupported(candidate)) continue;
      try {
        rec = new MediaRecorder(stream, { mimeType: candidate });
        chosenMime = candidate;
        break;
      } catch (err) {
        console.warn("[gravaai] MediaRecorder rejeitou", candidate, err);
      }
    }
    if (!rec) {
      try {
        rec = new MediaRecorder(stream);
        chosenMime = rec.mimeType || "video/webm";
      } catch (err) {
        console.error("[gravaai] MediaRecorder falhou totalmente:", err);
        setError("Este navegador não conseguiu iniciar a gravação. Tente no Chrome desktop mais recente.");
        return;
      }
    }
    console.log("[gravaai] gravando com mimeType:", chosenMime);
    const isNativeMp4 = chosenMime.startsWith("video/mp4");
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        console.log("[gravaai] chunk recebido:", e.data.size, e.data.type);
        chunksRef.current.push(e.data);
      }
    };
    rec.onerror = (e) => {
      console.error("[gravaai] MediaRecorder onerror:", e);
      setError("A gravação falhou durante a captura. Tente novamente.");
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setStatus(displayStreamRef.current ? "capturing" : "idle");
    };
    rec.onstart = () => {
      console.log("[gravaai] MediaRecorder onstart");
      setStatus("recording");
      setPaused(false);
      setScreenAudioEnabled(true);
      setMicEnabled(true);
      pausedAccumRef.current = 0;
      pausedAtRef.current = 0;
      const started = Date.now();
      recordStartedAtRef.current = started;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        const pausedNow = pausedAtRef.current
          ? Date.now() - pausedAtRef.current
          : 0;
        setElapsed(
          (Date.now() - started - pausedAccumRef.current - pausedNow) / 1000,
        );
      }, 250);
    };
    rec.onstop = async () => {
      const recordedType = isNativeMp4 ? "video/mp4" : "video/webm";
      if (chunksRef.current.length === 0) {
        console.error("[gravaai] gravação finalizada sem chunks");
        setError("A gravação terminou sem dados. Reinicie a captura e tente novamente.");
        stopEverything();
        setStatus("idle");
        return;
      }
      let blob = new Blob(chunksRef.current, { type: recordedType });
      rawRecordingSizeRef.current = blob.size;
      console.log("[gravaai] blob gravado:", blob.size, blob.type);
      chunksRef.current = [];
      // Patch WebM header with real duration so o arquivo fica "seekable"
      // (MediaRecorder não escreve o Duration por padrão). Feito ANTES do
      // ffmpeg e também protege o fallback caso a conversão falhe.
      if (!isNativeMp4) {
        const durMs = Date.now() - (recordStartedAtRef.current || Date.now());
        blob = await fixWebmSeekable(blob, durMs);
      }
      // Stop capture streams now that recording is done.
      displayStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
      micStreamRef.current = null;
      cleanupAudioGraph();
      outputStreamRef.current = null;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      const showReady = (mp4Blob: Blob) => {
        downloadBlobRef.current = mp4Blob;
        const url = URL.createObjectURL(mp4Blob);
        setDownloadUrl(url);
        setDownloadExt("mp4");
        if (previewRef.current) {
          previewRef.current.srcObject = null;
          previewRef.current.src = url;
          previewRef.current.muted = false;
          previewRef.current.controls = true;
          previewRef.current.load();
        }
        setStatus("ready");
      };
      setStatus("converting");
      setConvertProgress(0);
      try {
        const mp4 = isNativeMp4
          ? await remuxMp4FastStart(blob, (r) => setConvertProgress(r))
          : await convertWebmToMp4(blob, (r) => setConvertProgress(r));
        showReady(mp4);
      } catch (err) {
        console.error("[gravaai] processamento MP4 falhou:", err);
        downloadBlobRef.current = null;
        setDownloadUrl(null);
        setError("Não foi possível gerar um MP4 válido para download. Tente gravar novamente.");
        setStatus("idle");
      }
    };
    recorderRef.current = rec;
    try {
      rec.start(1000);
      // Abre a janela de Document PiP no MESMO gesto do clique em "Gravar"
      // — requestWindow() precisa de user activation.
      panelRef.current?.openPip().catch(() => {
        /* usuário pode ter negado; painel cai no fallback fixo */
      });
    } catch (err) {
      console.error("[gravaai] rec.start falhou:", err);
      setError("Não foi possível iniciar a gravação. Reinicie a captura e tente novamente.");
    }
  }, [rebuildOutputStream, cleanupAudioGraph]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.requestData(); } catch { /* noop */ }
      recorder.stop();
    }
    setPaused(false);
  }, []);

  // Pausa/retoma sem interromper a captura nem corromper o arquivo final.
  const togglePauseResume = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (rec.state === "recording") {
      try {
        rec.pause();
        pausedAtRef.current = Date.now();
        setPaused(true);
      } catch (err) {
        console.warn("[gravaai] pause falhou:", err);
      }
    } else if (rec.state === "paused") {
      try {
        rec.resume();
        if (pausedAtRef.current) {
          pausedAccumRef.current += Date.now() - pausedAtRef.current;
          pausedAtRef.current = 0;
        }
        setPaused(false);
      } catch (err) {
        console.warn("[gravaai] resume falhou:", err);
      }
    }
  }, []);

  // Muta/desmuta a track sem removê-la do stream — preserva o arquivo final.
  const toggleScreenAudioMute = useCallback(() => {
    const tracks = displayStreamRef.current?.getAudioTracks() ?? [];
    if (tracks.length === 0) return;
    const next = !tracks[0].enabled;
    tracks.forEach((t) => (t.enabled = next));
    setScreenAudioEnabled(next);
    setScreenAudio(next);
  }, []);

  const toggleMicMute = useCallback(() => {
    const tracks = micStreamRef.current?.getTracks() ?? [];
    if (tracks.length === 0) {
      // Mic ainda não anexado: aciona o fluxo normal para anexar.
      handleMicToggle(true).catch(() => {});
      return;
    }
    const next = !tracks[0].enabled;
    tracks.forEach((t) => (t.enabled = next));
    setMicEnabled(next);
    setMicAudio(next);
  }, []);

  const toggleCameraFromPanel = useCallback(() => {
    // O vídeo gravado vem do <canvas> composto, então ligar/desligar a webcam
    // aqui só afeta a bolha desenhada — nunca reinicia o MediaRecorder.
    camera.toggle().catch(() => {});
  }, [camera]);

  const download = useCallback(() => {
    const finalBlob = downloadBlobRef.current;
    if (!finalBlob) return;
    console.log(`[gravaai] Blob final para download: ${finalBlob.size} bytes (MediaRecorder bruto: ${rawRecordingSizeRef.current} bytes)`);
    const url = URL.createObjectURL(finalBlob);
    const a = document.createElement("a");
    a.href = url;
    // Sempre force a extensão .mp4 quando a saída for MP4.
    // Se o fallback caiu em WebM (conversor indisponível), preserva a extensão real.
    a.download = `gravaai.${downloadExt}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [downloadExt]);

  const sendToEditor = useCallback(() => {
    const finalBlob = downloadBlobRef.current;
    if (!finalBlob) return;
    setEditorHandoff(finalBlob, `gravaai.${downloadExt}`);
    void navigate({ to: "/mosaicos/editor" });
  }, [downloadExt, navigate]);

  const sendToGif = useCallback(() => {
    const finalBlob = downloadBlobRef.current;
    if (!finalBlob) return;
    setGifHandoff(finalBlob, `gravaai.${downloadExt}`);
    void navigate({ to: "/mosaicos/video-para-gif" });
  }, [downloadExt, navigate]);


  const isRecording = status === "recording";
  const isConverting = status === "converting";
  const canRecord = status === "capturing";
  const captureDisabled = status === "recording" || status === "converting";
  const panelVisible = isRecording;
  const hasScreenAudioTrack =
    (displayStreamRef.current?.getAudioTracks().length ?? 0) > 0;
  const hasMicTrack = (micStreamRef.current?.getTracks().length ?? 0) > 0;

  const convertLabel = useMemo(
    () => (convertProgress > 0 ? `Convertendo p/ MP4… ${Math.round(convertProgress * 100)}%` : "Convertendo p/ MP4…"),
    [convertProgress],
  );

  if (!supported) {
    return (
      <div className="rounded-2xl border border-[var(--brand)]/40 bg-[var(--brand)]/10 p-4 text-sm text-[var(--brand)]">
        Seu navegador não suporta captura de tela. Tente no Chrome ou Edge.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FloatingRecorderPanel
        ref={panelRef}
        visible={panelVisible}
        paused={paused}
        elapsed={elapsed}
        screenAudioOn={screenAudioEnabled && hasScreenAudioTrack}
        micOn={micEnabled && hasMicTrack}
        cameraOn={camera.active}
        hasScreenAudio={hasScreenAudioTrack}
        hasMic
        hasCamera
        onPauseResume={togglePauseResume}
        onStop={stopRecording}
        onToggleScreenAudio={toggleScreenAudioMute}
        onToggleMic={toggleMicMute}
        onToggleCamera={toggleCameraFromPanel}
        penOn={drawing.active}
        onTogglePen={() => drawing.setActive(!drawing.active)}
      />
      {/* Preview */}
      <div
        ref={previewContainerRef}
        className={cn(
          "relative aspect-video w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-black transition-all",
          isRecording && "glow-brand border-[var(--brand)]",
        )}
      >
        <video
          ref={previewRef}
          className="h-full w-full object-contain"
          playsInline
          autoPlay
          muted
        />
        {/* Bolha PiP da câmera sobreposta ao preview e gravada no MP4. */}
        <CameraPipBubble controller={camera} containerRef={previewContainerRef} />
        <DrawingCanvas controller={drawing} containerRef={previewContainerRef} />
        {status === "idle" && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-[var(--muted-foreground)]">
            <div className="grid h-14 w-14 place-items-center rounded-full border border-white/15 bg-white/[0.04]">
              <ScreenShareIcon className="text-white" />
            </div>
            <p className="text-sm">Clique em "Iniciar captura" para começar</p>
          </div>
        )}
        {isRecording && (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md bg-black/60 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
            <span className="rec-dot inline-block h-2.5 w-2.5 rounded-full bg-[var(--brand)]" />
            REC {formatTime(elapsed)}
          </div>
        )}
        {isConverting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-white backdrop-blur-sm">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-[var(--brand)]" />
            <p className="text-sm">{convertLabel}</p>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--brand)]/40 bg-[var(--brand)]/10 px-3 py-2 text-sm text-[var(--brand)]">
          {error}
        </div>
      )}
      {camera.error && (
        <div className="rounded-lg border border-[var(--brand)]/40 bg-[var(--brand)]/10 px-3 py-2 text-sm text-[var(--brand)]">
          {camera.error}
        </div>
      )}

      {/* Caneta */}
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton
          tone={drawing.active ? "record" : "neutral"}
          icon={<PenIcon />}
          onClick={() => drawing.setActive(!drawing.active)}
        >
          {drawing.active ? "Desenho ativo" : "Caneta"}
        </ActionButton>
        <span className="text-xs text-[var(--muted-foreground)]">
          Desenhe sobre o preview — os traços entram na gravação e continuam na tela até você limpar.
        </span>
      </div>
      <DrawingToolbar controller={drawing} />

      {/* Toggles */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Toggle
          label="Áudio da tela"
          hint={
            screenAudio
              ? "Lembre-se de marcar \"Compartilhar áudio\" ao selecionar a janela ou aba."
              : "Capturar o áudio do sistema junto com o vídeo."
          }
          checked={screenAudio}
          onChange={handleScreenAudioToggle}
        />
        <Toggle
          label="Microfone"
          hint="Mixa a sua voz com o áudio da tela."
          checked={micAudio}
          onChange={handleMicToggle}
        />
        <Toggle
          label="Câmera"
          hint="Mostra sua webcam em uma bolha sobre a gravação."
          checked={camera.active}
          onChange={() => { camera.toggle().catch(() => {}); }}
        />
      </div>

      {/* Controles adicionais da câmera quando ligada */}
      {camera.active && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
          <span className="text-xs text-white/50">
            Arraste a bolha no preview para reposicionar.
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-white/60">Fundo:</span>
            {(["none", "blur", "image"] as const).map((m) => (
              <Button
                key={m}
                type="button"
                size="sm"
                variant={camera.effect === m ? "default" : "secondary"}
                onClick={() => camera.setEffect(m)}
              >
                {m === "none" ? "Sem efeito" : m === "blur" ? "Desfocar" : "Imagem"}
              </Button>
            ))}
            {camera.effect === "image" && (
              <label className="cursor-pointer text-xs text-white/70 underline">
                {camera.bgImageUrl ? "Trocar imagem" : "Selecionar imagem"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const url = URL.createObjectURL(f);
                    camera.setBgImageUrl(url);
                  }}
                />
              </label>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <ActionButton
          tone="neutral"
          icon={<MonitorIcon />}
          onClick={startCapture}
          disabled={captureDisabled}
          title='Dica: escolha "Esta aba" ou "Esta janela" no seletor do navegador para que o painel de controles não apareça na gravação. No modo "Tela inteira", tudo que estiver na sua tela — inclusive o painel flutuante — pode ser capturado.'
        >
          {status === "capturing" || status === "recording" ? "Trocar captura" : "Iniciar captura"}
        </ActionButton>
        {!isRecording ? (
          <ActionButton
            tone="record"
            icon={<span className="inline-block h-2.5 w-2.5 rounded-full bg-black/70" />}
            onClick={startRecording}
            disabled={!canRecord}
          >
            Gravar
          </ActionButton>
        ) : (
          <ActionButton tone="stop" icon={<StopIcon />} onClick={stopRecording}>
            Parar
          </ActionButton>
        )}
        <ActionButton
          tone="download"
          icon={<DownloadIcon />}
          onClick={download}
          disabled={!downloadUrl || isConverting}
        >
          {isConverting
            ? "Convertendo p/ MP4…"
            : `Baixar ${downloadExt.toUpperCase()}`}
        </ActionButton>
        {downloadUrl && !isConverting ? (
          <ActionButton
            tone="neutral"
            icon={<ScissorsIcon />}
            onClick={sendToEditor}
          >
            Enviar para o editor
          </ActionButton>
        ) : null}
        {downloadUrl && !isConverting ? (
          <ActionButton tone="neutral" icon={<GifIcon />} onClick={sendToGif}>
            Enviar para GIF
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}