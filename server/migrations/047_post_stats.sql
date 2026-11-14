-- r10 营销管理（2）：数据调整。真实阅读按「每人每帖一次」记录；管理端可在真实数据之上调整显示值（存差值，不改真实记录）。
ALTER TABLE posts ADD COLUMN adj_views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN adj_likes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN adj_saves INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS post_views (
  post_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_post_views_post ON post_views(post_id);
