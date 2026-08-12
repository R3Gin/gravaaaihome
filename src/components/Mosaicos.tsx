import { Link } from "@tanstack/react-router";
import { Monitor, Scissors, FileText, Film, FileSearch, ArrowRight, Video, Users } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

type MosaicoHref =
  | "/slides-camera"
  | "/mosaicos/gdocs-presentation"
  | "/mosaicos/editor"
  | "/mosaicos/teleprompter"
  | "/mosaicos/video-para-gif"
  | "/mosaicos/transcricao";

interface MosaicoDef {
  title: string;
  description: string;
  href: MosaicoHref | "";
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  active: boolean;
  redirectUrl?: string;
  badge?: string;
}


const mosaicos: MosaicoDef[] = [
  {
    title: "Apresentação + Câmera",
    description:
      "Suba um PDF ou PPTX, apresente com a bolha da webcam por cima e grave tudo em MP4.",
    href: "/mosaicos/gdocs-presentation",
    Icon: Monitor,
    active: true,
  },
  {
    title: "Editor Simplificado",
    description:
      "Edite sua gravação com timeline multi-faixas, textos e transições, direto no navegador.",
    href: "/mosaicos/editor",
    Icon: Scissors,
    active: true,
  },
  {
    title: "Teleprompter",
    description:
      "Leia seu roteiro na tela enquanto grava, sem aparecer no vídeo final.",
    href: "/mosaicos/teleprompter",
    Icon: FileText,
    active: true,
  },
  {
    title: "Vídeo para GIF",
    description:
      "Transforme um trecho da sua gravação em GIF, direto no navegador.",
    href: "/mosaicos/video-para-gif",
    Icon: Film,
    active: true,
  },
  {
    title: "Transcrição e Resumo",
    description:
      "Transforme sua gravação em texto e gere um resumo automático.",
    href: "/mosaicos/transcricao",
    Icon: FileSearch,
    active: true,
  },
  {
    title: "Gravação de Reuniões",
    description:
      "Um bot entra na sua chamada, grava e gera um resumo automático. Compatível com Google Meet, Zoom e Microsoft Teams.",
    href: "",
    Icon: Video,
    active: false,
    redirectUrl: "https://reunioes.gravaai.online",
    badge: "Em breve",
  },
];




function openPopup(href: string) {
  const isBig = href.startsWith("/mosaicos/");
  const w = isBig ? 1280 : 854;
  const h = isBig ? 800 : 480;
  const left = Math.max(0, (window.screen.availWidth - w) / 2);
  const top = Math.max(0, (window.screen.availHeight - h) / 2);
  window.open(
    href,
    `gravaai-${href}`,
    `popup=yes,width=${w},height=${h},left=${left},top=${top},noopener=no`,
  );
}

export function Mosaicos() {
  return (
    <section className="mt-16">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-display text-xl font-bold tracking-tight">Mosaicos</h2>
        <span className="text-xs text-[var(--muted-foreground)]">Mini-ferramentas para gravar</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mosaicos.map((m) => {
          const isDisabled = !m.active;
          const content = (
            <>
              {m.badge && (
                <span className="absolute right-3 top-3 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--foreground)]">
                  {m.badge}
                </span>
              )}
              <span className="relative grid h-9 w-9 place-items-center rounded-lg bg-[var(--brand)]/15 text-[var(--brand)]">
                <m.Icon className="h-5 w-5" />
                {m.title === "Gravação de Reuniões" && (
                  <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-[var(--surface-2)] text-[var(--brand)] ring-1 ring-[var(--border)]">
                    <Users className="h-2.5 w-2.5" />
                  </span>
                )}
              </span>
              <span className={`text-sm font-semibold ${isDisabled ? "text-[var(--muted-foreground)]" : "text-[var(--foreground)] group-hover:text-white"}`}>
                {m.title}
              </span>
              <span className="text-xs text-[var(--muted-foreground)]">{m.description}</span>
              {!isDisabled ? (
                <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)] transition-colors group-hover:text-[var(--brand)]">
                  Abrir
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              ) : (
                <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
                  Em breve
                </span>
              )}
            </>
          );

          return isDisabled ? (
            <div
              key={m.title}
              className="group relative flex flex-col items-start gap-2 rounded-xl border border-white/10 bg-[var(--surface)] p-4 pb-9 text-left opacity-60 transition-opacity hover:opacity-70"
              style={{ cursor: "not-allowed" }}
              aria-disabled="true"
            >
              {content}
            </div>
          ) : (
            <Link
              key={m.href}
              to={m.href}
              onClick={(event) => {
                event.preventDefault();
                openPopup(m.href);
              }}
              className="group relative flex flex-col items-start gap-2 rounded-xl border border-white/10 bg-[var(--surface)] p-4 pb-9 text-left transition-all hover:-translate-y-0.5 hover:border-white/20 hover:bg-[var(--surface-2)]"
            >
              {content}
            </Link>
          );
        })}
      </div>

    </section>
  );
}