-- 066（服务端 2.1.2）：帖子主题分类，供用户偏好和推荐使用。
-- 取值：tech / game / crypto / finance / news / life / other。
-- 065 留给 AI 内部账号（ai-personas），本文件不要占用 065。
-- 本文件不要写 BEGIN/COMMIT：迁移程序会把整个文件放在一个事务里执行。

ALTER TABLE posts ADD COLUMN category TEXT;
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);

-- 已导入的 V2EX / HN 帖按来源归到科技
UPDATE posts SET category='tech' WHERE source IN ('v2ex', 'hn') AND category IS NULL;
