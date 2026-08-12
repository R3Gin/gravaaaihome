/* ------------------------------------------------------------------ *
 * Presets de efeito (modo "Simples" do painel de propriedades).
 *
 * Cada preset é uma função pura que recebe o clipe + parâmetros simples
 * e devolve keyframes normais (mesma estrutura usada pelo modo Avançado),
 * marcados com `origin` = id da instância aplicada. Assim o preview e a
 * exportação funcionam sem nenhum caminho especial.
 * ------------------------------------------------------------------ */

import { newKeyframe, type Easing, type Keyframe, type KeyValue } from "@/lib/keyframes";
import type { Clip } from "@/state/editor-store";

export type EffectCategory = "zoom" | "in" | "out" | "emphasis";
export type SpeedName = "slow" | "medium" | "fast";
export type IntensityName = "subtle" | "medium" | "strong";

export interface PresetParams {
  speed?: SpeedName;
  /** segundos (Zoom e volta) */
  duration?: number;
  intensity?: IntensityName;
  /** nível de zoom (1.2 / 1.5 / 2) */
  zoomLevel?: number;
  /** ponto clicado no preview, normalizado 0–1 */
  point?: { x: number; y: number };
}

export type ControlKind = "speed" | "duration" | "intensity" | "zoomLevel";

export interface EffectPresetDef {
  id: string;
  label: string;
  category: EffectCategory;
  /** precisa que o usuário clique num ponto do preview */
  needsPoint?: boolean;
  controls: ControlKind[];
  /** tipos de clipe suportados */
  types?: Clip["type"][];
  build: (clip: Clip, params: PresetParams) => Record<string, Keyframe[]>;
}

export const SPEED_SECONDS: Record<SpeedName, number> = { slow: 1.2, medium: 0.7, fast: 0.35 };
export const SPEED_LABEL: Record<SpeedName, string> = {
  slow: "Lenta",
  medium: "Média",
  fast: "Rápida",
};
export const INTENSITY_LABEL: Record<IntensityName, string> = {
  subtle: "Sutil",
  medium: "Média",
  strong: "Forte",
};

export const DEFAULT_PARAMS: PresetParams = {
  speed: "medium",
  duration: 2,
  intensity: "medium",
  zoomLevel: 1.5,
};

const k = (time: number, value: KeyValue, easing: Easing = "ease-in-out"): Keyframe =>
  newKeyframe(Math.max(0, time), value, easing);

/** posição "neutra" conforme o tipo de clipe */
function basePosition(clip: Clip): { x: number; y: number } {
  if (clip.position) return clip.position;
  return clip.type === "video" || clip.type === "audio" ? { x: 0, y: 0 } : { x: 0.5, y: 0.5 };
}

/** deslocamento usado nos "deslizar" (unidades de pan do vídeo x normalizadas do texto) */
function slideAmount(clip: Clip) {
  return clip.type === "video" || clip.type === "audio" ? 1.6 : 0.8;
}

function dirOffset(dir: "up" | "down" | "left" | "right", amount: number) {
  switch (dir) {
    case "up":
      return { x: 0, y: -amount };
    case "down":
      return { x: 0, y: amount };
    case "left":
      return { x: -amount, y: 0 };
    default:
      return { x: amount, y: 0 };
  }
}

/** offset de pan que mantém o ponto clicado no centro após o zoom */
function panForPoint(point: { x: number; y: number } | undefined, scale: number) {
  if (!point || scale <= 1) return { x: 0, y: 0 };
  const f = (1 - scale) / scale;
  return { x: (point.x - 0.5) * 2 * f, y: (point.y - 0.5) * 2 * f };
}

const dur = (clip: Clip) => Math.max(0.2, clip.duration);

/* ------------------------------ Zoom ------------------------------ */

function zoomHold(clip: Clip, params: PresetParams, inTime: number): Record<string, Keyframe[]> {
  const scale = params.zoomLevel ?? 1.5;
  const pan = panForPoint(params.point, scale);
  const base = basePosition(clip);
  const t = Math.min(inTime, dur(clip) * 0.6);
  return {
    zoom: [k(0, 1, "ease-in-out"), k(t, scale, "ease-in-out")],
    position: [
      k(0, base, "ease-in-out"),
      k(t, { x: base.x + pan.x, y: base.y + pan.y }, "ease-in-out"),
    ],
  };
}

