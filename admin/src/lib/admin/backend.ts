/**
 * NOVA 管理端 · 与用户端后端的适配层。
 *
 * 设计目标（面向未来版本的用户端/后端压缩包）：
 * 1. 接口根地址可配置（localStorage），留空表示与当前页面同源（适合预览反代）。
 * 2. 路径集中在 DEFAULT_ENDPOINT_MAP，设置页可覆盖；主路径 404 时再试别名。
 * 3. 通过 /api/health、/api/version 或响应头尽量识别后端版本；识别不到也不算失败。
 * 4. 字段名容错：username/name/displayName、vip_until/vipUntil 等都能读；未知字段忽略。
 * 5. 后端不可达或管理接口尚未实现时，列表与指标保持为空并标明「接口待接入」，绝不阻塞进入管理端；没有虚构数据，也没有演示模式。
 */

export const CONFIG_KEY = "nova-admin-api-config-v1";
export const DEFAULT_TIMEOUT_MS = 4000;

/** 当前已知 + 规划中的管理接口。新后端只要路径相近，就可以直接接上。 */
export const DEFAULT_ENDPOINT_MAP = {
  health: "/api/health",
  version: "/api/version",
  vipCatalog: "/api/vip/catalog",
  vipMe: "/api/vip/me",
  me: "/api/me",
  adminLogin: "/api/admin/auth/login",
  adminMe: "/api/admin/me",
  adminUsers: "/api/admin/users",
  adminUser: "/api/admin/users/:id",
  adminUserBan: "/api/admin/users/:id/ban",
  adminUserUnban: "/api/admin/users/:id/unban",
  adminUserResetPassword: "/api/admin/users/:id/reset-password",
  adminVipGrant: "/api/admin/vip/grant",
  adminVipRevoke: "/api/admin/vip/revoke",
  adminReports: "/api/admin/reports",
  adminContent: "/api/admin/content",
  adminAudit: "/api/admin/audit",
  adminAnnouncements: "/api/admin/announcements",
  adminAnnouncementDelete: "/api/admin/announcements/:id/delete",
  adminStats: "/api/admin/stats",
  adminLogout: "/api/admin/auth/logout",
  adminContentItem: "/api/admin/content/:type/:id",
  adminContentDelete: "/api/admin/content/:type/:id/delete",
  adminContentRestore: "/api/admin/content/:type/:id/restore",
  adminPayments: "/api/admin/payments",
  adminPayment: "/api/admin/payments/:id",
  adminPaymentConfirm: "/api/admin/payments/:id/confirm",
  adminPaymentReject: "/api/admin/payments/:id/reject",
  adminPaymentRefund: "/api/admin/payments/:id/refund",
  adminPaymentReceipt: "/api/admin/payments/:id/receipt",
  adminReport: "/api/admin/reports/:id",
  adminReportDecision: "/api/admin/reports/:id/decision",
  adminAnnouncementEdit: "/api/admin/announcements/:id/edit",
  adminAnnouncementPatch: "/api/admin/announcements/:id",
  adminAnnouncementWithdraw: "/api/admin/announcements/:id/withdraw",
  adminCommunities: "/api/admin/communities",
  adminCommunity: "/api/admin/communities/:id",
  adminChannelMessages: "/api/admin/channels/:id/messages",
  adminBlockwords: "/api/admin/blockwords",
  adminBlockwordDelete: "/api/admin/blockwords/:id/delete",
  posts: "/api/posts",
  communities: "/api/communities",
  notifications: "/api/notifications",
  stickers: "/api/stickers",
  search: "/api/search",
} as const;

export type EndpointName = keyof typeof DEFAULT_ENDPOINT_MAP;
export type EndpointMap = Record<EndpointName, string>;

/** 主路径不存在时依次尝试。 */
export const ENDPOINT_ALIASES: Partial<Record<EndpointName, string[]>> = {
  health: ["/api/health", "/health", "/api/status"],
  version: ["/api/version", "/version"],
  vipCatalog: ["/api/vip/catalog", "/api/vip"],
  adminLogin: ["/api/admin/auth/login", "/api/admin/login", "/admin/api/login"],
  adminUsers: ["/api/admin/users", "/admin/api/users", "/api/users"],
  adminReports: ["/api/admin/reports", "/api/reports"],
  adminContent: ["/api/admin/content", "/api/admin/posts", "/api/posts"],
  adminAudit: ["/api/admin/audit", "/api/audit", "/api/admin/logs"],
  adminStats: ["/api/admin/stats", "/api/stats", "/api/admin/overview"],
  adminAnnouncements: ["/api/admin/announcements", "/api/announcements"],
  adminAnnouncementDelete: ["/api/admin/announcements/:id/delete"],
  adminLogout: ["/api/admin/auth/logout", "/api/admin/logout"],
  adminContentDelete: ["/api/admin/content/:type/:id/delete", "/api/admin/posts/:id/delete"],
  adminContentRestore: ["/api/admin/content/:type/:id/restore"],
  adminPayments: ["/api/admin/payments", "/api/admin/orders", "/api/admin/pay"],
  adminPayment: ["/api/admin/payments/:id"],
  adminPaymentConfirm: ["/api/admin/payments/:id/confirm"],
  adminPaymentReject: ["/api/admin/payments/:id/reject"],
  adminPaymentRefund: ["/api/admin/payments/:id/refund"],
  adminPaymentReceipt: ["/api/admin/payments/:id/receipt"],
  adminAnnouncementEdit: ["/api/admin/announcements/:id/edit"],
  adminAnnouncementPatch: ["/api/admin/announcements/:id"],
  adminAnnouncementWithdraw: ["/api/admin/announcements/:id/withdraw"],
  adminCommunities: ["/api/admin/communities", "/api/admin/community"],
  adminCommunity: ["/api/admin/communities/:id"],
  adminChannelMessages: ["/api/admin/channels/:id/messages"],
  adminBlockwords: ["/api/admin/blockwords", "/api/admin/block-words"],
  adminBlockwordDelete: ["/api/admin/blockwords/:id/delete"],
  adminVipGrant: ["/api/admin/vip/grant", "/api/admin/vip"],
  adminVipRevoke: ["/api/admin/vip/revoke"],
  posts: ["/api/posts"],
  communities: ["/api/communities"],
  notifications: ["/api/notifications"],
  stickers: ["/api/stickers"],
  search: ["/api/search"],
};

