-- r9：社区封面与下架状态、成员禁言、全站开关（维护模式等）。
ALTER TABLE communities ADD COLUMN cover TEXT;
ALTER TABLE communities ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE communities ADD COLUMN takedown_reason TEXT;
ALTER TABLE communities ADD COLUMN taken_down_at INTEGER;
ALTER TABLE community_members ADD COLUMN muted_until INTEGER;
CREATE TABLE IF NOT EXISTS app_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
