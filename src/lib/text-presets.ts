/* ------------------------------------------------------------------ *
 * Presets de animação de entrada/saída para clipes de texto.
 * Cada preset gera keyframes reais nas propriedades animáveis
 * (opacidade, posição, escala, rotação, desfoque, revelação),
 * marcados com `preset: "in" | "out"` para poderem ser substituídos.
 * ------------------------------------------------------------------ */

import type { Clip } from "@/state/editor-store";
import {
  DEFAULT_INFLUENCE,
  defaultTangent,
  newKeyframe,
  sortKeys,
  type Keyframe,
  type KeyframeMap,
  type KeyValue,
} from "@/lib/keyframes";

export type PresetId =
  | "none"
  | "fade"
  | "slide-up"
  | "slide-down"
  | "slide-left"
  | "slide-right"
  | "scale-in"
  | "scale-out"
  | "bounce"
  | "typewriter"
  | "blur"
  | "rotate"
  | "wipe";

export const TEXT_PRESETS: { id: PresetId; label: string }[] = [
  { id: "none", label: "Nenhuma" },
  { id: "fade", label: "Fade" },
  { id: "slide-up", label: "Slide para cima" },
  { id: "slide-down", label: "Slide para baixo" },
  { id: "slide-left", label: "Slide para a esquerda" },
  { id: "slide-right", label: "Slide para a direita" },
  { id: "scale-in", label: "Scale in" },
  { id: "scale-out", label: "Scale out" },
  { id: "bounce", label: "Bounce" },
  { id: "typewriter", label: "Typewriter" },
  { id: "blur", label: "Blur" },
  { id: "rotate", label: "Rotate" },
  { id: "wipe", label: "Wipe (máscara)" },
];

export interface PresetConfig {
  preset: PresetId;
  /** duração da animação em segundos */
  duration: number;
  /** velocidade em % (100 = padrão); controla a curva dos keyframes */
  speed: number;
}

export const DEFAULT_PRESET: PresetConfig = { preset: "none", duration: 0.5, speed: 100 };

/** Propriedades que os presets podem tocar. */
const PRESET_PROPS = ["opacity", "position", "scale", "rotation", "blur", "reveal"] as const;

type Side = "in" | "out";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Converte "velocidade %" em tangentes de Bezier: velocidades altas
 * fazem a animação disparar rápido e acomodar suavemente no final.
 */
function tangents(side: Side, speedPct: number, from: KeyValue, to: KeyValue, dur: number) {
  const k = clamp(speedPct, 10, 400) / 100;
  const dx = (typeof to === "number" ? to : to.x) - (typeof from === "number" ? from : from.x);
  const dy = typeof to === "number" || typeof from === "number" ? dx : to.y - from.y;
  const base = dur > 0 ? 1 / dur : 1;
  // velocidade de saída do primeiro keyframe (rápida) e de entrada do último (lenta)
  const fast = { x: dx * base * k, y: dy * base * k, influence: clamp(DEFAULT_INFLUENCE / k, 5, 90) };
  const slow = { x: 0, y: 0, influence: clamp(DEFAULT_INFLUENCE * k, 5, 95) };
  return side === "in"
    ? { start: fast, end: slow }
    : { start: { ...slow, x: 0, y: 0 }, end: fast };
}

function makePair(
  side: Side,
  t0: number,
  t1: number,
  from: KeyValue,
  to: KeyValue,
  speed: number,
): Keyframe[] {
  const tg = tangents(side, speed, from, to, Math.max(0.01, t1 - t0));
  const a: Keyframe = {
    ...newKeyframe(t0, from, "custom"),
    outgoingSpeed: tg.start,
    incomingSpeed: defaultTangent(),
    preset: side,
  };
  const b: Keyframe = {
    ...newKeyframe(t1, to, "custom"),
    incomingSpeed: tg.end,
    outgoingSpeed: defaultTangent(),
    preset: side,
  };
  return [a, b];
}

/** Remove os keyframes gerados por um lado do preset. */
export function stripPreset(map: KeyframeMap, side: Side): KeyframeMap {
  const out: KeyframeMap = {};
  for (const [key, keys] of Object.entries(map)) {
    const rest = (keys ?? []).filter((k) => k.preset !== side);
    if (rest.length) out[key] = rest;
  }
  return out;
}

/**
 * Gera os keyframes de um preset e devolve o novo mapa do clipe.
 * `base` são os valores "de repouso" do texto (posição/escala finais).
 */
