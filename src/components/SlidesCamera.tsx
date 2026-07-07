import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const SLIDES_PUB_RE =
  /^https:\/\/docs\.google\.com\/presentation\/d\/e\/([A-Za-z0-9_-]+)\/pub/i;

const FIXED_W = 854;
const FIXED_H = 480;

function toEmbedUrl(url: string): string | null {
  const match = url.match(SLIDES_PUB_RE);
  if (!match) return null;
  return `https://docs.google.com/presentation/d/e/${match[1]}/embed?start=false&loop=false&delayms=60000`;
}

export function SlidesCamera() {
  const [url, setUrl] = useState("");
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [camOn, setCamOn] = useState(false);
  const [zoom, setZoom] = useState(0.25); // 25%
  const [fullscreenCam, setFullscreenCam] = useState(false);
  const [showResizeWarning, setShowResizeWarning] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Force fixed popup dimensions.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Only enforce when opened as a popup (has an opener).
    if (!window.opener) return;
    let warnTimer: ReturnType<typeof setTimeout> | null = null;
    const enforce = () => {
      const dw = window.outerWidth - FIXED_W;
      const dh = window.outerHeight - FIXED_H;
      if (Math.abs(dw) > 4 || Math.abs(dh) > 4) {
        try { window.resizeTo(FIXED_W, FIXED_H); } catch { /* noop */ }
        setShowResizeWarning(true);
        if (warnTimer) clearTimeout(warnTimer);
        warnTimer = setTimeout(() => setShowResizeWarning(false), 4000);
      }
    };
    try { window.resizeTo(FIXED_W, FIXED_H); } catch { /* noop */ }
    window.addEventListener("resize", enforce);
    return () => {
      window.removeEventListener("resize", enforce);
      if (warnTimer) clearTimeout(warnTimer);
    };
  }, []);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const loadSlides = useCallback(() => {
    const embed = toEmbedUrl(url.trim());
    if (!embed) {
      setErr(
        "Link inválido. Use o formato https://docs.google.com/presentation/d/e/{ID}/pub (Arquivo > Compartilhar > Publicar na web).",
      );
      return;
    }
    setErr(null);
    setEmbedUrl(embed);
  }, [url]);

  const startCam = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.play().catch(() => {});
      }
      setCamOn(true);
    } catch (e) {
      console.error(e);
      setErr("Não foi possível acessar a webcam.");
    }
  }, []);

  const stopCam = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamOn(false);
    setFullscreenCam(false);
  }, []);

  const camStyle = useMemo(() => {
    if (fullscreenCam) {
      return { width: "100%", height: "100%", right: 0, bottom: 0 } as const;
    }
    const w = Math.round(FIXED_W * zoom);
    const h = Math.round(FIXED_H * zoom);
    return { width: `${w}px`, height: `${h}px`, right: "12px", bottom: "12px" } as const;
  }, [zoom, fullscreenCam]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      {!embedUrl ? (
        <div className="flex h-full w-full items-center justify-center p-6">
          <div className="w-full max-w-md space-y-3 rounded-xl border border-white/10 bg-[var(--surface)] p-5">
            <h1 className="font-display text-lg font-bold">Apresentação + Câmera</h1>
            <p className="text-xs text-white/60">
              Cole o link publicado do Google Slides (Arquivo → Compartilhar → Publicar na web).
            </p>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/presentation/d/e/…/pub"
              className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
            />
            {err ? (
              <p className="text-xs text-[var(--brand)]">{err}</p>
            ) : null}
            <button
              type="button"
              onClick={loadSlides}
              className="w-full rounded-md bg-[var(--brand)] px-3 py-2 text-sm font-semibold hover:bg-[var(--brand-hover)]"
            >
              Abrir apresentação
            </button>
          </div>
        </div>
      ) : (
        <>
          <iframe
            src={embedUrl}
            title="Apresentação"
            className="absolute inset-0 h-full w-full border-0"
            allow="autoplay; fullscreen"
          />
          {/* Camera PIP */}
          <div
            className={cn(
              "group absolute overflow-hidden rounded-lg border border-white/20 bg-black shadow-2xl",
              fullscreenCam && "inset-0 rounded-none border-0",
            )}
            style={camStyle}
          >
            {camOn ? (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
                <div className="pointer-events-none absolute inset-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/70 via-transparent to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <div className="pointer-events-auto flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-1 text-xs backdrop-blur-sm">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(0.1, +(z - 0.05).toFixed(2)))}
                      className="rounded px-2 py-0.5 hover:bg-white/10"
                      disabled={fullscreenCam}
                      aria-label="Diminuir câmera"
                    >−</button>
                    <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(1, +(z + 0.05).toFixed(2)))}
                      className="rounded px-2 py-0.5 hover:bg-white/10"
                      disabled={fullscreenCam}
                      aria-label="Aumentar câmera"
                    >+</button>
                  </div>
                  <div className="pointer-events-auto flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-1 text-xs backdrop-blur-sm">
                    <button
                      type="button"
                      onClick={() => setFullscreenCam((v) => !v)}
                      className="rounded px-2 py-0.5 hover:bg-white/10"
                    >
                      {fullscreenCam ? "Voltar ao PIP" : "Tela cheia"}
                    </button>
                    <button
                      type="button"
                      onClick={stopCam}
                      className="rounded px-2 py-0.5 text-[var(--brand)] hover:bg-white/10"
                    >
                      Desligar
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={startCam}
                className="grid h-full w-full place-items-center bg-black/70 text-xs font-medium hover:bg-black/90"
              >
                Ligar webcam
              </button>
            )}
          </div>
          {err ? (
            <div className="absolute left-3 top-3 rounded-md bg-[var(--brand)]/90 px-2 py-1 text-xs">
              {err}
            </div>
          ) : null}
        </>
      )}

      {showResizeWarning && (
        <div className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit max-w-[90%] rounded-md bg-black/85 px-3 py-1.5 text-center text-xs text-white shadow-lg backdrop-blur-sm">
          Não altere a dimensão desta janela, ela está fixada para garantir a correta proporção do vídeo.
        </div>
      )}
    </div>
  );
}