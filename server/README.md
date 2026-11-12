# NOVA 后端（M4.11）
启动：`npm run build` 然后 `npm run server`（默认 8787 端口、监听所有网卡，数据库文件 ./nova.db）
环境变量：`PORT`、`HOST`、`NOVA_DB`、`NOVA_CORS_ORIGIN`（未设置仍是 `*`；可写逗号分隔白名单，如 `capacitor://localhost,https://localhost,http://127.0.0.1:5173`，只回显匹配的 Origin；**若设白名单，请把管理端 App 的 Origin 加进去**）、`NOVA_ENV`（默认 production；只有严格等于 `development` 才开启 VIP 测试切换）、`NOVA_VIP_TEST_TOGGLE=0`（在开发环境里再次关闭测试切换）、`NOVA_ADMIN_USERNAME` 与 `NOVA_ADMIN_PASSWORD`（启动时若两者都提供且该用户名还不存在，则创建第一个平台管理员；没有内置默认密码）
创建管理员：`node server/admin-cli.mjs create --username 名称 --password '强密码'`（密码须 8–128 位且含字母和数字）。`node server/admin-cli.mjs list` 可查看。
本机试用测试切换：`npm run dev`（等于 `NOVA_ENV=development npm run server`）；对外给朋友用请用 `npm run server`。
测试：`npm run test:server`（账号接口） · `npm run test:ui`（浏览器走一遍注册登录） · `npm run test:web`（旧的本地 HTML 演示测试）

打开 `http://主机:端口/` 就是用户端。同一个服务提供网页和接口。

## 部署到 Capacitor（客户端与 API 不同源）

前端是单个 `dist/nova_v5.html`，可直接打进 iOS 壳（本地资产）。API 在另一域名时，请同时配置下面三项。

### 1. 客户端 API 基址 `window.NOVA_API_BASE`

空、未定义，或空字符串 = **同源**（现在的默认，浏览器测试不用改）。
所有客户端请求（`api()` 助手、`GET /api/health`、`POST /api/auth/logout`、`POST /api/media` 上传、SSE `GET /api/events`）都经 `apiUrl()` 加上这个前缀。不要在源码里再写死 `fetch('/api/...')`。

设置方式（任选，页面里先写的值优先）：

```html
<!-- 打进壳的 HTML 里、主脚本之前 -->
<script>
  window.NOVA_API_BASE = 'https://api.example.com';  // 不要末尾斜杠，有也会被去掉
</script>
```

或构建时注入：

```bash
node scripts/build.mjs --api-base=https://api.example.com
# 等价：NOVA_API_BASE=https://api.example.com node scripts/build.mjs
```

### 2. 服务端 CORS：`NOVA_CORS_ORIGIN`

- **未设置**：与原来一样，响应 `Access-Control-Allow-Origin: *`。
- **逗号分隔白名单**：例如 `NOVA_CORS_ORIGIN=capacitor://localhost,https://localhost`。请求的 `Origin` 在名单里时原样回显，不在则不回显（浏览器会拦截）。比较是精确字符串匹配（含协议和端口）。
- 预检 `OPTIONS` 返回 204，允许方法 `GET, POST, OPTIONS`，允许头 `Authorization, Content-Type, X-File-Name`（媒体上传用）、以及 `Last-Event-ID`。
- SSE（`GET /api/events`）和媒体文件/预览响应同样带上述 CORS 头。

```bash
NOVA_CORS_ORIGIN=capacitor://localhost,https://localhost npm run server
```

代码里也可 `createApp({corsOrigin: 'capacitor://localhost,https://localhost'})`。

### 3. 生产构建关闭本机演示：`window.NOVA_DISABLE_DEMO`

默认仍保留演示（`file://` 自动化测试、离线双击会进演示）。生产壳请关掉：

```html
<script>window.NOVA_DISABLE_DEMO = true;</script>
```

或 `node scripts/build.mjs --disable-demo`（`NOVA_DISABLE_DEMO=1`）。

开启后：`/api/health` 失败或超过 2 秒**不会**掉进演示数据；页面显示「无法连接服务器」和「重试」。登录页不再有「先用演示看看」，设置里也不再有「切换到演示数据」。

典型生产构建：

