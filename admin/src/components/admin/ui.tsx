import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { mediaUrl } from "@/lib/admin/media";
import { avatarLetter, hasAvatarFailed, isHexColor, markAvatarFailed, normalizeImagePath, resolveAvatar } from "@/lib/admin/avatar";
import { useAdmin } from "@/lib/admin/store";
import { getStoredSkin, getStoredTheme, subscribeAppearance, type SkinId, type ThemeMode } from "@/lib/admin/theme";
import { skinIconSvg, skinMarkUrl, type SkinIconName } from "@/theme/marks";

export type { SkinIconName };

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function useAppearance(): { skin: SkinId; theme: ThemeMode } {
  const [skin, setSkin] = useState<SkinId>(() => (typeof window === "undefined" ? "starlight" : getStoredSkin()));
  const [theme, setThemeMode] = useState<ThemeMode>(() => (typeof window === "undefined" ? "system" : getStoredTheme()));
  useEffect(() => subscribeAppearance(() => {
    setSkin(getStoredSkin());
    setThemeMode(getStoredTheme());
  }), []);
  return { skin, theme };
}

export function StarMark({ className }: { className?: string }) {
  const { skin } = useAppearance();
  return <img src={skinMarkUrl(skin)} alt="" className={className} />;
}

export function SkinIcon({ name, className }: { name: SkinIconName; className?: string }) {
  const { skin } = useAppearance();
  return (
    <span
      aria-hidden
      className={cn("inline-grid place-items-center text-current [&_svg]:h-full [&_svg]:w-full", className)}
      dangerouslySetInnerHTML={{ __html: skinIconSvg(skin, name) }}
    />
  );
}

export function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="nova-frame bg-stage text-fg">
      <div className="nova-frame-inner relative mx-auto flex h-full w-full flex-col overflow-hidden bg-bg">
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
    <header className="nova-topbar nova-bar shrink-0 border-b border-line">
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
    <section className="relative min-h-0 flex-1 overflow-hidden">
      <div className="nova-scroll absolute inset-0" data-nova-content-scroll>
        <div className="nova-top-spacer" aria-hidden />
        {children}
        {footer ? <div className="nova-footer-spacer" aria-hidden /> : <div className="pb-safe" aria-hidden />}
      </div>
      <div className="absolute inset-x-0 top-0 z-30">
        <TopBar title={title} onBack={onBack} right={right} />
      </div>
      {footer && <div className="nova-bar absolute inset-x-0 bottom-0 z-30 border-t border-line">{footer}</div>}
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

/**
 * 统一头像组件。src 可以是图片地址字符串，也可以是用户端的头像对象
 * （{ kind: "color", color, letter } / { kind: "image", url }）或空值：
 * 只有像图片地址的字符串才用 <img> 加载；其余显示颜色 + 文字默认头像（无文字时用昵称首字）。
 * 图片加载失败也回退到默认头像，并带 data-nova-soft-fail，不触发全局“资源加载失败”弹框。
 */
export function Avatar({
  src,
  name,
  className,
  color,
  letter,
}: {
  src?: unknown;
  name: string;
  className?: string;
  color?: string;
  letter?: string;
}) {
  const resolved = resolveAvatar(src);
  const path = resolved.url ? normalizeImagePath(resolved.url) : "";
  const url = path ? mediaUrl(path) || path : "";
  const [brokenUrl, setBrokenUrl] = useState("");
  if (url && brokenUrl !== url && !hasAvatarFailed(url)) {
    return (
      <img
        src={url}
        alt=""
        data-nova-soft-fail="avatar"
        onError={() => {
          markAvatarFailed(url);
          setBrokenUrl(url);
        }}
        className={cn("rounded-full object-cover", className)}
      />
    );
  }
  const bg = (isHexColor(color) && color.trim()) || resolved.color;
  const text = avatarLetter(letter || resolved.letter, name);
  return (
    <span
      role="img"
      aria-label={name || text}
      className={cn(
        "grid place-items-center rounded-full text-[13px] font-semibold",
        bg ? "text-white" : "bg-primary text-on-primary",
        className,
      )}
      style={bg ? { backgroundColor: bg } : undefined}
    >
      {text}
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
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center overscroll-none bg-ink/40" data-nova-modal="" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="nova-sheet max-h-[85dvh] w-full max-w-[430px] rounded-t-2xl bg-surface pt-3 shadow-card"
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
    </div>,
    document.body,
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
      className="nova-btn-primary h-11 w-full text-[16px] disabled:opacity-50"
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
      className="flex min-h-[52px] w-full items-center gap-2.5 border-b border-line bg-surface px-3.5 py-3 text-left last:border-b-0"
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

export function PendingApi({ name, extra, needsAuth }: { name?: string; extra?: string; needsAuth?: boolean }) {
  const reachable = useAdmin((s) => s.connection.reachable);
  if (needsAuth) {
    return <EmptyState title="暂时无法查看" hint="这项内容目前不能用管理账号打开，列表先保持为空。" />;
  }
  const hint = reachable ? "暂时还不能使用这项功能。" : "网络不太好，请稍后再试";
  return <EmptyState title="暂时没有数据" hint={hint} />;
}

export function DemoBanner() {
  const demoMode = useAdmin((s) => s.demoMode);
  if (!demoMode) return null;
  return (
    <div className="mx-4 mb-2 rounded-xl nova-warn-soft px-3 py-1.5 text-center text-[12px] font-medium leading-5">
      演示数据，仅供预览
    </div>
  );
}

export function DataHint({ children }: { children: ReactNode }) {
  return <div className="mx-4 mb-2 rounded-xl bg-subtle px-3 py-2 text-[13px] leading-5 text-muted">{children}</div>;
}

/** 二次确认（移出、删除等不可撤销的操作）。 */
export function ConfirmSheet({
  open,
  title,
  message,
  confirmText,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmText: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title={title} onClose={onClose}>
      {message && <p className="mb-3 text-[15px] leading-6 text-muted">{message}</p>}
      <div className="flex gap-2 pb-2">
        <button type="button" className="h-11 flex-1 rounded-full bg-subtle text-[15px] font-semibold" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          disabled={busy}
          className={cn(
            "h-11 flex-1 rounded-full text-[15px] font-semibold disabled:opacity-50",
            danger ? "nova-danger-soft" : "bg-primary text-on-primary",
          )}
          onClick={onConfirm}
        >
          {busy ? "请稍候…" : confirmText}
        </button>
      </div>
    </Sheet>
  );
}

/** 服务器暂未开放某项功能时的统一提示（不弹红框）。 */
export function NotOpenYet({ what }: { what: string }) {
  return <EmptyState title="服务器暂未开放此功能" hint={`${what}需要服务器更新后才能使用，请稍后再来看看。`} />;
}
