# NOVA 管理端（已修复 iPhone 进不去的问题）

这是 NOVA 社区的**管理端**网页。它可以独立运行，也可以连到用户端的同一套后端。

演示账号：`admin`  
演示密码：`nova1234`  
二次验证码：`246810`  
（当前用户端后端还没有管理端登录接口，所以登录仍走本机演示；连上后端后会读取健康检查和 VIP 目录。）

---

## 1. iPhone 上停在「星星壁纸」是什么原因，怎么修的

管理端原先用服务端渲染。服务器第一次画出的页面就是紫色背景中间一颗星星的启动画面（`booted === false`）。真正的登录页要等手机把 JavaScript 下载并执行完、再跑一遍 `useEffect` 才会出现。

在 iPhone 上（尤其是用「文件预览 / HTML 一览」打开单个 HTML 时）经常发生：

- `file://` 下浏览器不允许加载旁边的模块脚本和绝对路径资源（`/assets/...`），JS 根本跑不起来；
- 或者脚本较慢、出错、无痕模式读写本地存储抛错。

无论哪种，启动画面都**没有超时、没有错误提示**，所以会一直停在那颗星星上。

本次修复：

- 进入管理端**不再依赖**这次启动是否成功：客户端一启动就把 `booted` 设为 true，本地数据同步恢复；后端探测在后台进行，失败就用演示数据。
- 启动画面最多等约 2.5 秒，超时会提示原因，并提供「进入演示」按钮。
- 页面里有一段不依赖框架的保护脚本：4 秒后若应用仍未启动，会显示中文错误和「刷新重试」。
- 首页路由关闭服务端渲染（`ssr: false`），避免把一颗永远不会消失的星星写进 HTML。
- 提供**单文件 HTML**（`dist-spa/NOVA_Admin.html`），把脚本、样式和演示图片都内嵌进去，在 iPhone 上用文件打开也能进入。
- 给较老的 Safari 补了 `color-mix`、`100dvh` 的后备样式，输入框 16px 避免聚焦时被放大。

---

## 2. 怎么打开预览、怎么构建

```bash
cd admin          # 或本项目根目录
npm ci
npm run build:spa           # 生成 dist-spa/NOVA_Admin.html（给 iPhone 用的单文件）
npm run preview:admin       # 本地 http://127.0.0.1:4173/ ，并把 /api 反代到用户端后端
```

完整的 TanStack Start 开发 / 生产构建仍然可用：

```bash
npm run dev                 # 8080
npm run build && npm run preview   # 8081
npm run test:admin          # 适配层单测
```

把 `dist-spa/NOVA_Admin.html` 发到手机后，用 Safari 打开即可。不要用只能「看一眼」而不能跑脚本的文件预览器。

---

## 3. 和用户端后端怎么联通（适配未来版本）

管理端和用户端计划共用同一套后端，但**当前这份用户端压缩包（约 M2.6）还没有管理端专用接口**（用户列表、封禁、管理员登录等属于规划里的 M3，尚未实现）。所以联通策略是「能连就用，连不上或接口还没有就演示」，并且把路径集中配置，方便以后换更新的压缩包。

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
| 可配置根地址 | 存在浏览器 localStorage（`nova-admin-api-config-v1`），设置页可改 |
| 路径对照表 | 默认表在 `DEFAULT_ENDPOINT_MAP`；设置页「高级」可用 JSON 覆盖，例如 `{"adminUsers":"/api/v2/admin/users"}` |
| 路径别名 | 主路径 404 时自动试一组常见备用路径 |
| 版本检测 | 读 `X-Nova-Version` / `X-Api-Version` 响应头，或 JSON 里的 `version` / `apiVersion` 等；当前 M2.6 的 `/api/health` 只有 `{status,time}`，会显示「健康检查正常，未声明版本号」 |
| 字段容错 | 用户对象兼容 `id`/`user_id`、`username`/`displayName`、`vipUntil`/`vip_until` 等；多出来的未知字段直接忽略，不会把页面打挂 |
| 列表包装 | 兼容直接数组，以及 `{users}`、`{data:{items}}` 等常见包法 |
| 回落演示 | 超时、网络错误、404、401 都不会卡住启动；页面上会标明「演示模式」或「后端已通 · 演示数据」 |
| VIP 目录 | 当前后端已有 `GET /api/vip/catalog`，连通后会读取并尽量对到管理端的权益开关 |

当前 M2.6 已能用上的接口：`GET /api/health`、`GET /api/vip/catalog`（以及如有令牌时的 `/api/me`、`/api/vip/me`）。  
一旦未来的用户端后端提供例如 `GET /api/admin/users`、`POST /api/admin/vip/grant`，只要路径能对上（或在对照表里改一下），管理端会自动改用服务器数据，不必再改一版前端。

**不要把管理员密钥写进前端源码。** 密钥只放后端环境变量。支付不会在管理端接入。

请求头：`Authorization: Bearer <token>`（若已配置）。错误体按 `{error:{code,message}}` 解析，也兼容其他常见形状。

---

## 4. 目录说明

```
src/components/admin/   管理端界面（登录、首页、用户、内容、系统设置等）
src/lib/admin/store.ts  本机状态与演示数据
src/lib/admin/backend.ts 后端适配层
src/spa-main.tsx        单文件 / 静态预览的入口（不走服务端渲染）
spa.html                带启动保护的静态壳
scripts/preview-server.mjs  预览服务（静态页 + /api 反代）
dist-spa/NOVA_Admin.html    构建后的单文件
```

环境变量（预览服务）：

- `PORT` 默认 4173
- `HOST` 默认 `0.0.0.0`
- `NOVA_API` 默认 `http://127.0.0.1:8787`
