import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole, Server, UserRound } from "lucide-react";
import { useAdmin } from "@/lib/admin/store";
import { PrimaryButton, Sheet, StarMark } from "./ui";
import { ConnectionBadge, ServerPanel } from "./server-panel";

export function LoginScreen() {
  const attemptLogin = useAdmin((s) => s.attemptLogin);
  const confirmTotp = useAdmin((s) => s.confirmTotp);
  const resetDemo = useAdmin((s) => s.resetDemo);
  const [account, setAccount] = useState("admin");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"password" | "totp">("password");
  const [code, setCode] = useState("");
  const [serverOpen, setServerOpen] = useState(false);
  const [forgot, setForgot] = useState(false);

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    const message = attemptLogin(account, password);
    if (message) {
      setError(message);
      return;
    }
    if (!remember) sessionStorage.setItem("nova-admin-session", "1");
    setError("");
    setStep("totp");
  }

  function submitTotp(event: FormEvent) {
    event.preventDefault();
    const message = confirmTotp(code);
    setError(message ?? "");
  }

  return (
    <div className="nova-login flex min-h-dvh flex-col px-6 pb-safe pt-16 text-on-primary">
      <div className="flex flex-1 flex-col items-center">
        <span className="grid size-20 place-items-center rounded-3xl bg-surface/15">
          <StarMark className="size-10" />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight">NOVA 管理端</h1>
        <p className="mt-2 text-sm text-on-primary/80">社区管理 · 让社区更健康</p>

        {step === "password" ? (
          <form onSubmit={submitPassword} className="mt-8 w-full">
            <label className="mb-3 flex h-12 items-center gap-2 rounded-2xl bg-surface px-3 text-fg">
              <UserRound className="size-5 text-muted" />
              <input
                className="h-full min-w-0 flex-1 bg-transparent outline-none"
                autoComplete="username"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                placeholder="管理员账号"
              />
            </label>
            <label className="mb-3 flex h-12 items-center gap-2 rounded-2xl bg-surface px-3 text-fg">
              <LockKeyhole className="size-5 text-muted" />
              <input
                className="h-full min-w-0 flex-1 bg-transparent outline-none"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="密码"
              />
              <button type="button" className="grid size-10 place-items-center text-muted" onClick={() => setShow((v) => !v)} aria-label={show ? "隐藏密码" : "显示密码"}>
                {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </label>
            <div className="mb-4 flex items-center justify-between text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                记住登录
              </label>
              <button type="button" onClick={() => setForgot(true)}>
                忘记密码？
              </button>
            </div>
            {error && <p className="mb-3 text-center text-sm text-surface">{error}</p>}
            <button type="submit" className="h-12 w-full rounded-full bg-surface font-semibold text-primary-deep">
              登录
            </button>
          </form>
        ) : (
          <form onSubmit={submitTotp} className="mt-8 w-full">
            <p className="mb-3 text-center text-sm text-on-primary/85">二次验证 · 演示验证码 246810</p>
            <input
              className="mb-3 h-12 w-full rounded-2xl bg-surface px-3 text-center text-lg tracking-widest text-fg outline-none"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6 位验证码"
            />
            {error && <p className="mb-3 text-center text-sm">{error}</p>}
            <button type="submit" className="h-12 w-full rounded-full bg-surface font-semibold text-primary-deep">
              验证并进入
            </button>
            <button type="button" className="mt-3 h-10 w-full text-sm" onClick={() => setStep("password")}>
              返回
            </button>
          </form>
        )}
      </div>
      <button type="button" className="mx-auto mb-2 flex items-center gap-2 text-sm" onClick={() => setServerOpen(true)}>
        <Server className="size-4" />
        设置服务器
      </button>
      <div className="mb-2 flex justify-center">
        <ConnectionBadge />
      </div>
      <p className="pb-4 text-center text-xs text-on-primary/75">预览演示 · 账号 admin · 密码 nova1234 · 验证码 246810</p>
      <Sheet open={serverOpen} title="服务器" onClose={() => setServerOpen(false)}>
        <ServerPanel onDone={() => setServerOpen(false)} />
      </Sheet>
      <Sheet open={forgot} title="忘记密码" onClose={() => setForgot(false)}>
        <p className="mb-4 text-sm text-muted">
          演示环境不会发送邮件，也不会显示原密码。如果改过预览口令，可以恢复初始演示账号。
        </p>
        <PrimaryButton
          onClick={() => {
            resetDemo();
            setPassword("");
            setForgot(false);
            setError("");
          }}
        >
          恢复演示账号
        </PrimaryButton>
      </Sheet>
    </div>
  );
}
