-- r10 营销管理（1）：营销帖（广告）。频率等设置存 app_flags 的 marketing.ads。
CREATE TABLE IF NOT EXISTS marketing_ads (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'text',      -- text | image | video | sdk
  advertiser TEXT,
  title TEXT,
  text TEXT,
  media TEXT,                             -- JSON [{url,kind}]
  link_url TEXT,
  cta TEXT,
  sdk_provider TEXT,
  sdk_slot TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  weight INTEGER NOT NULL DEFAULT 1,
  starts_at INTEGER,
  ends_at INTEGER,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  hides INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS marketing_ad_hides (
  user_id INTEGER NOT NULL,
  ad_id TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, ad_id)
);
CREATE TABLE IF NOT EXISTS marketing_ad_daily (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
