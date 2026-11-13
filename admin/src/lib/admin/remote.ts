/**
 * 管理端对 0.7.0-m6.1 后端的实际调用。
 * 路径仍走 backend.ts 的对照表与别名，便于以后换版本。
 */
import {
  apiBinary,
  apiRequest,
  extractList,
  mapRemoteAnnouncement,
  mapHotPostList,
  isFeatureMissing,
  hotErrorMessage,
  readErrorCode,
  mapRemoteAudit,
  mapRemoteAdmin,
  mapRemoteContent,
  mapRemotePayment,
  mapRemoteReport,
  mapRemoteStats,
  mapRemoteUser,
  mapRemoteBlockword,
  mapRemoteChannel,
  mapRemoteChannelMessage,
  mapRemoteCommunity,
  mapRemoteAppeal,
  mapRemoteSecurityEvent,
  mapRemoteMedia,
  pickToken,
  readErrorMessage,
  formatLockoutMessage,
  readRetryAfter,
  listPageMeta,
  saveConfig,
  unwrapUser,
  type MappedAdmin,
  type MappedAnnouncement,
  type MappedHotPost,
  type MappedAudit,
  type MappedBlockword,
  type MappedChannel,
  type MappedChannelMessage,
  type MappedCommunity,
  type MappedContent,
  type MappedMember,
  type MappedPayment,
  type MappedReport,
  type MappedStats,
  type MappedAppeal,
  type MappedSecurityEvent,
  type MappedMedia,
  type RequestResult,
} from "./backend";

export type RemoteError = { ok: false; error: string; status: number; json: unknown; retryAfter?: number | null; missing?: boolean };
export type RemoteOk<T> = { ok: true; data: T; json: unknown; status: number; total?: number | null; truncated?: boolean };
export type Remote<T> = RemoteOk<T> | RemoteError;

