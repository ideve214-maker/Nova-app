CREATE TABLE users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',        -- user | admin | root
  vip_until INTEGER,                        -- 毫秒时间戳，空=非VIP
  status TEXT NOT NULL DEFAULT 'active',    -- active | banned
  must_change_pw INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE sessions(
  token_hash TEXT PRIMARY KEY,              -- 只存SHA-256，不存令牌本身
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT, ua TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE TABLE login_attempts(key TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL, actor_id INTEGER, action TEXT NOT NULL,
  target TEXT, ip TEXT, detail TEXT
);
