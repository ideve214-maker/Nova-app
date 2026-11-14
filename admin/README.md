# NOVA 管理端（v7 · 星澜 Xinglan · 对接后端 0.7.0-m6.1）

这是 NOVA 社区的**管理端**网页 / Capacitor App。它连到用户端的同一套后端，用真实管理员账号和真实数据。

**管理员登录**（`POST /api/admin/auth/login`）：

- 账号与密码由运营在服务器上创建，没有内置默认口令：
  `node server/admin-cli.mjs create --username 名称 --password '强密码'`
  密码须 8–128 位且同时包含字母和数字。
- 登录成功后得到 `na_` 前缀令牌，之后所有管理请求带 `Authorization: Bearer na_…`。
- 令牌保存在本机（默认「记住登录」）；接口返回 401 会回到登录页。
- 没有二次验证，也没有「本机口令」兜底。连续登录失败会被服务器锁定（约 5 次后锁定 15 分钟），登录页会展示服务器返回的提示和等待时间。

**数据全部来自真实后端。** 未接入或为空时显示「暂时没有数据」或「—」。连不上服务器时显示「网络不太好，请稍后再试」。公开预览若访问不到后端，也会显示同样的提示。


---

## 1. iPhone 上停在「星星壁纸」是什么原因，怎么修的

管理端原先用服务端渲染。服务器第一次画出的页面就是紫色背景中间一颗星星的启动画面（`booted === false`）。真正的登录页要等手机把 JavaScript 下载并执行完、再跑一遍 `useEffect` 才会出现。

在 iPhone 上（尤其是用「文件预览 / HTML 一览」打开单个 HTML 时）经常发生：

- `file://` 下浏览器不允许加载旁边的模块脚本和绝对路径资源（`/assets/...`），JS 根本跑不起来；
- 或者脚本较慢、出错、无痕模式读写本地存储抛错。

无论哪种，启动画面都**没有超时、没有错误提示**，所以会一直停在那颗星星上。

本次修复：

- 进入管理端**不再依赖**这次启动是否成功：客户端一启动就把 `booted` 设为 true，本地数据同步恢复；后端探测在后台进行，失败则列表保持为空。
- 启动画面最多等约 2.5 秒，超时会提示原因，并提供「进入应用」按钮。
- 页面里有一段不依赖框架的保护脚本：4 秒后若应用仍未启动，会显示中文错误和「刷新重试」。
- 首页路由关闭服务端渲染（`ssr: false`），避免把一颗永远不会消失的星星写进 HTML。
- 提供**单文件 HTML**（`dist-spa/NOVA_Admin.html`），把脚本、样式和演示图片都内嵌进去，在 iPhone 上用文件打开也能进入。
- 给较老的 Safari 补了 `color-mix`、`100dvh` 的后备样式，输入框 16px 避免聚焦时被放大。

---

## 2. 怎么打开预览、怎么构建

```bash
cd admin          # 或本项目根目录
npm ci
npm run build:spa           # 生成 dist-spa/（Capacitor webDir：index.html + assets）以及单文件 NOVA_Admin.html
npm run preview:admin       # 本地 http://127.0.0.1:4173/ ，并把 /api 反代到用户端后端
```

完整的 TanStack Start 开发 / 生产构建仍然可用：

```bash
npm run dev                 # 8080
npm run build && npm run preview   # 8081
npm run test:admin          # 适配层单测
```

`dist-spa/` 是多文件静态包（`index.html` + `assets/`，资源路径为相对路径 `./`，hash 路由 `#/users`），可作为 Capacitor 的 `webDir`，离线也能打开。同时会生成单文件 `dist-spa/NOVA_Admin.html`，方便用 Safari 打开或分享。不要用只能「看一眼」而不能跑脚本的文件预览器。

---

## 3. 和用户端后端怎么联通（适配未来版本）

当前对接用户端后端 **0.7.0-m6.1**。管理端接口包括：登录（连续失败会锁定，界面展示服务器的提示和 Retry-After）、用户、封禁、重置密码、VIP、内容（含嵌套评论）、付款（退款会返回 `vipRevoked`）、公告（编辑 / 撤回）、社区、频道消息、屏蔽词、安全事件、申诉处理、审计（含 IP）、统计、举报。`GET /api/version` 与 `/api/health` 会返回 `version` 和 `commit`，在「我的」和系统设置中显示。路径仍集中在 `DEFAULT_ENDPOINT_MAP`，设置页可用 JSON 覆盖，主路径 404 时试别名。

