import type { CSSProperties } from "react";

export type CaptionAnim =
  | "wordPop"
  | "karaoke"
  | "slideUp"
  | "typewriter"
  | "glow"
  | "shakeDrop"
  | "bounce"
  | "colorSweep"
  | "popIn"
  // estáticos
  | "none"
  | "simpleFade"
  | "solidBox"
  | "minimalUnderline";

export const CAPTION_ANIMS: {
  id: CaptionAnim;
  label: string;
  hint: string;
  kind: "animated" | "static";
  /** classe de animação CSS usada só na miniatura de preview */
  previewClass: string;
}[] = [
  { id: "wordPop", label: "Word Pop", hint: "Palavras entram com quique", kind: "animated", previewClass: "cap-prev-pop" },
  { id: "karaoke", label: "Karaokê", hint: "Realce palavra por palavra", kind: "animated", previewClass: "cap-prev-karaoke" },
  { id: "slideUp", label: "Slide Up", hint: "Sobe com fade", kind: "animated", previewClass: "cap-prev-slide" },
  { id: "typewriter", label: "Máquina", hint: "Letra por letra", kind: "animated", previewClass: "cap-prev-type" },
  { id: "glow", label: "Glow Flash", hint: "Brilho pulsante", kind: "animated", previewClass: "cap-prev-glow" },
  { id: "shakeDrop", label: "Shake & Drop", hint: "Cai tremendo", kind: "animated", previewClass: "cap-prev-shake" },
  { id: "bounce", label: "Bounce", hint: "Palavras saltam com mola", kind: "animated", previewClass: "cap-prev-bounce" },
  { id: "colorSweep", label: "Color Sweep", hint: "Cor varre da esquerda p/ direita", kind: "animated", previewClass: "cap-prev-sweep" },
  { id: "popIn", label: "Pop In", hint: "Bloco entra com leve escala", kind: "animated", previewClass: "cap-prev-popin" },
  { id: "none", label: "Sem efeito", hint: "Texto fixo, sem animação", kind: "static", previewClass: "cap-prev-none" },
  { id: "simpleFade", label: "Fade simples", hint: "Bloco inteiro com fade suave", kind: "static", previewClass: "cap-prev-fade" },
  { id: "solidBox", label: "Caixa sólida", hint: "Fundo opaco, estilo TV", kind: "static", previewClass: "cap-prev-solid" },
  { id: "minimalUnderline", label: "Sublinhado", hint: "Linha fina sob o texto", kind: "static", previewClass: "cap-prev-underline" },
];

export const STATIC_ANIMS: CaptionAnim[] = ["none", "simpleFade", "solidBox", "minimalUnderline"];
export const isStaticAnim = (a: CaptionAnim) => STATIC_ANIMS.includes(a);

/** duração da troca entre blocos de legenda (ms) */
export const CAPTION_SWITCH_MS = 110;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** alpha do bloco inteiro (usado pelos estilos estáticos) */
export function captionBlockAlpha(anim: CaptionAnim, progress: number) {
  const p = clamp01(progress);
  if (anim !== "simpleFade") return 1;
  const inA = clamp01(p / 0.12);
  const outA = clamp01((1 - p) / 0.12);
  return Math.min(inA, outA);
}


export interface WordRender {
  text: string;
  style: CSSProperties;
}

/** passo de quantização do progresso (30fps) — evita recalcular por frame */
const PROGRESS_STEP = 1 / 30;
const wordCache = new Map<string, WordRender[]>();
const CACHE_MAX = 400;

export function renderCaptionWords(
  anim: CaptionAnim,
  text: string,
  progress: number,
  opts: { highlight: string; color: string; wordByWord: boolean },
): WordRender[] {
  const p = clamp01(progress);
  const q = Math.round(p / PROGRESS_STEP) * PROGRESS_STEP;
  const key = `${anim}|${opts.color}|${opts.highlight}|${opts.wordByWord ? 1 : 0}|${q.toFixed(4)}|${text}`;
  const hit = wordCache.get(key);
  if (hit) return hit;

  const words = text.trim().split(/\s+/).filter(Boolean);
  const n = Math.max(1, words.length);

  const blockAlpha = captionBlockAlpha(anim, q);
  const staticStyle = isStaticAnim(anim);
  const blockLocal = easeOut(clamp01(q / 0.22));

  const out = words.map((w, i) => {
    if (staticStyle) {
      return {
        text: w,
        style: { opacity: blockAlpha, color: opts.color } as CSSProperties,
      };
    }
    // janela de entrada de cada palavra (metade inicial do clipe)
    const start = opts.wordByWord ? (i / n) * 0.55 : 0;
    const local = easeOut(clamp01((q - start) / 0.28));
    const activeIndex = Math.floor(q * n);
    const active = i === activeIndex;
    const passed = i <= activeIndex;
    const sweep = q * n;

    switch (anim) {
      case "bounce": {
        const raw = clamp01((q - start) / 0.32);
        const dy = raw < 1 ? -Math.sin(raw * Math.PI * 1.5) * (1 - raw) * 0.45 : 0;
        return {
          text: w,
          style: { opacity: local, transform: `translateY(${dy}em)` } as CSSProperties,
        };
      }
      case "colorSweep":
        return {
          text: w,
          style: { color: sweep >= i + 0.5 ? opts.highlight : opts.color } as CSSProperties,
        };
      case "popIn":
        return {
          text: w,
          style: {
            opacity: blockLocal,
            transform: `scale(${0.9 + blockLocal * 0.1})`,
          } as CSSProperties,
        };

      case "karaoke":
        return {
          text: w,
          style: {
            color: passed ? opts.highlight : opts.color,
            transform: active ? "scale(1.08)" : "scale(1)",
          } as CSSProperties,
        };
      case "slideUp":
        return {
          text: w,
          style: {
            opacity: local,
            transform: `translateY(${(1 - local) * 0.5}em)`,
          } as CSSProperties,
        };
      case "glow":
        return {
          text: w,
          style: {
            opacity: local,
            color: active ? opts.highlight : opts.color,
            // drop-shadow é acelerado por GPU (text-shadow força repaint de CPU)
            filter: active
              ? `drop-shadow(0 0 0.35em ${opts.highlight}) drop-shadow(0 0 0.7em ${opts.highlight})`
              : undefined,
          } as CSSProperties,
        };
      case "shakeDrop": {
        const shake = local < 1 ? Math.sin(local * 28) * (1 - local) * 6 : 0;
        return {
          text: w,
          style: {
            opacity: local,
            transform: `translateY(${(local - 1) * 0.6}em) rotate(${shake}deg)`,
          } as CSSProperties,
        };
      }
      case "wordPop":
      default: {
        const s = local < 1 ? 0.5 + local * 0.62 : 1;
        return {
          text: w,
          style: { opacity: local, transform: `scale(${s})` } as CSSProperties,
        };
      }
    }
  });

  if (wordCache.size > CACHE_MAX) wordCache.clear();
  wordCache.set(key, out);
  return out;
}

