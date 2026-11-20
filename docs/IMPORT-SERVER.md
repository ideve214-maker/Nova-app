# V2EX / Hacker News 导入（给 Dift 的部署说明）

把 V2EX 热帖和 Hacker News 热门故事写成数据库里真正的帖子和评论，出现在用户端首页信息流里，和本站用户发的帖混排。每条带「来自 V2EX」或「来自 HN」标记，以及「查看原帖」链接。界面显示原作者名字和头像，不冒充本站用户。社区页不加入口。

**先部署服务器并跑迁移，再发热更新。** 这一项没有 API 密钥。服务器要能访问 `www.v2ex.com` 和 `hacker-news.firebaseio.com`。

## 迁移

- 用户端追加迁移 `062_import_feed.sql`。059、060、061 已被管理端占用（`059_ai_auto_ads.sql`、`060_ai_providers_quota.sql`、`061_ai_failover.sql`），所以导入迁移用 062。
- 迁移运行器按**完整文件名**记在 `schema_migrations`，不是按编号取最大已执行值。因此即使库里已经跑过 057–061，只要还没有 `056_post_repost.sql` 这条记录，056 仍会执行。
- `posts` 和 `post_comments` 增加：`source`、`source_id`、`source_url`、`ext_author_name`、`ext_author_avatar`。
- 部分唯一索引 `UNIQUE(source, source_id)`（source 为空的普通帖不受影响），用来去重。
- 管理端删除或隐藏的帖（`deleted_at` 或 `admin_hidden`）导入任务不会再写入、也不会恢复。

## 系统账号

第一次导入时，服务器会自动建立用户名为 `vexo_import`、邮箱 `vexo-import@vexo.invalid` 的系统账号，只用来满足 `author_id` 外键。密码是随机的，不能登录，也不能用这个用户名注册。界面不显示这个账号，只显示外部作者名和头像。

## 定时拉取

- 默认每 2 分钟跑一轮（2.1.0 起；以前 15 分钟）。每个来源每轮最多新入库 20 帖、每帖最多 20 条评论，入库前先过 AI 审查（见 docs/server-2.1.0-api.md）。启动后大约 20 秒开始第一次（避免和别的启动任务挤在一起）。
- 测试或临时关掉：`NOVA_IMPORT_AUTO=0`。
- 间隔：`NOVA_IMPORT_INTERVAL_MS`（毫秒，默认 `120000`）；每轮新帖上限 `NOVA_IMPORT_LIMIT`（默认 20）；每帖评论上限 `NOVA_IMPORT_COMMENT_LIMIT`（默认 20）；V2EX 每小时请求预算 `NOVA_IMPORT_V2EX_PER_HOUR`（默认 100）；头像完整地址 `NOVA_PUBLIC_ORIGIN`（例如 `http://47.239.0.90`）。
- 每一轮每个来源最多约 20 条，每条最多导入约 10 条评论。请求带固定 UA（`VEXO/2.0.6 (feed-import; …)`），条目之间间隔约 800ms。V2EX 评论接口单独用 45 秒超时，失败（含超时中断）会在当轮按 1s/2s 退避重试最多 3 次；仍失败则留下帖子、记下日志，下一轮会给还缺评论的已导入帖补评论。
- 接口：
  - V2EX：`https://www.v2ex.com/api/topics/hot.json`，评论 `https://www.v2ex.com/api/replies/show.json?topic_id=`
  - HN：`https://hacker-news.firebaseio.com/v0/topstories.json`，条目 `https://hacker-news.firebaseio.com/v0/item/{id}.json`（含 kids）
- 某一侧拉取失败时，已经入库的帖全部保留，下一轮再试。不会清空旧数据。
- HN 标题保持英文。正文里的 HTML 会先转成纯文本再入库。

## 头像

V2EX 头像经本站代理并在内存缓存：`GET /api/import/avatar?u=<原始 https 地址>`，只允许 `v2ex.com` / `cdn.v2ex.com` 等白名单主机，单张不超过 1MB，不接受 SVG。HN 没有官方头像，服务器按作者名生成字母头像（data URI），不访问外网。

## 环境变量（可选）

```
# NOVA_IMPORT_AUTO=0
# NOVA_IMPORT_INTERVAL_MS=120000
# NOVA_PUBLIC_ORIGIN=http://47.239.0.90
```

不需要密钥，也不要把密钥或 `.env` 写进仓库或热更新包。

---

# 给 Agen 的说明（管理端，本分支不改管理端代码）

导进来的帖和评论就是 `posts` / `post_comments` 里的普通行，现有管理端的删除、隐藏、恢复、设热帖、编辑都可以直接用，不用改管理端就能管。作者字段的 `author_id` 指向系统账号 `vexo_import`；要展示或筛选时请用下面这些新列（本轮未改管理端界面）：

| 列 | 表 | 含义 |
| --- | --- | --- |
| `source` | posts, post_comments | `v2ex` 或 `hn`；本站用户发的帖为空 |
| `source_id` | 同上 | 来源站的条目 ID（评论带前缀，如 `v2ex-reply-123`） |
| `source_url` | 同上 | 原帖或原评论链接 |
| `ext_author_name` | 同上 | 来源站显示的作者名 |
| `ext_author_avatar` | 同上 | 头像：代理路径、原始 URL，或空（HN 用字母头像） |

建议以后在内容列表里按 `source` 筛选，并把列表里的作者名改成 `ext_author_name`（有值时），不要把系统账号当成真实用户展示。设热帖仍走现有的 `hot_posts` 表，用导入帖的 `posts.id` 即可。对导入帖执行删除或隐藏后，导入任务会记住，不会再写回来。
