/**
 * 管理端 2.0.9：AI 内部账号（设计文档 §8.1）+ 数据调整新返回体（§8.2）。
 * 这里只放类型、纯函数和接口封装（makePersonasApi 接收 call，便于用假后端测试）。
 * 不依赖 React / 浏览器，node --test 可以直接跑。
 */
import { readPostMeta, type PostMeta } from "./post-category.ts";

export type PersonaDefaults = {
  postIntervalMinutes: number; actionIntervalMinutes: number;
  likeRate: number; favoriteRate: number; repostRate: number; commentRate: number; replyToUsersRate: number;
  groupJoinPerDay: number; groupPostPerDay: number;
};
export type PersonaSettings = {
  enabled: boolean; targetCount: number; model: string;
  activeHours: { quietStart: number; quietEnd: number; quietFactor: number };
  defaults: PersonaDefaults;
  categories: string[];
  limits: { maxActionsPerTick: number; aiConcurrency: number; maxAiCommentsPerPost: number };
  avatarStyles: string[];
  notifyOnLike: boolean;
};
export type PersonaStatus = {
  envEnabled: boolean; running: boolean; lastTickAt: number | null;
  accounts: { active: number; paused: number; retired: number; creating: number };
  model: string; modelSource: "personas" | "admin" | "default" | string; aiReady: boolean; lastError: string | null;
};
export type PersonaToday = Partial<Record<
  "browse" | "like" | "favorite" | "repost" | "comment" | "reply" | "post" | "join_group" | "group_post" | "aiCalls" | "aiTokens" | "aiFailures",
  number
>>;
export type PersonasOverview = {
  settings: PersonaSettings; status: PersonaStatus; today: PersonaToday;
  sources: { enabled: number; failing: number; unusedItems: number };
};
export type PersonaAccount = {
  userId: number; username: string; displayName: string;
  avatar: PersonaAvatar | null; style: string;
  status: "active" | "paused" | "retired" | "creating" | string; interests: string[];
  overrides: Partial<PersonaDefaults> | null; lastActionAt: number | null; nextAt: number | null;
  counts: { posts?: number; comments?: number; likes?: number };
};
/** 和 2.1.0 外部帖头像同格式：path = 站内相对地址（要管理员令牌），fallback = 字母头像（data URI / 文字 / {letter,color}）。 */
export type PersonaAvatar = {
  kind?: string; path?: string; url?: string; image?: string;
  fallback?: string | { letter?: string; color?: string; url?: string } | null;
  color?: string; letter?: string;
};
export type ResolvedPersonaAvatar = {
  /** 需要带令牌拉取的站内相对路径 */
  path: string;
  /** 可以直接显示的地址（http(s) 或 data:image），按顺序尝试 */
  direct: string[];
  letter: string; color: string;
};
const isHttp = (v: unknown): v is string => typeof v === "string" && /^https?:\/\/\S+$/i.test(v.trim());
const isDataImg = (v: unknown): v is string => typeof v === "string" && /^data:image\//i.test(v.trim());
const isRel = (v: unknown): v is string => typeof v === "string" && /^\/(?![/\\])[^\s\\]*$/.test(v);
/** 头像顺序：path（带令牌）→ url → fallback 图 → 字母（fallback.letter / 昵称首字）。 */
export function resolvePersonaAvatar(a: PersonaAvatar | null | undefined, name: string): ResolvedPersonaAvatar {
  const out: ResolvedPersonaAvatar = { path: "", direct: [], letter: "", color: "" };
  const first = (s: unknown) => (typeof s === "string" ? Array.from(s.trim())[0] || "" : "");
  if (a && typeof a === "object") {
    if (isRel(a.path)) out.path = a.path;
    else if (isHttp(a.path)) out.direct.push(String(a.path).trim());
    if (isHttp(a.url)) out.direct.push(a.url.trim());
    else if (!out.path && isRel(a.url)) out.path = a.url;
    if (isHttp(a.image) || isDataImg(a.image)) out.direct.push(a.image.trim());
    const fb = a.fallback;
    if (typeof fb === "string") {
      if (isHttp(fb) || isDataImg(fb)) out.direct.push(fb.trim());
      else out.letter = first(fb);
    } else if (fb && typeof fb === "object") {
      if (isHttp(fb.url) || isDataImg(fb.url)) out.direct.push(String(fb.url).trim());
      out.letter = first(fb.letter);
      if (typeof fb.color === "string") out.color = fb.color;
    }
    if (!out.letter) out.letter = first(a.letter);
    if (!out.color && typeof a.color === "string") out.color = a.color;
  }
  if (!out.letter) out.letter = first(name) || "?";
  out.direct = [...new Set(out.direct)];
  return out;
}

