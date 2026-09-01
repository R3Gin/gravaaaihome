import { useState, useCallback, useEffect, useRef } from "react";
import { MessageSquare, X, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const WEBHOOK_URL = "https://SEU_WEBHOOK_AQUI";

interface FeedbackForm {
  message: string;
  name: string;
  email: string;
}

type SubmitStatus = "idle" | "loading" | "success" | "error";

export function FeedbackButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState<FeedbackForm>({ message: "", name: "", email: "" });
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resetForm = useCallback(() => {
    setForm({ message: "", name: "", email: "" });
    setStatus("idle");
    setError(null);
  }, []);

  const handleOpen = useCallback(() => {
    resetForm();
    setIsOpen(true);
  }, [resetForm]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const message = form.message.trim();
    if (!message) {
      setError("Descreva sua sugestão ou bug para enviar.");
      return;
    }

    const email = form.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Informe um e-mail válido ou deixe o campo vazio.");
      return;
    }

    setStatus("loading");

    const payload = {
      message,
      name: form.name.trim() || null,
      email: email || null,
      timestamp: new Date().toISOString(),
    };

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setStatus("success");
      closeTimerRef.current = window.setTimeout(() => {
        handleClose();
      }, 2500);
    } catch {
      setStatus("error");
      setError("Não foi possível enviar. Tente novamente em instantes.");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Enviar sugestão ou reportar bug"
        className={cn(
          "fixed bottom-5 right-5 z-[100] flex h-12 w-12 items-center justify-center rounded-full",
          "bg-[var(--brand)] text-white shadow-[0_8px_24px_-6px_rgba(232,76,61,0.45)]",
          "transition-all duration-200 ease-out hover:scale-110 hover:shadow-[0_12px_32px_-6px_rgba(232,76,61,0.55)]",
          "active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
        )}
      >
        <MessageSquare className="h-5 w-5" />
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[101] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-title"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={status === "loading" ? undefined : handleClose}
          />

          <div
            className={cn(
              "relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10",
              "bg-[rgba(30,30,30,0.72)] backdrop-blur-xl shadow-[0_24px_64px_-16px_rgba(0,0,0,0.6)]",
              "text-[var(--foreground)]"
            )}
          >
            <button
              type="button"
              onClick={handleClose}
              disabled={status === "loading"}
              aria-label="Fechar"
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="p-6">
              <h2
                id="feedback-title"
                className="pr-8 text-lg font-semibold tracking-tight text-white"
              >
                Sugestão ou Bug
              </h2>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Conte o que aconteceu ou mande sua ideia. Sua mensagem ajuda a melhorar o Gravaai.
              </p>

              {status === "success" ? (
                <div className="mt-6 flex flex-col items-center justify-center gap-3 py-6 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--success)]/15 text-[var(--success)]">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <p className="text-base font-medium text-white">Obrigado!</p>
                  <p className="text-sm text-[var(--muted-foreground)]">
                    Sua mensagem foi enviada.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                  <div>
                    <label htmlFor="feedback-message" className="sr-only">
                      Mensagem
                    </label>
                    <textarea
                      id="feedback-message"
                      ref={textareaRef}
                      value={form.message}
                      onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                      placeholder="Descreva o bug ou sua sugestão..."
                      rows={5}
                      className={cn(
                        "w-full resize-none rounded-xl border bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/35",
                        "focus:border-white/30 focus:outline-none focus:ring-1 focus:ring-white/20",
                        error
                          ? "border-[var(--destructive)] ring-1 ring-[var(--destructive)]"
                          : "border-white/10"
                      )}
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="feedback-name" className="sr-only">
                        Nome
                      </label>
                      <input
                        id="feedback-name"
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="Nome (opcional)"
                        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-[var(--brand)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
                      />
                    </div>
                    <div>
                      <label htmlFor="feedback-email" className="sr-only">
                        E-mail
                      </label>
                      <input
                        id="feedback-email"
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        placeholder="E-mail (opcional, caso queira retorno)"
                        className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-[var(--brand)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 rounded-lg bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={status === "loading"}
                    className={cn(
                      "w-full rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-all",
                      "bg-gradient-to-b from-[var(--brand)] to-[var(--brand-hover)]",
                      "shadow-[0_1px_0_rgba(255,255,255,0.15)_inset,0_6px_20px_-6px_rgba(232,76,61,0.45)]",
                      "hover:brightness-110 active:scale-[0.98]",
                      "disabled:cursor-not-allowed disabled:opacity-60"
                    )}
                  >
                    {status === "loading" ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Enviando...
                      </span>
                    ) : (
                      "Enviar"
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
