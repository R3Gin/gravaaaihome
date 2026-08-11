import { Link } from "@tanstack/react-router";
import { Monitor, Scissors, FileText, Film, ArrowRight } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

type MosaicoHref =
  | "/slides-camera"
  | "/mosaicos/gdocs-presentation"
  | "/mosaicos/editor"
  | "/mosaicos/teleprompter"
  | "/mosaicos/video-para-gif";

interface MosaicoDef {
  title: string;
  description: string;
  href: MosaicoHref;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const mosaicos: MosaicoDef[] = [
  {
    title: "Apresentação + Câmera",
    description:
      "Suba um PDF ou PPTX, apresente com a bolha da webcam por cima e grave tudo em MP4.",
    href: "/mosaicos/gdocs-presentation",
    Icon: Monitor,
  },
  {
    title: "Editor Simplificado",
    description:
      "Edite sua gravação com timeline multi-faixas, textos e transições, direto no navegador.",
    href: "/mosaicos/editor",
    Icon: Scissors,
  },
  {
    title: "Teleprompter",
    description:
      "Leia seu roteiro na tela enquanto grava, sem aparecer no vídeo final.",
    href: "/mosaicos/teleprompter",
    Icon: FileText,
  },
  {
    title: "Vídeo para GIF",
    description:
      "Transforme um trecho da sua gravação em GIF, direto no navegador.",
    href: "/mosaicos/video-para-gif",
    Icon: Film,
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
        {mosaicos.map((m) => (
          <Link
            key={m.href}
            to={m.href}
            onClick={(event) => {
              event.preventDefault();
              openPopup(m.href);
            }}
            className="group relative flex flex-col items-start gap-2 rounded-xl border border-white/10 bg-[var(--surface)] p-4 pb-9 text-left transition-all hover:-translate-y-0.5 hover:border-white/20 hover:bg-[var(--surface-2)]"
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--brand)]/15 text-[var(--brand)]">
              <m.Icon className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold text-[var(--foreground)] group-hover:text-white">
              {m.title}
            </span>
            <span className="text-xs text-[var(--muted-foreground)]">{m.description}</span>
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)] transition-colors group-hover:text-[var(--brand)]">
              Abrir
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}