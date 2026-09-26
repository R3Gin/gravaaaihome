import type { ReactNode } from "react";
import {
  AlignHorizontalJustifyStart,
  Copy,
  Link2,
  Link2Off,
  Magnet,
  MousePointer2,
  MoveHorizontal,
  Music,
  Scissors,
  SplitSquareHorizontal,
  Trash2,
  Type,
} from "lucide-react";

import { ASPECTS } from "@/components/editor/layout";
import { canDetachAudio, findClip, useEditor } from "@/state/editor-store";
import { cn } from "@/lib/utils";

function DockButton({
  title,
  onClick,
  active,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg transition-colors disabled:opacity-30",
        active
          ? "bg-[var(--brand)] text-white"
          : "text-[var(--muted-foreground)] hover:bg-white/10 hover:text-[var(--foreground)]",
      )}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-5 w-px bg-[var(--border)]" />;

/** Barra flutuante de ferramentas sob o vídeo (estilo Diffusion Studio / CapCut). */
export function ToolDock({ onOpenPanel }: { onOpenPanel: (id: "text") => void }) {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const sourceUrl = useEditor((s) => s.sourceUrl);
  const tracks = useEditor((s) => s.tracks);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const selectedCount = useEditor((s) => s.selectedClipIds.length);
  const splitPlayhead = useEditor((s) => s.splitPlayhead);
  const duplicateSelected = useEditor((s) => s.duplicateSelected);
  const removeSelected = useEditor((s) => s.removeSelected);
  const detachAudio = useEditor((s) => s.detachAudio);
  const toggleLink = useEditor((s) => s.toggleLink);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const rippleEnabled = useEditor((s) => s.rippleEnabled);
  const toggleRipple = useEditor((s) => s.toggleRipple);
  const alignAllClips = useEditor((s) => s.alignAllClips);
  const hasGaps = useEditor((s) => s.hasGaps);
  const addTextClip = useEditor((s) => s.addTextClip);
  const aspect = useEditor((s) => s.aspect);
  const setAspect = useEditor((s) => s.setAspect);

  const selectedClip = findClip(tracks, selectedClipId);
  const none = !sourceUrl;

  return (
    <div className="flex shrink-0 justify-center px-3 pb-3">
      <div className="flex items-center gap-0.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-lg shadow-black/40">
        <DockButton title="Selecionar (V)" active={tool === "select"} onClick={() => setTool("select")}>
          <MousePointer2 className="h-4 w-4" />
        </DockButton>
        <DockButton
          title="Lâmina: clique no clipe para dividir (B)"
          active={tool === "blade"}
          onClick={() => setTool(tool === "blade" ? "select" : "blade")}
        >
          <Scissors className="h-4 w-4" />
        </DockButton>
        <DockButton title="Dividir na agulha (S)" disabled={none} onClick={splitPlayhead}>
          <SplitSquareHorizontal className="h-4 w-4" />
        </DockButton>
        <Sep />
        <DockButton
          title={selectedCount > 1 ? `Duplicar (${selectedCount})` : "Duplicar"}
          disabled={selectedCount === 0}
          onClick={duplicateSelected}
        >
          <Copy className="h-4 w-4" />
        </DockButton>
        <DockButton
          title={selectedCount > 1 ? `Deletar (${selectedCount})` : "Deletar (Delete)"}
          disabled={selectedCount === 0}
          onClick={removeSelected}
        >
          <Trash2 className="h-4 w-4" />
        </DockButton>
        {selectedClip?.linkGroupId ? (
          <DockButton
            title="Desanexar áudio e vídeo (passam a se mover separados)"
            onClick={() => toggleLink(selectedClip.id)}
          >
            <Link2Off className="h-4 w-4" />
          </DockButton>
        ) : selectedClip && canDetachAudio(tracks, selectedClip) ? (
          <DockButton
            title="Separar o áudio em uma faixa própria"
            onClick={() => detachAudio(selectedClip.id)}
          >
            <Music className="h-4 w-4" />
          </DockButton>
        ) : selectedClip?.type === "audio" ? (
          <DockButton
            title="Vincular novamente ao clipe de vídeo"
            onClick={() => toggleLink(selectedClip.id)}
          >
            <Link2 className="h-4 w-4" />
          </DockButton>
        ) : null}
        <DockButton title="Adicionar texto" disabled={none} onClick={() => {
          addTextClip();
          onOpenPanel("text");
        }}>
          <Type className="h-4 w-4" />
        </DockButton>
        <Sep />
        <DockButton
          title="Imantação: gruda clipes nas bordas vizinhas e na agulha (segure Alt para ignorar)"
          active={snapEnabled}
          onClick={toggleSnap}
        >
          <Magnet className="h-4 w-4" />
        </DockButton>
        <DockButton
          title="Ondulação: ao mover ou apagar um corte, os clipes seguintes acompanham"
          active={rippleEnabled}
          onClick={toggleRipple}
        >
          <MoveHorizontal className="h-4 w-4" />
        </DockButton>
        <DockButton
          title="Ajustar: encosta todos os clipes, fechando os espaços dos cortes"
          disabled={none || !hasGaps()}
          onClick={alignAllClips}
        >
          <AlignHorizontalJustifyStart className="h-4 w-4" />
        </DockButton>
        <Sep />
        <div className="flex items-center gap-0.5 pr-0.5" role="group" aria-label="Formato do vídeo">
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAspect(a.id)}
              title={`Formato ${a.label}`}
              aria-pressed={aspect === a.id}
              className={cn(
                "h-8 rounded-lg px-2 text-[11px] font-semibold tabular-nums transition-colors",
                aspect === a.id
                  ? "bg-white/10 text-[var(--foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
