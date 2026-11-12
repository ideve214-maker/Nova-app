import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { mediaUrl } from "@/lib/admin/media";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function StarMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M32 3c1.2 14 7 20.2 22 22.4C39 27.6 33.2 34 32 48 30.8 34 25 27.6 10 25.4 25 23.2 30.8 17 32 3z"
      />
    </svg>
  );
}

export function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="nova-frame bg-stage text-fg">
      <div className="nova-frame relative mx-auto flex w-full max-w-[430px] flex-col bg-bg shadow-card">
        {children}
      </div>
    </div>
  );
}

export function TopBar({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
      {onBack ? (
        <button type="button" onClick={onBack} className="grid size-11 place-items-center rounded-full" aria-label="返回">
          <ChevronLeft className="size-6" />
        </button>
      ) : (
        <span className="w-2" />
      )}
      <h1 className={cn("min-w-0 flex-1 truncate font-semibold", onBack ? "text-center text-lg" : "text-xl")}>
        {title}
      </h1>
      <div className="flex w-11 items-center justify-end">{right}</div>
    </header>
  );
}

export function Screen({
  title,
  onBack,
  right,
  footer,
  children,
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <TopBar title={title} onBack={onBack} right={right} />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer}
    </section>
  );
}

export function Seg({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex border-b border-line bg-surface">
      {options.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            "relative h-11 flex-1 text-sm font-semibold",
            value === item.id ? "text-primary" : "text-muted",
          )}
        >
          {item.label}
          {value === item.id && (
            <span className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-primary" />
          )}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ src, name, className }: { src?: string; name: string; className?: string }) {
  if (src) {
    return <img src={mediaUrl(src) || src} alt="" className={cn("rounded-full object-cover", className)} />;
  }
  return (
    <span
      className={cn(
        "grid place-items-center rounded-full bg-primary font-semibold text-on-primary",
        className,
      )}
    >
      {name.slice(0, 1)}
    </span>
  );
}

export function Pill({
  tone,
  children,
}: {
  tone: "ok" | "muted" | "danger" | "vip" | "warn";
  children: ReactNode;
}) {
  const toneClass = {
    ok: "nova-ok-soft",
    muted: "bg-subtle text-muted",
    danger: "nova-danger-soft",
    vip: "nova-vip-soft",
    warn: "nova-warn-soft",
  }[tone];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold", toneClass)}>
      {children}
    </span>
  );
}

export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-ink/40" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85dvh] w-full max-w-[430px] overflow-y-auto rounded-t-3xl bg-surface p-4 pb-safe shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="h-10 px-2 text-sm text-muted">
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm text-muted">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "h-11 w-full rounded-2xl border border-line bg-subtle px-3 text-base outline-none focus:border-primary";

export function PrimaryButton({
  children,
  onClick,
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="h-11 w-full rounded-full bg-primary font-semibold text-on-primary disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function RowLink({
  icon,
  title,
  desc,
  onClick,
  extra,
}: {
  icon: ReactNode;
  title: string;
  desc?: string;
  onClick?: () => void;
  extra?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 border-b border-line bg-surface px-4 py-3 text-left last:border-b-0"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl nova-soft">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        {desc && <span className="block truncate text-sm text-muted">{desc}</span>}
      </span>
      {extra}
    </button>
  );
}
