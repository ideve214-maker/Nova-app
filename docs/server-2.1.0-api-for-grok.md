# 管理端 2.0.8 需要的服务端（2.1.0）改动 —— 给 Grok

## 1. 营销帖去权重、随机不重复（server/marketing.mjs）
- pickFor：去掉按 weight 加权，改为等概率随机；同一次下发不放回，**不再在候选用完后重复**（want = min(perFeed, 候选数)）。
- create/update：忽略 weight（管理端已不再提交）；建议去掉 weight 唯一约束和 WEIGHT_TAKEN(409)，或继续自动填 max+1 但不参与挑选。adminList 的 nextWeight 可删。
- ai-auto-ads / 管理端 AI 助手创建营销帖时也不要再依赖 weight。
- 可选：跨刷新也尽量不重复（例如按用户记最近看过的 ad id，优先没看过的）。

## 2. 外部帖 AI 审查（server/import-feed.mjs + ai-moderation.mjs）
- import-feed 在 upsertPost / upsertComment 之前调用 aiMod 审查（新 kind：import / import_comment），不合格的**不入库**，并记住 source+source_id 不再重复审/导入。
- AI 不可用时按设置 onAiDown：skip = 本轮不入库下轮再审（默认）；keyword = 只过屏蔽词就入库。
- posts / post_comments 需要记录是否已 AI 审过（例如 ai_reviewed_at 列，新迁移）。

### 接口（管理端已按此对接；404 时管理端显示「需服务端 2.1.0」）
- GET  /api/admin/ai-moderation/import → { settings, stats, job }
- POST /api/admin/ai-moderation/import  body: Partial<settings> → 同上
  - settings = { enabled: boolean(默认 true), reviewComments: boolean(默认 true), onAiDown: "skip"|"keyword" }
  - stats = { unreviewedPosts, unreviewedComments, rejectedPostsToday, rejectedCommentsToday, passedPostsToday }
  - job = null | { id, status: "running"|"done"|"stopped"|"failed", scope: "all"|"v2ex"|"hn", total, done, passedPosts, hiddenPosts, removedComments, skipped, startedAt, finishedAt|null, error|null }
- POST /api/admin/ai-moderation/import/backfill  body { scope } → { job }（后台异步补审已发布外部帖+评论；不合格帖 admin_hidden，不合格评论删除；已有任务在跑时返回 409）
- POST /api/admin/ai-moderation/import/backfill/stop → { job }
- 补审 kind：backfill / backfill_comment；受 AI_RPM/AI_RPD 限速，AI 不可用时计入 skipped，保持未审状态。
- 全部写操作要 adminAuth + audit。

### 审查记录 GET /api/admin/ai-moderation
- 新增查询参数 kind=import：返回 kind ∈ {import, import_comment, backfill, backfill_comment} 的记录。
- 每条记录新增：origin("v2ex"|"hn"|null)、originUrl、action("rejected"|"hidden"|"removed"|"stored"|null)。
