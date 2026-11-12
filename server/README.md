# NOVA 后端（M2.6.2）
启动：`npm run build` 然后 `npm run server`（默认 8787 端口、监听所有网卡，数据库文件 ./nova.db）
环境变量：`PORT`、`HOST`、`NOVA_DB`、`NOVA_CORS_ORIGIN`、`NOVA_ENV`（默认 production；只有严格等于 `development` 才开启 VIP 测试切换）、`NOVA_VIP_TEST_TOGGLE=0`（在开发环境里再次关闭测试切换）
本机试用测试切换：`npm run dev`（等于 `NOVA_ENV=development npm run server`）；对外给朋友用请用 `npm run server`。
测试：`npm run test:server`（账号接口） · `npm run test:ui`（浏览器走一遍注册登录） · `npm run test:web`（旧的本地 HTML 演示测试）

打开 `http://主机:端口/` 就是用户端。同一个服务提供网页和接口。

## 已完成接口
| 方法 路径 | 说明 |
|---|---|
| GET / | 用户端页面（需先 build） |
| POST /api/auth/register | 注册：username、email、password → 返回 user + token |
| POST /api/auth/login | 登录：account（用户名或邮箱）、password；连错5次锁15分钟 |
| POST /api/auth/logout | 退出（令牌立即失效） |
| GET /api/me | 当前用户 |
| POST /api/me/password | 改密码，其他设备下线 |
| GET /api/me/sessions | 登录设备列表 |
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
