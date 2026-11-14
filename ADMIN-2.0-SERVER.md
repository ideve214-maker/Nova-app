# 管理端 2.0 服务端补丁（feat/v2-admin-server）

基于已发布的用户端 2.0.0（030fb9e / 文档 8e741d8）。**不要直接改 /workspace/user**（那边有未提交的 2.0.1 工作）。发布由 E 负责，本分支只暂存。

## 这个分支加了什么

不需要新的数据库迁移：051 已经有 `users.badge`、`users.follower_bonus`、`users.deleted_at`、`user_tags`。

新增接口（均需管理员登录）：

- `POST /api/admin/users/:id/profile` 编辑昵称 / 简介
- `POST /api/admin/users/:id/follower-bonus` `{bonus}`，展示粉丝数 = 真实关注 + 加成
- `POST /api/admin/users/:id/badge` 已在 2.0.0 存在（official / authorized）
- `GET/POST /api/admin/users/:id/tags`、`POST /api/admin/users/:id/tags/delete`
- `GET /api/admin/tags`、`POST /api/admin/tags/bulk-delete`
- `GET /api/admin/users?tag=` 按标签筛选；默认不列出已注销账号，`?status=deleted` 可查看
- `POST /api/admin/users/:id/notify`、`POST /api/admin/notifications`（全体或指定 userIds）
- `POST /api/admin/users/:id/delete` 二次确认：`confirm` 必须是「确认删除」，且 `confirmUsername` 必须是该用户的用户名或邮箱
- `GET/POST /api/admin/ai-assistant/report` AI 助理日报（智谱 glm-4-flash）
- 投票 / 活动 / 技能交换 / 共创的查看与移除接口已在 2.0.0 存在（`/api/admin/v2/...`）

粉丝加成会作用在 `GET /api/follows` 返回的 `followerCount`（另有 `followerCountReal`、`followerBonus`）。

## 环境变量（不要把密钥值写进日志或文档）

沿用现有智谱配置，不必新加密钥：

- `AI_API_KEY` 或 `ZHIPU_API_KEY`
- `AI_API_BASE`（默认 https://open.bigmodel.cn/api/paas/v4）
- `AI_MODEL`（默认 glm-4-flash）

地址或模型名里带 deepseek 会拒绝调用，退回本地统计摘要。未配置密钥时同样返回本地摘要，并标明服务商「智谱」。

## 与用户端 2.0.1（未提交）的合并注意

用户端工作区已有未提交的 `052_ad_card.sql`（营销帖增加 avatar / domain / subtitle）和 `053_project_leads.sql`。本分支**没有**再占用 052/053，也**没有**改 `marketing.mjs`，避免和那边冲突。

管理端 2.0 发布表单会提交 `avatar`、`domain`、`subtitle`，标签固定为「推广」。这些字段要等用户端 2.0.1 的 052 和 `marketing.mjs` 一并上线后才会落库；在此之前服务端会忽略多余字段。

若还需要新迁移，请从 **054** 起编号。

## 给 E 的部署顺序

1. 先备份（app tgz + nova.db + env），再发布用户端 2.0.1 服务端（含 052、053，以及本分支合并进来的 admin-v2 接口）。052/053 与本分支无冲突，可按文件名顺序迁移。
2. 确认 `/api/health` 正常，跑服务端测试（至少 `m22-admin-v2.test.mjs`、`m-admin-users.test.mjs`、`m20-v2.test.mjs`、`m414-follows.test.mjs`）。
3. 再推管理端 2.0.0 热更新。管理端依赖上述新接口，不要先于服务端切换清单。
4. 环境变量已有智谱配置即可，不必新密钥。不要打印密钥。
