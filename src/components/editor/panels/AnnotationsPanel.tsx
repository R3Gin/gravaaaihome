import {
  ArrowUpRight,
  Circle,
  Eraser,
  Highlighter,
  MousePointer2,
  Pen,
  Square as SquareIcon,
} from "lucide-react";
import { PEN_COLORS, type AnnotationTool } from "@/lib/annotations";
import { useEditor } from "@/state/editor-store";
import { cn } from "@/lib/utils";

const TOOLS: { id: AnnotationTool; label: string; Icon: typeof Pen }[] = [
  { id: "pen", label: "Caneta", Icon: Pen },
  { id: "arrow", label: "Seta", Icon: ArrowUpRight },
  { id: "rect", label: "Retângulo", Icon: SquareIcon },
  { id: "ellipse", label: "Círculo", Icon: Circle },
  { id: "highlight", label: "Destaque", Icon: Highlighter },
  { id: "eraser", label: "Borracha", Icon: Eraser },
];

export function AnnotationsPanel() {
  const tool = useEditor((s) => s.annotationTool);
  const color = useEditor((s) => s.annotationColor);
  const size = useEditor((s) => s.annotationSize);
  const fill = useEditor((s) => s.annotationFill);
  const dur = useEditor((s) => s.annotationDuration);
  const setTool = useEditor((s) => s.setAnnotationTool);
  const setStyle = useEditor((s) => s.setAnnotationStyle);

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
        Pause o vídeo no momento certo, escolha a ferramenta e desenhe sobre o
        preview. Cada anotação vira um clipe na faixa <b>Efeitos</b> — arraste as
        bordas na timeline para definir quando ela aparece e some.
      </p>

      <div className="grid grid-cols-3 gap-1.5">
        <button
          onClick={() => setTool(null)}
          className={cn(
            "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[10px] font-semibold",
            tool === null
              ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
              : "border-[var(--border)] text-[var(--muted-foreground)]",
          )}
        >
          <MousePointer2 className="h-4 w-4" />
          Selecionar
        </button>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(tool === t.id ? null : t.id)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[10px] font-semibold",
              tool === t.id
                ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                : "border-[var(--border)] text-[var(--muted-foreground)]",
            )}
          >
            <t.Icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
          Cor
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setStyle({ color: c })}
              style={{ background: c }}
              className={cn(
                "h-6 w-6 rounded-full border-2",
                color === c ? "border-white" : "border-white/20",
              )}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setStyle({ color: e.target.value })}
            className="h-6 w-8 cursor-pointer rounded border border-[var(--border)] bg-transparent"
          />
        </div>
      </div>

      <label className="block space-y-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
          Espessura — {size}px
        </span>
        <input
          type="range"
          min={2}
          max={24}
          value={size}
          onChange={(e) => setStyle({ size: Number(e.target.value) })}
          className="w-full accent-[var(--brand)]"
        />
      </label>

      <label className="flex items-center justify-between text-xs">
        <span>Formas preenchidas</span>
        <input
          type="checkbox"
          checked={fill}
          onChange={(e) => setStyle({ fill: e.target.checked })}
          className="h-4 w-4 accent-[var(--brand)]"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
          Duração padrão — {dur.toFixed(1)}s
        </span>
        <input
          type="range"
          min={0.5}
          max={15}
          step={0.5}
          value={dur}
          onChange={(e) => setStyle({ duration: Number(e.target.value) })}
          className="w-full accent-[var(--brand)]"
        />
      </label>

      <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
        Para dar zoom em uma região, selecione o clipe de vídeo e anime a
        propriedade <b>Escala</b> com keyframes no painel de Propriedades.
      </p>
    </div>
  );
}
