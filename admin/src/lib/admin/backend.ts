import { resolveAvatar } from "./avatar.ts";
/**
 * NOVA 管理端 · 与用户端后端的适配层。
 *
 * 设计目标（面向未来版本的用户端/后端压缩包）：
 * 1. 服务器根地址可配置（localStorage），留空表示与当前页面同源（适合预览反代）。
 * 2. 路径集中在 DEFAULT_ENDPOINT_MAP，设置页可覆盖；主路径 404 时再试别名。
 * 3. 通过 /api/health、/api/version 或响应头尽量识别后端版本；识别不到也不算失败。
 * 4. 字段名容错：username/name/displayName、vip_until/vipUntil 等都能读；未知字段忽略。
 * 5. 后端不可达或某项能力尚未实现时，列表与指标保持为空并显示简短中文提示，绝不阻塞进入管理端。
 */

export const CONFIG_KEY = "nova-admin-api-config-v1";
export const DEFAULT_TIMEOUT_MS = 4000;

/** 当前已知 + 规划中的管理端路径。新后端只要路径相近，就可以直接接上。 */
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
  // 草案 v0.1（/workspace/admin-features/api-contract.md）新增；等 Bob 的定稿后只需改这里。
  adminAnnouncementPublish: "/api/admin/announcements/:id/publish",
  adminHotPosts: "/api/admin/hot-posts",
  adminHotPostDelete: "/api/admin/hot-posts/:postId/delete",
  adminHotPostsOrder: "/api/admin/hot-posts/order",
  adminCommunities: "/api/admin/communities",
  adminCommunity: "/api/admin/communities/:id",
  adminChannelMessages: "/api/admin/channels/:id/messages",
  adminBlockwords: "/api/admin/blockwords",
  adminBlockwordDelete: "/api/admin/blockwords/:id/delete",
  adminSecurityEvents: "/api/admin/security/events",
  adminAppeals: "/api/admin/appeals",
  adminAppeal: "/api/admin/appeals/:id",
  adminAppealDecision: "/api/admin/appeals/:id/decision",
  adminMetrics: "/api/admin/metrics",
  adminMedia: "/api/admin/media",
  adminMediaItem: "/api/admin/media/:id",
  adminMediaPreview: "/api/admin/media/:id/preview",
  adminMediaFile: "/api/admin/media/:id/file",
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
  // 不再回退到 /api/announcements：那是用户端路径，可能把用户看到的公告误当成后台列表。
  adminAnnouncements: ["/api/admin/announcements"],
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
  adminAnnouncementPublish: ["/api/admin/announcements/:id/publish"],
  adminHotPosts: ["/api/admin/hot-posts"],
  adminHotPostDelete: ["/api/admin/hot-posts/:postId/delete"],
  adminHotPostsOrder: ["/api/admin/hot-posts/order"],
  adminCommunities: ["/api/admin/communities", "/api/admin/community"],
  adminCommunity: ["/api/admin/communities/:id"],
  adminChannelMessages: ["/api/admin/channels/:id/messages"],
  adminBlockwords: ["/api/admin/blockwords", "/api/admin/block-words"],
  adminBlockwordDelete: ["/api/admin/blockwords/:id/delete"],
  adminSecurityEvents: ["/api/admin/security/events", "/api/admin/security-events"],
  adminAppeals: ["/api/admin/appeals"],
  adminAppeal: ["/api/admin/appeals/:id"],
  adminAppealDecision: ["/api/admin/appeals/:id/decision"],
  adminMetrics: ["/api/admin/metrics", "/api/metrics"],
  adminMedia: ["/api/admin/media", "/api/admin/media/review"],
  adminMediaItem: ["/api/admin/media/:id"],
  adminMediaPreview: ["/api/admin/media/:id/preview"],
  adminMediaFile: ["/api/admin/media/:id/file"],
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
  /** 路径已存在但返回 401/403：需要用户令牌，管理端没有管理员鉴权，不能当已拉到数据。 */
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
  message: "网络不太好，请稍后再试",
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

/** 打开即可用的默认后端。证书就绪后把构建配置里的 scheme 改成 https，用户不用重填。 */
export const DEFAULT_API_HOST = "47.239.0.90";
export const DEFAULT_API_SCHEME = "http";
export const DEFAULT_API_BASE = `${DEFAULT_API_SCHEME}://${DEFAULT_API_HOST}`;

/**
 * 完整地址 VITE_NOVA_API_BASE 优先。
 * 否则用 VITE_NOVA_API_SCHEME（http|https，默认 http）+ VITE_NOVA_API_HOST（默认 47.239.0.90）。
 */
