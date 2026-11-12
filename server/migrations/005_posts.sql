-- M4.1 动态：帖子真实入库。评论/反应/关注在后续子步骤追加列或表。
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  client_id TEXT,
  UNIQUE(author_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts(deleted_at, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, deleted_at, created_at DESC);
