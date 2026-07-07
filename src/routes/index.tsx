import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { Wordmark } from "@/components/Brand";
import { ScreenRecorder } from "@/components/ScreenRecorder";
import { Mosaicos } from "@/components/Mosaicos";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Wordmark />
          <a
            href="https://developer.mozilla.org/pt-BR/docs/Web/API/Screen_Capture_API"
            target="_blank"
            rel="noreferrer"
            className="hidden text-xs text-[var(--muted-foreground)] hover:text-white sm:block"
          >
            100% no navegador · sem upload
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <div className="mb-8 max-w-2xl">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">
            Grave a sua tela<br className="hidden sm:inline" /> e baixe em MP4.
          </h1>
          <p className="mt-3 text-sm text-[var(--muted-foreground)] sm:text-base">
            Escolha a tela, janela ou aba, misture o áudio do sistema com o microfone e exporte
            direto do navegador. Nenhum arquivo sai do seu dispositivo.
          </p>
        </div>

        <ClientOnly fallback={<div className="aspect-video w-full rounded-2xl border border-[var(--border)] bg-[var(--surface)]" />}>
          <ScreenRecorder />
        </ClientOnly>

        <Mosaicos />
      </main>

      <footer className="border-t border-[var(--border)] py-6 text-center text-xs text-[var(--muted-foreground)]">
        Gravaai · feito para gravar rápido e sem instalar nada.
      </footer>
    </div>
  );
}
