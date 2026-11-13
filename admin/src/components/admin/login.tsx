import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole, Server, UserRound } from "lucide-react";
import { hapticLight } from "@/lib/admin/native";
import { useAdmin } from "@/lib/admin/store";
import { resolveBase } from "@/lib/admin/backend";
import { ConnectionBadge } from "./server-panel";
import { ServerPanel } from "./server-panel";
import { Sheet, StarMark } from "./ui";

export function LoginScreen() {
  const attemptLogin = useAdmin((s) => s.attemptLogin);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [serverOpen, setServerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const base = resolveBase();
    if (!base) {
      setError("未配置接口地址。请打开「高级设置」填写后端网址。");
      setServerOpen(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const message = await attemptLogin(account, password, remember);
      if (message) setError(message);
      else void hapticLight();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="nova-login nova-scroll flex min-h-0 flex-1 flex-col text-fg"
      style={{
        paddingTop: "max(12px, var(--nova-safe-top, 0px), env(safe-area-inset-top, 0px))",
        paddingBottom: "max(12px, var(--nova-safe-bottom, 0px), env(safe-area-inset-bottom, 0px))",
        paddingLeft: "max(1.5rem, var(--nova-safe-left, 0px), env(safe-area-inset-left, 0px))",
        paddingRight: "max(1.5rem, var(--nova-safe-right, 0px), env(safe-area-inset-right, 0px))",
      }}
    >
      <div className="flex flex-1 flex-col items-center pt-4">
        <StarMark className="size-[72px]" />
        <h1 className="nova-brand mt-5 text-[28px] leading-none">NOVA</h1>
        <p className="mt-2 text-[15px] font-bold tracking-[0.12em] text-primary">管理端</p>
        <p className="mt-1 text-[13px] text-muted">社区管理</p>

        <form onSubmit={submitPassword} className="mt-6 w-full">
          <label className="mb-2.5 flex h-11 items-center gap-2 rounded-[14px] border border-line bg-subtle px-3 text-fg">
            <UserRound className="size-4 shrink-0 text-muted" />
            <input
              className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none"
              autoComplete="username"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              placeholder="管理员账号"
            />
          </label>
          <label className="mb-2.5 flex h-11 items-center gap-2 rounded-[14px] border border-line bg-subtle px-3 text-fg">
            <LockKeyhole className="size-4 shrink-0 text-muted" />
            <input
              className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="密码"
            />
            <button
              type="button"
              className="grid size-11 shrink-0 place-items-center text-muted"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? "隐藏密码" : "显示密码"}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </label>
          <div className="mb-3 flex items-center justify-between text-[13px]">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              记住登录
            </label>
          </div>
          {error && (
            <p className={`mb-2.5 rounded-[14px] px-3 py-2 text-center text-[13px] leading-5 ${/锁定|过于频繁|后再试/.test(error) ? "bg-[color:var(--nova-warn-soft,rgba(255,180,80,0.16))] text-warn" : "text-danger"}`}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="nova-btn-primary h-11 w-full text-[16px] disabled:opacity-60"
          >
            {busy ? "正在登录…" : "登录"}
          </button>
        </form>
      </div>

      <div className="mt-4 pb-3">
        <button type="button" className="mx-auto flex h-11 items-center gap-1.5 text-[13px] text-primary" onClick={() => setServerOpen(true)}>
          <Server className="size-3.5" />
          高级设置
        </button>
        <div className="mb-2 flex justify-center">
          <ConnectionBadge />
        </div>
        <p className="px-1 text-center text-[11px] leading-4 text-muted">
          使用服务器上的管理员账号登录（用 <code className="text-[10px]">admin-cli</code> 创建，令牌前缀 na_）。没有内置默认口令。列表与统计全部来自真实后端。
        </p>
      </div>

      <Sheet open={serverOpen} title="高级设置" onClose={() => setServerOpen(false)}>
        <ServerPanel onDone={() => setServerOpen(false)} />
      </Sheet>
    </div>
  );
}