### 使用步骤

1. 在用户端项目里启动后端：`npm run server`（默认 `http://0.0.0.0:8787`）。
2. 打开管理端登录页或「系统设置 → 服务器配置」，填写接口根地址，例如 `http://192.168.1.8:8787`。
   - 若管理端是通过本仓库的 `preview:admin` 打开的，**可以留空**：预览服务会把 `/api` 反代到本机 8787，手机只需打开一个网址。
   - 在 `file://` 打开单文件 HTML 时必须填写一个手机能访问的地址（电脑局域网 IP，或已经做了端口转发 / 隧道的公网地址）。
3. 点「检测并连接」。

### 适配层会做什么

代码在 `src/lib/admin/backend.ts`：

| 能力 | 说明 |
|---|---|
| 可配置根地址 | 优先级：设置页保存到 localStorage（`nova-admin-api-config-v1`）> 打包时的 `VITE_NOVA_API_BASE` > 普通网页同源。Capacitor 下没有同源后端 |
| 路径对照表 | 默认表在 `DEFAULT_ENDPOINT_MAP`；设置页「高级」可用 JSON 覆盖，例如 `{"adminUsers":"/api/v2/admin/users"}` |
| 路径别名 | 主路径 404 时自动试一组常见备用路径 |
| 版本检测 | 读 `X-Nova-Version` / `X-Api-Version` 响应头，或 JSON 里的 `version` / `apiVersion` 等；当前 M2.6 的 `/api/health` 只有 `{status,time}`，版本会显示「未声明版本号」 |
| 字段容错 | 用户对象兼容 `id`/`user_id`、`username`/`displayName`、`vipUntil`/`vip_until` 等；多出来的未知字段直接忽略，不会把页面打挂 |
| 列表包装 | 兼容直接数组，以及 `{users}`、`{data:{items}}` 等常见包法 |
| 空状态 | 超时、网络错误、404 都不会卡住启动；空列表显示「暂时没有数据」，连不上显示「网络不太好，请稍后再试」。没有演示模式，也不会填入占位数字。时间一律按 UTC 解析，用设备本地时区显示。 |
| VIP 目录 | 当前后端已有 `GET /api/vip/catalog`，连通后会读取并尽量对到管理端的权益开关 |

已对接的管理接口见第 5 节。路径对不上时，在「设置服务器 → 高级」用 JSON 覆盖即可，不必再改一版前端。

**不要把管理员密钥写进前端源码。** 管理员用 `admin-cli` 在服务器上创建。

请求头：`Authorization: Bearer na_…`。错误体按 `{error:{code,message}}` 解析，也兼容其他常见形状。

### CORS 与 Capacitor

后端默认 `NOVA_CORS_ORIGIN=*`，允许任意来源（包括 `capacitor://localhost`、`http://localhost`、预览页来源）。管理端请求用 `credentials: "omit"`，只靠 Authorization 头，和 `*` 兼容。

若生产把 `NOVA_CORS_ORIGIN` 设成逗号分隔白名单，必须**精确包含**管理端的 Origin，否则浏览器会拦请求。建议同时加上：

- 管理端网页的 https 域名
- `capacitor://localhost`（iOS Capacitor WebView）
- `http://localhost`（Android Capacitor WebView）

匹配是精确字符串，没有通配。白名单未命中时，响应里不会带 `Access-Control-Allow-Origin`。

---

## 4. 目录说明

```
src/components/admin/   管理端界面（登录、首页、用户、内容、付款审核、系统设置等）
src/lib/admin/store.ts  状态与真实接口调用
src/lib/admin/backend.ts 后端适配层（路径对照、别名、字段容错）
src/lib/admin/remote.ts  对 0.7.0-m5.1 各接口的实际请求
src/spa-main.tsx        单文件 / 静态预览的入口（不走服务端渲染）
spa.html                带启动保护的静态壳
scripts/preview-server.mjs  预览服务（静态页 + /api 反代）
dist-spa/                   Capacitor webDir：index.html + assets/（相对路径）
dist-spa/NOVA_Admin.html    构建后的单文件（额外产物）
capacitor.config.ts         Capacitor 占位配置（appId com.nova.admin，未安装 iOS 平台）
resources/                   星澜 App 图标 1024 与深/浅启动屏，供 @capacitor/assets
.env.production            生产默认后端 http://47.239.0.90（已提交，无密钥）
.env.production.example     同上说明与混合内容注意事项
```

