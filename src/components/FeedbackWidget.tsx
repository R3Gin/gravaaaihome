import { useEffect, useState } from "react";
import { MessageSquarePlus, X, Send, Loader2 } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * URL do webhook que recebe as sugestões/bugs.
 * Ajuste aqui quando o endpoint final estiver pronto.
 */
export const FEEDBACK_WEBHOOK_URL = "";

const feedbackSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome").max(100, "Nome muito longo"),
  email: z.string().trim().email("E-mail inválido").max(255, "E-mail muito longo"),
  type: z.enum(["bug", "sugestao"]),
  message: z
    .string()
    .trim()
    .min(10, "Descreva com pelo menos 10 caracteres")
    .max(2000, "Máximo de 2000 caracteres"),
});

type FeedbackForm = z.infer<typeof feedbackSchema>;

const emptyForm: FeedbackForm = { name: "", email: "", type: "bug", message: "" };

export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FeedbackForm>(emptyForm);
  const [errors, setErrors] = useState<Partial<Record<keyof FeedbackForm, string>>>({});
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const set = <K extends keyof FeedbackForm>(key: K, value: FeedbackForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = feedbackSchema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof FeedbackForm, string>> = {};
      for (const issue of parsed.error.issues) {
        next[issue.path[0] as keyof FeedbackForm] = issue.message;
      }
      setErrors(next);
      return;
    }

    setSending(true);
    try {
      if (FEEDBACK_WEBHOOK_URL) {
        await fetch(FEEDBACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...parsed.data,
            page: window.location.href,
            userAgent: navigator.userAgent,
            sentAt: new Date().toISOString(),
          }),
        });
      }
      toast.success("Obrigado! Recebemos sua mensagem.");
      setForm(emptyForm);
      setOpen(false);
    } catch {
      toast.error("Não foi possível enviar agora. Tente novamente.");
    } finally {
      setSending(false);
    }
  }

  const field =
    "w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] outline-none transition focus:border-[var(--brand)]";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Enviar sugestão ou reportar bug"
        className="fixed bottom-5 right-5 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--brand)] px-4 text-sm font-semibold text-white shadow-lg shadow-black/40 transition hover:bg-[var(--brand-hover)]"
      >
        <MessageSquarePlus className="h-5 w-5" />
        <span className="hidden sm:inline">Sugestão / Bug</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-md sm:items-center"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 p-5 shadow-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="feedback-title" className="font-display text-lg font-bold">
                  Sugestão ou bug
                </h2>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  Conte o que aconteceu ou o que você gostaria de ver por aqui.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="rounded-md p-1 text-[var(--muted-foreground)] transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {(["bug", "sugestao"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set("type", t)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm font-medium transition",
                      form.type === t
                        ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--foreground)]"
                        : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-foreground)] hover:text-white",
                    )}
                  >
                    {t === "bug" ? "Reportar bug" : "Sugestão"}
                  </button>
                ))}
              </div>

              <div>
                <label htmlFor="fb-name" className="mb-1 block text-xs text-[var(--muted-foreground)]">
                  Nome
                </label>
                <input
                  id="fb-name"
                  className={field}
                  value={form.name}
                  maxLength={100}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Seu nome"
                />
                {errors.name && <p className="mt-1 text-xs text-[var(--brand)]">{errors.name}</p>}
              </div>

              <div>
                <label htmlFor="fb-email" className="mb-1 block text-xs text-[var(--muted-foreground)]">
                  E-mail
                </label>
                <input
                  id="fb-email"
                  type="email"
                  className={field}
                  value={form.email}
                  maxLength={255}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="voce@email.com"
                />
                {errors.email && <p className="mt-1 text-xs text-[var(--brand)]">{errors.email}</p>}
              </div>

              <div>
                <label htmlFor="fb-msg" className="mb-1 block text-xs text-[var(--muted-foreground)]">
                  Mensagem
                </label>
                <textarea
                  id="fb-msg"
                  rows={4}
                  className={cn(field, "resize-none")}
                  value={form.message}
                  maxLength={2000}
                  onChange={(e) => set("message", e.target.value)}
                  placeholder="Descreva o bug ou a sugestão…"
                />
                <div className="mt-1 flex items-center justify-between">
                  {errors.message ? (
                    <p className="text-xs text-[var(--brand)]">{errors.message}</p>
                  ) : (
                    <span />
                  )}
                  <span className="text-[10px] text-[var(--muted-foreground)]">
                    {form.message.length}/2000
                  </span>
                </div>
              </div>

              <button
                type="submit"
                disabled={sending}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--brand)] text-sm font-semibold text-white transition hover:bg-[var(--brand-hover)] disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sending ? "Enviando…" : "Enviar"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
