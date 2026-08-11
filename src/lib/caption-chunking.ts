import type { CaptionSegment, WordTiming } from "@/lib/captions";

export interface ChunkOptions {
  /** máximo de palavras por bloco */
  maxWords?: number;
  /** máximo de caracteres por bloco */
  maxChars?: number;
  /** pausa (ms) entre palavras que força a quebra do bloco */
  pauseThresholdMs?: number;
}

export type CaptionBlockSize = "curto" | "medio" | "longo";

/** presets do controle "Tamanho do bloco" no painel de legendas */
export const BLOCK_PRESETS: Record<CaptionBlockSize, Required<ChunkOptions>> = {
  curto: { maxWords: 4, maxChars: 22, pauseThresholdMs: 280 },
  medio: { maxWords: 6, maxChars: 32, pauseThresholdMs: 350 },
  longo: { maxWords: 10, maxChars: 56, pauseThresholdMs: 600 },
};

const STRONG_PUNCT = /[.!?…]["')\]]?$/;

/**
 * Reagrupa palavras com timing em blocos curtos (estilo CapCut/Reels).
 * Ordem de prioridade dos cortes: pausa real > limite de palavras >
 * limite de caracteres > pontuação forte.
 */
export function chunkCaptionWords(
  words: WordTiming[],
  options: ChunkOptions = {},
): CaptionSegment[] {
  const { maxWords, maxChars, pauseThresholdMs } = { ...BLOCK_PRESETS.medio, ...options };
  const pause = pauseThresholdMs / 1000;

  const clean = words
    .map((w) => ({ ...w, word: w.word.trim() }))
    .filter((w) => w.word.length > 0 && Number.isFinite(w.start) && Number.isFinite(w.end));

  const out: CaptionSegment[] = [];
  let buf: WordTiming[] = [];

  const flush = () => {
    if (!buf.length) return;
    const text = buf.map((w) => w.word).join(" ").replace(/\s+([,.!?…;:])/g, "$1");
    const start = buf[0].start;
    const end = Math.max(buf[buf.length - 1].end, start + 0.2);
    out.push({ start, end, text });
    buf = [];
  };

  for (let i = 0; i < clean.length; i++) {
    const w = clean[i];
    const prev = buf[buf.length - 1];

    // (a) pausa real antes desta palavra fecha o bloco anterior
    if (prev && w.start - prev.end > pause) flush();

    buf.push(w);
    const chars = buf.reduce((n, b) => n + b.word.length + 1, -1);

    // (b) palavras · (c) caracteres · (d) pontuação forte
    if (buf.length >= maxWords || chars >= maxChars || STRONG_PUNCT.test(w.word)) flush();
  }
  flush();

  return out.filter((s) => s.text.trim().length > 0 && s.end > s.start);
}

/**
 * Sem timing por palavra (modelo antigo/fallback): divide a frase em blocos
 * curtos distribuindo o tempo proporcionalmente ao tamanho das palavras.
 */
export function chunkSegmentsByText(
  segments: CaptionSegment[],
  options: ChunkOptions = {},
): CaptionSegment[] {
  const words: WordTiming[] = [];
  for (const seg of segments) {
    const parts = seg.text.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const totalChars = parts.reduce((n, p) => n + p.length, 0) || 1;
    const span = Math.max(0.2, seg.end - seg.start);
    let t = seg.start;
    for (const p of parts) {
      const dur = (p.length / totalChars) * span;
      words.push({ word: p, start: t, end: t + dur });
      t += dur;
    }
  }
  return chunkCaptionWords(words, options);
}
