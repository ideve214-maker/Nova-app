-- M4.5.2 消息可引用媒体（记录仍分离，仅存 media_id）。
ALTER TABLE messages ADD COLUMN media_id TEXT REFERENCES media(id);