/** quantiza o progresso do mesmo modo que o cache interno */
export function quantizeProgress(progress: number) {
  return Math.round(clamp01(progress) / PROGRESS_STEP) * PROGRESS_STEP;
}


/** Typewriter é caractere a caractere: recorta o texto pelo progresso. */
export function typewriterText(text: string, progress: number) {
  const chars = Math.round(text.length * clamp01(progress / 0.8));
  return text.slice(0, chars);
}

/** Aceita segundos numéricos ou "HH:MM:SS(.ms)" / "M:SS" e devolve segundos. */
export function toSeconds(value: number | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const s = value.trim().replace(",", ".");
  if (/^\d*\.?\d+$/.test(s)) return parseFloat(s);
  const parts = s.split(":").map((p) => parseFloat(p) || 0);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Margem para evitar piscada na troca de segmentos. */
export const CAPTION_END_BUFFER = 0.05;

/* ------------------------------------------------------------------ */
/* Versão numérica das animações, para a pipeline única do <canvas>.   */
/* ------------------------------------------------------------------ */

export interface WordFx {
  text: string;
  alpha: number;
  scale: number;
  /** deslocamento vertical em "em" */
  dy: number;
  /** rotação em graus */
  rotate: number;
  color: string;
  glow: boolean;
}

const fxCache = new Map<string, WordFx[]>();

export function captionWordFx(
  anim: CaptionAnim,
  text: string,
  progress: number,
  opts: { highlight: string; color: string; wordByWord: boolean },
): WordFx[] {
  const q = quantizeProgress(progress);
  const key = `fx|${anim}|${opts.color}|${opts.highlight}|${opts.wordByWord ? 1 : 0}|${q.toFixed(4)}|${text}`;
  const hit = fxCache.get(key);
  if (hit) return hit;

  const words = text.trim().split(/\s+/).filter(Boolean);
  const n = Math.max(1, words.length);

  const blockAlpha = captionBlockAlpha(anim, q);
  const staticStyle = isStaticAnim(anim);
  const blockLocal = easeOut(clamp01(q / 0.22));

  const out: WordFx[] = words.map((w, i) => {
    const start = opts.wordByWord ? (i / n) * 0.55 : 0;
    const local = easeOut(clamp01((q - start) / 0.28));
    const activeIndex = Math.floor(q * n);
    const active = i === activeIndex;
    const passed = i <= activeIndex;
    const sweep = q * n;
    const base: WordFx = {
      text: w,
      alpha: 1,
      scale: 1,
      dy: 0,
      rotate: 0,
      color: opts.color,
      glow: false,
    };
    if (staticStyle) return { ...base, alpha: blockAlpha };
    switch (anim) {
      case "bounce": {
        const raw = clamp01((q - start) / 0.32);
        return {
          ...base,
          alpha: local,
          dy: raw < 1 ? -Math.sin(raw * Math.PI * 1.5) * (1 - raw) * 0.45 : 0,
        };
      }
      case "colorSweep":
        return { ...base, color: sweep >= i + 0.5 ? opts.highlight : opts.color };
      case "popIn":
        return { ...base, alpha: blockLocal, scale: 0.9 + blockLocal * 0.1 };

      case "karaoke":
        return { ...base, color: passed ? opts.highlight : opts.color, scale: active ? 1.08 : 1 };
      case "slideUp":
        return { ...base, alpha: local, dy: (1 - local) * 0.5 };
      case "glow":
        return {
          ...base,
          alpha: local,
          color: active ? opts.highlight : opts.color,
          glow: active,
        };
      case "shakeDrop":
        return {
          ...base,
          alpha: local,
          dy: (local - 1) * 0.6,
          rotate: local < 1 ? Math.sin(local * 28) * (1 - local) * 6 : 0,
        };
      case "wordPop":
      default:
        return { ...base, alpha: local, scale: local < 1 ? 0.5 + local * 0.62 : 1 };
    }
  });

  if (fxCache.size > CACHE_MAX) fxCache.clear();
  fxCache.set(key, out);
  return out;
}