export type PersonaSource = {
  id: number; name: string; url: string; category: string; lang: string; enabled: boolean;
  lastOkAt: number | null; lastError: string | null; itemCount: number;
};
export type PersonaLogRow = {
  id: number; at: number; userId: number | null; displayName: string | null; kind: string; target: string | null;
  refId: string | null; ok: boolean; error: string | null; model: string | null; tokens: number | null;
};
export type AvatarStyle = { key: string; label: string; license: string; licenseUrl: string; preview: string };
export type RunKind = "post" | "comment" | "browse" | null;
export type RunAction = { userId: number; kind: string; refId?: string | null; ok: boolean; error?: string | null };

export const CATEGORIES: { id: string; label: string }[] = [
  { id: "news", label: "新闻" }, { id: "politics", label: "政治" }, { id: "sports", label: "体育" }, { id: "economy", label: "经济" },
];
export const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label || id;

export const KIND_LABEL: Record<string, string> = {
  browse: "浏览", like: "点赞", favorite: "收藏", repost: "转帖", comment: "评论", reply: "回复",
  post: "发帖", join_group: "加入小组", group_post: "小组发言", create: "创建账号", retire: "停用", avatar: "换头像",
};
export const kindLabel = (k: string) => KIND_LABEL[k] || k;
export const STATUS_LABEL: Record<string, string> = { active: "活跃", paused: "已暂停", retired: "已停用", creating: "创建中" };
export const MODEL_SOURCE_LABEL: Record<string, string> = { personas: "本页设置", admin: "跟全站设置", default: "服务器默认" };
/** 设计文档 §9-4：AI 账号建议默认用免费的 glm-4.7-flash */
export const SUGGESTED_PERSONA_MODEL = "glm-4.7-flash";

/** 频率字段：key、标签、是否为 0–1 概率（界面按 % 显示） */
export const DEFAULT_FIELDS: { key: keyof PersonaDefaults; label: string; rate?: boolean }[] = [
  { key: "postIntervalMinutes", label: "发帖间隔（分钟）" },
  { key: "actionIntervalMinutes", label: "动作间隔（分钟）" },
  { key: "likeRate", label: "点赞概率 %", rate: true },
  { key: "favoriteRate", label: "收藏概率 %", rate: true },
  { key: "repostRate", label: "转帖概率 %", rate: true },
  { key: "commentRate", label: "评论概率 %", rate: true },
  { key: "replyToUsersRate", label: "回复真人概率 %", rate: true },
  { key: "groupJoinPerDay", label: "每天加入小组" },
  { key: "groupPostPerDay", label: "每天小组发言" },
];

/** 0–1 概率 → 输入框里的百分数文字（最多 1 位小数） */
export function rateToPct(r: number | null | undefined): string {
  const n = Number(r);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 1000) / 10);
}
/** 百分数文字 → 0–1 概率；非法返回 null */
export function pctToRate(s: string): number | null {
  const t = String(s).trim().replace(/[，,。]/g, ".");
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(t)) return null;
  const n = Number(t);
  if (n < 0 || n > 100) return null;
  return Math.round(n * 100) / 10000;
}
/** 非负整数（不设上限）；非法返回 null */
export function parseCount(s: string): number | null {
  const t = String(s).trim();
  if (!/^\d{1,9}$/.test(t)) return null;
  return Number(t);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 只取改过的字段（§8.1 第 2 条：只传要改的字段）。嵌套对象只传改过的子字段。 */
export function diffSettings(orig: PersonaSettings, next: PersonaSettings): Partial<Record<keyof PersonaSettings, unknown>> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(next) as (keyof PersonaSettings)[]) {
    const a = orig[k] as unknown, b = next[k] as unknown;
    if (same(a, b)) continue;
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const sub: Record<string, unknown> = {};
      for (const sk of Object.keys(b as object)) {
        const av = (a as Record<string, unknown>)[sk], bv = (b as Record<string, unknown>)[sk];
        if (!same(av, bv)) sub[sk] = bv;
      }
      if (Object.keys(sub).length) out[k] = sub;
    } else out[k] = b;
  }
  return out as Partial<Record<keyof PersonaSettings, unknown>>;
}