export function fallbackApiBase(envValue?: unknown, schemeValue?: unknown, hostValue?: unknown): string {
  const full = typeof envValue === "string" ? envValue.trim().replace(/\/+$/, "") : "";
  if (full) return full;
  const scheme = schemeValue === "https" ? "https" : DEFAULT_API_SCHEME;
  const host =
    typeof hostValue === "string" && hostValue.trim()
      ? hostValue.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "")
      : DEFAULT_API_HOST;
  return `${scheme}://${host}`;
}

export function builtInApiBase(): string {
  // Static `import.meta.env.VITE_*` accesses so Vite inlines them.
  return fallbackApiBase(
    import.meta.env.VITE_NOVA_API_BASE,
    import.meta.env.VITE_NOVA_API_SCHEME,
    import.meta.env.VITE_NOVA_API_HOST,
  );
}

export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const proto = window.location.protocol;
  if (proto === "capacitor:" || proto === "ionic:" || proto === "file:") return true;
  const cap = (window as unknown as { Capacitor?: unknown }).Capacitor;
  return typeof cap !== "undefined" && cap !== null;
}

/**
 * 解析服务器根地址。
 * 优先级：用户在「高级设置」保存的非空地址 > 打包地址或内置默认 http://47.239.0.90 > http(s) 网页同源。
 * 内置默认始终存在，因此 Capacitor / file:// 打开就会连到默认后端，不必先手填。
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

/** 注册 401 处理（例如清掉令牌并回到登录页）。登录请求本身的 401（口令错误）不会触发。 */
export function setUnauthorizedHandler(fn: ((result: RequestResult) => void) | null) {
  unauthorizedHandler = fn;
}

function maybeUnauthorized(name: EndpointName, token: string, result: RequestResult) {
  // 只有管理端路径的 401 才算会话过期。用管理员令牌去探用户路径（帖子、社区等）也会 401，不能因此退出。
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
    return { ok: false, status: 0, path: DEFAULT_ENDPOINT_MAP[name], url: "", json: null, headers: {}, error: "还没有服务器地址，请在高级设置里填写。" };
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
      // 预览服务会把未知路径回退成管理端 HTML（200），不能当成管理端已提供该能力。
      if (!looksJson) {
        last = { ok: false, status: 404, path, url, json: null, headers: hdrs, error: "服务器没有返回可用结果" };
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
  let version: string | null = header && header.trim() ? header.trim() : null;
  let commit: string | null = null;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (!version) {
      for (const key of ["version", "apiVersion", "api_version", "appVersion", "build", "release", "name"]) {
        const v = o[key];
        if (typeof v === "string" && v.trim()) {
          version = v.trim();
          break;
        }
        if (typeof v === "number") {
          version = String(v);
          break;
        }
      }
    }
    const c = o.commit ?? o.gitCommit ?? o.git_commit ?? o.sha;
    if (typeof c === "string" && c.trim()) commit = c.trim().slice(0, 7);
  }
  if (version && commit && !version.includes(commit)) return `${version} · ${commit}`;
  if (version) return version;
  if (commit) return commit;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    // 健康检查是 {status:'ok', time}（M2–M4 均如此），没有版本号。
    if (o.status === "ok" && "time" in o) return "未声明版本号";
  }
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
  for (const key of ["users", "members", "items", "data", "results", "list", "rows", "records", "orders", "payments", "audits", "announcements", "reports", "posts", "comments", "communities", "blockwords", "messages", "channels", "events", "appeals", "media"]) {
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
  avatarColor?: string;
  avatarLetter?: string;
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

/**
 * 用户端头像可能是图片地址字符串，也可能是对象：
 * { kind: "color", color: "#RRGGBB", letter: "字" } 或 { kind: "image", url: "..." }。
 * 只把真正的地址当图片，其余转成颜色加文字，避免出现 "[object Object]" 的图片请求。
 */
export function mapAvatar(v: unknown): { url: string; color: string; letter: string } {
  return resolveAvatar(v);
}

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
    ...(() => {
      const a = mapAvatar(pick(raw, "avatar", "avatarUrl", "avatar_url", "profile.avatar", "profile.avatarUrl", "photo"));
      return { avatar: a.url, avatarColor: a.color, avatarLetter: a.letter };
    })(),
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
  "adminSecurityEvents",
  "adminAppeals",
  "adminMedia",
];

const QUICK_PROBE: EndpointName[] = ["stickers", "posts", "communities", "notifications"];


