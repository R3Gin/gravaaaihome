/* ------------------------------------------------------------------ *
 * Presets de efeito (modo "Simples" do painel de propriedades).
 *
 * Cada preset é uma função pura que recebe o clipe + parâmetros simples
 * e devolve keyframes normais (mesma estrutura usada pelo modo Avançado),
 * marcados com `origin` = id da instância aplicada. Assim o preview e a
 * exportação funcionam sem nenhum caminho especial.
 *
 * `anchor` (segundos, local ao clipe) é a posição da agulha: zoom, entrada
 * e ênfase começam ali; saída continua ancorada no fim do clipe.
 * ------------------------------------------------------------------ */

import { newKeyframe, valueAt, type Easing, type Keyframe, type KeyValue } from "@/lib/keyframes";
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
  /** `anchor`: tempo local (s) da agulha dentro do clipe */
  build: (clip: Clip, params: PresetParams, anchor?: number) => Record<string, Keyframe[]>;
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

/** âncora válida (0..duração do clipe) */
function anchorOf(clip: Clip, anchor?: number) {
  const max = Math.max(0, clip.duration - 0.05);
  return Math.max(0, Math.min(max, anchor ?? 0));
}

/** tempo disponível do ponto da agulha até o fim do clipe */
function remaining(clip: Clip, a: number) {
  return Math.max(0.2, clip.duration - a);
}

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

function zoomHold(
  clip: Clip,
  params: PresetParams,
  inTime: number,
  anchor?: number,
): Record<string, Keyframe[]> {
  const a = anchorOf(clip, anchor);
  const scale = params.zoomLevel ?? 1.5;
  const pan = panForPoint(params.point, scale);
  const base = basePosition(clip);
  const t = Math.min(inTime, remaining(clip, a) * 0.6);
  return {
    zoom: [k(a, 1, "ease-in-out"), k(a + t, scale, "ease-in-out")],
    position: [
      k(a, base, "ease-in-out"),
      k(a + t, { x: base.x + pan.x, y: base.y + pan.y }, "ease-in-out"),
    ],
  };
}

/* ---------------------------- Ênfase ------------------------------ */

const AMPLITUDE: Record<IntensityName, number> = { subtle: 0.5, medium: 1, strong: 1.8 };

