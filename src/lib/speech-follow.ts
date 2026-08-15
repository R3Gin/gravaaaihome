// Acompanhamento de fala para o Teleprompter.
// Tudo roda no navegador (SpeechRecognition nativo) — nenhum áudio sai daqui.

export interface ScriptSegment {
  index: number;
  text: string;
  /** Índice da primeira palavra do segmento no array global de palavras. */
  start: number;
  /** Índice (exclusivo) da última palavra do segmento. */
  end: number;
}

export interface ScriptModel {
  segments: ScriptSegment[];
  /** Palavras normalizadas de todo o roteiro, na ordem. */
  words: string[];
}

const MAX_WORDS_PER_SEGMENT = 14;

export function normalizeWord(w: string) {
  return w
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Quebra o roteiro em frases curtas (pontuação + limite de palavras). */
export function buildScriptModel(script: string): ScriptModel {
  const raw = script.replace(/\s+/g, " ").trim();
  if (!raw) return { segments: [], words: [] };

  const sentences = raw.match(/[^.!?;:\n]+[.!?;:]*/g) ?? [raw];
  const segments: ScriptSegment[] = [];
  const words: string[] = [];

  const push = (text: string) => {
    const tokens = text.trim().split(/\s+/).filter(Boolean);
    const normalized = tokens.map(normalizeWord).filter(Boolean);
    if (!normalized.length) return;
    const start = words.length;
    words.push(...normalized);
    segments.push({
      index: segments.length,
      text: text.trim(),
      start,
      end: words.length,
    });
  };

  for (const sentence of sentences) {
    const tokens = sentence.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    if (tokens.length <= MAX_WORDS_PER_SEGMENT) {
      push(sentence);
      continue;
    }
    for (let i = 0; i < tokens.length; i += MAX_WORDS_PER_SEGMENT) {
      push(tokens.slice(i, i + MAX_WORDS_PER_SEGMENT).join(" "));
    }
  }
  return { segments, words };
}

/** Distância de edição limitada — barata o suficiente para palavras curtas. */
function closeEnough(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length < 4 || b.length < 4) return false;
  // Levenshtein <= 1
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++diff > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  if (i < a.length || j < b.length) diff++;
  return diff <= 1;
}

/** Quantas palavras à frente do cursor podemos procurar (evita saltos grandes). */
const LOOKAHEAD = 12;

/**
 * Avança o cursor de palavras do roteiro com base nas palavras reconhecidas.
 * Retorna o novo cursor. Só olha uma janela curta à frente, então uma palavra
 * repetida lá na frente nunca provoca um salto.
 */
export function advanceCursor(
  scriptWords: string[],
  cursor: number,
  spokenWords: string[],
): number {
  let pos = Math.max(0, Math.min(cursor, scriptWords.length));
  for (const spoken of spokenWords) {
    if (!spoken) continue;
    if (pos >= scriptWords.length) break;
    const limit = Math.min(scriptWords.length, pos + LOOKAHEAD);
    for (let i = pos; i < limit; i++) {
      const target = scriptWords[i]!;
      if (target === spoken || closeEnough(target, spoken)) {
        pos = i + 1;
        break;
      }
    }
  }
  return pos;
}

/** Segmento atual a partir do cursor de palavras. */
export function segmentAtCursor(segments: ScriptSegment[], cursor: number) {
  if (!segments.length) return 0;
  for (let i = 0; i < segments.length; i++) {
    if (cursor < segments[i]!.end) return i;
  }
  return segments.length - 1;
}

export function supportsSpeechRecognition() {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as unknown as Record<string, unknown>)["SpeechRecognition"] ||
      (window as unknown as Record<string, unknown>)["webkitSpeechRecognition"],
  );
}

/** Normaliza um texto inteiro em palavras comparáveis. */
export function normalizeText(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Razão de subsequência comum (0..1) entre fala e trecho do roteiro. */
function lcsRatio(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const dp: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] =
        a[i - 1] === b[j - 1] || closeEnough(a[i - 1]!, b[j - 1]!)
          ? prev + 1
          : Math.max(dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[b.length]! / Math.min(a.length, b.length);
}

export interface AlignResult {
  cursor: number;
  score: number;
  matched: boolean;
}

/** Janela de busca à frente do cursor (em palavras). */
const FORWARD_WINDOW = 30;
/** Quanto podemos voltar (o usuário pode repetir uma palavra). */
const BACK_WINDOW = 6;

/**
 * Ancora a fala recente no roteiro comparando o SUFIXO do que foi falado com
 * as palavras que terminam em cada posição candidata, dentro de uma janela
 * curta ao redor do cursor. Isso permite avançar vários segmentos de uma vez
 * sem nunca saltar para uma frase repetida distante.
 */
export function alignCursor(
  scriptWords: string[],
  cursor: number,
  spokenTail: string[],
  threshold = 0.6,
): AlignResult {
  if (!scriptWords.length || !spokenTail.length) {
    return { cursor, score: 0, matched: false };
  }
  const from = Math.max(1, cursor - BACK_WINDOW);
  const to = Math.min(scriptWords.length, cursor + FORWARD_WINDOW);
  let best: AlignResult = { cursor, score: 0, matched: false };

  for (const w of [8, 5, 3]) {
    const tail = spokenTail.slice(-w);
    if (!tail.length) continue;
    for (let end = from; end <= to; end++) {
      const n = Math.min(tail.length + 2, end);
      const slice = scriptWords.slice(end - n, end);
      // LCS tolera palavras a mais/a menos do reconhecedor (inserções e omissões).
      const score = lcsRatio(tail, slice);
      if (score < threshold) continue;
      // Prefere maior score; em empate, a posição mais à frente.
      if (score > best.score + 0.001 || (Math.abs(score - best.score) <= 0.001 && end > best.cursor)) {
        best = { cursor: end, score, matched: true };
      }
    }
    if (best.matched) break;
  }
  return best;
}
