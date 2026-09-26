/* ------------------------------------------------------------------ *
 * Sistema de keyframes (estilo After Effects / Premiere).
 * Cada propriedade animável de um clipe guarda uma lista de keyframes
 * ordenada por tempo (relativo ao início do clipe).
 *
 * Além dos easings pré-definidos, cada keyframe pode ter tangentes de
 * velocidade (entrada/saída) com "influência" — equivalente ao modal
 * "Velocidade do quadro-chave" do Premiere.
 * ------------------------------------------------------------------ */

import type { Clip } from "@/state/editor-store";

export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "hold" | "custom";

export type KeyValue = number | { x: number; y: number };

/** Tangente de velocidade de um lado do keyframe. */
export interface TangentSpeed {
  /** unidades por segundo na dimensão X (ou valor único em props escalares) */
  x: number;
  /** unidades por segundo na dimensão Y (props multi-dimensionais) */
  y: number;
  /** 0–100 (%) — alcance da curva de Bezier perto do keyframe */
  influence: number;
}

export interface Keyframe {
  id: string;
  /** segundos, relativo ao início do clipe */
  time: number;
  value: KeyValue;
  easing: Easing;
  incomingSpeed?: TangentSpeed;
  outgoingSpeed?: TangentSpeed;
  /** trava a velocidade de saída espelhando a de entrada */
  continuous?: boolean;
  /** marca keyframes criados por um preset de animação de texto */
  preset?: "in" | "out";
  /** id da instância de preset de efeito (modo Simples) que criou este keyframe */
  origin?: string;
}

export type KeyframeMap = Record<string, Keyframe[]>;

/** tolerância para considerar o playhead "em cima" de um keyframe (100 ms) */
export const KF_EPS = 0.1;

export const DEFAULT_INFLUENCE = 33.33;

export const defaultTangent = (): TangentSpeed => ({ x: 0, y: 0, influence: DEFAULT_INFLUENCE });

export const EASINGS: { id: Easing; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "ease-in", label: "Ease in" },
  { id: "ease-out", label: "Ease out" },
  { id: "ease-in-out", label: "Ease in-out" },
  { id: "hold", label: "Hold (sem interpolação)" },
  { id: "custom", label: "Bezier personalizado" },
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
    case "custom":
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

