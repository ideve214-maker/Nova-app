-- r10：社区频道消息可以带图片/视频/语音/文件。
ALTER TABLE community_messages ADD COLUMN media_id TEXT;
ALTER TABLE media ADD COLUMN channel_id TEXT;
