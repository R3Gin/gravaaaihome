import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { LocalPresentation } from "@/components/LocalPresentation";

export const Route = createFileRoute("/mosaicos/gdocs-presentation")({
  head: () => ({
    meta: [
      { title: "Apresentação + Câmera — Gravaai" },
      {
        name: "description",
        content:
          "Suba um PDF ou PPTX, apresente com a bolha da webcam por cima e grave tudo em MP4.",
      },
      { property: "og:title", content: "Apresentação + Câmera — Gravaai" },
      {
        property: "og:description",
        content:
          "Suba um PDF ou PPTX, apresente com a bolha da webcam por cima e grave tudo em MP4.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: GdocsPresentationRoute,
});

function GdocsPresentationRoute() {
  return (
    <ClientOnly fallback={<div className="h-screen w-screen bg-black" />}>
      <LocalPresentation />
    </ClientOnly>
  );
}
