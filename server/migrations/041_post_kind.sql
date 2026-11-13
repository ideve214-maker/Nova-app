-- r7 日常/动态：与普通帖子分开。kind=post 为默认，kind=story 只出现在首页顶栏，不进信息流、不计入帖子数。
ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'post';
CREATE INDEX IF NOT EXISTS idx_posts_kind ON posts(kind, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_kind ON posts(author_id, kind, deleted_at, created_at DESC);
