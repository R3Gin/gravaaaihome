import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Download,
  Loader2,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  SplitSquareHorizontal,
  Trash2,
  Type,
  Upload,
  Video,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { ActionButton } from "@/components/ActionButton";
import {
  exportTimeline,
  type TimelineClip,
  type TransitionKind,
  type ZoomKey,
} from "@/lib/ffmpeg-convert";
import { takeEditorHandoff } from "@/lib/editor-handoff";
import { cn } from "@/lib/utils";

const NEUTRAL = { brightness: 0, contrast: 1, saturation: 1 };
const THUMB_COUNT = 16;
const MIN_CLIP = 0.15;

interface Filters {
  brightness: number;
  contrast: number;
  saturation: number;
}

interface Clip {
  id: string;
  srcStart: number;
  srcEnd: number;
  start: number;
  speed: number;
  transition: TransitionKind;
  filters: Filters;
  zoomKeys: ZoomKey[];
}

interface TextLayer {
  id: string;
  text: string;
  start: number;
  end: number;
  x: number; // 0..1 (centro)
  y: number; // 0..1 (centro)
  size: number; // px relativo a 1080p
  color: string;
}

type Selection = { kind: "clip" | "text"; id: string } | null;

const uid = () => Math.random().toString(36).slice(2, 9);

