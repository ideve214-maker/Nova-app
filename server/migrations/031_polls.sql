-- M5.3.1 社区/动态投票
CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  post_id TEXT,
  community_id TEXT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  question TEXT NOT NULL,
  allow_multiple INTEGER NOT NULL DEFAULT 0,
  vote_perm TEXT NOT NULL DEFAULT 'anyone',
  closes_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_polls_post ON polls(post_id);
CREATE INDEX IF NOT EXISTS idx_polls_cm ON polls(community_id);
CREATE TABLE IF NOT EXISTS poll_options (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id, option_id)
);
CREATE INDEX IF NOT EXISTS idx_pv_poll ON poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_pv_user ON poll_votes(poll_id, user_id);
