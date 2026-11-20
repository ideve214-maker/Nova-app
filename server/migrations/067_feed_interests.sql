-- 067（服务端 2.1.2）：用户偏好、不感兴趣、行为上报与按分类汇总的兴趣分。
-- 用于「为你推荐」排序。065 留给 AI 内部账号，066 是帖子 category。
-- 本文件不要写 BEGIN/COMMIT：迁移程序会把整个文件放在一个事务里执行。

CREATE TABLE IF NOT EXISTS user_interests (
  user_id INTEGER PRIMARY KEY,
  like_json TEXT NOT NULL DEFAULT '[]',
  dislike_json TEXT NOT NULL DEFAULT '[]',
  hidden_sources_json TEXT NOT NULL DEFAULT '[]',
  onboarded INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_hidden_posts (
  user_id INTEGER NOT NULL,
  post_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_user_hidden_posts_user ON user_hidden_posts(user_id, created_at);

CREATE TABLE IF NOT EXISTS feed_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  post_id TEXT NOT NULL,
  action TEXT NOT NULL,
  dwell_ms INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_signals_user_at ON feed_signals(user_id, at);
CREATE INDEX IF NOT EXISTS idx_feed_signals_created ON feed_signals(created_at);

CREATE TABLE IF NOT EXISTS user_category_scores (
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, category)
);
