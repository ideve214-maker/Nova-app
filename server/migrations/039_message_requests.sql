-- M7 陌生人消息请求：接受前不进入正常会话。
CREATE TABLE IF NOT EXISTS message_requests (
  id TEXT PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  receiver_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (sender_id != receiver_id),
  UNIQUE (sender_id, receiver_id)
);
CREATE INDEX IF NOT EXISTS idx_mreq_recv ON message_requests(receiver_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mreq_send ON message_requests(sender_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS message_request_previews (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES message_requests(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mreq_prev ON message_request_previews(request_id, created_at);
