-- M3.5 用户举报。私聊仅保存用户主动勾选的 message_ids，处理结论写在同行。
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_user_id INTEGER REFERENCES users(id),
  reason TEXT NOT NULL,
  detail TEXT,
  message_ids TEXT,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decision_action TEXT,
  decision_note TEXT,
  decided_by INTEGER,
  decided_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id, created_at DESC);
