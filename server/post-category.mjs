// 帖子主题分类（服务端 2.1.2，迁移 066）。
// 外部帖默认用来源上的 category；AI 审查可以改判。用户发帖 / AI 内部账号发帖可直接传 category。
export const POST_CATEGORIES = Object.freeze(['tech', 'game', 'crypto', 'finance', 'news', 'life', 'other']);
export const FINANCE_REVIEW_CATEGORIES = Object.freeze(['crypto', 'finance']);

export function normalizePostCategory(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return POST_CATEGORIES.includes(s) ? s : null;
}

export function needsFinanceReview(category) {
  return FINANCE_REVIEW_CATEGORIES.includes(String(category || '').trim().toLowerCase());
}
