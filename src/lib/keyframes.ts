/* ------------------------------------------------------------------ *
 * Sistema de keyframes (estilo After Effects).
 * Cada propriedade animável de um clipe guarda uma lista de keyframes
 * ordenada por tempo (relativo ao início do clipe).
 * ------------------------------------------------------------------ */

import type { Clip } from "@/state/editor-store";

export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold";

export type KeyValue = number | { x: number; y: number };

export interface Keyframe {
  id: string;
  /** segundos, relativo ao início do clipe */
  time: number;
  value: KeyValue;
  easing: Easing;
}

export type KeyframeMap = Record<string, Keyframe[]>;

/** tolerância para considerar o playhead "em cima" de um keyframe */
export const KF_EPS = 0.02;

export const EASINGS: { id: Easing; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "ease-in", label: "Ease in" },
  { id: "ease-out", label: "Ease out" },
  { id: "ease-in-out", label: "Ease in-out" },
  { id: "hold", label: "Hold (sem interpolação)" },
];

const kfid = () => Math.random().toString(36).slice(2, 10);

export function ease(kind: Easing, p: number): number {
  switch (kind) {
    case "hold":
      return 0;
    case "ease-in":
      return p * p;
    case "ease-out":
      return 1 - (1 - p) * (1 - p);
    case "ease-in-out":
      return p * p * (3 - 2 * p);
    default:
      return p;
  }
}

function isPoint(v: KeyValue): v is { x: number; y: number } {
  return typeof v === "object" && v !== null;
}

export function lerpValue(a: KeyValue, b: KeyValue, p: number): KeyValue {
  if (isPoint(a) && isPoint(b)) {
    return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
  }
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * p;
  return a;
}

export function sortKeys(keys: Keyframe[]): Keyframe[] {
  return [...keys].sort((a, b) => a.time - b.time);
}

/** Valor interpolado num tempo local. Fora do intervalo, faz clamp. */
export function valueAt(keys: Keyframe[] | undefined, time: number): KeyValue | null {
  if (!keys || keys.length === 0) return null;
  const ks = keys;
  if (time <= ks[0].time) return ks[0].value;
  const last = ks[ks.length - 1];
  if (time >= last.time) return last.value;
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i];
    const b = ks[i + 1];
    if (time >= a.time && time <= b.time) {
      const raw = (time - a.time) / Math.max(0.0001, b.time - a.time);
      return lerpValue(a.value, b.value, ease(a.easing, raw));
    }
  }
  return last.value;
}

/** Cria ou atualiza o keyframe no tempo informado. */
export function upsertKeyframe(
  keys: Keyframe[],
  time: number,
  value: KeyValue,
  easing: Easing = "ease-in-out",
): Keyframe[] {
  const existing = keys.find((k) => Math.abs(k.time - time) <= KF_EPS);
  if (existing) {
    return sortKeys(keys.map((k) => (k.id === existing.id ? { ...k, value } : k)));
  }
  return sortKeys([...keys, { id: kfid(), time: Math.max(0, time), value, easing }]);
}

export function newKeyframe(time: number, value: KeyValue, easing: Easing = "ease-in-out"): Keyframe {
  return { id: kfid(), time: Math.max(0, time), value, easing };
}

/* ------------------------------------------------------------------ *
 * Registro de propriedades animáveis por tipo de clipe.
 * ------------------------------------------------------------------ */

export interface AnimProp {
  key: string;
  label: string;
  kind: "number" | "point";
  min: number;
  max: number;
  step: number;
  /** valor estático (sem keyframes) */
  get: (clip: Clip) => KeyValue;
  /** patch aplicado quando a propriedade é estática */
  set: (value: KeyValue) => Partial<Clip>;
}

const num = (v: KeyValue, fallback: number) => (typeof v === "number" ? v : fallback);