export async function probeConnection(baseUrl?: string, timeoutMs?: number, quick = false): Promise<ConnectionStatus> {
  const cfg = loadConfig();
  const base = resolveBase(baseUrl ?? cfg.baseUrl);
  const status = emptyConnection(base);
  status.lastChecked = Date.now();
  if (!base) {
    status.message = "还没有服务器地址，请在高级设置里填写。";
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
    status.message = "网络不太好，请稍后再试";
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
    status.message = `已连接${status.detectedVersion ? " · " + status.detectedVersion : ""}。`;
  } else {
    status.mode = "degraded";
    const adminGated = gated.filter((k) => k.startsWith("admin"));
    const gatedNote = adminGated.length || gated.length
      ? "请先登录管理员账号。"
      : "";
    status.message = `已连上服务器${status.detectedVersion ? "（" + status.detectedVersion + "）" : ""}。${gatedNote || "部分功能暂不可用。"}`;
  }
  return status;
}

export type ServerHealthView = {
  ok: boolean | null;
  status: string | null;
  db: string | null;
  version: string | null;
  uptimeSec: number | null;
  diskFree: number | null;
  diskLow: boolean | null;
};

/** 只读取健康检查结果里实际出现的字段，缺的保持 null，不当成 0。 */
export function readHealthView(raw: unknown): ServerHealthView {
  const empty: ServerHealthView = {
    ok: null,
    status: null,
    db: null,
    version: null,
    uptimeSec: null,
    diskFree: null,
    diskLow: null,
  };
  if (!isRecord(raw)) return empty;
  const disk = isRecord(raw.disk) ? raw.disk : null;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    ok: typeof raw.ok === "boolean" ? raw.ok : null,
    status: text(raw.status),
    db: text(raw.db),
    version: text(raw.version),
    uptimeSec: num(raw.uptime),
    diskFree: disk ? num(disk.free) : null,
    diskLow: disk && typeof disk.low === "boolean" ? disk.low : null,
  };
}

export function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分钟`;
  if (m > 0) return `${m} 分钟`;
  return `${s} 秒`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = index === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[index]}`;
}

/** 列表结果若带回 total / next，用来判断已加载条数是不是全部。 */
export function listPageMeta(json: unknown, len: number, limit: number): { total: number | null; truncated: boolean } {
  const rec = isRecord(json) ? json : null;
  const raw = rec ? rec.total ?? rec.count : undefined;
  const total = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  const hasMore = !!(rec && (rec.next || rec.nextCursor || rec.cursor || rec.hasMore));
  const truncated = hasMore || (total != null && total > len) || (total == null && limit > 0 && len >= limit);
  return { total, truncated };
}

export function readErrorMessage(json: unknown, fallback: string): string {
  if (!isRecord(json)) return fallback;
  const err = json.error;
  if (typeof err === "string") return err;
  if (isRecord(err) && typeof err.message === "string") return err.message;
  if (typeof json.message === "string") return json.message;
  return fallback;
}

/** 从错误体或 Retry-After 头读取秒数。 */
export function readRetryAfter(json: unknown, headers: Record<string, string> = {}): number | null {
  const header = headers["retry-after"] || headers["Retry-After"];
  if (header && /^\d+(\.\d+)?$/.test(header.trim())) {
    const n = Number(header.trim());
    if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  }
  const rec = isRecord(json) ? json : null;
  const err = rec && isRecord(rec.error) ? rec.error : rec;
  if (!err) return null;
  const v = err.retryAfter ?? err.retry_after ?? err.retryAfterSeconds;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.ceil(v);
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim())) return Math.ceil(Number(v.trim()));
  return null;
}

