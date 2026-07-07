export function Logo({ size = 28 }: { size?: number }) {
  return (
    <div
      className="grid place-items-center rounded-lg bg-[var(--brand)]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.55}
        height={size * 0.55}
        fill="white"
      >
        <path d="M8 5v14l11-7z" />
      </svg>
    </div>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <Logo />
      <div className="flex items-baseline gap-2">
        <span className="font-display text-2xl font-extrabold tracking-tight">
          Grava<span className="text-[var(--brand)]">ai</span>
        </span>
        <span className="rounded-md border border-[var(--brand)]/40 bg-[var(--brand)]/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--brand)]">
          Beta
        </span>
      </div>
    </div>
  );
}