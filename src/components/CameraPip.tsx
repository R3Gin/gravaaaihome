// Bolha PiP de câmera — abordagem estilo Google Meet:
// - Sem efeito = <video> HTML puro, estilizado por CSS (círculo + espelhado + cover).
// - Com efeito = <canvas> processado por MediaPipe carregado como script global,
//   evitando import ES direto do pacote em Vite/bundler.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";

export interface BubblePos {
  x: number;
  y: number;
  size: number;
}

export type CameraBgEffect = "none" | "blur" | "image" | "color" | "transparent";

export type CameraShape = "circle" | "rounded" | "square";

export interface CameraStyle {
  shape: CameraShape;
  borderEnabled: boolean;
  borderColor: string;
  borderWidth: number;
  bgColor: string;
  /** 0–100: quão agressivo é o recorte pessoa/fundo. */
  bgSensitivity: number;
  /** Intensidade do desfoque de fundo em px. */
  blurStrength: number;
}

export const DEFAULT_CAMERA_STYLE: CameraStyle = {
  shape: "circle",
  borderEnabled: false,
  borderColor: "#ef4444",
  borderWidth: 4,
  bgColor: "#111827",
  bgSensitivity: 50,
  blurStrength: 14,
};


/** Raio (px) da bolha para um dado formato/tamanho. */
export function shapeRadius(shape: CameraShape, size: number): number {
  if (shape === "circle") return size / 2;
  if (shape === "rounded") return Math.max(4, size * 0.18);
  return 0;
}

export interface CameraPipController {
  active: boolean;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => Promise<void>;
  bubble: BubblePos;
  setBubble: React.Dispatch<React.SetStateAction<BubblePos>>;
  videoRef: RefObject<HTMLVideoElement | null>;
  streamRef: RefObject<MediaStream | null>;
  error: string | null;
  clearError: () => void;
  effect: CameraBgEffect;
  setEffect: (e: CameraBgEffect) => void;
  bgImageUrl: string | null;
  setBgImageUrl: (url: string | null) => void;
  style: CameraStyle;
  setStyle: React.Dispatch<React.SetStateAction<CameraStyle>>;
  /** Volta formato, borda, tamanho, fundo e posição ao padrão. */
  resetSettings: () => void;
  /** Canvas processado (com efeito). Só populado quando effect !== 'none'. */
  effectCanvasRef: RefObject<HTMLCanvasElement | null>;
}

export interface UseCameraPipOptions {
  initial?: Partial<BubblePos>;
  onError?: (msg: string) => void;
}

export function useCameraPip(opts: UseCameraPipOptions = {}): CameraPipController {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defaultBubble = useRef<BubblePos>({
    x: opts.initial?.x ?? 24,
    y: opts.initial?.y ?? 24,
    size: opts.initial?.size ?? 180,
  }).current;
  const [bubble, setBubble] = useState<BubblePos>(defaultBubble);
  const [effect, setEffect] = useState<CameraBgEffect>("none");
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  const [style, setStyle] = useState<CameraStyle>(DEFAULT_CAMERA_STYLE);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const effectCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const emitError = useCallback(
    (msg: string) => {
      setError(msg);
      opts.onError?.(msg);
    },
    [opts],
  );

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("getUserMedia indisponível neste navegador.");
      }
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = s;
      // A bolha pode ainda não estar montada (ex.: câmera ligada antes de
      // iniciar a captura). Usa um <video> destacado como suporte; quando a
      // bolha montar, ela reassume o ref e reanexa o mesmo stream.
      let v = videoRef.current;
      if (!v) {
        v = document.createElement("video");
        videoRef.current = v;
      }
      v.srcObject = s;
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      await v.play().catch(() => {});
      setActive(true);
    } catch (e) {
      const err = e as { name?: string; message?: string };
      let msg = "Não foi possível acessar a webcam.";
      if (err?.name === "NotAllowedError") {
        msg = "Permissão da câmera negada. Autorize nas configurações do navegador.";
      } else if (err?.name === "NotFoundError") {
        msg = "Nenhuma câmera encontrada neste dispositivo.";
      } else if (err?.name === "NotReadableError") {
        msg = "A câmera está em uso por outro aplicativo.";
      } else if (err?.message) {
        msg = `Não foi possível iniciar a câmera: ${err.message}`;
      }
      console.error("[camera-pip] erro:", e);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      emitError(msg);
      setActive(false);
    }
  }, [emitError]);

  const toggle = useCallback(async () => {
    if (active) stop();
    else await start();
  }, [active, start, stop]);

  useEffect(() => () => stop(), [stop]);

  const resetSettings = useCallback(() => {
    setStyle(DEFAULT_CAMERA_STYLE);
    setEffect("none");
    setBgImageUrl(null);
    setBubble({ ...defaultBubble });
  }, [defaultBubble]);

  return {
    active,
    start,
    stop,
    toggle,
    bubble,
    setBubble,
    videoRef,
    streamRef,
    error,
    clearError: () => setError(null),
    effect,
    setEffect,
    bgImageUrl,
    setBgImageUrl,
    style,
    setStyle,
    resetSettings,
    effectCanvasRef,
  };
}