/** 登录锁定 / 限流：优先展示服务器原文，必要时补上重试等待时间。 */
export function formatLockoutMessage(json: unknown, headers: Record<string, string> = {}, fallback = "尝试次数过多，请稍后再试"): string {
  const msg = readErrorMessage(json, fallback);
  const retry = readRetryAfter(json, headers);
  if (retry != null && retry > 0 && !/\d+\s*(秒|分钟|小时)/.test(msg)) {
    const pretty = retry >= 60 ? `${Math.ceil(retry / 60)} 分钟` : `${retry} 秒`;
    return `${msg}（请 ${pretty}后再试）`;
  }
  return msg;
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

export const POST_AUDIENCES = ["public", "followers", "friends", "self"] as const;
export type PostAudience = (typeof POST_AUDIENCES)[number];
/** 本地默认叫法，与 r8 服务器 AUD_LABEL / audienceLabel 一致。展示时优先用服务器给的 audienceLabel。 */
export const AUDIENCE_LABELS: Record<PostAudience, string> = {
  public: "公开",
  followers: "仅粉丝",
  friends: "仅好友",
  self: "仅自己",
};

/** 与 AUDIENCE_LABELS 同一套，避免内容和热门页各用一套词。 */
export const VISIBILITY_LABELS = AUDIENCE_LABELS;

export type PostVisibility = { isPublic: boolean | null; audience: PostAudience | ""; audienceLabel: string };

/**
 * 读帖子是否公开：优先 isPublic，其次 audience；都没有（老服务器）时 isPublic 为 null，
 * 视为未知，按可加入处理，交给服务器判断。
 */
export function readPostVisibility(raw: unknown): PostVisibility {
  if (!isRecord(raw)) return { isPublic: null, audience: "", audienceLabel: "" };
  const audience = mapAudience(raw) ?? "";
  const flag = raw.isPublic ?? raw.is_public;
  const isPublic = typeof flag === "boolean" ? flag : audience ? audience === "public" : null;
  const labelRaw = asString(pick(raw, "audienceLabel", "audience_label")).trim();
  const audienceLabel = labelRaw || (audience ? VISIBILITY_LABELS[audience] : isPublic === false ? "非公开" : "");
  return { isPublic, audience, audienceLabel };
}

/** 字段缺失时不默认成公开（管理端目前可能还没返回 audience）。非法值按公开。 */
export function mapAudience(raw: unknown): PostAudience | undefined {
  if (!isRecord(raw)) return undefined;
  const v = pick(raw, "audience");
  if (v == null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  return (POST_AUDIENCES as readonly string[]).includes(s) ? (s as PostAudience) : "public";
}

export function audienceLabel(audience: PostAudience | string | undefined): string {
  if (!audience) return "";
  return AUDIENCE_LABELS[audience as PostAudience] || AUDIENCE_LABELS.public;
}

/** r5 media.pub() 与帖子 media 数组里会出现的字段。只映射结果里真实存在的值。 */
export type MappedMedia = {
  id: string;
  url: string;
  previewUrl: string;
  kind: string;
  mime: string;
  name: string;
  width: number | null;
  height: number | null;
  hasPreview: boolean;
  scanStatus: string;
  scanDetail: string;
  score: number | null;
  ownerId: string;
};

export const SCAN_STATUS_LABELS: Record<string, string> = {
  review: "待人工复核",
  clean: "扫描通过",
  skipped: "未扫描",
  pending: "扫描中",
  blocked: "已拦截",
};

export function scanStatusLabel(status: string): string {
  if (!status) return "";
  return SCAN_STATUS_LABELS[status] || status;
}

export function isDirectMediaUrl(url: string): boolean {
  return /^(https?:|data:|blob:)/i.test(url);
}

function asOptionalNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function emptyMedia(): MappedMedia {
  return {
    id: "",
    url: "",
    previewUrl: "",
    kind: "",
    mime: "",
    name: "",
    width: null,
    height: null,
    hasPreview: false,
    scanStatus: "",
    scanDetail: "",
    score: null,
    ownerId: "",
  };
}

export function mapRemoteMedia(raw: unknown): MappedMedia | null {
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    const isUrl = /^(https?:|data:|blob:|\/)/i.test(s);
    return { ...emptyMedia(), id: isUrl ? "" : s, url: isUrl ? s : "" };
  }
  if (!isRecord(raw)) return null;
  const id = asString(pick(raw, "id", "mediaId", "media_id"));
  const url = asString(pick(raw, "url", "src", "href", "fileUrl", "file_url", "imageUrl", "image_url"));
  const previewUrl = asString(pick(raw, "previewUrl", "preview_url", "thumbnailUrl", "thumbnail_url", "thumbUrl", "thumb"));
  if (!id && !url && !previewUrl) return null;
  const mime = asString(pick(raw, "mime", "contentType", "content_type"));
  const kindRaw = asString(pick(raw, "kind", "type"));
  const kind = kindRaw && kindRaw !== mime ? kindRaw : mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : kindRaw;
  const hasPreviewField = pick(raw, "hasPreview", "has_preview");
  const hasPreview = hasPreviewField === true || hasPreviewField === 1 || !!previewUrl;
  const score =
    asOptionalNumber(pick(raw, "score", "hotP", "hotp", "nsfwScore", "nsfw_score")) ??
    null;
  const detail = asString(pick(raw, "scanDetail", "scan_detail", "reason", "detail"));
  return {
    id,
    url,
    previewUrl,
    kind,
    mime,
    name: asString(pick(raw, "name", "filename", "fileName")),
    width: asOptionalNumber(pick(raw, "width")),
    height: asOptionalNumber(pick(raw, "height")),
    hasPreview,
    scanStatus: asString(pick(raw, "scanStatus", "scan_status", "status")),
    scanDetail: detail,
    score,
    ownerId: asString(pick(raw, "ownerId", "owner_id")),
  };
}

export function parsePostMedia(raw: unknown): MappedMedia[] {
  if (raw == null || raw === "") return [];
  let src: unknown = raw;
  if (typeof raw === "string") {
    try { src = JSON.parse(raw); } catch { return []; }
  }
  const arr = Array.isArray(src) ? src : isRecord(src) && Array.isArray((src as { items?: unknown }).items) ? (src as { items: unknown[] }).items : [src];
  const out: MappedMedia[] = [];
  for (const it of arr.slice(0, 20)) {
    const row = mapRemoteMedia(it);
    if (row) out.push(row);
  }
  return out;
}

/** 列表缩略图优先用 previewUrl，否则用 url。都没有时返回空，由界面按 id 走鉴权拉取。 */
export function firstMediaImage(media: MappedMedia[]): string {
  for (const m of media) {
    if (m.previewUrl) return m.previewUrl;
    if (m.url) return m.url;
  }
  return "";
}

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
  audience?: PostAudience;
  audienceLabel?: string;
  /** 是否公开；null 表示服务器没说（老版本），按可加入处理。 */
  isPublic?: boolean | null;
  mood?: string;
  location?: string;
  media: MappedMedia[];
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
  const media = parsePostMedia(pick(raw, "media", "mediaItems", "media_items", "attachments"));
  const audience = type === "post" ? mapAudience(raw) : undefined;
  const mood = type === "post" ? asString(pick(raw, "mood")) : "";
  const location = type === "post" ? asString(pick(raw, "location")) : "";
  const mediaTitle = media.length ? `媒体 ×${media.length}` : "";
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
    title: asString(pick(raw, "title")).trim() || text.slice(0, 40) || mediaTitle || (type === "comment" ? "评论" : "动态"),
    text,
    authorId: asString(pick(raw, "authorId", "author_id", "userId") ?? pick(author, "id")),
    authorName: asString(pick(raw, "authorName") ?? pick(author, "displayName", "username", "name"), "未知"),
    time: asTime(pick(raw, "createdAtUtc", "created_at_utc", "createdAt", "created_at", "time")),
    status: deleted ? "removed" : "approved",
    image: asString(pick(raw, "image", "imageUrl", "cover"), firstMediaImage(media)),
    postId: asString(pick(raw, "postId", "post_id")),
    adminReason: asString(pick(raw, "adminReason", "admin_reason", "reason")),
    adminHidden: raw.adminHidden === true || raw.admin_hidden === true,
    parentId: asString(pick(raw, "parentId", "parent_id")),
    rootId: asString(pick(raw, "rootId", "root_id"), id),
    depth: Number(pick(raw, "depth") ?? 0) || 0,
    replyTo,
    replyCount: Number(pick(raw, "replyCount", "reply_count") ?? 0) || 0,
    audience,
    audienceLabel: type === "post" ? readPostVisibility(raw).audienceLabel || (audience ? audienceLabel(audience) : undefined) : undefined,
    isPublic: type === "post" ? readPostVisibility(raw).isPublic : undefined,
    mood: mood || undefined,
    location: location || undefined,
    media,
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

export type AnnouncementStatus = "draft" | "published" | "withdrawn";

export type MappedAnnouncement = {
  id: string;
  title: string;
  body: string;
  published: boolean;
  withdrawn: boolean;
  status: AnnouncementStatus;
  time: string;
  publishedAt: string;
  version: string;
};

export function mapRemoteAnnouncement(raw: unknown): MappedAnnouncement | null {
  if (!isRecord(raw)) return null;
  const id = asString(pick(raw, "id"));
  if (!id) return null;
  const publishedFlag = pick(raw, "published");
  const statusRaw = asString(pick(raw, "status")).toLowerCase();
  const published = raw.withdrawn === true || statusRaw === "draft" || statusRaw === "withdrawn"
    ? false
    : publishedFlag === false || publishedFlag === 0 || publishedFlag === "0" || publishedFlag === "false"
      ? false
      : publishedFlag === true || publishedFlag === 1 || publishedFlag === "1" || publishedFlag == null
        ? true
        : !!publishedFlag;
  const publishedAtRaw = pick(raw, "publishedAtUtc", "publishedAt", "published_at");
  // 新服务器会给 publishedAt：从没发布过（为空）就是草稿。旧服务器没有这个字段，未发布一律算已下线。
  const knowsPublishedAt = "publishedAt" in raw || "published_at" in raw || "publishedAtUtc" in raw;
  let status: AnnouncementStatus;
  if (statusRaw === "draft" || statusRaw === "published" || statusRaw === "withdrawn") status = statusRaw;
  else if (published) status = "published";
  else if (knowsPublishedAt && (publishedAtRaw == null || publishedAtRaw === "")) status = "draft";
  else status = "withdrawn";
  if (status !== "published" && published) status = "published";
  return {
    id,
    title: asString(pick(raw, "title")),
    body: asString(pick(raw, "body", "content", "text")),
    published: status === "published",
    withdrawn: status === "withdrawn",
    status,
    time: asTime(pick(raw, "createdAtUtc", "updatedAt", "updated_at", "createdAt", "created_at", "time")),
    publishedAt: publishedAtRaw == null || publishedAtRaw === "" ? "" : asTime(publishedAtRaw),
    version: asString(pick(raw, "version")),
  };
}

/** 公告标题、正文的字数上限（按字计算，表情等也算一个字）。 */
export const ANNOUNCEMENT_TITLE_MAX = 40;
export const ANNOUNCEMENT_BODY_MAX = 2000;

export function countChars(text: string): number {
  return [...String(text || "")].length;
}

/** 热门话题：管理员挑选的帖子。 */
export type MappedHotPost = {
  postId: string;
  position: number;
  available: boolean;
  addedAt: string;
  title: string;
  text: string;
  authorId: string;
  authorName: string;
  postTime: string;
  /** 是否公开；null 为未知。 */
  isPublic: boolean | null;
  audienceLabel: string;
  /** 失效原因（中文），可用时为空。 */
  unavailableReason: string;
};

export const HOT_POSTS_DEFAULT_MAX = 20;

export function mapRemoteHotPost(raw: unknown): MappedHotPost | null {
  if (!isRecord(raw)) return null;
  const post = isRecord(raw.post) ? raw.post : null;
  const postId = asString(pick(raw, "postId", "post_id") ?? (post ? pick(post, "id") : undefined) ?? pick(raw, "id"));
  if (!postId) return null;
  const author = post && isRecord(post.author) ? post.author : {};
  const deleted = !post || post.deleted === true || post.adminHidden === true || post.status === "removed" || !!pick(post, "deletedAt", "deleted_at");
  const availableRaw = pick(raw, "available");
  const available = typeof availableRaw === "boolean" ? availableRaw && !!post : !deleted;
  const text = post ? asString(pick(post, "text", "body", "content")) : "";
  const position = Number(pick(raw, "position", "order", "rank"));
  const vis = post ? readPostVisibility(post) : { isPublic: null, audience: "", audienceLabel: "" };
  const hidden = !!post && (post.adminHidden === true || post.admin_hidden === true);
  const removed = !!post && (post.deleted === true || post.status === "removed" || !!pick(post, "deletedAt", "deleted_at"));
  const unavailableReason = available
    ? ""
    : !post
      ? "帖子已不存在"
      : hidden
        ? "帖子已被隐藏"
        : removed
          ? "帖子已删除"
          : vis.isPublic === false
            ? `已改为${vis.audienceLabel || "非公开"}`
            : "";
  return {
    postId,
    isPublic: vis.isPublic,
    audienceLabel: vis.audienceLabel,
    unavailableReason,
    position: Number.isFinite(position) && position > 0 ? position : 0,
    available,
    addedAt: asTime(pick(raw, "addedAtUtc", "addedAt", "added_at")),
    title: (post ? asString(pick(post, "title")).trim() : "") || text.slice(0, 40),
    text,
    authorId: post ? asString(pick(post, "authorId", "author_id") ?? pick(author, "id")) : "",
    authorName: post ? asString(pick(post, "authorName") ?? pick(author, "displayName", "username", "name"), "") : "",
    postTime: post ? asTime(pick(post, "createdAtUtc", "createdAt", "created_at")) : "",
  };
}

/** 读取热门列表，按 position 排序；没有 position 的保持服务器给的顺序。 */
export function mapHotPostList(json: unknown): { items: MappedHotPost[]; max: number } {
  const rows = extractList(json)
    .map(mapRemoteHotPost)
    .filter((x): x is MappedHotPost => !!x);
  const sorted = rows
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (a.item.position || Infinity) - (b.item.position || Infinity) || a.i - b.i)
    .map((x) => x.item);
  const maxRaw = isRecord(json) ? Number(json.max) : NaN;
  return { items: sorted, max: Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : HOT_POSTS_DEFAULT_MAX };
}

