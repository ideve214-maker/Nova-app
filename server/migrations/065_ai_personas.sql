-- 065 AI 官方内部账号（Cc）。只新增表，不改已有表。
-- 账号本身是普通 users 行（users.badge='internal'，不能登录），这里存设定和调度状态。
-- 帖子分类列 posts.category 由 Dift 的 066 迁移添加；转帖的数据调整列 adj_reposts 也由 Dift 负责，这里不加，免得重复加列。
CREATE TABLE IF NOT EXISTS ai_personas (
  user_id        INTEGER PRIMARY KEY REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'active',   -- active | paused | retired
  persona        TEXT NOT NULL DEFAULT '{}',       -- JSON：兴趣分类、语气（本地随机，不调 AI）
  avatar_style   TEXT,
  avatar_seed    TEXT,
  overrides      TEXT,                             -- JSON：单个账号覆盖全局频率，可空
  next_at        INTEGER NOT NULL DEFAULT 0,
  next_post_at   INTEGER NOT NULL DEFAULT 0,
  last_action_at INTEGER,
  replied_until  INTEGER NOT NULL DEFAULT 0,       -- 已经检查过的「真人评论我的帖子」时间点
  created_at     INTEGER NOT NULL,
  retired_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_personas_due ON ai_personas(status, next_at);

CREATE TABLE IF NOT EXISTS ai_persona_actions (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  kind    TEXT NOT NULL,   -- browse | like | favorite | repost | comment | reply | post | join_group | group_post
  target  TEXT,
  ref_id  TEXT,
  ok      INTEGER NOT NULL DEFAULT 1,
  error   TEXT,
  model   TEXT,
  tokens  INTEGER,
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aipa_at ON ai_persona_actions(at);
CREATE INDEX IF NOT EXISTS idx_aipa_user ON ai_persona_actions(user_id, at);
CREATE INDEX IF NOT EXISTS idx_aipa_target ON ai_persona_actions(target, kind);
CREATE UNIQUE INDEX IF NOT EXISTS idx_aipa_once ON ai_persona_actions(user_id, kind, target)
  WHERE kind IN ('browse','like','favorite','repost','join_group') AND ok=1;

CREATE TABLE IF NOT EXISTS ai_feed_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,            -- news | politics | sports | economy | tech | game | crypto | life
  lang TEXT NOT NULL DEFAULT 'zh',
  convert TEXT,                      -- t2s：入库时繁体转简体
  enabled INTEGER NOT NULL DEFAULT 1,
  builtin INTEGER NOT NULL DEFAULT 0,
  etag TEXT, last_modified TEXT,
  last_fetched_at INTEGER, last_ok_at INTEGER, last_error TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_feed_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  guid TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  category TEXT NOT NULL,
  published_at INTEGER,
  fetched_at INTEGER NOT NULL,
  used_post_id TEXT, used_by INTEGER, used_at INTEGER,
  UNIQUE(source_id, guid)
);
CREATE INDEX IF NOT EXISTS idx_aifi_unused ON ai_feed_items(used_at, category, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_aifi_url ON ai_feed_items(url);
