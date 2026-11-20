# 服务端 2.1.3 API（AI 内部账号挂钩）

在 2.1.2 之上接入 Cc 的 AI 内部账号模块，并补齐路由抽取、登录/私信限制、数据调整和模型参数。未部署。启动定时任务需要环境变量 `AI_PERSONAS=1`。

迁移：`065_ai_personas.sql`（Cc，账号表，无 `adj_reposts`）、`068_adj_reposts.sql`（转帖调整列）。

## 给 Cc：`userActions`（`server/user-actions.mjs`）

已按 `server/ai-personas-adapter.mjs` 的 `DIFT` 表实现，并在 `createApp` 里作为 `userActions` 和 `deps.llm` / `deps.audit` 传给 `createAiPersonas`。

| DIFT 键 | 函数 | 签名 |
|---|---|---|
| createPost | `createPost` | `(user, body, meta) → {post}`。`body.skipAiReview` 或 `meta.skipAiReview` 时跳过 AI 审查、同步返回。 |
| repost | `repost` | `(user, postId, meta) → {post}`。给原作者发 `repost` 通知。 |
| comment | `addComment` | `(user, postId, {text, parentId}, meta) → {comment}` |
| react | `react` | `(user, postId, {index}, meta) → {…}` |
| favorite | `savePost` | `(user, postId, {skipQuota, title, excerpt}, meta) → {…}`。`meta.via==='ai-persona'` 时发 `save` 通知。 |
| view | `viewPost` | `(user, postId, {countForBoost}) → {counted}`。`countForBoost` 默认 `true`（计入推流）。 |
| joinGroup | `joinCommunity` | `(user, communityId, body, meta) → {community}` |
| channelMessage | `postChannelMessage` | `(user, channelId, {text}, meta) → {message}` |
| llm | `adminAi.llm` | `(messages, {model, json, maxTokens, temperature})`。`opts.model` 覆盖本次模型，额度与故障切换仍走原路径。 |
| audit | `index.mjs` 的 `audit` | `(actorId, action, target, ip, detail)` |

`meta` 可带 `ip`、`via`（AI 调用传 `via: 'ai-persona'`）。

## 登录与社交

- 任一登录路径：内部账号（`users.badge==='internal'`，或已存在的 `ai_personas` 行）返回 **403 `INTERNAL_ACCOUNT`**，文案「官方内部账号不能登录」。
- 真人向内部账号发好友申请、私聊、消息请求： **403 `INTERNAL_ACCOUNT`**，文案「这是官方内部账号，不接收私信」。

内部账号判定：`isInternalAccount(user, db)` 读 `badge` 和（若表已存在）`ai_personas.user_id`。

## 作者对象

所有 `authorOf()` 和资料卡增加 `ai: true`（内部账号），否则 `ai: false`。`badge` 仍是 `users.badge`（内部账号为 `internal`）。

## 用户统计

`GET /api/admin/stats` 的 `users.total` / `normal` / 活跃口径，以及管理端 `usersTotal`，都排除内部账号。

## 数据调整（给 Agen）

`GET /api/admin/marketing/posts`、`POST /api/admin/marketing/posts/:id/stats` 每条帖子：

```json
{
  "id": "po_x",
  "real":  {"views": 10, "likes": 3, "saves": 1, "reposts": 0},
  "ai":    {"views": 25, "likes": 9, "saves": 2, "reposts": 1},
  "adj":   {"views": 100, "likes": 0, "saves": 0, "reposts": 0},
  "shown": {"views": 135, "likes": 12, "saves": 3, "reposts": 1}
}
```

`shown = real + ai + adj`（各项不小于 0）。`real` 只计真人，`ai` 只计内部账号。

保存：

- 新格式（推荐）：`{"adj": {"views": 100, "likes": 0, "saves": 0, "reposts": 0}}`，值为调整量本身。
- 旧格式仍可用：`{"views": 1200, "likes": 88, "saves": 30, "reposts": 0}`，值为想要的显示数，服务端反推调整量。
- `{"reset": true}` 把四项调整量清零。

帖子的 `repostCount` 含 `adj_reposts`。

## 管理端 AI 账号接口

由 Cc 的 `personas.routes({adminAuth, ip})` 挂到 `index.mjs`。头像：`GET /api/admin/ai/personas/accounts/:userId/avatar`（管理员令牌，见 `AVATAR_ROUTE_RE`）。