/* ---------------------------- Ênfase ------------------------------ */

const AMPLITUDE: Record<IntensityName, number> = { subtle: 0.5, medium: 1, strong: 1.8 };

function cycles(clip: Clip, period: number, maxCycles = 12) {
  return Math.max(1, Math.min(maxCycles, Math.floor(dur(clip) / period)));
}

/* --------------------------- Catálogo ----------------------------- */

export const EFFECT_PRESETS: EffectPresetDef[] = [
  {
    id: "zoom-smooth",
    label: "Zoom suave",
    category: "zoom",
    needsPoint: true,
    controls: ["zoomLevel"],
    types: ["video"],
    build: (clip, p) => zoomHold(clip, p, 1.6),
  },
  {
    id: "zoom-fast",
    label: "Zoom rápido",
    category: "zoom",
    needsPoint: true,
    controls: ["zoomLevel"],
    types: ["video"],
    build: (clip, p) => zoomHold(clip, p, 0.45),
  },
  {
    id: "zoom-back",
    label: "Zoom e volta",
    category: "zoom",
    needsPoint: true,
    controls: ["zoomLevel", "duration"],
    types: ["video"],
    build: (clip, p) => {
      const scale = p.zoomLevel ?? 1.5;
      const pan = panForPoint(p.point, scale);
      const base = basePosition(clip);
      const inT = 0.5;
      const hold = Math.max(0.2, Math.min(p.duration ?? 2, dur(clip) - inT - 0.5));
      const end = inT + hold + 0.5;
      const target = { x: base.x + pan.x, y: base.y + pan.y };
      return {
        zoom: [k(0, 1), k(inT, scale), k(inT + hold, scale), k(end, 1)],
        position: [k(0, base), k(inT, target), k(inT + hold, target), k(end, base)],
      };
    },
  },

  /* --------------------------- Entrada --------------------------- */
  {
    id: "in-fade",
    label: "Aparecer com fade",
    category: "in",
    controls: ["speed"],
    build: (clip, p) => {
      const d = Math.min(SPEED_SECONDS[p.speed ?? "medium"], dur(clip) * 0.6);
      return { opacity: [k(0, 0, "ease-out"), k(d, 1, "ease-out")] };
    },
  },
  ...(["up", "down", "left", "right"] as const).map((dir) => ({
    id: `in-slide-${dir}`,
    label: {
      up: "Deslizar de cima",
      down: "Deslizar de baixo",
      left: "Deslizar da esquerda",
      right: "Deslizar da direita",
    }[dir],
    category: "in" as const,
    controls: ["speed"] as ControlKind[],
    build: (clip: Clip, p: PresetParams) => {
      const d = Math.min(SPEED_SECONDS[p.speed ?? "medium"], dur(clip) * 0.6);
      const base = basePosition(clip);
      // "de cima" => começa acima (offset negativo em y)
      const off = dirOffset(dir === "up" ? "up" : dir === "down" ? "down" : dir, slideAmount(clip));
      return {
        position: [
          k(0, { x: base.x + off.x, y: base.y + off.y }, "ease-out"),
          k(d, base, "ease-out"),
        ],
        opacity: [k(0, 0, "ease-out"), k(Math.min(d, 0.25), 1, "ease-out")],
      };
    },
  })),
  {
    id: "in-pop",
    label: "Crescer (pop)",
    category: "in",
    controls: ["speed"],
    build: (clip, p) => {
      const d = Math.min(SPEED_SECONDS[p.speed ?? "medium"], dur(clip) * 0.6);
      return {
        scale: [k(0, 0.8, "ease-out"), k(d * 0.7, 1.06, "ease-out"), k(d, 1, "ease-in-out")],
        opacity: [k(0, 0, "ease-out"), k(d * 0.6, 1, "ease-out")],
      };
    },
  },

  /* ---------------------------- Saída ---------------------------- */
  {
    id: "out-fade",
    label: "Sumir com fade",
    category: "out",
    controls: ["speed"],
    build: (clip, p) => {
      const d = Math.min(SPEED_SECONDS[p.speed ?? "medium"], dur(clip) * 0.6);
      const end = dur(clip);
      return { opacity: [k(end - d, 1, "ease-in"), k(end, 0, "ease-in")] };
    },
  },
  ...(["up", "down", "left", "right"] as const).map((dir) => ({
    id: `out-slide-${dir}`,
    label: {
      up: "Deslizar para cima",
      down: "Deslizar para baixo",
      left: "Deslizar para a esquerda",
      right: "Deslizar para a direita",
    }[dir],
    category: "out" as const,
    controls: ["speed"] as ControlKind[],
    build: (clip: Clip, p: PresetParams) => {
      const d = Math.min(SPEED_SECONDS[p.speed ?? "medium"], dur(clip) * 0.6);
      const end = dur(clip);
      const base = basePosition(clip);
      const off = dirOffset(dir, slideAmount(clip));
      return {
        position: [
          k(end - d, base, "ease-in"),
          k(end, { x: base.x + off.x, y: base.y + off.y }, "ease-in"),
        ],
        opacity: [k(Math.max(0, end - 0.25), 1, "ease-in"), k(end, 0, "ease-in")],
      };
    },
  })),
  {
    id: "out-shrink",
    label: "Encolher",
    category: "out",
    controls: ["speed"],
    build: (clip, p) => {
      const d = Math.min(SPEED_SECONDS[p.speed ?? "medium"], dur(clip) * 0.6);
      const end = dur(clip);
      return {
        scale: [k(end - d, 1, "ease-in"), k(end, 0.8, "ease-in")],
        opacity: [k(end - d, 1, "ease-in"), k(end, 0, "ease-in")],
      };
    },
  },

  /* --------------------------- Ênfase ---------------------------- */
  {
    id: "emph-pulse",
    label: "Pulsar",
    category: "emphasis",
    controls: ["intensity"],
    build: (clip, p) => {
      const amp = 0.05 * AMPLITUDE[p.intensity ?? "medium"];
      const period = 0.8;
      const n = cycles(clip, period);
      const keys: Keyframe[] = [k(0, 1)];
      for (let i = 0; i < n; i++) {
        keys.push(k(i * period + period / 2, 1 + amp));
        keys.push(k((i + 1) * period, 1));
      }
      return { scale: keys };
    },
  },
  {
    id: "emph-shake",
    label: "Tremer",
    category: "emphasis",
    controls: ["intensity"],
    build: (clip, p) => {
      const a = AMPLITUDE[p.intensity ?? "medium"];
      const base = basePosition(clip);
      const step = 0.08;
      const n = Math.min(16, Math.max(4, Math.floor(dur(clip) / step / 2)));
      const px = (clip.type === "text" ? 0.008 : 0.02) * a;
      const pos: Keyframe[] = [k(0, base, "linear")];
      const rot: Keyframe[] = [k(0, 0, "linear")];
      for (let i = 1; i <= n; i++) {
        const s = i % 2 === 0 ? 1 : -1;
        pos.push(k(i * step, { x: base.x + s * px, y: base.y }, "linear"));
        rot.push(k(i * step, s * 0.8 * a, "linear"));
      }
      pos.push(k((n + 1) * step, base, "linear"));
      rot.push(k((n + 1) * step, 0, "linear"));
      return { position: pos, rotation: rot };
    },
  },
  {
    id: "emph-blink",
    label: "Piscar",
    category: "emphasis",
    controls: ["intensity"],
    build: (clip, p) => {
      const low = 1 - 0.4 * AMPLITUDE[p.intensity ?? "medium"] * 0.6;
      const period = 0.5;
      const n = Math.min(4, cycles(clip, period, 4));
      const keys: Keyframe[] = [k(0, 1, "ease-in-out")];
      for (let i = 0; i < n; i++) {
        keys.push(k(i * period + period / 2, Math.max(0.2, low)));
        keys.push(k((i + 1) * period, 1));
      }
      return { opacity: keys };
    },
  },
];

export const CATEGORY_LABEL: Record<EffectCategory, string> = {
  zoom: "Zoom",
  in: "Entrada",
  out: "Saída",
  emphasis: "Ênfase",
};

export function presetById(id: string): EffectPresetDef | undefined {
  return EFFECT_PRESETS.find((p) => p.id === id);
}

export function presetsFor(clip: Clip): EffectPresetDef[] {
  return EFFECT_PRESETS.filter((p) => !p.types || p.types.includes(clip.type));
}
