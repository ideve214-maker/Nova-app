-- 2.0.6 AI 自动找广告并发布营销帖（ai-auto-ads）。只加列、加索引，不改旧数据。
-- 编号 059：057、058 是管理端 AI 助手 / 广告文案；用户端 056 已占用；新迁移从 059 起。
-- 开关、每日上限等设置存 admin_ai_settings（058 建的表），键名 autoads.*；没有这一行时自动发布默认关闭。
ALTER TABLE marketing_ads ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'; -- manual（管理员手动） / ai（AI 自动或 AI 助手发布）
ALTER TABLE marketing_ads ADD COLUMN source_url TEXT;       -- AI 广告的原网址（必填，来自联网搜索结果，系统附上）
ALTER TABLE marketing_ads ADD COLUMN source_title TEXT;     -- 原网页标题
ALTER TABLE marketing_ads ADD COLUMN ai_trigger TEXT;       -- schedule（每日定时） / manual（管理员点“立即运行”） / assistant（AI 助手 + 管理员确认）
ALTER TABLE marketing_ads ADD COLUMN ai_run_id TEXT;
ALTER TABLE marketing_ads ADD COLUMN taken_down_at INTEGER; -- 一键下架时间
ALTER TABLE marketing_ads ADD COLUMN taken_down_by INTEGER; -- 下架的管理员
CREATE INDEX IF NOT EXISTS idx_marketing_ads_source ON marketing_ads(source, created_at);
CREATE INDEX IF NOT EXISTS idx_marketing_ads_source_url ON marketing_ads(source_url);
