-- M6：安全事件、登录锁定轮次、申诉、注销标记。
ALTER TABLE login_attempts ADD COLUMN locks INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  ip TEXT,
  actor_id INTEGER,
  path TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_security_events_at ON security_events(at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_kind ON security_events(kind, at DESC);

CREATE TABLE IF NOT EXISTS appeals (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  related TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by INTEGER,
  decision_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_appeals_user ON appeals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status, created_at DESC);
