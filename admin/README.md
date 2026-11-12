# NOVA 管理端（已修复 iPhone 进不去的问题）

这是 NOVA 社区的**管理端**网页。它可以独立运行，也可以连到用户端的同一套后端。

**本机操作员登录**（后端 M2.6 尚无管理端鉴权接口，例如 `/api/admin/auth`）：

- 账号：`admin`
- 密码：`nova1234`（只存在本机 localStorage，不是服务器账号；可在「我的」里修改）
- 已取消二次验证码

**数据默认全部来自真实后端。** 演示模式默认关闭，需在「我的」里手动打开，打开后各页会标明「演示模式」。未接入的接口显示「接口待接入」或「—」，不会填入虚构数字。公开预览无法访问本机后端，也会如实显示未连接。

连上本机预览服务后，会读取 `GET /api/health` 和真实的 `GET /api/vip/catalog`。用户列表、统计、举报等管理接口属于规划中的 M3，当前没有则保持为空。


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

管理端和用户端计划共用同一套后端，但**当前用户端后端（0.7.0-m4.7）还没有管理端专用接口**（用户列表、封禁、管理员登录等属于规划里的 M3，尚未实现）。所以联通策略是「能连就用真实数据，连不上或接口还没有就显示空 / 接口待接入，绝不默认填虚构数字」，并且把路径集中配置，方便以后换更新的压缩包。演示模式必须手动打开。

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
| 版本检测 | 读 `X-Nova-Version` / `X-Api-Version` 响应头，或 JSON 里的 `version` / `apiVersion` 等；当前 M2.6 的 `/api/health` 只有 `{status,time}`，会显示「健康检查正常，未声明版本号」 |
| 字段容错 | 用户对象兼容 `id`/`user_id`、`username`/`displayName`、`vipUntil`/`vip_until` 等；多出来的未知字段直接忽略，不会把页面打挂 |
| 列表包装 | 兼容直接数组，以及 `{users}`、`{data:{items}}` 等常见包法 |
| 空状态 | 超时、网络错误、404 都不会卡住启动；页面标明「未连接后端」或「后端已通 · 管理接口待接入」，列表为空。只有手动打开演示模式才出现「演示模式」徽章和虚构数据 |
| VIP 目录 | 当前后端已有 `GET /api/vip/catalog`，连通后会读取并尽量对到管理端的权益开关 |

当前 0.7.0-m4.7 已能用上的公开接口：`GET /api/health`、`GET /api/vip/catalog`、`GET /api/stickers`。动态、社区、通知、搜索等需要用户登录令牌，管理端不会代为登录。如有用户令牌时还可读 `/api/me`、`/api/vip/me`。  
一旦未来的用户端后端提供例如 `GET /api/admin/users`、`POST /api/admin/vip/grant`，只要路径能对上（或在对照表里改一下），管理端会自动改用服务器数据，不必再改一版前端。

**不要把管理员密钥写进前端源码。** 密钥只放后端环境变量。支付不会在管理端接入。

请求头：`Authorization: Bearer <token>`（若已配置）。错误体按 `{error:{code,message}}` 解析，也兼容其他常见形状。

---

## 4. 目录说明

```
src/components/admin/   管理端界面（登录、首页、用户、内容、系统设置等）
src/lib/admin/store.ts  本机状态；默认空列表；演示数据仅在手动打开演示模式时加载
src/lib/admin/backend.ts 后端适配层
src/spa-main.tsx        单文件 / 静态预览的入口（不走服务端渲染）
spa.html                带启动保护的静态壳
scripts/preview-server.mjs  预览服务（静态页 + /api 反代）
dist-spa/                   Capacitor webDir：index.html + assets/（相对路径）
dist-spa/NOVA_Admin.html    构建后的单文件（额外产物）
capacitor.config.ts         Capacitor 占位配置（appId com.nova.admin，未安装 iOS 平台）
.env.production.example     打包默认后端地址的示例（生产域名未定）
```

环境变量（预览服务）：

- `PORT` 默认 4173
- `HOST` 默认 `0.0.0.0`
- `NOVA_API` 默认 `http://127.0.0.1:8787`


## 5. 数据从哪来、还缺哪些接口

管理端默认对接用户端后端 **0.7.0-m4.7**（副本在仓库旁的 `nova-v7/`，不要改 `/workspace/nova`）。演示模式默认关闭。启动时**不会写入任何虚构用户或帖子**。

| 数据 | 来源 |
|---|---|
| 连接状态、健康检查 | `GET /api/health`（公开，真实） |
| VIP 套餐与权益目录 | `GET /api/vip/catalog`（公开，真实） |
| 表情包目录 | `GET /api/stickers`（公开，真实） |
| 动态 / 评论 | `GET /api/posts` 等已存在，但**必须用户登录**；管理端没有管理员令牌，不会代拉，页面标明「需要用户登录 · 管理入口待接入」 |
| 社区、通知、搜索、私聊 | 同上，均为需登录的用户接口，尚无管理只读入口 |
| 用户列表、封禁、重置密码 | 无 `GET /api/admin/users`（404）→「接口待接入」 |
| 管理统计与趋势 | 无 `GET /api/admin/stats` → 显示「—」 |
| 举报、公告、管理审计 | 尚无对应管理接口 |
| 管理员登录 | 无 `/api/admin/auth`；使用本机口令 `admin` / `nova1234`（只存在本机，不是服务器账号） |

当前预览库 `/tmp/nova-admin-m47.db` 是空库（0 用户、0 帖子），未 seed。若以后提供管理用户列表，会自动拉取真实数据。

公开托管的预览（如 Tiiny）**不能**访问开发机上的 8787 端口，因此会显示「未连接后端」和空列表，这是诚实状态，不是演示数据。本地用 `npm run preview:admin` 时，`/api` 会反代到 8787，VIP 目录和表情包即可显示真实内容。

## 6. iPhone 布局（v2）

按 iPhone 逻辑分辨率设计（390×844、393×852，并兼顾 375×667 SE）：

- 正文约 15–17px，标题 17–22px，输入框 16px（避免 iOS 聚焦放大）
- 卡片圆角 12px，更紧的内边距，按钮与行高约 44px
- 登录页缩小星星和标题，去掉过大的顶部留白
- `viewport-fit=cover`，使用 `env(safe-area-inset-*)`
- 底栏按 iOS 约 49px + Home Indicator
- 禁止横向溢出
- 保留紫色 / 星星品牌

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

路由使用 hash（`#/`、`#/users`、`#/user/:id`），在 `capacitor://` 或离线 WebView 里刷新不会 404。

登录状态写在本机 `localStorage`（键 `nova-admin-v2` 的 `authed`）。默认「记住登录」；取消勾选则只在本次会话有效。这是本机操作员口令，不是服务器账号。

接口根地址优先级：

1. 用户在「设置服务器」保存的值（localStorage，可随时改）
2. 构建时的 `VITE_NOVA_API_BASE`（见 `.env.production.example`，**不要把未定的真实域名写进仓库**）
3. 普通 http(s) 网页的同源（本地 `preview:admin` 反代时有用）

在 TestFlight 的 App 里，若 1 和 2 都为空，页面会提示未连接，请用户自己填写可访问的后端地址。