```bash
node scripts/build.mjs --api-base=https://api.example.com --disable-demo
NOVA_CORS_ORIGIN=capacitor://localhost,https://localhost NOVA_ENV=production npm run server
```


## 已完成接口
| 方法 路径 | 说明 |
|---|---|
| GET / | 用户端页面（需先 build） |
| POST /api/auth/register | 注册：username、email、password → 返回 user + token |
| POST /api/auth/login | 登录：account（用户名或邮箱）、password；连错5次锁15分钟 |
| POST /api/auth/logout | 退出（令牌立即失效） |
| GET /api/me | 当前用户 |
| GET /api/users/:id | 查看他人资料（按可见范围与字段开关过滤，不含邮箱；需登录） |
| POST /api/me/password | 改密码，其他设备下线 |
| GET /api/vip/catalog | 公开：套餐、价格占位、权益表、到期规则（无需登录） |
| GET /api/vip/me | 当前用户的 VIP 状态（plan/state/开始/到期/剩余天数）与每项权益取值；服务端按时间计算 |
| POST /api/vip/test-toggle | 仅 `NOVA_ENV=development`：给自己开/关测试 VIP（`{on:true/false}`）；生产 403 `TEST_MODE_DISABLED`；不改动管理员/支付开通的正式 VIP（409） |
| POST /api/vip/gate | 检查当前用户是否拥有某项权益（`{key}`）；flag 未开通/到期 403 `ENTITLEMENT_REQUIRED` |
| GET /api/me/saved | 我的个人收藏列表（含 count / limit / plan） |
| POST /api/me/saved | 收藏一条（`kind`+`target`）；超额 403 `QUOTA_EXCEEDED`；重复幂等 |
| POST /api/me/saved/remove | 取消收藏（`id` 或 `kind`+`target`）；不能删别人的 |
| POST /api/content/check | 校验发帖/发言长度（`{scope,text}`）；超长 403 `TEXT_TOO_LONG` |
| GET /api/stickers | 表情包目录（公开；登录后专属包带 usable） |
| POST /api/stickers/use | 选用一张贴纸；专属包需 VIP，否则 403 |
| GET /api/me/profile | 读取自己的资料（默认显示名=用户名） |
| POST /api/me/profile | 保存显示名、简介、性别、生日、颜色文字头像 |
| POST /api/me/avatar | 保存颜色/文字头像；图片头像返回 AVATAR_IMAGE_PENDING |
| GET /api/me/privacy | 读取隐私设置（未写过库则返回默认值） |
| POST /api/me/privacy | 保存隐私设置 |
| GET /api/me/sessions | 自己的登录设备；公开 id、脱敏 IP、设备名 |
| POST /api/me/sessions/revoke-others | 退出其他设备，当前设备保留 |
| POST /api/me/sessions/revoke | 退出指定设备（不能是当前或别人的） |
| POST /api/posts | 发帖，成功后才算发布（`requireTextLength`） |
| GET /api/posts | 动态列表（游标分页；`feed=follow` 为关注流） |
| GET /api/posts/:id | 动态详情 |
| POST /api/posts/:id/edit | 编辑自己的动态 |
| POST /api/posts/:id/delete | 删除自己的动态（软删除） |
| GET/POST /api/posts/:id/comments | 评论列表 / 发表评论或回复 |
| POST /api/comments/:id/delete | 删除自己的评论 |
| POST /api/comments/:id/like | 评论点赞切换 |
| POST /api/posts/:id/react | 动态表态（切换/取消） |
| POST /api/follows | 关注（单向、幂等） |
| POST /api/follows/remove | 取消关注 |
| GET /api/follows | 关注/粉丝列表 |
| POST /api/communities | 创建社区 |
| GET /api/communities | 发现 / 已加入列表 |
| GET /api/communities/:id | 社区详情 |
| POST /api/communities/:id/join | 加入 |
| POST /api/communities/:id/leave | 退出 |
| GET /api/communities/:id/members | 成员列表 |
| POST /api/communities/:id/role | 设置成员角色 |
| POST /api/communities/:id/kick | 移出 / 封禁成员 |
| POST /api/communities/:id/channels | 创建频道 |
| GET /api/channels/:id/messages | 频道消息 |
| POST /api/channels/:id/messages | 频道发言 |
| POST /api/channels/:id/rename | 频道改名 |
| POST /api/channels/:id/delete | 删除频道 |
| POST /api/communities/:id/invites | 生成邀请码 |
| GET /api/communities/:id/invites | 邀请列表 |
| POST /api/communities/:id/invites/revoke | 撤销邀请 |
| POST /api/communities/join-code | 用邀请码加入 |
| POST /api/conversations | 创建单聊或群聊 |
| GET /api/conversations | 我的会话列表 |
| GET /api/conversations/:id | 会话详情（非成员 404） |
| POST /api/conversations/:id/members | 群聊添加成员 |
| POST /api/conversations/:id/role | 设置角色 / 转让群主 |
| POST /api/conversations/:id/kick | 移出成员 |
| POST /api/conversations/:id/leave | 退出（群主须转让） |
| POST /api/conversations/:id/rename | 群聊改名 |
| POST /api/conversations/:id/messages | 发送消息（入库后才成功） |
| GET /api/conversations/:id/messages | 历史（cursor 更早，after 更新） |
| （私聊门槛） | 非好友 403 `NOT_FRIENDS`；拉黑 403 `BLOCKED` |
| GET /api/friends | 双向好友列表 |
| GET /api/friends/requests | 待处理的来向/去向申请 |
| GET /api/friends/status | `?userId=` 与某人的关系 |
| POST /api/friends/request | 发起申请（幂等） |
| POST /api/friends/accept | 同意申请 |
| POST /api/friends/decline | 拒绝申请 |
| POST /api/friends/cancel | 取消自己发出的申请 |
| POST /api/friends/remove | 删除好友（见 M4.10.2） |
| GET /api/events | SSE 推送（Authorization 头；禁止 token 放 URL） |
| POST /api/conversations/:id/read | 上报已读游标 |
| POST /api/messages/:id/recall | 撤回消息（2 分钟内，仅作者） |
| POST /api/messages/:id/pin | 置顶（public / personal） |
| POST /api/messages/:id/unpin | 取消置顶 |
| POST /api/conversations/:id/pin | 会话个人置顶 |
| POST /api/conversations/:id/mute | 静音（仅自己，不影响存储） |
| POST /api/media | 上传媒体（本地存储，与消息分离） |
| GET /api/media/:id | 媒体元数据 |
| GET /api/media/usage | 存储额度 |
| GET /api/media/:id/file | 鉴权下载（Authorization 或短期 ticket） |
| GET /api/media/:id/preview | 预览图 |
| GET /api/notifications | 通知列表 |
| POST /api/notifications/:id/read | 单条已读 |
| POST /api/notifications/read-all | 全部已读 |
| GET /api/notifications/unread | 未读数 |
| GET /api/search | 搜索用户/帖子/社区/消息（受权限约束） |
| POST `/api/admin/auth/login` | 管理员登录（`username` 或 `account` + `password`），返回 `token`（`na_` 前缀）与 `admin` |
| GET `/api/admin/me` | 当前管理员（需管理员 Bearer） |
| POST `/api/admin/auth/logout` | 注销当前管理员令牌 |
| POST `/api/reports` | 用户提交举报（需用户登录）；私聊须勾选 `messageIds` |
| GET `/api/admin/reports` | 举报队列（`status`、`targetType`、`cursor`） |
| GET `/api/admin/reports/:id` | 详情；私聊只返回勾选消息；访问写审计 |
| POST `/api/admin/reports/:id/decision` | `action=resolve\|reject`，通知双方 |
| GET `/api/admin/audit` | 审计日志（需管理员） |
| GET /api/health | 健康检查 |

