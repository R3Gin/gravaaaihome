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

/**
 * Calcula o estado visual de cada palavra da legenda de forma determinística
 * (funciona ao arrastar o playhead, não só na reprodução).
 *
 * @param progress 0–1 dentro do clipe de legenda
 */
export function renderCaptionWords(
  anim: CaptionAnim,
  text: string,
  progress: number,
  opts: { highlight: string; color: string; wordByWord: boolean },
): WordRender[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const n = Math.max(1, words.length);
  const p = clamp01(progress);

  return words.map((w, i) => {
    // janela de entrada de cada palavra (metade inicial do clipe)
    const start = opts.wordByWord ? (i / n) * 0.55 : 0;
    const local = easeOut(clamp01((p - start) / 0.28));
    const activeIndex = Math.floor(p * n);
    const active = i === activeIndex;
    const passed = i <= activeIndex;

    switch (anim) {
      case "karaoke":
        return {
          text: w,
          style: {
            color: passed ? opts.highlight : opts.color,
            transform: `scale(${active ? 1.08 : 1})`,
            transition: "color 120ms linear",
          },
        };
      case "slideUp":
        return {
          text: w,
          style: {
            opacity: local,
            transform: `translateY(${(1 - local) * 0.5}em)`,
          },
        };
      case "glow":
        return {
          text: w,
          style: {
            opacity: local,
            color: active ? opts.highlight : opts.color,
            textShadow: active
              ? `0 0 0.35em ${opts.highlight}, 0 0 0.7em ${opts.highlight}`
              : undefined,
          },
        };
      case "shakeDrop": {
        const shake = local < 1 ? Math.sin(local * 28) * (1 - local) * 6 : 0;
        return {
          text: w,
          style: {
            opacity: local,
            transform: `translateY(${(local - 1) * 0.6}em) rotate(${shake}deg)`,
          },
        };
      }
      case "wordPop":
      default: {
        const s = local < 1 ? 0.5 + local * 0.62 : 1;
        return { text: w, style: { opacity: local, transform: `scale(${s})` } };
      }
    }
  });
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
