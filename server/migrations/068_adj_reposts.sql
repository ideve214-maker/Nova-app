-- 068 转帖数据调整列（Dift）。065 不加此列，避免重复 ALTER。
ALTER TABLE posts ADD COLUMN adj_reposts INTEGER NOT NULL DEFAULT 0;
