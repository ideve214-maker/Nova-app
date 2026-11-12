-- M4.4.1 / M4.4.2 / M4.4.6：已读游标、会话个人置顶、静音。不影响消息存储。
ALTER TABLE conversation_members ADD COLUMN last_read_message_id TEXT;
ALTER TABLE conversation_members ADD COLUMN last_read_at INTEGER;
ALTER TABLE conversation_members ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_members ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
