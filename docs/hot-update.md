# 热更新（自托管 @capgo/capacitor-updater）

第 2 版起整包重装，之后只靠热更新推送 Web 资源。本仓库使用 `@capgo/capacitor-updater` 7.x 的**手动 / 自托管**模式，不连接 Capgo 云，也不向 Capgo 发送统计。

当前尚未打包，也尚未打开更新。清单与包的下载地址由 Dift 提供后再配置。不要把 `https://47.239.0.90` 写死进客户端。

## 配置开关

| 名称 | 默认 | 作用 |
| --- | --- | --- |
| `NOVA_UPDATE_MANIFEST_URL` | 空 | 构建时注入 `window.NOVA_UPDATE_MANIFEST_URL`。也可以在页面里先赋值。**留空时客户端不检查、不下载。** |
| `window.NOVA_APP_VERSION` | 构建时写入，等于 `package.json` 的 `version` | 内置包版本。设置 / 关于页在跑内置包时显示它。 |

命令行等价：`node scripts/build.mjs --update-manifest-url=https://example.com/nova/updates.json`。

`capacitor.config.json` 里的插件配置：

- `autoUpdate`: `false`（关闭自动更新，避免访问默认的 Capgo 云地址）
- `updateUrl` / `statsUrl` / `channelUrl`: 一律 `""`
- `appReadyTimeout`: `10000`（10 秒内未调用 `notifyAppReady()` 则自动回滚）
- `autoDeleteFailed`: `true`
- `version`: 与 `package.json` 一致（目前 `0.7.0-m7.r7`），作为内置包版本

## 清单格式

客户端用 `GET` 拉取一份 JSON（不要做 POST）。字段：

```json
{
  "version": "0.7.0-m7.r7",
  "url": "https://example.com/nova/bundles/nova-0.7.0-m7.r7.zip",
  "checksum": "64 位小写十六进制 SHA-256（整个 zip 文件）"
}
```

- `version`：建议与 `package.json` 相同的 SemVer（可带预发布号，如 `0.7.0-m7.r6`）。只有**严格新于**当前正在运行的包版本时才会下载。
- `url`：zip 的下载地址。真机请使用 HTTPS。由 Dift 提供，不要写死在仓库里。
- `checksum`：可选但强烈建议。传给 `CapacitorUpdater.download()`，校验失败则丢弃该包，不切换版本。
- 若清单含 `error` 字段，客户端会忽略这次更新。

zip 根目录必须有 `index.html`（可与 `nova_v5.html` 内容相同），并包含 `assets/` 等资源。不要加密、不要多余的隐藏文件。可用下面的脚本生成：

```bash
npm run build
npm run bundle
```

`scripts/make-bundle.mjs` 会在 `dist-bundles/` 写出 `nova-<version>.zip` 和一份含 `checksum` 的 JSON 草稿。`dist-bundles/` 不入库。

## 客户端流程

1. 仅在 Capacitor 原生环境运行；浏览器预览里 `notifyAppReady`、检查清单都是空操作。
2. 启动时立刻调用 `CapacitorUpdater.notifyAppReady()`。若约 10 秒内未调用，插件会把这次启动视为失败并回滚到上一个可用包（通常是内置包）。
3. 用 `current()` 读取正在运行的包：`id === "builtin"` 时界面显示内置版本（`NOVA_APP_VERSION` / `package.json`）；否则显示已下载包的 `version`。
4. 若清单地址非空：拉取清单，比较版本，必要时 `download({ url, version, checksum })`。
5. 下载成功后调用 `next({ id })`，**在下次启动时**启用新包，不会在当前会话中途 `set()` 重载。
6. 下载失败或校验和不匹配：删除这次下载的包（`autoDeleteFailed` 也会清理），保持当前正在运行的包。不会因为一次失败的下载而 `reset()` 掉已经可用的版本。

## 用户可见版本

设置页「关于」分组的「版本」，以及「关于」说明页，显示的是**当前实际在跑的包版本**，与 `package.json` / 构建注入的 `NOVA_APP_VERSION` 对齐。

## 注意

- 本仓库只改用户端 Web 与 Capacitor 配置，不执行原生构建、不打包、不部署。
- 接入原生壳时需要 `npx cap sync`，以便把 `@capgo/capacitor-updater` 装进 iOS / Android 工程。此项由后续打包步骤完成。
