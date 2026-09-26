import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Captions,
  Download,
  Keyboard,
  Redo2,
  Shapes,
  Sparkles,
  Type,
  Undo2,
  Upload,
  Volume2,
  Blend,
  PenTool,
} from "lucide-react";
import { Preview } from "@/components/editor/Preview";
import { Timeline } from "@/components/editor/Timeline";
import { Inspector } from "@/components/editor/Inspector";
import { SilencePanel } from "@/components/editor/panels/SilencePanel";
import { CaptionsPanel } from "@/components/editor/panels/CaptionsPanel";
import { AudioPanel } from "@/components/editor/panels/AudioPanel";
import { TransitionsPanel } from "@/components/editor/panels/TransitionsPanel";
import { EffectsLibraryPanel } from "@/components/editor/panels/EffectsLibraryPanel";
import { AnnotationsPanel } from "@/components/editor/panels/AnnotationsPanel";
import { MediaPanel } from "@/components/editor/panels/MediaPanel";
import { findClip, useEditor } from "@/state/editor-store";
import { takeEditorHandoff } from "@/lib/editor-handoff";
import { ExportDialog } from "@/components/editor/ExportDialog";
import { ToolDock } from "@/components/editor/ToolDock";
import { SIDE_W } from "@/components/editor/layout";

import { cn } from "@/lib/utils";

type PanelId =
  | "media"
  | "silence"
  | "captions"
  | "audio"
  | "transitions"
  | "annotations"
  | "text"
  | "effects"
  | "shortcuts";

const TOOLS: { id: PanelId; label: string; icon: typeof Upload }[] = [
  { id: "media", label: "Mídia", icon: Upload },
  { id: "silence", label: "Silêncio", icon: AudioLines },
  { id: "captions", label: "Legendas", icon: Captions },
  { id: "audio", label: "Áudio", icon: Volume2 },
  { id: "transitions", label: "Transições", icon: Blend },
  { id: "annotations", label: "Anotações", icon: PenTool },
  { id: "text", label: "Texto", icon: Type },
  { id: "effects", label: "Efeitos", icon: Shapes },
  { id: "shortcuts", label: "Atalhos", icon: Keyboard },
];

