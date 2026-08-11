import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { Teleprompter } from "@/components/Teleprompter";

export const Route = createFileRoute("/mosaicos/teleprompter")({
  head: () => ({
    meta: [
      { title: "Teleprompter — Gravaai" },
      {
        name: "description",
        content:
          "Leia seu roteiro na tela enquanto grava: teleprompter com rolagem automática que não aparece no vídeo final.",
      },
      { property: "og:title", content: "Teleprompter — Gravaai" },
      {
        property: "og:description",
        content:
          "Roteiro rolando na tela durante a gravação, sem aparecer no MP4 exportado.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TeleprompterRoute,
});

function TeleprompterRoute() {
  return (
    <ClientOnly fallback={<div className="min-h-screen bg-[var(--background)]" />}>
      <Teleprompter />
    </ClientOnly>
  );
}
