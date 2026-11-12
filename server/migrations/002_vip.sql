-- M2.4.2 VIP 状态：开始时间、来源、事件流水。
-- vip_until 仍是「是否有效」的唯一判断来源（毫秒时间戳，到期由服务端按当前时间判断）；
-- 客户端永远不能直接写这些列。
ALTER TABLE users ADD COLUMN vip_since INTEGER;      -- 本次连续 VIP 的开始时间（毫秒）
ALTER TABLE users ADD COLUMN vip_source TEXT;        -- test | admin | payment；空 = 迁移前的历史数据
CREATE TABLE vip_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,                              -- grant | extend | revoke
  source TEXT NOT NULL,                              -- test | admin | payment
  actor_id INTEGER,                                  -- 操作人（测试开关=用户自己；管理员操作=管理员）
  until_before INTEGER, until_after INTEGER,
  note TEXT
);
CREATE INDEX idx_vip_events_user ON vip_events(user_id, id);