/** campo onde Ctrl+Z deve desfazer o texto digitado, não o projeto */
function isTextField(el: HTMLElement | null) {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  if (el.tagName !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["range", "checkbox", "radio", "color", "button", "submit", "file"].includes(type);
}

function useVideoMeta() {
  return useCallback(async (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    const meta = await new Promise<{ duration: number; width: number; height: number }>((resolve) => {
      const done = () =>
        resolve({
          duration: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0,
          width: v.videoWidth || 1280,
          height: v.videoHeight || 720,
        });
      v.onloadedmetadata = () => {
        if (v.duration === Infinity) {
          v.currentTime = 1e6;
          v.ontimeupdate = () => {
            v.ontimeupdate = null;
            v.currentTime = 0;
            done();
          };
        } else done();
      };
      v.onerror = () => resolve({ duration: 0, width: 1280, height: 720 });
    });
    return { url, ...meta };
  }, []);
}

function ShortcutGroup({ items }: { items: { keys: string[]; action: string }[] }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start justify-between gap-3">
          <span className="text-xs text-[var(--muted-foreground)] leading-5">{item.action}</span>
          <span className="flex shrink-0 items-center gap-1">
            {item.keys.map((k, j) => (
              <span
                key={j}
                className="rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--foreground)]"
              >
                {k}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

export function VideoEditor() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [panel, setPanel] = useState<PanelId>("media");
  const sourceBlob = useEditor((s) => s.sourceBlob);
  const [exportOpen, setExportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readMeta = useVideoMeta();

  const projectName = useEditor((s) => s.projectName);
  const setProjectName = useEditor((s) => s.setProjectName);
  const setPlaying = useEditor((s) => s.setPlaying);
  const sourceUrl = useEditor((s) => s.sourceUrl);
  const duration = useEditor((s) => s.duration);
  const aspect = useEditor((s) => s.aspect);
  const tracks = useEditor((s) => s.tracks);
  const videoSize = useEditor((s) => s.videoSize);
  const loadSource = useEditor((s) => s.loadSource);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const addTextClip = useEditor((s) => s.addTextClip);
  const addOverlayClip = useEditor((s) => s.addOverlayClip);
  const setStoreBlob = useEditor((s) => s.setSourceBlob);
  const captionStyle = useEditor((s) => s.captionStyle);
  const mediaLibrary = useEditor((s) => s.mediaLibrary);

  const load = useCallback(
    async (blob: Blob, name?: string) => {
      setError(null);
      const meta = await readMeta(blob);
      if (!meta.duration) {
        URL.revokeObjectURL(meta.url);
        setError("Não consegui ler a duração desse arquivo.");
        return;
      }
      setStoreBlob(blob);

      loadSource(meta.url, meta.duration, { width: meta.width, height: meta.height }, name);
    },
    [loadSource, readMeta, setStoreBlob],
  );

  useEffect(() => {
    const handoff = takeEditorHandoff();
    if (handoff) void load(handoff.blob, handoff.name.replace(/\.[^.]+$/, ""));
  }, [load]);

  useEffect(() => {
    const open = (e: Event) => setPanel((e as CustomEvent<PanelId>).detail);
    window.addEventListener("editor:open-panel", open);
    return () => window.removeEventListener("editor:open-panel", open);
  }, []);

  const lastU = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y: desfazer/refazer do editor. Só campos de
      // texto ficam com o desfazer nativo; depois de mexer num slider, checkbox
      // ou seletor o atalho continua valendo para o projeto.
      if (mod && !e.altKey && (key === "z" || key === "y") && !isTextField(target)) {
        e.preventDefault();
        if (key === "y" || e.shiftKey) redo();
        else undo();
        return;
      }
      if (
        target &&
        (/input|textarea|select/i.test(target.tagName) || target.isContentEditable)
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying(!useEditor.getState().playing);
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && (key === "v" || key === "b")) {
        e.preventDefault();
        useEditor.getState().setTool(key === "b" ? "blade" : "select");
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        useEditor.getState().splitPlayhead();
      }
      // U: mostra apenas propriedades com keyframes. UU (duplo rápido): todas as modificadas.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "u") {
        e.preventDefault();
        const now = Date.now();
        const double = now - lastU.current < 350;
        lastU.current = now;
        useEditor.getState().cycleKeyframeRows(double);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const state = useEditor.getState();
        state.selectMany(state.tracks.flatMap((t) => t.clips.map((c) => c.id)));
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const state = useEditor.getState();
        if (state.selectedKeyframes.length > 0) {
          e.preventDefault();
          state.removeSelectedKeyframes();
          return;
        }
        if (state.selectedEffectId) {
          e.preventDefault();
          state.removeEffectPreset("", state.selectedEffectId);
          return;
        }
        if (state.selectedClipIds.length > 0) {
          e.preventDefault();
          state.removeSelected();
        }
      }

      // Copiar / colar keyframes
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        const state = useEditor.getState();
        if (state.selectedKeyframes.length > 0) {
          e.preventDefault();
          state.copySelectedKeyframes();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
        const state = useEditor.getState();
        if (state.kfClipboard.length > 0) {
          e.preventDefault();
          state.pasteKeyframes();
        }
      }
      // Setas: navega entre keyframes da propriedade selecionada (Alt = deslocar no tempo)
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const state = useEditor.getState();
        const sel = state.selectedKeyframes;
        if (sel.length === 0) return;
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        if (e.altKey) {
          state.nudgeSelectedKeyframes(dir * (e.shiftKey ? 0.5 : 0.05));
          return;
        }
        const clip = findClip(state.tracks, state.selectedClipId);
        if (!clip) return;
        const prop = sel[sel.length - 1].prop;
        const keys = clip.keyframes?.[prop] ?? [];
        const idx = keys.findIndex((k) => k.id === sel[sel.length - 1].kfId);
        const next = keys[idx + dir];
        if (!next) return;
        state.selectKeyframe(prop, next.id, false);
        state.setCurrentTime(clip.startTime + next.time);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [redo, setPlaying, undo]);



  const onExport = () => {
    if (!sourceBlob) return;
    setPlaying(false);
    setExportOpen(true);
  };


  const panelLabel = TOOLS.find((t) => t.id === panel)?.label;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      {/* aviso em telas pequenas */}
      <div className="grid h-full w-full place-items-center p-8 text-center md:hidden">
        <p className="text-sm text-[var(--muted-foreground)]">
          Use um dispositivo com tela maior para abrir o editor.
        </p>
      </div>

      <div className="hidden h-full min-h-0 flex-col md:flex">
        <h1 className="sr-only">Editor de vídeo online do Gravaai</h1>
        {/* barra superior */}
        <header className="flex h-11 shrink-0 flex-nowrap items-center gap-1.5 border-b border-[var(--border)] bg-[var(--surface)] px-3">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--brand)] text-[11px] font-black text-white">
            G
          </span>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            aria-label="Nome do projeto"
            className="w-40 shrink-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] font-semibold hover:border-[var(--border)] focus:border-[var(--brand)] focus:outline-none lg:w-64"
          />
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={undo}
              disabled={!canUndo}
              aria-label="Desfazer"
              className="grid h-8 w-8 place-items-center rounded-md text-[var(--muted-foreground)] hover:bg-white/5 hover:text-[var(--foreground)] disabled:opacity-30"
              title="Desfazer (Ctrl+Z)"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              aria-label="Refazer"
              className="grid h-8 w-8 place-items-center rounded-md text-[var(--muted-foreground)] hover:bg-white/5 hover:text-[var(--foreground)] disabled:opacity-30"
              title="Refazer (Ctrl+Shift+Z)"
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              onClick={onExport}
              disabled={!sourceBlob}
              className="ml-2 flex h-8 items-center gap-2 rounded-md bg-[var(--brand)] px-3 text-xs font-semibold text-white hover:bg-[var(--brand-hover)] disabled:opacity-40"
            >
              <Download className="h-4 w-4" />
              Exportar MP4
            </button>
          </div>
        </header>

        {error ? (
          <div className="shrink-0 bg-red-500/15 px-4 py-2 text-xs text-red-300">{error}</div>
        ) : null}

        {/* área central: biblioteca | vídeo | propriedades */}
        <div className="relative flex min-h-0 flex-1">
          <aside
            className="flex shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]"
            style={{ width: SIDE_W }}
          >
            <nav className="flex shrink-0 items-center justify-between gap-0.5 border-b border-[var(--border)] px-1.5 py-1.5">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setPanel(t.id)}
                  title={t.label}
                  aria-label={t.label}
                  aria-pressed={panel === t.id}
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-md transition-colors",
                    panel === t.id
                      ? "bg-[var(--brand)]/15 text-[var(--brand)]"
                      : "text-[var(--muted-foreground)] hover:bg-white/5 hover:text-[var(--foreground)]",
                  )}
                >
                  <t.icon className="h-4 w-4" />
                </button>
              ))}
            </nav>
            <div className="flex h-9 shrink-0 items-center px-3 text-[12px] font-semibold">
              {panelLabel}
              {panel === "media" && mediaLibrary.length > 0 ? (
                <span className="ml-1.5 text-[var(--muted-foreground)]">({mediaLibrary.length + (sourceUrl ? 1 : 0)})</span>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
              {panel === "media" ? (
                <MediaPanel
                  onLoadMain={(file) => void load(file, file.name.replace(/\.[^.]+$/, ""))}
                />
              ) : null}

              {panel === "silence" ? <SilencePanel onClose={() => setPanel("media")} /> : null}

              {panel === "captions" ? <CaptionsPanel /> : null}

              {panel === "audio" ? <AudioPanel /> : null}

              {panel === "transitions" ? <TransitionsPanel /> : null}

              {panel === "annotations" ? <AnnotationsPanel /> : null}

              {panel === "text" ? (
                <button
                  onClick={() => addTextClip()}
                  className="w-full rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white"
                >
                  Adicionar texto
                </button>
              ) : null}

              {panel === "effects" ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <button
                      onClick={() => addOverlayClip("blur")}
                      className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold"
                    >
                      Área desfocada
                    </button>
                    <button
                      onClick={() => addOverlayClip("spotlight")}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Destaque (spotlight)
                    </button>
                  </div>
                  <EffectsLibraryPanel />
                </div>
              ) : null}

              {panel === "shortcuts" ? (
                <div className="space-y-3">
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Atalhos disponíveis no editor. Eles funcionam em qualquer lugar da tela, exceto dentro de campos de texto.
                  </p>
                  <ShortcutGroup
                    items={[
                      { keys: ["Espaço"], action: "Reproduzir / Pausar" },
                      { keys: ["S"], action: "Dividir vídeo no playhead" },
                      { keys: ["U"], action: "Expandir propriedades com keyframes" },
                      { keys: ["U", "U"], action: "Mostrar todas as propriedades modificadas" },
                      { keys: ["Ctrl/⌘", "A"], action: "Selecionar todos os clipes" },
                      { keys: ["Delete"], action: "Remover clipes/keyframes selecionados" },
                      { keys: ["Ctrl/⌘", "Z"], action: "Desfazer" },
                      { keys: ["Ctrl/⌘", "Shift", "Z"], action: "Refazer" },
                      { keys: ["Ctrl/⌘", "Roda"], action: "Zoom na linha do tempo" },
                      { keys: ["Ctrl/⌘", "C"], action: "Copiar keyframes selecionados" },
                      { keys: ["Ctrl/⌘", "V"], action: "Colar keyframes" },
                      { keys: ["←", "→"], action: "Navegar entre keyframes" },
                      { keys: ["Alt", "←", "→"], action: "Deslocar keyframes no tempo" },
                      { keys: ["Esc"], action: "Cancelar modo ponto de efeito" },
                    ]}
                  />
                </div>
              ) : null}
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col bg-[var(--background)]">
            {sourceUrl ? (
              <Preview videoRef={videoRef} />
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-8">
                <label className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] px-12 py-16 text-center hover:border-[var(--brand)]">
                  <Upload className="h-6 w-6 text-[var(--brand)]" />
                  <span className="text-sm font-semibold">Carregue um vídeo para começar</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    Tudo é processado no seu navegador — nenhum arquivo sai do dispositivo.
                  </span>
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void load(file, file.name.replace(/\.[^.]+$/, ""));
                    }}
                  />
                </label>
              </div>
            )}
            <ToolDock onOpenPanel={(id) => setPanel(id)} />
          </section>

          <Inspector />
        </div>

        <Timeline />
      </div>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        sourceBlob={sourceBlob}
        tracks={tracks}
        aspect={aspect}
        videoSize={videoSize}
        captionStyle={captionStyle}
        mediaLibrary={mediaLibrary}
        duration={duration}
        projectName={projectName}
      />
    </div>

  );
}
