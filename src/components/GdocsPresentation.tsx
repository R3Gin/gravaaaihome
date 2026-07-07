// Página "Apresentação Google + Câmera" (aberta em popup por Mosaicos).
// - Iframe do Google Slides publicado
// - Bolha PiP com webcam (reaproveita <CameraPipBubble/> e useCameraPip)
// - Gravação combinada tela + câmera via canvas.captureStream() +
//   useRecorderCore. O canvas EXISTE APENAS para gravar; o preview é <video>.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRecorderCore } from "@/hooks/useRecorderCore";
import {
  CameraPipBubble,
  drawCameraPipCircle,
  useCameraPip,
} from "./CameraPip";

const SLIDES_PUB_RE =
  /^https:\/\/docs\.google\.com\/presentation\/d\/e\/([A-Za-z0-9_-]+)\/pub/i;

function toEmbedUrl(url: string): string | null {
  const match = url.trim().match(SLIDES_PUB_RE);
  if (!match) return null;
  // Sanitiza para forçar navegação MANUAL: remove qualquer autoplay/loop/delayms
  // que possam vir no link colado pelo usuário e monta um embed limpo.
  // Obs.: se a apresentação foi publicada com "Avançar slides automaticamente",
  // o próprio Google Slides pode ignorar `start=false`. O usuário deve marcar
  // "Não" nessa opção ao publicar (ver aviso na UI).
  return `https://docs.google.com/presentation/d/e/${match[1]}/embed?start=false&loop=false&rm=minimal`;
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function GdocsPresentation() {
  const [url, setUrl] = useState("");
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const camera = useCameraPip({ initial: { x: 24, y: 24, size: 180 } });

  // Gravação combinada
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const displayVideoRef = useRef<HTMLVideoElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const compositeRafRef = useRef<number>(0);

  const recorder = useRecorderCore({ fileNameBase: "gravaai-apresentacao" });

  const isRecording = recorder.status === "recording";
  const isConverting = recorder.status === "converting";

  // Refs atualizados para o loop de composição ler sem re-criar o RAF.
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

  // -------- Slides ---------
  const loadSlides = useCallback(() => {
    const embed = toEmbedUrl(url);
    if (!embed) {
      setUrlError(
        "Link inválido. Use https://docs.google.com/presentation/d/e/{ID}/pub (Arquivo → Compartilhar → Publicar na web).",
      );
      return;
    }
    setUrlError(null);
    setEmbedUrl(embed);
  }, [url]);

  // -------- Gravação combinada (tela + bolha) ---------
  const stopComposite = useCallback(() => {
    if (compositeRafRef.current) cancelAnimationFrame(compositeRafRef.current);
    compositeRafRef.current = 0;
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      displayStreamRef.current = display;
      const videoTrack = display.getVideoTracks()[0];
      const settings = videoTrack.getSettings();
      const outW = settings.width ?? 1280;
      const outH = settings.height ?? 720;

      // Vídeo oculto para desenhar frames de tela
      let dv = displayVideoRef.current;
      if (!dv) {
        dv = document.createElement("video");
        dv.muted = true;
        dv.playsInline = true;
        displayVideoRef.current = dv;
      }
      dv.srcObject = new MediaStream([videoTrack]);
      await dv.play().catch(() => {});

      const canvas = compositeCanvasRef.current!;
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d")!;

      // Áudio: sistema (se veio) + microfone
      const AudioCtor: typeof AudioContext =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const audioCtx = new AudioCtor();
      audioCtxRef.current = audioCtx;
      const dest = audioCtx.createMediaStreamDestination();
      if (display.getAudioTracks().length > 0) {
        const src = audioCtx.createMediaStreamSource(
          new MediaStream(display.getAudioTracks()),
        );
        const g = audioCtx.createGain();
        g.gain.value = 0.8;
        src.connect(g).connect(dest);
      }
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = mic;
        const msrc = audioCtx.createMediaStreamSource(mic);
        const mg = audioCtx.createGain();
        mg.gain.value = 0.9;
        msrc.connect(mg).connect(dest);
      } catch {
        console.warn("[gdocs] sem microfone");
      }

      // Loop de composição — desenha a tela e, se a câmera estiver ligada,
      // sobrepõe a bolha lendo diretamente do <video> HTML da câmera
      // (mesmo elemento do preview, sem canvas intermediário).
      const drawFrame = () => {
        try {
          ctx.drawImage(dv!, 0, 0, canvas.width, canvas.height);
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
          const rect = containerRef.current?.getBoundingClientRect();
          const sx = rect && rect.width > 0 ? canvas.width / rect.width : 1;
          const sy = rect && rect.height > 0 ? canvas.height / rect.height : 1;
          const b = bubbleRef.current;
          const bx = b.x * sx;
          const by = b.y * sy;
          const bs = b.size * Math.min(sx, sy);
          drawCameraPipCircle(ctx, camSource, bx, by, bs);
        }
        compositeRafRef.current = requestAnimationFrame(drawFrame);
      };
      compositeRafRef.current = requestAnimationFrame(drawFrame);

      const canvasStream = canvas.captureStream(30);
      const finalStream = new MediaStream();
      canvasStream.getVideoTracks().forEach((t) => finalStream.addTrack(t));
      dest.stream.getAudioTracks().forEach((t) => finalStream.addTrack(t));

      videoTrack.addEventListener("ended", () => {
        recorder.stopRecording();
      });

      recorder.reset();
      recorder.startRecording(finalStream);
    } catch (err) {
      console.error(err);
      recorder.setError("Não foi possível iniciar a gravação combinada.");
      stopComposite();
    }
  }, [camera, recorder, stopComposite]);

  const stopRecording = useCallback(() => {
    recorder.stopRecording();
  }, [recorder]);

  // Encerra composição quando recorder volta pra ready
  useEffect(() => {
    if (recorder.status === "ready" || recorder.status === "idle") {
      if (compositeRafRef.current) {
        cancelAnimationFrame(compositeRafRef.current);
        compositeRafRef.current = 0;
      }
      // mantém streams? não — libera captura de tela quando pronto
      displayStreamRef.current?.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
  }, [recorder.status]);

  useEffect(() => () => stopComposite(), [stopComposite]);

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-white/10 bg-black/60 px-4 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-sm font-bold">
            Apresentação Google + Câmera
          </h1>
          <div className="flex flex-1 items-center gap-2">
            <Input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/presentation/d/e/…/pub"
              className="h-8 min-w-[240px] flex-1 border-white/10 bg-black/40 text-xs"
            />
            <Button
              size="sm"
              onClick={loadSlides}
              className="bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)]"
            >
              Carregar
            </Button>
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
              </>
            )}
            {!isRecording ? (
              <Button
                size="sm"
                onClick={startRecording}
                disabled={isConverting}
                className="bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)]"
              >
                {isConverting ? "Convertendo…" : "Gravar"}
              </Button>
            ) : (
              <Button size="sm" variant="destructive" onClick={stopRecording}>
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
        {(urlError || recorder.error || camera.error) && (
          <p className="mt-2 text-xs text-[var(--brand)]">
            {urlError ?? recorder.error ?? camera.error}
          </p>
        )}
        <p className="mt-2 text-[11px] leading-snug text-white/60">
          Para avançar os slides manualmente (clique / setas do teclado),
          publique no Google Slides com <strong>Avançar slides
          automaticamente: Não</strong> (Arquivo → Compartilhar → Publicar na
          web → aba <em>Incorporar</em>).
        </p>
        {isRecording && (
          <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-black/60 px-2 py-1 text-xs">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--brand)]" />
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
        ref={containerRef}
        className="relative h-[calc(100vh-56px)] w-full overflow-hidden bg-black"
      >
        {embedUrl ? (
          <iframe
            src={embedUrl}
            title="Apresentação"
            className="absolute inset-0 h-full w-full border-0"
            allow="autoplay; fullscreen"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-sm text-white/50">
            Cole o link publicado do Google Slides acima para começar.
          </div>
        )}

        {/* Bolha PiP compartilhada (<video> HTML puro, estilo Google Meet) */}
        <CameraPipBubble controller={camera} containerRef={containerRef} />

        {/* Canvas de composição — INTERNO, só para gravação */}
        <canvas ref={compositeCanvasRef} className="hidden" />
      </div>
    </div>
  );
}