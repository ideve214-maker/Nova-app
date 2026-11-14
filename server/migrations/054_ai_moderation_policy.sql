-- 2.0.1 审查放宽：联系方式（邮箱 / 微信号 / QQ / 手机号 / 数字 / 用户名）、脏话、轻微擦边都放行，重点抓暴力 / 杀人 / 自残 / 自杀。
-- 默认规则在代码里（server/ai-moderation.mjs）。这里只清掉管理员补充规则里和新规则冲突的旧条目（禁止留联系方式、禁止辱骂之类），并记下规则版本。
UPDATE app_flags
   SET value = json_set(value, '$.rules', ''), updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
 WHERE key = 'ai.moderation'
   AND json_valid(value)
   AND (json_extract(value, '$.rules') LIKE '%导流%' OR json_extract(value, '$.rules') LIKE '%联系方式%'
     OR json_extract(value, '$.rules') LIKE '%微信%' OR json_extract(value, '$.rules') LIKE '%手机号%'
     OR json_extract(value, '$.rules') LIKE '%辱骂%' OR json_extract(value, '$.rules') LIKE '%脏话%');
UPDATE app_flags SET value = json_set(value, '$.policy', 2) WHERE key = 'ai.moderation' AND json_valid(value);
