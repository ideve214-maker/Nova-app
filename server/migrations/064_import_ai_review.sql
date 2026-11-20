-- 064（服务端 2.1.0）：
-- 1. 营销帖权重去除：删掉 063 加的「未删除营销帖权重唯一」索引。weight 列保留但不再使用。
-- 2. 外部导入帖 AI 审查：posts / post_comments 记录审查结果；审查流水（入库审查 + 补审）；未通过的外部 ID（不再拉取、不再审）。
-- 本文件不要写 BEGIN/COMMIT：迁移程序会把整个文件放在一个事务里执行。

DROP INDEX IF EXISTS idx_marketing_ads_weight_alive;

ALTER TABLE posts ADD COLUMN ai_review TEXT;            -- NULL 未审 | pass | block
ALTER TABLE posts ADD COLUMN ai_reviewed_at INTEGER;
ALTER TABLE post_comments ADD COLUMN ai_review TEXT;
ALTER TABLE post_comments ADD COLUMN ai_reviewed_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_posts_ai_review ON posts(source, ai_review) WHERE source IS NOT NULL;

CREATE TABLE IF NOT EXISTS import_review_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase TEXT NOT NULL,          -- import（入库前审查）| backfill（已发布补审）
  target TEXT NOT NULL,         -- post | comment
  source TEXT,                  -- v2ex | hn
  source_id TEXT,
  ref_id TEXT,                  -- 本站帖子 / 评论 id（入库前被拦的为空）
  post_ref_id TEXT,             -- 评论所属本站帖子 id
  verdict TEXT NOT NULL,        -- allow | block | pending
  action TEXT,                  -- inserted | rejected | deferred | hidden | passed
  category TEXT,
  reason TEXT,
  ai_source TEXT,               -- ai | local | local-allow | empty | fallback | off
  excerpt TEXT,
  actor_id INTEGER,             -- 补审由管理员触发时记录管理员 id
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_review_at ON import_review_log(created_at);
CREATE INDEX IF NOT EXISTS idx_import_review_verdict ON import_review_log(verdict, created_at);

CREATE TABLE IF NOT EXISTS import_review_rejects (
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target TEXT NOT NULL,         -- post | comment
  category TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (source, source_id)
);
