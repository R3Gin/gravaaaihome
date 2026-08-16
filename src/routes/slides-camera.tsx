import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { SlidesCamera } from "@/components/SlidesCamera";

export const Route = createFileRoute("/slides-camera")({
  head: () => ({
    meta: [
      { title: "Google Slides + Webcam — Gravaai" },
      {
        name: "description",
        content:
          "Abra uma apresentação do Google Slides com a bolha da webcam por cima e grave a aula ou demo direto no navegador.",
      },
      { property: "og:title", content: "Google Slides + Webcam — Gravaai" },
      {
        property: "og:description",
        content:
          "Apresentação do Google Slides com picture-in-picture da webcam, pronta para gravar.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://gravaai.online/slides-camera" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://gravaai.online/slides-camera" }],
  }),
  component: SlidesCameraRoute,
});


function SlidesCameraRoute() {
  return (
    <ClientOnly fallback={<div className="h-screen w-screen bg-black" />}>
      <SlidesCamera />
    </ClientOnly>
  );
}