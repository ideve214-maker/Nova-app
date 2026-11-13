-- r7 公告弹窗：记录最近一次发布时间，用于 version（id-时间）和“同一时间只有一条发布中”。
ALTER TABLE announcements ADD COLUMN published_at INTEGER;
UPDATE announcements SET published_at = COALESCE(updated_at, created_at) WHERE published = 1;
-- 旧数据里如果有多条发布中，只保留最新的一条，其余下线。
UPDATE announcements SET published = 0
  WHERE published = 1 AND id NOT IN (SELECT id FROM announcements WHERE published = 1 ORDER BY published_at DESC, id DESC LIMIT 1);
CREATE INDEX IF NOT EXISTS idx_announcements_pub ON announcements(published, published_at DESC);
