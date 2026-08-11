import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  AudioLines,
  Captions,
  Check,
  Copy,
  Crop,
  Download,
  Droplets,
  FlipHorizontal2,
  Focus,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Move,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Scissors,
  Shapes,
  SplitSquareHorizontal,
  Trash2,
  Type,
  Undo2,
  Upload,
  Video,
  Volume2,
  VolumeX,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  exportTimeline,
  type BlurRegion,
  type TimelineClip,
  type TransitionKind,
  type ZoomKey,
} from "@/lib/ffmpeg-convert";
import { detectSilences, detectSpeechBlocks, type Segment } from "@/lib/audio-tools";
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
  volume: number;
  fadeIn: number;
  fadeOut: number;
  animIn: "none" | "fade" | "slide";
  animOut: "none" | "fade" | "slide";
  denoise: boolean;
}

interface TextLayer {
  id: string;
  lane: "text" | "overlay";
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  size: number;
  color: string;
  bg: string; // "" = sem fundo
  font: string;
  align: "left" | "center" | "right";
  animIn: "none" | "fade" | "slide";
  animOut: "none" | "fade" | "slide";
  caption?: boolean;
}

/** Camada retangular sobre o preview: blur ou spotlight. */
interface ShapeLayer {
  id: string;
  kind: "blur" | "spotlight";
  start: number;
  end: number;
  /** frações do quadro (0..1) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** blur: intensidade do desfoque; spotlight: escurecimento ao redor */
  strength: number;
  color: string;
}

interface SilenceMark extends Segment {
  id: string;
  status: "pending" | "ignored";
}

type Selection = { kind: "clip" | "text" | "shape"; id: string } | null;
type PanelId = "upload" | "audio" | "text" | "elements" | "captions" | "transitions";

interface Snapshot {
  clips: Clip[];
  texts: TextLayer[];
  shapes: ShapeLayer[];
}

const uid = () => Math.random().toString(36).slice(2, 9);

