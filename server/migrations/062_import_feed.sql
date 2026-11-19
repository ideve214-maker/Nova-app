-- 062 用户端：把 V2EX / Hacker News 的公开帖与评论写入同一张 posts、post_comments 表，
-- 059–061 已被管理端占用（059_ai_auto_ads、060_ai_providers_quota、061_ai_failover），因此本迁移用 062。
-- 首页信息流与管理端现有删帖、隐藏、设热帖、编辑都直接可用。系统账号只用于外键，界面显示外部作者。
ALTER TABLE posts ADD COLUMN source TEXT;
ALTER TABLE posts ADD COLUMN source_id TEXT;
ALTER TABLE posts ADD COLUMN source_url TEXT;
ALTER TABLE posts ADD COLUMN ext_author_name TEXT;
ALTER TABLE posts ADD COLUMN ext_author_avatar TEXT;

ALTER TABLE post_comments ADD COLUMN source TEXT;
ALTER TABLE post_comments ADD COLUMN source_id TEXT;
ALTER TABLE post_comments ADD COLUMN source_url TEXT;
ALTER TABLE post_comments ADD COLUMN ext_author_name TEXT;
ALTER TABLE post_comments ADD COLUMN ext_author_avatar TEXT;

-- 普通用户帖 source 为空，部分唯一索引允许重复 NULL。
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_source_id
  ON posts(source, source_id) WHERE source IS NOT NULL AND source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_source_id
  ON post_comments(source, source_id) WHERE source IS NOT NULL AND source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_posts_source ON posts(source, created_at DESC);
