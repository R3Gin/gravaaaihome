import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { GdocsPresentation } from "@/components/GdocsPresentation";

export const Route = createFileRoute("/mosaicos/gdocs-presentation")({
  head: () => ({
    meta: [
      { title: "Apresentação Google + Câmera — Gravaai" },
      {
        name: "description",
        content:
          "Grave slides do Google com bolha da webcam, efeitos de fundo e exporte em MP4.",
      },
    ],
  }),
  component: GdocsPresentationRoute,
});

function GdocsPresentationRoute() {
  return (
    <ClientOnly fallback={<div className="h-screen w-screen bg-black" />}>
      <GdocsPresentation />
    </ClientOnly>
  );
}