环境变量（预览服务）：

- `PORT` 默认 4173
- `HOST` 默认 `0.0.0.0`
- `NOVA_API` 默认 `http://127.0.0.1:8787`


## 5. 数据从哪来（0.7.0-m6.1）

管理端对接用户端后端 **0.7.0-m6.1**（副本在 `nova-v7-m61/`，**不要改** `/workspace/nova/src/NOVA_V7` 或 Bob 的用户端仓库）。所有下表数据都是真实接口，没有虚构数字。时间字段优先用 `createdAtUtc`（ISO UTC），在设备本地时区显示。

| 数据 | 接口 |
|---|---|
| 管理员登录 / 退出 / 当前管理员 | `POST /api/admin/auth/login`、`POST /api/admin/auth/logout`、`GET /api/admin/me` |
| 用户列表与详情 | `GET /api/admin/users`、`GET /api/admin/users/:id` |
| 封禁 / 解封 | `POST /api/admin/users/:id/ban`、`/unban`（可选 `reason`） |
| 重置用户密码 | `POST /api/admin/users/:id/reset-password`，返回 `temporaryPassword`（不是 `tempCode`），并设 `mustChangePw` |
| 开通 / 撤销 VIP | `POST /api/admin/vip/grant` `{userId, days, reason}`（原因必填）；`POST /api/admin/vip/revoke` `{userId, reason}` |
| 内容审核 | `GET /api/admin/content?type=post\|comment&status=all\|visible\|removed`；详情 `GET /api/admin/content/:type/:id`（评论含 `parentId`、`rootId`、`depth`、`replyTo`、`replyCount`、`createdAtUtc`）；`POST …/delete`、`/restore` |
| 付款审核 | `GET /api/admin/payments`、`GET /api/admin/payments/:id`；截图 `GET`/`HEAD /api/admin/payments/:id/receipt`（需鉴权，前端用 blob 显示）；`POST …/confirm`、`POST …/reject`（原因必填）、`POST …/refund`（响应含 `vipRevoked`） |
| 统计 | `GET /api/admin/stats`（当前汇总；后端不提供按日趋势，页面不画虚构折线） |
| 审计日志 | `GET /api/admin/audit`（每条含 `ip`） |
| 公告 | `GET/POST /api/admin/announcements`；`PATCH /api/admin/announcements/:id` 或 `POST …/:id/edit`；`POST …/:id/withdraw`（`published=false`）；`POST …/:id/delete` |
| 社区 | `GET /api/admin/communities`、`GET /api/admin/communities/:id`（真实 `memberCount`、成员、频道及消息数）；`GET /api/admin/channels/:id/messages` |
| 屏蔽词 | `GET/POST /api/admin/blockwords`（平台规则）；`POST /api/admin/blockwords/:id/delete` |
| 举报 | `GET /api/admin/reports`；`POST /api/admin/reports/:id/decision` `{action: resolve\|reject\|review, note}` |
| 安全事件 | `GET /api/admin/security/events`（限流 / 异常，支持 `kind`、`cursor`） |
| 申诉处理 | `GET /api/admin/appeals`、`GET /api/admin/appeals/:id`；`POST /api/admin/appeals/:id/decision` `{action: accept\|reject, note}`（通过封禁申诉时后端会解封该用户） |
| 健康检查、版本、VIP 目录 | `GET /api/health`、`GET /api/version`（含 `version`、`commit`）、`GET /api/vip/catalog`（公开） |

付款说明：用户扫个人微信 / 支付宝收款码，转账备注订单码（NV + 6 位）。价格每月 ¥9.9（30 天）、每年 ¥99（365 天）。确认开通前用户须先点「我已付款」（否则 409 `NOT_CLAIMED`）。

**退款与 VIP：** m6.1 的 `POST /api/admin/payments/:id/refund` 会撤销该订单开通的 VIP，响应 `vipRevoked: true`（重复退款也是 true，幂等）。管理端只在 `vipRevoked` 为 false 时提示去用户详情手动撤销。

