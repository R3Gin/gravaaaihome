/**
 * Ganho de áudio do preview.
 *
 * O `volume` de um <audio>/<video> só vai de 0 a 1, mas o editor deixa subir
 * até 300%. Quando o ganho passa de 1, o elemento é ligado (uma única vez) a um
 * GainNode num AudioContext compartilhado. Os fades e os keyframes de volume
 * entram no mesmo cálculo, então o que se ouve no player é o que sai no arquivo.
 */
import type { Clip } from "@/state/editor-store";
import { resolveClip } from "@/lib/keyframes";

let ctx: AudioContext | null = null;
const routed = new WeakMap<HTMLMediaElement, GainNode>();

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  return ctx;
}

/** Chamar no clique de play: o navegador só libera o áudio após um gesto. */
export function resumePreviewAudio() {
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
}

/** Aplica um ganho (0 a 4) ao elemento, passando pelo Web Audio só se precisar. */
export function setElementGain(el: HTMLMediaElement, gain: number) {
  const g = Math.max(0, Math.min(4, Number.isFinite(gain) ? gain : 1));
  const node = routed.get(el);
  if (node) {
    if (Math.abs(node.gain.value - g) > 1e-3) node.gain.value = g;
    if (el.volume !== 1) el.volume = 1;
    return;
  }
  if (g <= 1) {
    if (Math.abs(el.volume - g) > 1e-3) el.volume = g;
    return;
  }
  const c = context();
  if (!c) {
    el.volume = 1;
    return;
  }
  try {
    const src = c.createMediaElementSource(el);
    const gainNode = c.createGain();
    gainNode.gain.value = g;
    src.connect(gainNode).connect(c.destination);
    routed.set(el, gainNode);
    el.volume = 1;
    resumePreviewAudio();
  } catch {
    el.volume = 1;
  }
}

/** Fator de fade in/out (0 a 1) de um clipe no tempo da timeline. */
export function fadeFactor(clip: Clip, time: number): number {
  const local = time - clip.startTime;
  const dur = clip.duration;
  let f = 1;
  const fin = Math.min(clip.fadeIn ?? 0, dur);
  const fout = Math.min(clip.fadeOut ?? 0, dur);
  if (fin > 0.01 && local < fin) f = Math.min(f, Math.max(0, local / fin));
  if (fout > 0.01 && local > dur - fout) f = Math.min(f, Math.max(0, (dur - local) / fout));
  return f;
}

/** Ganho final do clipe no instante: volume (com keyframes) × fades. */
export function clipGain(clip: Clip, time: number): number {
  if (clip.muted) return 0;
  const volume = resolveClip(clip, time).volume ?? 1;
  return Math.max(0, volume) * fadeFactor(clip, time);
}
