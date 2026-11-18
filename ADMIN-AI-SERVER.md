# 管理端 AI 助手 — 服务器说明

迁移：`057_admin_ai.sql`（排在用户端 055、056 之后；新增表 admin_ai_pending，不改旧表）。
模块：`server/admin-ai.mjs`（助手 + 待确认动作）。
`server/index.mjs` 只做挂载：合并路由。用户端接口和行为没改。

## 接口（都要管理员 Bearer token）
- `GET /api/admin/ai/status`、`POST /api/admin/ai/chat`、`POST /api/admin/ai/confirm`、`POST /api/admin/ai/cancel`、`GET /api/admin/ai/pending`

## 确认机制（服务器强制）
- 模型只能“提议”写操作：服务器生成摘要并存入 admin_ai_pending，5 分钟过期，只能用一次。
- 只有同一个管理员、同一个 token 才能确认；确认时按存下来的 method/path/body 原样执行，客户端传的参数会被忽略。
- 执行走现有管理接口（同样的校验和审计）。付款、退款、钱相关的接口全部拦截；注销账号不开放给 AI。
- 审计动作：admin.ai.proposed / confirmed / executed / cancelled / expired / failed / denied / blocked / chat / propose_rejected。
- 发给模型的数据会去掉邮箱、IP、手机号、密码、token 等字段。

## 环境变量
见 `.env.example` 末尾“管理端 AI 助手”一节。不需要新密钥。

## 测试
`server/test/m30-admin-ai.test.mjs`（已加进 `npm run test:server`），用假的 LLM 测试，不调用真实智谱。
