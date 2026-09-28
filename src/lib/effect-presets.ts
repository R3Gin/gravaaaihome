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

/** tempo disponível do ponto da agulha até o fim do clipe (ou da janela) */
function remaining(clip: Clip, a: number) {
  return Math.max(0.2, clip.duration - a);
}

/** posição "neutra" conforme o tipo de clipe (a mesma que o preview usa sem keyframes) */
export function basePosition(clip: Clip): { x: number; y: number } {
  if (clip.type === "overlay") {
    const r = clip.rect ?? { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }
  if (clip.position) return clip.position;
  if (clip.type === "text") return { x: 0.5, y: 0.82 };
  return { x: 0, y: 0 };
}

/**
 * Deslocamento usado nos "deslizar". No vídeo a posição é pan em unidades de
 * meia largura/altura do quadro (2 = o quadro inteiro sai da tela); em texto e
 * sobreposições é a fração do palco.
 */
function slideAmount(clip: Clip) {
  return clip.type === "video" ? 2 : 1;
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

/**
 * Pan que leva o ponto clicado para o centro da tela depois do zoom.
 * `point` é normalizado sobre o quadro do vídeo (0–1). O pan é limitado para
 * a imagem ampliada sempre cobrir o quadro (sem bordas pretas): perto das
 * bordas o ponto fica o mais perto do centro possível.
 */
export function panForPoint(point: { x: number; y: number } | undefined, scale: number) {
  if (!point || scale <= 1) return { x: 0, y: 0 };
  const lim = 1 - 1 / scale;
  const clamp = (v: number) => Math.max(-lim, Math.min(lim, v));
  return { x: clamp((0.5 - point.x) * 2), y: clamp((0.5 - point.y) * 2) };
}

/* ------------------------------ Zoom ------------------------------ */

/**
 * Zoom que entra, segura e volta dentro da própria janela: a barra na
 * timeline é exatamente o trecho em que o vídeo fica ampliado.
 */
function zoomWindow(
  clip: Clip,
  params: PresetParams,
  ramp: number,
  anchor?: number,
): Record<string, Keyframe[]> {
  const a = anchorOf(clip, anchor);
  const len = remaining(clip, a);
  const scale = params.zoomLevel ?? 1.5;
  const pan = panForPoint(params.point, scale);
  const base = basePosition(clip);
  const target = { x: base.x + pan.x, y: base.y + pan.y };
  const t = Math.min(ramp, len * 0.4);
  return {
    zoom: [k(a, 1), k(a + t, scale), k(a + len - t, scale), k(a + len, 1)],
    position: [k(a, base), k(a + t, target), k(a + len - t, target), k(a + len, base)],
  };
}

/* ---------------------------- Ênfase ------------------------------ */

const AMPLITUDE: Record<IntensityName, number> = { subtle: 0.5, medium: 1, strong: 1.8 };

/** zoom curto que entra/sai nas pontas da janela, só para cobrir bordas */
function coverZoom(a: number, len: number, z: number): Keyframe[] {
  const t = Math.min(0.12, len * 0.2);
  return [k(a, 1), k(a + t, z), k(a + len - t, z), k(a + len, 1)];
}

/** divide a janela em ciclos inteiros perto de `period`: o efeito preenche a barra toda */
function fitCycles(available: number, period: number) {
  const n = Math.max(1, Math.min(200, Math.round(available / period)));
  return { n, period: available / n };
}

/* --------------------------- Catálogo ----------------------------- */

/*
 * Todos os efeitos usam a janela inteira (da agulha até o fim do clipe
 * sintético que `buildForWindow` monta): a barra na timeline é o efeito.
 * Esticar a barra deixa a animação mais lenta; a velocidade escolhida no
 * painel só define o tamanho inicial da barra (ver `naturalWindow`).
 */
export const EFFECT_PRESETS: EffectPresetDef[] = [
  {
    id: "zoom-smooth",
    label: "Zoom suave",
    category: "zoom",
    needsPoint: true,
    controls: ["zoomLevel"],
    types: ["video"],
    build: (clip, p, anchor) => zoomWindow(clip, p, 1, anchor),
  },
  {
    id: "zoom-fast",
    label: "Zoom rápido",
    category: "zoom",
    needsPoint: true,
    controls: ["zoomLevel"],
    types: ["video"],
    build: (clip, p, anchor) => zoomWindow(clip, p, 0.3, anchor),
  },
  {
    id: "zoom-back",
    label: "Zoom e volta",
    category: "zoom",
    needsPoint: true,
    controls: ["zoomLevel", "duration"],
    types: ["video"],
    build: (clip, p, anchor) => zoomWindow(clip, p, 0.5, anchor),
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
      const len = remaining(clip, a);
      const scale = p.zoomLevel ?? 1.5;
      const pan = panForPoint(p.point, scale);
      const base = basePosition(clip);
      const target = { x: base.x + pan.x, y: base.y + pan.y };
      // aproxima devagar durante quase toda a barra e volta rápido no fim
      const back = Math.min(0.6, len * 0.2);
      return {
        zoom: [k(a, 1, "linear"), k(a + len - back, scale, "ease-in-out"), k(a + len, 1)],
        position: [k(a, base, "linear"), k(a + len - back, target, "ease-in-out"), k(a + len, base)],
      };
    },
  },

  /* --------------------------- Entrada --------------------------- */

  {
    id: "in-fade",
    label: "Aparecer com fade",
    category: "in",
    controls: ["speed"],
    build: (clip, _p, anchor) => {
      const a = anchorOf(clip, anchor);
      const d = remaining(clip, a);
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
    build: (clip: Clip, _p: PresetParams, anchor?: number) => {
      const a = anchorOf(clip, anchor);
      const d = remaining(clip, a);
      const base = basePosition(clip);
      // "de cima" => começa acima (y menor) e desce até o lugar
      const off = dirOffset(dir, slideAmount(clip));
      return {
        position: [
          k(a, { x: base.x + off.x, y: base.y + off.y }, "ease-out"),
          k(a + d, base, "ease-out"),
        ],
        opacity: [k(a, 0, "ease-out"), k(a + Math.min(d * 0.5, 0.25), 1, "ease-out")],
      };
    },
  })),
  {
    id: "in-pop",
    label: "Crescer (pop)",
    category: "in",
    controls: ["speed"],
    build: (clip, _p, anchor) => {
      const a = anchorOf(clip, anchor);
      const d = remaining(clip, a);
      return {
        scale: [k(a, 0.6, "ease-out"), k(a + d * 0.7, 1.08, "ease-out"), k(a + d, 1, "ease-in-out")],
        opacity: [k(a, 0, "ease-out"), k(a + d * 0.5, 1, "ease-out")],
      };
    },
  },
  {
    id: "in-zoom",
    label: "Entrar com zoom",
    category: "in",
    controls: ["speed"],
    types: ["video"],
    build: (clip, _p, anchor) => {
      const a = anchorOf(clip, anchor);
      const d = remaining(clip, a);
      return {
        zoom: [k(a, 1.35, "ease-out"), k(a + d, 1, "ease-out")],
        opacity: [k(a, 0, "ease-out"), k(a + Math.min(d * 0.5, 0.4), 1, "ease-out")],
      };
    },
  },

  /* ---------------------------- Saída ---------------------------- */
  {
    id: "out-fade",
    label: "Sumir com fade",
    category: "out",
    controls: ["speed"],
    build: (clip, _p, anchor) => {
      const a = anchorOf(clip, anchor);
      const end = a + remaining(clip, a);
      return { opacity: [k(a, 1, "ease-in"), k(end, 0, "ease-in")] };
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
    build: (clip: Clip, _p: PresetParams, anchor?: number) => {
      const a = anchorOf(clip, anchor);
      const d = remaining(clip, a);
      const end = a + d;
      const base = basePosition(clip);
      const off = dirOffset(dir, slideAmount(clip));
      return {
        position: [
          k(a, base, "ease-in"),
          k(end, { x: base.x + off.x, y: base.y + off.y }, "ease-in"),
        ],
        opacity: [k(end - Math.min(d * 0.5, 0.25), 1, "ease-in"), k(end, 0, "ease-in")],
      };
    },
  })),
  {
    id: "out-shrink",
    label: "Encolher",
    category: "out",
    controls: ["speed"],
    build: (clip, _p, anchor) => {
      const a = anchorOf(clip, anchor);
      const end = a + remaining(clip, a);
      return {
        scale: [k(a, 1, "ease-in"), k(end, 0.6, "ease-in")],
        opacity: [k(a, 1, "ease-in"), k(end, 0, "ease-in")],
      };
    },
  },
  {
    id: "out-spin",
    label: "Sumir girando",
    category: "out",
    controls: ["speed"],
    build: (clip, _p, anchor) => {
      const a = anchorOf(clip, anchor);
      const end = a + remaining(clip, a);
      return {
        rotation: [k(a, 0, "ease-in"), k(end, 25, "ease-in")],
        scale: [k(a, 1, "ease-in"), k(end, 0.6, "ease-in")],
        opacity: [k(a, 1, "ease-in"), k(end, 0, "ease-in")],
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
      const amp = 0.06 * AMPLITUDE[p.intensity ?? "medium"];
      const { n, period } = fitCycles(remaining(clip, a), 0.8);
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
      const { n, period: step } = fitCycles(remaining(clip, a), 0.08);
      const px = (clip.type === "video" ? 0.03 : 0.008) * amp;
      const pos: Keyframe[] = [k(a, base, "linear")];
      const rot: Keyframe[] = [k(a, 0, "linear")];
      for (let i = 1; i < n; i++) {
        const s = i % 2 === 0 ? 1 : -1;
        pos.push(k(a + i * step, { x: base.x + s * px, y: base.y }, "linear"));
        rot.push(k(a + i * step, s * 0.8 * amp, "linear"));
      }
      pos.push(k(a + n * step, base, "linear"));
      rot.push(k(a + n * step, 0, "linear"));
      const out: Record<string, Keyframe[]> = { position: pos, rotation: rot };
      // no vídeo, um zoom leve esconde as bordas pretas que o tremor revelaria
      if (clip.type === "video") out.zoom = coverZoom(a, n * step, 1 + px * 1.5 + 0.02);
      return out;
    },
  },
  {
    id: "emph-blink",
    label: "Piscar",
    category: "emphasis",
    controls: ["intensity"],
    build: (clip, p, anchor) => {
      const a = anchorOf(clip, anchor);
      const low = Math.max(0.1, 1 - 0.45 * AMPLITUDE[p.intensity ?? "medium"]);
      const { n, period } = fitCycles(remaining(clip, a), 0.5);
      const keys: Keyframe[] = [k(a, 1, "ease-in-out")];
      for (let i = 0; i < n; i++) {
        keys.push(k(a + i * period + period / 2, low));
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
      const amp = (clip.type === "video" ? 0.12 : 0.05) * AMPLITUDE[p.intensity ?? "medium"];
      const base = basePosition(clip);
      const { n, period } = fitCycles(remaining(clip, a), 0.45);
      const keys: Keyframe[] = [k(a, base, "ease-out")];
      for (let i = 0; i < n; i++) {
        keys.push(k(a + i * period + period / 2, { x: base.x, y: base.y - amp }, "ease-out"));
        keys.push(k(a + (i + 1) * period, base, "ease-in"));
      }
      const out: Record<string, Keyframe[]> = { position: keys };
      if (clip.type === "video") out.zoom = coverZoom(a, n * period, 1 / (1 - amp / 2));
      return out;
    },
  },
  {
    id: "emph-swing",
    label: "Balançar",
    category: "emphasis",
    controls: ["intensity"],
    build: (clip, p, anchor) => {
      const a = anchorOf(clip, anchor);
      const amp = 4 * AMPLITUDE[p.intensity ?? "medium"];
      const { n, period: step } = fitCycles(remaining(clip, a), 0.2);
      const rot: Keyframe[] = [k(a, 0)];
      for (let i = 1; i < n; i++) rot.push(k(a + i * step, (i % 2 === 0 ? 1 : -1) * amp));
      rot.push(k(a + n * step, 0));
      return { rotation: rot };
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

/** tipos que um efeito sem restrição aceita: tudo que tem imagem (áudio e legenda não) */
const VISUAL_TYPES: Clip["type"][] = ["video", "text", "overlay"];

export function presetsFor(clip: Clip): EffectPresetDef[] {
  if (clip.isCaption) return [];
  return EFFECT_PRESETS.filter((p) => (p.types ?? VISUAL_TYPES).includes(clip.type));
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
  // zoom e volta: rampa de 0,5 s na entrada e na saída + o tempo parado no ponto
  if (def.id === "zoom-back") return Math.max(1, (params.duration ?? 2) + 1);
  if (def.id === "zoom-drift") return Math.max(1, (params.duration ?? 2) * 2);
  if (def.id === "zoom-fast") return 2.5;
  if (def.category === "zoom") return 3;
  if (def.category === "emphasis") return 2;
  if (def.id === "in-zoom") return speed * 1.5;
  if (def.id === "out-spin") return speed * 1.4;
  return Math.max(0.3, speed);
}

/** parâmetros que mudam o tamanho da barra do efeito */
export function paramsChangeWindow(patch: PresetParams): boolean {
  return patch.speed !== undefined || patch.duration !== undefined;
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