const P = {
  opacity: {
    key: "opacity",
    label: "Opacidade",
    kind: "number",
    min: 0,
    max: 1,
    step: 0.01,
    get: (c) => c.opacity ?? 1,
    set: (v) => ({ opacity: num(v, 1) }),
  },
  scale: {
    key: "scale",
    label: "Escala",
    kind: "number",
    min: 0.2,
    max: 4,
    step: 0.01,
    get: (c) => c.scale ?? 1,
    set: (v) => ({ scale: num(v, 1) }),
  },
  rotation: {
    key: "rotation",
    label: "Rotação",
    kind: "number",
    min: -180,
    max: 180,
    step: 1,
    get: (c) => c.rotation ?? 0,
    set: (v) => ({ rotation: num(v, 0) }),
  },
  position: {
    key: "position",
    label: "Posição",
    kind: "point",
    min: -1,
    max: 2,
    step: 0.01,
    get: (c) => c.position ?? { x: 0.5, y: 0.5 },
    set: (v) => ({ position: typeof v === "number" ? { x: v, y: v } : v }),
  },
  brightness: {
    key: "brightness",
    label: "Brilho",
    kind: "number",
    min: -0.5,
    max: 0.5,
    step: 0.01,
    get: (c) => c.brightness ?? 0,
    set: (v) => ({ brightness: num(v, 0) }),
  },
  contrast: {
    key: "contrast",
    label: "Contraste",
    kind: "number",
    min: 0.5,
    max: 2,
    step: 0.01,
    get: (c) => c.contrast ?? 1,
    set: (v) => ({ contrast: num(v, 1) }),
  },
  saturation: {
    key: "saturation",
    label: "Saturação",
    kind: "number",
    min: 0,
    max: 2.5,
    step: 0.01,
    get: (c) => c.saturation ?? 1,
    set: (v) => ({ saturation: num(v, 1) }),
  },
  volume: {
    key: "volume",
    label: "Volume",
    kind: "number",
    min: 0,
    max: 1,
    step: 0.01,
    get: (c) => c.volume ?? 1,
    set: (v) => ({ volume: num(v, 1) }),
  },
  fontSize: {
    key: "fontSize",
    label: "Tamanho da fonte",
    kind: "number",
    min: 16,
    max: 140,
    step: 1,
    get: (c) => c.fontSize ?? 48,
    set: (v) => ({ fontSize: num(v, 48) }),
  },
  strength: {
    key: "strength",
    label: "Intensidade",
    kind: "number",
    min: 0.05,
    max: 40,
    step: 0.05,
    get: (c) => c.strength ?? 1,
    set: (v) => ({ strength: num(v, 1) }),
  },
} satisfies Record<string, AnimProp>;

export const ANIM_PROPS: Record<string, AnimProp> = P;

export function animatablePropsFor(clip: Clip): AnimProp[] {
  if (clip.type === "video" || clip.type === "audio") {
    return [P.position, P.scale, P.rotation, P.opacity, P.brightness, P.contrast, P.saturation, P.volume];
  }
  if (clip.type === "text") {
    return [P.position, P.opacity, P.rotation, P.fontSize];
  }
  return [P.position, P.opacity, P.strength];
}

export function propByKey(key: string): AnimProp | undefined {
  return ANIM_PROPS[key];
}

/** Propriedades que possuem keyframes ativos (usado pelo atalho "U"). */
export function animatedProps(clip: Clip): AnimProp[] {
  const map = clip.keyframes ?? {};
  return animatablePropsFor(clip).filter((p) => (map[p.key]?.length ?? 0) > 0);
}

/** Propriedades alteradas em relação ao padrão (atalho "UU"). */
export function modifiedProps(clip: Clip): AnimProp[] {
  const base: Record<string, KeyValue> = {
    opacity: 1,
    scale: 1,
    rotation: 0,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    volume: 1,
    fontSize: 48,
    strength: clip.overlayKind === "blur" ? 12 : 0.7,
  };
  return animatablePropsFor(clip).filter((p) => {
    if ((clip.keyframes?.[p.key]?.length ?? 0) > 0) return true;
    if (p.kind === "point") return false;
    const v = p.get(clip);
    return typeof v === "number" && base[p.key] !== undefined && Math.abs(v - (base[p.key] as number)) > 1e-6;
  });
}

/** Clipe com todas as propriedades animadas resolvidas no tempo da timeline. */
export function resolveClip(clip: Clip, timelineTime: number): Clip {
  const map = clip.keyframes;
  if (!map) return clip;
  const local = timelineTime - clip.startTime;
  let out = clip;
  for (const [key, keys] of Object.entries(map)) {
    if (!keys?.length) continue;
    const prop = propByKey(key);
    if (!prop) continue;
    const v = valueAt(keys, local);
    if (v === null) continue;
    out = { ...out, ...prop.set(v) };
  }
  return out;
}
