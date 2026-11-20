/**
 * 管理端 2.0.9：帖子分类 category（服务端 2.1.2，迁移 066）和外部帖来源。
 * 纯函数，不依赖 React / 浏览器；服务器没有返回 category / source 时一律当作「没有」，不报错。
 */

export const POST_CATEGORIES = ["tech", "game", "crypto", "finance", "news", "life", "other"] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<PostCategory, string> = {
  tech: "科技", game: "游戏", crypto: "币圈", finance: "财经", news: "综合热点", life: "生活", other: "其他",
};
export function normalizeCategory(v: unknown): PostCategory | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (POST_CATEGORIES as readonly string[]).includes(s) ? (s as PostCategory) : null;
}
export const categoryText = (c: PostCategory | null | undefined) => (c ? CATEGORY_LABEL[c] : "");

/** 和服务端 import-sources.mjs 的 id 一致（含停用的，旧帖可能来自它们）。 */
export const IMPORT_SOURCES: { id: string; name: string; category: PostCategory; enabled: boolean }[] = [
  { id: "v2ex", name: "V2EX", category: "tech", enabled: true },
  { id: "hn", name: "Hacker News", category: "tech", enabled: true },
  { id: "sspai", name: "少数派", category: "tech", enabled: true },
  { id: "ithome", name: "IT之家", category: "tech", enabled: true },
  { id: "juejin", name: "掘金热榜", category: "tech", enabled: true },
  { id: "solidot", name: "Solidot", category: "tech", enabled: true },
  { id: "github_trending", name: "GitHub Trending", category: "tech", enabled: true },
  { id: "producthunt", name: "Product Hunt", category: "tech", enabled: true },
  { id: "bilibili", name: "B站热门", category: "life", enabled: true },
  { id: "panews", name: "PANews", category: "crypto", enabled: true },
  { id: "cointelegraph", name: "Cointelegraph", category: "crypto", enabled: true },
  { id: "gcores", name: "机核", category: "game", enabled: true },
  { id: "ign", name: "IGN", category: "game", enabled: true },
  { id: "wallstcn", name: "华尔街见闻", category: "finance", enabled: true },
  { id: "36kr", name: "36氪", category: "tech", enabled: false },
  { id: "huxiu", name: "虎嗅", category: "tech", enabled: false },
  { id: "lobsters", name: "Lobsters", category: "tech", enabled: false },
  { id: "reddit", name: "Reddit", category: "tech", enabled: false },
  { id: "weibo", name: "微博热搜", category: "news", enabled: false },
  { id: "zhihu", name: "知乎热榜", category: "news", enabled: false },
  { id: "blockbeats", name: "律动 BlockBeats", category: "crypto", enabled: false },
  { id: "coindesk", name: "CoinDesk", category: "crypto", enabled: false },
  { id: "gamersky", name: "游民星空", category: "game", enabled: false },
  { id: "cls", name: "财联社", category: "finance", enabled: false },
  { id: "xueqiu", name: "雪球热帖", category: "finance", enabled: false },
];
export function sourceName(id: string): string {
  return IMPORT_SOURCES.find((s) => s.id === id)?.name || id;
}

export type PostMeta = { category: PostCategory | null; source: string; sourceLabel: string };
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
/** 从任意帖子 payload 读分类和来源：category；source / origin（外部帖来源 id）；sourceLabel / originLabel（如「来自 少数派」）。 */
export function readPostMeta(raw: unknown): PostMeta {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ext = r.external && typeof r.external === "object" ? (r.external as Record<string, unknown>) : {};
  const source = str(r.source) || str(r.origin) || str(ext.source) || str(ext.origin);
  const label = str(r.sourceLabel) || str(r.originLabel) || str(ext.label) || str(ext.sourceLabel);
  return {
    category: normalizeCategory(r.category ?? ext.category),
    source,
    sourceLabel: source ? (label ? label.replace(/^来自\s*/, "") : sourceName(source)) : "",
  };
}

export type MetaFilter = { category: string; source: string };
/** 筛选值：category ""=不限，"none"=未分类，否则分类 id；source ""=不限，"user"=站内用户，"external"=全部外部，否则来源 id */
export function matchMeta(m: { category?: PostCategory | null; source?: string }, f: MetaFilter): boolean {
  const cat = m.category ?? null, src = m.source || "";
  if (f.category === "none" ? cat !== null : f.category && cat !== f.category) return false;
  if (f.source === "user") return !src;
  if (f.source === "external") return !!src;
  if (f.source && src !== f.source) return false;
  return true;
}
/** 来源下拉：已知启用的来源 + 当前页出现过的其他来源 */
export function sourceOptions(loaded: { source?: string }[]): { id: string; label: string }[] {
  const ids = new Set(IMPORT_SOURCES.filter((s) => s.enabled).map((s) => s.id));
  for (const x of loaded) if (x.source) ids.add(x.source);
  return [...ids].map((id) => ({ id, label: sourceName(id) }));
}
/** 查询参数：只带有值的（服务端 2.1.2 还不认这两个参数，会忽略；管理端同时在本页过滤） */
export function metaQuery(f: MetaFilter): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.category) q.category = f.category;
  if (f.source) q.source = f.source;
  return q;
}
