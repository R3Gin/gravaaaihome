import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { ArrowLeft, Eye, EyeOff, Info, Users, Video } from "lucide-react";
import { Wordmark } from "@/components/Brand";

/**
 * Tela de login da Gravação de Reuniões.
 *
 * Ainda não há autenticação: os formulários validam os campos, mas nada é
 * enviado a nenhum servidor. Ao entrar, criar conta ou clicar em "Continuar
 * com Google", a pessoa segue para o bot de reuniões (`BOT_URL`). A
 * redefinição de senha só mostra um aviso. Quando a autenticação existir,
 * basta trocar `goToBot` e `showNotYetAvailable` pelas chamadas reais.
 */

type Mode = "entrar" | "criar" | "recuperar";
type Field = "nome" | "email" | "senha";
type Errors = Partial<Record<Field, string>>;

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COPY: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  entrar: {
    title: "Entrar",
    subtitle: "Acesse a Gravação de Reuniões.",
    submit: "Entrar",
  },
  criar: {
    title: "Criar conta",
    subtitle: "Crie sua conta para usar a Gravação de Reuniões.",
    submit: "Criar conta",
  },
  recuperar: {
    title: "Redefinir senha",
    subtitle: "Informe seu e-mail e enviaremos um link para você criar uma nova senha.",
    submit: "Enviar link",
  },
};

/** Endereço do bot de reuniões, para onde a pessoa vai depois de entrar. */
const BOT_URL = "https://reunioes.gravaai.online";

const NOT_YET_AVAILABLE = "A redefinição de senha por e-mail ainda não está disponível.";

