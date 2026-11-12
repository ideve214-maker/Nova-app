-- 消息可贴贴纸。JSON 存于独立列；kind 仍为 text，以免改动既有 CHECK。
-- 贴纸对象由服务端根据白名单生成，不信任客户端自带的 glyph/name。
ALTER TABLE messages ADD COLUMN sticker TEXT;