function cycles(available: number, period: number, maxCycles = 12) {
  return Math.max(1, Math.min(maxCycles, Math.floor(available / period)));
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
    build: (clip, p, anchor) => zoomHold(clip, p, 1.6, anchor),
  },
  {
    id: "zoom-fast",
    label: "Zoom rápido",
    category: "zoom",
    needsPoint: true,
    controls: ["zoomLevel"],
    types: ["video"],
    build: (clip, p, anchor) => zoomHold(clip, p, 0.45, anchor),
  },
  {
    id: "zoom-back",
    label: "Zoom e volta",
    category: "zoom",
    needsPoint: true,
    controls: ["zoomLevel", "duration"],
    types: ["video"],
    build: (clip, p, anchor) => {
      const a = anchorOf(clip, anchor);
      const avail = remaining(clip, a);
      const scale = p.zoomLevel ?? 1.5;
      const pan = panForPoint(p.point, scale);
      const base = basePosition(clip);
      const inT = Math.min(0.5, avail * 0.25);
      const outT = inT;
      const hold = Math.max(0.2, Math.min(p.duration ?? 2, avail - inT - outT));
      const end = inT + hold + outT;
      const target = { x: base.x + pan.x, y: base.y + pan.y };
      return {
        zoom: [k(a, 1), k(a + inT, scale), k(a + inT + hold, scale), k(a + end, 1)],
        position: [k(a, base), k(a + inT, target), k(a + inT + hold, target), k(a + end, base)],
      };
    },
  },
  {
    id: "zoom-reset",
    label: "Reverter zoom",
    category: "zoom",
    controls: ["speed"],
    types: ["video"],
    build: (clip, p, anchor) => {
      const a = anchorOf(clip, anchor);
      const d = Math.min(SPEED_SECONDS[p.speed ?? "medium"], remaining(clip, a) * 0.9);
      const base = basePosition(clip);
      const curZoom = valueAt(clip.keyframes?.["zoom"], a);
      const curPos = valueAt(clip.keyframes?.["position"], a);
      const from = typeof curZoom === "number" ? curZoom : (clip.zoom ?? 1);
      const fromPos =
        curPos && typeof curPos === "object" ? curPos : (clip.position ?? base);
      return {
        zoom: [k(a, from, "ease-in-out"), k(a + d, 1, "ease-in-out")],
        position: [k(a, fromPos, "ease-in-out"), k(a + d, base, "ease-in-out")],
      };
    },
  },
  {
    id: "zoom-drift",
    label: "Zoom contínuo (Ken Burns)",
    category: "zoom",
    needsPoint: true,
    controls: ["zoomLevel", "duration"],
    types: ["video"],
    build: (clip, p, anchor) => {
      const a = anchorOf(clip, anchor);
      const avail = remaining(clip, a);
      const scale = p.zoomLevel ?? 1.5;
      const pan = panForPoint(p.point, scale);
      const base = basePosition(clip);
      const d = Math.max(0.6, Math.min((p.duration ?? 2) * 2, avail));
      return {
        zoom: [k(a, 1, "linear"), k(a + d, scale, "linear")],
        position: [
          k(a, base, "linear"),
          k(a + d, { x: base.x + pan.x, y: base.y + pan.y }, "linear"),
        ],
      };
    },
  },

  /* --------------------------- Entrada --------------------------- */

  {
    id: "in-fade",
    label: "Aparecer com fade",
    category: "in",
    controls: ["speed"],
    build: (clip, p, anchor) => {
      const a = anchorOf(clip, anchor);
      const d = Math.min(SPEED_SECONDS[p.speed ?? "medium"], remaining(clip, a) * 0.6);
      return { opacity: [k(a, 0, "ease-out"), k(a + d, 1, "ease-out")] };
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
    build: (clip: Clip, p: PresetParams, anchor?: number) => {
      const a = anchorOf(clip, anchor);
      const d = Math.min(SPEED_SECONDS[p.speed ?? "medium"], remaining(clip, a) * 0.6);
      const base = basePosition(clip);
      // "de cima" => começa acima (offset negativo em y)
      const off = dirOffset(dir === "up" ? "up" : dir === "down" ? "down" : dir, slideAmount(clip));
      return {
        position: [
          k(a, { x: base.x + off.x, y: base.y + off.y }, "ease-out"),
          k(a + d, base, "ease-out"),
        ],
        opacity: [k(a, 0, "ease-out"), k(a + Math.min(d, 0.25), 1, "ease-out")],
      };
    },
  })),
  {
    id: "in-pop",
    label: "Crescer (pop)",
    category: "in",
    controls: ["speed"],
    build: (clip, p, anchor) => {
      const a = anchorOf(clip, anchor);
      const d = Math.min(SPEED_SECONDS[p.speed ?? "medium"], remaining(clip, a) * 0.6);
      return {
        scale: [k(a, 0.8, "ease-out"), k(a + d * 0.7, 1.06, "ease-out"), k(a + d, 1, "ease-in-out")],
        opacity: [k(a, 0, "ease-out"), k(a + d * 0.6, 1, "ease-out")],
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
    build: (clip, p, anchor) => {
      const a = anchorOf(clip, anchor);
      const amp = 0.05 * AMPLITUDE[p.intensity ?? "medium"];
      const period = 0.8;
      const n = cycles(remaining(clip, a), period, 4);
      const keys: Keyframe[] = [k(a, 1)];
      for (let i = 0; i < n; i++) {
        keys.push(k(a + i * period + period / 2, 1 + amp));
        keys.push(k(a + (i + 1) * period, 1));
      }
      return { scale: keys };
    },
  },
  {
    id: "emph-shake",
    label: "Tremer",
    category: "emphasis",
    controls: ["intensity"],
    build: (clip, p, anchor) => {
      const a = anchorOf(clip, anchor);
      const amp = AMPLITUDE[p.intensity ?? "medium"];
      const base = basePosition(clip);
      const step = 0.08;
      const n = Math.min(16, Math.max(4, Math.floor(remaining(clip, a) / step / 2)));
      const px = (clip.type === "text" ? 0.008 : 0.02) * amp;
      const pos: Keyframe[] = [k(a, base, "linear")];
      const rot: Keyframe[] = [k(a, 0, "linear")];
      for (let i = 1; i <= n; i++) {
        const s = i % 2 === 0 ? 1 : -1;
        pos.push(k(a + i * step, { x: base.x + s * px, y: base.y }, "linear"));
        rot.push(k(a + i * step, s * 0.8 * amp, "linear"));
      }
      pos.push(k(a + (n + 1) * step, base, "linear"));
      rot.push(k(a + (n + 1) * step, 0, "linear"));
      return { position: pos, rotation: rot };
    },
  },
  {
    id: "emph-blink",
    label: "Piscar",
    category: "emphasis",
    controls: ["intensity"],
    build: (clip, p, anchor) => {
      const a = anchorOf(clip, anchor);
      const low = 1 - 0.4 * AMPLITUDE[p.intensity ?? "medium"] * 0.6;
      const period = 0.5;
      const n = cycles(remaining(clip, a), period, 4);
      const keys: Keyframe[] = [k(a, 1, "ease-in-out")];
      for (let i = 0; i < n; i++) {
        keys.push(k(a + i * period + period / 2, Math.max(0.2, low)));
        keys.push(k(a + (i + 1) * period, 1));
      }
      return { opacity: keys };
    },
  },
  {
    id: "emph-bounce",
    label: "Quicar",
    category: "emphasis",
    controls: ["intensity"],
    build: (clip, p, anchor) => {
      const a = anchorOf(clip, anchor);
      const amp = (clip.type === "text" ? 0.06 : 0.12) * AMPLITUDE[p.intensity ?? "medium"];
      const base = basePosition(clip);
      const period = 0.45;
      const n = cycles(remaining(clip, a), period, 3);
      const keys: Keyframe[] = [k(a, base, "ease-out")];
      for (let i = 0; i < n; i++) {
        keys.push(k(a + i * period + period / 2, { x: base.x, y: base.y - amp }, "ease-out"));
        keys.push(k(a + (i + 1) * period, base, "ease-in"));
      }
      return { position: keys };
    },
  },
  {
    id: "emph-swing",
    label: "Balançar",
    category: "emphasis",
    controls: ["intensity"],
    build: (clip, p, anchor) => {
      const a = anchorOf(clip, anchor);
      const amp = 3 * AMPLITUDE[p.intensity ?? "medium"];
      const step = 0.18;
      const n = Math.min(8, Math.max(2, Math.floor(remaining(clip, a) / step)));
      const rot: Keyframe[] = [k(a, 0)];
      for (let i = 1; i <= n; i++) rot.push(k(a + i * step, (i % 2 === 0 ? 1 : -1) * amp));
      rot.push(k(a + (n + 1) * step, 0));
      return { rotation: rot };
    },
  },
  {
    id: "in-zoom",
    label: "Entrar com zoom",
    category: "in",
    controls: ["speed"],
    types: ["video"],
    build: (clip, p, anchor) => {
      const a = anchorOf(clip, anchor);
      const d = Math.min(SPEED_SECONDS[p.speed ?? "medium"] * 1.5, remaining(clip, a) * 0.8);
      return {
        zoom: [k(a, 1.35, "ease-out"), k(a + d, 1, "ease-out")],
        opacity: [k(a, 0, "ease-out"), k(a + Math.min(d, 0.4), 1, "ease-out")],
      };
    },
  },
  {
    id: "out-spin",
    label: "Sumir girando",
    category: "out",
    controls: ["speed"],
    build: (clip, p) => {
      const d = Math.min(SPEED_SECONDS[p.speed ?? "medium"] * 1.4, dur(clip) * 0.6);
      const end = dur(clip);
      return {
        rotation: [k(end - d, 0, "ease-in"), k(end, 25, "ease-in")],
        scale: [k(end - d, 1, "ease-in"), k(end, 0.6, "ease-in")],
        opacity: [k(end - d, 1, "ease-in"), k(end, 0, "ease-in")],
      };
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

/* ------------------------------------------------------------------ *
 * Efeitos com janela própria na linha do tempo.
 *
 * Um efeito passa a ter início e fim em tempo global; os keyframes são
 * gerados sobre um clipe "sintético" com a duração da janela e depois
 * deslocados para o tempo local de cada clipe que a janela cobrir.
 * ------------------------------------------------------------------ */

/** duração inicial sugerida (s) de um efeito recém-aplicado */
export function naturalWindow(def: EffectPresetDef, params: PresetParams): number {
  const speed = SPEED_SECONDS[params.speed ?? "medium"];
  if (def.id === "zoom-back") return Math.max(1, (params.duration ?? 2) + 1);
  if (def.id === "zoom-drift") return Math.max(1, (params.duration ?? 2) * 2);
  if (def.category === "zoom") return def.id === "zoom-fast" ? 0.9 : def.id === "zoom-reset" ? speed : 1.8;
  if (def.category === "emphasis") return 2;
  return Math.max(0.3, speed * 1.4);
}

/**
 * Gera os keyframes de um efeito para um clipe específico.
 * `winStart`/`winEnd` são tempos globais da linha do tempo.
 */
export function buildForWindow(
  clip: Clip,
  def: EffectPresetDef,
  params: PresetParams,
  winStart: number,
  winEnd: number,
): Record<string, Keyframe[]> {
  const len = Math.max(0.2, winEnd - winStart);
  const synthetic: Clip = { ...clip, startTime: winStart, duration: len };
  const generated = def.build(synthetic, params, 0);
  const shift = winStart - clip.startTime;
  const out: Record<string, Keyframe[]> = {};
  for (const [prop, keys] of Object.entries(generated)) {
    out[prop] = keys.map((kf) => ({ ...kf, time: kf.time + shift }));
  }
  return out;
}

