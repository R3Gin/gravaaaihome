import { useCallback, useRef, useState } from "react";
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

export function MediaPanel({ onLoadMain }: { onLoadMain: (file: File) => void }) {
  const library = useEditor((s) => s.mediaLibrary);
  const addMediaItem = useEditor((s) => s.addMediaItem);
  const removeMediaItem = useEditor((s) => s.removeMediaItem);
  const addMediaClip = useEditor((s) => s.addMediaClip);
  const currentTime = useEditor((s) => s.currentTime);
  const sourceUrl = useEditor((s) => s.sourceUrl);
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
          "flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-5 text-center text-xs text-[var(--muted-foreground)]",
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

      {library.length > 0 ? (
        <>
          <p className="text-[10px] text-[var(--muted-foreground)]">
            Arraste um item para a timeline ou clique para inserir na agulha.
          </p>
          <ul className="flex flex-col gap-2">
            {library.map((item) => (
              <li
                key={item.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-gravaai-media", item.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => addMediaClip(item.id, currentTime)}
                className="group flex cursor-grab items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-1,transparent)] p-2 text-[11px] hover:border-[var(--brand)]"
              >
                <div className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded bg-black/40">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : item.kind === "audio" ? (
                    <Music className="h-4 w-4 text-emerald-400" />
                  ) : item.kind === "video" ? (
                    <Film className="h-4 w-4" />
                  ) : (
                    <ImageIcon className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{item.name}</p>
                  <p className="text-[10px] text-[var(--muted-foreground)]">
                    {item.kind === "image" ? "imagem" : fmt(item.duration) || item.kind}
                  </p>
                </div>
                <button
                  title="Remover da biblioteca"
                  onClick={(e) => {
                    e.stopPropagation();
                    dropMediaEl(item.id);
                    removeMediaItem(item.id);
                  }}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="mt-1 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
        Tudo fica no seu dispositivo: os arquivos importados existem apenas nesta sessão da aba e
        são perdidos ao fechar ou atualizar a página.
      </p>
    </div>
  );
}
