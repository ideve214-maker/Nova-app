-- 管理端社区管理：下架（可恢复）、成员禁言。下架后用户端列表/搜索/详情/加入/频道一律当作不存在。
ALTER TABLE communities ADD COLUMN taken_down_at INTEGER;
ALTER TABLE communities ADD COLUMN takedown_reason TEXT;
ALTER TABLE communities ADD COLUMN taken_down_by INTEGER;
ALTER TABLE community_members ADD COLUMN muted_until INTEGER;
ALTER TABLE community_members ADD COLUMN muted_reason TEXT;
-- 通知附带结构化数据（JSON），例如社区下架通知的 communityId/reason/appealable，供用户端打开申诉入口。
ALTER TABLE notifications ADD COLUMN data TEXT;
CREATE INDEX IF NOT EXISTS idx_appeals_related ON appeals(kind, related, status);