function fail(res: RequestResult, fallback: string): RemoteError {
  const retryAfter = readRetryAfter(res.json, res.headers);
  const locked = res.status === 429 || res.status === 423 || retryAfter != null;
  const error = locked
    ? formatLockoutMessage(res.json, res.headers, res.error || fallback)
    : readErrorMessage(res.json, res.error || fallback);
  return { ok: false, error, status: res.status, json: res.json, retryAfter, missing: isFeatureMissing(res) };
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

export type SavedAnnouncements = { list: MappedAnnouncement[]; announcement: MappedAnnouncement | null; withdrawnIds: string[] };

function readWithdrawnIds(json: unknown): string[] {
  const rec = asRecord(json);
  return rec && Array.isArray(rec.withdrawnIds) ? rec.withdrawnIds.map((x) => String(x)) : [];
}

/** 新建公告（B2）：返回整表、新建的那条，以及因此自动下线的公告编号。 */
export async function remoteAddAnnouncement(title: string, body: string, published = true): Promise<Remote<SavedAnnouncements>> {
  // 始终显式传 published：服务器不传时默认直接发布。
  const res = await apiRequest("adminAnnouncements", { method: "POST", body: { title, body, published }, timeoutMs: 8000 });
  if (!res.ok) return fail(res, published ? "发布公告失败" : "保存草稿失败");
  const rec = asRecord(res.json);
  const list = (rec && Array.isArray(rec.announcements) ? rec.announcements : extractList(res.json))
    .map(mapRemoteAnnouncement)
    .filter((x): x is MappedAnnouncement => !!x);
  const announcement = rec && rec.announcement ? mapRemoteAnnouncement(rec.announcement) : null;
  return ok(res, { list, announcement, withdrawnIds: readWithdrawnIds(res.json) });
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


export async function remoteEditAnnouncement(id: string, title: string, body: string, published?: boolean): Promise<Remote<MappedAnnouncement> & { withdrawnIds?: string[] }> {
  const payload: Record<string, unknown> = { title, body };
  if (published != null) payload.published = published;
  let res = await apiRequest("adminAnnouncementPatch", { method: "PATCH", params: { id }, body: payload, timeoutMs: 8000 });
  if (!res.ok && isFeatureMissing(res)) {
    res = await apiRequest("adminAnnouncementEdit", { method: "POST", params: { id }, body: payload, timeoutMs: 8000 });
  }
  if (!res.ok) return fail(res, "编辑公告失败");
  const rec = asRecord(res.json);
  const item = mapRemoteAnnouncement(rec && rec.announcement ? rec.announcement : res.json);
  return item ? { ...ok(res, item), withdrawnIds: readWithdrawnIds(res.json) } : fail(res, "编辑公告失败");
}

export async function remoteWithdrawAnnouncement(id: string): Promise<Remote<MappedAnnouncement>> {
  const res = await apiRequest("adminAnnouncementWithdraw", { method: "POST", params: { id }, body: {}, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "下线公告失败");
  const rec = asRecord(res.json);
  const item = mapRemoteAnnouncement(rec && rec.announcement ? rec.announcement : res.json);
  return item ? ok(res, item) : fail(res, "下线公告失败");
}

export async function remoteCommunities(): Promise<Remote<MappedCommunity[]>> {
  const res = await apiRequest("adminCommunities", { query: { limit: 100 }, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法获取社区列表");
  const rows = extractList(res.json)
    .map(mapRemoteCommunity)
    .filter((x): x is MappedCommunity => !!x);
  return ok(res, rows);
}

export async function remoteCommunity(id: string): Promise<Remote<MappedCommunity>> {
  const res = await apiRequest("adminCommunity", { params: { id }, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法获取社区");
  const item = mapRemoteCommunity(res.json);
  return item ? ok(res, item) : fail(res, "无法解析社区");
}

export async function remoteChannelMessages(id: string, limit = 80): Promise<Remote<{ channel: MappedChannel | null; messages: MappedChannelMessage[] }>> {
  const res = await apiRequest("adminChannelMessages", { params: { id }, query: { limit }, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法获取频道消息");
  const rec = asRecord(res.json);
  const channel = rec ? mapRemoteChannel(rec.channel, asStringSafe(rec, "communityId")) : null;
  const raw = rec && Array.isArray(rec.messages) ? rec.messages : extractList(res.json);
  const messages = raw.map(mapRemoteChannelMessage).filter((x): x is MappedChannelMessage => !!x);
  return ok(res, { channel, messages });
}

function asStringSafe(rec: Record<string, unknown> | null, key: string): string {
  if (!rec) return "";
  const ch = rec.channel;
  if (ch && typeof ch === "object" && ch !== null && "communityId" in (ch as object)) {
    const v = (ch as Record<string, unknown>).communityId;
    if (v != null) return String(v);
  }
  return "";
}

export async function remoteContentItem(type: string, id: string): Promise<Remote<MappedContent>> {
  const res = await apiRequest("adminContentItem", { params: { type, id }, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法获取内容");
  const rec = asRecord(res.json);
  const item = mapRemoteContent(rec && rec.item ? rec.item : res.json, type === "comment" ? "comment" : "post");
  return item ? ok(res, item) : fail(res, "无法解析内容");
}

export async function remoteBlockwords(): Promise<Remote<MappedBlockword[]>> {
  const res = await apiRequest("adminBlockwords", { timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法获取屏蔽词");
  const rows = extractList(res.json)
    .map(mapRemoteBlockword)
    .filter((x): x is MappedBlockword => !!x);
  return ok(res, rows);
}

export async function remoteAddBlockword(word: string, note?: string): Promise<Remote<{ item: MappedBlockword; existed: boolean }>> {
  const res = await apiRequest("adminBlockwords", { method: "POST", body: { word, note }, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "添加屏蔽词失败");
  const rec = asRecord(res.json);
  const item = mapRemoteBlockword(rec && rec.blockword ? rec.blockword : res.json);
  if (!item) return fail(res, "添加屏蔽词失败");
  return ok(res, { item, existed: !!(rec && rec.existed) });
}

export async function remoteDeleteBlockword(id: string): Promise<Remote<{ removed: string }>> {
  const res = await apiRequest("adminBlockwordDelete", { method: "POST", params: { id }, body: {}, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "删除屏蔽词失败");
  return ok(res, { removed: id });
}

export async function remoteSecurityEvents(query?: Record<string, string | number | undefined>): Promise<Remote<MappedSecurityEvent[]>> {
  const res = await apiRequest("adminSecurityEvents", { query, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法读取安全事件");
  return ok(res, extractList(res.json).map(mapRemoteSecurityEvent).filter((x): x is MappedSecurityEvent => !!x));
}

export async function remoteAppeals(query?: Record<string, string | number | undefined>): Promise<Remote<MappedAppeal[]>> {
  const res = await apiRequest("adminAppeals", { query, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法读取申诉");
  const rows = extractList(res.json).map(mapRemoteAppeal).filter((x): x is MappedAppeal => !!x);
  const limit = Number(query?.limit ?? 0) || 0;
  const meta = listPageMeta(res.json, rows.length, limit);
  return { ...ok(res, rows), total: meta.total, truncated: meta.truncated };
}

export async function remoteAppeal(id: string): Promise<Remote<MappedAppeal>> {
  const res = await apiRequest("adminAppeal", { params: { id }, timeoutMs: 8000 });
  if (!res.ok) return fail(res, "无法读取该申诉");
  const item = mapRemoteAppeal(res.json);
  if (!item) return { ok: false, error: "服务器未返回申诉", status: res.status, json: res.json };
  return ok(res, item);
}

export async function remoteDecideAppeal(id: string, action: "accept" | "reject", note?: string): Promise<Remote<MappedAppeal>> {
  const res = await apiRequest("adminAppealDecision", {
    method: "POST",
    params: { id },
    body: { action, note: note || undefined, reason: note || undefined },
    timeoutMs: 8000,
  });
  if (!res.ok) return fail(res, "处理申诉失败");
  const item = mapRemoteAppeal(res.json);
  if (!item) return { ok: false, error: "服务器未返回处理结果", status: res.status, json: res.json };
  return ok(res, item);
}

/** r5 图像待人工复核。当前管理端后端尚未提供该列表时会 404。 */
export async function remoteMediaReview(query?: Record<string, string | number | undefined>): Promise<Remote<MappedMedia[]>> {
  const res = await apiRequest("adminMedia", {
    query: { scanStatus: "review", ...(query || {}) },
    timeoutMs: 8000,
  });
  if (!res.ok) return fail(res, "无法获取待复核图像");
  const rows = extractList(res.json).map((r) => mapRemoteMedia(r)).filter((x): x is MappedMedia => !!x);
  return ok(res, rows);
}

/** 用管理员令牌拉取预览图或原图。不要把令牌放进 URL。 */
export async function remoteMediaFile(id: string, kind: "preview" | "file" = "preview"): Promise<Remote<{ objectUrl: string; mime: string }>> {
  const name = kind === "file" ? "adminMediaFile" : "adminMediaPreview";
  const res = await apiBinary(name, { params: { id }, timeoutMs: 20000 });
  if (res.ok && res.blob) {
    return { ok: true, data: { objectUrl: URL.createObjectURL(res.blob), mime: res.mime }, json: null, status: res.status };
  }
  if (kind === "preview") return remoteMediaFile(id, "file");
  return { ok: false, error: res.error || "无法获取图片", status: res.status, json: null };
}


export type PublishResult = { announcement: MappedAnnouncement; already: boolean; withdrawnIds: string[] };

/** 发布公告：先用 /publish；服务器还没有这个功能时退回 PATCH {published: true}。 */
export async function remotePublishAnnouncement(id: string): Promise<Remote<PublishResult>> {
  let res = await apiRequest("adminAnnouncementPublish", { method: "POST", params: { id }, body: {}, timeoutMs: 8000 });
  if (!res.ok && isFeatureMissing(res)) {
    res = await apiRequest("adminAnnouncementPatch", { method: "PATCH", params: { id }, body: { published: true }, timeoutMs: 8000 });
    if (!res.ok && isFeatureMissing(res)) {
      res = await apiRequest("adminAnnouncementEdit", { method: "POST", params: { id }, body: { published: true }, timeoutMs: 8000 });
    }
  }
  if (!res.ok) return fail(res, "发布公告失败");
  const rec = asRecord(res.json);
  const item = mapRemoteAnnouncement(rec && rec.announcement ? rec.announcement : res.json);
  if (!item) return fail(res, "发布公告失败");
  return ok(res, { announcement: item, already: !!(rec && rec.already === true), withdrawnIds: readWithdrawnIds(res.json) });
}

export type HotList = { items: MappedHotPost[]; max: number; already: boolean };

function hotFail(res: RequestResult, fallback: string): RemoteError {
  const out = fail(res, fallback);
  return out.missing ? out : { ...out, error: hotErrorMessage(res.json, out.error) };
}

function hotOk(res: RequestResult): RemoteOk<HotList> {
  const rec = asRecord(res.json);
  const list = mapHotPostList(res.json);
  return ok(res, { ...list, already: !!(rec && rec.already === true) });
}

export async function remoteHotPosts(): Promise<Remote<HotList>> {
  const res = await apiRequest("adminHotPosts", { timeoutMs: 8000 });
  if (!res.ok) return hotFail(res, "无法获取热门话题");
  return hotOk(res);
}

export async function remoteAddHotPost(postId: string): Promise<Remote<HotList>> {
  const res = await apiRequest("adminHotPosts", { method: "POST", body: { postId }, timeoutMs: 8000 });
  if (!res.ok) return hotFail(res, "加入热门失败");
  return hotOk(res);
}

export async function remoteRemoveHotPost(postId: string): Promise<Remote<HotList>> {
  const res = await apiRequest("adminHotPostDelete", { method: "POST", params: { postId }, body: {}, timeoutMs: 8000 });
  if (!res.ok) return hotFail(res, "移出热门失败");
  return hotOk(res);
}

/** 整体提交顺序。409 ORDER_CONFLICT 时 error.items 里带着服务器当前列表。 */
export async function remoteSaveHotOrder(postIds: string[]): Promise<Remote<HotList> & { conflict?: HotList }> {
  const res = await apiRequest("adminHotPostsOrder", { method: "POST", body: { postIds }, timeoutMs: 8000 });
  if (!res.ok) {
    const out = hotFail(res, "保存顺序失败");
    if (res.status === 409 || readErrorCode(res.json) === "ORDER_CONFLICT") {
      // 定稿：当前列表平铺在 error.items 里。
      const rec = asRecord(res.json);
      const err = rec ? asRecord(rec.error) : null;
      const current = err && Array.isArray(err.items) ? mapHotPostList({ items: err.items }) : null;
      return { ...out, conflict: current ? { ...current, already: false } : { items: [], max: 0, already: false } };
    }
    return out;
  }
  return hotOk(res);
}