/* ------------------------------------------------------------------ *
 * Curvas de Bezier com tangentes controláveis
 * ------------------------------------------------------------------ */

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function bez(p0: number, p1: number, p2: number, p3: number, t: number) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function bezDeriv(p0: number, p1: number, p2: number, p3: number, t: number) {
  const u = 1 - t;
  return 3 * u * u * (p1 - p0) + 6 * u * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

/** Resolve t para um x conhecido numa curva x(t) com p0=0 e p3=1. */
function solveT(x1: number, x2: number, x: number) {
  let t = x;
  for (let i = 0; i < 10; i++) {
    const err = bez(0, x1, x2, 1, t) - x;
    if (Math.abs(err) < 1e-5) break;
    const d = bezDeriv(0, x1, x2, 1, t);
    if (Math.abs(d) < 1e-6) break;
    t = clamp(t - err / d, 0, 1);
  }
  return t;
}

/**
 * Progresso interpolado entre dois keyframes usando as tangentes de
 * saída de `a` e de entrada de `b`, ponderadas pela influência.
 */
export function bezierProgress(
  a: Keyframe,
  b: Keyframe,
  rawP: number,
  dim: "x" | "y" = "x",
): number {
  const av = dim === "y" && isPoint(a.value) ? a.value.y : isPoint(a.value) ? a.value.x : a.value;
  const bv = dim === "y" && isPoint(b.value) ? b.value.y : isPoint(b.value) ? b.value.x : b.value;
  const dt = Math.max(1e-4, b.time - a.time);
  const dv = bv - av;
  const out = a.outgoingSpeed ?? defaultTangent();
  const inc = b.incomingSpeed ?? defaultTangent();
  const ix = clamp(out.influence, 1, 100) / 100;
  const jx = clamp(inc.influence, 1, 100) / 100;
  const so = dim === "y" ? out.y : out.x;
  const si = dim === "y" ? inc.y : inc.x;
  const m1 = Math.abs(dv) > 1e-6 ? (so * dt) / dv : 0;
  const m2 = Math.abs(dv) > 1e-6 ? (si * dt) / dv : 0;
  const x1 = ix;
  const y1 = m1 * ix;
  const x2 = 1 - jx;
  const y2 = 1 - m2 * jx;
  const t = solveT(x1, x2, clamp(rawP, 0, 1));
  return bez(0, y1, y2, 1, t);
}

function segmentValue(a: Keyframe, b: Keyframe, rawP: number): KeyValue {
  if (a.easing === "hold") return a.value;
  const custom = a.easing === "custom" || b.easing === "custom";
  if (!custom) return lerpValue(a.value, b.value, ease(a.easing, rawP));
  if (isPoint(a.value) && isPoint(b.value)) {
    const px = bezierProgress(a, b, rawP, "x");
    const py = bezierProgress(a, b, rawP, "y");
    return {
      x: a.value.x + (b.value.x - a.value.x) * px,
      y: a.value.y + (b.value.y - a.value.y) * py,
    };
  }
  return lerpValue(a.value, b.value, bezierProgress(a, b, rawP, "x"));
}

export function sortKeys(keys: Keyframe[]): Keyframe[] {
  return [...keys].sort((a, b) => a.time - b.time);
}

/** Aplica a regra "contínuo": saída espelha a entrada. */
export function applyContinuity(k: Keyframe): Keyframe {
  if (!k.continuous || !k.incomingSpeed) return k;
  return { ...k, outgoingSpeed: { ...k.incomingSpeed } };
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
      return segmentValue(a, b, raw);
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
  return sortKeys([...keys, newKeyframe(time, value, easing)]);
}

export function newKeyframe(time: number, value: KeyValue, easing: Easing = "ease-in-out"): Keyframe {
  return {
    id: kfid(),
    time: Math.max(0, time),
    value,
    easing,
    incomingSpeed: defaultTangent(),
    outgoingSpeed: defaultTangent(),
    continuous: false,
  };
}

/** Timecode HH:MM:SS:FF (30 fps) usado no rodapé do modal de velocidade. */
export function timecode(seconds: number, fps = 30) {
  const t = Math.max(0, seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t - Math.floor(t)) * fps);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
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
    min: 0,
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
  blur: {
    key: "blur",
    label: "Desfoque",
    kind: "number",
    min: 0,
    max: 40,
    step: 0.5,
    get: (c) => c.blur ?? 0,
    set: (v) => ({ blur: num(v, 0) }),
  },
  reveal: {
    key: "reveal",
    label: "Revelação",
    kind: "number",
    min: 0,
    max: 1,
    step: 0.01,
    get: (c) => c.reveal ?? 1,
    set: (v) => ({ reveal: num(v, 1) }),
  },
  zoom: {
    key: "zoom",
    label: "Zoom",
    kind: "number",
    min: 1,
    max: 4,
    step: 0.05,
    get: (c) => c.zoom ?? 1,
    set: (v) => ({ zoom: num(v, 1) }),
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
  // clipe de áudio não tem imagem: só o volume é animável
  if (clip.type === "audio") return [P.volume];
  if (clip.type === "video") {
    return [
      P.position,
      P.scale,
      P.rotation,
      P.zoom,
      P.opacity,
      P.brightness,
      P.contrast,
      P.saturation,
      P.volume,
    ];
  }
  if (clip.type === "text") {
    return [P.position, P.opacity, P.scale, P.rotation, P.fontSize, P.blur, P.reveal];
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
    blur: 0,
    reveal: 1,
    zoom: 1,
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
