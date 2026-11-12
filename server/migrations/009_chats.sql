-- M4.3.1 单聊/群聊会话与成员。权限服务端校验。单聊一对用户唯一。
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('dm','group')),
  name TEXT,
  owner_id INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  dm_lo INTEGER,
  dm_hi INTEGER,
  UNIQUE(dm_lo, dm_hi)
);
CREATE INDEX IF NOT EXISTS idx_cv_kind ON conversations(kind, deleted_at, created_at DESC);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_cvm_user ON conversation_members(user_id, left_at);
