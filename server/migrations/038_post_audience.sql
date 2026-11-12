-- M7 帖子受众：公开 / 关注者 / 好友 / 仅自己；可选心情、位置、标记、媒体 JSON。
ALTER TABLE posts ADD COLUMN audience TEXT NOT NULL DEFAULT 'public';
ALTER TABLE posts ADD COLUMN mood TEXT;
ALTER TABLE posts ADD COLUMN location TEXT;
ALTER TABLE posts ADD COLUMN tagged TEXT;
ALTER TABLE posts ADD COLUMN media TEXT;
CREATE INDEX IF NOT EXISTS idx_posts_audience ON posts(audience, deleted_at, created_at DESC);
