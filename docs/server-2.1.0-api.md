# 服务端 2.1.0 接口说明

所有 `/api/admin/*` 接口都要管理员登录（`Authorization: Bearer <管理员令牌>`），写操作都会记审计。返回体里会多一个路由自动加的 `ok: true`。

## 1. 外部帖 AI 审查（对应管理端「外部帖审查」卡片）

| 方法 | 路径 | 参数 | 返回 |
|---|---|---|---|
| GET | `/api/admin/ai-moderation/import` | 无 | `{settings, stats, job}` |
| POST | `/api/admin/ai-moderation/import` | `{enabled?, reviewComments?, onAiDown?, autoBackfill?}` | 同上 |
| POST | `/api/admin/ai-moderation/import/backfill` | `{scope: "all" \| "v2ex" \| "hn"}` | `{settings, stats, job}`；已有任务在跑时 409 `JOB_RUNNING`，`error.job` 是当前任务 |
| POST | `/api/admin/ai-moderation/import/backfill/stop` | 无 | `{settings, stats, job}` |
| GET | `/api/admin/ai-moderation?kind=import` | 原有参数 + `kind` | `logs[]`，每条多 `origin`（v2ex/hn）、`originUrl`、`action` |

- `settings`：`enabled`（默认 true）、`reviewComments`（默认 true）、`onAiDown`：`skip`（默认，AI 不可用时先不入库，下轮再审）或 `keyword`（只用关键词过滤）、`autoBackfill`（默认 true，每轮导入后顺手补审 10 条旧帖）。
- `stats`：`unreviewedPosts`、`unreviewedComments`、`rejectedPostsToday`、`rejectedCommentsToday`、`passedPostsToday`（按北京时间算“今天”）。
- `job`：`null` 或 `{id, status: running|done|stopped|failed, scope, total, done, passedPosts, hiddenPosts, removedComments, skipped, startedAt, finishedAt, error, actorId}`。
- 记录 `kind`：`import`（导入时审帖）、`import_comment`、`backfill`（补审帖）、`backfill_comment`；`action`：`stored` / `rejected` / `hidden` / `removed` / `null`。
- 补审不合格：帖子隐藏（`admin_hidden=1`，原因“AI 补审未通过：…”），评论软删除（可在管理端恢复）。

## 2. AI 模型设置（对应管理端「AI 接口与额度」页的模型下拉框）

| 方法 | 路径 | 参数 | 返回 |
|---|---|---|---|
| GET | `/api/admin/ai/model` | 无 | `{provider, model, saved, source, default, updatedAt, presets}` |
| POST | `/api/admin/ai/model` | `{provider: "zhipu", model: "glm-5.3-flash"}`；`model` 传空字符串 = 清除设置 | 同上 |

- `model` 可以自由填写：字母、数字和 `. _ - : / [ ]`，最长 80；带 `deepseek` 的拒绝（400 `BAD_MODEL`）。
- 实际生效顺序：管理端保存的 > `.env` 的 `AI_MODEL`（`source: "env"`）> 默认 `glm-4.7-flash`（`source: "default"`）。
- 读这个设置的：外部帖审查、发帖 / 评论 AI 审查、管理端 AI 助手和营销自动发帖（服务器默认的智谱接口）、用户端 AI 助手和翻译、运营日报；额度卡片和接口列表里“服务器默认”的模型名也显示它。管理端另外添加的服务商仍用各自填的模型。
- 智谱官方编码：GLM-5.3-Flash = `glm-5.3-flash`，GLM-5.3-FlashX = `glm-5.3-flashx`，GLM-4.7-Flash（免费）= `glm-4.7-flash`。
- GLM-5.x 只能开思考：服务端不发 `thinking: disabled`，`max_tokens` 至少 4096，管理端 AI 超时放宽到 60 秒；GLM-4.5/4.6/4.7 自动关思考。

## 3. 其他改动（无新接口）

