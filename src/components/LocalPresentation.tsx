// Página "Apresentação + Câmera" (aberta em popup por Mosaicos).
// - Upload local de PDF ou PPTX -> slides navegáveis pré-renderizados em canvas
// - Bolha PiP com webcam (reaproveita <CameraPipBubble/> e useCameraPip)
// - Gravação da área dos slides + bolha + microfone via canvas.captureStream()
//   e useRecorderCore (mesmo fluxo de MP4 da página principal).

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRecorderCore } from "@/hooks/useRecorderCore";
import { loadDeck, isSupportedFile, type SlideDeck } from "@/lib/slide-loader";
import {
  CameraPipBubble,
  drawCameraPipCircle,
  useCameraPip,
} from "./CameraPip";

function formatTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

type DeckState =
  | { kind: "empty" }
  | { kind: "loading"; done: number; total: number }
  | { kind: "error"; message: string }
  | { kind: "ready"; deck: SlideDeck };

export function LocalPresentation() {
  const [state, setState] = useState<DeckState>({ kind: "empty" });
  const [index, setIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const camera = useCameraPip({ initial: { x: 24, y: 24, size: 180 } });

  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const compositeRafRef = useRef<number>(0);

  const recorder = useRecorderCore({ fileNameBase: "gravaai-apresentacao" });
  const isRecording = recorder.status === "recording";
  const isConverting = recorder.status === "converting";

  const deck = state.kind === "ready" ? state.deck : null;
  const total = deck?.slides.length ?? 0;

  // Refs para o loop de composição
  const bubbleRef = useRef(camera.bubble);
  useEffect(() => { bubbleRef.current = camera.bubble; }, [camera.bubble]);
  const cameraActiveRef = useRef(camera.active);
  useEffect(() => { cameraActiveRef.current = camera.active; }, [camera.active]);
  const cameraEffectRef = useRef(camera.effect);
  useEffect(() => { cameraEffectRef.current = camera.effect; }, [camera.effect]);
  const slideRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    slideRef.current = deck?.slides[index] ?? null;
  }, [deck, index]);

  /* ------------------------------ Upload ----------------------------- */

  const handleFile = useCallback(async (file: File) => {
    if (!isSupportedFile(file)) {
      setState({
        kind: "error",
        message: `Formato não suportado (${file.name}). Envie um arquivo .pdf ou .pptx.`,
      });
      return;
    }
    setState({ kind: "loading", done: 0, total: 0 });
    setIndex(0);
    try {
      const loaded = await loadDeck(file, (done, t) =>
        setState({ kind: "loading", done, total: t }),
      );
      setState({ kind: "ready", deck: loaded });
    } catch (err) {
      console.error(err);
      setState({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "Não foi possível processar este arquivo.",
      });
    }
  }, []);

  /* --------------------------- Navegação ----------------------------- */

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        const max = total - 1;
        return Math.min(Math.max(i + delta, 0), Math.max(max, 0));
      });
    },
    [total],
  );

  useEffect(() => {
    if (!deck) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deck, go]);

  // Desenha o slide atual no canvas de preview
  useEffect(() => {
    const src = deck?.slides[index];
    const canvas = displayCanvasRef.current;
    if (!src || !canvas) return;
    canvas.width = deck!.width;
    canvas.height = deck!.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  }, [deck, index]);

  /* ---------------------------- Gravação ----------------------------- */

  const stopComposite = useCallback(() => {
    if (compositeRafRef.current) cancelAnimationFrame(compositeRafRef.current);
    compositeRafRef.current = 0;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!deck) return;
    try {
      const canvas = compositeCanvasRef.current!;
      canvas.width = deck.width;
      canvas.height = deck.height;
      const ctx = canvas.getContext("2d")!;

      const AudioCtor: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const audioCtx = new AudioCtor();
      audioCtxRef.current = audioCtx;
      const dest = audioCtx.createMediaStreamDestination();
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = mic;
        const msrc = audioCtx.createMediaStreamSource(mic);
        const mg = audioCtx.createGain();
        mg.gain.value = 0.9;
        msrc.connect(mg).connect(dest);
      } catch {
        console.warn("[apresentacao] sem microfone");
      }

      const drawFrame = () => {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const slide = slideRef.current;
        if (slide) ctx.drawImage(slide, 0, 0, canvas.width, canvas.height);

        const camVideo = camera.videoRef.current;
        const camCanvas = camera.effectCanvasRef.current;
        const hasEffect = cameraEffectRef.current !== "none" && !!camCanvas;
        const camSource = hasEffect ? camCanvas! : camVideo;
        const camReady = hasEffect
          ? !!camCanvas && camCanvas.width > 0
          : !!camVideo && camVideo.readyState >= 2 && camVideo.videoWidth > 0;
        if (cameraActiveRef.current && camSource && camReady) {
          const rect = stageRef.current?.getBoundingClientRect();
          const sx = rect && rect.width > 0 ? canvas.width / rect.width : 1;
          const sy = rect && rect.height > 0 ? canvas.height / rect.height : 1;
          const b = bubbleRef.current;
          drawCameraPipCircle(
            ctx,
            camSource,
            b.x * sx,
            b.y * sy,
            b.size * Math.min(sx, sy),
          );
        }
        compositeRafRef.current = requestAnimationFrame(drawFrame);
      };
      compositeRafRef.current = requestAnimationFrame(drawFrame);

      const canvasStream = canvas.captureStream(30);
      const finalStream = new MediaStream();
      canvasStream.getVideoTracks().forEach((t) => finalStream.addTrack(t));
      dest.stream.getAudioTracks().forEach((t) => finalStream.addTrack(t));

      recorder.reset();
      recorder.startRecording(finalStream);
    } catch (err) {
      console.error(err);
      recorder.setError("Não foi possível iniciar a gravação.");
      stopComposite();
    }
  }, [camera, deck, recorder, stopComposite]);

  useEffect(() => {
    if (recorder.status === "ready" || recorder.status === "idle") {
      if (compositeRafRef.current) {
        cancelAnimationFrame(compositeRafRef.current);
        compositeRafRef.current = 0;
      }
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
  }, [recorder.status]);

  useEffect(() => () => stopComposite(), [stopComposite]);

  const aspect = deck ? deck.width / deck.height : 16 / 9;

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10 bg-black/60 px-4 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-sm font-bold">Apresentação + Câmera</h1>
          <div className="flex flex-1 items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) handleFile(f);
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isRecording}
            >
              {deck ? "Trocar arquivo" : "Selecionar arquivo"}
            </Button>
            {deck && (
              <span className="truncate text-xs text-white/50">{deck.name}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { camera.toggle().catch(() => {}); }}
            >
              {camera.active ? "Desligar câmera" : "Ligar câmera"}
            </Button>
            {camera.active && (
              <>
                {(["none", "blur", "image"] as const).map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant={camera.effect === m ? "default" : "secondary"}
                    onClick={() => camera.setEffect(m)}
                  >
                    {m === "none" ? "Sem efeito" : m === "blur" ? "Desfocar" : "Imagem"}
                  </Button>
                ))}
                {camera.effect === "image" && (
                  <label className="cursor-pointer text-xs text-white/80 underline">
                    {camera.bgImageUrl ? "Trocar" : "Imagem"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        camera.setBgImageUrl(URL.createObjectURL(f));
                      }}
                    />
                  </label>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  title="Configurações da câmera"
                  aria-label="Configurações da câmera"
                  onClick={() => setCameraSettingsOpen(true)}
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </>
            )}

            {!isRecording ? (
              <Button
                size="sm"
                onClick={startRecording}
                disabled={isConverting || !deck}
                className="bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)]"
              >
                {isConverting ? "Convertendo…" : "Gravar"}
              </Button>
            ) : (
              <Button size="sm" variant="destructive" onClick={recorder.stopRecording}>
                Parar
              </Button>
            )}
            {recorder.downloadUrl && (
              <Button size="sm" variant="secondary" onClick={recorder.download}>
                Baixar {recorder.downloadExt.toUpperCase()}
              </Button>
            )}
          </div>
        </div>
        {(recorder.error || camera.error) && (
          <p className="mt-2 text-xs text-[var(--brand)]">
            {recorder.error ?? camera.error}
          </p>
        )}
        {isRecording && (
          <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-black/60 px-2 py-1 text-xs">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--brand)]" />
            REC {formatTime(recorder.elapsed)}
          </div>
        )}
        {isConverting && (
          <p className="mt-2 text-xs text-white/70">
            Convertendo p/ MP4… {Math.round(recorder.convertProgress * 100)}%
          </p>
        )}
      </header>

      <div
        className="flex h-[calc(100vh-56px)] w-full items-center justify-center overflow-hidden bg-black p-4"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) handleFile(f);
        }}
      >
        {state.kind === "ready" ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3">
            <div
              ref={stageRef}
              className="relative max-h-full overflow-hidden rounded-lg bg-white shadow-2xl"
              style={{ aspectRatio: aspect, width: `min(100%, calc((100vh - 160px) * ${aspect}))` }}
            >
              <canvas
                ref={displayCanvasRef}
                className="absolute inset-0 h-full w-full"
              />
              <CameraPipBubble controller={camera} containerRef={stageRef} />
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => go(-1)}
                disabled={index === 0}
                aria-label="Slide anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="tabular-nums text-white/70">
                {index + 1} / {total}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => go(1)}
                disabled={index >= total - 1}
                aria-label="Próximo slide"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div
            className={`flex w-full max-w-lg flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
              dragOver
                ? "border-[var(--brand)] bg-[var(--brand)]/10"
                : "border-white/15 bg-white/[0.02]"
            }`}
          >
            {state.kind === "loading" ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-[var(--brand)]" />
                <p className="text-sm text-white/80">
                  Processando arquivo…
                  {state.total > 0 && ` ${state.done} / ${state.total} slides`}
                </p>
              </>
            ) : (
              <>
                <FileUp className="h-8 w-8 text-[var(--brand)]" />
                <p className="font-display text-base font-bold">
                  Arraste seu PDF ou PPTX aqui
                </p>
                <p className="text-xs text-white/60">
                  Tudo é processado no seu navegador — nenhum arquivo é enviado.
                </p>
                {state.kind === "error" && (
                  <p className="text-xs text-[var(--brand)]">{state.message}</p>
                )}
                <Button
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-1 bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)]"
                >
                  Selecionar arquivo
                </Button>
              </>
            )}
          </div>
        )}

        {/* Canvas de composição — INTERNO, só para gravação */}
        <canvas ref={compositeCanvasRef} className="hidden" />
      </div>
    </div>
  );
}
