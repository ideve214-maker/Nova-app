# 服务端 2.1.2 接口补充

需要迁移 `066_post_category.sql`（065 留给 AI 内部账号，不要占用）。

## 帖子分类 `category`

取值只能是：`tech`、`game`、`crypto`、`finance`、`news`、`life`、`other`。

- 外部导入帖：按来源默认分类入库（科技源 `tech`，游戏 `game`，币圈 `crypto`，财经 `finance`，B 站热门 `life`）。AI 审查可通过返回 `topics[].category` 改判。
- 用户发帖 / AI 内部账号发帖：`POST /api/posts`、编辑接口可传 `category`。非法值返回 400 `BAD_CATEGORY`。
- 所有帖子 payload 都带 `category`（没有时为 `null`）。

## 外部帖来源

新来源都走 `import-feed.mjs` 的统一入库函数（先 AI 审查再保存）。币圈、财经来源的审查提示词额外拦截喊单、交易信号、交易所和空投推广。

管理端补审 `POST /api/admin/ai-moderation/import/backfill` 的 `scope` 可以是 `all` 或任意已配置来源 id。
