/**
 * Prepara o áudio para o Whisper gastar tempo só com fala:
 * - remove os silêncios longos (o modelo não precisa "ouvir" pausas);
 * - divide o resultado em partes, cortando nos pontos mais quietos, para
 *   transcrever em paralelo quando o navegador roda na CPU.
 * Os tempos devolvidos pelo modelo são convertidos de volta com `toSource`.
 */

const RATE = 16000;
const FRAME = 320; // 20 ms

/** trecho mantido: `len` amostras que saem de `src` e vão para `dst` */
interface Piece {
  src: number;
  dst: number;
  len: number;
}

export interface CompactAudio {
  audio: Float32Array;
  pieces: Piece[];
}

function frameRms(audio: Float32Array) {
  const n = Math.floor(audio.length / FRAME);
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let sum = 0;
    const base = f * FRAME;
    for (let i = 0; i < FRAME; i++) {
      const v = audio[base + i]!;
      sum += v * v;
    }
    out[f] = Math.sqrt(sum / FRAME);
  }
  return out;
}

function percentile(values: Float32Array, p: number) {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

/**
 * Tira silêncios de 1,2 s ou mais, deixando 0,4 s de folga de cada lado para
 * não cortar começo nem fim de palavra. Se quase não houver silêncio, devolve
 * o áudio como está.
 */
export function compactSilence(audio: Float32Array): CompactAudio {
  const whole: CompactAudio = { audio, pieces: [{ src: 0, dst: 0, len: audio.length }] };
  const rms = frameRms(audio);
  if (rms.length < 100) return whole;

  // limiar relativo ao próprio áudio: acima do ruído de fundo, bem abaixo da voz
  const floor = percentile(rms, 0.1);
  const loud = percentile(rms, 0.9);
  const threshold = Math.min(loud * 0.25, Math.max(0.0035, floor * 2, loud * 0.08));

  const minGap = Math.round(1.2 / 0.02);
  const pad = Math.round(0.4 / 0.02);

  const keep: { start: number; end: number }[] = []; // em frames
  let cursor = 0;
  let f = 0;
  while (f < rms.length) {
    if (rms[f]! >= threshold) {
      f++;
      continue;
    }
    let g = f;
    while (g < rms.length && rms[g]! < threshold) g++;
    if (g - f >= minGap) {
      const cutStart = f + pad;
      const cutEnd = g === rms.length ? g : g - pad;
      if (cutStart > cursor) keep.push({ start: cursor, end: cutStart });
      cursor = cutEnd;
    }
    f = g;
  }
  const totalFrames = Math.ceil(audio.length / FRAME);
  if (cursor < totalFrames) keep.push({ start: cursor, end: totalFrames });

  const pieces: Piece[] = [];
  let dst = 0;
  for (const k of keep) {
    const src = k.start * FRAME;
    const len = Math.min(audio.length, k.end * FRAME) - src;
    if (len <= 0) continue;
    pieces.push({ src, dst, len });
    dst += len;
  }
  // economia pequena não compensa mexer nos tempos
  if (pieces.length === 0 || dst > audio.length * 0.9) return whole;

  const out = new Float32Array(dst);
  for (const p of pieces) out.set(audio.subarray(p.src, p.src + p.len), p.dst);
  return { audio: out, pieces };
}

/**
 * Converte um tempo (s) do áudio compactado para o áudio original. Um fim
 * que cai exatamente numa emenda fica no trecho anterior (antes da pausa).
 */
export function toSource(pieces: Piece[], seconds: number, isEnd = false) {
  const t = seconds * RATE;
  let hit = pieces[0]!;
  for (const p of pieces) {
    if (isEnd ? p.dst >= t : p.dst > t) break;
    hit = p;
  }
  const inside = Math.min(Math.max(0, t - hit.dst), hit.len);
  return (hit.src + inside) / RATE;
}

export interface AudioPart {
  /** início da parte dentro do áudio compactado (s) */
  offset: number;
  audio: Float32Array;
}

/**
 * Divide em `n` partes de tamanho parecido, cortando no trecho de 0,3 s mais
 * quieto a até 8 s de cada ponto ideal (evita cortar palavra no meio).
 */
export function splitAudio(audio: Float32Array, n: number): AudioPart[] {
  if (n <= 1) return [{ offset: 0, audio }];
  const rms = frameRms(audio);
  const win = 15; // 0,3 s
  const search = Math.round(8 / 0.02);
  const cuts: number[] = [0];
  for (let k = 1; k < n; k++) {
    const ideal = Math.round((rms.length * k) / n);
    let best = ideal;
    let bestEnergy = Infinity;
    for (
      let f = Math.max(cuts[cuts.length - 1]! + win, ideal - search);
      f < Math.min(rms.length - win, ideal + search);
      f++
    ) {
      let e = 0;
      for (let i = 0; i < win; i++) e += rms[f + i]!;
      if (e < bestEnergy) {
        bestEnergy = e;
        best = f + Math.floor(win / 2);
      }
    }
    cuts.push(best * FRAME);
  }
  cuts.push(audio.length);
  const parts: AudioPart[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i]!;
    const b = cuts[i + 1]!;
    if (b > a) parts.push({ offset: a / RATE, audio: audio.slice(a, b) });
  }
  return parts;
}
