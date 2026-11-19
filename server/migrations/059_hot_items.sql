-- 热榜：只存标题、热度、作者、时间和原帖链接，不存正文。按 source+source_id 去重。
CREATE TABLE IF NOT EXISTS hot_items (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  author TEXT,
  heat INTEGER,
  published_at INTEGER,
  fetched_at INTEGER NOT NULL,
  UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_hot_items_source_fetched ON hot_items(source, fetched_at DESC);
