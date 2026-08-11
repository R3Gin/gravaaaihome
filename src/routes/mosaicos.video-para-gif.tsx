import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { VideoToGif } from "@/components/VideoToGif";

export const Route = createFileRoute("/mosaicos/video-para-gif")({
  head: () => ({
    meta: [
      { title: "Vídeo para GIF — Gravaai" },
      {
        name: "description",
        content:
          "Selecione um trecho de até 15s da sua gravação e exporte como GIF animado, 100% no navegador.",
      },
      { property: "og:title", content: "Vídeo para GIF — Gravaai" },
      {
        property: "og:description",
        content: "Transforme um trecho da sua gravação em GIF, sem upload e sem instalar nada.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VideoToGifRoute,
});

function VideoToGifRoute() {
  return (
    <ClientOnly fallback={<div className="min-h-screen bg-[var(--background)]" />}>
      <VideoToGif />
    </ClientOnly>
  );
}
