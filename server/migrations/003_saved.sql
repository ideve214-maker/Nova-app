-- M2.5.3 个人收藏：私有，按账号隔离。额度由服务端按 VIP 状态执行（Basic 20 / VIP 100）。
-- 不涉及群聊/社区的公共置顶（公共置顶仍按角色，名额不变）。
CREATE TABLE saved_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                 -- post | message | channel
  target TEXT NOT NULL,               -- 客户端对象 id（动态联网前由客户端提供）
  title TEXT,
  excerpt TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, kind, target)
);
CREATE INDEX idx_saved_user ON saved_items(user_id, id DESC);
