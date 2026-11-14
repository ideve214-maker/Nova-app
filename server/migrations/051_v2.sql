-- VEXO 2.0：官方/官方授权标识、投票与活动管理、技能交换、共创项目、用户标签、注销账号
ALTER TABLE users ADD COLUMN badge TEXT;            -- 'official' 官方账号 | 'authorized' 官方授权账号 | NULL
ALTER TABLE users ADD COLUMN badge_at INTEGER;
ALTER TABLE users ADD COLUMN deleted_at INTEGER;    -- 管理员注销账号（数据已匿名化）
ALTER TABLE users ADD COLUMN follower_bonus INTEGER NOT NULL DEFAULT 0;  -- 管理员设置的额外粉丝数（展示 = 真实粉丝 + 额外）

ALTER TABLE polls ADD COLUMN deleted_at INTEGER;
ALTER TABLE polls ADD COLUMN removed_reason TEXT;

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  post_id TEXT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  cover_media_id TEXT,
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  place TEXT,
  online INTEGER NOT NULL DEFAULT 0,
  online_url TEXT,
  description TEXT NOT NULL DEFAULT '',
  cap INTEGER,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  removed_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_act_post ON activities(post_id);
CREATE TABLE IF NOT EXISTS activity_signups (
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER,
  PRIMARY KEY (activity_id, user_id)
);

CREATE TABLE IF NOT EXISTS exchange_posts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL,
  offers TEXT NOT NULL,
  wants TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',   -- open | closed | removed
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  removed_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_ex_status ON exchange_posts(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_ex_user ON exchange_posts(user_id);

-- 「咨询」后允许两人直接私聊（拉黑仍然优先）
CREATE TABLE IF NOT EXISTS dm_grants (
  lo INTEGER NOT NULL,
  hi INTEGER NOT NULL,
  source TEXT NOT NULL,
  ref_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (lo, hi, source)
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  capacity INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'recruiting',  -- recruiting | active | completed | cancelled | removed
  conversation_id TEXT,
  showcase TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  removed_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_pj_status ON projects(status, updated_at);
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',   -- owner | member
  status TEXT NOT NULL,                  -- requested | active | rejected | left | removed
  message TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS project_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee_id INTEGER,
  status TEXT NOT NULL DEFAULT 'todo',   -- todo | done
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  done_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pt_project ON project_tasks(project_id);
CREATE TABLE IF NOT EXISTS project_posts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                    -- notice | link | file
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  url TEXT,
  media_id TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pp_project ON project_posts(project_id, kind);

-- 管理端用户标签（测试账号 / 内部 / 正式用户 / 自定义）
CREATE TABLE IF NOT EXISTS user_tags (
  user_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by INTEGER,
  PRIMARY KEY (user_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_ut_tag ON user_tags(tag);
