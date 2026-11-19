# 天气卡片：服务器配置（给 Dift）

这一项要先部署服务器，再发热更新。密钥和 xdb 只放在服务器上，不要写进仓库、客户端或热更新包。

## 和风天气

在服务器环境变量中配置（不要提交 `.env`）：

```
NOVA_QWEATHER_HOST=你的接入主机.qweatherapi.com
NOVA_QWEATHER_KEY=你的 API Key
```

如果用 JWT 鉴权，改设 `NOVA_QWEATHER_JWT`，不必同时写 Key。没配密钥时，客户端不显示天气卡片。

开发者控制台：https://dev.qweather.com  
用到的接口：GeoAPI v2 城市查询、Weather API v1 实时天气、3 天逐日预报。

## 默认城市（ip2region，不弹定位窗）

用开源离线库 [ip2region](https://github.com/lionsoul2014/ip2region)（Apache-2.0 / MIT）根据用户 IP 判断城市，再交给和风 Geo。查询代码已在 `server/vendor/ip2region/`，**不要把 xdb 打进热更新 zip**。

1. 从官方仓库下载 IPv4 数据文件（约 10MB+）：  
   https://github.com/lionsoul2014/ip2region/tree/master/data  
   文件名一般为 `ip2region_v4.xdb`。
2. 放到服务器本地目录，例如 `/opt/nova/data/ip2region_v4.xdb`（需对运行用户可读）。
3. 设置：

```
NOVA_IP2REGION_XDB=/opt/nova/data/ip2region_v4.xdb
```

可选 IPv6：`NOVA_IP2REGION_XDB_V6=/opt/nova/data/ip2region_v6.xdb`。

文件不存在、损坏，或该 IP 查不到城市时，回退到默认城市「北京」。用户在 App 里手动选过的城市会记在本机，优先于 IP。

取客户端 IP 需要 nginx 把 `X-Forwarded-For` 或 `X-Real-IP` 传给 Node，并设置 `NOVA_TRUST_PROXY=1`（只信任反代，防止伪造）。服务器不记录、不存储原始 IP。

## 定位权限（可选，「用我的位置」）

默认不申请定位。用户主动点「用我的位置」时，使用 WebView 里的 `navigator.geolocation`（若已安装 `@capacitor/geolocation` 也会用插件，但插件需要原生发版，热更新加不进去）。

iOS 的 `NSLocationWhenInUseUsageDescription` 已在 `scripts/stamp-native.mjs` 里写入（发帖定位用过同一条）。如果线上安装包的 Info.plist 里已经有这个键，热更新后「用我的位置」即可用；如果某次原生包漏了这个键，需要再打一版原生包，否则 iOS 上会定位失败，用户仍可手动搜城市。

## 网页端「用我的位置」（可选）

原生 App 加载的是本地 HTML，不受服务器安全头影响。若用户从服务器网页打开，需要把 `server/security.mjs` 里 HTML 响应的 `Permissions-Policy` 中 `geolocation=()` 改成 `geolocation=(self)`，否则浏览器会拦截定位。2.0.6 候选已在 `server/security.mjs` 把 HTML 响应改为 `geolocation=(self)`，API 响应仍是 `geolocation=()`。若该文件无法随分支推上，部署时请手工改这一处。
