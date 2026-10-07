import { createFileRoute } from "@tanstack/react-router";
import { MeetingLogin } from "@/components/MeetingLogin";

export const Route = createFileRoute("/reunioes/entrar")({
  head: () => ({
    meta: [
      { title: "Entrar — Gravação de Reuniões | Gravaai" },
      {
        name: "description",
        content:
          "Entre na sua conta do Gravaai para mandar o bot gravar suas reuniões e gerar o resumo automático.",
      },
      // Página de login não deve aparecer nos resultados de busca.
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Entrar — Gravação de Reuniões | Gravaai" },
      { property: "og:url", content: "https://gravaai.online/reunioes/entrar" },
    ],
  }),
  component: MeetingLogin,
});
