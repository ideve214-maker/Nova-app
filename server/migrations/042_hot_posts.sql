-- r7 热门话题：管理员在管理端挑选的帖子，position 从 1 开始，越小越靠前。
-- （041 预留给日常 posts.kind，见 docs/r7-server-notes.md）
CREATE TABLE IF NOT EXISTS hot_posts (
  post_id TEXT PRIMARY KEY,
  position INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  added_by_admin_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_hot_posts_position ON hot_posts(position);
