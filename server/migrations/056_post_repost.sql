-- 2.0.3 转帖：转帖是一条带 repost_of 的普通帖子。text 为空 = 直接转帖；有 text = 引用并评论。
ALTER TABLE posts ADD COLUMN repost_of TEXT;
CREATE INDEX IF NOT EXISTS idx_posts_repost_of ON posts(repost_of);
