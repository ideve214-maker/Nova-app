-- 社区封面与头像：模板资源路径（assets/...）或媒体 id（md_...）。
ALTER TABLE communities ADD COLUMN cover TEXT;
ALTER TABLE communities ADD COLUMN avatar TEXT;
