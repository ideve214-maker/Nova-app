-- r10：社区封面、全站开关（维护模式等）。
-- 下架/禁言字段已由 044_community_moderation.sql 建好（线上库已执行），这里不再重复加列。
ALTER TABLE communities ADD COLUMN cover TEXT;
CREATE TABLE IF NOT EXISTS app_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
