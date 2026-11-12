-- M4.4.4 消息置顶：私人置顶与房间公共置顶分开。
CREATE TABLE IF NOT EXISTS message_pins (
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  message_id TEXT NOT NULL REFERENCES messages(id),
  kind TEXT NOT NULL CHECK (kind IN ('personal','public')),
  user_id INTEGER REFERENCES users(id),
  pinned_at INTEGER NOT NULL,
  pinned_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pin_public ON message_pins(conversation_id, message_id) WHERE kind='public';
CREATE UNIQUE INDEX IF NOT EXISTS idx_pin_personal ON message_pins(conversation_id, message_id, user_id) WHERE kind='personal';
CREATE INDEX IF NOT EXISTS idx_pin_cv ON message_pins(conversation_id, kind);