请求头：`Authorization: Bearer <token>`。错误统一：`{error:{code,message}}`。

## 安全说明
- 密码：scrypt 加盐哈希，不可还原（管理员也看不到，只能重置）。令牌：库中只存 SHA-256。浏览器只把令牌放在 localStorage，用来刷新后保持登录。
- 账号不存在与密码错误返回同样提示，且都做一次哈希，防账号探测。
- 演示内容不入库。每个账号的本机演示副本用不同的 localStorage 键。
- 尚未做（见总项目表）：管理员体系 M3.1、IP 级限流与安全响应头加固 M6.1、HTTPS（由部署层提供）、私聊端到端加密 M4.11。

## VIP（M2.4.2）
- 是否 VIP 只看 `users.vip_until` 与服务器当前时间；客户端传来的任何字段（body、头部、查询参数）都不参与。到期自动回落 Basic，无需任何操作。
- `state`：`none` 未开通 · `active` 有效 · `expiring` 有效但 3 天内到期 · `expired` 已过期 · `revoked` 已被撤销。
- 权益与额度的唯一配置在 `server/vip-config.mjs`；`docs/spec/09_VIP权益与额度.md` 由它生成。
- 迁移 `002_vip.sql` 增加 `vip_since`、`vip_source`、`vip_events`。

