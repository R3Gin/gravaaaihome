// Passa a gravação recém-feita para o Mosaico "Vídeo para GIF" sem upload manual.
// Guarda o blob em memória (mesma aba) — a ferramenta consome uma única vez.

interface Handoff {
  blob: Blob;
  name: string;
}

let pending: Handoff | null = null;

export function setGifHandoff(blob: Blob, name = "gravacao.mp4") {
  pending = { blob, name };
}

export function takeGifHandoff(): Handoff | null {
  const value = pending;
  pending = null;
  return value;
}

export function hasGifHandoff() {
  return pending !== null;
}
