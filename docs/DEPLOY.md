# 部署备忘（CORS 与生产构建）

## `NOVA_CORS_ORIGIN` 白名单

生产请设置逗号分隔的 Origin 白名单（精确字符串匹配，含协议和端口）。**必须包含**：

| 来源 | 说明 |
|---|---|
| 管理后台 Web Origin | Agen 的实际浏览器 Origin，例如 `https://admin.example.com`。漏写则管理端跨域请求会被拦。 |
| `capacitor://localhost` | iOS Capacitor 壳的 Origin。 |
| `http://localhost` | Android Capacitor / WebView 壳的 Origin。 |

本地调试可再加 `http://localhost:端口` 或 `https://localhost`。未设置时仍回显 `Access-Control-Allow-Origin: *`（仅适合本机）。

```bash
NOVA_CORS_ORIGIN=https://admin.example.com,capacitor://localhost,http://localhost \
  NOVA_ENV=production npm run server
```

预检允许 `GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS`。收据接口 `GET` 与 `HEAD /api/admin/payments/:id/receipt` 均可用。

客户端生产构建：

```bash
node scripts/build.mjs --api-base=https://api.example.com --disable-demo
```

`--disable-demo`（或 `NOVA_DISABLE_DEMO=1`）关闭演示数据；真实 API 模式下服务端不会回落演示夹具。详见 `server/README.md`。
