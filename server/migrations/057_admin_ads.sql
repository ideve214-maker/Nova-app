-- 每日广告文案（admin-ads）：生意方向、推广项目、文案记录、设置。只新增表，不改已有表。
-- 依赖 056_admin_ai。

-- 生意方向：预设 + 自定义。
CREATE TABLE IF NOT EXISTS ad_directions(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  prompt TEXT NOT NULL DEFAULT '',
  preset INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 推广项目：每条文案都配这里的原网址。info 是管理员填写的真实卖点，AI 只能用这些信息和网页标题/简介。
CREATE TABLE IF NOT EXISTS ad_campaigns(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  info TEXT NOT NULL DEFAULT '',
  direction_id INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  page_title TEXT,
  page_desc TEXT,
  fetched_at INTEGER,
  fetch_error TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_copies(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  direction_id INTEGER,
  day TEXT NOT NULL,
  text TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL,          -- ai / local
  model TEXT,
  trigger TEXT NOT NULL,         -- schedule / manual / assistant
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_copies_day ON ad_copies(day, campaign_id);

CREATE TABLE IF NOT EXISTS admin_ai_settings(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO ad_directions(name, prompt, preset, created_at, updated_at) VALUES
  ('社交平台拉新', '面向想认识新朋友、找兴趣圈子的年轻用户，语气轻松友好。', 1, 0, 0),
  ('本地生活', '面向同城用户，强调到店、附近、方便，语气亲切接地气。', 1, 0, 0),
  ('电商好物', '面向网购用户，突出商品本身已写明的卖点，语气简洁有吸引力。', 1, 0, 0),
  ('教育培训', '面向学员和家长，语气专业可信，不承诺成绩或效果。', 1, 0, 0),
  ('技能服务', '面向需要找人帮忙或想接单的用户，强调真实、靠谱。', 1, 0, 0);
