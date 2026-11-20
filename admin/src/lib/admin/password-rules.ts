// 2.0.8：管理员「修改密码」的前端校验和结果解读（纯函数，方便单测）。
// 服务端接口：POST /api/admin/me/password {currentPassword, newPassword}

export const PW_MIN = 8;
export const PW_MAX = 128;

/** 返回第一条不通过的原因；全部通过返回 null。 */
export function validatePasswordChange(current: string, next: string, confirm: string): string | null {
  if (!current) return "请输入当前密码";
  if (!next) return "请输入新密码";
  if (next.length < PW_MIN || next.length > PW_MAX) return `新密码需要 ${PW_MIN}–${PW_MAX} 位`;
  if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return "新密码需要同时包含字母和数字";
  if (next === current) return "新密码不能和当前密码相同";
  if (next !== confirm) return "两次输入的新密码不一致";
  return null;
}

export type PasswordChangeOutcome =
  | { kind: "ok" }
  | { kind: "wrong"; message: string }
  | { kind: "weak"; message: string }
  | { kind: "unsupported"; message: string }
  | { kind: "expired"; message: string }
  | { kind: "error"; message: string };

function errInfo(json: unknown): { code?: string; message?: string } {
  if (!json || typeof json !== "object") return {};
  const e = (json as { error?: unknown }).error;
  if (e && typeof e === "object") {
    const o = e as { code?: unknown; message?: unknown };
    return { code: typeof o.code === "string" ? o.code : undefined, message: typeof o.message === "string" ? o.message : undefined };
  }
  if (typeof e === "string") return { message: e };
  return {};
}

/** 把接口返回（状态码 + JSON）翻译成界面要显示的结果。 */
export function interpretPasswordChange(status: number, json: unknown, networkError?: string): PasswordChangeOutcome {
  if (status >= 200 && status < 300) return { kind: "ok" };
  const { code, message } = errInfo(json);
  if (code === "WRONG_PASSWORD") return { kind: "wrong", message: "当前密码不正确" };
  if (code === "WEAK_PASSWORD") return { kind: "weak", message: message || `新密码太弱：需要 ${PW_MIN}–${PW_MAX} 位，且同时包含字母和数字` };
  if (status === 404 && (!code || code === "NOT_FOUND")) return { kind: "unsupported", message: "需服务端更新后才能在这里修改密码" };
  if (status === 401) return { kind: "expired", message: "登录已失效，请重新登录" };
  if (status === 0) return { kind: "error", message: networkError || "网络连接失败，请稍后再试" };
  return { kind: "error", message: message || "修改失败，请稍后再试" };
}