管理员不能在管理端直接创建用户（无此接口），请用户在用户端自行注册。编辑用户资料、发帖/评论开关、站内通知尚无管理接口，页面显示「暂时没有数据」，不会假装已写入服务器。

公开托管的预览（如 Tiiny）**不能**访问开发机上的 8787 端口，会显示「网络不太好，请稍后再试」。本地用 `npm run preview:admin` 时，`/api` 会反代到 8787。

## 6. iPhone 布局（v2）

按 iPhone 逻辑分辨率设计（390×844、393×852，并兼顾 375×667 SE）：

- 正文约 15–17px，标题 17–22px，输入框 16px（避免 iOS 聚焦放大）
- 卡片圆角 12px，更紧的内边距，按钮与行高约 44px
- 登录页缩小星星和标题，去掉过大的顶部留白
- `viewport-fit=cover`，使用 `env(safe-area-inset-*)`
- 底栏按 iOS 约 49px + Home Indicator
- 禁止横向溢出
- 星澜（Xinglan）主题：夜空底 + 长春花靛紫 `#6E8BFF`，深色为默认，浅色跟随系统或在「我的 → 外观」切换

## 7. Capacitor / TestFlight 打包说明

管理端 SPA **不依赖 SSR**：入口是 `src/spa-main.tsx`，`npm run build:spa` 产出纯静态文件。

```bash
# 可选：先填写生产后端，再构建（域名未定时可先留空，用户在 App 里「设置服务器」填写）
cp .env.production.example .env.production
# 编辑 .env.production：
#   VITE_NOVA_API_BASE=https://api.example.com
npm run build:spa
# 得到：
#   dist-spa/index.html      ← Capacitor 打开的页面（相对路径引用 ./assets/*）
#   dist-spa/assets/         ← JS / CSS
#   dist-spa/NOVA_Admin.html ← 单文件版，不是 webDir 的入口
```

`capacitor.config.ts` 已写好占位：`appId: "com.nova.admin"`，`webDir: "dist-spa"`，iOS `contentInset: "never"`（刘海和 Home Indicator 由页面的 `viewport-fit=cover` 与 `env(safe-area-inset-*)` 处理）。**本仓库没有执行 `npx cap add ios`，也不包含 ios/ 工程**；以后在本机包装时再安装 Capacitor 与 iOS 平台，把 `dist-spa` 指过去即可。

外观是「星澜 Xinglan」：令牌在 `src/theme/tokens.css`（许可见同目录 `LICENSES.md`），深色默认，浅色由系统 `prefers-color-scheme` 或「我的」里的外观开关决定（存在 `localStorage` 键 `nova-admin-theme`）。启动画面与登录页使用星澜标志（四角新星 + 双层微澜）和「管理端」字样，不再使用旧的饱和紫渐变。

打包图标与启动屏（供以后运行 `@capacitor/assets`）放在 `resources/`：

- `resources/icon.png`：1024×1024 应用图标（另有 `icon.svg`、`icon-masked.png`）
- `resources/splash.png` / `resources/splash-dark.png`：2732×2732 启动屏（浅/深，capacitor-assets 读这两个）；`splash-light.png` 与 SVG 是源稿
- 网页用：`public/favicon.svg`、`public/apple-touch-icon.png`（180）、`public/icon-192.png`


路由使用 hash（`#/`、`#/users`、`#/user/:id`），在 `capacitor://` 或离线 WebView 里刷新不会 404。

登录状态：`na_` 令牌写在 `localStorage` 键 `nova-admin-api-config-v1` 的 `token`；会话标记在 `nova-admin-v2`。默认「记住登录」；取消勾选则关闭页面后需重新登录。401 会清令牌并回到登录页。

接口根地址优先级：

1. 用户在「设置服务器」保存的值（localStorage，可随时改）
2. 构建时的 `VITE_NOVA_API_BASE`（见 `.env.production.example`，**不要把未定的真实域名写进仓库**）
3. 普通 http(s) 网页的同源（本地 `preview:admin` 反代时有用）

在 TestFlight 的 App 里，若 1 和 2 都为空，页面会提示未连接，请用户自己填写可访问的后端地址。

## 8. 热更新（自托管，给 Dift / nginx）

