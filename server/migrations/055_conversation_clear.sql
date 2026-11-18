-- 2.0.3 私聊「删除会话」：只影响自己一侧，记录清除时间，之前的消息不再对自己显示
ALTER TABLE conversation_members ADD COLUMN cleared_at INTEGER;
