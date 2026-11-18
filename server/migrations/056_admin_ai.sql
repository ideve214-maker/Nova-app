-- 管理端 AI 助手（admin-ai）：待确认操作。只新增表，不改已有表。
-- 编号从 056 起：055 已被用户端 2.0.3（055_conversation_clear.sql）占用。

-- AI 提出的写操作，必须由同一个管理员、同一个登录令牌确认后才执行；一次性，约 5 分钟过期。
CREATE TABLE IF NOT EXISTS admin_ai_pending(
  id TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  tool TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  body TEXT NOT NULL,
  args TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending / confirmed / executed / failed / cancelled / expired
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_at INTEGER,
  result TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_ai_pending_admin ON admin_ai_pending(admin_id, status, created_at);
