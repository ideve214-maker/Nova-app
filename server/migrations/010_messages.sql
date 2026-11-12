-- M4.3.2 聊天消息。与会话分离；client_id 用于幂等。
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','system')),
  text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  client_id TEXT,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_client ON messages(conversation_id, author_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_msg_cv ON messages(conversation_id, created_at DESC, id DESC);
