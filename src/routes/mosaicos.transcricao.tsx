import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { TranscriptionTool } from "@/components/TranscriptionTool";

export const Route = createFileRoute("/mosaicos/transcricao")({
  head: () => ({
    meta: [
      { title: "Transcrição e Resumo — Gravaai" },
      {
        name: "description",
        content:
          "Transcreva o áudio da sua gravação no próprio navegador e gere um resumo automático em poucos parágrafos.",
      },
      { property: "og:title", content: "Transcrição e Resumo — Gravaai" },
      {
        property: "og:description",
        content: "Transforme sua gravação em texto com timestamps e gere um resumo automático.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TranscricaoRoute,
});

function TranscricaoRoute() {
  return (
    <ClientOnly fallback={<div className="min-h-screen bg-[var(--background)]" />}>
      <TranscriptionTool />
    </ClientOnly>
  );
}
