// 是否是官方内部 / AI 账号。
// 标记来源（迁移 065）：users.badge='internal'，以及 ai_personas 表里的 user_id。
// 065 尚未跑时（没有 ai_personas 表）只看 badge 和调用方传入的字段。
const personasStmt = new WeakMap();

export function personasTableExists(db) {
  if (!db) return false;
  const cached = personasStmt.get(db);
  if (cached !== undefined) return cached !== null;
  try {
    const ok = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ai_personas'").get();
    personasStmt.set(db, ok ? db.prepare('SELECT 1 FROM ai_personas WHERE user_id=?') : null);
    return ok;
  } catch {
    personasStmt.set(db, null);
    return false;
  }
}

export function isInternalAccount(user, db) {
  if (!user) return false;
  if (user.internal === true || user.internal === 1 || user.internal === '1') return true;
  if (user.is_internal === true || user.is_internal === 1) return true;
  if (user.is_ai === true || user.is_ai === 1 || user.ai === true || user.ai === 1) return true;
  if (String(user.badge || '') === 'internal') return true;
  if (db && user.id != null && personasTableExists(db)) {
    const st = personasStmt.get(db);
    if (st && st.get(Number(user.id))) return true;
  }
  return false;
}

/** SQL 片段：id 表达式是否为内部账号（用于统计排除）。 */
export function createInternalHints(db) {
  const hasPersonas = personasTableExists(db);
  const isSql = (idExpr) => {
    const parts = [`(SELECT IFNULL(badge,'') FROM users WHERE id=${idExpr})='internal'`];
    if (hasPersonas) parts.push(`EXISTS (SELECT 1 FROM ai_personas WHERE user_id=${idExpr})`);
    return '(' + parts.join(' OR ') + ')';
  };
  return {hasPersonas, isSql, notSql: (e) => 'NOT ' + isSql(e)};
}

export const INTERNAL_ACCOUNT_MSG = '这是官方内部账号，不接收私信';
export const INTERNAL_LOGIN_MSG = '官方内部账号不能登录';