/** 读取错误码；附加字段平铺在 error 里（如 error.max、error.items），见定稿 r7-api-contract.md §0。 */
export function readErrorCode(json: unknown): string {
  if (!isRecord(json) || !isRecord(json.error)) return "";
  return typeof json.error.code === "string" ? json.error.code : "";
}

export function readErrorField(json: unknown, key: string): unknown {
  if (!isRecord(json) || !isRecord(json.error)) return undefined;
  return json.error[key];
}

/** 热门话题操作失败时给管理员看的中文提示（按定稿错误码）。 */
export function hotErrorMessage(json: unknown, fallback: string): string {
  const code = readErrorCode(json);
  if (code === "POST_NOT_PUBLIC") return "只有公开的帖子才能加入热门";
  if (code === "POST_REMOVED") return "这条帖子已被删除，不能加入热门";
  if (code === "HOT_FULL") {
    const max = Number(readErrorField(json, "max"));
    return `热门最多 ${Number.isFinite(max) && max > 0 ? max : HOT_POSTS_DEFAULT_MAX} 条，请先移出一些`;
  }
  if (code === "NOT_FOUND") return "这条帖子已不存在";
  if (code === "BAD_POST_ID") return "请选择帖子";
  if (code === "BAD_ORDER") return "顺序有误，请刷新后再试";
  if (code === "ORDER_CONFLICT") return "列表已变化，已为你刷新";
  return readErrorMessage(json, fallback);
}

