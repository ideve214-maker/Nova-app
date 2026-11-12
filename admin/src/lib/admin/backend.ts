/**
 * NOVA 管理端 · 与用户端后端的适配层。
 *
 * 设计目标（面向未来版本的用户端/后端压缩包）：
 * 1. 接口根地址可配置（localStorage），留空表示与当前页面同源（适合预览反代）。
 * 2. 路径集中在 DEFAULT_ENDPOINT_MAP，设置页可覆盖；主路径 404 时再试别名。
 * 3. 通过 /api/health、/api/version 或响应头尽量识别后端版本；识别不到也不算失败。
 * 4. 字段名容错：username/name/displayName、vip_until/vipUntil 等都能读；未知字段忽略。
 * 5. 后端不可达或管理接口尚未实现时，列表与指标保持为空并标明「接口待接入」，绝不阻塞进入管理端；虚构数据仅在用户手动打开演示模式时出现。
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
  adminStats: "/api/admin/stats",
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
  message: "未连接后端。列表与统计为空，没有虚构数字。可在「我的」中手动打开演示模式。",
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
  try {
    const meta = import.meta as ImportMeta & { env?: { VITE_NOVA_API_BASE?: string } };
    const v = meta.env && meta.env.VITE_NOVA_API_BASE;
    return typeof v === "string" ? v.trim().replace(/\/+$/, "") : "";
  } catch {
    return "";
  }
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
      if (res.status !== 404) return last;
    } catch (err) {
      const message = err instanceof Error ? (err.name === "AbortError" ? "连接超时" : err.message) : "网络错误";
      last = { ok: false, status: 0, path, url, json: null, headers: {}, error: message };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
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
  for (const key of ["users", "members", "items", "data", "results", "list", "rows", "records"]) {
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

function asTime(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "number") {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return String(v);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  return String(v);
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
    joinedAt: asTime(pick(raw, "joinedAt", "createdAt", "created_at", "registeredAt")),
    lastLogin: asTime(pick(raw, "lastLogin", "last_login_at", "lastLoginAt", "seenAt")),
    violations: Number(pick(raw, "violations", "violationCount", "strikes") ?? 0) || 0,
    bio: asString(pick(raw, "bio", "profile.bio", "introduction", "intro")),
    posts: Number(pick(raw, "posts", "postCount", "postsCount") ?? 0) || 0,
    canPost: pick(raw, "canPost", "permissions.post") === false ? false : true,
    canComment: pick(raw, "canComment", "permissions.comment") === false ? false : true,
    tempCode: asString(pick(raw, "tempCode", "temp_code", "resetCode")) || null,
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
    const gatedNote = gated.length
      ? `已探测到需登录的用户接口（${gated.join("、")}），管理端没有管理员令牌，不会代用户拉取，相关列表保持为空。`
      : "";
    status.message = `后端已连通${status.detectedVersion ? "（" + status.detectedVersion + "）" : ""}。管理专用接口（用户列表、封禁、全站统计、管理员登录等）尚未提供。${gatedNote}VIP 目录${status.catalog ? "已从服务器读取" : "未能读取"}。公开接口（如健康检查、VIP 目录、表情包）会展示真实数据。不用虚构数字。`;
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
