// Painel de configuração da bolha de webcam — formato, borda, tamanho,
// posição e efeitos de fundo, com preview em tempo real.
import { useEffect, useRef, type RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  drawCameraPipCircle,
  shapeRadius,
  type CameraBgEffect,
  type CameraPipController,
  type CameraShape,
} from "./CameraPip";

const PALETTE = [
  "#ef4444",
  "#ffffff",
  "#111827",
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
];

const SHAPES: { id: CameraShape; label: string }[] = [
  { id: "circle", label: "Círculo" },
  { id: "rounded", label: "Arredondado" },
  { id: "square", label: "Quadrado" },
];

const EFFECTS: { id: CameraBgEffect; label: string }[] = [
  { id: "none", label: "Sem efeito" },
  { id: "blur", label: "Desfocar" },
  { id: "image", label: "Imagem" },
  { id: "color", label: "Cor sólida" },
  { id: "transparent", label: "Sem fundo" },
];

const CORNERS = [
  { id: "tl", label: "Sup. esquerdo" },
  { id: "tr", label: "Sup. direito" },
  { id: "bl", label: "Inf. esquerdo" },
  { id: "br", label: "Inf. direito" },
] as const;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
        {title}
      </p>
      {children}
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Cor ${c}`}
          onClick={() => onChange(c)}
          style={{ background: c }}
          className={cn(
            "h-6 w-6 rounded-full border transition",
            value.toLowerCase() === c.toLowerCase()
              ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/50"
              : "border-white/20",
          )}
        />
      ))}
      <label className="flex cursor-pointer items-center gap-1 text-xs text-white/60">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-8 cursor-pointer rounded border border-white/20 bg-transparent p-0"
        />
        Custom
      </label>
    </div>
  );
}

export interface CameraSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: CameraPipController;
  containerRef: RefObject<HTMLElement | null>;
}

export function CameraSettingsDialog({
  open,
  onOpenChange,
  controller,
  containerRef,
}: CameraSettingsDialogProps) {
  const { bubble, setBubble, style, setStyle, effect, setEffect } = controller;
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  // Preview em tempo real reaproveitando a mesma função do canvas de gravação.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const SIZE = 220;
    const tick = () => {
      const canvas = previewRef.current;
      if (canvas) {
        if (canvas.width !== SIZE) {
          canvas.width = SIZE;
          canvas.height = SIZE;
        }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, SIZE, SIZE);
          const camCanvas = controller.effectCanvasRef.current;
          const camVideo = controller.videoRef.current;
          const useEffectCanvas =
            effect !== "none" && !!camCanvas && camCanvas.width > 0;
          const src = useEffectCanvas ? camCanvas! : camVideo;
          const ready = useEffectCanvas
            ? true
            : !!camVideo && camVideo.readyState >= 2 && camVideo.videoWidth > 0;
          if (src && ready) {
            const pad = 10;
            drawCameraPipCircle(ctx, src, pad, pad, SIZE - pad * 2, style);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, effect, style, controller]);

  const moveToCorner = (corner: (typeof CORNERS)[number]["id"]) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const w = rect?.width ?? bubble.size * 4;
    const h = rect?.height ?? bubble.size * 3;
    const m = 16;
    const x = corner === "tl" || corner === "bl" ? m : Math.max(0, w - bubble.size - m);
    const y = corner === "tl" || corner === "tr" ? m : Math.max(0, h - bubble.size - m);
    setBubble((b) => ({ ...b, x, y }));
  };

  const clampSize = (size: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { size };
    return {
      size,
      x: Math.max(0, Math.min(bubble.x, rect.width - size)),
      y: Math.max(0, Math.min(bubble.y, rect.height - size)),
    };
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-[var(--border)] bg-[var(--surface,#0b0b0d)] text-white sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Configurar bolha da webcam</DialogTitle>
          <DialogDescription className="text-white/60">
            As mudanças são aplicadas na hora, no preview e na gravação em MP4.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
          {/* Preview */}
          <div className="space-y-2">
            <div
              className="grid place-items-center rounded-xl border border-white/10 p-2"
              style={{
                backgroundImage:
                  "linear-gradient(45deg,#1a1a1e 25%,transparent 25%),linear-gradient(-45deg,#1a1a1e 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1a1a1e 75%),linear-gradient(-45deg,transparent 75%,#1a1a1e 75%)",
                backgroundSize: "16px 16px",
                backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
                backgroundColor: "#101013",
              }}
            >
              <canvas ref={previewRef} className="h-[220px] w-[220px]" />
            </div>
            {!controller.active && (
              <p className="text-xs text-white/50">
                Ligue a câmera para ver o preview em tempo real.
              </p>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={controller.resetSettings}
            >
              Restaurar padrão
            </Button>
          </div>

          {/* Controles */}
          <div className="space-y-3">
            <Section title="Formato da bolha">
              <div className="flex flex-wrap gap-2">
                {SHAPES.map((s) => (
                  <Button
                    key={s.id}
                    type="button"
                    size="sm"
                    variant={style.shape === s.id ? "default" : "secondary"}
                    onClick={() => setStyle((st) => ({ ...st, shape: s.id }))}
                  >
                    <span
                      className="mr-2 inline-block h-3 w-3 border border-current"
                      style={{ borderRadius: shapeRadius(s.id, 12) }}
                    />
                    {s.label}
                  </Button>
                ))}
              </div>
            </Section>

            <Section title="Borda">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/70">Mostrar borda</span>
                <Switch
                  checked={style.borderEnabled}
                  onCheckedChange={(v) =>
                    setStyle((st) => ({ ...st, borderEnabled: v }))
                  }
                />
              </div>
              {style.borderEnabled && (
                <div className="space-y-3 pt-2">
                  <ColorPicker
                    value={style.borderColor}
                    onChange={(c) => setStyle((st) => ({ ...st, borderColor: c }))}
                  />
                  <div>
                    <div className="flex items-center justify-between text-xs text-white/60">
                      <span>Espessura</span>
                      <span>{style.borderWidth}px</span>
                    </div>
                    <Slider
                      min={1}
                      max={20}
                      step={1}
                      value={[style.borderWidth]}
                      onValueChange={([v]) =>
                        setStyle((st) => ({ ...st, borderWidth: v }))
                      }
                    />
                  </div>
                </div>
              )}
            </Section>

            <Section title="Tamanho">
              <div className="flex items-center justify-between text-xs text-white/60">
                <span>Diâmetro da bolha</span>
                <span>{Math.round(bubble.size)}px</span>
              </div>
              <Slider
                min={80}
                max={420}
                step={2}
                value={[bubble.size]}
                onValueChange={([v]) => setBubble((b) => ({ ...b, ...clampSize(v) }))}
              />
            </Section>

            <Section title="Posição">
              <div className="flex flex-wrap gap-2">
                {CORNERS.map((c) => (
                  <Button
                    key={c.id}
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => moveToCorner(c.id)}
                  >
                    {c.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-white/50">
                Você também pode arrastar a bolha livremente sobre o preview.
              </p>
            </Section>

            <Section title="Efeitos de fundo">
              <div className="flex flex-wrap gap-2">
                {EFFECTS.map((e) => (
                  <Button
                    key={e.id}
                    type="button"
                    size="sm"
                    variant={effect === e.id ? "default" : "secondary"}
                    onClick={() => setEffect(e.id)}
                  >
                    {e.label}
                  </Button>
                ))}
              </div>
              {effect !== "none" && (
                <div className="space-y-3 pt-3">
                  <div>
                    <div className="flex items-center justify-between text-xs text-white/60">
                      <span>Sensibilidade do recorte</span>
                      <span>{Math.round(style.bgSensitivity)}%</span>
                    </div>
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      value={[style.bgSensitivity]}
                      onValueChange={([v]) =>
                        setStyle((st) => ({ ...st, bgSensitivity: v }))
                      }
                    />
                    <p className="pt-1 text-[11px] text-white/45">
                      Menor = borda suave (pega mais do entorno). Maior = recorte
                      duro, focando só em você.
                    </p>
                  </div>
                  {effect === "blur" && (
                    <div>
                      <div className="flex items-center justify-between text-xs text-white/60">
                        <span>Intensidade do desfoque</span>
                        <span>{Math.round(style.blurStrength)}px</span>
                      </div>
                      <Slider
                        min={0}
                        max={40}
                        step={1}
                        value={[style.blurStrength]}
                        onValueChange={([v]) =>
                          setStyle((st) => ({ ...st, blurStrength: v }))
                        }
                      />
                    </div>
                  )}
                </div>
              )}

              {effect === "image" && (
                <label className="mt-2 inline-block cursor-pointer text-xs text-white/70 underline">
                  {controller.bgImageUrl ? "Trocar imagem" : "Selecionar imagem"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(ev) => {
                      const f = ev.target.files?.[0];
                      if (f) controller.setBgImageUrl(URL.createObjectURL(f));
                    }}
                  />
                </label>
              )}
              {effect === "color" && (
                <div className="pt-2">
                  <ColorPicker
                    value={style.bgColor}
                    onChange={(c) => setStyle((st) => ({ ...st, bgColor: c }))}
                  />
                </div>
              )}
              {effect === "transparent" && (
                <p className="pt-2 text-xs text-white/50">
                  O fundo é removido: só você aparece, sobre a tela capturada.
                </p>
              )}
            </Section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
