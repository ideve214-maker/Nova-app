-- M5.3.3 帖子草稿与定时发布（服务端执行）
CREATE TABLE IF NOT EXISTS post_drafts (
  id TEXT PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL DEFAULT '',
  poll_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at INTEGER,
  published_post_id TEXT,
  fail_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  cancelled_at INTEGER,
  published_at INTEGER,
  failed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pd_author ON post_drafts(author_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pd_sched ON post_drafts(status, scheduled_at);
