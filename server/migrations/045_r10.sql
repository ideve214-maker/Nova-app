-- r10：社区封面/头像、个人头像/背景图片、群头像、频道消息置顶、全站开关（维护模式等）。
-- 下架/禁言字段已由 044_community_moderation.sql 建好（线上库已执行），这里不再重复加列。
ALTER TABLE communities ADD COLUMN cover TEXT;
ALTER TABLE communities ADD COLUMN avatar TEXT;
ALTER TABLE profiles ADD COLUMN avatar_image TEXT;
ALTER TABLE profiles ADD COLUMN cover_image TEXT;
ALTER TABLE conversations ADD COLUMN avatar TEXT;
CREATE TABLE IF NOT EXISTS community_pins (
  channel_id TEXT NOT NULL REFERENCES community_channels(id),
  message_id TEXT NOT NULL REFERENCES community_messages(id),
  pinned_by INTEGER,
  pinned_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, message_id)
);
CREATE TABLE IF NOT EXISTS app_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