## 香槟金主题（M2.4.5，前端）
- 页面根元素 `data-vip=gold` 即启用；由前端按 `/api/vip/me` 的 `vip.active` 和 `entitlements.profile_theme_gold.enabled` 设置，到期后服务端不再返回有效状态，主题随之回落。
- 本机偏好 `D.st.vt===0` 只能关闭金色，不能开启。配色变量在 `src/00_head.html` 顶部（`--ac`、`--onac`、`--vip`、`--ln`）。

## 权益检查（M2.5.1）
- 所有 VIP 专属接口必须调用 `vip.requireEntitlement`（或 `requireQuota` / `requireTextLength`），只靠前端隐藏按钮不算鉴权。
- 错误：`ENTITLEMENT_REQUIRED`（403，需升级）、`QUOTA_EXCEEDED`（403，超额）、`TEXT_TOO_LONG`（403，超长）。到期由服务端按时间自动回落，无需额外操作。

## 资料装饰（M2.5.2，前端）
- 头像金边、主页装饰只看 `entitlements.profile_decoration.enabled`；VIP 标识只看 `entitlements.vip_badge.enabled`。到期后服务端不再返回有效状态，下一次渲染立即回落。
- 「别人看到你的标识」要等 M4 把他人资料接到服务器。

## 个人收藏（M2.5.3）
- 只扩展私人收藏额度，与群聊/社区公共置顶完全分开。公共置顶仍最多 5 条，且按角色授权。
- 到期后内容保留；若已超过 Basic 的 20 条，需先取消收藏才能再新增。

## 发帖长度（M2.5.4）
- 上限来自权益配置，由 `requireTextLength` 在服务端执行；前端提示数字必须与之相同。
- 计字方式：Unicode 码点（`[...s].length`），一个 emoji 算 1 字。

## 专属表情包（M2.5.5）
- 只用原创 Unicode 白名单，经内容审核范围管理；不引入第三方版权贴纸。
- 免费用户能看到专属包、能用常用表情、能看见别人发出的专属贴纸；不能从面板选用专属包。

## 个人资料（M2.6.1–M2.6.2）
- `GET/POST /api/me/profile`、`POST /api/me/avatar`。资料和颜色/文字头像写在 `profiles` 表，重登仍在。图片头像返回 `AVATAR_IMAGE_PENDING`，等 M4.5。
- 显示名 1–20 字，简介最多 80 字，头像文字恰好 1 个字，颜色为 8 种固定色之一。接口只操作调用者自己。

## 隐私设置（M2.6.3）
- `GET/POST /api/me/privacy`。未写过库时返回默认值：`everyone` / `everyone` / 生日、年龄、性别公开 / 可被搜索。非法枚举 400。

## 登录设备（M2.6.4–M2.6.5）
- `GET /api/me/sessions` 只返回自己的会话：公开 id（`ss_…`）、脱敏 IP、设备名、是否当前设备。不含令牌、哈希、原始 IP 或 UA。
- `POST /api/me/sessions/revoke-others` 使其他令牌立即失效，当前设备保留。`POST /api/me/sessions/revoke` 退出指定设备，不能退出当前设备或别人的设备。改密也会踢掉其他设备。

## 动态（M4.1.1）
- 帖子写在 `posts` 表。发布是否成功以服务端响应为准，前端不能先本地插入再假装成功。
- 登录后的动态流来自服务器；`file://` 和演示模式仍用本机数据。
