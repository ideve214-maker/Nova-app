-- M2.6 个人资料、头像（颜色/文字）、隐私设置；会话公开 id（脱敏用，不是令牌哈希）。
CREATE TABLE profiles(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT,
  bio TEXT,
  gender TEXT,
  birthday TEXT,
  avatar_kind TEXT,          -- color（图片头像等 M4.5）
  avatar_color TEXT,
  avatar_letter TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE privacy(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile_visibility TEXT NOT NULL DEFAULT 'everyone',   -- everyone | friends | private
  friend_requests TEXT NOT NULL DEFAULT 'everyone',      -- everyone | nobody
  show_birthday INTEGER NOT NULL DEFAULT 1,
  show_age INTEGER NOT NULL DEFAULT 1,
  show_gender INTEGER NOT NULL DEFAULT 1,
  searchable INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
ALTER TABLE sessions ADD COLUMN public_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_public ON sessions(public_id);
