// Overlay de desenho em uma janela real do sistema operacional (Document PiP).
//
// Cenário 2 do produto: quando o usuário está gravando um app externo ou a
// tela inteira, o navegador NÃO pode desenhar por cima de outras janelas do
// SO. A saída possível é abrir uma janela PiP (always-on-top), com fundo o
// mais transparente que o navegador permitir, e o usuário posicioná-la sobre
// a área compartilhada. Como é uma janela real, o getDisplayMedia a captura
// naturalmente quando ela está dentro da região gravada.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eraser, Trash2, X } from "lucide-react";
import {
  ANNOTATION_TOOLS,
  PEN_COLORS,
  drawAnnotations,
  type Annotation,
  type AnnotationTool,
  type DrawingController,
} from "./DrawingLayer";
import { openPipWindow, supportsDocumentPip, type PipWindow } from "@/lib/document-pip";
import { cn } from "@/lib/utils";

/**
 * Transparência real em janelas Document PiP ainda não é suportada por
 * nenhum navegador estável. Detectamos o suporte a PiP e sinalizamos o
 * fallback (fundo levemente escuro) para o usuário.
 */
export function supportsTransparentPip() {
  if (!supportsDocumentPip()) return false;
  // @ts-expect-error - flag experimental; presente apenas em builds que
  // suportam janelas PiP transparentes.
  return typeof window.documentPictureInPicture?.supportsTransparency === "boolean"
    ? // @ts-expect-error - idem
      !!window.documentPictureInPicture.supportsTransparency
    : false;
}

interface Props {
  open: boolean;
  onClose: () => void;
  controller: DrawingController;
}

export function DrawingOverlayWindow({ open, onClose, controller }: Props) {
  const [win, setWin] = useState<PipWindow | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const itemsRef = useRef<Annotation[]>([]);
  const draftRef = useRef<Annotation | null>(null);
  const rafRef = useRef<number | null>(null);
  const transparent = supportsTransparentPip();

  const { color, size, tool, fillShapes, setTool, setColor, setSize } = controller;
  const stateRef = useRef({ color, size, tool, fillShapes });
  stateRef.current = { color, size, tool, fillShapes };

  // Abre / fecha a janela.
  useEffect(() => {
    let cancelled = false;
    if (open && !win) {
      void openPipWindow({ width: 720, height: 480 }).then((w) => {
        if (!w) return;
        if (cancelled) {
          try { w.close(); } catch { /* noop */ }
          return;
        }
        const bg = transparent ? "transparent" : "rgba(0,0,0,0.16)";
        w.document.documentElement.style.background = bg;
        w.document.body.style.background = bg;
        w.addEventListener("pagehide", () => {
          setWin(null);
          onClose();
        });
        setWin(w);
      });
    }
    if (!open && win) {
      try { win.close(); } catch { /* noop */ }
      setWin(null);
    }
    return () => {
      cancelled = true;
    };
  }, [open, win, onClose, transparent]);

  useEffect(() => {
    return () => {
      if (win) {
        try { win.close(); } catch { /* noop */ }
      }
    };
  }, [win]);

  // Loop de repaint dentro da janela PiP.
  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const w = win;
    if (canvas && w) {
      const cw = Math.max(1, w.innerWidth);
      const ch = Math.max(1, w.innerHeight);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        const list = draftRef.current
          ? [...itemsRef.current, draftRef.current]
          : itemsRef.current;
        drawAnnotations(ctx, list, cw, ch);
      }
    }
    rafRef.current = requestAnimationFrame(repaint);
  }, [win]);

  useEffect(() => {
    if (!win) return;
    rafRef.current = requestAnimationFrame(repaint);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [win, repaint]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / Math.max(1, r.width),
      y: (e.clientY - r.top) / Math.max(1, r.height),
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointFrom(e);
    const st = stateRef.current;
    if (st.tool === "eraser") {
      itemsRef.current = itemsRef.current.filter(
        (it) => !it.points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.03),
      );
      return;
    }
    const type = (st.tool === "zoom" ? "pen" : st.tool) as Annotation["type"];
    draftRef.current = {
      id: Date.now(),
      type,
      color: st.color,
      sizeN: st.size / 720,
      fill: st.fillShapes,
      points: [p, p],
    };
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = draftRef.current;
    if (!d) return;
    const p = pointFrom(e);
    if (d.type === "pen") d.points.push(p);
    else d.points[1] = p;
  };

  const onUp = () => {
    if (draftRef.current) {
      itemsRef.current = [...itemsRef.current, draftRef.current];
      draftRef.current = null;
    }
  };

  if (!win) return null;

  return createPortal(
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="absolute inset-0 h-full w-full"
        style={{ touchAction: "none", cursor: "crosshair" }}
      />
      <div
        className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/80 px-2 py-1 text-white backdrop-blur"
        style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
      >
        {ANNOTATION_TOOLS.filter((t) => t.id !== "zoom").map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            onClick={() => setTool(id as AnnotationTool)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full border",
              tool === id
                ? "border-[var(--brand,#ef4444)] bg-white/20"
                : "border-white/15 hover:bg-white/10",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
        <button
          type="button"
          title="Limpar tudo"
          aria-label="Limpar tudo"
          onClick={() => {
            itemsRef.current = [];
            draftRef.current = null;
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 hover:bg-white/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <span className="mx-1 h-4 w-px bg-white/15" />
        {PEN_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Cor ${c}`}
            title={`Cor ${c}`}
            onClick={() => setColor(c)}
            className={cn(
              "h-4 w-4 rounded-full border",
              color === c ? "scale-110 border-white" : "border-white/25",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
        <input
          type="range"
          min={2}
          max={24}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          title="Espessura"
          className="h-1.5 w-14 cursor-pointer appearance-none rounded-full bg-white/20"
        />
        <button
          type="button"
          title="Borracha"
          aria-label="Borracha"
          onClick={() => setTool("eraser")}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 hover:bg-white/10"
        >
          <Eraser className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Fechar overlay"
          aria-label="Fechar overlay"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 hover:bg-white/10"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="pointer-events-none absolute bottom-2 left-1/2 max-w-[92%] -translate-x-1/2 rounded-lg bg-black/70 px-3 py-1.5 text-center text-[11px] leading-tight text-white/80">
        Posicione esta janela sobre a área que você está compartilhando para o
        desenho aparecer na gravação. Compartilhando "tela inteira", funciona
        automaticamente.
        {!transparent &&
          " Seu navegador não suporta fundo 100% transparente: esta janela aparecerá com um leve véu escuro na gravação."}
      </p>
    </div>,
    win.document.body,
  );
}
