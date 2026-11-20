import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { apiRequest } from "@/lib/admin/backend";
import { useAdmin } from "@/lib/admin/store";
import { interpretPasswordChange, PW_MAX, PW_MIN, validatePasswordChange } from "@/lib/admin/password-rules";
import { Card } from "./marketing";
import { Field, inputClass, PrimaryButton, Screen } from "./ui";

function PwInput({ value, onChange, show, autoComplete, placeholder, enterKeyHint }: {
  value: string; onChange: (v: string) => void; show: boolean; autoComplete: string; placeholder?: string; enterKeyHint?: "next" | "done";
}) {
  return (
    <input className={inputClass} type={show ? "text" : "password"} value={value} maxLength={PW_MAX} autoComplete={autoComplete}
      autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder={placeholder} enterKeyHint={enterKeyHint}
      onChange={(e) => onChange(e.target.value)} />
  );
}

/** 2.0.8：当前管理员修改自己的密码。成功后服务端会让其他设备退出，本机保持登录。 */
export function ChangePasswordScreen() {
  const back = useAdmin((s) => s.back);
  const flash = useAdmin((s) => s.flash);
  const logout = useAdmin((s) => s.logout);
  const name = useAdmin((s) => s.adminProfile?.username || s.adminName || "管理员");
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [unsupported, setUnsupported] = useState(false);

  const submit = async () => {
    const bad = validatePasswordChange(cur, next, confirm);
    if (bad) { setErr(bad); return; }
    setErr(""); setBusy(true);
    const r = await apiRequest("adminMePassword", { method: "POST", body: { currentPassword: cur, newPassword: next }, timeoutMs: 15000 });
    setBusy(false);
    const out = interpretPasswordChange(r.status, r.json, r.error);
    if (out.kind === "ok") {
      setCur(""); setNext(""); setConfirm("");
      flash("密码已修改，其他设备上的登录已退出");
      back();
      return;
    }
    if (out.kind === "unsupported") { setUnsupported(true); setErr(out.message); return; }
    if (out.kind === "expired") { flash(out.message); void logout(); return; }
    if (out.kind === "wrong") setCur("");
    setErr(out.message);
  };

  return (
    <Screen title="修改密码" onBack={back}>
      {unsupported && (
        <Card>
          <p className="text-[13px] leading-5 text-warn">需服务端更新：当前服务器还没有修改密码接口（POST /api/admin/me/password）。服务端更新后这里就能用。</p>
        </Card>
      )}
      <Card>
        <p className="mb-3 text-[13px] leading-5 text-muted">正在修改 <span className="font-semibold text-fg">{name}</span> 的登录密码。改好后其他设备上的登录会退出，这台设备保持登录。</p>
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <input type="text" name="username" autoComplete="username" value={name} readOnly hidden />
          <Field label="当前密码">
            <PwInput value={cur} onChange={(v) => { setCur(v); setErr(""); }} show={show} autoComplete="current-password" enterKeyHint="next" />
          </Field>
          <Field label={`新密码（${PW_MIN}–${PW_MAX} 位，需同时包含字母和数字）`}>
            <PwInput value={next} onChange={(v) => { setNext(v); setErr(""); }} show={show} autoComplete="new-password" enterKeyHint="next" />
          </Field>
          <Field label="确认新密码">
            <PwInput value={confirm} onChange={(v) => { setConfirm(v); setErr(""); }} show={show} autoComplete="new-password" enterKeyHint="done" />
          </Field>
          <button type="button" className="mb-2 flex items-center gap-1.5 text-[13px] text-muted" onClick={() => setShow((v) => !v)}>
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}{show ? "隐藏密码" : "显示密码"}
          </button>
          {err && <p role="alert" className="mb-2 text-[13px] leading-5 text-danger">{err}</p>}
          <PrimaryButton type="submit" disabled={busy}>{busy ? "正在修改…" : "确认修改"}</PrimaryButton>
        </form>
      </Card>
    </Screen>
  );
}
