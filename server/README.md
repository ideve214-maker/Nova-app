# NOVA 后端（M2.4.6）
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