- 营销帖：去掉权重，广告等概率随机、同一次不重复；旧版管理端传的 `weight` 会被忽略。迁移 `064_import_ai_review.sql`。
- 导入：每 2 分钟一轮，每个来源每轮最多新入库 20 帖（已有的不占名额），每帖 20 条评论；V2EX 读最新 + 热门，HN 读 top/new/best。
- 外部帖头像：帖子和评论的 `author.avatar` 现在有 `image`（配置 `NOVA_PUBLIC_ORIGIN` 后是完整地址）、`path`（相对代理地址，客户端可用 `apiUrl()` 拼）、`fallback`（字母头像）。代理拉不到原图时返回默认人像，不再 404；头像在 `data/import-avatars/` 缓存 7 天。启动时把旧数据里的远程原图地址改成代理地址。
- 私聊文件：支持 doc/docx/xls/xlsx/ppt/pptx/wps/csv/md/rar/7z，按文件头核对（docx 等必须是 ZIP，doc 等必须是 OLE 或 ZIP）；手机传 `application/octet-stream` 或文件名没扩展名时按文件头识别；可执行文件拒收；存储的 MIME 只用白名单里的。
- 私聊视频：支持 .mov（`video/quicktime`）、.m4v、.3gp；老式 QuickTime 文件头也能识别。大小上限不变：普通 50 MB、VIP 100 MB，时长 3 / 5 分钟。

## 4. 服务端 2.1.1：管理员自己改密码

| 方法 | 路径 | 参数 | 返回 |
|---|---|---|---|
| POST | `/api/admin/me/password` | `{currentPassword, newPassword}` | `{ok: true}` |

- 需要已登录的管理员会话（与其他 `/api/admin/*` 相同的 Bearer）。管理员与普通用户分表、分会话。
- 先核对 `currentPassword`；错误返回 400 `WRONG_PASSWORD`。与登录共用同一把锁定：同一管理员账号累计失败 5 次后 429 `LOCKED`，15 分钟后再试。
- `newPassword` 沿用现有规则（8–128 位，同时包含字母和数字）；不合格返回 400 `WEAK_PASSWORD`。新密码与当前密码相同返回 400 `SAME_PASSWORD`。
- 成功后更新密码哈希，使该管理员的其他登录会话失效（当前会话保留），并写审计 `admin.self.change_password`（详情里不含密码）。

## 5. 服务端 2.1.1：AI 发帖改为每轮条数

设置和状态在 `GET/POST /api/admin/ai/auto-ads`、`POST /api/admin/ai/auto-ads/settings`、`POST /api/admin/ai/auto-ads/run` 的 `settings` / `status`（以及 `GET /api/admin/ai/auto-ads/precheck`）里。

- `settings.perRun`：每轮发布多少条（整数 1–100，默认 10，上限为 `status.runMax`，对应 `ADMIN_AI_AUTO_ADS_RUN_MAX`，默认 100）。`POST` 设置时也可传 `dailyCap`（旧字段别名，写入 `perRun`；传 `0` 当作默认 10）。响应里 `dailyCap` 始终等于 `perRun`。
- 未保存过 `autoads.perRun` 时，沿用已存的 `autoads.dailyCap`（>0），否则 10。
- 每天到点（`ADMIN_AI_AUTO_ADS_HOUR`，默认 10:00）自动跑一轮，发 `perRun` 条新帖；「立即运行一轮」再发 `perRun` 条，不检查、不占用定时那一轮的数量。同一天定时仍只跑一次；进行中的一轮仍用 `running` 互斥。
- `status.todayPublished`：今天 AI 发帖总数（上海时间）。`scheduledToday`：其中 `ai_trigger=schedule` 的条数。`manualToday`：手动运行、助手代发、发布接口等非定时条数。
- 一轮会按方向轮流搜索，直到发够 `perRun`、方向用尽或当天联网搜索次数用完（`ADMIN_AI_SEARCH_RPD`）。模型调用最多 `perRun × 3` 次。没发满时 `result.stopped` 为 `search_budget` 或 `no_more_results`。
