import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { Wordmark } from "@/components/Brand";
import { ScreenRecorder } from "@/components/ScreenRecorder";
import { Mosaicos } from "@/components/Mosaicos";
import { InstallPwaButton } from "@/components/InstallPwaButton";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gravaai — Gravador de tela e editor de vídeo online" },
      {
        name: "description",
        content:
          "Grave a tela com webcam e microfone, edite na timeline e exporte em MP4 direto no navegador, sem instalar nada e sem upload.",
      },
      { property: "og:title", content: "Gravaai — Gravador de tela e editor de vídeo online" },
      {
        property: "og:description",
        content:
          "Gravação de tela, teleprompter, legendas automáticas e editor de vídeo — tudo no navegador.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://gravaai.online/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://gravaai.online/" }],
  }),
  component: Index,
});


function Index() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Wordmark />
          <div className="flex items-center gap-3">
            <ClientOnly fallback={null}>
              <InstallPwaButton />
            </ClientOnly>
            <a
              href="https://developer.mozilla.org/pt-BR/docs/Web/API/Screen_Capture_API"
              target="_blank"
              rel="noreferrer"
              className="hidden text-xs text-[var(--muted-foreground)] hover:text-white sm:block"
            >
              100% no navegador · sem upload
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <h1 className="sr-only">
          Gravaai — Gravador de tela e editor de vídeo online no navegador
        </h1>


        <ClientOnly fallback={<div className="aspect-video w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)]" />}>
          <ScreenRecorder />
        </ClientOnly>

        <Mosaicos />
      </main>

      <footer className="border-t border-[var(--border)] py-6 text-center text-xs text-[var(--muted-foreground)]">
        Copyright © 2026 Gravaai - Todos os direitos reservados.
      </footer>
    </div>
  );
}
