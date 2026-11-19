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
    error: missing && /^adminAi(Quota|Provider)/.test(name) ? "服务器还没有更新到支持 AI 额度和服务商切换的版本" : missing && name.startsWith("adminAi") ? "服务器还没有更新到带 AI 助手的版本" : readErrorMessage(res.json, res.error || "请求失败"),
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

// ---- AI 额度 + AI 服务商切换（服务端 2.0.7 接口；管理端 2.0.6 热更新）
export type AiUsageStats = { calls: number; searches: number; errors: number; promptTokens: number; completionTokens: number; tokens: number };
export type AiQuotaItem = {
  id: string; name: string; type: string; typeName: string; model: string; builtin: boolean; keyMasked: string; configured: boolean;
  active: boolean; search: boolean; source: "provider" | "estimated" | "none"; balanceApi: boolean;
  balance: number | null; currency: string; unit: string; totalGranted: number | null; used: number | null;
  resourcePackages: { name: string; remaining: number; total?: number; unit: string; expiresAt?: number }[];
  detail: Record<string, unknown> | null; fetchedAt: number | null; error: string | null; stale: boolean;
  budgetTokens: number | null; budgetSince: number | null; usedSinceBudget: number | null; estimatedRemainingTokens: number | null;
  lowBalance: number; low: boolean; empty: boolean; usage: { today: AiUsageStats; week: AiUsageStats };
  // 额度用完自动切换（服务端 2.0.7 failover；旧服务器没有这些字段）
  priority?: number; stopBalance?: number; stopTokens?: number; exhausted?: boolean; exhaustedReason?: string | null; exhaustedAt?: number | null;
};
export type AiFailoverEvent = { at: number; from: string | null; fromName: string | null; to: string | null; toName: string | null; reason: string; kind?: string };
export type AiFailoverStatus = { enabled: boolean; lastEvent: AiFailoverEvent | null; effectiveId: string | null };
/** 服务商切换原因（和服务端 ai-failover.mjs 的 REASON_TEXT 对应）。 */
export const FAILOVER_REASON: Record<string, string> = {
  balance: "余额低于停用线", estimated: "估算剩余 token 用完", http_402: "余额不足（402）", zhipu_1113: "智谱欠费或没有可用资源包（1113）",
  zhipu_1112: "智谱余额不足（1112）", exceeded_current_quota: "Kimi 余额不足", insufficient_quota: "额度不足", arrearage: "通义账号欠费",
  siliconflow_30001: "硅基流动余额不足", message: "服务商提示余额不足", all_exhausted: "所有接口额度都用完了",
};
export const failoverReason = (r: string | null | undefined) => (r ? FAILOVER_REASON[r] || "额度用完" : "额度用完");
export type AiQuotaOverview = { providers: AiQuotaItem[]; activeId: string | null; searchProviderId: string | null; ttlMs: number; at: number; failover?: AiFailoverStatus | null; order?: string[] };
export type AiProviderType = { type: string; name: string; baseUrl: string; model: string; searchCapable: boolean; balanceApi: boolean; blocked: boolean; note: string };
export type AiProvider = {
  id: string; type: string; typeName: string; name: string; baseUrl: string; model: string; keyMasked: string; hasKey: boolean; keyBroken: boolean;
  search: boolean; searchCapable: boolean; enabled: boolean; builtin: boolean; usable: boolean; balanceApi: boolean; blocked: boolean; active: boolean; selected: boolean; priority?: number;
};
export type AiProvidersOverview = { providers: AiProvider[]; activeId: string | null; selectedId: string; fallback: boolean; searchProviderId: string | null; types: AiProviderType[]; keyStorage: string; savedId?: string; order?: string[]; failover?: AiFailoverStatus | null };
export type AiProviderDraft = { type?: string; name?: string; baseUrl?: string; apiKey?: string; model?: string; search?: boolean; enabled?: boolean };

export const aiQuota = (refresh = false) => call<AiQuotaOverview>("adminAiQuota", { query: refresh ? { refresh: 1 } : {}, timeoutMs: 20000 });
export const aiQuotaSave = (id: string, patch: { budgetTokens?: number | null; lowBalance?: number | null; stopBalance?: number; stopTokens?: number; resetSince?: boolean }) =>
  call<AiQuotaOverview>("adminAiQuotaSettings", { params: { id }, body: patch, timeoutMs: 20000 });
export const aiProviders = () => call<AiProvidersOverview>("adminAiProviders");
export const aiProviderSave = (d: AiProviderDraft, id?: string) =>
  id ? call<AiProvidersOverview>("adminAiProvider", { params: { id }, body: d }) : call<AiProvidersOverview>("adminAiProviders", { body: d });
export const aiProviderDelete = (id: string) => call<AiProvidersOverview>("adminAiProviderDelete", { params: { id }, body: {} });
export const aiProviderActivate = (id: string) => call<AiProvidersOverview>("adminAiProviderActive", { body: { id } });
export const aiProviderOrder = (ids: string[]) => call<AiProvidersOverview>("adminAiProviderOrder", { body: { ids } });
export const aiProviderRecheck = (id: string) => call<AiQuotaOverview>("adminAiProviderRecheck", { params: { id }, body: {}, timeoutMs: 20000 });
export const aiFailoverSet = (enabled: boolean) => call<AiQuotaOverview>("adminAiFailover", { body: { enabled } });
export const aiProviderTest = (id: string) =>
  call<{ test: { ok: boolean; status?: number; latencyMs?: number; error?: string; model?: string } }>("adminAiProviderTest", { params: { id }, body: {}, timeoutMs: 25000 });

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
