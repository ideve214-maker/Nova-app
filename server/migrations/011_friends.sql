-- M4.3.3 私聊好友门槛所用的双向好友与拉黑表。完整申请/同意流程见 M4.10；完整举报见 M4.8。
CREATE TABLE IF NOT EXISTS friendships (
  user_lo INTEGER NOT NULL REFERENCES users(id),
  user_hi INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_lo, user_hi),
  CHECK (user_lo < user_hi)
);
CREATE INDEX IF NOT EXISTS idx_fr_status ON friendships(status);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id),
  blocked_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blk_blocked ON blocks(blocked_id);