/** 把列表里第 from 项移到第 to 项（越界时原样返回副本）。 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = list.slice();
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/** 两组编号是否完全相同（不看顺序、无重复）。 */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  if (set.size !== a.length) return false;
  return b.every((id) => set.has(id));
}

/**
 * 服务器还没开放这项功能：路径不存在（404 且没有业务错误，或提示“接口不存在”），
 * 或预览服务把未知路径回退成页面（apiRequest 已转成 404 且 json 为空）。
 * 业务上的“动态不存在 / 公告不存在”同样是 404，但带有具体提示，不算未开放。
 */
export function isFeatureMissing(res: { status: number; json: unknown }): boolean {
  if (res.status !== 404 && res.status !== 405 && res.status !== 501) return false;
  if (res.status === 405 || res.status === 501) return true;
  const json = res.json;
  if (!isRecord(json)) return true;
  const err = isRecord(json.error) ? json.error : null;
  if (!err && typeof json.error !== "string") return true;
  const message = err && typeof err.message === "string" ? err.message : typeof json.error === "string" ? json.error : "";
  return /接口不存在|not\s*found|cannot\s+(get|post)/i.test(message) && !/动态|帖子|公告/.test(message);
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
  /** 仅当统计结果给出该字段时才有值，否则为 null，界面不展示 0。 */
  mediaReviewPending: number | null;
};

