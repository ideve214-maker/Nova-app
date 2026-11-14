-- r10 营销管理（3）：推流 / 加热（类似 DOU+）。按套餐买曝光，人工收款码付款、管理员核对后开始投放。
CREATE TABLE IF NOT EXISTS boost_orders (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  post_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  days INTEGER NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL,                 -- pending | awaiting_review | active | done | ended | rejected | expired | refunded
  delivered INTEGER NOT NULL DEFAULT 0,
  reject_reason TEXT,
  reviewed_by INTEGER,
  expires_at INTEGER,
  paid_at INTEGER,
  starts_at INTEGER,
  ends_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_boost_status ON boost_orders(status, ends_at);
CREATE INDEX IF NOT EXISTS idx_boost_post ON boost_orders(post_id);
CREATE TABLE IF NOT EXISTS boost_impressions (
  order_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (order_id, user_id)
);
