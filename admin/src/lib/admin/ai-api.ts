/**
 * 管理端 AI 助手 / 广告文案 / 2.0 接口的轻量调用层。
 * 路径都登记在 backend.ts 的 DEFAULT_ENDPOINT_MAP 里（以 admin 开头，401 会回到登录页）。
 * 只展示服务器返回的真实数据，不做任何本地假数据。
 */
import { apiRequest, readErrorMessage, type EndpointName } from "./backend";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number; code?: string };

export async function call<T = Record<string, unknown>>(
  name: EndpointName,
  opts: { method?: string; body?: unknown; params?: Record<string, string>; query?: Record<string, string | number | undefined>; timeoutMs?: number } = {},
): Promise<ApiResult<T>> {
  const res = await apiRequest(name, { timeoutMs: 10000, ...opts, method: opts.method || (opts.body !== undefined ? "POST" : "GET") });
  if (res.ok && res.json && typeof res.json === "object") return { ok: true, data: res.json as T };
  const j = res.json as { error?: { code?: string } } | null;
  const missing = res.status === 404 && (!j || !j.error || j.error.code === "NOT_FOUND");
  return {
    ok: false,
    status: res.status,
    code: j && j.error ? j.error.code : undefined,
    error: missing && name.startsWith("adminAi") ? "服务器还没有更新到带 AI 助手的版本" : readErrorMessage(res.json, res.error || "请求失败"),
  };
}

export type AiPending = { id: string; tool: string; summary: string; status: string; createdAt: number; expiresAt: number };
export type AiChatReply = { reply: string; pending: AiPending | null; tools?: string[]; executed?: boolean; cancelled?: boolean; result?: unknown };
export type AiStatus = { configured: boolean; provider: string; model: string; pendingTtlMs: number; tools: { read: string[]; write: string[] } };

export const aiStatus = () => call<AiStatus>("adminAiStatus");
export const aiChat = (text: string, history: { role: "user" | "assistant"; content: string }[], pendingId?: string) =>
  call<AiChatReply>("adminAiChat", { body: { text, history, pendingId }, timeoutMs: 60000 });
export const aiConfirm = (id: string) => call<AiChatReply>("adminAiConfirm", { body: { id }, timeoutMs: 30000 });
export const aiCancel = (id: string) => call<AiChatReply>("adminAiCancel", { body: { id } });

export type AdDirection = { id: number; name: string; prompt: string; preset: boolean };
export type AdCampaign = { id: number; name: string; url: string; info: string; directionId: number | null; enabled: boolean; pageTitle: string; pageDesc: string; fetchedAt: number | null; fetchError: string | null };
export type AdCopy = { id: number; campaignId: number; directionId: number | null; day: string; text: string; url: string; source: "ai" | "local"; model: string | null; trigger: string; createdAt: number };
export type AdsOverview = { directions: AdDirection[]; activeDirectionId: number | null; campaigns: AdCampaign[]; copies: AdCopy[]; schedule: { hour: number; timezone: string; lastRunDay: string | null; enabled: boolean } };

export const adsOverview = () => call<AdsOverview>("adminAds", { query: { limit: 60 } });
export const adsAddDirection = (name: string, prompt: string) => call<AdsOverview>("adminAdsDirections", { body: { name, prompt } });
export const adsDeleteDirection = (id: number) => call<AdsOverview>("adminAdsDirectionDelete", { params: { id: String(id) }, body: {} });
export const adsSetActive = (directionId: number) => call<AdsOverview>("adminAdsActive", { body: { directionId } });
export const adsSaveCampaign = (c: { id?: number; name: string; url: string; info: string; directionId: number | null; enabled: boolean; refresh?: boolean }) =>
  c.id
    ? call<AdsOverview>("adminAdsCampaign", { params: { id: String(c.id) }, body: c, timeoutMs: 15000 })
    : call<AdsOverview>("adminAdsCampaigns", { body: c, timeoutMs: 15000 });
export const adsDeleteCampaign = (id: number) => call<AdsOverview>("adminAdsCampaignDelete", { params: { id: String(id) }, body: {} });
export const adsGenerate = (campaignId?: number) => call<AdsOverview & { generated: AdCopy[] }>("adminAdsGenerate", { body: campaignId ? { campaignId } : {}, timeoutMs: 90000 });