export interface CameraPipBubbleProps {
  controller: CameraPipController;
  containerRef: RefObject<HTMLElement | null>;
  className?: string;
}

const MEDIAPIPE_SELFIE_SEGMENTATION_SCRIPT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js";
const MEDIAPIPE_SELFIE_SEGMENTATION_ASSET_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation";

interface SegResult {
  image: CanvasImageSource;
  segmentationMask: CanvasImageSource;
}

interface SegInstance {
  send: (input: { image: HTMLVideoElement }) => Promise<void>;
  onResults: (cb: (r: SegResult) => void) => void;
  setOptions: (o: Record<string, unknown>) => void;
  close?: () => void;
}

type SelfieSegmentationConstructor = new (opts: {
  locateFile: (file: string) => string;
}) => SegInstance;

declare global {
  interface Window {
    SelfieSegmentation?: SelfieSegmentationConstructor;
  }
}

let selfieSegmentationScriptPromise: Promise<SelfieSegmentationConstructor> | null = null;

function loadSelfieSegmentationGlobal(): Promise<SelfieSegmentationConstructor> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("MediaPipe precisa rodar no navegador."));
  }

  if (window.SelfieSegmentation) {
    return Promise.resolve(window.SelfieSegmentation);
  }

  if (selfieSegmentationScriptPromise) {
    return selfieSegmentationScriptPromise;
  }

  selfieSegmentationScriptPromise = new Promise((resolve, reject) => {
    const finish = (script?: HTMLScriptElement) => {
      const Ctor = window.SelfieSegmentation;
      if (!Ctor) {
        selfieSegmentationScriptPromise = null;
        reject(
          new Error(
            "Script do MediaPipe carregou, mas window.SelfieSegmentation não foi definido.",
          ),
        );
        return;
      }
      if (script) script.dataset.loaded = "true";
      console.log("[camera-pip] window.SelfieSegmentation disponível");
      resolve(Ctor);
    };

    const fail = (reason: string, err?: unknown) => {
      selfieSegmentationScriptPromise = null;
      reject(new Error(`${reason}${err instanceof Error ? `: ${err.message}` : ""}`));
    };

    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-camera-pip-mediapipe="selfie-segmentation"], script[src="${MEDIAPIPE_SELFIE_SEGMENTATION_SCRIPT}"]`,
    );

    if (existing) {
      if (window.SelfieSegmentation) {
        finish(existing);
        return;
      }
      if (existing.dataset.loaded === "true") {
        fail("Script do MediaPipe já carregou sem registrar window.SelfieSegmentation");
        return;
      }
      const timeout = window.setTimeout(() => {
        existing.removeEventListener("load", onLoad);
        existing.removeEventListener("error", onError);
        fail(`Timeout ao carregar ${MEDIAPIPE_SELFIE_SEGMENTATION_SCRIPT}`);
      }, 15000);
      const onLoad = () => {
        window.clearTimeout(timeout);
        existing.removeEventListener("error", onError);
        finish(existing);
      };
      const onError = (err: Event) => {
        window.clearTimeout(timeout);
        existing.removeEventListener("load", onLoad);
        fail(`Falha ao baixar ${MEDIAPIPE_SELFIE_SEGMENTATION_SCRIPT}`, err);
      };
      existing.addEventListener("load", onLoad, { once: true });
      existing.addEventListener("error", onError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = MEDIAPIPE_SELFIE_SEGMENTATION_SCRIPT;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.cameraPipMediapipe = "selfie-segmentation";

    const timeout = window.setTimeout(() => {
      script.onload = null;
      script.onerror = null;
      fail(`Timeout ao carregar ${MEDIAPIPE_SELFIE_SEGMENTATION_SCRIPT}`);
    }, 15000);

    script.onload = () => {
      window.clearTimeout(timeout);
      finish(script);
    };
    script.onerror = (err) => {
      window.clearTimeout(timeout);
      fail(`Falha ao baixar ${MEDIAPIPE_SELFIE_SEGMENTATION_SCRIPT}`, err);
    };

    console.log("[camera-pip] carregando script global MediaPipe", script.src);
    document.head.appendChild(script);
  });

  return selfieSegmentationScriptPromise;
}

/**
 * Bolha arrastável. Renderiza <video> puro quando `effect==='none'` e
 * substitui por um <canvas> com segmentação MediaPipe carregada como script
 * global quando há efeito de fundo (blur/imagem). Só um dos dois fica visível.
 */
export function CameraPipBubble({
  controller,
  containerRef,
  className,
}: CameraPipBubbleProps) {
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const { active, bubble, setBubble, videoRef, effect, bgImageUrl, effectCanvasRef, style } =
    controller;
  const bgColor = style.bgColor;
  // Refs para não reiniciar o MediaPipe a cada ajuste de slider.
  const sensitivityRef = useRef(style.bgSensitivity);
  const blurStrengthRef = useRef(style.blurStrength);
  sensitivityRef.current = style.bgSensitivity;
  blurStrengthRef.current = style.blurStrength;


  const effectActive = active && effect !== "none";
  const [effectReady, setEffectReady] = useState(false);
  const [effectError, setEffectError] = useState<string | null>(null);

  // Reset ready state ao ligar/desligar efeito
  useEffect(() => {
    setEffectReady(false);
    setEffectError(null);
  }, [effectActive, effect, bgImageUrl]);

  // Loop de segmentação — só roda quando efeito ativo.
  useEffect(() => {
    if (!effectActive) return;
    let cancelled = false;
    let raf = 0;
    let seg: SegInstance | null = null;
    let bgImg: HTMLImageElement | null = null;
    let framesReceived = 0;

    const loadBg = () => {
      if (effect !== "image" || !bgImageUrl) return;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = bgImageUrl;
      bgImg = img;
    };
    loadBg();

    // Canvas auxiliar: converte a máscara em alfa binarizado pela sensibilidade.
    const maskCanvas = document.createElement("canvas");
    const MASK_W = 256;
    const MASK_H = 256;
    maskCanvas.width = MASK_W;
    maskCanvas.height = MASK_H;
    const maskCtx = maskCanvas.getContext("2d", { willReadFrequently: true });

    /**
     * s = 0   → recorte permissivo e borda bem suave (mantém mais do entorno)
     * s = 1   → recorte agressivo/duro (só o que o modelo tem certeza)
     */
    const buildMask = (mask: CanvasImageSource, s: number): CanvasImageSource => {
      if (!maskCtx) return mask;
      maskCtx.clearRect(0, 0, MASK_W, MASK_H);
      maskCtx.globalCompositeOperation = "source-over";
      maskCtx.filter = "none";
      maskCtx.drawImage(mask, 0, 0, MASK_W, MASK_H);
      const img = maskCtx.getImageData(0, 0, MASK_W, MASK_H);
      const d = img.data;
      // Limiar de confiança: 0.12 (permissivo) → 0.80 (rígido)
      const threshold = 0.12 + s * 0.68;
      // Largura da transição: 0.35 (suave) → 0.02 (dura)
      const soft = Math.max(0.02, 0.35 - s * 0.33);
      const lo = threshold - soft;
      const inv = 1 / (soft * 2);
      for (let i = 0; i < d.length; i += 4) {
        // A máscara pode vir no alfa ou na luminância, dependendo do build.
        const a = d[i + 3];
        const v = a < 250 ? a / 255 : d[i] / 255;
        let t = (v - lo) * inv;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const e = t * t * (3 - 2 * t); // smoothstep
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        d[i + 3] = (e * 255) | 0;
      }
      maskCtx.putImageData(img, 0, 0);
      return maskCanvas;
    };


    const drawFrame = (canvas: HTMLCanvasElement, r: SegResult) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const src = r.image as HTMLVideoElement;
      const vw = (src as HTMLVideoElement).videoWidth ||
        (src as unknown as HTMLCanvasElement).width || 640;
      const vh = (src as HTMLVideoElement).videoHeight ||
        (src as unknown as HTMLCanvasElement).height || 480;
      if (canvas.width !== vw) canvas.width = vw;
      if (canvas.height !== vh) canvas.height = vh;
      const w = canvas.width;
      const h = canvas.height;

      ctx.save();
      ctx.clearRect(0, 0, w, h);

      // 1) Máscara como base — sensibilidade ajusta o limiar/dureza do recorte.
      // Filtros CSS não alteram o canal alfa da máscara, então processamos os
      // pixels num canvas auxiliar de baixa resolução (barato e responsivo).
      const s = Math.max(0, Math.min(100, sensitivityRef.current)) / 100;
      ctx.drawImage(buildMask(r.segmentationMask, s), 0, 0, w, h);


      // 2) Onde a máscara está, desenhar a pessoa (source-in)
      ctx.globalCompositeOperation = "source-in";
      ctx.drawImage(src, 0, 0, w, h);

      // 3) Fundo por trás (destination-over)
      if (effect === "transparent") {
        // Sem fundo: mantém só a pessoa recortada (alfa preservado).
      } else {
        ctx.globalCompositeOperation = "destination-over";
        if (effect === "blur") {
          const b = Math.max(0, blurStrengthRef.current);
          const pad = Math.ceil(b * 0.6);
          ctx.filter = `blur(${b}px)`;
          ctx.drawImage(src, -pad, -pad, w + pad * 2, h + pad * 2);
          ctx.filter = "none";
        } else if (effect === "image" && bgImg && bgImg.complete && bgImg.naturalWidth) {

          const iw = bgImg.naturalWidth, ih = bgImg.naturalHeight;
          // cover
          const scale = Math.max(w / iw, h / ih);
          const dw = iw * scale, dh = ih * scale;
          const dx = (w - dw) / 2, dy = (h - dh) / 2;
          ctx.drawImage(bgImg, dx, dy, dw, dh);
        } else if (effect === "color") {
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, w, h);
        } else {
          ctx.fillStyle = "#111";
          ctx.fillRect(0, 0, w, h);
        }
      }
      ctx.restore();
    };

    (async () => {
      try {
        console.log("[camera-pip] aguardando window.SelfieSegmentation…");
        const SelfieSegmentation = await loadSelfieSegmentationGlobal();
        if (cancelled) return;
        console.log("[camera-pip] criando SelfieSegmentation via window global");
        seg = new SelfieSegmentation({
          locateFile: (file) => `${MEDIAPIPE_SELFIE_SEGMENTATION_ASSET_BASE}/${file}`,
        });
        console.log("[camera-pip] MediaPipe SelfieSegmentation instanciado");
        seg.setOptions({ modelSelection: 1, selfieMode: false });
        seg.onResults((results: SegResult) => {
          framesReceived++;
          if (framesReceived === 1) {
            console.log("[camera-pip] primeiro frame segmentado recebido", {
              image: !!results.image,
              mask: !!results.segmentationMask,
            });
            setEffectReady(true);
          }
          const canvas = effectCanvasRef.current;
          if (!canvas) return;
          try {
            drawFrame(canvas, results);
          } catch (err) {
            console.error("[camera-pip] drawFrame erro:", err);
          }
        });

        const tick = async () => {
          if (cancelled) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2 && v.videoWidth > 0 && seg) {
            try { await seg.send({ image: v }); }
            catch (e) { console.warn("[camera-pip] seg.send falhou", e); }
          }
          if (!cancelled) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        console.error("[camera-pip] falha carregando MediaPipe:", msg, e);
        if (!cancelled) {
          setEffectError(`Falha ao carregar modelo: ${msg}`);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      try { seg?.close?.(); } catch { /* noop */ }
    };
  }, [effectActive, effect, bgImageUrl, bgColor, videoRef, effectCanvasRef]);

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { dx: e.clientX - bubble.x, dy: e.clientY - bubble.y };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const nx = Math.min(
      Math.max(0, e.clientX - dragRef.current.dx),
      Math.max(0, rect.width - bubble.size),
    );
    const ny = Math.min(
      Math.max(0, e.clientY - dragRef.current.dy),
      Math.max(0, rect.height - bubble.size),
    );
    setBubble((b) => ({ ...b, x: nx, y: ny }));
  };
  const onUp = () => {
    dragRef.current = null;
  };

  const transparentBg = effect === "transparent";

  return (
    <div
      onPointerDown={active ? onDown : undefined}
      onPointerMove={active ? onMove : undefined}
      onPointerUp={active ? onUp : undefined}
      onPointerCancel={active ? onUp : undefined}
      style={{
        left: bubble.x,
        top: bubble.y,
        width: bubble.size,
        height: bubble.size,
        display: active ? undefined : "none",
        borderRadius: shapeRadius(style.shape, bubble.size),
        border: style.borderEnabled
          ? `${style.borderWidth}px solid ${style.borderColor}`
          : "none",
        background: transparentBg ? "transparent" : "#000",
      }}
      className={cn(
        "absolute z-20 cursor-grab overflow-hidden shadow-2xl active:cursor-grabbing",
        className,
      )}
    >
      <video
        ref={(el) => {
          videoRef.current = el;
          if (el && controller.streamRef.current) {
            if (el.srcObject !== controller.streamRef.current) {
              el.srcObject = controller.streamRef.current;
            }
            el.muted = true;
            void el.play().catch(() => {});
          }
        }}
        playsInline
        muted
        autoPlay
        className="pointer-events-none h-full w-full"
        style={{
          objectFit: "cover",
          objectPosition: "center",
          transform: "scaleX(-1)",
          // Enquanto o efeito não estiver pronto, manter o <video> visível
          // como fallback em vez de mostrar um canvas preto.
          display: effectActive && effectReady ? "none" : undefined,
        }}
      />
      <canvas
        ref={effectCanvasRef}
        width={480}
        height={480}
        className="pointer-events-none h-full w-full"
        style={{
          objectFit: "cover",
          objectPosition: "center",
          transform: "scaleX(-1)",
          display: effectActive && effectReady ? undefined : "none",
        }}
      />
      {effectError && (
        <div className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[10px] text-red-300">
          {effectError}
        </div>
      )}
    </div>
  );
}

/**
 * Desenha o frame atual da câmera na forma configurada (círculo, quadrado
 * arredondado ou quadrado reto) em um canvas de destino, com cover-crop
 * centralizado + espelhamento (efeito selfie) e borda opcional.
 * Usado APENAS pelo pipeline de gravação — nunca para preview.
 */
export function drawCameraPipCircle(
  ctx: CanvasRenderingContext2D,
  source: HTMLVideoElement | HTMLCanvasElement,
  x: number,
  y: number,
  size: number,
  style: CameraStyle = DEFAULT_CAMERA_STYLE,
): void {
  const vw =
    (source as HTMLVideoElement).videoWidth ||
    (source as HTMLCanvasElement).width;
  const vh =
    (source as HTMLVideoElement).videoHeight ||
    (source as HTMLCanvasElement).height;
  if (!vw || !vh) return;
  // cover-crop centralizado em quadrado
  let sx = 0,
    sy = 0,
    sW = vw,
    sH = vh;
  if (vw > vh) {
    sW = vh;
    sx = (vw - vh) / 2;
  } else if (vh > vw) {
    sH = vw;
    sy = (vh - vw) / 2;
  }

  const r = shapeRadius(style.shape, size);
  const path = () => {
    ctx.beginPath();
    if (style.shape === "circle") {
      ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    } else if (r > 0 && typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, size, size, r);
    } else {
      ctx.rect(x, y, size, size);
    }
    ctx.closePath();
  };

  ctx.save();
  path();
  ctx.clip();
  // Espelhamento horizontal (efeito selfie)
  ctx.translate(x + size, y);
  ctx.scale(-1, 1);
  ctx.drawImage(source, sx, sy, sW, sH, 0, 0, size, size);
  ctx.restore();

  if (style.borderEnabled && style.borderWidth > 0) {
    ctx.save();
    path();
    ctx.lineWidth = style.borderWidth;
    ctx.strokeStyle = style.borderColor;
    ctx.stroke();
    ctx.restore();
  }
}