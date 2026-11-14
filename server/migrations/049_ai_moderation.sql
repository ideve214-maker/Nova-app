-- r10 营销管理（4）：AI 审查记录。设置存 app_flags 的 ai.moderation；密钥只从服务器环境变量 GROQ_API_KEY 读取，不入库。
CREATE TABLE IF NOT EXISTS ai_moderation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                 -- post | edit | test
  user_id INTEGER,
  post_id TEXT,
  excerpt TEXT,
  verdict TEXT NOT NULL,              -- allow | block | flag | fallback
  category TEXT,
  reason TEXT,
  source TEXT NOT NULL,               -- ai | fallback
  model TEXT,
  latency_ms INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_log_at ON ai_moderation_log(created_at);
