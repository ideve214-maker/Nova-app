/**
 * 管理端对 0.7.0-m4.12 后端的实际调用。
 * 路径仍走 backend.ts 的对照表与别名，便于以后换版本。
 */
import {
  apiBinary,
  apiRequest,
  extractList,
  mapRemoteAnnouncement,
  mapRemoteAudit,
  mapRemoteAdmin,
  mapRemoteContent,
  mapRemotePayment,
  mapRemoteReport,
  mapRemoteStats,
  mapRemoteUser,
  pickToken,
  readErrorMessage,
  saveConfig,
  unwrapUser,
  type MappedAdmin,
  type MappedAnnouncement,
  type MappedAudit,
  type MappedContent,
  type MappedMember,
  type MappedPayment,
  type MappedReport,
  type MappedStats,
  type RequestResult,
} from "./backend";

export type RemoteError = { ok: false; error: string; status: number; json: unknown };
export type RemoteOk<T> = { ok: true; data: T; json: unknown; status: number };
export type Remote<T> = RemoteOk<T> | RemoteError;

function fail(res: RequestResult, fallback: string): RemoteError {
  return { ok: false, error: readErrorMessage(res.json, res.error || fallback), status: res.status, json: res.json };
}

function ok<T>(res: RequestResult, data: T): RemoteOk<T> {
  return { ok: true, data, json: res.json, status: res.status };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export async function remoteLogin(username: string, password: string): Promise<Remote<{ token: string; admin: MappedAdmin; expiresAt: number | null }>> {
  const res = await apiRequest("adminLogin", {
    method: "POST",
    body: { username, password, account: username },
    token: "",
    timeoutMs: 8000,
  });
  if (!res.ok) return fail(res, "账号或密码错误");
  const token = pickToken(res.json);
  if (!token) return { ok: false, error: "服务器未返回管理员令牌", status: res.status, json: res.json };
  const admin = mapRemoteAdmin(res.json);
  if (!admin) return { ok: false, error: "服务器未返回管理员信息", status: res.status, json: res.json };
  const rec = asRecord(res.json);
  const exp = rec && typeof rec.expiresAt === "number" ? rec.expiresAt : admin.expiresAt;
  return ok(res, { token, admin, expiresAt: exp ?? null });
}

export async function remoteLogout(): Promise<void> {
  try {
    await apiRequest("adminLogout", { method: "POST", timeoutMs: 4000 });
  } catch {
    /* 退出以本机清令牌为准 */
  }
  saveConfig({ token: "" });
}

export async function remoteMe(): Promise<Remote<MappedAdmin>> {
  const res = await apiRequest("adminMe", { timeoutMs: 6000 });
  if (!res.ok) return fail(res, "登录已过期，请重新登录");
  const admin = mapRemoteAdmin(res.json);
  if (!admin) return { ok: false, error: "无法读取管理员信息", status: res.status, json: res.json };
  return ok(res, admin);
}

export async function remoteUsers(query?: Record<string, string | number | undefined>): Promise<Remote<MappedMember[]>> {
  const res = await apiRequest("adminUsers", { query, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法获取用户列表");
  const rows = extractList(res.json)
    .map(mapRemoteUser)
    .filter((x): x is MappedMember => !!x);
  return ok(res, rows);
}

export async function remoteUser(id: string): Promise<Remote<MappedMember>> {
  const res = await apiRequest("adminUser", { params: { id }, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法获取用户");
  const u = mapRemoteUser(unwrapUser(res.json));
  if (!u) return { ok: false, error: "无法解析用户", status: res.status, json: res.json };
  return ok(res, u);
}

export async function remoteBan(id: string, reason?: string): Promise<Remote<MappedMember>> {
  const res = await apiRequest("adminUserBan", { method: "POST", params: { id }, body: reason ? { reason } : {}, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "封禁失败");
  const u = mapRemoteUser(unwrapUser(res.json));
  return u ? ok(res, u) : fail(res, "封禁失败");
}

export async function remoteUnban(id: string, reason?: string): Promise<Remote<MappedMember>> {
  const res = await apiRequest("adminUserUnban", { method: "POST", params: { id }, body: reason ? { reason } : {}, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "解除封禁失败");
  const u = mapRemoteUser(unwrapUser(res.json));
  return u ? ok(res, u) : fail(res, "解除封禁失败");
}

export async function remoteResetPassword(id: string): Promise<Remote<{ user: MappedMember | null; temporaryPassword: string; mustChangePw: boolean }>> {
  const res = await apiRequest("adminUserResetPassword", { method: "POST", params: { id }, body: {}, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "重置密码失败");
  const rec = asRecord(res.json);
  const pw = rec && typeof rec.temporaryPassword === "string" ? rec.temporaryPassword : "";
  if (!pw) return { ok: false, error: "服务器未返回临时密码", status: res.status, json: res.json };
  return ok(res, {
    user: mapRemoteUser(unwrapUser(res.json)),
    temporaryPassword: pw,
    mustChangePw: !!(rec && rec.mustChangePw),
  });
}

export async function remoteGrantVip(userId: string, days: number, reason: string): Promise<Remote<MappedMember>> {
  const res = await apiRequest("adminVipGrant", { method: "POST", body: { userId, days, reason }, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "开通会员失败");
  const u = mapRemoteUser(unwrapUser(res.json));
  return u ? ok(res, u) : fail(res, "开通会员失败");
}

export async function remoteRevokeVip(userId: string, reason: string): Promise<Remote<MappedMember>> {
  const res = await apiRequest("adminVipRevoke", { method: "POST", body: { userId, reason }, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "撤销会员失败");
  const u = mapRemoteUser(unwrapUser(res.json));
  return u ? ok(res, u) : fail(res, "撤销会员失败");
}

export async function remoteContent(query?: Record<string, string | number | undefined>): Promise<Remote<MappedContent[]>> {
  const type = String((query && query.type) || "post");
  const fallback: "post" | "comment" = type === "comment" ? "comment" : "post";
  const res = await apiRequest("adminContent", { query, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法获取内容列表");
  const rec = asRecord(res.json);
  const rawList =
    extractList(res.json).length > 0
      ? extractList(res.json)
      : type === "comment" && rec && Array.isArray(rec.comments)
        ? rec.comments
        : type === "post" && rec && Array.isArray(rec.posts)
          ? rec.posts
          : [];
  const rows = rawList.map((r) => mapRemoteContent(r, fallback)).filter((x): x is MappedContent => !!x);
  return ok(res, rows);
}

export async function remoteHideContent(type: string, id: string, reason?: string): Promise<Remote<MappedContent>> {
  const res = await apiRequest("adminContentDelete", {
    method: "POST",
    params: { type, id },
    body: reason ? { reason } : {},
    timeoutMs: 8000,
  });
  if (!res.ok) return fail(res, "删除失败");
  const rec = asRecord(res.json);
  const item = mapRemoteContent(rec && rec.item ? rec.item : res.json, type === "comment" ? "comment" : "post");
  return item ? ok(res, item) : fail(res, "删除失败");
}

export async function remoteRestoreContent(type: string, id: string): Promise<Remote<MappedContent>> {
  const res = await apiRequest("adminContentRestore", { method: "POST", params: { type, id }, body: {}, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "恢复失败");
  const rec = asRecord(res.json);
  const item = mapRemoteContent(rec && rec.item ? rec.item : res.json, type === "comment" ? "comment" : "post");
  return item ? ok(res, item) : fail(res, "恢复失败");
}

export async function remotePayments(query?: Record<string, string | number | undefined>): Promise<Remote<MappedPayment[]>> {
  const res = await apiRequest("adminPayments", { query, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法获取付款订单");
  const rows = extractList(res.json)
    .map(mapRemotePayment)
    .filter((x): x is MappedPayment => !!x);
  return ok(res, rows);
}

export async function remotePayment(id: string): Promise<Remote<MappedPayment>> {
  const res = await apiRequest("adminPayment", { params: { id }, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法获取订单");
  const rec = asRecord(res.json);
  const item = mapRemotePayment(rec && rec.order ? rec.order : res.json);
  if (!item) return fail(res, "无法解析订单");
  if (rec && Array.isArray(rec.events)) item.events = rec.events;
  return ok(res, item);
}

export async function remoteConfirmPayment(id: string, note?: string): Promise<Remote<{ payment: MappedPayment; already: boolean; vipUntil: unknown }>> {
  const res = await apiRequest("adminPaymentConfirm", { method: "POST", params: { id }, body: note ? { note } : {}, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "确认开通失败");
  const rec = asRecord(res.json);
  const payment = mapRemotePayment(rec && rec.order ? rec.order : res.json);
  if (!payment) return fail(res, "确认开通失败");
  return ok(res, { payment, already: !!(rec && rec.already), vipUntil: rec ? rec.vipUntil : null });
}

export async function remoteRejectPayment(id: string, reason: string): Promise<Remote<MappedPayment>> {
  const res = await apiRequest("adminPaymentReject", { method: "POST", params: { id }, body: { reason }, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "拒绝失败");
  const rec = asRecord(res.json);
  const payment = mapRemotePayment(rec && rec.order ? rec.order : res.json);
  return payment ? ok(res, payment) : fail(res, "拒绝失败");
}

export async function remoteRefundPayment(id: string, reason?: string): Promise<Remote<{ payment: MappedPayment; already: boolean; vipRevoked: boolean }>> {
  const res = await apiRequest("adminPaymentRefund", {
    method: "POST",
    params: { id },
    body: reason ? { reason } : {},
    timeoutMs: 8000,
  });
  if (!res.ok) return fail(res, "退款失败");
  const rec = asRecord(res.json);
  const payment = mapRemotePayment(rec && rec.order ? rec.order : res.json);
  if (!payment) return fail(res, "退款失败");
  return ok(res, { payment, already: !!(rec && rec.already), vipRevoked: !!(rec && rec.vipRevoked) });
}

export async function remoteReceipt(id: string): Promise<Remote<{ objectUrl: string; mime: string }>> {
  const res = await apiBinary("adminPaymentReceipt", { params: { id }, timeoutMs: 20000 });
  if (!res.ok || !res.blob) {
    return { ok: false, error: res.error || "没有付款截图", status: res.status, json: null };
  }
  const objectUrl = URL.createObjectURL(res.blob);
  return { ok: true, data: { objectUrl, mime: res.mime }, json: null, status: res.status };
}

export async function remoteAudit(query?: Record<string, string | number | undefined>): Promise<Remote<MappedAudit[]>> {
  const res = await apiRequest("adminAudit", { query, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法获取审计日志");
  const rows = extractList(res.json)
    .map(mapRemoteAudit)
    .filter((x): x is MappedAudit => !!x);
  return ok(res, rows);
}

export async function remoteAnnouncements(): Promise<Remote<MappedAnnouncement[]>> {
  const res = await apiRequest("adminAnnouncements", { timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法获取公告");
  const rows = extractList(res.json)
    .map(mapRemoteAnnouncement)
    .filter((x): x is MappedAnnouncement => !!x);
  return ok(res, rows);
}

export async function remoteAddAnnouncement(title: string, body: string, published = true): Promise<Remote<MappedAnnouncement[]>> {
  const res = await apiRequest("adminAnnouncements", { method: "POST", body: { title, body, published }, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "发布公告失败");
  const rows = extractList(res.json)
    .map(mapRemoteAnnouncement)
    .filter((x): x is MappedAnnouncement => !!x);
  return ok(res, rows);
}

export async function remoteDeleteAnnouncement(id: string): Promise<Remote<{ deleted: string }>> {
  const res = await apiRequest("adminAnnouncementDelete", { method: "POST", params: { id }, body: {}, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "删除公告失败");
  return ok(res, { deleted: id });
}

export async function remoteStats(): Promise<Remote<MappedStats>> {
  const res = await apiRequest("adminStats", { timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法获取统计");
  const stats = mapRemoteStats(res.json);
  if (!stats) return fail(res, "无法解析统计");
  return ok(res, stats);
}

export async function remoteReports(query?: Record<string, string | number | undefined>): Promise<Remote<MappedReport[]>> {
  const res = await apiRequest("adminReports", { query, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法获取举报");
  const rows = extractList(res.json)
    .map(mapRemoteReport)
    .filter((x): x is MappedReport => !!x);
  return ok(res, rows);
}

export async function remoteDecideReport(id: string, action: "resolve" | "reject" | "review", note?: string): Promise<Remote<MappedReport>> {
  const res = await apiRequest("adminReportDecision", { method: "POST", params: { id }, body: { action, note, notify: true }, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "处理举报失败");
  const rec = asRecord(res.json);
  const item = mapRemoteReport(rec && rec.report ? rec.report : res.json);
  return item ? ok(res, item) : fail(res, "处理举报失败");
}
