-- M5.3.4 屏蔽词：平台治理规则与用户个人屏蔽分开
CREATE TABLE IF NOT EXISTS platform_blockwords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL UNIQUE,
  note TEXT,
  created_at INTEGER NOT NULL,
  created_by INTEGER
);
CREATE TABLE IF NOT EXISTS personal_blockwords (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, word)
);
CREATE INDEX IF NOT EXISTS idx_pbw_user ON personal_blockwords(user_id);
