import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Captions,
  Download,
  Keyboard,
  Pause,
  Play,
  Redo2,
  Shapes,
  Sparkles,
  Type,
  Undo2,
  Upload,
  Volume2,
  Blend,
  PenTool,
  X,
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
  | "shortcuts"
  | null;

const TOOLS: { id: Exclude<PanelId, null>; label: string; icon: typeof Upload }[] = [
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
  const [panel, setPanel] = useState<PanelId>(null);
  const sourceBlob = useEditor((s) => s.sourceBlob);
  const [exportOpen, setExportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readMeta = useVideoMeta();

  const projectName = useEditor((s) => s.projectName);
  const setProjectName = useEditor((s) => s.setProjectName);
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  const sourceUrl = useEditor((s) => s.sourceUrl);
  const currentTime = useEditor((s) => s.currentTime);
  const duration = useEditor((s) => s.duration);
  const aspect = useEditor((s) => s.aspect);
  const tracks = useEditor((s) => s.tracks);
  const videoSize = useEditor((s) => s.videoSize);
  const loadSource = useEditor((s) => s.loadSource);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
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
      setPanel(null);
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
      if (
        target &&
        (/input|textarea|select/i.test(target.tagName) || target.isContentEditable)
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying(!useEditor.getState().playing);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
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


  const short = (t: number) =>
    `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

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
        <header className="flex h-14 shrink-0 flex-nowrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-3">

          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="w-40 shrink-0 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold hover:border-[var(--border)] focus:border-[var(--brand)] focus:outline-none lg:w-56"
          />
          <div className="mx-auto flex items-center gap-2">
            <button
              onClick={() => setPlaying(!playing)}
              disabled={!sourceUrl}
              className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--brand)] text-white disabled:opacity-40"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
              {short(currentTime)} / {short(duration)}
            </span>
          </div>
          <button
            onClick={undo}
            aria-label="Desfazer"
            className="rounded-lg border border-[var(--border)] p-2"
            title="Desfazer"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            onClick={redo}
            aria-label="Refazer"
            className="rounded-lg border border-[var(--border)] p-2"
            title="Refazer"
          >
            <Redo2 className="h-4 w-4" />
          </button>

          <button
            onClick={onExport}
            disabled={!sourceBlob}
            className="flex items-center gap-2 rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            <span className="hidden lg:inline">Exportar MP4</span>
          </button>
        </header>



        {error ? (
          <div className="shrink-0 bg-red-500/15 px-4 py-2 text-xs text-red-300">{error}</div>
        ) : null}

        {/* área central */}
        <div className="relative flex min-h-0 flex-1">
          <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-[var(--border)] bg-[var(--surface-2)] py-3">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                onClick={() => setPanel(panel === t.id ? null : t.id)}
                className={cn(
                  "flex w-14 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-semibold",
                  panel === t.id
                    ? "bg-[var(--brand)]/15 text-[var(--brand)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                )}
              >
                <t.icon className="h-5 w-5" />
                {t.label}
              </button>
            ))}
          </nav>

          {/* drawer sobre o preview */}
          {panel ? (
            <div className="absolute left-16 top-0 z-40 flex h-full w-72 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--surface-2)] p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                  {TOOLS.find((t) => t.id === panel)?.label}
                </h2>
                <button onClick={() => setPanel(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>

              {panel === "media" ? (
                <MediaPanel
                  onLoadMain={(file) => void load(file, file.name.replace(/\.[^.]+$/, ""))}
                />
              ) : null}

              {panel === "silence" ? <SilencePanel onClose={() => setPanel(null)} /> : null}

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
          ) : null}

          {sourceUrl ? (
            <Preview videoRef={videoRef} />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-8">
              <label className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] px-12 py-16 text-center">
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
