-- M5.2.5 消息草稿：按账号与会话隔离
CREATE TABLE IF NOT EXISTS message_drafts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  reply_to_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_mdraft_user ON message_drafts(user_id, updated_at DESC);
