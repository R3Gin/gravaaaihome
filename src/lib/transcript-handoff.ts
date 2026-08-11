// Passa a gravação recém-feita para o Mosaico "Transcrição e Resumo".
// Guarda o blob em memória (mesma aba) — a ferramenta consome uma única vez.

interface Handoff {
  blob: Blob;
  name: string;
}

let pending: Handoff | null = null;

export function setTranscriptHandoff(blob: Blob, name = "gravacao.mp4") {
  pending = { blob, name };
}

export function takeTranscriptHandoff(): Handoff | null {
  const value = pending;
  pending = null;
  return value;
}