function validate(mode: Mode, values: Record<Field, string>): Errors {
  const errors: Errors = {};
  const email = values.email.trim();

  if (mode === "criar" && !values.nome.trim()) {
    errors.nome = "Informe seu nome.";
  }

  if (!email) {
    errors.email = "Informe seu e-mail.";
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = "Digite um e-mail válido, como nome@exemplo.com.";
  }

  if (mode === "entrar" && !values.senha) {
    errors.senha = "Informe sua senha.";
  }

  if (mode === "criar" && values.senha.length < MIN_PASSWORD_LENGTH) {
    errors.senha = `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }

  return errors;
}

const inputClass =
  "h-11 w-full rounded-lg border border-[var(--input)] bg-[var(--surface-2)] px-3 text-base text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] transition-colors focus-visible:border-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40 aria-[invalid=true]:border-[var(--brand)] sm:text-sm";

const linkButtonClass =
  "cursor-pointer rounded font-medium text-[var(--foreground)] underline-offset-4 hover:text-[var(--brand)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60";

export function MeetingLogin() {
  const [mode, setMode] = useState<Mode>("entrar");
  const [values, setValues] = useState<Record<Field, string>>({
    nome: "",
    email: "",
    senha: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const nomeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const senhaRef = useRef<HTMLInputElement>(null);
  const refs: Record<Field, RefObject<HTMLInputElement | null>> = {
    nome: nomeRef,
    email: emailRef,
    senha: senhaRef,
  };

  // Ao trocar de modo (entrar, criar, recuperar), o botão clicado some da tela;
  // o foco vai para o primeiro campo para o teclado e o leitor de tela não se perderem.
  const focusFirstFieldRef = useRef(false);
  useEffect(() => {
    if (!focusFirstFieldRef.current) return;
    focusFirstFieldRef.current = false;
    (mode === "criar" ? nomeRef : emailRef).current?.focus();
  }, [mode]);

  const copy = COPY[mode];
  const showsPassword = mode !== "recuperar";

  function switchMode(next: Mode) {
    focusFirstFieldRef.current = true;
    setMode(next);
    setErrors({});
    setSubmitted(false);
    setNotice(null);
    setShowPassword(false);
    setValues((current) => ({ ...current, senha: "" }));
  }

  function updateField(field: Field, value: string) {
    const nextValues = { ...values, [field]: value };
    setValues(nextValues);
    // Depois da primeira tentativa, os erros acompanham o que a pessoa digita.
    if (submitted) setErrors(validate(mode, nextValues));
  }

  function showNotYetAvailable() {
    setNotice(NOT_YET_AVAILABLE);
  }

  function goToBot() {
    window.location.assign(BOT_URL);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    const nextErrors = validate(mode, values);
    setErrors(nextErrors);

    const order: Field[] = ["nome", "email", "senha"];
    const firstInvalid = order.find((field) => nextErrors[field]);
    if (firstInvalid) {
      setNotice(null);
      refs[firstInvalid].current?.focus();
      return;
    }

    if (mode === "recuperar") showNotYetAvailable();
    else goToBot();
  }

  const describedBy = (field: Field, extra?: string) =>
    [errors[field] ? `${field}-erro` : null, extra].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--border)] bg-black/40 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            to="/"
            aria-label="Gravaai — voltar para o início"
            className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60"
          >
            <Wordmark />
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Voltar para o início</span>
            <span className="sm:hidden">Início</span>
          </Link>
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center sm:py-16">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl shadow-black/40 sm:p-8">
            <div className="mb-6 flex items-center gap-3">
              <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--brand)]/15 text-[var(--brand)]">
                <Video className="h-5 w-5" aria-hidden />
                <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-[var(--surface-2)] text-[var(--brand)] ring-1 ring-[var(--border)]">
                  <Users className="h-2.5 w-2.5" aria-hidden />
                </span>
              </span>
              <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                Gravação de Reuniões
              </span>
            </div>

            <h1 className="font-display text-2xl font-bold tracking-tight">{copy.title}</h1>
            <p className="mt-1.5 text-sm text-[var(--muted-foreground)]">{copy.subtitle}</p>

            {mode !== "recuperar" && (
              <>
                <button
                  type="button"
                  onClick={goToBot}
                  className="mt-6 inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-lg border border-[var(--input)] bg-[var(--surface-2)] text-sm font-medium text-[var(--foreground)] transition-colors hover:border-white/25 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60"
                >
                  Continuar com Google
                </button>

                <div className="my-6 flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
                  <span className="h-px flex-1 bg-[var(--border)]" />
                  ou com e-mail
                  <span className="h-px flex-1 bg-[var(--border)]" />
                </div>
              </>
            )}

            <form
              noValidate
              onSubmit={handleSubmit}
              className={`flex flex-col gap-4 ${mode === "recuperar" ? "mt-6" : ""}`}
              aria-label={copy.title}
            >
              {mode === "criar" && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="nome" className="text-sm font-medium">
                    Nome
                  </label>
                  <input
                    ref={nomeRef}
                    id="nome"
                    name="nome"
                    type="text"
                    autoComplete="name"
                    value={values.nome}
                    onChange={(event) => updateField("nome", event.target.value)}
                    aria-invalid={errors.nome ? true : undefined}
                    aria-describedby={describedBy("nome")}
                    className={inputClass}
                    placeholder="Seu nome"
                  />
                  {errors.nome && (
                    <p id="nome-erro" className="text-xs text-[var(--brand)]">
                      {errors.nome}
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className="text-sm font-medium">
                  E-mail
                </label>
                <input
                  ref={emailRef}
                  id="email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={values.email}
                  onChange={(event) => updateField("email", event.target.value)}
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={describedBy("email")}
                  className={inputClass}
                  placeholder="nome@exemplo.com"
                />
                {errors.email && (
                  <p id="email-erro" className="text-xs text-[var(--brand)]">
                    {errors.email}
                  </p>
                )}
              </div>

              {showsPassword && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="senha" className="text-sm font-medium">
                      Senha
                    </label>
                    {mode === "entrar" && (
                      <button
                        type="button"
                        onClick={() => switchMode("recuperar")}
                        className={`text-xs ${linkButtonClass} text-[var(--muted-foreground)]`}
                      >
                        Esqueci minha senha
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      ref={senhaRef}
                      id="senha"
                      name="senha"
                      type={showPassword ? "text" : "password"}
                      autoComplete={mode === "criar" ? "new-password" : "current-password"}
                      value={values.senha}
                      onChange={(event) => updateField("senha", event.target.value)}
                      aria-invalid={errors.senha ? true : undefined}
                      aria-describedby={describedBy(
                        "senha",
                        mode === "criar" ? "senha-dica" : undefined,
                      )}
                      className={`${inputClass} pr-11`}
                      placeholder={mode === "criar" ? "Crie uma senha" : "Sua senha"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      aria-pressed={showPassword}
                      className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/60"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden />
                      )}
                    </button>
                  </div>
                  {mode === "criar" && !errors.senha && (
                    <p id="senha-dica" className="text-xs text-[var(--muted-foreground)]">
                      Use pelo menos {MIN_PASSWORD_LENGTH} caracteres.
                    </p>
                  )}
                  {errors.senha && (
                    <p id="senha-erro" className="text-xs text-[var(--brand)]">
                      {errors.senha}
                    </p>
                  )}
                </div>
              )}

              <button
                type="submit"
                className="mt-2 inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-[var(--brand)] text-sm font-semibold text-white transition-colors hover:bg-[var(--brand-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
              >
                {copy.submit}
              </button>
            </form>

            <div aria-live="polite" role="status">
              {notice && (
                <div className="mt-4 flex gap-2.5 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-[var(--foreground)]">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" aria-hidden />
                  <p>{notice}</p>
                </div>
              )}
            </div>

            <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
              {mode === "entrar" && (
                <>
                  Não tem conta?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("criar")}
                    className={linkButtonClass}
                  >
                    Criar conta
                  </button>
                </>
              )}
              {mode === "criar" && (
                <>
                  Já tem conta?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("entrar")}
                    className={linkButtonClass}
                  >
                    Entrar
                  </button>
                </>
              )}
              {mode === "recuperar" && (
                <>
                  Lembrou a senha?{" "}
                  <button
                    type="button"
                    onClick={() => switchMode("entrar")}
                    className={linkButtonClass}
                  >
                    Voltar para entrar
                  </button>
                </>
              )}
            </p>
          </div>

          <p className="mt-6 px-2 text-center text-xs leading-relaxed text-[var(--muted-foreground)]">
            O bot entra na chamada e grava nos servidores do Gravaai, por isso esta função pede
            conta. As outras ferramentas continuam sem conta e 100% no navegador.
          </p>
        </div>
      </main>

      <footer className="border-t border-[var(--border)] py-6 text-center text-xs text-[var(--muted-foreground)]">
        Copyright © 2026 Gravaai - Todos os direitos reservados.
      </footer>
    </div>
  );
}
