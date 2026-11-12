import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole, Server, UserRound } from "lucide-react";
import { useAdmin } from "@/lib/admin/store";
import { PrimaryButton, Sheet, StarMark } from "./ui";
import { ConnectionBadge, ServerPanel } from "./server-panel";

export function LoginScreen() {
  const attemptLogin = useAdmin((s) => s.attemptLogin);
  const resetDemo = useAdmin((s) => s.resetDemo);
  const [account, setAccount] = useState("admin");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [serverOpen, setServerOpen] = useState(false);
  const [forgot, setForgot] = useState(false);

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    const message = attemptLogin(account, password, remember);
    if (message) {
      setError(message);
      return;
    }
    setError("");
  }

  return (
    <div
      className="nova-login flex min-h-dvh flex-col overflow-x-hidden overflow-y-auto text-on-primary"
      style={{
        paddingTop: "max(12px, var(--nova-safe-top, 0px), env(safe-area-inset-top, 0px))",
        paddingBottom: "max(12px, var(--nova-safe-bottom, 0px), env(safe-area-inset-bottom, 0px))",
        paddingLeft: "max(1.25rem, var(--nova-safe-left, 0px), env(safe-area-inset-left, 0px))",
        paddingRight: "max(1.25rem, var(--nova-safe-right, 0px), env(safe-area-inset-right, 0px))",
      }}
    >
      <div className="flex flex-1 flex-col items-center pt-4">
        <span className="grid size-[52px] place-items-center rounded-[14px] bg-surface/15">
          <StarMark className="size-7" />
        </span>
        <h1 className="mt-3 text-[22px] font-semibold tracking-tight">NOVA 管理端</h1>
        <p className="mt-1 text-[13px] text-on-primary/80">社区管理</p>

        <form onSubmit={submitPassword} className="mt-6 w-full">
          <label className="mb-2.5 flex h-11 items-center gap-2 rounded-xl bg-surface px-3 text-fg">
            <UserRound className="size-4 shrink-0 text-muted" />
            <input
              className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none"
              autoComplete="username"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              placeholder="管理员账号"
            />
          </label>
          <label className="mb-2.5 flex h-11 items-center gap-2 rounded-xl bg-surface px-3 text-fg">
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
            <button type="button" onClick={() => setForgot(true)}>
              忘记密码？
            </button>
          </div>
          {error && <p className="mb-2.5 text-center text-[13px] text-surface">{error}</p>}
          <button type="submit" className="h-11 w-full rounded-full bg-surface text-[16px] font-semibold text-primary-deep">
            登录
          </button>
        </form>
      </div>

      <div className="mt-4 pb-3">
        <button type="button" className="mx-auto flex h-11 items-center gap-1.5 text-[13px]" onClick={() => setServerOpen(true)}>
          <Server className="size-3.5" />
          设置服务器
        </button>
        <div className="mb-2 flex justify-center">
          <ConnectionBadge />
        </div>
        <p className="px-1 text-center text-[11px] leading-4 text-on-primary/75">
          本机操作员登录：后端尚无管理端鉴权接口。口令只存在本机，默认 admin / nova1234，不是服务器账号。列表与统计来自真实后端；连不上或接口未开放时显示空状态，不会填入虚构数字。
        </p>
      </div>

      <Sheet open={serverOpen} title="服务器" onClose={() => setServerOpen(false)}>
        <ServerPanel onDone={() => setServerOpen(false)} />
      </Sheet>
      <Sheet open={forgot} title="忘记密码" onClose={() => setForgot(false)}>
        <p className="mb-4 text-[15px] leading-5 text-muted">
          这是本机口令，不会发邮件，也不会显示原密码。可以把口令恢复为初始值 admin / nova1234。这不是服务器账号。
        </p>
        <PrimaryButton
          onClick={() => {
            resetDemo();
            setPassword("");
            setForgot(false);
            setError("");
          }}
        >
          恢复本机默认口令
        </PrimaryButton>
      </Sheet>
    </div>
  );
}
