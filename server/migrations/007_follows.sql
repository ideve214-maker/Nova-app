-- M4.1.4 单向关注。与 M4.10 双向好友分开建模，互不影响。
CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id),
  followee_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id != followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id, created_at DESC);
