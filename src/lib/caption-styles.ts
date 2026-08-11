import type { CSSProperties } from "react";

export type CaptionAnim =
  | "wordPop"
  | "karaoke"
  | "slideUp"
  | "typewriter"
  | "glow"
  | "shakeDrop";

export const CAPTION_ANIMS: {
  id: CaptionAnim;
  label: string;
  hint: string;
  /** classe de animação CSS usada só na miniatura de preview */
  previewClass: string;
}[] = [
  { id: "wordPop", label: "Word Pop", hint: "Palavras entram com quique", previewClass: "cap-prev-pop" },
  { id: "karaoke", label: "Karaokê", hint: "Realce palavra por palavra", previewClass: "cap-prev-karaoke" },
  { id: "slideUp", label: "Slide Up", hint: "Sobe com fade", previewClass: "cap-prev-slide" },
  { id: "typewriter", label: "Máquina", hint: "Letra por letra", previewClass: "cap-prev-type" },
  { id: "glow", label: "Glow Flash", hint: "Brilho pulsante", previewClass: "cap-prev-glow" },
  { id: "shakeDrop", label: "Shake & Drop", hint: "Cai tremendo", previewClass: "cap-prev-shake" },
];

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

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

  const out = words.map((w, i) => {
    // janela de entrada de cada palavra (metade inicial do clipe)
    const start = opts.wordByWord ? (i / n) * 0.55 : 0;
    const local = easeOut(clamp01((q - start) / 0.28));
    const activeIndex = Math.floor(q * n);
    const active = i === activeIndex;
    const passed = i <= activeIndex;

    switch (anim) {
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
