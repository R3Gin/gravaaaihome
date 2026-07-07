import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "record" | "stop" | "download";

const tones: Record<Tone, string> = {
  neutral:
    "bg-[var(--surface-2)] text-[var(--foreground)] border border-[var(--border)] hover:border-white/20 hover:bg-white/[0.06]",
  record:
    "bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)]",
  stop:
    "bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)]",
  download:
    "bg-[var(--info)] text-white hover:brightness-110",
};

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  icon?: ReactNode;
}

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
  ({ tone = "neutral", icon, className, children, ...rest }, ref) => (
    <button
      ref={ref}
      {...rest}
      className={cn(
        "inline-flex h-[42px] items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-all",
        "disabled:cursor-not-allowed disabled:opacity-40",
        tones[tone],
        className,
      )}
    >
      {icon}
      <span>{children}</span>
    </button>
  ),
);
ActionButton.displayName = "ActionButton";