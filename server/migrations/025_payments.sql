-- VIP 订单与支付：提供商无关的订单层；人工收款码为默认。
CREATE TABLE IF NOT EXISTS pay_orders (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,          -- 短订单码，用户填在转账备注
  user_id INTEGER NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,             -- manual_qr | mock | wechat | alipay | stripe | apple_iap
  method TEXT,                        -- wechat | alipay | mock | ...
  period TEXT NOT NULL,               -- month | year
  plan TEXT NOT NULL DEFAULT 'vip',
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  status TEXT NOT NULL,               -- pending | awaiting_review | paid | rejected | expired | refunded
  note TEXT,
  reject_reason TEXT,
  receipt_path TEXT,
  receipt_mime TEXT,
  receipt_name TEXT,
  provider_ref TEXT,                  -- 外部流水号（webhook / 确认）
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  reviewed_by INTEGER,
  vip_event_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pay_user ON pay_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pay_status ON pay_orders(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_pay_code ON pay_orders(code);

CREATE TABLE IF NOT EXISTS pay_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES pay_orders(id),
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_type TEXT,                    -- user | admin | provider | system
  actor_id INTEGER,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_ev ON pay_events(order_id, id);