function fmt(t: number) {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${cs}`;
}
const short = (t: number) => fmt(t).slice(0, 5);

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

const PANELS: { id: PanelId; label: string; Icon: typeof Upload }[] = [
  { id: "upload", label: "Upload", Icon: Upload },
  { id: "audio", label: "Áudio", Icon: Music },
  { id: "text", label: "Texto", Icon: Type },
  { id: "captions", label: "Legendas", Icon: Captions },
  { id: "elements", label: "Elementos", Icon: Shapes },
  { id: "transitions", label: "Transições", Icon: Wand2 },
];

const FONTS: readonly (readonly [string, string])[] = [
  ["DM Sans", "DM Sans"],
  ["Georgia", "Georgia"],
  ["Impact", "Impact"],
  ["Courier New", "Courier"],
];

const CAPTION_POSITIONS: readonly (readonly [string, number])[] = [
  ["Topo", 0.12],
  ["Centro", 0.5],
  ["Base", 0.86],
];


const FILTER_PRESETS: { name: string; filters: Filters }[] = [
  { name: "Original", filters: { ...NEUTRAL } },
  { name: "Vívido", filters: { brightness: 0.05, contrast: 1.2, saturation: 1.5 } },
  { name: "P&B", filters: { brightness: 0, contrast: 1.15, saturation: 0 } },
  { name: "Vintage", filters: { brightness: 0.08, contrast: 0.9, saturation: 0.7 } },
  { name: "Frio", filters: { brightness: -0.03, contrast: 1.1, saturation: 0.9 } },
  { name: "Clarear", filters: { brightness: 0.18, contrast: 1, saturation: 1.05 } },
];

const TEXT_TEMPLATES: { name: string; size: number; color: string; y: number }[] = [
  { name: "Título", size: 110, color: "#ffffff", y: 0.22 },
  { name: "Subtítulo", size: 64, color: "#e8e8e8", y: 0.34 },
  { name: "Legenda", size: 52, color: "#ffffff", y: 0.86 },
  { name: "Destaque", size: 88, color: "#ff3b30", y: 0.5 },
];

const STICKERS = ["⭐", "🔥", "👉", "✅", "❗", "💡", "🎯", "❤️"];

const RATIOS: { id: string; label: string; value: number }[] = [
  { id: "16:9", label: "16:9", value: 16 / 9 },
  { id: "9:16", label: "9:16", value: 9 / 16 },
  { id: "1:1", label: "1:1", value: 1 },
];

export function VideoEditor() {
  const [projectName, setProjectName] = useState("Projeto sem título");
  const [editingName, setEditingName] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [srcSize, setSrcSize] = useState({ width: 1280, height: 720 });
  const [duration, setDuration] = useState(0);
  const [clips, setClips] = useState<Clip[]>([]);
  const [texts, setTexts] = useState<TextLayer[]>([]);
  const [shapes, setShapes] = useState<ShapeLayer[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<"select" | "blade">("select");
  const [pxPerSec, setPxPerSec] = useState(60);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [sel, setSel] = useState({ start: 0, end: 0 });
  const [muted, setMuted] = useState(false);
  const [panel, setPanel] = useState<PanelId | null>("upload");
  const [previewZoom, setPreviewZoom] = useState(1);
  const [ratio, setRatio] = useState(RATIOS[0]);
  const [contentOffset, setContentOffset] = useState({ x: 0, y: 0 });
  const [inspectorTab, setInspectorTab] = useState<"basic" | "audio" | "speed">("basic");
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);

  // Cortador de silêncio
  const [silences, setSilences] = useState<SilenceMark[]>([]);
  const [silenceOpen, setSilenceOpen] = useState(false);
  const [silenceBusy, setSilenceBusy] = useState(false);
  const [sensitivity, setSensitivity] = useState(0.5);

  // Legendas
  const [captionsBusy, setCaptionsBusy] = useState(false);
  const [captionStyle, setCaptionStyle] = useState({
    font: "DM Sans",
    size: 52,
    color: "#ffffff",
    bg: "#000000",
    y: 0.86,
  });

  // Ruído de fundo (preview antes/depois)
  const [bypassDenoise, setBypassDenoise] = useState(false);

  const sourceBlobRef = useRef<Blob | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lanesRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const stateRef = useRef({ clips, texts, shapes, srcSize, selection, ratio, contentOffset });
  stateRef.current = { clips, texts, shapes, srcSize, selection, ratio, contentOffset };
  const dragRef = useRef<
    | { kind: "clip"; id: string; grabOffset: number }
    | { kind: "text"; id: string; grabOffset: number }
    | { kind: "text-edge"; id: string; edge: "start" | "end" }
    | { kind: "shape"; id: string; grabOffset: number }
    | { kind: "shape-edge"; id: string; edge: "start" | "end" }
    | { kind: "playhead" }
    | { kind: "sel"; edge: "start" | "end" }
    | null
  >(null);
  const stageDragRef = useRef<
    | { kind: "text" }
    | { kind: "shape-move"; id: string; dx: number; dy: number }
    | { kind: "shape-resize"; id: string }
    | { kind: "frame"; x: number; y: number; ox: number; oy: number }
    | null
  >(null);

  const total = useMemo(() => {
    const a = clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
    const b = texts.reduce((m, t) => Math.max(m, t.end), 0);
    const c = shapes.reduce((m, s) => Math.max(m, s.end), 0);
    return Math.max(a, b, c, 1);
  }, [clips, texts, shapes]);

  const selectedClip = useMemo(
    () => (selection?.kind === "clip" ? clips.find((c) => c.id === selection.id) ?? null : null),
    [selection, clips],
  );
  const selectedText = useMemo(
    () => (selection?.kind === "text" ? texts.find((t) => t.id === selection.id) ?? null : null),
    [selection, texts],
  );
  const selectedShape = useMemo(
    () => (selection?.kind === "shape" ? shapes.find((s) => s.id === selection.id) ?? null : null),
    [selection, shapes],
  );

  /** Quadro de saída de acordo com a proporção escolhida. */
  const frame = useMemo(() => {
    const base = Math.max(srcSize.width, srcSize.height);
    const h = ratio.value >= 1 ? Math.round(base / ratio.value) : base;
    const w = Math.round(h * ratio.value);
    return { width: Math.max(2, Math.round(w / 2) * 2), height: Math.max(2, Math.round(h / 2) * 2) };
  }, [srcSize, ratio]);

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

  useEffect(() => {
    setInspectorTab(selectedClip ? "basic" : "basic");
  }, [selection?.id]);

  /* ---------------- histórico ---------------- */

  const commit = useCallback(() => {
    setPast((p) => [...p.slice(-49), { clips, texts, shapes }]);
    setFuture([]);
    setResultUrl(null);
  }, [clips, texts, shapes]);

  const undo = () => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [{ clips, texts, shapes }, ...f].slice(0, 50));
      setClips(prev.clips);
      setTexts(prev.texts);
      setShapes(prev.shapes);
      setSelection(null);
      return p.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setPast((p) => [...p, { clips, texts, shapes }]);
      setClips(next.clips);
      setTexts(next.texts);
      setShapes(next.shapes);
      setSelection(null);
      return f.slice(1);
    });
  };

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
    const ratioWH = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9;
    canvas.height = h;
    canvas.width = Math.round(h * ratioWH);
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

  const generatePeaks = useCallback(async (blob: Blob) => {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return [] as number[];
      const ctx = new Ctx();
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      const data = buf.getChannelData(0);
      const N = 400;
      const step = Math.max(1, Math.floor(data.length / N));
      const out: number[] = [];
      for (let i = 0; i < N; i++) {
        let peak = 0;
        for (let j = 0; j < step; j += 8) {
          const v = Math.abs(data[i * step + j] ?? 0);
          if (v > peak) peak = v;
        }
        out.push(Math.min(1, peak));
      }
      void ctx.close();
      return out;
    } catch {
      return [] as number[];
    }
  }, []);

  const loadBlob = useCallback(
    async (blob: Blob, name: string) => {
      const okType = blob.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(name);
      if (!okType) {
        setError("Formato não suportado. Envie um arquivo de vídeo MP4.");
        return;
      }
      setError(null);
      setLoading(true);
      setResultUrl(null);
      setThumbs([]);
      setPeaks([]);
      setTexts([]);
      setShapes([]);
      setSilences([]);
      setClips([]);
      setPast([]);
      setFuture([]);
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
        setProjectName((cur) =>
          cur === "Projeto sem título" ? name.replace(/\.[^.]+$/, "") : cur,
        );
        const list = await generateThumbs(url).catch(() => [] as string[]);
        setThumbs(list);
        void generatePeaks(blob).then(setPeaks);
      } catch (err) {
        console.error(err);
        setError("Não foi possível ler este vídeo. Tente outro arquivo MP4.");
      } finally {
        setLoading(false);
      }
    },
    [generateThumbs, generatePeaks],
  );

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

  const initializedUrlRef = useRef<string | null>(null);
  const onLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
    if (initializedUrlRef.current === v.currentSrc) return;
    initializedUrlRef.current = v.currentSrc;
    setDuration(v.duration);
    setSrcSize({ width: v.videoWidth || 1280, height: v.videoHeight || 720 });
    setClips([newClip(0, v.duration)]);
    setSel({ start: 0, end: v.duration });
  }, []);

  // O evento pode disparar antes da hidratação; garantimos a leitura aqui.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !srcUrl) return;
    const handler = () => onLoadedMetadata();
    v.addEventListener("loadedmetadata", handler);
    v.addEventListener("durationchange", handler);
    if (v.readyState >= 1) handler();
    return () => {
      v.removeEventListener("loadedmetadata", handler);
      v.removeEventListener("durationchange", handler);
    };
  }, [srcUrl, onLoadedMetadata]);


  /* ---------------- preview ---------------- */

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const {
        clips: cs,
        texts: ts,
        shapes: sh,
        srcSize: size,
        ratio: rt,
        contentOffset: off,
      } = stateRef.current;

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
        video.volume = Math.min(1, Math.max(0, clip.volume));
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
        const base = Math.max(size.width, size.height);
        const H = Math.max(2, Math.round((rt.value >= 1 ? base / rt.value : base) / 2) * 2);
        const W = Math.max(2, Math.round((H * rt.value) / 2) * 2);
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

        let placed: { dx: number; dy: number; dw: number; dh: number } | null = null;
        if (video && clip && video.readyState >= 2) {
          const local = t - clip.start;
          const f = clip.filters;
          const z = Math.max(1, zoomAt(clip.zoomKeys, local));
          let alpha = 1;
          let shiftX = 0;
          const dur = clipDuration(clip);
          const isFirst = cs.length > 0 && cs.indexOf(clip) === 0;
          if (!isFirst && clip.transition !== "none") {
            const d = Math.min(0.5, dur / 2);
            if (local < d) {
              const r = local / d;
              if (clip.transition === "fade") alpha = r;
              else shiftX = (1 - r) * W;
            }
          }
          const vw = size.width;
          const vh = size.height;
          const fit = Math.min(W / vw, H / vh) * z;
          const dw = vw * fit;
          const dh = vh * fit;
          const dx = (W - dw) / 2 + (off.x * W) / 2 + shiftX;
          const dy = (H - dh) / 2 + (off.y * H) / 2;
          placed = { dx, dy, dw, dh };
          ctx.filter = `brightness(${(1 + f.brightness).toFixed(3)}) contrast(${f.contrast.toFixed(
            3,
          )}) saturate(${f.saturation.toFixed(3)})`;
          ctx.globalAlpha = alpha;
          ctx.drawImage(video, dx, dy, dw, dh);
          ctx.filter = "none";
          ctx.globalAlpha = 1;
        }

        // Camadas de blur e spotlight
        for (const s of sh) {
          if (t < s.start || t > s.end) continue;
          const rx = s.x * W;
          const ry = s.y * H;
          const rw = s.w * W;
          const rh = s.h * H;
          if (s.kind === "blur") {
            if (!video || !placed) continue;
            ctx.save();
            ctx.beginPath();
            ctx.rect(rx, ry, rw, rh);
            ctx.clip();
            ctx.filter = `blur(${Math.max(1, s.strength).toFixed(0)}px)`;
            ctx.drawImage(video, placed.dx, placed.dy, placed.dw, placed.dh);
            ctx.filter = "none";
            ctx.restore();
          } else {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, W, H);
            ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0,0,0,${Math.min(0.95, Math.max(0, s.strength))})`;
            ctx.fill("evenodd");
            ctx.beginPath();
            ctx.ellipse(rx + rw / 2, ry + rh / 2, rw / 2, rh / 2, 0, 0, Math.PI * 2);
            ctx.strokeStyle = s.color;
            ctx.lineWidth = Math.max(2, W * 0.004);
            ctx.stroke();
            ctx.restore();
          }
        }

        for (const layer of ts) {
          if (t < layer.start || t > layer.end) continue;
          const fontSize = (layer.size / 1080) * H;
          ctx.font = `700 ${fontSize}px "${layer.font || "DM Sans"}", system-ui, sans-serif`;
          ctx.textAlign = layer.align;
          ctx.textBaseline = "middle";
          if (layer.bg) {
            const m = ctx.measureText(layer.text);
            const padX = fontSize * 0.35;
            const padY = fontSize * 0.28;
            const bx =
              layer.align === "center"
                ? layer.x * W - m.width / 2
                : layer.align === "right"
                  ? layer.x * W - m.width
                  : layer.x * W;
            ctx.fillStyle = layer.bg;
            ctx.globalAlpha = 0.7;
            ctx.fillRect(
              bx - padX,
              layer.y * H - fontSize / 2 - padY,
              m.width + padX * 2,
              fontSize + padY * 2,
            );
            ctx.globalAlpha = 1;
          }
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

  /* ---------------- timeline ---------------- */

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
    commit();
    dragRef.current = { kind: "clip", id: clip.id, grabOffset: t - clip.start };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onTextPointerDown =
    (layer: TextLayer, edge?: "start" | "end") => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      setSelection({ kind: "text", id: layer.id });
      commit();
      const t = timeFromX(e.clientX);
      dragRef.current = edge
        ? { kind: "text-edge", id: layer.id, edge }
        : { kind: "text", id: layer.id, grabOffset: t - layer.start };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

  const onShapePointerDown =
    (layer: ShapeLayer, edge?: "start" | "end") => (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      setSelection({ kind: "shape", id: layer.id });
      commit();
      const t = timeFromX(e.clientX);
      dragRef.current = edge
        ? { kind: "shape-edge", id: layer.id, edge }
        : { kind: "shape", id: layer.id, grabOffset: t - layer.start };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

  const laneUnderPointer = (clientY: number, clientX: number): "text" | "overlay" | null => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const lane = el?.closest("[data-lane]") as HTMLElement | null;
    const id = lane?.dataset.lane;
    return id === "text" || id === "overlay" ? id : null;
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
      const lane = laneUnderPointer(e.clientY, e.clientX);
      setTexts((cur) =>
        cur.map((l) => {
          if (l.id !== drag.id) return l;
          const len = l.end - l.start;
          const start = Math.max(0, t - drag.grabOffset);
          return { ...l, start, end: start + len, lane: lane ?? l.lane };
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
    } else if (drag.kind === "shape") {
      setShapes((cur) =>
        cur.map((s) => {
          if (s.id !== drag.id) return s;
          const len = s.end - s.start;
          const start = Math.max(0, t - drag.grabOffset);
          return { ...s, start, end: start + len };
        }),
      );
    } else if (drag.kind === "shape-edge") {
      setShapes((cur) =>
        cur.map((s) => {
          if (s.id !== drag.id) return s;
          return drag.edge === "start"
            ? { ...s, start: Math.min(Math.max(0, t), s.end - 0.2) }
            : { ...s, end: Math.max(t, s.start + 0.2) };
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

  function newClip(srcStart: number, srcEnd: number, start = 0): Clip {
    return {
      id: uid(),
      srcStart,
      srcEnd,
      start,
      speed: 1,
      transition: "none",
      filters: { ...NEUTRAL },
      zoomKeys: [],
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      animIn: "none",
      animOut: "none",
      denoise: false,
    };
  }

  const splitClip = (id: string, t: number) => {
    commit();
    setClips((cur) => {
      const idx = cur.findIndex((c) => c.id === id);
      if (idx < 0) return cur;
      const c = cur[idx];
      const local = t - c.start;
      if (local < MIN_CLIP || local > clipDuration(c) - MIN_CLIP) return cur;
      const srcSplit = c.srcStart + local * (c.speed || 1);
      const left: Clip = { ...c, srcEnd: srcSplit };
      const right: Clip = { ...c, id: uid(), srcStart: srcSplit, start: c.start + local, zoomKeys: [] };
      const next = [...cur];
      next.splice(idx, 1, left, right);
      return next;
    });
  };

  const splitAtPlayhead = () => {
    const target = selectedClip ?? clips.find((c) => time > c.start && time < clipEnd(c));
    if (target) splitClip(target.id, time);
  };

  const deleteSelected = () => {
    if (!selection) return;
    commit();
    if (selection.kind === "clip") setClips((cur) => cur.filter((c) => c.id !== selection.id));
    else if (selection.kind === "shape") setShapes((cur) => cur.filter((s) => s.id !== selection.id));
    else setTexts((cur) => cur.filter((t) => t.id !== selection.id));
    setSelection(null);
  };

  const duplicateSelected = () => {
    if (!selection) return;
    commit();
    if (selectedClip) {
      const copy: Clip = {
        ...selectedClip,
        id: uid(),
        start: clipEnd(selectedClip),
        zoomKeys: [...selectedClip.zoomKeys],
      };
      setClips((cur) => [...cur, copy]);
      setSelection({ kind: "clip", id: copy.id });
    } else if (selectedText) {
      const len = selectedText.end - selectedText.start;
      const copy: TextLayer = {
        ...selectedText,
        id: uid(),
        start: selectedText.end,
        end: selectedText.end + len,
      };
      setTexts((cur) => [...cur, copy]);
      setSelection({ kind: "text", id: copy.id });
    }
  };

  const updateSelectedClip = (patch: Partial<Clip>, record = true) => {
    if (!selectedClip) return;
    if (record) commit();
    setClips((cur) => cur.map((c) => (c.id === selectedClip.id ? { ...c, ...patch } : c)));
  };

  const updateSelectedText = (patch: Partial<TextLayer>, record = true) => {
    if (!selectedText) return;
    if (record) commit();
    setTexts((cur) => cur.map((t) => (t.id === selectedText.id ? { ...t, ...patch } : t)));
  };

  const addText = (
    preset?: Partial<TextLayer> & { text?: string },
    lane: "text" | "overlay" = "text",
  ) => {
    commit();
    const start = Math.min(time, Math.max(0, total - 1));
    const layer: TextLayer = {
      id: uid(),
      lane,
      text: "Novo texto",
      start,
      end: Math.min(Math.max(total, start + 3), start + 3),
      x: 0.5,
      y: 0.8,
      size: 72,
      color: "#ffffff",
      align: "center",
      animIn: "none",
      animOut: "none",
      bg: "",
      font: "DM Sans",
      caption: false,
      ...preset,
    };
    setTexts((cur) => [...cur, layer]);
    setSelection({ kind: "text", id: layer.id });
    setPanel(null);
  };

  const addZoomKey = () => {
    if (!selectedClip) return;
    const local = Math.max(0, Math.min(time - selectedClip.start, clipDuration(selectedClip)));
    const keys = [
      ...selectedClip.zoomKeys.filter((k) => Math.abs(k.t - local) > 0.05),
      { t: local, scale: 1.5 },
    ];
    updateSelectedClip({ zoomKeys: keys.sort((a, b) => a.t - b.t) });
  };

  const keepSelection = () => {
    commit();
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
  };

  const removeSelection = () => {
    commit();
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
        if (sel.start > cs) out.push({ ...c, srcEnd: c.srcStart + (sel.start - cs) * speed });
        if (sel.end < ce)
          out.push({
            ...c,
            id: uid(),
            srcStart: c.srcStart + (sel.end - cs) * speed,
            start: sel.end,
            zoomKeys: [],
          });
      }
      return out.filter((c) => clipDuration(c) > MIN_CLIP);
    });
  };

  const rippleClose = () => {
    commit();
    setClips((cur) => {
      const sorted = [...cur].sort((a, b) => a.start - b.start);
      let cursor = 0;
      return sorted.map((c) => {
        const next = { ...c, start: cursor };
        cursor += clipDuration(c);
        return next;
      });
    });
  };

  const resetAll = () => {
    if (duration <= 0) return;
    commit();
    setClips([newClip(0, duration)]);
    setTexts([]);
    setShapes([]);
    setSilences([]);
    setSel({ start: 0, end: duration });
    setSelection(null);
  };

  /* ---------------- blur / spotlight ---------------- */

  const addShape = (kind: "blur" | "spotlight") => {
    commit();
    const start = Math.min(time, Math.max(0, total - 1));
    const layer: ShapeLayer = {
      id: uid(),
      kind,
      start,
      end: Math.min(total, start + 3),
      x: 0.3,
      y: 0.3,
      w: kind === "blur" ? 0.3 : 0.28,
      h: kind === "blur" ? 0.2 : 0.28,
      strength: kind === "blur" ? 18 : 0.55,
      color: "#ef4444",
    };
    setShapes((cur) => [...cur, layer]);
    setSelection({ kind: "shape", id: layer.id });
    setPanel(null);
  };

  const updateSelectedShape = (patch: Partial<ShapeLayer>, record = true) => {
    if (!selectedShape) return;
    if (record) commit();
    setShapes((cur) => cur.map((s) => (s.id === selectedShape.id ? { ...s, ...patch } : s)));
  };

  /* ---------------- cortador de silêncio ---------------- */

  const runSilenceDetection = async (value = sensitivity) => {
    const blob = sourceBlobRef.current;
    if (!blob) return;
    setSilenceBusy(true);
    try {
      const segs = await detectSilences(blob, value);
      setSilences(
        segs.map((s) => ({ ...s, id: uid(), status: "pending" as const })),
      );
      setSilenceOpen(true);
    } catch {
      setError("Não foi possível analisar o áudio deste vídeo.");
    } finally {
      setSilenceBusy(false);
    }
  };

  /** Remove da timeline o intervalo indicado (mesma lógica de "remover seleção"). */
  const cutRange = (list: Clip[], start: number, end: number): Clip[] => {
    const out: Clip[] = [];
    for (const c of list) {
      const cs = c.start;
      const ce = clipEnd(c);
      const speed = c.speed || 1;
      if (end <= cs || start >= ce) {
        out.push(c);
        continue;
      }
      if (start > cs) out.push({ ...c, srcEnd: c.srcStart + (start - cs) * speed });
      if (end < ce)
        out.push({
          ...c,
          id: uid(),
          srcStart: c.srcStart + (end - cs) * speed,
          start: end,
          zoomKeys: [],
        });
    }
    return out.filter((c) => clipDuration(c) > MIN_CLIP);
  };

  const removeSilences = (marks: SilenceMark[]) => {
    const targets = marks.filter((m) => m.status === "pending").sort((a, b) => b.start - a.start);
    if (targets.length === 0) return;
    commit();
    setClips((cur) => {
      let next = cur;
      for (const m of targets) next = cutRange(next, m.start, m.end);
      return next.sort((a, b) => a.start - b.start);
    });
    setSilences((cur) => cur.filter((m) => !targets.some((t) => t.id === m.id)));
    setSelection(null);
    window.setTimeout(rippleClose, 0);
  };

  /* ---------------- legendas automáticas ---------------- */

  const generateCaptions = async () => {
    const blob = sourceBlobRef.current;
    if (!blob) return;
    setCaptionsBusy(true);
    try {
      const blocks = await detectSpeechBlocks(blob);
      if (blocks.length === 0) {
        setError("Nenhuma fala detectada no áudio.");
        return;
      }
      commit();
      const layers: TextLayer[] = blocks.map((b, i) => ({
        id: uid(),
        lane: "text",
        text: `Legenda ${i + 1}`,
        start: b.start,
        end: b.end,
        x: 0.5,
        y: captionStyle.y,
        size: captionStyle.size,
        color: captionStyle.color,
        align: "center",
        animIn: "none",
        animOut: "none",
        bg: captionStyle.bg,
        font: captionStyle.font,
        caption: true,
      }));
      setTexts((cur) => [...cur.filter((t) => !t.caption), ...layers]);
      setSelection({ kind: "text", id: layers[0].id });
    } catch {
      setError("Não foi possível gerar as legendas.");
    } finally {
      setCaptionsBusy(false);
    }
  };

  const applyCaptionStyle = (patch: Partial<typeof captionStyle>) => {
    const next = { ...captionStyle, ...patch };
    setCaptionStyle(next);
    setTexts((cur) =>
      cur.map((t) =>
        t.caption
          ? { ...t, font: next.font, size: next.size, color: next.color, bg: next.bg, y: next.y }
          : t,
      ),
    );
  };

  /* ---------------- overlay no player ---------------- */

  const stagePoint = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const onStagePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = stagePoint(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (selectedShape) {
      commit();
      stageDragRef.current = {
        kind: "shape-move",
        id: selectedShape.id,
        dx: p.x - selectedShape.x,
        dy: p.y - selectedShape.y,
      };
      return;
    }
    if (selectedText) {
      commit();
      stageDragRef.current = { kind: "text" };
      updateSelectedText({ x: p.x, y: p.y }, false);
      return;
    }
    stageDragRef.current = {
      kind: "frame",
      x: e.clientX,
      y: e.clientY,
      ox: contentOffset.x,
      oy: contentOffset.y,
    };
  };

  const onStagePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = stageDragRef.current;
    if (!drag) return;
    const p = stagePoint(e);
    if (drag.kind === "text") {
      updateSelectedText({ x: p.x, y: p.y }, false);
    } else if (drag.kind === "shape-move") {
      setShapes((cur) =>
        cur.map((s) =>
          s.id === drag.id
            ? {
                ...s,
                x: Math.min(1 - s.w, Math.max(0, p.x - drag.dx)),
                y: Math.min(1 - s.h, Math.max(0, p.y - drag.dy)),
              }
            : s,
        ),
      );
    } else if (drag.kind === "shape-resize") {
      setShapes((cur) =>
        cur.map((s) =>
          s.id === drag.id
            ? {
                ...s,
                w: Math.min(1 - s.x, Math.max(0.05, p.x - s.x)),
                h: Math.min(1 - s.y, Math.max(0.05, p.y - s.y)),
              }
            : s,
        ),
      );
    } else if (drag.kind === "frame") {
      const rect = e.currentTarget.getBoundingClientRect();
      setContentOffset({
        x: Math.min(1, Math.max(-1, drag.ox + ((e.clientX - drag.x) / rect.width) * 2)),
        y: Math.min(1, Math.max(-1, drag.oy + ((e.clientY - drag.y) / rect.height) * 2)),
      });
    }
  };

  const onStagePointerUp = () => {
    stageDragRef.current = null;
  };

  const startShapeResize = (id: string) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    commit();
    setSelection({ kind: "shape", id });
    stageDragRef.current = { kind: "shape-resize", id };
    const stage = stageRef.current;
    stage?.setPointerCapture?.(e.pointerId);
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
        ctx.textAlign = layer.align;
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
      const bounds: { from: number; to: number; out: number }[] = [];
      let acc = 0;
      for (const c of ordered) {
        const d = clipDuration(c);
        const trimmed = c.transition === "none" ? 0 : Math.min(0.5, d / 2);
        bounds.push({ from: c.start, to: c.start + d, out: acc - (acc > 0 ? trimmed : 0) });
        acc += d - (acc > 0 ? trimmed : 0);
      }
      const mapTime = (t: number) => {
        for (const b of bounds) if (t >= b.from && t <= b.to) return b.out + (t - b.from);
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
        denoise: c.denoise && !bypassDenoise,
      }));

      const blurs = shapes
        .filter((s) => s.kind === "blur")
        .map((s) => ({
          x: s.x * srcSize.width,
          y: s.y * srcSize.height,
          w: s.w * srcSize.width,
          h: s.h * srcSize.height,
          strength: s.strength,
          start: mapTime(s.start),
          end: mapTime(s.end),
        }));

      const out = await exportTimeline(
        blob,
        payload,
        overlays,
        srcSize,
        (r) => setProgress(r),
        {
          blurs,
          frame:
            ratio.id === RATIOS[0].id && contentOffset.x === 0 && contentOffset.y === 0
              ? undefined
              : {
                  width: frame.width,
                  height: frame.height,
                  offsetX: contentOffset.x,
                  offsetY: contentOffset.y,
                },
        },
      );
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
    a.download = `${projectName || "gravaai-editado"}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  /* ---------------- render helpers ---------------- */

  const laneWidth = Math.max(total * pxPerSec + 120, 800);
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

  const toggleFullscreen = () => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => {});
  };

  const hasMedia = Boolean(srcUrl);

  return (
    <>

      <div className="flex h-screen w-full items-center justify-center bg-[var(--background)] p-8 text-center md:hidden">
        <div className="max-w-xs space-y-3">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[var(--brand)]/15 text-[var(--brand)]">
            <Scissors className="h-6 w-6" />
          </span>
          <h1 className="font-display text-lg font-bold tracking-tight">
            Use um dispositivo com tela maior para editar
          </h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            O Editor Simplificado precisa de pelo menos 768px de largura.
          </p>
        </div>
      </div>

      <div
        ref={shellRef}
        className="hidden h-screen w-full flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)] md:flex"
      >

      <input ref={inputRef} type="file" accept="video/mp4,video/*" className="hidden" onChange={onPick} />

      {/* ---------- 1. BARRA SUPERIOR ---------- */}
      <header className="flex h-14 shrink-0 flex-nowrap items-center gap-2 overflow-hidden border-b border-[var(--border)] bg-black/40 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--brand)]/15 text-[var(--brand)]">
            <Scissors className="h-4 w-4" />
          </span>
          {editingName ? (
            <input
              autoFocus
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onBlur={() => setEditingName(false)}
              onKeyDown={(e) => e.key === "Enter" && setEditingName(false)}
              className="w-40 min-w-0 rounded-md border border-[var(--brand)]/60 bg-[var(--surface-2)] px-2 py-1 text-sm font-semibold outline-none"
            />
          ) : (
            <button
              onClick={() => setEditingName(true)}
              title="Clique para renomear"
              className="min-w-0 truncate rounded-md px-2 py-1 text-sm font-semibold hover:bg-[var(--surface-2)]"
            >
              {projectName}
            </button>
          )}
          {fileName ? (
            <span className="hidden min-w-0 truncate text-xs text-[var(--muted-foreground)] xl:block">
              {fileName}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <IconBtn label="Reproduzir/Pausar" onClick={togglePlay} disabled={!hasMedia}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </IconBtn>
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-1">
            <IconBtn label="Reduzir preview" bare onClick={() => setPreviewZoom((z) => Math.max(0.25, z - 0.1))}>
              <Minus className="h-3.5 w-3.5" />
            </IconBtn>
            <span className="w-11 text-center text-[11px] tabular-nums text-[var(--muted-foreground)]">
              {Math.round(previewZoom * 100)}%
            </span>
            <IconBtn label="Ampliar preview" bare onClick={() => setPreviewZoom((z) => Math.min(3, z + 0.1))}>
              <Plus className="h-3.5 w-3.5" />
            </IconBtn>
          </div>
          <IconBtn label="Desfazer" onClick={undo} disabled={past.length === 0}>
            <Undo2 className="h-4 w-4" />
          </IconBtn>
          <IconBtn label="Refazer" onClick={redo} disabled={future.length === 0}>
            <Redo2 className="h-4 w-4" />
          </IconBtn>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {resultUrl ? (
            <button
              onClick={downloadResult}
              title="Baixar MP4"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-xs font-semibold"
            >
              <Download className="h-4 w-4" />
              <span className="hidden lg:inline">Baixar MP4</span>
            </button>
          ) : null}
          <button
            onClick={runExport}
            disabled={exporting || clips.length === 0}
            title="Exportar MP4"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 text-sm font-semibold text-white transition-transform active:scale-[0.96] disabled:opacity-50"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="hidden whitespace-nowrap lg:inline">
              {exporting ? `Exportando… ${Math.round(progress * 100)}%` : "Exportar MP4"}
            </span>
          </button>
        </div>
      </header>


      {exporting ? (
        <div className="h-1 w-full bg-[var(--surface-2)]">
          <div
            className="h-full bg-[var(--brand)] transition-all"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ---------- 2. SIDEBAR ESQUERDA ---------- */}
        <nav className="flex w-16 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-[var(--border)] bg-black/30 py-2">
          {PANELS.map((p) => (
            <button
              key={p.id}
              title={p.label}
              onClick={() => setPanel((cur) => (cur === p.id ? null : p.id))}
              className={cn(
                "flex w-14 shrink-0 flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors",
                panel === p.id
                  ? "bg-[var(--brand)]/15 text-[var(--brand)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]",
              )}
            >
              <p.Icon className="h-5 w-5" />
              {p.label}
            </button>
          ))}
        </nav>

        {/* ---------- 3. PREVIEW + 5. TIMELINE ---------- */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {error ? (
            <div className="shrink-0 truncate border-b border-[var(--brand)]/40 bg-[var(--brand)]/10 px-4 py-2 text-xs text-[var(--brand)]">
              {error}
            </div>
          ) : null}

          <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            {panel ? (
              <aside className="absolute inset-y-0 left-0 z-30 w-64 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] p-3 shadow-2xl">
                <SidePanel
                  panel={panel}
                  hasMedia={hasMedia}
                  fileName={fileName}
                  duration={duration}
                  thumb={thumbs[0]}
                  onUpload={() => inputRef.current?.click()}
                  onDropFile={onDrop}
                  onAddText={addText}
                  onAddShape={addShape}
                  onApplyFilters={(f) => updateSelectedClip({ filters: f })}
                  onApplyTransition={(t) => updateSelectedClip({ transition: t })}
                  selectedClip={selectedClip}
                  onGenerateCaptions={generateCaptions}
                  captionsBusy={captionsBusy}
                  captionStyle={captionStyle}
                  onCaptionStyle={applyCaptionStyle}
                  time={time}
                />
              </aside>
            ) : null}

            <section
              className={cn(
                "relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-black/40 p-4",
                panel && "pl-[17rem] xl:pl-4",
              )}
            >

            <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-lg border border-[var(--border)] bg-black/60 p-1">

              {RATIOS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRatio(r)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-semibold",
                    ratio.id === r.id
                      ? "bg-[var(--brand)] text-white"
                      : "text-[var(--muted-foreground)] hover:text-white",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {!hasMedia ? (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={onDrop}
                className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-dashed border-white/15 bg-[var(--surface)] px-8 py-12 text-center"
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
                      <h2 className="font-display text-lg font-bold tracking-tight">
                        Importe um vídeo para começar
                      </h2>
                      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                        Arraste um MP4 aqui ou selecione um arquivo. Você também pode gravar na home
                        e clicar em “Enviar para o editor”.
                      </p>
                    </div>
                    <button
                      onClick={() => inputRef.current?.click()}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--brand)] px-4 text-sm font-semibold text-white"
                    >
                      <Upload className="h-4 w-4" /> Selecionar arquivo
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div
                ref={stageRef}
                onPointerDown={onStagePointerDown}
                onPointerMove={onStagePointerMove}
                onPointerUp={onStagePointerUp}
                onPointerCancel={onStagePointerUp}
                style={{
                  aspectRatio: String(ratio.value),
                  transform: `scale(${previewZoom})`,
                  maxHeight: "100%",
                  maxWidth: "100%",
                }}
                className={cn(
                  "relative h-full overflow-hidden rounded-xl border border-[var(--border)] bg-black transition-transform",
                  (selectedText || selectedShape) && "cursor-move",
                )}
              >
                <canvas ref={canvasRef} className="h-full w-full object-contain" />
                <video
                  ref={videoRef}
                  src={srcUrl ?? undefined}
                  onLoadedMetadata={onLoadedMetadata}
                  playsInline
                  className="pointer-events-none absolute h-px w-px opacity-0"
                />
                {shapes
                  .filter((s) => time >= s.start && time <= s.end)
                  .map((s) => (
                    <div
                      key={s.id}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSelection({ kind: "shape", id: s.id });
                        commit();
                        const rect = (
                          stageRef.current as HTMLElement
                        ).getBoundingClientRect();
                        stageDragRef.current = {
                          kind: "shape-move",
                          id: s.id,
                          dx: (e.clientX - rect.left) / rect.width - s.x,
                          dy: (e.clientY - rect.top) / rect.height - s.y,
                        };
                        stageRef.current?.setPointerCapture?.(e.pointerId);
                      }}
                      style={{
                        left: `${s.x * 100}%`,
                        top: `${s.y * 100}%`,
                        width: `${s.w * 100}%`,
                        height: `${s.h * 100}%`,
                        borderRadius: s.kind === "spotlight" ? "9999px" : "6px",
                      }}
                      className={cn(
                        "absolute cursor-move border-2 border-dashed",
                        selectedShape?.id === s.id
                          ? "border-[var(--brand)]"
                          : "border-white/40 hover:border-white/70",
                      )}
                    >
                      <span
                        onPointerDown={startShapeResize(s.id)}
                        className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm bg-[var(--brand)]"
                      />
                    </div>
                  ))}
                {selectedText ? (
                  <div
                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 border border-[var(--brand)]"
                    style={{
                      left: `${selectedText.x * 100}%`,
                      top: `${selectedText.y * 100}%`,
                      width: `${Math.min(90, selectedText.text.length * (selectedText.size / 1080) * 60 + 10)}%`,
                      height: `${(selectedText.size / 1080) * 160}%`,
                    }}
                  >
                    {["-left-1 -top-1", "-right-1 -top-1", "-left-1 -bottom-1", "-right-1 -bottom-1"].map(
                      (pos) => (
                        <span key={pos} className={cn("absolute h-2 w-2 rounded-sm bg-white", pos)} />
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </section>
          </div>

          {/* ---------- 5. TIMELINE ---------- */}
          <section className="flex h-[260px] shrink-0 flex-col overflow-hidden border-t border-[var(--border)] bg-[var(--surface)] xl:h-[320px]">
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--border)] px-2 py-1.5">

              <IconBtn label="Reproduzir/Pausar" onClick={togglePlay} disabled={!hasMedia}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </IconBtn>
              <span className="mr-2 text-[11px] tabular-nums text-[var(--muted-foreground)]">
                {short(time)} / {short(total)}
              </span>
              <div className="mx-1 h-5 w-px bg-[var(--border)]" />
              <IconBtn label="Selecionar" active={tool === "select"} onClick={() => setTool("select")}>
                <MousePointer2 className="h-4 w-4" />
              </IconBtn>
              <IconBtn label="Lâmina" active={tool === "blade"} onClick={() => setTool("blade")}>
                <SplitSquareHorizontal className="h-4 w-4" />
              </IconBtn>
              <IconBtn label="Dividir no playhead" onClick={splitAtPlayhead} disabled={!hasMedia}>
                <Scissors className="h-4 w-4" />
              </IconBtn>
              <IconBtn label="Deletar" onClick={deleteSelected} disabled={!selection}>
                <Trash2 className="h-4 w-4" />
              </IconBtn>
              <IconBtn label="Duplicar" onClick={duplicateSelected} disabled={!selection}>
                <Copy className="h-4 w-4" />
              </IconBtn>
              <IconBtn label="Cortar para a seleção" onClick={keepSelection} disabled={!hasMedia}>
                <Crop className="h-4 w-4" />
              </IconBtn>
              <IconBtn
                label="Espelhar seleção (remover trecho)"
                onClick={removeSelection}
                disabled={!hasMedia}
              >
                <FlipHorizontal2 className="h-4 w-4" />
              </IconBtn>
              <IconBtn
                label="Detectar silêncios"
                active={silenceOpen}
                onClick={() => (silenceOpen ? setSilenceOpen(false) : void runSilenceDetection())}
                disabled={!hasMedia || silenceBusy}
              >
                {silenceBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <AudioLines className="h-4 w-4" />
                )}
              </IconBtn>
              <div className="relative">
                <IconBtn label="Mais opções" onClick={() => setMoreOpen((o) => !o)}>
                  <MoreHorizontal className="h-4 w-4" />
                </IconBtn>
                {moreOpen ? (
                  <div className="absolute left-0 top-10 z-30 w-56 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1 text-xs shadow-lg">
                    <MenuItem
                      onClick={() => {
                        rippleClose();
                        setMoreOpen(false);
                      }}
                    >
                      Fechar espaços entre clipes
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        addText();
                        setMoreOpen(false);
                      }}
                    >
                      Adicionar texto no playhead
                    </MenuItem>
                    <MenuItem
                      onClick={() => {
                        resetAll();
                        setMoreOpen(false);
                      }}
                    >
                      Recomeçar edição
                    </MenuItem>
                  </div>
                ) : null}
              </div>

              <div className="ml-auto flex items-center gap-1">
                <IconBtn label="Afastar timeline" onClick={() => setPxPerSec((p) => Math.max(15, p / 1.5))}>
                  <ZoomOut className="h-4 w-4" />
                </IconBtn>
                <IconBtn label="Aproximar timeline" onClick={() => setPxPerSec((p) => Math.min(400, p * 1.5))}>
                  <ZoomIn className="h-4 w-4" />
                </IconBtn>
                <IconBtn label="Tela cheia" onClick={toggleFullscreen}>
                  <Maximize2 className="h-4 w-4" />
                </IconBtn>
              </div>
            </div>

            {silenceOpen ? (
              <div className="shrink-0 space-y-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold">
                    {silences.filter((s) => s.status === "pending").length} trecho(s) de silêncio
                    encontrado(s)
                  </p>
                  <label className="ml-auto flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                    Pouco sensível
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={sensitivity}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        setSensitivity(v);
                        void runSilenceDetection(v);
                      }}
                      className="w-32 accent-[var(--brand)]"
                    />
                    Muito sensível
                  </label>
                  <button
                    onClick={() => removeSilences(silences)}
                    disabled={silences.every((s) => s.status !== "pending")}
                    className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                  >
                    Remover todos
                  </button>
                  <button
                    onClick={() => {
                      setSilenceOpen(false);
                      setSilences([]);
                    }}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-semibold"
                  >
                    Fechar
                  </button>
                </div>
                <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto">
                  {silences.map((s) => (
                    <span
                      key={s.id}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] tabular-nums",
                        s.status === "pending"
                          ? "border-[var(--brand)]/50 text-[var(--foreground)]"
                          : "border-white/10 text-[var(--muted-foreground)] line-through",
                      )}
                    >
                      {short(s.start)} – {short(s.end)}
                      <button
                        title="Remover este trecho"
                        onClick={() => removeSilences([s])}
                        className="text-[var(--brand)]"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <button
                        title="Ignorar"
                        onClick={() =>
                          setSilences((cur) =>
                            cur.map((m) => (m.id === s.id ? { ...m, status: "ignored" } : m)),
                          )
                        }
                        className="text-[var(--muted-foreground)]"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}


            <div
              ref={lanesRef}
              onPointerMove={onLanesPointerMove}
              onPointerUp={endDrag}
              onPointerLeave={endDrag}
              className="relative min-h-0 flex-1 overflow-auto"
            >
              <div style={{ width: laneWidth }} className="relative pb-3">
                {/* Régua */}
                <div
                  className="sticky top-0 z-10 h-7 cursor-pointer select-none border-b border-[var(--border)] bg-[var(--surface)]"
                  onPointerDown={(e) => {
                    dragRef.current = { kind: "playhead" };
                    seek(timeFromX(e.clientX));
                  }}
                >
                  {ticks.map((t) => (
                    <span
                      key={t}
                      style={{ left: t * pxPerSec }}
                      className="absolute top-1 border-l border-white/10 pl-1 text-[10px] tabular-nums text-[var(--muted-foreground)]"
                    >
                      {short(t)}
                    </span>
                  ))}
                  <div
                    className="absolute bottom-0 top-0 bg-[var(--info)]/15"
                    style={{
                      left: sel.start * pxPerSec,
                      width: Math.max(0, (sel.end - sel.start) * pxPerSec),
                    }}
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
                <Lane icon={<Video className="h-3.5 w-3.5" />} label="Vídeo" onPointerDown={onLanePointerDown}>
                  {clips.length === 0 ? <Placeholder /> : null}
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
                        <span className="pointer-events-none absolute left-0 top-0 flex h-full w-8 items-center justify-center bg-gradient-to-r from-[var(--brand)]/70 to-transparent text-[9px] font-bold text-white">
                          {c.transition === "fade" ? "FD" : "SL"}
                        </span>
                      ) : null}
                      <span className="pointer-events-none absolute bottom-0.5 left-1 rounded bg-black/60 px-1 text-[10px] tabular-nums text-white">
                        {c.speed !== 1 ? `${c.speed}x · ` : ""}
                        {short(clipDuration(c))}
                      </span>
                      {c.zoomKeys.map((k, i) => (
                        <span
                          key={i}
                          style={{ left: k.t * pxPerSec - 3 }}
                          className="pointer-events-none absolute top-1 h-2 w-2 rotate-45 bg-[var(--info)]"
                        />
                      ))}
                      {selection?.kind === "clip" && selection.id === c.id
                        ? ["left-0 top-0", "right-0 top-0", "left-0 bottom-0", "right-0 bottom-0"].map(
                            (pos) => (
                              <span
                                key={pos}
                                className={cn("pointer-events-none absolute h-2 w-2 bg-white", pos)}
                              />
                            ),
                          )
                        : null}
                    </div>
                  ))}
                </Lane>

                {/* Faixa de overlay */}
                <Lane
                  icon={<ImageIcon className="h-3.5 w-3.5" />}
                  label="Overlay"
                  laneId="overlay"
                  onPointerDown={onLanePointerDown}
                >
                  {texts.filter((t) => t.lane === "overlay").length === 0 ? <Placeholder /> : null}
                  {texts
                    .filter((t) => t.lane === "overlay")
                    .map((l) => (
                      <TextClip
                        key={l.id}
                        layer={l}
                        pxPerSec={pxPerSec}
                        selected={selection?.kind === "text" && selection.id === l.id}
                        onPointerDown={onTextPointerDown}
                        tone="info"
                      />
                    ))}
                </Lane>

                {/* Faixa de texto */}
                <Lane
                  icon={<Type className="h-3.5 w-3.5" />}
                  label="Texto"
                  laneId="text"
                  onPointerDown={onLanePointerDown}
                >
                  {texts.filter((t) => t.lane === "text").length === 0 ? <Placeholder /> : null}
                  {texts
                    .filter((t) => t.lane === "text")
                    .map((l) => (
                      <TextClip
                        key={l.id}
                        layer={l}
                        pxPerSec={pxPerSec}
                        selected={selection?.kind === "text" && selection.id === l.id}
                        onPointerDown={onTextPointerDown}
                        tone="brand"
                      />
                    ))}
                </Lane>

                {/* Faixa de efeitos (blur / spotlight) */}
                <Lane icon={<Wand2 className="h-3.5 w-3.5" />} label="Efeitos">
                  {shapes.length === 0 ? <Placeholder /> : null}
                  {shapes.map((s) => (
                    <div
                      key={s.id}
                      onPointerDown={onShapePointerDown(s)}
                      style={{
                        left: s.start * pxPerSec,
                        width: Math.max(12, (s.end - s.start) * pxPerSec),
                      }}
                      className={cn(
                        "absolute inset-y-2 cursor-grab overflow-hidden rounded-md border px-2 text-[10px] font-semibold leading-6",
                        selectedShape?.id === s.id
                          ? "border-[var(--brand)] bg-[var(--brand)]/20 text-white"
                          : "border-white/15 bg-[var(--surface-2)] text-[var(--muted-foreground)]",
                      )}
                    >
                      <span className="pointer-events-none truncate">
                        {s.kind === "blur" ? "Blur" : "Spotlight"}
                      </span>
                      {(["start", "end"] as const).map((edge) => (
                        <span
                          key={edge}
                          onPointerDown={onShapePointerDown(s, edge)}
                          className={cn(
                            "absolute inset-y-0 w-1.5 cursor-ew-resize bg-[var(--brand)]/70",
                            edge === "start" ? "left-0" : "right-0",
                          )}
                        />
                      ))}
                    </div>
                  ))}
                </Lane>

                {/* Faixa de áudio */}
                <Lane
                  icon={
                    <button onClick={() => setMuted((m) => !m)} title={muted ? "Ativar som" : "Mudo"}>
                      {muted ? (
                        <VolumeX className="h-3.5 w-3.5 text-[var(--brand)]" />
                      ) : (
                        <Volume2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  }
                  label="Áudio"
                >
                  {clips.length === 0 ? <Placeholder /> : null}
                  {clips.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        left: c.start * pxPerSec,
                        width: Math.max(8, clipDuration(c) * pxPerSec),
                      }}
                      className={cn(
                        "absolute inset-y-2 overflow-hidden rounded-md border border-[var(--info)]/30 bg-[var(--info)]/10",
                        muted && "opacity-40",
                      )}
                    >
                      <Waveform peaks={peaks} clip={c} duration={duration} />
                    </div>
                  ))}
                  {silences.map((s) => (
                    <div
                      key={s.id}
                      title={`Silêncio ${short(s.start)} – ${short(s.end)}`}
                      style={{
                        left: s.start * pxPerSec,
                        width: Math.max(2, (s.end - s.start) * pxPerSec),
                      }}
                      className={cn(
                        "pointer-events-none absolute inset-y-2 rounded-sm border",
                        s.status === "pending"
                          ? "border-[var(--brand)] bg-[var(--brand)]/30"
                          : "border-white/20 bg-white/5",
                      )}
                    />
                  ))}
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
          </section>
        </div>

        {/* ---------- 4. PAINEL DIREITO ---------- */}
        {selectedClip || selectedText || selectedShape ? (
          <aside className="w-72 shrink-0 overflow-y-auto overflow-x-hidden border-l border-[var(--border)] bg-[var(--surface)] p-4">
            {selectedClip ? (
              <>
                <div className="mb-3 flex flex-wrap gap-1">
                  {(
                    [
                      ["basic", "Básico"],
                      ["audio", "Áudio"],
                      ["speed", "Velocidade"],
                    ] as const
                  ).map(([id, label]) => (

                    <button
                      key={id}
                      onClick={() => setInspectorTab(id)}
                      className={cn(
                        "rounded-md px-2 py-1 text-[11px] font-semibold",
                        inspectorTab === id
                          ? "bg-[var(--brand)] text-white"
                          : "bg-[var(--surface-2)] text-[var(--muted-foreground)]",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {inspectorTab === "basic" ? (
                  <div className="space-y-3">
                    {(
                      [
                        ["Brilho", "brightness", -0.5, 0.5, 0.01],
                        ["Contraste", "contrast", 0.5, 2, 0.01],
                        ["Saturação", "saturation", 0, 3, 0.01],
                      ] as const
                    ).map(([label, key, min, max, step]) => (
                      <Slider
                        key={key}
                        label={label}
                        value={selectedClip.filters[key]}
                        min={min}
                        max={max}
                        step={step}
                        onChange={(v) =>
                          updateSelectedClip({ filters: { ...selectedClip.filters, [key]: v } }, false)
                        }
                      />
                    ))}
                    <button
                      onClick={() => updateSelectedClip({ filters: { ...NEUTRAL } })}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--muted-foreground)] hover:text-white"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Resetar
                    </button>

                    <div className="space-y-2 border-t border-[var(--border)] pt-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--muted-foreground)]">Zoom (keyframes)</span>
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
                            <span className="w-10 text-[11px] tabular-nums text-[var(--muted-foreground)]">
                              {k.t.toFixed(1)}s
                            </span>
                            <input
                              type="range"
                              min={1}
                              max={3}
                              step={0.05}
                              value={k.scale}
                              onChange={(e) =>
                                updateSelectedClip(
                                  {
                                    zoomKeys: selectedClip.zoomKeys.map((kk, ii) =>
                                      ii === i ? { ...kk, scale: Number(e.target.value) } : kk,
                                    ),
                                  },
                                  false,
                                )
                              }
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
                  </div>
                ) : null}


                {inspectorTab === "speed" ? (
                  <div className="space-y-3">
                    <Select
                      label="Velocidade"
                      value={String(selectedClip.speed)}
                      options={[0.5, 0.75, 1, 1.5, 2].map((s) => [String(s), `${s}x`])}
                      onChange={(v) => updateSelectedClip({ speed: Number(v) })}
                    />
                    <p className="text-[11px] text-[var(--muted-foreground)]">
                      Duração do clipe: {short(clipDuration(selectedClip))}
                    </p>
                  </div>
                ) : null}
              </>
            ) : selectedText ? (
              <div className="space-y-3">
                <h2 className="font-display text-sm font-bold tracking-tight">Texto</h2>
                <div>
                  <label className="mb-1 block text-xs text-[var(--muted-foreground)]">Conteúdo</label>
                  <input
                    value={selectedText.text}
                    onChange={(e) => updateSelectedText({ text: e.target.value }, false)}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
                  />
                </div>
                <Slider
                  label="Tamanho"
                  value={selectedText.size}
                  min={24}
                  max={200}
                  step={2}
                  onChange={(v) => updateSelectedText({ size: v }, false)}
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[var(--muted-foreground)]">Cor</span>
                  <input
                    type="color"
                    value={selectedText.color}
                    onChange={(e) => updateSelectedText({ color: e.target.value }, false)}
                    className="h-8 w-14 rounded border border-[var(--border)] bg-transparent"
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs text-[var(--muted-foreground)]">Alinhamento</span>
                  <div className="flex gap-1">
                    {(["left", "center", "right"] as const).map((a) => (
                      <button
                        key={a}
                        onClick={() => updateSelectedText({ align: a })}
                        className={cn(
                          "flex-1 rounded-md px-2 py-1 text-[11px] font-semibold",
                          selectedText.align === a
                            ? "bg-[var(--brand)] text-white"
                            : "bg-[var(--surface-2)] text-[var(--muted-foreground)]",
                        )}
                      >
                        {a === "left" ? "Esq." : a === "center" ? "Centro" : "Dir."}
                      </button>
                    ))}
                  </div>
                </div>
                <Select
                  label="Animação de entrada"
                  value={selectedText.animIn}
                  options={[
                    ["none", "Nenhuma"],
                    ["fade", "Fade"],
                    ["slide", "Slide"],
                  ]}
                  onChange={(v) => updateSelectedText({ animIn: v as TextLayer["animIn"] })}
                />
                <Select
                  label="Animação de saída"
                  value={selectedText.animOut}
                  options={[
                    ["none", "Nenhuma"],
                    ["fade", "Fade"],
                    ["slide", "Slide"],
                  ]}
                  onChange={(v) => updateSelectedText({ animOut: v as TextLayer["animOut"] })}
                />
                <p className="text-[11px] text-[var(--muted-foreground)]">
                  Arraste no player para posicionar. Ajuste entrada e saída pelas bordas do clipe.
                </p>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
      </div>
    </>
  );

}

/* ---------------- subcomponentes ---------------- */

function IconBtn({
  children,
  label,
  onClick,
  disabled,
  active,
  bare,
}: {
  children: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  bare?: boolean;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-40",
        bare
          ? "text-[var(--muted-foreground)] hover:text-white"
          : active
            ? "bg-[var(--brand)] text-white"
            : "border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-foreground)] hover:text-white",
      )}
    >
      {children}
    </button>
  );
}

function MenuItem({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="block w-full rounded-md px-2 py-1.5 text-left text-[var(--muted-foreground)] hover:bg-[var(--surface)] hover:text-white"
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
        <span>{label}</span>
        <span className="tabular-nums">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--brand)]"
      />
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-[var(--muted-foreground)]">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

function Placeholder() {
  return (
    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--muted-foreground)]">
      Arraste arquivos aqui
    </span>
  );
}

function Lane({
  icon,
  label,
  laneId,
  children,
  onPointerDown,
}: {
  icon: ReactNode;
  label: string;
  laneId?: string;
  children?: ReactNode;
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div className="mt-2 flex items-stretch gap-2 pl-2">
      <div className="sticky left-0 z-10 flex w-24 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--surface-2)] px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {icon}
        {label}
      </div>
      <div
        data-lane={laneId}
        onPointerDown={onPointerDown}
        className="relative h-14 flex-1 rounded-lg border border-[var(--border)] bg-black/30"
      >
        {children}
      </div>
    </div>
  );
}

function TextClip({
  layer,
  pxPerSec,
  selected,
  onPointerDown,
  tone,
}: {
  layer: TextLayer;
  pxPerSec: number;
  selected: boolean;
  onPointerDown: (
    l: TextLayer,
    edge?: "start" | "end",
  ) => (e: ReactPointerEvent<HTMLDivElement>) => void;
  tone: "brand" | "info";
}) {
  const color = tone === "brand" ? "var(--brand)" : "var(--info)";
  return (
    <div
      onPointerDown={onPointerDown(layer)}
      style={{
        left: layer.start * pxPerSec,
        width: Math.max(24, (layer.end - layer.start) * pxPerSec),
        backgroundColor: `color-mix(in oklab, ${color} 20%, transparent)`,
        borderColor: selected ? color : `color-mix(in oklab, ${color} 40%, transparent)`,
      }}
      className={cn(
        "absolute inset-y-2 cursor-grab overflow-hidden rounded-md border px-2 text-[10px] leading-[26px] text-white",
        selected && "ring-1",
      )}
    >
      <span className="pointer-events-none truncate">{layer.text}</span>
      <span
        onPointerDown={onPointerDown(layer, "start")}
        style={{ backgroundColor: color }}
        className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
      />
      <span
        onPointerDown={onPointerDown(layer, "end")}
        style={{ backgroundColor: color }}
        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
      />
      {selected
        ? ["left-0 top-0", "right-0 top-0", "left-0 bottom-0", "right-0 bottom-0"].map((pos) => (
            <span key={pos} className={cn("pointer-events-none absolute h-2 w-2 bg-white", pos)} />
          ))
        : null}
    </div>
  );
}

function Waveform({ peaks, clip, duration }: { peaks: number[]; clip: Clip; duration: number }) {
  if (peaks.length === 0 || duration <= 0) {
    return (
      <div className="flex h-full items-center gap-px px-1 opacity-40">
        <AudioLines className="h-4 w-4 text-[var(--info)]" />
      </div>
    );
  }
  const from = Math.floor((clip.srcStart / duration) * peaks.length);
  const to = Math.max(from + 1, Math.ceil((clip.srcEnd / duration) * peaks.length));
  const slice = peaks.slice(from, to);
  return (
    <div className="flex h-full items-center gap-[1px] overflow-hidden px-1">
      {slice.map((p, i) => (
        <span
          key={i}
          style={{ height: `${Math.max(8, p * 100)}%` }}
          className="w-[2px] shrink-0 rounded-full bg-[var(--info)]/70"
        />
      ))}
    </div>
  );
}

function SidePanel({
  panel,
  hasMedia,
  fileName,
  duration,
  thumb,
  onUpload,
  onDropFile,
  onAddText,
  onAddShape,
  onApplyFilters,
  onApplyTransition,
  selectedClip,
  onGenerateCaptions,
  captionsBusy,
  captionStyle,
  onCaptionStyle,
  time,
}: {
  panel: PanelId;
  hasMedia: boolean;
  fileName: string | null;
  duration: number;
  thumb?: string;
  onUpload: () => void;
  onDropFile: (e: DragEvent<HTMLDivElement>) => void;
  onAddText: (preset?: Partial<TextLayer>, lane?: "text" | "overlay") => void;
  onAddShape: (kind: "blur" | "spotlight") => void;
  onApplyFilters: (f: Filters) => void;
  onApplyTransition: (t: TransitionKind) => void;
  selectedClip: Clip | null;
  onGenerateCaptions: () => void;
  captionsBusy: boolean;
  captionStyle: { font: string; size: number; color: string; bg: string; y: number };
  onCaptionStyle: (patch: Partial<{ font: string; size: number; color: string; bg: string; y: number }>) => void;
  time: number;
}) {
  const title = PANELS.find((p) => p.id === panel)?.label ?? "";

  const media = hasMedia ? (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2">
      {thumb ? (
        <img src={thumb} alt="" className="h-10 w-16 rounded object-cover" />
      ) : (
        <span className="grid h-10 w-16 place-items-center rounded bg-black/40">
          <Video className="h-4 w-4 text-[var(--muted-foreground)]" />
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">{fileName}</p>
        <p className="text-[11px] tabular-nums text-[var(--muted-foreground)]">{short(duration)}</p>
      </div>
    </div>
  ) : (
    <p className="text-xs text-[var(--muted-foreground)]">Nenhum arquivo no projeto ainda.</p>
  );

  return (
    <div className="space-y-3">
      <h2 className="font-display text-sm font-bold tracking-tight">{title}</h2>

      {panel === "upload" ? (
        <>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropFile}
            className="rounded-lg border border-dashed border-white/15 p-4 text-center"
          >
            <p className="text-xs text-[var(--muted-foreground)]">
              Arraste vídeos, imagens ou áudios aqui
            </p>
            <button
              onClick={onUpload}
              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 text-xs font-semibold text-white"
            >
              <Upload className="h-3.5 w-3.5" /> Selecionar arquivo
            </button>
          </div>
          {media}
        </>
      ) : null}

      {panel === "audio" ? (
        <>
          {media}
          <p className="text-xs text-[var(--muted-foreground)]">
            O áudio do vídeo aparece na faixa de áudio da timeline. Para adicionar uma trilha, importe
            um arquivo de áudio pelo painel Upload.
          </p>
          <button
            onClick={onUpload}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs font-semibold"
          >
            Adicionar trilha
          </button>
        </>
      ) : null}

      {panel === "text" ? (
        <div className="grid gap-2">
          {TEXT_TEMPLATES.map((t) => (
            <button
              key={t.name}
              onClick={() => onAddText({ text: t.name, size: t.size, color: t.color, y: t.y })}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 text-left text-sm font-semibold hover:border-[var(--brand)]"
            >
              {t.name}
            </button>
          ))}
          <button
            onClick={() => onAddText()}
            className="rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white"
          >
            Texto customizado
          </button>
        </div>
      ) : null}

      {panel === "elements" ? (
        <>
          <button
            disabled={!hasMedia}
            onClick={() => onAddShape("blur")}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 text-left text-xs font-semibold hover:border-[var(--brand)] disabled:opacity-40"
          >
            Adicionar área de blur
            <span className="mt-1 block font-normal text-[var(--muted-foreground)]">
              Retângulo arrastável que desfoca o vídeo por baixo.
            </span>
          </button>
          <button
            disabled={!hasMedia}
            onClick={() => onAddShape("spotlight")}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 text-left text-xs font-semibold hover:border-[var(--brand)] disabled:opacity-40"
          >
            Adicionar spotlight
            <span className="mt-1 block font-normal text-[var(--muted-foreground)]">
              Destaca uma área e escurece o restante do quadro.
            </span>
          </button>
          <div className="grid grid-cols-4 gap-2 pt-1">
            {STICKERS.map((s) => (
              <button
                key={s}
                onClick={() => onAddText({ text: s, size: 140, y: 0.5 }, "overlay")}
                className="grid h-14 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-2xl hover:border-[var(--brand)]"
              >
                {s}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {panel === "captions" ? (
        <>
          <button
            disabled={!hasMedia || captionsBusy}
            onClick={onGenerateCaptions}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {captionsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Gerar legendas automaticamente
          </button>
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Os blocos são detectados pelo áudio e criados na faixa de texto. Clique em cada bloco para
            corrigir o conteúdo.
          </p>

          <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2">
            <label className="block text-[11px] font-semibold">Fonte</label>
            <select
              value={captionStyle.font}
              onChange={(e) => onCaptionStyle({ font: e.target.value })}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
            >
              {["DM Sans", "Georgia", "Impact", "Courier New"].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>

            <label className="block text-[11px] font-semibold">Tamanho ({captionStyle.size}px)</label>
            <input
              type="range"
              min={24}
              max={120}
              value={captionStyle.size}
              onChange={(e) => onCaptionStyle({ size: Number(e.target.value) })}
              className="w-full accent-[var(--brand)]"
            />

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold">
                Texto
                <input
                  type="color"
                  value={captionStyle.color}
                  onChange={(e) => onCaptionStyle({ color: e.target.value })}
                  className="h-6 w-8 rounded border border-[var(--border)] bg-transparent"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[11px] font-semibold">
                Fundo
                <input
                  type="color"
                  value={captionStyle.bg || "#000000"}
                  onChange={(e) => onCaptionStyle({ bg: e.target.value })}
                  className="h-6 w-8 rounded border border-[var(--border)] bg-transparent"
                />
              </label>
            </div>

            <label className="block text-[11px] font-semibold">Posição</label>
            <div className="grid grid-cols-3 gap-1">
              {(
                [
                  ["Topo", 0.14],
                  ["Centro", 0.5],
                  ["Base", 0.86],
                ] as const
              ).map(([l, v]) => (
                <button
                  key={l}
                  onClick={() => onCaptionStyle({ y: v })}
                  className={cn(
                    "rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-semibold",
                    Math.abs(captionStyle.y - v) < 0.01
                      ? "border-[var(--brand)] text-[var(--brand)]"
                      : "text-[var(--muted-foreground)]",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}


      {panel === "transitions" ? (
        <>
          {!selectedClip ? (
            <p className="text-xs text-[var(--muted-foreground)]">
              Selecione o clipe de destino na timeline para aplicar a transição de entrada.
            </p>
          ) : null}
          <div className="grid gap-2">
            {(
              [
                ["none", "Corte seco"],
                ["fade", "Fade"],
                ["slide", "Slide"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                disabled={!selectedClip}
                onClick={() => onApplyTransition(v)}
                className={cn(
                  "rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-3 text-left text-xs font-semibold hover:border-[var(--brand)] disabled:opacity-40",
                  selectedClip?.transition === v && "border-[var(--brand)] text-[var(--brand)]",
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
