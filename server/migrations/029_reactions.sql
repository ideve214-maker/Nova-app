-- M5.2.3 消息表情反应
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_mrx_msg ON message_reactions(message_id);