export function applyPreset(clip: Clip, side: Side, cfg: PresetConfig): KeyframeMap {
  const map = stripPreset({ ...(clip.keyframes ?? {}) }, side);
  if (cfg.preset === "none") return map;

  const dur = clamp(cfg.duration, 0.05, Math.max(0.1, clip.duration));
  const t0 = side === "in" ? 0 : Math.max(0, clip.duration - dur);
  const t1 = side === "in" ? dur : clip.duration;

  const pos = clip.position ?? { x: 0.5, y: 0.82 };
  const scale = clip.scale ?? 1;
  const rot = clip.rotation ?? 0;
  const add: Record<string, Keyframe[]> = {};

  const push = (prop: string, keys: Keyframe[]) => {
    add[prop] = [...(add[prop] ?? []), ...keys];
  };

  const fadeKeys = () =>
    side === "in"
      ? makePair("in", t0, t1, 0, clip.opacity ?? 1, cfg.speed)
      : makePair("out", t0, t1, clip.opacity ?? 1, 0, cfg.speed);

  const slide = (dx: number, dy: number) => {
    const off = { x: pos.x + dx, y: pos.y + dy };
    push("position", side === "in" ? makePair("in", t0, t1, off, pos, cfg.speed) : makePair("out", t0, t1, pos, off, cfg.speed));
    push("opacity", fadeKeys());
  };

  switch (cfg.preset) {
    case "fade":
      push("opacity", fadeKeys());
      break;
    case "slide-up":
      slide(0, 0.25);
      break;
    case "slide-down":
      slide(0, -0.25);
      break;
    case "slide-left":
      slide(0.4, 0);
      break;
    case "slide-right":
      slide(-0.4, 0);
      break;
    case "scale-in":
      push("scale", side === "in" ? makePair("in", t0, t1, 0, scale, cfg.speed) : makePair("out", t0, t1, scale, 0, cfg.speed));
      push("opacity", fadeKeys());
      break;
    case "scale-out":
      push(
        "scale",
        side === "in"
          ? makePair("in", t0, t1, scale * 1.5, scale, cfg.speed)
          : makePair("out", t0, t1, scale, scale * 1.5, cfg.speed),
      );
      push("opacity", fadeKeys());
      break;
    case "bounce": {
      const mid = t0 + (t1 - t0) * 0.65;
      const over = scale * 1.1;
      const keys =
        side === "in"
          ? [
              ...makePair("in", t0, mid, 0, over, cfg.speed * 1.4),
              { ...newKeyframe(t1, scale, "custom"), incomingSpeed: { x: 0, y: 0, influence: 70 }, preset: "in" as const },
            ]
          : [
              { ...newKeyframe(t0, scale, "custom"), outgoingSpeed: { x: 0, y: 0, influence: 70 }, preset: "out" as const },
              ...makePair("out", t0 + (t1 - t0) * 0.35, t1, over, 0, cfg.speed * 1.4),
            ];
      push("scale", keys);
      push("opacity", fadeKeys());
      break;
    }
    case "typewriter":
    case "wipe":
      push(
        "reveal",
        side === "in" ? makePair("in", t0, t1, 0, 1, cfg.speed) : makePair("out", t0, t1, 1, 0, cfg.speed),
      );
      break;
    case "blur":
      push("blur", side === "in" ? makePair("in", t0, t1, 24, 0, cfg.speed) : makePair("out", t0, t1, 0, 24, cfg.speed));
      push("opacity", fadeKeys());
      break;
    case "rotate":
      push(
        "rotation",
        side === "in" ? makePair("in", t0, t1, rot - 15, rot, cfg.speed) : makePair("out", t0, t1, rot, rot + 15, cfg.speed),
      );
      push("opacity", fadeKeys());
      break;
    default:
      break;
  }

  for (const prop of PRESET_PROPS) {
    const extra = add[prop];
    if (!extra?.length) continue;
    map[prop] = sortKeys([...(map[prop] ?? []), ...extra]);
  }
  return map;
}

/** Modo de revelação usado pelo preview para typewriter / wipe. */
export function revealModeFor(inPreset: PresetId, outPreset: PresetId): Clip["revealMode"] {
  if (inPreset === "typewriter" || outPreset === "typewriter") return "typewriter";
  if (inPreset === "wipe" || outPreset === "wipe") return "wipe";
  return "none";
}
