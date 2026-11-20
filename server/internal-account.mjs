// 是否是官方内部 / AI 账号。兴趣分只给真人算，这类账号的浏览不上报进学习。
// TODO(ai-personas / 迁移 065)：Cc 加上明确标记（例如 users.internal）后，这里改成读那个字段。
export function isInternalAccount(user) {
  if (!user) return false;
  if (user.internal === true || user.internal === 1 || user.internal === '1') return true;
  if (user.is_internal === true || user.is_internal === 1) return true;
  if (user.is_ai === true || user.is_ai === 1 || user.ai === true || user.ai === 1) return true;
  if (String(user.badge || '') === 'internal') return true;
  return false;
}
