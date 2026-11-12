-- M5.2.1 消息引用回复
ALTER TABLE messages ADD COLUMN reply_to_id TEXT REFERENCES messages(id);
CREATE INDEX IF NOT EXISTS idx_msg_reply ON messages(reply_to_id);
