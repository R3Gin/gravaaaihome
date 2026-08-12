// Painel flutuante de controles de gravação. Aparece enquanto a gravação
// está ativa (recording | paused) e fica visível em qualquer aba/janela
// quando o navegador suporta a Document Picture-in-Picture API. Fallback:
// painel fixo, arrastável, sobre a página do próprio app.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Pause,
  Play,
  Square,
  Monitor,
  MonitorOff,
  Mic,
  MicOff,
  Camera,
  CameraOff,
  X,

} from "lucide-react";
import { cn } from "@/lib/utils";


export interface FloatingRecorderPanelProps {
  visible: boolean;
  recording?: boolean;
  paused: boolean;
  elapsed: number;
  screenAudioOn: boolean;
  micOn: boolean;
  cameraOn: boolean;
  hasScreenAudio: boolean;
  hasMic: boolean;
  hasCamera: boolean;
  onStart?: () => void;
  onPauseResume: () => void;
  onStop: () => void;
  onToggleScreenAudio: () => void;
  onToggleMic: () => void;
  onToggleCamera: () => void;
}

export interface FloatingRecorderPanelHandle {
  openPip: () => Promise<void>;
  closePip: () => void;
  isPipSupported: () => boolean;
}


function fmt(sec: number) {
  const h = Math.floor(sec / 3600).toString().padStart(2, "0");
  const m = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

type PipWindow = Window & { document: Document };

function supportsDocumentPip() {
  return (
    typeof window !== "undefined" &&
    "documentPictureInPicture" in window &&
    // @ts-expect-error - experimental API
    typeof window.documentPictureInPicture?.requestWindow === "function"
  );
}

function copyStylesInto(target: Document) {
  document
    .querySelectorAll('link[rel="stylesheet"], style')
    .forEach((node) => {
      target.head.appendChild(node.cloneNode(true));
    });
  // Copia variáveis do tema aplicadas ao <html> (Tailwind v4 usa CSS vars).
  const cs = getComputedStyle(document.documentElement);
  const inline = Array.from(cs)
    .filter((prop) => prop.startsWith("--"))
    .map((p) => `${p}:${cs.getPropertyValue(p)}`)
    .join(";");
  // Fundo escuro em html+body pra não ter faixa clara ao redor do painel.
  const bg =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--recording-panel-bg")
      .trim() || "#111111";
  target.documentElement.setAttribute(
    "style",
    `${inline};margin:0;padding:0;height:100%;background:${bg};overflow:hidden;`,
  );
  target.body.setAttribute(
    "style",
    `margin:0;padding:0;height:100%;width:100%;background:${bg};overflow:hidden;color-scheme:dark;`,
  );
}

export const FloatingRecorderPanel = forwardRef<
  FloatingRecorderPanelHandle,
  FloatingRecorderPanelProps
>(function FloatingRecorderPanel(props, ref) {
  const { visible, recording = true } = props;
  const [pipWindow, setPipWindow] = useState<PipWindow | null>(null);
  const [pipSupported, setPipSupported] = useState(true);
  const [pos, setPos] = useState({ x: 24, y: 24 });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const closedByUserRef = useRef(false);

  useEffect(() => {
    setPipSupported(supportsDocumentPip());
  }, []);

  const closePip = useCallback(() => {
    closedByUserRef.current = true;
    if (pipWindow) {
      try {
        pipWindow.close();
      } catch {
        /* noop */
      }
    }
    setPipWindow(null);
  }, [pipWindow]);


  const openPip = useCallback(async () => {
    if (!supportsDocumentPip()) return;
    // Reaproveita a janela existente do navegador, se houver.
    // @ts-expect-error - experimental API
    const existing: PipWindow | null = window.documentPictureInPicture?.window ?? null;
    if (pipWindow || existing) {
      if (!pipWindow && existing) setPipWindow(existing);
      return;
    }
    try {
      // Janela real do sistema operacional, sempre por cima de qualquer app,
      // e desvinculada da aba de origem (o usuário pode navegar livremente).
      // @ts-expect-error - experimental API
      const w: PipWindow = await window.documentPictureInPicture.requestWindow({
        width: 400,
        height: 120,
        disallowReturnToOpener: true,
        preferInitialWindowPlacement: true,
      });
      copyStylesInto(w.document);
      w.addEventListener("pagehide", () => setPipWindow(null));
      setPipWindow(w);
    } catch (err) {
      console.warn("[recorder-panel] Document PiP recusado:", err);
      throw err;
    }
  }, [pipWindow]);



  useImperativeHandle(
    ref,
    () => ({
      openPip,
      closePip,
      isPipSupported: supportsDocumentPip,
    }),
    [openPip, closePip],
  );

  // Fecha o PiP quando a gravação termina.
  useEffect(() => {
    if (!visible && pipWindow) {
      try {
        pipWindow.close();
      } catch {
        /* noop */
      }
      setPipWindow(null);
    }
    if (!visible) closedByUserRef.current = false;
  }, [visible, pipWindow]);

  // Abertura AUTOMÁTICA da janela real do sistema: única forma de painel
  // quando o navegador suporta Document PiP. Tenta algumas vezes caso a
  // primeira chamada (feita pelo gesto do usuário) tenha sido recusada.
  useEffect(() => {
    if (!visible || pipWindow || !pipSupported || closedByUserRef.current) return;
    let cancelled = false;
    let attempts = 0;
    const tick = () => {
      if (cancelled || attempts >= 10) return;
      attempts += 1;
      openPip().catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 700);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [visible, pipWindow, pipSupported, openPip]);


  useEffect(() => {
    return () => {
      if (pipWindow) {
        try {
          pipWindow.close();
        } catch {
          /* noop */
        }
      }
    };
  }, [pipWindow]);

  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pipWindow) return;
    const el = e.currentTarget.parentElement as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setPos({
      x: Math.max(0, e.clientX - dragRef.current.dx),
      y: Math.max(0, e.clientY - dragRef.current.dy),
    });
  };
  const onDragEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  if (!visible) return null;

  const Panel = (
    <div
      className={cn(
        "flex items-center gap-2 text-white",
        "bg-gradient-to-b from-[var(--recording-panel-bg-top)] to-[var(--recording-panel-bg)]",
        pipWindow
          ? "h-full w-full px-3"
          : "h-11 rounded-full border border-[var(--recording-panel-border)] px-3 backdrop-blur-xl shadow-[0_10px_30px_-10px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.04)_inset]",
      )}
      style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
    >
      <div
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        className={cn(
          "flex items-center gap-2 select-none pr-1",
          pipWindow ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        )}
      >
        <span
          className="relative inline-flex h-2 w-2 items-center justify-center"
          title={!recording ? "Pronto para gravar" : props.paused ? "Pausado" : "Gravando"}
        >
            {recording && !props.paused && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--recording-rec-dot)] opacity-75" />
            )}
            <span
              className={cn(
              "relative inline-flex h-2 w-2 rounded-full",
                !recording
                  ? "bg-white/30"
                  : props.paused
                  ? "bg-[var(--recording-pause-dot)] shadow-[0_0_8px_var(--recording-pause-dot-glow)]"
                  : "bg-[var(--recording-rec-dot)] shadow-[0_0_10px_var(--recording-rec-dot-glow)]",
              )}
            />
          </span>
        <span className="font-mono text-xs font-medium tabular-nums text-white/95">
          {fmt(props.elapsed)}
        </span>
      </div>

      <div className="mx-1 h-5 w-px bg-white/10" />

      <div className="flex items-center gap-1">
        {!recording ? (
          <button
            type="button"
            onClick={props.onStart}
            title="Iniciar gravação"
            aria-label="Iniciar gravação"
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-white",
              "bg-gradient-to-b from-[var(--recording-btn-danger-from)] to-[var(--recording-btn-danger-to)]",
              "shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_4px_12px_-2px_var(--recording-btn-danger-glow)]",
              "transition-all duration-150 hover:brightness-110 active:scale-[0.98]",
            )}
          >
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-white" />
            Gravar
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={props.onPauseResume}
              title={props.paused ? "Retomar" : "Pausar"}
              aria-label={props.paused ? "Retomar" : "Pausar"}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full",
                "border border-[var(--recording-btn-neutral-border)] bg-[var(--recording-btn-neutral-bg)] text-white/90",
                "transition-all duration-150 hover:bg-[var(--recording-btn-neutral-bg-hover)] hover:border-[var(--recording-btn-neutral-border-hover)]",
                "active:scale-[0.98]",
              )}
            >
              {props.paused ? (
                <Play className="h-3.5 w-3.5" fill="currentColor" />
              ) : (
                <Pause className="h-3.5 w-3.5" fill="currentColor" />
              )}
            </button>
            <button
              type="button"
              onClick={props.onStop}
              title="Parar gravação"
              aria-label="Parar gravação"
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-white",
                "bg-gradient-to-b from-[var(--recording-btn-danger-from)] to-[var(--recording-btn-danger-to)]",
                "shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_4px_12px_-2px_var(--recording-btn-danger-glow)]",
                "transition-all duration-150 hover:from-[var(--recording-btn-danger-from-hover)] hover:to-[var(--recording-btn-danger-to-hover)] hover:brightness-110",
                "active:scale-[0.98]",
              )}
            >
              <Square className="h-3 w-3" fill="currentColor" />
            </button>
          </>
        )}
      </div>


      <div className="mx-1 h-5 w-px bg-white/10" />

      <div className="flex items-center gap-1">
        <ToggleButton
          active={props.screenAudioOn}
          disabled={!props.hasScreenAudio}
          activeTitle="Áudio da tela ativo — clique para mutar"
          mutedTitle="Áudio da tela mutado — clique para ativar"
          ActiveIcon={Monitor}
          MutedIcon={MonitorOff}
          onClick={props.onToggleScreenAudio}
        />
        <ToggleButton
          active={props.micOn}
          disabled={!props.hasMic}
          activeTitle="Microfone ativo — clique para mutar"
          mutedTitle="Microfone mutado — clique para ativar"
          ActiveIcon={Mic}
          MutedIcon={MicOff}
          onClick={props.onToggleMic}
        />
        <ToggleButton
          active={props.cameraOn}
          disabled={!props.hasCamera}
          activeTitle="Câmera ligada — clique para desligar"
          mutedTitle="Câmera desligada — clique para ligar"
          ActiveIcon={Camera}
          MutedIcon={CameraOff}
          onClick={props.onToggleCamera}
        />

      </div>

      {pipWindow && (
        <>
          <div className="mx-1 h-5 w-px bg-white/10" />
          <button
            type="button"
            onClick={closePip}
            title="Fechar janela flutuante"
            aria-label="Fechar janela flutuante"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full text-white/60",
              "transition-colors duration-150 hover:bg-white/5 hover:text-white/90",
            )}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );

  // Navegador COM suporte: a janela real do sistema é a única forma do painel.
  // Enquanto ela não estiver aberta, nada é renderizado dentro da página.
  if (pipSupported && !pipWindow) return null;

  if (pipWindow) {
    return createPortal(
      <div className="h-full w-full overflow-hidden bg-[var(--recording-panel-bg)]">
        <div className="flex h-full w-full flex-col justify-center">{Panel}</div>
      </div>,
      pipWindow.document.body,
    );
  }

  // Fallback raro: navegador sem Document PiP.
  return createPortal(
    <div
      className="fixed z-[9999]"
      style={{ left: pos.x, top: pos.y }}
    >
      <div className="flex w-fit flex-col">
        {Panel}
        <p className="mt-1 max-w-[320px] rounded-lg bg-black/60 px-2 py-1 text-[10px] leading-tight text-[var(--brand)]">
          Seu navegador não suporta janela flutuante do sistema — atualize para
          Chrome/Edge recentes.
        </p>
      </div>
    </div>,
    document.body,
  );

});

interface ToggleButtonProps {
  active: boolean;
  disabled?: boolean;
  activeTitle: string;
  mutedTitle: string;
  ActiveIcon: React.ComponentType<{ className?: string }>;
  MutedIcon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}

function ToggleButton({
  active,
  disabled,
  activeTitle,
  mutedTitle,
  ActiveIcon,
  MutedIcon,
  onClick,
}: ToggleButtonProps) {
  const Icon = active ? ActiveIcon : MutedIcon;
  const title = active ? activeTitle : mutedTitle;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-150 active:scale-[0.97]",
        disabled
          ? "cursor-not-allowed border-white/[0.04] bg-white/[0.02] opacity-40"
          : active
            ? "border-[var(--recording-btn-neutral-border)] bg-[var(--recording-btn-neutral-bg)] text-white hover:bg-[var(--recording-btn-neutral-bg-hover)] hover:border-[var(--recording-btn-neutral-border-hover)]"
            : "border-[var(--recording-toggle-muted-border)] bg-[var(--recording-toggle-muted-bg)] text-[var(--recording-toggle-muted-text)] hover:bg-[var(--recording-toggle-muted-bg-hover)] hover:text-[var(--recording-toggle-muted-text-hover)]",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}