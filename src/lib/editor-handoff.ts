// Passa a gravação recém-feita para o editor sem upload manual.
// Guarda o blob em memória (mesma aba) — o editor consome uma única vez.

interface Handoff {
  blob: Blob;
  name: string;
}

let pending: Handoff | null = null;

export function setEditorHandoff(blob: Blob, name = "gravacao.mp4") {
  pending = { blob, name };
}

export function takeEditorHandoff(): Handoff | null {
  const value = pending;
  pending = null;
  return value;
}

export function hasEditorHandoff() {
  return pending !== null;
}
