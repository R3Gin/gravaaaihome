import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { VideoEditor } from "@/components/VideoEditor";

export const Route = createFileRoute("/mosaicos/editor")({
  head: () => ({
    meta: [
      { title: "Editor — Gravaai" },
      {
        name: "description",
        content:
          "Corte trechos, ajuste brilho, contraste e saturação e exporte sua gravação em MP4 direto no navegador.",
      },
      { property: "og:title", content: "Editor — Gravaai" },
      {
        property: "og:description",
        content:
          "Editor de vídeo local: corte, ajuste cores e exporte em MP4 sem upload.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EditorRoute,
});

function EditorRoute() {
  return (
    <ClientOnly fallback={<div className="min-h-screen bg-[var(--background)]" />}>
      <VideoEditor />
    </ClientOnly>
  );
}
