-- M4.6 站内通知。系统通知与互动提醒共用收件箱；dedupe_key 防止重复推送。
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  ref_type TEXT,
  ref_id TEXT,
  actor_id INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  dedupe_key TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);
