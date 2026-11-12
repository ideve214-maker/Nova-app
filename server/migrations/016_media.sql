-- M4.5 媒体：文件记录与消息记录分离。本地存储，路径不对外暴露。
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('image','video','audio','file')),
  mime TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  duration INTEGER,
  path TEXT NOT NULL,
  preview_path TEXT,
  sha256 TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  conversation_id TEXT,
  message_id TEXT,
  scan_status TEXT NOT NULL DEFAULT 'pending',
  scan_detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_id, deleted_at, created_at);
CREATE INDEX IF NOT EXISTS idx_media_msg ON media(message_id);
