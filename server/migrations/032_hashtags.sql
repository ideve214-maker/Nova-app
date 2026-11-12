-- M5.3.2 话题标签：创建、搜索、热门与滥用限制
CREATE TABLE IF NOT EXISTS hashtags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS post_hashtags (
  post_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_ph_tag ON post_hashtags(tag_id, post_id);
CREATE TABLE IF NOT EXISTS hashtag_creates (
  user_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hc_user ON hashtag_creates(user_id, created_at);
