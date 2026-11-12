-- 注册时记录同意的法律文档版本；可选的按键皮肤偏好。
ALTER TABLE users ADD COLUMN legal_version TEXT;
ALTER TABLE users ADD COLUMN legal_agreed_at INTEGER;
ALTER TABLE users ADD COLUMN ui_skin TEXT;
