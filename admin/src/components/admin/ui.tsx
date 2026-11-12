import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { mediaUrl } from "@/lib/admin/media";
import { useAdmin } from "@/lib/admin/store";

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
      <div className="nova-frame relative mx-auto flex w-full max-w-[430px] flex-col overflow-x-hidden bg-bg shadow-card">
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
    <header className="nova-topbar shrink-0 border-b border-line bg-surface">
      <div className="flex h-11 items-center gap-0.5">
        {onBack ? (
          <button type="button" onClick={onBack} className="grid size-11 place-items-center rounded-full" aria-label="返回">
            <ChevronLeft className="size-5" />
          </button>
        ) : (
          <span className="w-2" />
        )}
        <h1 className={cn("min-w-0 flex-1 truncate text-[17px] font-semibold", onBack && "text-center")}>{title}</h1>
        <div className="flex min-w-11 items-center justify-end">{right}</div>
      </div>
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
    <section className="flex min-h-0 flex-1 flex-col overflow-x-hidden">
      <TopBar title={title} onBack={onBack} right={right} />
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</div>
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
            "relative h-10 flex-1 text-[13px] font-semibold",
            value === item.id ? "text-primary" : "text-muted",
          )}
        >
          {item.label}
          {value === item.id && <span className="absolute inset-x-8 bottom-0 h-0.5 rounded-full bg-primary" />}
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
    <span className={cn("grid place-items-center rounded-full bg-primary text-[13px] font-semibold text-on-primary", className)}>
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
    <span className={cn("inline-flex items-center rounded-full px-1.5 py-px text-[11px] font-semibold", toneClass)}>
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
        className="nova-sheet max-h-[85dvh] w-full max-w-[430px] overflow-y-auto rounded-t-2xl bg-surface pt-3 shadow-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="h-11 px-2 text-[15px] text-muted">
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
    <label className="mb-2.5 block">
      <span className="mb-1 block text-[13px] text-muted">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "h-11 w-full rounded-xl border border-line bg-subtle px-3 text-[16px] outline-none focus:border-primary";

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
      className="h-11 w-full rounded-full bg-primary text-[16px] font-semibold text-on-primary disabled:opacity-50"
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
      className="flex w-full items-center gap-2.5 border-b border-line bg-surface px-3.5 py-2.5 text-left last:border-b-0"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-xl nova-soft">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{title}</span>
        {desc && <span className="block truncate text-[13px] text-muted">{desc}</span>}
      </span>
      {extra}
    </button>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-6 py-8 text-center">
      <p className="text-[15px] font-medium text-fg">{title}</p>
      {hint && <p className="mt-1.5 text-[13px] leading-5 text-muted">{hint}</p>}
    </div>
  );
}

export function PendingApi({ name, extra, needsAuth }: { name: string; extra?: string; needsAuth?: boolean }) {
  const reachable = useAdmin((s) => s.connection.reachable);
  if (needsAuth) {
    return (
      <EmptyState
        title="需要用户登录 · 管理入口待接入"
        hint={`${name}在当前后端已经存在，但必须带用户登录令牌。管理端尚无管理员鉴权，不会用普通用户身份代拉全站数据，因此这里保持为空，也没有虚构数字。`}
      />
    );
  }
  const hint = reachable
    ? `${name}需要管理端专用接口。当前后端尚未提供该管理入口，因此这里没有数据，也没有虚构数字。可在「我的」中手动打开演示模式，仅用于预览界面。`
    : `${name}无法读取：当前页面连不上后端（公开预览无法访问你电脑上的服务）。列表保持为空，没有虚构数字。${extra || ""}`;
  return <EmptyState title="接口待接入" hint={hint} />;
}

export function DemoBanner() {
  const demoMode = useAdmin((s) => s.demoMode);
  if (!demoMode) return null;
  return (
    <div className="mx-4 mb-2 rounded-xl nova-warn-soft px-3 py-1.5 text-center text-[12px] font-medium leading-5">
      演示模式 · 下列数据为本地虚构，不是服务器数据
    </div>
  );
}

export function DataHint({ children }: { children: ReactNode }) {
  return <div className="mx-4 mb-2 rounded-xl bg-subtle px-3 py-2 text-[13px] leading-5 text-muted">{children}</div>;
}
