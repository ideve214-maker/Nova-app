# 热榜服务器说明（用户端，分支 feat/v2ex-hn-hot-v2）

给 Dift 部署用。没有密钥，也不用改环境变量。需要先部署服务器、跑迁移，再发热更新。

## 接口

- `GET /api/hot?source=v2ex` 或 `source=hn`（需登录）
- 不带 `source` 时同时返回两边
- 响应里只有 `title`、`url`、`author`、`heat`、`publishedAt`、`sourceLabel`、`sourceHome`，没有正文
- 页脚出处在 `attribution`

## 数据库

- 新迁移：`server/migrations/059_hot_items.sql`（用户端，编号从 059 起）
- 表 `hot_items`，`UNIQUE(source, source_id)` 去重
- 每轮刷新会用新快照替换该来源当前列表（过期条目删掉）

## 拉取

- V2EX：`https://www.v2ex.com/api/topics/hot.json`（无需 token）
- Hacker News：`https://hacker-news.firebaseio.com/v0/topstories.json`，再按 id 取 `/v0/item/{id}.json`
- 默认每 15 分钟拉一次，每次约 20 条；HN 条目分批、带间隔，User-Agent 为 `VEXO-hot (+https://github.com/ideve214-maker/VEXOold)`
- 拉取失败时保留上次成功的结果
- 服务器需要能访问上述两个官方地址
- 进程启动后会自动开始定时拉取（与草稿定时发布一样，在非内存库上默认开启）

## 不要做的事

- 不要把正文、`content`、`text` 存进数据库或返回给 App
- 不要把任何密钥写进代码或热更新包（本功能也用不到密钥）
