-- 2.0.7 AI 额度用完自动切换（failover）。只加列，不改旧数据。
-- 编号 061：接在 060_ai_providers_quota 之后。
-- stop_balance：余额（元 / 美元）低于等于它就当作“用完”，跳到下一家；默认 0。建议留一点（例如 1 元），防止计费延迟导致欠费。
-- stop_tokens：按资源包估算剩余 token 低于等于它就当作“用完”；默认 0。
-- exhausted_at / exhausted_reason：调用时服务商返回“余额不足 / 欠费”被标记为用完的时间和原因；
--   下次查余额看到钱够了（查询时间晚于标记时间）就自动恢复；查不到余额的服务商 30 分钟后再试。
-- 顺序（ai.providerOrder）和开关（ai.autoFailover，默认开）存在 admin_ai_settings。
ALTER TABLE ai_quota_settings ADD COLUMN stop_balance REAL;
ALTER TABLE ai_quota_settings ADD COLUMN stop_tokens INTEGER;
ALTER TABLE ai_quota_settings ADD COLUMN exhausted_at INTEGER;
ALTER TABLE ai_quota_settings ADD COLUMN exhausted_reason TEXT;