export type ConnectionMode = "live" | "degraded" | "demo";

export type ConnectionStatus = {
  mode: ConnectionMode;
  baseUrl: string;
  reachable: boolean;
  detectedVersion: string | null;
  available: Partial<Record<EndpointName, string>>;
  message: string;
  lastChecked: number;
  catalog: unknown | null;
  rawHealth: unknown | null;
  /** 接口已存在但返回 401/403：需要用户令牌，管理端没有管理员鉴权，不能当已拉到数据。 */
  authRequired: Partial<Record<EndpointName, string>>;
};

export type ApiConfig = {
  baseUrl: string;
  timeoutMs: number;
  token: string;
  endpoints: Partial<EndpointMap>;
};

export const emptyConnection = (baseUrl = ""): ConnectionStatus => ({
  mode: "demo",
  baseUrl,
  reachable: false,
  detectedVersion: null,
  available: {},
  message: "未连接后端。列表与统计为空，没有虚构数字。",
  lastChecked: 0,
  catalog: null,
  rawHealth: null,
  authRequired: {},
});

function canUseStorage() {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const k = "__nova_probe__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function loadConfig(): ApiConfig {
  const fallback: ApiConfig = { baseUrl: "", timeoutMs: DEFAULT_TIMEOUT_MS, token: "", endpoints: {} };
  if (!canUseStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY);
    if (!raw) return fallback;
    const data = JSON.parse(raw) as Partial<ApiConfig>;
    return {
      baseUrl: typeof data.baseUrl === "string" ? data.baseUrl.trim() : "",
      timeoutMs: typeof data.timeoutMs === "number" && data.timeoutMs > 0 ? data.timeoutMs : DEFAULT_TIMEOUT_MS,
      token: typeof data.token === "string" ? data.token : "",
      endpoints: data.endpoints && typeof data.endpoints === "object" ? data.endpoints : {},
    };
  } catch {
    return fallback;
  }
}

export function saveConfig(patch: Partial<ApiConfig>) {
  const next = { ...loadConfig(), ...patch };
  next.baseUrl = (next.baseUrl || "").trim().replace(/\/+$/, "");
  if (!canUseStorage()) return next;
  try {
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — keep in-memory only */
  }
  return next;
}

/**
 * 打包时写入的默认接口根地址（VITE_NOVA_API_BASE）。未设置则为空字符串。
 * 优先级见 resolveBase：用户在「设置服务器」里保存的地址 > 此值 > 网页同源。
 */
export function builtInApiBase(): string {
  // Must be a static `import.meta.env.VITE_*` access so Vite inlines the value at build time.
  const v = import.meta.env.VITE_NOVA_API_BASE;
  return typeof v === "string" ? v.trim().replace(/\/+$/, "") : "";
}

export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const proto = window.location.protocol;
  if (proto === "capacitor:" || proto === "ionic:" || proto === "file:") return true;
  const cap = (window as unknown as { Capacitor?: unknown }).Capacitor;
  return typeof cap !== "undefined" && cap !== null;
}

/**
 * 解析接口根地址。
 * 优先级：用户传入 / localStorage「设置服务器」覆盖（非空）> VITE_NOVA_API_BASE > http(s) 网页同源。
 * Capacitor / file:// 没有可用的「同源后端」，未配置时返回空字符串。
 */
export function resolveBase(baseUrl?: string, envBase?: string) {
  const user = (baseUrl !== undefined ? baseUrl : loadConfig().baseUrl).trim().replace(/\/+$/, "");
  if (user) return user;
  const builtIn = (envBase !== undefined ? envBase : builtInApiBase()).trim().replace(/\/+$/, "");
  if (builtIn) return builtIn;
  if (typeof window === "undefined") return "";
  if (isNativeShell()) return "";
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    return window.location.origin;
  }
  return "";
}

