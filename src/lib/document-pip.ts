// Utilitários compartilhados para abrir janelas reais do SO com a
// Document Picture-in-Picture API. Conteúdo renderizado nessas janelas vive
// fora do documento do app — logo, nunca é capturado por getDisplayMedia
// quando o usuário compartilha a aba/janela do Gravaai.

export type PipWindow = Window & { document: Document };

export function supportsDocumentPip() {
  return (
    typeof window !== "undefined" &&
    "documentPictureInPicture" in window &&
    // @ts-expect-error - API experimental
    typeof window.documentPictureInPicture?.requestWindow === "function"
  );
}

/** Copia as folhas de estilo do app para o documento da janela PiP. */
export function copyStylesInto(target: Document) {
  document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    target.head.appendChild(node.cloneNode(true));
  });
  const inline = document.documentElement.getAttribute("style") ?? "";
  const bg =
    getComputedStyle(document.documentElement).getPropertyValue("--background").trim() ||
    "#0b0b0b";
  target.documentElement.setAttribute(
    "style",
    `${inline};margin:0;padding:0;height:100%;background:${bg};`,
  );
  target.body.setAttribute(
    "style",
    `margin:0;padding:0;height:100%;width:100%;background:${bg};color-scheme:dark;`,
  );
}

export async function openPipWindow(
  options: { width: number; height: number } = { width: 520, height: 420 },
): Promise<PipWindow | null> {
  if (!supportsDocumentPip()) return null;
  try {
    // @ts-expect-error - API experimental
    const w: PipWindow = await window.documentPictureInPicture.requestWindow({
      ...options,
      disallowReturnToOpener: true,
      preferInitialWindowPlacement: true,
    });
    copyStylesInto(w.document);
    return w;
  } catch (err) {
    console.warn("[document-pip] janela recusada:", err);
    return null;
  }
}
