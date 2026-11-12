-- M5.4.1 在线状态；隐私设置优先
CREATE TABLE IF NOT EXISTS user_presence (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'online',
  visibility TEXT NOT NULL DEFAULT 'friends',
  last_seen INTEGER,
  updated_at INTEGER NOT NULL
);
