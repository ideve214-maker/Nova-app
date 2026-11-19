-- 2.0.7 管理端 AI 服务商切换 + AI 额度面板。只新增表，不改旧数据。
-- 编号 060：接在 059_ai_auto_ads 之后。
-- 1) ai_providers：管理员在管理端添加的 AI 服务商（智谱 / Kimi / 硅基流动 / OpenRouter / 通义 / OpenAI / 其他 OpenAI 兼容接口）。
--    密钥只存服务端，AES-256-GCM 加密后存 key_enc（密钥来自 ADMIN_AI_KEY_SECRET，没有就用数据库旁边自动生成的 ai-keys.secret 文件）；
--    接口只返回打码后的密钥（如 sk-…abcd），永远不返回完整密钥。
--    服务器 .env 里原来的智谱密钥（AI_API_KEY / ZHIPU_API_KEY）不在这张表里，作为固定的“服务器默认（env）”服务商继续可用。
--    当前使用哪一家存在 admin_ai_settings 的 ai.activeProvider（没有这一行 = 用服务器默认的智谱）。
CREATE TABLE IF NOT EXISTS ai_providers(
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  key_enc TEXT,
  key_hint TEXT,
  model TEXT NOT NULL,
  search INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 2) ai_usage：每一次发出去的 AI 调用（对话 / 联网搜索），记服务商、模型、token 数。用来显示今天 / 7 天用量，
--    以及在服务商没有余额接口时按“管理员填的额度 − 已用”估算剩余。只保留 90 天。
CREATE TABLE IF NOT EXISTS ai_usage(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  kind TEXT NOT NULL,            -- chat / web_search
  ok INTEGER NOT NULL DEFAULT 1,
  status INTEGER,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider_at ON ai_usage(provider, at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_at ON ai_usage(at);

-- 3) ai_quota_settings：每家服务商的额度设置（可选）。budget_tokens = 资源包 / 预算总 token 数（估算剩余用），
--    budget_since = 从什么时候开始算已用；low_balance = 余额低于多少（元 / 美元）标红。
CREATE TABLE IF NOT EXISTS ai_quota_settings(
  provider TEXT PRIMARY KEY,
  budget_tokens INTEGER,
  budget_since INTEGER,
  low_balance REAL,
  updated_at INTEGER NOT NULL
);
