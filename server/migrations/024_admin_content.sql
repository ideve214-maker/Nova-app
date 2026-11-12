-- M3.5.3 管理端软删除附带原因与操作者（用户端仍按 deleted_at 隐藏）。
ALTER TABLE posts ADD COLUMN admin_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN admin_reason TEXT;
ALTER TABLE posts ADD COLUMN admin_actor_id INTEGER;
ALTER TABLE post_comments ADD COLUMN admin_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE post_comments ADD COLUMN admin_reason TEXT;
ALTER TABLE post_comments ADD COLUMN admin_actor_id INTEGER;