export function mapRemoteStats(raw: unknown): MappedStats | null {
  if (!isRecord(raw)) return null;
  const users = isRecord(raw.users) ? raw.users : raw;
  const posts = isRecord(raw.posts) ? raw.posts : {};
  const comments = isRecord(raw.comments) ? raw.comments : {};
  const reports = isRecord(raw.reports) ? raw.reports : {};
  const payments = isRecord(raw.payments) ? raw.payments : {};
  const media = isRecord(raw.media) ? raw.media : {};
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
    mediaReviewPending: (() => {
      const v = pick(raw, "mediaReviewPending", "nsfwReviewPending", "media_review_pending")
        ?? pick(media, "review", "pendingReview", "reviewPending", "pending");
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    })(),
  };
}

export type ReportTargetType = "user" | "post" | "comment" | "message" | "community" | "conversation" | string;

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
  targetType: string;
  targetId: string;
  targetName: string;
  messageIds: string[];
  media: MappedMedia[];
};

export function reportKindLabel(targetType: string, messageIds: string[] = []): string {
  if (targetType === "community") return "社区举报";
  if (targetType === "conversation" && messageIds.length === 0) return "整群举报";
  if (targetType === "conversation") return "会话举报";
  if (targetType === "message") return "私聊消息举报";
  if (targetType === "post") return "帖子举报";
  if (targetType === "comment") return "评论举报";
  if (targetType === "user") return "用户举报";
  return "";
}

function parseIdList(raw: unknown): string[] {
  if (raw == null || raw === "") return [];
  let src: unknown = raw;
  if (typeof raw === "string") {
    try { src = JSON.parse(raw); } catch { return raw.trim() ? [raw.trim()] : []; }
  }
  if (!Array.isArray(src)) return [];
  return src.map((x) => String(x)).filter(Boolean);
}