管理端用 `@capgo/capacitor-updater` **7.53.0**（MPL-2.0），**自托管模式**，不使用 Capgo 云。第 2 版整包重装之后，网页资源只走热更新。

### 配置键

| 键 | 作用 |
| --- | --- |
| `VITE_NOVA_UPDATE_URL`（或 `NOVA_UPDATE_URL` / `NOVA_ADMIN_UPDATE_URL` / `ADMIN_UPDATE_URL`） | 自托管 manifest 地址，来自打包环境（GitHub secret `NOVA_ADMIN_UPDATE_URL`，build/v2 工作流里叫 `ADMIN_UPDATE_URL`）。**打包必填**：`CI=true` 或 `NOVA_REQUIRE_UPDATE_URL=1` 时缺失会让 `build:spa` 和 `cap add/sync` 直接报错；本地调试不填则热更新关闭。确需在 CI 打无热更新的包时设 `NOVA_REQUIRE_UPDATE_URL=0`。不要填 Capgo 云地址，也不要把真实地址提交进仓库。 |
| `.nova-live-update.json` | `build:spa` 解析到地址后写在 `admin/` 下（已 gitignore，含真实地址，不要提交）。打包第 2 步在另一个 shell 里跑 `cap add/sync` 时，`capacitor.config.ts` 读不到第 1 步 export 的变量，就从这个文件拿地址。没有地址时 `build:spa` 会删掉旧文件。 |
| `VITE_NOVA_UPDATE_VERSION`（或 `NOVA_UPDATE_VERSION`） | 可选。写入 `plugins.CapacitorUpdater.version`（semver）。**不填则用 `package.json` 的 `version`（当前 1.1.0）**，与打包脚本写入的 iOS `MARKETING_VERSION`（`CFBundleShortVersionString`）一致。 |
| `VITE_NOVA_UPDATE_AUTO`（或 `NOVA_UPDATE_AUTO`） | 可选。有 URL 时默认开启（`atBackground`：前台检查、下载，下次进后台再切换）。设为 `off` / `0` / `false` 可只记下地址、不自动检查。 |
| `capacitor.config.ts` → `plugins.CapacitorUpdater` | 原生侧生效（`npx cap sync ios` 时读入）。`updateUrl` / `autoUpdate` 由上面的环境变量填充；`statsUrl` 与 `channelUrl` 固定为空，关闭向 Capgo 的统计与频道请求；`appReadyTimeout` 为 10000 ms；`allowModifyUrl` 为 true，便于后续网页包覆盖地址。 |

启动时（仅原生）会尽早调用 `notifyAppReady()`。若一次热更新加载后 10 秒内没能跑到这句，插件会**自动回滚**到上一版可用包（失败的包会按 `autoDeleteFailed` 删掉）。

`.env.production` 里请把 `VITE_NOVA_UPDATE_URL` 留空（仓库公开），地址只从打包环境注入。示例（不要把未确认的地址提交进仓库）：

```bash
# VITE_NOVA_UPDATE_URL=https://47.239.0.90/admin-updates/manifest.json
# VITE_NOVA_UPDATE_VERSION=1.0.1
```

当前服务器是明文 HTTP。插件官方建议 manifest 与 zip 走 HTTPS；Android 可能拦截明文更新地址。iOS 已有对 `47.239.0.90` 的 ATS 例外，但仍建议证书就绪后改用 https。

### Dift 需要提供的 manifest

插件每次检查时会对 `updateUrl` 发 **POST**，body 里带 `app_id`、`version_name`、`platform` 等。服务端用静态文件实现时，GET 和 POST 都要能返回同一份 JSON。真实地址由 Dift 提供，只写进打包环境的 `VITE_NOVA_UPDATE_URL`，不要提交进仓库或任何公开文档。服务端比较版本后，若需要更新，返回：

```json
{
  "version": "1.0.1",
  "url": "https://<更新服务器>/<私有路径>/updates/nova-admin-1.0.1.zip",
  "checksum": "SHA256_OF_THE_ZIP"
}
```

