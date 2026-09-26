import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeFilmstrip } from "@/lib/filmstrip";
import { Film, Image as ImageIcon, Loader2, Music, Trash2, Upload } from "lucide-react";
import { useEditor, type MediaItem, type MediaKind } from "@/state/editor-store";
import { dropMediaEl } from "@/lib/media-elements";
import { cn } from "@/lib/utils";

const ACCEPT = "video/mp4,video/webm,image/png,image/jpeg,image/gif,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,video/*,image/*,audio/*";

function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

async function probe(file: File, kind: MediaKind, url: string) {
  if (kind === "image") {
    const thumbnail = url;
    return { duration: 0, thumbnail };
  }
  return await new Promise<{ duration: number; thumbnail?: string }>((resolve) => {
    const el = document.createElement(kind === "audio" ? "audio" : "video") as HTMLVideoElement;
    el.preload = "metadata";
    el.src = url;
    const finish = (duration: number, thumbnail?: string) => resolve({ duration, thumbnail });
    el.onloadedmetadata = () => {
      const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
      if (kind !== "video") return finish(duration);
      el.currentTime = Math.min(0.2, duration / 2);
      el.onseeked = () => {
        try {
          const c = document.createElement("canvas");
          c.width = 160;
          c.height = Math.max(1, Math.round((160 * el.videoHeight) / (el.videoWidth || 160)));
          c.getContext("2d")?.drawImage(el, 0, 0, c.width, c.height);
          finish(duration, c.toDataURL("image/jpeg", 0.6));
        } catch {
          finish(duration);
        }
      };
    };
    el.onerror = () => finish(0);
  });
}

function fmt(t: number) {
  if (!t) return "";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** primeiro quadro do vídeo principal (reaproveita as miniaturas da timeline) */
function useMainThumb(url: string | null, duration: number) {
  const [thumb, setThumb] = useState("");
  useEffect(() => {
    setThumb("");
    if (!url || !duration) return;
    return subscribeFilmstrip(url, duration, (s) => setThumb(s.frames[0] ?? ""));
  }, [url, duration]);
  return thumb;
}

function Tile({
  thumb,
  kind,
  badge,
  name,
  active,
}: {
  thumb?: string;
  kind: MediaKind;
  badge?: string;
  name: string;
  active?: boolean;
}) {
  return (
    <>
      <div
        className={cn(
          "relative grid aspect-video place-items-center overflow-hidden rounded-md bg-black/50",
          active ? "ring-2 ring-[var(--brand)]" : "group-hover:ring-2 group-hover:ring-white/40",
          kind === "audio" && "bg-emerald-600/30",
        )}
      >
        {thumb ? (
          <img src={thumb} alt="" draggable={false} className="h-full w-full object-cover" />
        ) : kind === "audio" ? (
          <Music className="h-5 w-5 text-emerald-300" />
        ) : kind === "video" ? (
          <Film className="h-5 w-5 text-[var(--muted-foreground)]" />
        ) : (
          <ImageIcon className="h-5 w-5 text-[var(--muted-foreground)]" />
        )}
        {badge ? (
          <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-medium tabular-nums text-white">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-1 truncate text-[11px] text-[var(--muted-foreground)]">{name}</p>
    </>
  );
}

export function MediaPanel({ onLoadMain }: { onLoadMain: (file: File) => void }) {
  const library = useEditor((s) => s.mediaLibrary);
  const addMediaItem = useEditor((s) => s.addMediaItem);
  const removeMediaItem = useEditor((s) => s.removeMediaItem);
  const addMediaClip = useEditor((s) => s.addMediaClip);
  const sourceUrl = useEditor((s) => s.sourceUrl);
  const sourceDuration = useEditor((s) => s.sourceDuration);
  const projectName = useEditor((s) => s.projectName);
  const mainThumb = useMainThumb(sourceUrl, sourceDuration);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      setError(null);
      const list = Array.from(files);
      if (list.length === 0) return;
      setBusy(true);
      for (const file of list) {
        const kind = kindOf(file);
        if (!kind) {
          setError(`Formato não suportado: ${file.name}`);
          continue;
        }
        // primeiro vídeo com o editor vazio vira o vídeo principal do projeto
        if (kind === "video" && !useEditor.getState().sourceUrl) {
          onLoadMain(file);
          continue;
        }
        const url = URL.createObjectURL(file);
        const meta = await probe(file, kind, url);
        const item: MediaItem = {
          id: Math.random().toString(36).slice(2, 10),
          name: file.name,
          kind,
          url,
          blob: file,
          duration: meta.duration,
          thumbnail: meta.thumbnail,
        };
        addMediaItem(item);
      }
      setBusy(false);
    },
    [addMediaItem, onLoadMain],
  );

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void importFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed text-center text-xs text-[var(--muted-foreground)]",
          sourceUrl ? "p-3" : "p-5",
          over ? "border-[var(--brand)] bg-[var(--brand)]/10" : "border-[var(--border)]",
        )}
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
        <span className="font-semibold text-[var(--foreground)]">
          {sourceUrl ? "Importar mídia" : "Selecionar vídeo"}
        </span>
        Arraste arquivos aqui ou clique para escolher
        <span className="text-[10px]">vídeo, imagem ou áudio</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void importFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      {sourceUrl || library.length > 0 ? (
        <>
          <ul className="grid grid-cols-2 gap-x-2 gap-y-3">
            {sourceUrl ? (
              <li title="Vídeo principal do projeto">
                <Tile
                  thumb={mainThumb}
                  kind="video"
                  badge={fmt(sourceDuration)}
                  name={projectName}
                  active
                />
              </li>
            ) : null}
            {library.map((item) => (
              <li
                key={item.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-gravaai-media", item.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => addMediaClip(item.id, useEditor.getState().currentTime)}
                title="Arraste para a timeline ou clique para inserir na agulha"
                className="group relative cursor-grab"
              >
                <Tile
                  thumb={item.thumbnail}
                  kind={item.kind}
                  badge={item.kind === "image" ? "imagem" : fmt(item.duration)}
                  name={item.name}
                />
                <button
                  title="Remover da biblioteca"
                  aria-label="Remover da biblioteca"
                  onClick={(e) => {
                    e.stopPropagation();
                    dropMediaEl(item.id);
                    removeMediaItem(item.id);
                  }}
                  className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded bg-black/70 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3 text-white" />
                </button>
              </li>
            ))}
          </ul>
          {library.length > 0 ? (
            <p className="text-[10px] text-[var(--muted-foreground)]">
              Arraste um item para a timeline ou clique para inserir na agulha.
            </p>
          ) : null}
        </>
      ) : null}

      <p className="mt-1 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
        Tudo fica no seu dispositivo: os arquivos importados existem apenas nesta sessão da aba e
        são perdidos ao fechar ou atualizar a página.
      </p>
    </div>
  );
}