export function joinUrl(base: string, path: string) {
  if (!path) return base;
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base.replace(/\/+$/, "")}${p}`;
}

export function pathTemplate(path: string, params: Record<string, string> = {}) {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_, k) => encodeURIComponent(params[k] ?? `:${k}`));
}

function pathsFor(name: EndpointName, overrides: Partial<EndpointMap>): string[] {
  const primary = overrides[name] || DEFAULT_ENDPOINT_MAP[name];
  const aliases = ENDPOINT_ALIASES[name] || [];
  const out: string[] = [];
  for (const p of [primary, ...aliases]) {
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

export type RequestResult = {
  ok: boolean;
  status: number;
  path: string;
  url: string;
  json: unknown;
  headers: Record<string, string>;
  error?: string;
};

function parseJsonSafe(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 400) };
  }
}

let unauthorizedHandler: ((result: RequestResult) => void) | null = null;

/** 注册 401 处理（例如清掉令牌并回到登录页）。登录接口本身的 401（口令错误）不会触发。 */
export function setUnauthorizedHandler(fn: ((result: RequestResult) => void) | null) {
  unauthorizedHandler = fn;
}

function maybeUnauthorized(name: EndpointName, token: string, result: RequestResult) {
  // 只有管理接口的 401 才算会话过期。用管理员令牌去探用户接口（帖子、社区等）也会 401，不能因此退出。
  if (!String(name).startsWith("admin")) return;
  if (name === "adminLogin") return;
  if (!token) return;
  if (result.status === 401 && unauthorizedHandler) {
    try {
      unauthorizedHandler(result);
    } catch {
      /* ignore */
    }
  }
}

export async function apiRequest(
  name: EndpointName,
  options: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
    query?: Record<string, string | number | undefined>;
    baseUrl?: string;
    token?: string;
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<RequestResult> {
  const cfg = loadConfig();
  const base = resolveBase(options.baseUrl ?? cfg.baseUrl);
  const token = options.token ?? cfg.token;
  const timeoutMs = options.timeoutMs ?? cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const method = (options.method || "GET").toUpperCase();
  if (!base) {
    return { ok: false, status: 0, path: DEFAULT_ENDPOINT_MAP[name], url: "", json: null, headers: {}, error: "未配置接口地址（file:// 下请手动填写）。" };
  }

  let last: RequestResult | null = null;
  for (const template of pathsFor(name, cfg.endpoints)) {
    const path = pathTemplate(template, options.params);
    let url = joinUrl(base, path);
    if (options.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += (url.includes("?") ? "&" : "?") + s;
    }
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : 0;
    try {
      const headers: Record<string, string> = { Accept: "application/json", ...(options.headers || {}) };
      if (options.body !== undefined) headers["Content-Type"] = "application/json";
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller ? controller.signal : undefined,
        credentials: "omit",
      });
      const text = await res.text();
      const json = parseJsonSafe(text);
      const hdrs: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        hdrs[k.toLowerCase()] = v;
      });
      const ct = hdrs["content-type"] || "";
      const looksJson =
        ct.includes("json") ||
        (json !== null && typeof json === "object" && !("raw" in (json as object) && Object.keys(json as object).length === 1));
      // 预览服务会把未知路径回退成管理端 HTML（200），不能当成管理接口存在。
      if (!looksJson) {
        last = { ok: false, status: 404, path, url, json: null, headers: hdrs, error: "响应不是 JSON，视为接口不存在" };
        continue;
      }
      last = { ok: res.ok, status: res.status, path, url, json, headers: hdrs };
      // 404 → try the next alias; any other response is "this is the path".
      if (res.status !== 404) {
        maybeUnauthorized(name, token, last);
        return last;
      }
    } catch (err) {
      const message = err instanceof Error ? (err.name === "AbortError" ? "连接超时" : err.message) : "网络错误";
      last = { ok: false, status: 0, path, url, json: null, headers: {}, error: message };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  if (last) maybeUnauthorized(name, token, last);
  return last ?? { ok: false, status: 0, path: "", url: "", json: null, headers: {}, error: "没有可尝试的路径" };
}

export function detectVersion(json: unknown, headers: Record<string, string> = {}): string | null {
  const header = headers["x-nova-version"] || headers["x-api-version"] || headers["x-app-version"];
  if (header) return header;
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  for (const key of ["version", "apiVersion", "api_version", "appVersion", "build", "release", "name"]) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  // 健康检查是 {status:'ok', time}（M2–M4 均如此），没有版本号。
  if (o.status === "ok" && "time" in o) return "NOVA 用户端后端（/api/health 正常，未声明版本号）";
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function pick(obj: unknown, ...keys: string[]): unknown {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    const parts = key.split(".");
    let cur: unknown = obj;
    let ok = true;
    for (const part of parts) {
      if (!isRecord(cur) || !(part in cur)) {
        ok = false;
        break;
      }
      cur = cur[part];
    }
    if (ok && cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
}

export function extractList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return [];
  for (const key of ["users", "members", "items", "data", "results", "list", "rows", "records", "orders", "payments", "audits", "announcements", "reports", "posts", "comments", "communities", "blockwords", "messages", "channels"]) {
    const v = data[key];
    if (Array.isArray(v)) return v;
    if (isRecord(v) && Array.isArray(v.items)) return v.items;
    if (isRecord(v) && Array.isArray(v.users)) return v.users;
  }
  return [];
}

function asString(v: unknown, fallback = ""): string {
  if (v === undefined || v === null) return fallback;
  return String(v);
}

/**
 * 把后端给出的 UTC 时间点解析成 Date。
 * 优先 ISO（createdAtUtc，带 Z 或偏移）；数字按 UTC 纪元；
 * 无时区的 "YYYY-MM-DD HH:mm[:ss]" 视为 UTC。显示时用本机时区。
 */
export function parseUtcDate(v: unknown): Date | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v > 0 && v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return parseUtcDate(Number(s));
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** 在设备本地时区格式化 UTC 时间。所有管理端展示时间都走这里。 */
export function formatAdminTime(v: unknown, fallback = ""): string {
  const d = parseUtcDate(v);
  if (!d) return fallback;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function asTime(v: unknown): string {
  return formatAdminTime(v, "");
}

function asVipUntil(v: unknown): number | null {
  if (v === undefined || v === null || v === false || v === "") return null;
  if (typeof v === "boolean") return null;
  if (typeof v === "number") return v < 1e12 && v > 1e9 ? v * 1000 : v;
  if (typeof v === "string") {
    if (/^\d+$/.test(v)) return asVipUntil(Number(v));
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export type MappedMember = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  status: "active" | "banned";
  presence: "online" | "away" | "offline";
  vipUntil: number | null;
  joinedAt: string;
  lastLogin: string;
  violations: number;
  bio: string;
  posts: number;
  canPost: boolean;
  canComment: boolean;
  tempCode: string | null;
  mustChangePw: boolean;
  username: string;
};

export function mapRemoteUser(raw: unknown): MappedMember | null {
  if (!isRecord(raw)) return null;
  const profile = isRecord(raw.profile) ? raw.profile : {};
  const id = asString(pick(raw, "id", "userId", "user_id", "uid", "publicId"));
  if (!id) return null;
  const statusRaw = asString(pick(raw, "status", "accountStatus", "state"), "active").toLowerCase();
  const banned = statusRaw === "banned" || statusRaw === "disabled" || statusRaw === "blocked" || raw.banned === true;
  const presenceRaw = asString(pick(raw, "presence", "onlineStatus"), "").toLowerCase();
  const presence: MappedMember["presence"] =
    presenceRaw === "online" || raw.online === true ? "online" : presenceRaw === "away" ? "away" : "offline";
  const vipUntil = asVipUntil(
    pick(raw, "vipUntil", "vip_until", "vip.until", "vip.vipUntil", "membership.until", "vipExpiresAt"),
  );
  return {
    id,
    name: asString(
      pick(raw, "name", "username", "displayName", "display_name", "profile.displayName", "profile.name") ??
        pick(profile, "displayName", "name", "username"),
      id,
    ),
    email: asString(pick(raw, "email", "mail", "emailAddress")),
    avatar: asString(pick(raw, "avatar", "avatarUrl", "avatar_url", "profile.avatar", "profile.avatarUrl", "photo")),
    status: banned ? "banned" : "active",
    presence,
    vipUntil,
    joinedAt: asTime(pick(raw, "createdAtUtc", "joinedAt", "createdAt", "created_at", "registeredAt")),
    lastLogin: asTime(pick(raw, "lastLoginAtUtc", "lastLogin", "last_login_at", "lastLoginAt", "seenAt")),
    violations: Number(pick(raw, "violations", "violationCount", "strikes") ?? 0) || 0,
    bio: asString(pick(raw, "bio", "profile.bio", "introduction", "intro")),
    posts: Number(pick(raw, "posts", "postCount", "postsCount") ?? 0) || 0,
    canPost: pick(raw, "canPost", "permissions.post") === false ? false : true,
    canComment: pick(raw, "canComment", "permissions.comment") === false ? false : true,
    tempCode:
      asString(pick(raw, "temporaryPassword", "temporary_password", "tempCode", "temp_code", "resetCode")) || null,
    mustChangePw: raw.mustChangePw === true || raw.must_change_pw === true,
    username: asString(pick(raw, "username", "userName", "account"), ""),
  };
}

/** 把后端 VIP 目录里的 entitlement key 尽量对到管理端开关。未知的保留原 key。 */
export const ENTITLEMENT_ALIASES: Record<string, string> = {
  vip_badge: "badge.vip",
  "badge.vip": "badge.vip",
  profile_theme_gold: "theme.profile",
  "theme.profile": "theme.profile",
  profile_decoration: "theme.profile",
  personal_saved_items_plus: "quota.save",
  "quota.save": "quota.save",
  post_length_plus: "quota.post",
  "quota.post": "quota.post",
  sticker_pack_exclusive: "pack.sticker",
  "pack.sticker": "pack.sticker",
};

export function mapCatalogEntitlements(
  catalog: unknown,
  current: Record<string, boolean>,
): Record<string, boolean> {
  const next = { ...current };
  if (!isRecord(catalog)) return next;
  const ents = isRecord(catalog.entitlements)
    ? catalog.entitlements
    : isRecord(catalog.features)
      ? catalog.features
      : catalog.entitlements;
  if (!isRecord(ents) && !Array.isArray(ents)) return next;
  const entries = Array.isArray(ents)
    ? ents.map((item, i) => [asString(isRecord(item) ? item.key ?? item.id : i), item] as const)
    : Object.entries(ents);
  for (const [rawKey, val] of entries) {
    const key = ENTITLEMENT_ALIASES[rawKey] || rawKey;
    if (typeof val === "boolean") next[key] = val;
    else if (isRecord(val)) {
      const enabled = val.enabled ?? val.vip ?? val.on ?? val.live ?? val.status;
      if (typeof enabled === "boolean") next[key] = enabled;
      else if (enabled === "live" || enabled === "on" || enabled === "enabled") next[key] = true;
    }
  }
  return next;
}

const PROBE_GET: EndpointName[] = [
  "health",
  "version",
  "vipCatalog",
  "stickers",
  "posts",
  "communities",
  "notifications",
  "search",
  "adminUsers",
  "adminStats",
  "adminReports",
  "adminContent",
  "adminAudit",
  "adminAnnouncements",
  "adminPayments",
  "adminCommunities",
  "adminBlockwords",
];

const QUICK_PROBE: EndpointName[] = ["stickers", "posts", "communities", "notifications"];


export async function probeConnection(baseUrl?: string, timeoutMs?: number, quick = false): Promise<ConnectionStatus> {
  const cfg = loadConfig();
  const base = resolveBase(baseUrl ?? cfg.baseUrl);
  const status = emptyConnection(base);
  status.lastChecked = Date.now();
  if (!base) {
    status.message = "未填写接口地址。在 iPhone 上用文件打开时请手动填写用户端后端网址；预览链接下可留空使用同源反代。";
    return status;
  }

  const budget = timeoutMs ?? Math.max(cfg.timeoutMs, 2500);
  const started = Date.now();
  const remain = () => Math.max(800, budget - (Date.now() - started));

  const health = await apiRequest("health", { baseUrl: base, timeoutMs: remain() });
  status.rawHealth = health.json;
  if (!health.ok) {
    status.reachable = false;
    status.mode = "demo";
    status.message = `无法连接后端（${health.error || "HTTP " + health.status}）。列表保持为空，未使用虚构数据。`;
    return status;
  }

  status.reachable = true;
  status.detectedVersion = detectVersion(health.json, health.headers);
  status.available.health = health.path;

  const version = await apiRequest("version", { baseUrl: base, timeoutMs: remain() });
  if (version.ok) {
    status.available.version = version.path;
    status.detectedVersion = detectVersion(version.json, version.headers) || status.detectedVersion;
  }

  const catalog = await apiRequest("vipCatalog", { baseUrl: base, timeoutMs: remain() });
  if (catalog.ok) {
    status.available.vipCatalog = catalog.path;
    status.catalog = catalog.json;
  }

  const extra = quick ? QUICK_PROBE : PROBE_GET;
  for (const name of extra) {
    if (name === "health" || name === "version" || name === "vipCatalog") continue;
    if (remain() < 600) break;
    const res = await apiRequest(name, { baseUrl: base, timeoutMs: Math.min(1500, remain()) });
    if (res.status === 401 || res.status === 403) {
      status.authRequired[name] = res.path;
    } else if (res.ok && res.status && res.status !== 404) {
      status.available[name] = res.path;
    } else if (res.status && res.status !== 404 && res.status !== 0) {
      // 例如 405、500：路径存在但不能当已取到数据
      status.authRequired[name] = res.path;
    }
  }

  const adminKeys = Object.keys(status.available).filter((k) => k.startsWith("admin"));
  const gated = Object.keys(status.authRequired);
  if (adminKeys.length > 0) {
    status.mode = "live";
    status.message = `已连接${status.detectedVersion ? " · " + status.detectedVersion : ""}。发现 ${adminKeys.length} 个管理接口，将优先用服务器数据；其余显示「接口待接入」，不用虚构数字。`;
  } else {
    status.mode = "degraded";
    const adminGated = gated.filter((k) => k.startsWith("admin"));
    const gatedNote = adminGated.length
      ? "管理接口已存在，请先登录管理员账号。"
      : gated.length
        ? `已探测到需登录的接口（${gated.join("、")}）。`
        : "";
    status.message = `后端已连通${status.detectedVersion ? "（" + status.detectedVersion + "）" : ""}。${gatedNote || "管理专用接口尚未对当前会话开放。"}VIP 目录${status.catalog ? "已从服务器读取" : "未能读取"}。不用虚构数字。`;
  }
  return status;
}

export function readErrorMessage(json: unknown, fallback: string): string {
  if (!isRecord(json)) return fallback;
  const err = json.error;
  if (typeof err === "string") return err;
  if (isRecord(err) && typeof err.message === "string") return err.message;
  if (typeof json.message === "string") return json.message;
  return fallback;
}


export const VIP_PRICES = [
  { period: "month", days: 30, amountCents: 990, label: "¥9.9/月" },
  { period: "year", days: 365, amountCents: 9900, label: "¥99/年" },
] as const;

export type MappedAdmin = {
  id: string;
  username: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt: string;
  expiresAt: number | null;
};

export function mapRemoteAdmin(raw: unknown): MappedAdmin | null {
  const src = isRecord(raw) && isRecord(raw.admin) ? raw.admin : raw;
  if (!isRecord(src)) return null;
  const id = asString(pick(src, "id", "adminId", "admin_id"));
  const username = asString(pick(src, "username", "name", "account"));
  if (!id && !username) return null;
  const expires = pick(raw, "expiresAt", "expires_at");
  return {
    id: id || username,
    username: username || id,
    email: asString(pick(src, "email")),
    role: asString(pick(src, "role"), "admin"),
    status: asString(pick(src, "status"), "active"),
    createdAt: asTime(pick(src, "createdAt", "created_at")),
    lastLoginAt: asTime(pick(src, "lastLoginAt", "last_login_at")),
    expiresAt: typeof expires === "number" ? expires : expires ? Number(expires) || null : null,
  };
}

export function pickToken(raw: unknown): string {
  if (!isRecord(raw)) return "";
  const t = pick(raw, "token", "accessToken", "access_token", "adminToken");
  return typeof t === "string" ? t.trim() : "";
}

export type MappedReplyTo = {
  id: string;
  deleted: boolean;
  missing?: boolean;
  authorName: string;
  text: string;
};

export type MappedContent = {
  id: string;
  type: "post" | "comment";
  title: string;
  text: string;
  authorId: string;
  authorName: string;
  time: string;
  status: "approved" | "removed";
  image: string;
  postId: string;
  adminReason: string;
  adminHidden: boolean;
  parentId: string;
  rootId: string;
  depth: number;
  replyTo: MappedReplyTo | null;
  replyCount: number;
};

export function mapRemoteContent(raw: unknown, fallbackType: "post" | "comment" = "post"): MappedContent | null {
  if (!isRecord(raw)) return null;
  const id = asString(pick(raw, "id", "postId", "commentId", "contentId"));
  if (!id) return null;
  const typeRaw = asString(pick(raw, "type", "kind"), fallbackType).toLowerCase();
  const type: "post" | "comment" = typeRaw === "comment" ? "comment" : "post";
  const author = isRecord(raw.author) ? raw.author : {};
  const deleted = raw.deleted === true || raw.status === "removed" || raw.status === "deleted" || !!pick(raw, "deletedAt", "deleted_at");
  const text = asString(pick(raw, "text", "body", "content", "excerpt"));
  const replyRaw = isRecord(raw.replyTo) ? raw.replyTo : isRecord(raw.reply_to) ? raw.reply_to : null;
  const replyAuthor = replyRaw && isRecord(replyRaw.author) ? replyRaw.author : {};
  const replyTo: MappedReplyTo | null = replyRaw
    ? {
        id: asString(pick(replyRaw, "id")),
        deleted: replyRaw.deleted === true || replyRaw.missing === true,
        missing: replyRaw.missing === true,
        authorName: asString(pick(replyAuthor, "displayName", "username", "name") ?? pick(replyRaw, "authorName"), ""),
        text: asString(pick(replyRaw, "text", "excerpt")),
      }
    : null;
  return {
    id,
    type,
    title: asString(pick(raw, "title"), text.slice(0, 40) || (type === "comment" ? "评论" : "动态")),
    text,
    authorId: asString(pick(raw, "authorId", "author_id", "userId") ?? pick(author, "id")),
    authorName: asString(pick(raw, "authorName") ?? pick(author, "displayName", "username", "name"), "未知"),
    time: asTime(pick(raw, "createdAtUtc", "created_at_utc", "createdAt", "created_at", "time")),
    status: deleted ? "removed" : "approved",
    image: asString(pick(raw, "image", "imageUrl", "cover")),
    postId: asString(pick(raw, "postId", "post_id")),
    adminReason: asString(pick(raw, "adminReason", "admin_reason", "reason")),
    adminHidden: raw.adminHidden === true || raw.admin_hidden === true,
    parentId: asString(pick(raw, "parentId", "parent_id")),
    rootId: asString(pick(raw, "rootId", "root_id"), id),
    depth: Number(pick(raw, "depth") ?? 0) || 0,
    replyTo,
    replyCount: Number(pick(raw, "replyCount", "reply_count") ?? 0) || 0,
  };
}

export type PaymentStatus = "pending" | "awaiting_review" | "paid" | "rejected" | "expired" | "refunded" | "unknown";

export type MappedPayment = {
  id: string;
  code: string;
  userId: string;
  userName: string;
  userEmail: string;
  provider: string;
  method: string;
  methodName: string;
  period: string;
  plan: string;
  amountCents: number;
  amountLabel: string;
  currency: string;
  status: PaymentStatus;
  note: string;
  rejectReason: string;
  expiresAt: string;
  createdAt: string;
  paidAt: string;
  hasReceipt: boolean;
  receiptUrl: string;
  receiptMime: string;
  receiptName: string;
  days: number;
  vipUntil: string;
  vipEventId: string;
  reviewedBy: string;
  events: unknown[];
  rawUserVipUntil: number | null;
};

const PAY_STATUSES: PaymentStatus[] = ["pending", "awaiting_review", "paid", "rejected", "expired", "refunded"];

export function mapRemotePayment(raw: unknown): MappedPayment | null {
  if (!isRecord(raw)) return null;
  const id = asString(pick(raw, "id", "orderId", "order_id"));
  if (!id) return null;
  const user = isRecord(raw.user) ? raw.user : {};
  const statusRaw = asString(pick(raw, "status"), "unknown");
  const status = (PAY_STATUSES as string[]).includes(statusRaw) ? (statusRaw as PaymentStatus) : "unknown";
  const cents = Number(pick(raw, "amountCents", "amount_cents", "amount") ?? 0) || 0;
  const period = asString(pick(raw, "period"), "");
  const price = VIP_PRICES.find((p) => p.period === period);
  return {
    id,
    code: asString(pick(raw, "code", "orderCode", "noteCode")),
    userId: asString(pick(raw, "userId", "user_id") ?? pick(user, "id")),
    userName: asString(pick(user, "displayName", "username", "name"), asString(pick(raw, "userName"))),
    userEmail: asString(pick(user, "email")),
    provider: asString(pick(raw, "provider")),
    method: asString(pick(raw, "method")),
    methodName: asString(pick(raw, "methodName"), asString(pick(raw, "method"))),
    period,
    plan: asString(pick(raw, "plan"), "vip"),
    amountCents: cents,
    amountLabel: asString(pick(raw, "amountLabel"), price ? price.label : cents ? `¥${(cents / 100).toFixed(1)}` : ""),
    currency: asString(pick(raw, "currency"), "CNY"),
    status,
    note: asString(pick(raw, "note")),
    rejectReason: asString(pick(raw, "rejectReason", "reject_reason", "reason")),
    expiresAt: asTime(pick(raw, "expiresAtUtc", "expiresAt", "expires_at")),
    createdAt: asTime(pick(raw, "createdAtUtc", "created_at_utc", "createdAt", "created_at")),
    paidAt: asTime(pick(raw, "paidAtUtc", "paidAt", "paid_at")),
    hasReceipt: raw.hasReceipt === true || !!pick(raw, "receiptUrl", "receipt_url", "receiptPath"),
    receiptUrl: asString(pick(raw, "receiptUrl", "receipt_url")),
    receiptMime: asString(pick(raw, "receiptMime", "receipt_mime")),
    receiptName: asString(pick(raw, "receiptName", "receipt_name")),
    days: Number(pick(raw, "days") ?? (price ? price.days : 0)) || 0,
    vipUntil: asTime(pick(raw, "vipUntil", "vip_until")),
    vipEventId: asString(pick(raw, "vipEventId", "vip_event_id")),
    reviewedBy: asString(pick(raw, "reviewedBy", "reviewed_by")),
    events: Array.isArray(raw.events) ? raw.events : [],
    rawUserVipUntil: asVipUntil(pick(user, "vipUntil", "vip_until")),
  };
}

export type MappedAudit = {
  id: string;
  kind: "admin" | "security";
  action: string;
  target: string;
  time: string;
  ip: string;
  actorId: string;
  detail: unknown;
};

export function mapRemoteAudit(raw: unknown): MappedAudit | null {
  if (!isRecord(raw)) return null;
  const id = asString(pick(raw, "id"));
  if (!id) return null;
  const kindRaw = asString(pick(raw, "kind"), "");
  const action = asString(pick(raw, "action", "event", "type"));
  const kind: "admin" | "security" =
    kindRaw === "admin" || action.startsWith("admin.") ? "admin" : "security";
  return {
    id,
    kind,
    action: action || "操作",
    target: asString(pick(raw, "target", "resource")),
    time: asTime(pick(raw, "createdAtUtc", "time", "at", "createdAt", "created_at")),
    ip: asString(pick(raw, "ip")),
    actorId: asString(pick(raw, "actorId", "actor_id")),
    detail: pick(raw, "detail") ?? null,
  };
}

export type MappedAnnouncement = {
  id: string;
  title: string;
  body: string;
  published: boolean;
  withdrawn: boolean;
  time: string;
};

export function mapRemoteAnnouncement(raw: unknown): MappedAnnouncement | null {
  if (!isRecord(raw)) return null;
  const id = asString(pick(raw, "id"));
  if (!id) return null;
  const publishedFlag = pick(raw, "published");
  const published = raw.withdrawn === true || raw.status === "draft" || raw.status === "withdrawn"
    ? false
    : publishedFlag === false || publishedFlag === 0 || publishedFlag === "0" || publishedFlag === "false"
      ? false
      : publishedFlag === true || publishedFlag === 1 || publishedFlag === "1" || publishedFlag == null
        ? true
        : !!publishedFlag;
  return {
    id,
    title: asString(pick(raw, "title")),
    body: asString(pick(raw, "body", "content", "text")),
    published,
    withdrawn: raw.withdrawn === true || raw.withdrawn === 1 || !published,
    time: asTime(pick(raw, "createdAtUtc", "updatedAt", "updated_at", "createdAt", "created_at", "time")),
  };
}

export type MappedStats = {
  usersTotal: number;
  usersActive: number;
  usersBanned: number;
  usersVip: number;
  postsVisible: number;
  postsRemoved: number;
  commentsVisible: number;
  reportsPending: number;
  paymentsPending: number;
  paymentsReview: number;
};

export function mapRemoteStats(raw: unknown): MappedStats | null {
  if (!isRecord(raw)) return null;
  const users = isRecord(raw.users) ? raw.users : raw;
  const posts = isRecord(raw.posts) ? raw.posts : {};
  const comments = isRecord(raw.comments) ? raw.comments : {};
  const reports = isRecord(raw.reports) ? raw.reports : {};
  const payments = isRecord(raw.payments) ? raw.payments : {};
  const num = (...keys: string[]) => {
    for (const src of [raw, users, posts, comments, reports, payments]) {
      const v = pick(src, ...keys);
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return 0;
  };
  // 至少要能认出其中一个已知字段，避免把完全无关的对象当成统计。
  if (
    pick(users, "total", "users.total") == null &&
    pick(raw, "users") == null &&
    pick(posts, "visible") == null &&
    pick(raw, "posts") == null
  ) {
    if (typeof raw.users !== "object" && typeof raw.posts !== "object") return null;
  }
  const n = (obj: Record<string, unknown>, ...keys: string[]) => {
    const v = pick(obj, ...keys);
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  return {
    usersTotal: n(users, "total"),
    usersActive: n(users, "active"),
    usersBanned: n(users, "banned"),
    usersVip: n(users, "vip"),
    postsVisible: n(posts, "visible"),
    postsRemoved: n(posts, "removed", "hidden"),
    commentsVisible: n(comments, "visible"),
    reportsPending: n(reports, "pending"),
    paymentsPending: n(payments, "pending"),
    paymentsReview: n(payments, "awaitingReview", "awaiting_review"),
  };
}

export type MappedReport = {
  id: string;
  title: string;
  reason: string;
  reporter: string;
  target: string;
  time: string;
  status: "open" | "done";
  resolution?: string;
  postId?: string;
  userId?: string;
};

export function mapRemoteReport(raw: unknown): MappedReport | null {
  if (!isRecord(raw)) return null;
  const id = asString(pick(raw, "id"));
  if (!id) return null;
  const reporter = isRecord(raw.reporter) ? raw.reporter : {};
  const queue = asString(pick(raw, "queueStatus", "queue_status"), "");
  const st = asString(pick(raw, "status"), "pending");
  const done = queue === "done" || st === "resolved" || st === "rejected" || st === "done";
  const decision = isRecord(raw.decision) ? raw.decision : {};
  const targetType = asString(pick(raw, "targetType", "target_type"));
  const targetId = asString(pick(raw, "targetId", "target_id"));
  return {
    id,
    title: asString(pick(raw, "title"), "举报"),
    reason: asString(pick(raw, "reason", "detail")),
    reporter: asString(pick(reporter, "displayName", "username", "name"), asString(pick(raw, "reporter"))),
    target: asString(pick(raw, "target"), targetType && targetId ? `${targetType}:${targetId}` : ""),
    time: asTime(pick(raw, "createdAtUtc", "time", "createdAt", "created_at")),
    status: done ? "done" : "open",
    resolution: asString(pick(decision, "resolution", "note") ?? pick(raw, "resolution")) || undefined,
    postId: targetType === "post" ? targetId : undefined,
    userId: asString(pick(raw, "targetUserId", "target_user_id", "userId")) || undefined,
  };
}

export type BinaryResult = {
  ok: boolean;
  status: number;
  path: string;
  url: string;
  blob: Blob | null;
  mime: string;
  error?: string;
};

/** 拉取需鉴权的二进制（付款截图）。401 同样会触发未授权处理。 */
export async function apiBinary(
  name: EndpointName,
  options: {
    params?: Record<string, string>;
    query?: Record<string, string | number | undefined>;
    baseUrl?: string;
    token?: string;
    timeoutMs?: number;
  } = {},
): Promise<BinaryResult> {
  const cfg = loadConfig();
  const base = resolveBase(options.baseUrl ?? cfg.baseUrl);
  const token = options.token ?? cfg.token;
  const timeoutMs = options.timeoutMs ?? Math.max(cfg.timeoutMs, 15000);
  if (!base) {
    return { ok: false, status: 0, path: DEFAULT_ENDPOINT_MAP[name], url: "", blob: null, mime: "", error: "未配置接口地址" };
  }
  let last: BinaryResult | null = null;
  for (const template of pathsFor(name, cfg.endpoints)) {
    const path = pathTemplate(template, options.params);
    let url = joinUrl(base, path);
    if (options.query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(options.query)) {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += (url.includes("?") ? "&" : "?") + s;
    }
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : 0;
    try {
      const headers: Record<string, string> = { Accept: "image/*,application/octet-stream,application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: controller ? controller.signal : undefined,
        credentials: "omit",
      });
      const ct = res.headers.get("content-type") || "";
      if (res.status === 401) {
        const text = await res.text();
        const json = parseJsonSafe(text);
        maybeUnauthorized(name, token, { ok: false, status: 401, path, url, json, headers: {}, error: readErrorMessage(json, "登录已过期") });
        return { ok: false, status: 401, path, url, blob: null, mime: ct, error: readErrorMessage(json, "登录已过期，请重新登录") };
      }
      if (!res.ok) {
        const text = await res.text();
        const json = parseJsonSafe(text);
        last = { ok: false, status: res.status, path, url, blob: null, mime: ct, error: readErrorMessage(json, "无法获取文件") };
        if (res.status !== 404) return last;
        continue;
      }
      if (ct.includes("json") || ct.includes("text/html")) {
        last = { ok: false, status: 404, path, url, blob: null, mime: ct, error: "响应不是图片" };
        continue;
      }
      const buf = await res.arrayBuffer();
      const mime = ct.split(";")[0] || "application/octet-stream";
      return { ok: true, status: res.status, path, url, blob: new Blob([buf], { type: mime }), mime };
    } catch (err) {
      const message = err instanceof Error ? (err.name === "AbortError" ? "连接超时" : err.message) : "网络错误";
      last = { ok: false, status: 0, path, url, blob: null, mime: "", error: message };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return last ?? { ok: false, status: 0, path: "", url: "", blob: null, mime: "", error: "没有可尝试的路径" };
}

export function unwrapUser(json: unknown): unknown {
  if (!isRecord(json)) return json;
  if (isRecord(json.user)) return json.user;
  return json;
}

export function paymentStatusLabel(status: PaymentStatus | string): string {
  switch (status) {
    case "pending":
      return "待付款";
    case "awaiting_review":
      return "待审核";
    case "paid":
      return "已开通";
    case "rejected":
      return "已拒绝";
    case "expired":
      return "已过期";
    case "refunded":
      return "已退款";
    default:
      return String(status || "未知");
  }
}

export function formatCents(cents: number, currency = "CNY"): string {
  if (!Number.isFinite(cents)) return "";
  const n = cents / 100;
  const prefix = currency === "CNY" || currency === "RMB" ? "¥" : "";
  return prefix + (Number.isInteger(n) ? String(n) : n.toFixed(1));
}


export type MappedCommunity = {
  id: string;
  name: string;
  description: string;
  visibility: string;
  ownerId: string;
  memberCount: number;
  createdAt: string;
  members: MappedCommunityMember[];
  channels: MappedChannel[];
};

export type MappedCommunityMember = {
  userId: string;
  username: string;
  role: string;
  status: string;
  joinedAt: string;
};

export type MappedChannel = {
  id: string;
  name: string;
  kind: string;
  isDefault: boolean;
  messageCount: number;
  communityId: string;
};

export type MappedChannelMessage = {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  text: string;
  time: string;
};

export function mapRemoteCommunity(raw: unknown): MappedCommunity | null {
  const src = isRecord(raw) && isRecord(raw.community) ? raw.community : raw;
  if (!isRecord(src)) return null;
  const id = asString(pick(src, "id"));
  if (!id) return null;
  const membersRaw = Array.isArray(src.members) ? src.members : [];
  const channelsRaw = Array.isArray(src.channels) ? src.channels : [];
  return {
    id,
    name: asString(pick(src, "name"), "未命名社区"),
    description: asString(pick(src, "description", "desc")),
    visibility: asString(pick(src, "visibility"), "public"),
    ownerId: asString(pick(src, "ownerId", "owner_id") ?? (isRecord(src.owner) ? src.owner.id : "")),
    memberCount: Number(pick(src, "memberCount", "member_count", "membersCount") ?? membersRaw.length) || 0,
    createdAt: asTime(pick(src, "createdAtUtc", "createdAt", "created_at")),
    members: membersRaw.map((m): MappedCommunityMember | null => {
      if (!isRecord(m)) return null;
      const user = isRecord(m.user) ? m.user : {};
      return {
        userId: asString(pick(m, "userId", "user_id", "id") ?? pick(user, "id")),
        username: asString(pick(m, "username", "displayName", "name") ?? pick(user, "username", "displayName"), ""),
        role: asString(pick(m, "role"), "member"),
        status: asString(pick(m, "status"), "active"),
        joinedAt: asTime(pick(m, "joinedAtUtc", "joinedAt", "joined_at")),
      };
    }).filter((x): x is MappedCommunityMember => !!x && !!x.userId),
    channels: channelsRaw.map((c) => mapRemoteChannel(c, id)).filter((x): x is MappedChannel => !!x),
  };
}

export function mapRemoteChannel(raw: unknown, communityId = ""): MappedChannel | null {
  if (!isRecord(raw)) return null;
  const id = asString(pick(raw, "id"));
  if (!id) return null;
  return {
    id,
    name: asString(pick(raw, "name"), "频道"),
    kind: asString(pick(raw, "kind", "kindKey"), "text"),
    isDefault: raw.isDefault === true || raw.is_default === true,
    messageCount: Number(pick(raw, "messageCount", "message_count") ?? 0) || 0,
    communityId: asString(pick(raw, "communityId", "community_id"), communityId),
  };
}

export function mapRemoteChannelMessage(raw: unknown): MappedChannelMessage | null {
  if (!isRecord(raw)) return null;
  const id = asString(pick(raw, "id"));
  if (!id) return null;
  const author = isRecord(raw.author) ? raw.author : {};
  return {
    id,
    channelId: asString(pick(raw, "channelId", "channel_id")),
    authorId: asString(pick(raw, "authorId", "author_id") ?? pick(author, "id")),
    authorName: asString(pick(author, "displayName", "username", "name") ?? pick(raw, "authorName"), "未知"),
    text: asString(pick(raw, "text", "body")),
    time: asTime(pick(raw, "createdAtUtc", "created_at_utc", "createdAt", "created_at")),
  };
}

export type MappedBlockword = {
  id: string;
  word: string;
  note: string;
  createdAt: string;
  createdBy: string;
  scope: string;
};

export function mapRemoteBlockword(raw: unknown): MappedBlockword | null {
  if (!isRecord(raw)) return null;
  const id = asString(pick(raw, "id"));
  const word = asString(pick(raw, "word", "text"));
  if (!id && !word) return null;
  return {
    id: id || word,
    word,
    note: asString(pick(raw, "note")),
    createdAt: asTime(pick(raw, "createdAtUtc", "createdAt", "created_at")),
    createdBy: asString(pick(raw, "createdBy", "created_by")),
    scope: asString(pick(raw, "scope"), "platform"),
  };
}