- `version` 必须是 semver，并且要**高于**当前已安装包的版本（`version_name`，首次为内置包或上面配置的 `VITE_NOVA_UPDATE_VERSION` / 原生版本）。
- 没有新版本时（当前服务器的做法）返回：
  ```json
  { "error": "no_new_version_available", "message": "No new version available", "kind": "up_to_date" }
  ```
  插件 7.53 看到 `error` 加 `kind: "up_to_date"` 会当成“已是最新”，不下载、不报错。静态文件不知道设备当前版本，所以不要用“返回当前版本、省略 url”的写法。
- 有新版本时清单放 `{version, url, checksum}`；`version` 和设备上的 `version_name` 相同时插件会跳过。
- 不要用 `"builtin"` 当版本号：开启自动更新时插件会把它当成回退到内置包。
- 不要依赖 `{ "status": "error" }`：插件 7.53 不把它当成“无更新”，要用上面的 `error` + `kind` 字段。
- `checksum` 为 zip 的 SHA-256（小写十六进制）。推荐用官方命令生成，格式与插件校验一致。

nginx 需要能访问到 manifest 和 zip（例如根路径 `/admin-updates/`）。zip 要允许直接下载；若网页也会请求 manifest，再补 CORS。把文件放到例如 `/var/www/admin-updates/`，并确保 POST 到 `manifest.json` 能返回上面的 JSON（可以用小脚本按请求体里的 `version_name` 决定是否带 `url`，或先返回固定 JSON 做联调）。

### 启动图（@capacitor/assets）

`npx capacitor-assets generate` 在 `admin/` 下先找 `assets/`，**只要 `assets/` 存在就只读它**，不存在才读 `resources/`（`--assetPath` 可指定）。所以本项目**只用 `resources/`，不要新建 `admin/assets/`**：否则 `resources/` 里的图标不会被读到，App 图标会变回 Capacitor 默认图。

`resources/` 里工具会读的文件：`icon.png`（1024×1024 应用图标）、`splash.png`（浅色）、`splash-dark.png`（深色）。启动图文件名必须是 `splash.png` / `splash-dark.png`，官方要求至少 2732×2732。现在两张都是 2732×2732：`splash.png` 由 `splash-light.png` 生成，`splash-dark.png` 为暗色大图。竖版原图（1170×2532）按高度等比放进正方形中间，左右用边缘颜色补齐，这样工具按正方形裁切、iOS 启动页按比例填充时，手机上看到的就是完整原图。`splash-light.png` 与 SVG 源保留不动（工具不读这两个名字）。

### 打包注意（热更新地址）

- 带地址跑过 `build:spa` 之后，`dist-spa/`（`assets/spa-*.js`、`NOVA_Admin.html`）里会带上真实更新地址。**这样的 `dist-spa/` 不要提交**；提交前用不带地址的环境重新跑一次 `npm run build:spa`。
- `build:spa` 一开始就会删掉旧的 `.nova-live-update.json`，构建成功且有地址时才重新写入。单独跑 `cap add` / `cap sync` 时，`capacitor.config.ts` 会在日志里打印一行地址来源（环境变量名或这个文件，只显示域名）。**换打包环境前先删掉 `admin/.nova-live-update.json`**，避免用到上一次的旧地址。

### 怎么从 dist-spa 打更新包

`dist-spa` 是 Capacitor 的 `webDir`，热更新 zip 也从这里打。zip **根目录必须能看到 `index.html`**（不要把 `dist-spa` 再包一层文件夹，也不要把单文件 `NOVA_Admin.html` 当入口）。

```bash
cd admin
# 需要的话先在 .env.production 填 VITE_NOVA_UPDATE_URL / VITE_NOVA_UPDATE_VERSION
npm run build:spa

# 推荐：官方 CLI，会打出兼容的 zip 并给出 checksum
npx @capgo/cli bundle zip com.nova.admin --path dist-spa --json

# 或手动打包，再算校验和：
#   cd dist-spa && zip -r ../nova-admin-1.0.1.zip index.html spa.html assets
#   shasum -a 256 ../nova-admin-1.0.1.zip
```

把 zip 和 manifest 放到 nginx 目录，把 manifest 里的 `version`、`url`、`checksum` 改成这一包的值。用户下次把 App 送到前台就会检查；下载完成后，按 `atBackground` 会在进入后台后再切换，下一次冷启动（或再回前台，视系统回收情况）加载新包。新包同样必须在启动时调用 `notifyAppReady()`，否则 10 秒后回滚。
