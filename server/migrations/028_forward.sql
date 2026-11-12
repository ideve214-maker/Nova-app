-- M5.2.2 消息转发
ALTER TABLE messages ADD COLUMN forwarded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN forward_from_message_id TEXT;
ALTER TABLE messages ADD COLUMN forward_from_user_id INTEGER;
ALTER TABLE messages ADD COLUMN forward_from_conversation_id TEXT;
ALTER TABLE messages ADD COLUMN forward_label TEXT;
