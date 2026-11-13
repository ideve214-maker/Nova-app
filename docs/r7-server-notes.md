# 0.7.0-m7.r7 需要服务端配合的地方

> 更新：第 10 项（热门话题）和第 11 项（公告弹窗）的服务器接口**已经在本分支 `server/` 里实现**（`server/featured.mjs`、`server/admin-ops.mjs`、迁移 042、043），需要部署服务器后才生效；部署前前端会自动退回旧行为。下面第 1～3 项和第 5 项是**还没做**的服务器改动。

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

## 5. 帖子互动栏（第 7 项）：转帖 / 阅读量 / 收藏数（建议改）

- 现状：服务器没有转帖、阅读量接口；收藏（`/api/me/saved`）只有“我自己收藏了没有”，没有总数。
- r7 前端：
  - 转帖：发一条带原帖链接的新帖子（“🔁 转帖 @作者：摘要 + 链接”），现在的服务器就能用；本机记住转过哪条，转帖数 = 服务器 `repostCount`（如果有）+ 自己转过算 1。
  - 阅读量：卡片露出一半以上并停留 0.8 秒，本机记一次；显示服务器 `viewCount`（如果有），否则只显示本机有没有看过（0/1）。
  - 收藏：沿用现有 `/api/me/saved`（kind=post），数字显示服务器 `bookmarkCount`（如果有），否则只算自己。
  - 帖子链接：`<postLinkBase>/#/post/<id>`，`postLinkBase` 在 `src/09_config.js`，默认 `http://47.239.0.90`（有域名后只改这一处；也可用 `window.NOVA_POST_LINK_BASE` 覆盖）。打开带 `#/post/<id>` 的地址会直接进帖子详情（用现有 `GET /api/posts/:id`）。
- 需要服务端：
  - `POST /api/posts/:id/view`（同一用户/设备去重，例如每人每帖 24 小时算一次），`pub()` 里返回 `viewCount`。
  - 转帖：`posts.repost_of` 字段或 `post_reposts(post_id,user_id)` 表，`POST /api/posts/:id/repost`、`POST /api/posts/:id/unrepost`，`pub()` 返回 `repostCount`、`myRepost`。
  - `pub()` 返回 `bookmarkCount`（`saved_items` 里 kind=post、target=id 的数量）和 `myBookmark`。
  - 网页版要能打开 `/#/post/<id>`（需要确定对外的网页域名；现在 App 里复制出来的是 `nova://post/<id>`，App 还没注册这个链接协议，需要原生端配置 URL scheme，这一步要发版，热更新做不了）。

## 4. 不需要服务端的项

防缩放、建群面板、小组页文案和按钮、小组三栏、心情、位置、标记好友、关注数位置、去掉“活动”、小游戏行、帖子媒体排版（第 6 项）、首页顶部收起（第 8 项）、回到顶部（第 9 项），这些都是纯前端改动。

## 6. 位置用手机定位（r7 增量）

- 前端：位置面板顶部加“📍 使用当前位置”，点了才申请权限。有 Capacitor Geolocation 插件就用插件，没有就用 `navigator.geolocation`。
  - 拿到坐标后：如果配置了 `src/09_config.js` 里的 `reverseGeocodeUrl`，就换成地名；没配置就填坐标（保留 3 位小数，约 100 米），用户可以改成地名再确定。
  - 没权限、超时或失败时给出提示，仍然可以选最近用过的位置或手动输入。
  - 帖子里存的仍然是文字（`posts.location`），不存坐标。
- **需要原生发版**（热更新做不了）：现在的壳没有申请定位权限。
  - iOS：`ios/App/App/Info.plist` 加 `NSLocationWhenInUseUsageDescription`（例如“发帖时添加你所在的位置”）。没有这个键，WKWebView 里的定位会直接失败，前端会提示改为手动输入。
  - Android：`AndroidManifest.xml` 加 `ACCESS_COARSE_LOCATION`（需要精确定位再加 `ACCESS_FINE_LOCATION`）。Capacitor 的 WebChromeClient 会在网页请求定位时弹出系统权限框；清单里没有声明就拿不到。
  - 这两处要加在 build 分支的 `scripts/build-unsigned-ipa.sh`、`scripts/build-debug-apk.sh` 里（`cap add` 之后修改 plist 和 manifest），不在本分支。可选：安装 `@capacitor/geolocation` 插件（同样需要发版），前端已经兼容。
- 地名（可选，服务器）：建议加 `GET /api/geo/reverse?lat=&lng=`（需要登录，服务器端调用高德、天地图等需要 key 的接口并缓存，返回 `{name:"上海市 黄浦区"}`），然后把 `reverseGeocodeUrl` 设为 `/api/geo/reverse`。浏览器端直接调第三方免 key 接口（如 OSM Nominatim）有使用条款和国内访问的问题，没有采用。
