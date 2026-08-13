import { useEffect, useState } from "react";
import { PictureInPicture2 } from "lucide-react";
import { InstallPwaButton } from "./InstallPwaButton";

/**
 * O Auto Picture-in-Picture (barra flutuante que aparece sozinha ao sair da
 * aba) só é liberado pelo Chrome/Edge quando o Gravaai está INSTALADO como
 * app. Em aba comum a gravação funciona igual — só sem essa automação.
 */
export function AutoPipNotice() {
  const [state, setState] = useState<"hidden" | "install" | "unsupported">("hidden");

  useEffect(() => {
    const supported =
      "documentPictureInPicture" in window &&
      "mediaSession" in navigator;
    if (!supported) {
      setState("unsupported");
      return;
    }
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS/Safari legado
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setState(installed ? "hidden" : "install");
  }, []);

  if (state === "hidden") return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-white/[0.03] px-4 py-3 text-xs text-[var(--muted-foreground)]">
      <PictureInPicture2 className="h-4 w-4 shrink-0 text-[var(--brand)]" />
      {state === "unsupported" ? (
        <span>
          Neste navegador a barra flutuante de controles não está disponível. Use o Chrome
          ou o Edge para tê-la durante a gravação.
        </span>
      ) : (
        <>
          <span className="flex-1 min-w-[220px]">
            Instale o Gravaai como app para a barra de controles aparecer sozinha quando você
            sair da aba (e sumir quando voltar). Na primeira vez o Chrome pede permissão.
          </span>
          <InstallPwaButton />
        </>
      )}
    </div>
  );
}
