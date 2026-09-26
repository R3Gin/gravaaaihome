import type { AspectRatio } from "@/state/editor-store";

/** largura da coluna esquerda do editor: biblioteca em cima, nomes das faixas embaixo */
export const SIDE_W = 248;

export const ASPECTS: { id: AspectRatio; label: string; ratio: number }[] = [
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
  { id: "1:1", label: "1:1", ratio: 1 },
];