/** 账号单独频率：只保留填了的字段；全空返回 null（= 用默认） */
export function cleanOverrides(o: Partial<Record<keyof PersonaDefaults, number | null | undefined>>): Partial<PersonaDefaults> | null {
  const out: Partial<PersonaDefaults> = {};
  for (const [k, v] of Object.entries(o)) if (typeof v === "number" && Number.isFinite(v)) out[k as keyof PersonaDefaults] = v;
  return Object.keys(out).length ? out : null;
}

/** 兴趣 / 分类文字 → 数组（逗号、顿号、空格分隔，去重） */
export function parseTags(s: string): string[] {
  return [...new Set(String(s).split(/[\s,，、;；]+/).map((x) => x.trim()).filter(Boolean))];
}

/** 进度：创建中 */
export function creatingText(st: PersonaStatus, target: number): string {
  const a = st.accounts || { active: 0, paused: 0, retired: 0, creating: 0 };
  const have = (a.active || 0) + (a.paused || 0);
  if (a.creating > 0) return `正在创建 ${a.creating} 个（已有 ${have} / 目标 ${target}）`;
  return have >= target ? `已就绪 ${have} / ${target}` : `${have} / ${target}`;
}

export const BAD_FEED_TEXT = "抓不到这个来源";
export function sourceErrorText(code: string | undefined, msg: string): string {
  if (code === "BAD_FEED") return `${BAD_FEED_TEXT}：${msg || "请检查网址"}`;
  return msg;
}

// ---- 数据调整（§8.2）
export type Quad = { views: number; likes: number; saves: number; reposts: number };
export const STAT_KEYS = ["views", "likes", "saves", "reposts"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const STAT_LABEL: Record<StatKey, string> = { views: "阅读", likes: "点赞", saves: "收藏", reposts: "转帖" };
export type StatPostV2 = {
  id: string; text: string; createdAt: number; author: { id: number; username: string; displayName: string } | null;
  real: Quad; ai: Quad; adj: Quad; shown: Quad;
  /** 服务器返回了新结构（有 ai / shown 四项）；false = 旧服务器，按「填显示值」保存 */
  v2: boolean;
} & PostMeta;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const quad = (o: unknown): Quad => {
  const r = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  return { views: num(r.views), likes: num(r.likes), saves: num(r.saves), reposts: num(r.reposts) };
};
/** 兼容新旧返回体：旧服务器没有 ai，也没有 reposts。 */
export function normalizeStatPost(raw: Record<string, unknown>): StatPostV2 {
  const v2 = !!raw.ai && typeof raw.ai === "object";
  const real = quad(raw.real), adj = quad(raw.adj), ai = quad(raw.ai);
  const shown = raw.shown ? quad(raw.shown) : { views: real.views + adj.views, likes: real.likes + adj.likes, saves: real.saves + adj.saves, reposts: real.reposts + adj.reposts };
  return {
    id: String(raw.id ?? ""), text: String(raw.text ?? ""), createdAt: num(raw.createdAt),
    author: (raw.author as StatPostV2["author"]) || null, real, ai, adj, shown, v2, ...readPostMeta(raw),
  };
}
/** 调整量输入（允许负数，例如 -5）；非法返回 null */
export function parseAdj(s: string): number | null {
  const t = String(s).trim().replace(/^＋/, "+").replace(/^[－—]/, "-");
  if (t === "" || t === "-" || t === "+") return 0;
  if (!/^[+-]?\d{1,9}$/.test(t)) return null;
  return Number(t);
}
/** 新服务器：保存 {adj:{…}}，只传改过的项。 */
export function adjBody(p: StatPostV2, input: Record<StatKey, string>): { adj: Partial<Quad> } | null {
  const adj: Partial<Quad> = {};
  for (const k of STAT_KEYS) {
    const v = parseAdj(input[k]);
    if (v === null) return null;
    if (v !== p.adj[k]) adj[k] = v;
  }
  return { adj };
}
/** 调整后预览：真人 + AI + 调整（显示值最小 0） */
export const previewShown = (p: StatPostV2, k: StatKey, adjText: string) => Math.max(0, p.real[k] + p.ai[k] + (parseAdj(adjText) ?? p.adj[k]));

// ---- 接口封装（§8.1）
type CallOpts = { method?: string; body?: unknown; params?: Record<string, string>; query?: Record<string, string | number | undefined>; timeoutMs?: number };
export type CallResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number; code?: string };
export type CallFn = <T>(name: string, opts?: CallOpts) => Promise<CallResult<T>>;