// ---- 2.0.6 AI 自动找广告并发布营销帖（服务器默认关闭）
export type AutoAd = {
  id: string; advertiser: string; title: string; text: string; linkUrl: string; cta: string; enabled: boolean;
  impressions: number; clicks: number; createdAt: number; endsAt: number | null;
  source: "ai"; sourceUrl: string; sourceTitle: string; trigger: "schedule" | "manual" | "assistant" | null; takenDownAt: number | null; live: boolean;
};
export type AutoAdsSettings = { enabled: boolean; dailyCap: number; query: string; blockwords: string[] };
export type AutoAdsStatus = {
  envEnabled: boolean; switchOn: boolean; configured: boolean; active: boolean; hour: number; timezone: string; lastRunDay: string | null;
  todayPublished: number; dailyCap: number; capMax: number; ttlDays: number; running: boolean; defaultBlockwords: number;
};
export type AutoAdsOverview = { settings: AutoAdsSettings; status: AutoAdsStatus; ads: AutoAd[] };
export type AutoAdsLogRow = { id: number; at: number; actorId: number | null; action: string; target: string | null; detail: Record<string, unknown> | null };
export type AutoAdsRunResult = { skipped?: string; error?: string; found?: number; published?: AutoAd[]; rejected?: number; stopped?: string | null };

export const autoAdsOverview = (status: "all" | "live" | "down" = "all") => call<AutoAdsOverview>("adminAutoAds", { query: { status, limit: 200 } });
export const autoAdsSave = (patch: Partial<{ enabled: boolean; dailyCap: number; query: string; blockwords: string }>) => call<AutoAdsOverview>("adminAutoAdsSettings", { body: patch });
export const autoAdsRun = () => call<AutoAdsOverview & { result: AutoAdsRunResult }>("adminAutoAdsRun", { body: {}, timeoutMs: 180000 });
export const autoAdsTakedown = (id: string) => call<AutoAdsOverview>("adminAutoAdsTakedown", { params: { id }, body: {} });
export const autoAdsTakedownAll = () => call<AutoAdsOverview & { count: number }>("adminAutoAdsTakedownAll", { body: {} });
export const autoAdsLog = () => call<{ log: AutoAdsLogRow[] }>("adminAutoAdsLog", { query: { limit: 100 } });

// ---- 管理端 2.0
export type TagCount = { tag: string; count: number };
export const listTags = () => call<{ tags: TagCount[]; presets?: string[] }>("adminTags");
export const bulkDeleteTag = (tag: string) => call("adminTagsBulkDelete", { body: { tag } });
export const userTags = (id: string) => call<{ tags: string[] }>("adminUserTags", { params: { id } });
export const addUserTag = (id: string, tag: string) => call<{ tags: string[] }>("adminUserTags", { params: { id }, body: { tag } });
export const removeUserTag = (id: string, tag: string) => call<{ tags: string[] }>("adminUserTagDelete", { params: { id }, body: { tag } });
export const editProfile = (id: string, patch: { displayName?: string; bio?: string }) => call("adminUserProfile", { params: { id }, body: patch });
export const setFollowerBonus = (id: string, bonus: number) => call("adminUserFollowerBonus", { params: { id }, body: { bonus } });
export const setBadge = (id: string, badge: "official" | "authorized" | null) => call("adminUserBadge", { params: { id }, body: { badge } });
export const notifyUser = (id: string, title: string, body: string) => call("adminUserNotify", { params: { id }, body: { title, body } });
export const notifyMany = (title: string, body: string, userIds?: number[]) => call<{ sent: number; requested: number }>("adminNotifications", { body: { title, body, ...(userIds && userIds.length ? { userIds } : {}) }, timeoutMs: 30000 });
export const deleteUser = (id: string, confirmUsername: string) => call("adminUserDelete", { params: { id }, body: { confirm: "确认删除", confirmUsername } });
export const aiReport = (date?: string) => call<Record<string, unknown>>("adminAiReport", { query: { date } });
export const aiReportGenerate = (date?: string) => call<Record<string, unknown>>("adminAiReport", { body: { date }, timeoutMs: 40000 });
export type V2Kind = "polls" | "activities" | "exchange" | "projects";
export const v2List = (kind: V2Kind) => call<Record<string, unknown>>("adminV2List", { params: { kind }, query: { limit: 100 } });
export const v2Act = (kind: V2Kind, id: string, act: "remove" | "restore") => call(act === "remove" ? "adminV2Remove" : "adminV2Restore", { params: { kind, id }, body: {} });
