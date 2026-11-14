-- 2.0.1 营销帖新卡片：头像 + 名称（下方「推广」），正文，大图，底部卡片（域名 / 标题 / 副标题 + 按钮）
ALTER TABLE marketing_ads ADD COLUMN avatar TEXT;     -- 广告主头像（http(s) 地址或 /api/... 路径）
ALTER TABLE marketing_ads ADD COLUMN domain TEXT;     -- 底部卡片的域名（空 = 取链接的域名）
ALTER TABLE marketing_ads ADD COLUMN subtitle TEXT;   -- 底部卡片的灰色副标题
