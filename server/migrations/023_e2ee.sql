-- M4.11.3 / M4.11.4：设备公钥、一次性预密钥，以及消息密文字段。
-- 只存公钥与密文。私钥、会话 pickle、明文不得写入本库。

CREATE TABLE IF NOT EXISTS e2ee_devices (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  curve25519 TEXT NOT NULL,
  ed25519 TEXT NOT NULL,
  fallback_key_id TEXT,
  fallback_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_e2ee_dev_user ON e2ee_devices(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS e2ee_one_time_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES e2ee_devices(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  key_id TEXT NOT NULL,
  key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  claimed_by_user_id INTEGER,
  claimed_by_device_id TEXT,
  UNIQUE(device_id, key_id)
);
CREATE INDEX IF NOT EXISTS idx_e2ee_otk_free ON e2ee_one_time_keys(device_id, claimed_at);

ALTER TABLE messages ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN ciphertext TEXT;
ALTER TABLE messages ADD COLUMN e2ee_type TEXT;
ALTER TABLE messages ADD COLUMN sender_device_id TEXT;
ALTER TABLE messages ADD COLUMN recipient_device_id TEXT;
ALTER TABLE messages ADD COLUMN olm_session_id TEXT;
