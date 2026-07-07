import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { SlidesCamera } from "@/components/SlidesCamera";

export const Route = createFileRoute("/slides-camera")({
  head: () => ({
    meta: [
      { title: "Apresentação + Câmera — Gravaai" },
      { name: "description", content: "Slides do Google com picture-in-picture da webcam, pronto para ser gravado." },
    ],
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