# 0.7.0-m7.r7 需要服务端配合的地方

r7 只改了用户端网页部分（`src/`、`dist/`），可以热更新。本分支**没有改** `server/` 的代码（只同步了测试里的版本号），也没有连过生产服务器。
下面几项要等服务端上线后才完全生效。在那之前前端已经做了降级处理。

## 1. 帖子里的照片/视频，别人能看到（必须改）

- 现状：`server/media.mjs` 的 `canAccess()` 只允许**上传者本人**或**会话成员**读取媒体。帖子媒体没有会话，所以别人的帖子图片会 404。
- r7 前端：发帖时先 `POST /api/media` 上传，帖子只带 `{id, kind}`；显示时先 `POST /api/media/:id/ticket` 拿凭证，再用 `GET /api/media/:id/file?ticket=…`（视频封面用 `/preview`）。
  - 现在的效果：**自己**发的照片/视频自己能看到；别人的帖子显示“暂时无法显示”。
- 需要服务端：`canAccess(user,row)` 增加一条：媒体 id 出现在一条未删除的帖子 `posts.media` 里，并且当前用户按该帖 `audience` 能看到这条帖子（public／followers／friends／self 跟 `GET /api/posts` 的过滤规则一致），就允许访问。
  - 建议加索引或单独的 `post_media(post_id, media_id)` 表，避免每次都扫 JSON。

## 2. 日常（story）独立存储（建议改）

- 现状：`posts` 表没有类型字段。
- r7 前端：日常也走 `POST /api/posts`，会带上 `kind:"story"`（现在的服务端会忽略这个字段），并把 `mood` 写成隐藏标记 `__nova_story__`。前端凭这两个标记中的任意一个识别日常：只放在首页顶部那一排，24 小时后不再显示，不进帖子列表，不算帖子数。
- 服务端没改之前的副作用：
  1. 日常在数据库里仍然是一条普通帖子。管理端、搜索、服务端统计的帖子数会把它算进去，24 小时后也不会自动删除。
  2. 日常和帖子共用 `GET /api/posts?limit=50` 返回的 50 条，帖子多的时候，早些的日常可能拿不到。
  3. 没热更新的旧客户端会把它当普通帖子显示（心情一栏是 `__nova_story__`）。
- 需要服务端：
  - 迁移：`ALTER TABLE posts ADD COLUMN kind TEXT NOT NULL DEFAULT 'post'`，加索引 `(kind, deleted_at, created_at)`。
  - `POST /api/posts` 接收 `kind`（只允许 `post`／`story`），并在返回的帖子对象里带上 `kind`。
  - `GET /api/posts`（各个 feed）、搜索、话题、个人主页的帖子数都排除 `kind='story'`。
  - 新接口 `GET /api/stories`：返回自己和关注／好友在 24 小时内的日常，按作者分组。超过 24 小时的日常定时清理，或者至少不再返回。
  - 迁移时把 `mood='__nova_story__'` 的旧数据改成 `kind='story', mood=NULL`。

## 3. iPhone 视频格式（可选）

- 服务端视频只认 mp4／webm。iPhone 拍的 `.mov` 前端按 `video/mp4`、文件名 `.mp4` 上传（mov 和 mp4 是同一种容器，服务端魔数检查能通过）。
- HEVC 编码的视频在部分安卓机上可能放不出来。要彻底解决，需要服务端用 ffmpeg 转码成 H.264。

## 4. 不需要服务端的项

防缩放、建群面板、小组页文案和按钮、小组三栏、心情、位置、标记好友、关注数位置、去掉“活动”、小游戏行，这些都是纯前端改动。