export function makePersonasApi(call: CallFn) {
  return {
    overview: () => call<PersonasOverview>("adminAiPersonas"),
    saveSettings: (patch: Partial<Record<keyof PersonaSettings, unknown>>) => call<PersonasOverview>("adminAiPersonasSettings", { body: patch }),
    accounts: (q: { status?: string; q?: string; cursor?: string | null; limit?: number }) =>
      call<{ accounts: PersonaAccount[]; nextCursor: string | null }>("adminAiPersonasAccounts", {
        query: { status: q.status || undefined, q: q.q || undefined, cursor: q.cursor || undefined, limit: q.limit ?? 50 },
      }),
    updateAccount: (userId: number, patch: Partial<{ status: string; displayName: string; interests: string[]; overrides: Partial<PersonaDefaults> | null; regenerateAvatar: boolean }>) =>
      call<{ account: PersonaAccount }>("adminAiPersonasAccount", { params: { userId: String(userId) }, body: patch }),
    retireAccount: (userId: number, hideContent: boolean) =>
      call<{ account: PersonaAccount; hiddenPosts: number }>("adminAiPersonasAccountRetire", { params: { userId: String(userId) }, body: { hideContent } }),
    stopAll: (opts: { hideContent: boolean; undoInteractions: boolean }) =>
      call<{ paused: number; hiddenPosts: number; removedInteractions: number }>("adminAiPersonasStopAll", { body: opts, timeoutMs: 60000 }),
    run: (kind: RunKind, userId: number | null = null) =>
      call<PersonasOverview & { result: { actions: RunAction[] } }>("adminAiPersonasRun", { body: { kind, userId }, timeoutMs: 120000 }),
    sources: () => call<{ sources: PersonaSource[] }>("adminAiPersonasSources"),
    addSource: (s: { name: string; url: string; category: string; lang: string }) => call<{ source: PersonaSource }>("adminAiPersonasSources", { body: s, timeoutMs: 30000 }),
    updateSource: (id: number, patch: Partial<{ enabled: boolean; name: string; category: string }>) =>
      call<{ source: PersonaSource }>("adminAiPersonasSource", { params: { id: String(id) }, body: patch }),
    deleteSource: (id: number) => call<{ deleted: number }>("adminAiPersonasSourceDelete", { params: { id: String(id) }, body: {} }),
    testSource: (id: number) =>
      call<{ ok: boolean; items: { title: string; url: string; publishedAt: number | null }[]; ms: number }>("adminAiPersonasSourceTest", { params: { id: String(id) }, body: {}, timeoutMs: 30000 }),
    log: (q: { kind?: string; userId?: string; before?: number | null; limit?: number }) =>
      call<{ log: PersonaLogRow[]; nextBefore?: number | null }>("adminAiPersonasLog", {
        query: { kind: q.kind || undefined, userId: q.userId || undefined, before: q.before || undefined, limit: q.limit ?? 100 },
      }),
    avatarStyles: () => call<{ styles: AvatarStyle[] }>("adminAiPersonasAvatarStyles"),
  };
}
export type PersonasApi = ReturnType<typeof makePersonasApi>;

/** 北京时间 MM-DD HH:mm */
export function fmtTime(t: number | null | undefined): string {
  if (!t) return "—";
  const d = new Date(t + 8 * 3600e3);
  return `${d.getUTCMonth() + 1}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
