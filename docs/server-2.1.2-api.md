# 服务端 2.1.2 接口补充

需要迁移 `066_post_category.sql` 和 `067_feed_interests.sql`（065 留给 AI 内部账号，不要占用）。

## 帖子分类 `category`

取值只能是：`tech`、`game`、`crypto`、`finance`、`news`、`life`、`other`。

- 外部导入帖：按来源默认分类入库（科技源 `tech`，游戏 `game`，币圈 `crypto`，财经 `finance`，B 站热门 `life`）。AI 审查可通过返回 `topics[].category` 改判。
- 用户发帖 / AI 内部账号发帖：`POST /api/posts`、编辑接口可传 `category`。非法值返回 400 `BAD_CATEGORY`。
- 所有帖子 payload 都带 `category`（没有时为 `null`）。

## 外部帖来源

新来源都走 `import-feed.mjs` 的统一入库函数（先 AI 审查再保存）。币圈、财经来源的审查提示词额外拦截喊单、交易信号、交易所和空投推广。

管理端补审 `POST /api/admin/ai-moderation/import/backfill` 的 `scope` 可以是 `all` 或任意已配置来源 id。

## 偏好与「为你推荐」

都需要登录。分类取值同上面的 `category`；来源 `origin` 是已配置的外部帖来源 id（如 `sspai`、`hn`、`v2ex`）。

### `GET /api/me/interests` / `PUT /api/me/interests`

请求和响应都是：

```json
{ "like": ["tech"], "dislike": ["crypto"], "hiddenSources": ["sspai"], "onboarded": true }
```

- `PUT` 会把 `onboarded` 设为 `true`。可只传要改的字段，未传的保持原值。
- 非法分类：400 `BAD_CATEGORY`。非法来源：400 `BAD_SOURCE`。未登录：401。
- 同一分类同时出现在 `like` 和 `dislike` 时，以 `dislike` 为准。

### `POST /api/feed/not-interested`

```json
{ "postId": "po_xxx", "reason": "post" }
```

`reason` 只能是 `post`（只隐藏这一条）、`category`（把该帖分类加入 `dislike`）、`source`（把该帖来源加入 `hiddenSources`）。帖子不存在：404 `NOT_FOUND`。没有分类或来源时分别返回 400 `NO_CATEGORY` / `NO_SOURCE`。成功返回 `{ok:true, interests}`。

### `POST /api/feed/signals`

```json
{ "events": [{ "postId": "po_xxx", "dwellMs": 1500, "action": "view", "at": 1730000000000 }] }
```

- `action`：`view`、`open`、`open_origin`、`like`、`save`、`share`、`hide`。非法 action：400 `BAD_ACTION`。
- 每批最多 100 条，超过返回 400 `TOO_MANY_EVENTS`。`dwellMs` 截断到 0–600000。不存在的 `postId` 会被忽略。
- 成功：`{ok:true, accepted:n}`（`n` 是实际写入的条数）。
- 限速（可调）：`FEED_SIGNALS_RPM`（默认 30 批/分钟）、`FEED_SIGNALS_EVENTS_RPM`（默认 2000 条/分钟），超限 429 `RATE_LIMIT`。`FEED_HIDE_RPM`（默认 60）限制「不感兴趣」。

兴趣分只给真人账号累计，内部 / AI 账号（`isInternalAccount`，065 落地前若 `badge=internal` 也视为内部）的浏览不参与学习。原始信号大约保留 30 天（`FEED_SIGNAL_KEEP_DAYS`）。

### 「为你推荐」排序（`GET /api/posts` 或 `?feed=rec`）

关注流（`feed=follow`）、话题流（`feed=topic`）和指定作者不受影响。

分数 = 偏好（`like` 加分，`dislike` 大幅减分）+ 按分类汇总的兴趣分（来自 signals，半衰期默认 7 天，`FEED_SCORE_HALFLIFE_DAYS`）+ 新鲜度（`FEED_FRESHNESS_HALFLIFE_HOURS`，默认 72）。`hiddenSources` 和「不感兴趣」的帖直接排除。大约两成位置做探索（`FEED_EXPLORE_RATIO`，默认 0.2），从非最爱分类里抽，仍尊重不喜欢和隐藏。没有偏好也没有兴趣分的新用户，保持原来的时间倒序。

其它可调环境变量：`FEED_CANDIDATE_POOL`（默认 300）、`FEED_LIKE_BONUS`、`FEED_DISLIKE_PENALTY`、`FEED_LEARNED_WEIGHT`、`FEED_FRESHNESS_WEIGHT`。