function reportTargetName(raw: Record<string, unknown>, targetType: string, _targetId: string): string {
  const context = isRecord(raw.context) ? raw.context : {};
  const community = isRecord(raw.community) ? raw.community : isRecord(context.community) ? context.community : {};
  const conversation = isRecord(raw.conversation) ? raw.conversation : isRecord(context.conversation) ? context.conversation : {};
  const name = asString(
    pick(raw, "targetName", "target_name", "communityName", "community_name", "groupName", "group_name", "conversationName")
      ?? pick(context, "name", "communityName", "community_name", "groupName", "group_name", "conversationName", "title")
      ?? pick(community, "name")
      ?? pick(conversation, "name", "title"),
  );
  if (name) return name;
  if (targetType === "user") {
    const tu = isRecord(raw.targetUser) ? raw.targetUser : isRecord(raw.target_user) ? raw.target_user : {};
    return asString(pick(tu, "displayName", "username", "name"));
  }
  return "";
}

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
  const messageIds = parseIdList(pick(raw, "messageIds", "message_ids"));
  const targetName = reportTargetName(raw, targetType, targetId);
  const kind = reportKindLabel(targetType, messageIds);
  const fallbackTarget = targetType && targetId ? `${targetType}:${targetId}` : "";
  const targetDisplay = targetName
    ? (targetType === "community" ? `社区：${targetName}` : targetType === "conversation" && messageIds.length === 0 ? `群：${targetName}` : targetName)
    : asString(pick(raw, "target"), fallbackTarget);
  return {
    id,
    title: kind || asString(pick(raw, "title"), "举报"),
    reason: asString(pick(raw, "reason", "detail")),
    reporter: asString(pick(reporter, "displayName", "username", "name"), asString(pick(raw, "reporter"))),
    target: targetDisplay,
    time: asTime(pick(raw, "createdAtUtc", "time", "createdAt", "created_at")),
    status: done ? "done" : "open",
    resolution: asString(pick(decision, "resolution", "note") ?? pick(raw, "resolution")) || undefined,
    postId: targetType === "post" ? targetId : undefined,
    userId: asString(pick(raw, "targetUserId", "target_user_id", "userId")) || undefined,
    targetType,
    targetId,
    targetName,
    messageIds,
    media: parsePostMedia(pick(raw, "media", "mediaItems", "media_items", "attachments") ?? (isRecord(raw.target) ? pick(raw.target, "media") : undefined)),
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
    return { ok: false, status: 0, path: DEFAULT_ENDPOINT_MAP[name], url: "", blob: null, mime: "", error: "还没有服务器地址，请在高级设置里填写。" };
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

export type MappedSecurityEvent = {
  id: string;
  kind: string;
  severity: string;
  ip: string;
  actorId: string;
  path: string;
  time: string;
  detail: string;
};

export function mapRemoteSecurityEvent(raw: unknown): MappedSecurityEvent | null {
  if (!isRecord(raw)) return null;
  const id = asString(pick(raw, "id"));
  if (!id) return null;
  const detail = pick(raw, "detail");
  let detailText = "";
  if (typeof detail === "string") detailText = detail;
  else if (detail != null) {
    try { detailText = JSON.stringify(detail); } catch { detailText = String(detail); }
  }
  return {
    id,
    kind: asString(pick(raw, "kind"), "event"),
    severity: asString(pick(raw, "severity"), "info"),
    ip: asString(pick(raw, "ip")),
    actorId: asString(pick(raw, "actorId", "actor_id")),
    path: asString(pick(raw, "path")),
    time: asTime(pick(raw, "createdAtUtc", "time", "at", "createdAt", "created_at")),
    detail: detailText,
  };
}

export type MappedAppeal = {
  id: string;
  userId: string;
  kind: string;
  body: string;
  related: string;
  status: string;
  createdAt: string;
  decidedAt: string;
  decisionNote: string;
};

export function mapRemoteAppeal(raw: unknown): MappedAppeal | null {
  const src = isRecord(raw) && isRecord(raw.appeal) ? raw.appeal : raw;
  if (!isRecord(src)) return null;
  const id = asString(pick(src, "id"));
  if (!id) return null;
  return {
    id,
    userId: asString(pick(src, "userId", "user_id")),
    kind: asString(pick(src, "kind"), "other"),
    body: asString(pick(src, "body", "reason", "text")),
    related: asString(pick(src, "related", "reportId", "target")),
    status: asString(pick(src, "status"), "pending"),
    createdAt: asTime(pick(src, "createdAtUtc", "createdAt", "created_at")),
    decidedAt: asTime(pick(src, "decidedAtUtc", "decidedAt", "decided_at")),
    decisionNote: asString(pick(src, "decisionNote", "decision_note", "note", "reason")),
  };
}