function fmt(t: number) {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${cs}`;
}

const clipDuration = (c: Clip) => (c.srcEnd - c.srcStart) / (c.speed || 1);
const clipEnd = (c: Clip) => c.start + clipDuration(c);

function zoomAt(keys: ZoomKey[], t: number) {
  if (keys.length === 0) return 1;
  const k = [...keys].sort((a, b) => a.t - b.t);
  if (t <= k[0].t) return k[0].scale;
  if (t >= k[k.length - 1].t) return k[k.length - 1].scale;
  for (let i = 0; i < k.length - 1; i++) {
    if (t >= k[i].t && t <= k[i + 1].t) {
      const r = (t - k[i].t) / Math.max(0.001, k[i + 1].t - k[i].t);
      return k[i].scale + (k[i + 1].scale - k[i].scale) * r;
    }
  }
  return 1;
}

export function VideoEditor() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [srcSize, setSrcSize] = useState({ width: 1280, height: 720 });
  const [duration, setDuration] = useState(0);
  const [clips, setClips] = useState<Clip[]>([]);
  const [texts, setTexts] = useState<TextLayer[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<"select" | "blade">("select");
  const [pxPerSec, setPxPerSec] = useState(60);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [muted, setMuted] = useState(false);

  const sourceBlobRef = useRef<Blob | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lanesRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const stateRef = useRef({ clips, texts, srcSize, selection });
  stateRef.current = { clips, texts, srcSize, selection };
  const dragRef = useRef<
    | { kind: "clip"; id: string; grabOffset: number }
    | { kind: "text"; id: string; grabOffset: number }
    | { kind: "text-edge"; id: string; edge: "start" | "end" }
    | { kind: "playhead" }
    | { kind: "sel"; edge: "start" | "end" }
    | null
  >(null);
  const textDragRef = useRef(false);

  const total = useMemo(() => {
    const a = clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    const b = texts.reduce((m, t) => Math.max(m, t.end), 0);
    return Math.max(a, b, 1);
  }, [clips, texts]);

  const selectedClip = useMemo(
    () => (selection?.kind === "clip" ? clips.find((c) => c.id === selection.id) ?? null : null),
    [selection, clips],
  );
  const selectedText = useMemo(
    () => (selection?.kind === "text" ? texts.find((t) => t.id === selection.id) ?? null : null),
    [selection, texts],
  );

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(
    () => () => {
      if (srcUrl) URL.revokeObjectURL(srcUrl);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
    },
    [srcUrl, resultUrl],
  );

  /* ---------------- carregamento ---------------- */

  const generateThumbs = useCallback(async (url: string) => {
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.preload = "auto";
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("thumb"));
    });
    const dur = v.duration;
    const canvas = document.createElement("canvas");
    const h = 56;
    const ratio = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9;
    canvas.height = h;
    canvas.width = Math.round(h * ratio);
    const ctx = canvas.getContext("2d")!;
    const out: string[] = [];
    for (let i = 0; i < THUMB_COUNT; i++) {
      const t = (dur * (i + 0.5)) / THUMB_COUNT;
      await new Promise<void>((resolve) => {
        v.onseeked = () => resolve();
        v.currentTime = Math.min(Math.max(0, t), Math.max(0, dur - 0.05));
      });
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      out.push(canvas.toDataURL("image/jpeg", 0.6));
    }
    v.src = "";
    return out;
  }, []);

  const loadBlob = useCallback(
    async (blob: Blob, name: string) => {
      const okType =
        blob.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(name);
      if (!okType) {
        setError("Formato não suportado. Envie um arquivo de vídeo MP4.");
        return;
      }
      setError(null);
      setLoading(true);
      setResultUrl(null);
      setThumbs([]);
      setTexts([]);
      setClips([]);
      setSelection(null);
      setTime(0);
      timeRef.current = 0;
      try {
        const url = URL.createObjectURL(blob);
        sourceBlobRef.current = blob;
        setSrcUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
        setFileName(name);
        const list = await generateThumbs(url).catch(() => [] as string[]);
        setThumbs(list);
      } catch (err) {
        console.error(err);
        setError("Não foi possível ler este vídeo. Tente outro arquivo MP4.");
      } finally {
        setLoading(false);
      }
    },
    [generateThumbs],
  );

  // Vídeo vindo do botão "Enviar para o editor".
  useEffect(() => {
    const handoff = takeEditorHandoff();
    if (handoff) void loadBlob(handoff.blob, handoff.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void loadBlob(f, f.name);
    e.target.value = "";
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) void loadBlob(f, f.name);
  };

  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    setDuration(v.duration);
    setSrcSize({ width: v.videoWidth || 1280, height: v.videoHeight || 720 });
    setClips([
      {
        id: uid(),
        srcStart: 0,
        srcEnd: v.duration,
        start: 0,
        speed: 1,
        transition: "none",
        filters: { ...NEUTRAL },
        zoomKeys: [],
      },
    ]);
    setSel({ start: 0, end: v.duration });
  };

  /* ---------------- preview (canvas) ---------------- */

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const { clips: cs, texts: ts, srcSize: size } = stateRef.current;

      if (playingRef.current) {
        const totalNow = cs.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
        let t = timeRef.current + dt;
        if (t >= totalNow) {
          t = totalNow;
          playingRef.current = false;
          setPlaying(false);
          video?.pause();
        }
        timeRef.current = t;
        setTime(t);
      }

      const t = timeRef.current;
      const clip = cs.find((c) => t >= c.start && t < clipEnd(c)) ?? null;

      if (video && clip) {
        const local = t - clip.start;
        const want = clip.srcStart + local * (clip.speed || 1);
        video.playbackRate = Math.min(4, Math.max(0.25, clip.speed || 1));
        if (Math.abs(video.currentTime - want) > (playingRef.current ? 0.35 : 0.02)) {
          try {
            video.currentTime = Math.min(want, Math.max(0, (video.duration || want) - 0.03));
          } catch {
            /* noop */
          }
        }
        if (playingRef.current && video.paused) void video.play().catch(() => {});
        if (!playingRef.current && !video.paused) video.pause();
      } else if (video && !video.paused) {
        video.pause();
      }

      if (canvas) {
        const W = size.width;
        const H = size.height;
        if (canvas.width !== W || canvas.height !== H) {
          canvas.width = W;
          canvas.height = H;
        }
        const ctx = canvas.getContext("2d")!;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.filter = "none";
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);

        if (video && clip && video.readyState >= 2) {
          const local = t - clip.start;
          const f = clip.filters;
          const z = Math.max(1, zoomAt(clip.zoomKeys, local));
          let alpha = 1;
          let offsetX = 0;
          const dur = clipDuration(clip);
          const isFirst = cs.length > 0 && cs.indexOf(clip) === 0;
          if (!isFirst && clip.transition !== "none") {
            const d = Math.min(0.5, dur / 2);
            if (local < d) {
              const r = local / d;
              if (clip.transition === "fade") alpha = r;
              else offsetX = (1 - r) * W;
            }
          }
          ctx.filter = `brightness(${(1 + f.brightness).toFixed(3)}) contrast(${f.contrast.toFixed(
            3,
          )}) saturate(${f.saturation.toFixed(3)})`;
          ctx.globalAlpha = alpha;
          const dw = W * z;
          const dh = H * z;
          ctx.drawImage(video, offsetX - (dw - W) / 2, -(dh - H) / 2, dw, dh);
          ctx.filter = "none";
          ctx.globalAlpha = 1;
        }

        for (const layer of ts) {
          if (t < layer.start || t > layer.end) continue;
          const fontSize = (layer.size / 1080) * H;
          ctx.font = `700 ${fontSize}px "DM Sans", system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = layer.color;
          ctx.shadowColor = "rgba(0,0,0,0.55)";
          ctx.shadowBlur = fontSize * 0.25;
          ctx.fillText(layer.text, layer.x * W, layer.y * H);
          ctx.shadowBlur = 0;
        }
        ctx.restore();
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted, srcUrl]);

  const seek = useCallback(
    (t: number) => {
      const v = Math.min(Math.max(0, t), total);
      timeRef.current = v;
      setTime(v);
    },
    [total],
  );

  const togglePlay = () => {
    if (clips.length === 0) return;
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
      videoRef.current?.pause();
    } else {
      if (timeRef.current >= total - 0.05) seek(0);
      playingRef.current = true;
      setPlaying(true);
    }
  };

  /* ---------------- timeline: interações ---------------- */

  const timeFromX = useCallback(
    (clientX: number) => {
      const el = lanesRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return Math.max(0, (clientX - rect.left + el.scrollLeft) / pxPerSec);
    },
    [pxPerSec],
  );

  const onLanePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    seek(timeFromX(e.clientX));
    setSelection(null);
  };

  const onClipPointerDown = (clip: Clip) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const t = timeFromX(e.clientX);
    if (tool === "blade") {
      splitClip(clip.id, t);
      return;
    }
    setSelection({ kind: "clip", id: clip.id });
    dragRef.current = { kind: "clip", id: clip.id, grabOffset: t - clip.start };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onTextPointerDown =
    (layer: TextLayer, edge?: "start" | "end") => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      setSelection({ kind: "text", id: layer.id });
      const t = timeFromX(e.clientX);
      dragRef.current = edge
        ? { kind: "text-edge", id: layer.id, edge }
        : { kind: "text", id: layer.id, grabOffset: t - layer.start };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

  const onLanesPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const t = timeFromX(e.clientX);
    if (drag.kind === "clip") {
      setClips((cur) =>
        cur.map((c) => (c.id === drag.id ? { ...c, start: Math.max(0, t - drag.grabOffset) } : c)),
      );
    } else if (drag.kind === "text") {
      setTexts((cur) =>
        cur.map((l) => {
          if (l.id !== drag.id) return l;
          const len = l.end - l.start;
          const start = Math.max(0, t - drag.grabOffset);
          return { ...l, start, end: start + len };
        }),
      );
    } else if (drag.kind === "text-edge") {
      setTexts((cur) =>
        cur.map((l) => {
          if (l.id !== drag.id) return l;
          return drag.edge === "start"
            ? { ...l, start: Math.min(Math.max(0, t), l.end - 0.2) }
            : { ...l, end: Math.max(t, l.start + 0.2) };
        }),
      );
    } else if (drag.kind === "playhead") {
      seek(t);
    } else if (drag.kind === "sel") {
      setSel((prev) =>
        drag.edge === "start"
          ? { start: Math.min(t, prev.end - 0.1), end: prev.end }
          : { start: prev.start, end: Math.max(t, prev.start + 0.1) },
      );
    }
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  /* ---------------- edições ---------------- */

  const splitClip = (id: string, t: number) => {
    setClips((cur) => {
      const idx = cur.findIndex((c) => c.id === id);
      if (idx < 0) return cur;
      const c = cur[idx];
      const local = t - c.start;
      if (local < MIN_CLIP || local > clipDuration(c) - MIN_CLIP) return cur;
      const srcSplit = c.srcStart + local * (c.speed || 1);
      const left: Clip = { ...c, srcEnd: srcSplit };
      const right: Clip = {
        ...c,
        id: uid(),
        srcStart: srcSplit,
        start: c.start + local,
        zoomKeys: [],
      };
      const next = [...cur];
      next.splice(idx, 1, left, right);
      return next;
    });
    setResultStale();
  };

  const setResultStale = () => setResultUrl(null);

  const deleteSelected = () => {
    if (selection?.kind === "clip") {
      setClips((cur) => cur.filter((c) => c.id !== selection.id));
    } else if (selection?.kind === "text") {
      setTexts((cur) => cur.filter((t) => t.id !== selection.id));
    }
    setSelection(null);
    setResultStale();
  };

  const updateSelectedClip = (patch: Partial<Clip>) => {
    if (!selectedClip) return;
    setClips((cur) => cur.map((c) => (c.id === selectedClip.id ? { ...c, ...patch } : c)));
    setResultStale();
  };

  const updateSelectedText = (patch: Partial<TextLayer>) => {
    if (!selectedText) return;
    setTexts((cur) => cur.map((t) => (t.id === selectedText.id ? { ...t, ...patch } : t)));
    setResultStale();
  };

  const addText = () => {
    const start = Math.min(time, Math.max(0, total - 1));
    const layer: TextLayer = {
      id: uid(),
      text: "Novo texto",
      start,
      end: Math.min(total, start + 3),
      x: 0.5,
      y: 0.8,
      size: 72,
      color: "#ffffff",
    };
    setTexts((cur) => [...cur, layer]);
    setSelection({ kind: "text", id: layer.id });
    setResultStale();
  };

  const addZoomKey = () => {
    if (!selectedClip) return;
    const local = Math.max(0, Math.min(time - selectedClip.start, clipDuration(selectedClip)));
    const keys = [...selectedClip.zoomKeys.filter((k) => Math.abs(k.t - local) > 0.05), { t: local, scale: 1.5 }];
    updateSelectedClip({ zoomKeys: keys.sort((a, b) => a.t - b.t) });
  };

  const keepSelection = () => {
    setClips((cur) =>
      cur
        .map((c) => {
          const s = Math.max(c.start, sel.start);
          const e = Math.min(clipEnd(c), sel.end);
          if (e - s < MIN_CLIP) return null;
          const speed = c.speed || 1;
          return {
            ...c,
            srcStart: c.srcStart + (s - c.start) * speed,
            srcEnd: c.srcStart + (e - c.start) * speed,
            start: s,
          } as Clip;
        })
        .filter(Boolean) as Clip[],
    );
    setResultStale();
  };

  const removeSelection = () => {
    setClips((cur) => {
      const out: Clip[] = [];
      for (const c of cur) {
        const cs = c.start;
        const ce = clipEnd(c);
        const speed = c.speed || 1;
        if (sel.end <= cs || sel.start >= ce) {
          out.push(c);
          continue;
        }
        if (sel.start > cs) {
          out.push({ ...c, srcEnd: c.srcStart + (sel.start - cs) * speed });
        }
        if (sel.end < ce) {
          out.push({
            ...c,
            id: uid(),
            srcStart: c.srcStart + (sel.end - cs) * speed,
            start: sel.end,
            zoomKeys: [],
          });
        }
      }
      return out.filter((c) => clipDuration(c) > MIN_CLIP);
    });
    setResultStale();
  };

  const rippleClose = () => {
    setClips((cur) => {
      const sorted = [...cur].sort((a, b) => a.start - b.start);
      let cursor = 0;
      return sorted.map((c) => {
        const next = { ...c, start: cursor };
        cursor += clipDuration(c);
        return next;
      });
    });
    setResultStale();
  };

  const resetAll = () => {
    if (duration <= 0) return;
    setClips([
      {
        id: uid(),
        srcStart: 0,
        srcEnd: duration,
        start: 0,
        speed: 1,
        transition: "none",
        filters: { ...NEUTRAL },
        zoomKeys: [],
      },
    ]);
    setTexts([]);
    setSel({ start: 0, end: duration });
    setSelection(null);
    setResultStale();
  };

  /* ---------------- overlay de texto no player ---------------- */

  const onStagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectedText) return;
    textDragRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    moveTextTo(e);
  };
  const moveTextTo = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectedText) return;
    const rect = e.currentTarget.getBoundingClientRect();
    updateSelectedText({
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    });
  };

  /* ---------------- exportação ---------------- */

  const renderTextPng = useCallback(
    (layer: TextLayer) =>
      new Promise<Blob>((resolve, reject) => {
        const c = document.createElement("canvas");
        c.width = Math.round(srcSize.width / 2) * 2;
        c.height = Math.round(srcSize.height / 2) * 2;
        const ctx = c.getContext("2d")!;
        const fontSize = (layer.size / 1080) * c.height;
        ctx.font = `700 ${fontSize}px "DM Sans", system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = layer.color;
        ctx.shadowColor = "rgba(0,0,0,0.55)";
        ctx.shadowBlur = fontSize * 0.25;
        ctx.fillText(layer.text, layer.x * c.width, layer.y * c.height);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png");
      }),
    [srcSize],
  );

  const runExport = async () => {
    const blob = sourceBlobRef.current;
    if (!blob || clips.length === 0) return;
    setExporting(true);
    setProgress(0);
    setError(null);
    try {
      const ordered = [...clips].sort((a, b) => a.start - b.start);
      // mapeia tempo da timeline -> tempo no arquivo exportado
      const bounds: { from: number; to: number; out: number }[] = [];
      let acc = 0;
      for (const c of ordered) {
        const d = clipDuration(c);
        const trimmed = c.transition === "none" ? 0 : Math.min(0.5, d / 2);
        bounds.push({ from: c.start, to: c.start + d, out: acc - (acc > 0 ? trimmed : 0) });
        acc += d - (acc > 0 ? trimmed : 0);
      }
      const mapTime = (t: number) => {
        for (const b of bounds) {
          if (t >= b.from && t <= b.to) return b.out + (t - b.from);
        }
        return Math.min(Math.max(0, t - (ordered[0]?.start ?? 0)), acc);
      };

      const overlays = await Promise.all(
        texts
          .filter((t) => t.text.trim().length > 0 && t.end > t.start)
          .map(async (t) => ({
            png: await renderTextPng(t),
            start: mapTime(t.start),
            end: mapTime(t.end),
            x: 0,
            y: 0,
          })),
      );

      const payload: TimelineClip[] = ordered.map((c) => ({
        srcStart: c.srcStart,
        srcEnd: c.srcEnd,
        speed: c.speed || 1,
        filters: c.filters,
        transition: c.transition,
        zoomKeys: c.zoomKeys,
      }));

      const out = await exportTimeline(blob, payload, overlays, srcSize, (r) => setProgress(r));
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(out));
      setProgress(1);
    } catch (err) {
      console.error(err);
      setError("Falha ao exportar o vídeo. Tente simplificar as edições e tentar de novo.");
    } finally {
      setExporting(false);
    }
  };

  const downloadResult = () => {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = "gravaai-editado.mp4";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  /* ---------------- render ---------------- */

  const laneWidth = Math.max(total * pxPerSec + 80, 640);
  const ticks = useMemo(() => {
    const stepCandidates = [0.5, 1, 2, 5, 10, 30, 60];
    const step = stepCandidates.find((s) => s * pxPerSec >= 70) ?? 60;
    const out: number[] = [];
    for (let t = 0; t <= total + step; t += step) out.push(Number(t.toFixed(2)));
    return out;
  }, [total, pxPerSec]);

  const thumbSlice = (c: Clip) => {
    if (thumbs.length === 0 || duration <= 0) return [] as string[];
    const from = Math.floor((c.srcStart / duration) * thumbs.length);
    const to = Math.max(from + 1, Math.ceil((c.srcEnd / duration) * thumbs.length));
    return thumbs.slice(from, to);
  };

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-black/50 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--brand)]/15 text-[var(--brand)]">
              <Scissors className="h-4 w-4" />
            </span>
            <h1 className="font-display truncate text-sm font-bold tracking-tight sm:text-base">
              Editor Simplificado
            </h1>
            {fileName ? (
              <span className="hidden truncate text-xs text-[var(--muted-foreground)] sm:block">
                {fileName}
              </span>
            ) : null}
          </div>
          {srcUrl ? (
            <div className="flex items-center gap-2">
              <ActionButton
                tone="neutral"
                icon={<Upload className="h-4 w-4" />}
                onClick={() => inputRef.current?.click()}
              >
                Trocar vídeo
              </ActionButton>
              <ActionButton
                tone="download"
                icon={exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                onClick={runExport}
                disabled={exporting || clips.length === 0}
              >
                {exporting ? `Exportando… ${Math.round(progress * 100)}%` : "Exportar MP4"}
              </ActionButton>
            </div>
          ) : null}
        </div>
      </header>

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/*"
        className="hidden"
        onChange={onPick}
      />

      <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6">
        {error ? (
          <div className="mb-4 rounded-lg border border-[var(--brand)]/40 bg-[var(--brand)]/10 px-4 py-3 text-sm text-[var(--brand)]">
            {error}
          </div>
        ) : null}

        {!srcUrl ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-white/15 bg-[var(--surface)] px-6 py-24 text-center"
          >
            {loading ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-[var(--brand)]" />
                <p className="text-sm text-[var(--muted-foreground)]">Carregando vídeo…</p>
              </>
            ) : (
              <>
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--brand)]/15 text-[var(--brand)]">
                  <Video className="h-7 w-7" />
                </span>
                <div>
                  <h2 className="font-display text-xl font-bold tracking-tight">
                    Importe um vídeo para começar
                  </h2>
                  <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                    Arraste um MP4 aqui ou selecione um arquivo. Você também pode gravar na
                    home e clicar em “Enviar para o editor”. Tudo roda no seu navegador.
                  </p>
                </div>
                <ActionButton
                  tone="record"
                  icon={<Upload className="h-4 w-4" />}
                  onClick={() => inputRef.current?.click()}
                >
                  Selecionar arquivo
                </ActionButton>
              </>
            )}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            {/* Player */}
            <div className="space-y-3">
              <div
                onPointerDown={onStagePointerDown}
                onPointerMove={(e) => textDragRef.current && moveTextTo(e)}
                onPointerUp={() => (textDragRef.current = false)}
                className={cn(
                  "relative overflow-hidden rounded-2xl border border-[var(--border)] bg-black",
                  selectedText && "cursor-move",
                )}
              >
                <canvas ref={canvasRef} className="aspect-video w-full bg-black object-contain" />
                <video
                  ref={videoRef}
                  src={srcUrl}
                  onLoadedMetadata={onLoadedMetadata}
                  playsInline
                  className="pointer-events-none absolute h-px w-px opacity-0"
                />
                {selectedText ? (
                  <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-[11px] text-[var(--muted-foreground)]">
                    Arraste no player para posicionar o texto
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ActionButton
                  tone="neutral"
                  icon={playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  onClick={togglePlay}
                >
                  {playing ? "Pausar" : "Reproduzir"}
                </ActionButton>
                <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
                  {fmt(time)} / {fmt(total)}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => setTool("select")}
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold",
                      tool === "select"
                        ? "bg-[var(--brand)] text-white"
                        : "bg-[var(--surface-2)] text-[var(--muted-foreground)]",
                    )}
                  >
                    <MousePointer2 className="h-3.5 w-3.5" /> Selecionar
                  </button>
                  <button
                    onClick={() => setTool("blade")}
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold",
                      tool === "blade"
                        ? "bg-[var(--brand)] text-white"
                        : "bg-[var(--surface-2)] text-[var(--muted-foreground)]",
                    )}
                  >
                    <SplitSquareHorizontal className="h-3.5 w-3.5" /> Lâmina
                  </button>
                  <button
                    onClick={addText}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-xs font-semibold text-[var(--foreground)]"
                  >
                    <Type className="h-3.5 w-3.5" /> Adicionar texto
                  </button>
                  <button
                    onClick={deleteSelected}
                    disabled={!selection}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-xs font-semibold text-[var(--muted-foreground)] disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Excluir
                  </button>
                </div>
              </div>
            </div>

            {/* Inspetor */}
            <aside className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="font-display text-sm font-bold tracking-tight">Propriedades</h2>

              {selectedClip ? (
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                      Velocidade
                    </label>
                    <select
                      value={selectedClip.speed}
                      onChange={(e) => updateSelectedClip({ speed: Number(e.target.value) })}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
                    >
                      {[0.5, 0.75, 1, 1.5, 2].map((s) => (
                        <option key={s} value={s}>
                          {s}x
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                      Transição de entrada
                    </label>
                    <select
                      value={selectedClip.transition}
                      onChange={(e) =>
                        updateSelectedClip({ transition: e.target.value as TransitionKind })
                      }
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
                    >
                      <option value="none">Corte seco</option>
                      <option value="fade">Fade</option>
                      <option value="slide">Slide</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--muted-foreground)]">
                        Zoom (keyframes)
                      </span>
                      <button
                        onClick={addZoomKey}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand)]"
                      >
                        <Plus className="h-3 w-3" /> no playhead
                      </button>
                    </div>
                    {selectedClip.zoomKeys.length === 0 ? (
                      <p className="text-[11px] text-[var(--muted-foreground)]">
                        Nenhum keyframe. Posicione o playhead e adicione.
                      </p>
                    ) : (
                      selectedClip.zoomKeys.map((k, i) => (
                        <div key={`${k.t}-${i}`} className="flex items-center gap-2">
                          <span className="w-12 text-[11px] tabular-nums text-[var(--muted-foreground)]">
                            {k.t.toFixed(1)}s
                          </span>
                          <input
                            type="range"
                            min={1}
                            max={3}
                            step={0.05}
                            value={k.scale}
                            onChange={(e) => {
                              const keys = selectedClip.zoomKeys.map((kk, ii) =>
                                ii === i ? { ...kk, scale: Number(e.target.value) } : kk,
                              );
                              updateSelectedClip({ zoomKeys: keys });
                            }}
                            className="flex-1 accent-[var(--brand)]"
                          />
                          <span className="w-10 text-right text-[11px] tabular-nums">
                            {Math.round(k.scale * 100)}%
                          </span>
                          <button
                            onClick={() =>
                              updateSelectedClip({
                                zoomKeys: selectedClip.zoomKeys.filter((_, ii) => ii !== i),
                              })
                            }
                            className="text-[var(--muted-foreground)] hover:text-[var(--brand)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="space-y-3 border-t border-[var(--border)] pt-3">
                    {(
                      [
                        ["Brilho", "brightness", -0.5, 0.5, 0.01],
                        ["Contraste", "contrast", 0.5, 2, 0.01],
                        ["Saturação", "saturation", 0, 3, 0.01],
                      ] as const
                    ).map(([label, key, min, max, step]) => (
                      <div key={key}>
                        <div className="mb-1 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                          <span>{label}</span>
                          <span className="tabular-nums">{selectedClip.filters[key].toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={step}
                          value={selectedClip.filters[key]}
                          onChange={(e) =>
                            updateSelectedClip({
                              filters: { ...selectedClip.filters, [key]: Number(e.target.value) },
                            })
                          }
                          className="w-full accent-[var(--brand)]"
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => updateSelectedClip({ filters: { ...NEUTRAL } })}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--muted-foreground)] hover:text-white"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Resetar ajustes
                    </button>
                  </div>
                </div>
              ) : selectedText ? (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs text-[var(--muted-foreground)]">
                      Conteúdo
                    </label>
                    <input
                      value={selectedText.text}
                      onChange={(e) => updateSelectedText({ text: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
                      <span>Tamanho</span>
                      <span className="tabular-nums">{selectedText.size}px</span>
                    </div>
                    <input
                      type="range"
                      min={24}
                      max={200}
                      step={2}
                      value={selectedText.size}
                      onChange={(e) => updateSelectedText({ size: Number(e.target.value) })}
                      className="w-full accent-[var(--brand)]"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--muted-foreground)]">Cor</span>
                    <input
                      type="color"
                      value={selectedText.color}
                      onChange={(e) => updateSelectedText({ color: e.target.value })}
                      className="h-8 w-14 rounded border border-[var(--border)] bg-transparent"
                    />
                  </div>
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    Entrada e saída: arraste as bordas do clipe de texto na timeline.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[var(--muted-foreground)]">
                  Selecione um clipe ou uma camada de texto na timeline para editar as
                  propriedades.
                </p>
              )}

              <div className="space-y-2 border-t border-[var(--border)] pt-3">
                <button
                  onClick={rippleClose}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs font-semibold"
                >
                  Fechar espaços entre clipes
                </button>
                <button
                  onClick={resetAll}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs font-semibold text-[var(--muted-foreground)]"
                >
                  Recomeçar edição
                </button>
              </div>

              {exporting ? (
                <div className="space-y-1 border-t border-[var(--border)] pt-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div
                      className="h-full bg-[var(--brand)] transition-all"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    Processando localmente… {Math.round(progress * 100)}%
                  </p>
                </div>
              ) : null}

              {resultUrl ? (
                <ActionButton
                  tone="download"
                  icon={<Download className="h-4 w-4" />}
                  onClick={downloadResult}
                  className="w-full"
                >
                  Baixar MP4
                </ActionButton>
              ) : null}
            </aside>

            {/* Timeline */}
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 lg:col-span-2">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold text-[var(--muted-foreground)]">
                  Timeline
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={keepSelection}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11px] font-semibold"
                  >
                    Manter seleção
                  </button>
                  <button
                    onClick={removeSelection}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[11px] font-semibold"
                  >
                    Remover seleção
                  </button>
                  <button
                    onClick={() => setPxPerSec((p) => Math.max(15, p / 1.5))}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)]"
                  >
                    <ZoomOut className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setPxPerSec((p) => Math.min(400, p * 1.5))}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)]"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div
                ref={lanesRef}
                onPointerMove={onLanesPointerMove}
                onPointerUp={endDrag}
                onPointerLeave={endDrag}
                className="relative overflow-x-auto pb-2"
              >
                <div style={{ width: laneWidth }} className="relative">
                  {/* Régua */}
                  <div
                    className="relative h-7 cursor-pointer select-none border-b border-[var(--border)]"
                    onPointerDown={(e) => {
                      dragRef.current = { kind: "playhead" };
                      seek(timeFromX(e.clientX));
                    }}
                  >
                    {ticks.map((t) => (
                      <span
                        key={t}
                        style={{ left: t * pxPerSec }}
                        className="absolute top-1 text-[10px] tabular-nums text-[var(--muted-foreground)]"
                      >
                        {fmt(t).slice(0, 5)}
                      </span>
                    ))}
                    {/* seleção in/out */}
                    <div
                      className="absolute bottom-0 top-0 bg-[var(--info)]/15"
                      style={{ left: sel.start * pxPerSec, width: Math.max(0, (sel.end - sel.start) * pxPerSec) }}
                    />
                    {(["start", "end"] as const).map((edge) => (
                      <div
                        key={edge}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          dragRef.current = { kind: "sel", edge };
                        }}
                        style={{ left: (edge === "start" ? sel.start : sel.end) * pxPerSec - 4 }}
                        className="absolute bottom-0 top-0 w-2 cursor-ew-resize rounded bg-[var(--info)]"
                      />
                    ))}
                  </div>

                  {/* Faixa de vídeo */}
                  <Lane label="Vídeo" onPointerDown={onLanePointerDown}>
                    {clips.map((c) => (
                      <div
                        key={c.id}
                        onPointerDown={onClipPointerDown(c)}
                        style={{ left: c.start * pxPerSec, width: Math.max(8, clipDuration(c) * pxPerSec) }}
                        className={cn(
                          "absolute inset-y-1 overflow-hidden rounded-md border bg-[var(--surface-2)]",
                          tool === "blade" ? "cursor-crosshair" : "cursor-grab",
                          selection?.kind === "clip" && selection.id === c.id
                            ? "border-[var(--brand)] ring-1 ring-[var(--brand)]"
                            : "border-white/10",
                        )}
                      >
                        <div className="pointer-events-none flex h-full">
                          {thumbSlice(c).map((src, i) => (
                            <img key={i} src={src} alt="" className="h-full w-auto opacity-70" />
                          ))}
                        </div>
                        {c.transition !== "none" ? (
                          <span className="pointer-events-none absolute left-0 top-0 h-full w-6 bg-gradient-to-r from-[var(--brand)]/70 to-transparent" />
                        ) : null}
                        <span className="pointer-events-none absolute bottom-0.5 left-1 rounded bg-black/60 px-1 text-[10px] tabular-nums text-white">
                          {c.speed !== 1 ? `${c.speed}x · ` : ""}
                          {fmt(clipDuration(c)).slice(0, 5)}
                        </span>
                        {c.zoomKeys.map((k, i) => (
                          <span
                            key={i}
                            style={{ left: k.t * pxPerSec - 3 }}
                            className="pointer-events-none absolute top-1 h-2 w-2 rotate-45 bg-[var(--info)]"
                          />
                        ))}
                      </div>
                    ))}
                  </Lane>

                  {/* Faixa de áudio */}
                  <Lane
                    label="Áudio"
                    right={
                      <button
                        onClick={() => setMuted((m) => !m)}
                        className="text-[10px] font-semibold text-[var(--muted-foreground)] hover:text-white"
                      >
                        {muted ? "Ativar" : "Mudo"}
                      </button>
                    }
                  >
                    {clips.map((c) => (
                      <div
                        key={c.id}
                        style={{ left: c.start * pxPerSec, width: Math.max(8, clipDuration(c) * pxPerSec) }}
                        className={cn(
                          "absolute inset-y-2 rounded-md border border-[var(--info)]/30 bg-[var(--info)]/15",
                          muted && "opacity-40",
                        )}
                      />
                    ))}
                  </Lane>

                  {/* Faixa de texto */}
                  <Lane label="Texto" onPointerDown={onLanePointerDown}>
                    {texts.map((l) => (
                      <div
                        key={l.id}
                        onPointerDown={onTextPointerDown(l)}
                        style={{ left: l.start * pxPerSec, width: Math.max(24, (l.end - l.start) * pxPerSec) }}
                        className={cn(
                          "absolute inset-y-2 cursor-grab overflow-hidden rounded-md border bg-[var(--brand)]/20 px-2 text-[10px] leading-[26px] text-white",
                          selection?.kind === "text" && selection.id === l.id
                            ? "border-[var(--brand)] ring-1 ring-[var(--brand)]"
                            : "border-[var(--brand)]/40",
                        )}
                      >
                        <span className="pointer-events-none truncate">{l.text}</span>
                        <span
                          onPointerDown={onTextPointerDown(l, "start")}
                          className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-[var(--brand)]"
                        />
                        <span
                          onPointerDown={onTextPointerDown(l, "end")}
                          className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-[var(--brand)]"
                        />
                      </div>
                    ))}
                  </Lane>

                  {/* Faixa de webcam */}
                  <Lane label="Webcam">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted-foreground)]">
                      A bolha da webcam já vem embutida na gravação — sem faixa separada.
                    </span>
                  </Lane>

                  {/* Playhead */}
                  <div
                    className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-[var(--brand)]"
                    style={{ left: time * pxPerSec }}
                  >
                    <span className="absolute -left-1.5 top-0 h-2.5 w-2.5 rounded-full bg-[var(--brand)]" />
                  </div>
                </div>
              </div>

              {clips.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-[var(--muted-foreground)]">
                  Timeline vazia. Use “Recomeçar edição” para restaurar o clipe original.
                </p>
              ) : null}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function Lane({
  label,
  right,
  children,
  onPointerDown,
}: {
  label: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className="relative mt-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          {label}
        </span>
        {right}
      </div>
      <div
        onPointerDown={onPointerDown}
        className="relative h-14 w-full rounded-lg border border-[var(--border)] bg-black/30"
      >
        {children}
      </div>
    </div>
  );
}
