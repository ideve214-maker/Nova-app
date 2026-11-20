-- 064（服务端 2.1.0）：
-- 1. 营销帖权重去除：删掉 063 加的「未删除营销帖权重唯一」索引。weight 列保留但不再使用。
-- 2. 外部导入帖 AI 审查：posts / post_comments 记录审查结果；ai_moderation_log 加来源和处理动作；
--    未通过的外部 ID 记在 import_review_rejects（不再拉取、不再审）。
-- 本文件不要写 BEGIN/COMMIT：迁移程序会把整个文件放在一个事务里执行。

DROP INDEX IF EXISTS idx_marketing_ads_weight_alive;

ALTER TABLE posts ADD COLUMN ai_review TEXT;            -- NULL 未审 | pass | block
ALTER TABLE posts ADD COLUMN ai_reviewed_at INTEGER;
ALTER TABLE post_comments ADD COLUMN ai_review TEXT;
ALTER TABLE post_comments ADD COLUMN ai_reviewed_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_posts_ai_review ON posts(source, ai_review) WHERE source IS NOT NULL;

-- 审查记录：kind 新增 import / import_comment / backfill / backfill_comment
ALTER TABLE ai_moderation_log ADD COLUMN origin TEXT;      -- v2ex | hn | NULL
ALTER TABLE ai_moderation_log ADD COLUMN origin_url TEXT;  -- 原帖 / 原评论地址
ALTER TABLE ai_moderation_log ADD COLUMN action TEXT;      -- rejected | hidden | removed | stored | NULL
CREATE INDEX IF NOT EXISTS idx_ai_log_kind ON ai_moderation_log(kind, created_at);

CREATE TABLE IF NOT EXISTS import_review_rejects (
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target TEXT NOT NULL,         -- post | comment
  category TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (source, source_id)
);
