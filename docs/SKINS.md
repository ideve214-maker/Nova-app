# 按键皮肤（Button skins）

皮肤是一组按键外观（以及可选的色彩令牌、图标、标志）。应用启动时读取注册表，把用户选中的皮肤以 CSS 变量和样式表套到按钮上。加载失败则回退到可用皮肤。

当前默认视觉是 **星澜（xinglan）**（M7.2）。**经典（default）** 是星澜之前的外观，可在「设置 → 按键皮肤」中切换。选择按账号记在本机（localStorage），登录后也会写入 `POST /api/me/prefs`（`ui_skin`）。

## 目录

```
assets/skins/
  index.json              # 注册表（构建时复制到 dist/assets/skins/）
  xinglan/                # 星澜：令牌、图标、标志、按键样式
  default/                # 经典：把变量和按键改回旧外观
```

未来 Capacitor 打包用的用户端图标和启动屏在 `capacitor/resources/`（只用了星澜包里的 **user** 资源，管理端那套留给 Agen）。

## 注册表 `index.json`

```json
{
  "defaultSkin": "xinglan",
  "skins": [
    { "id": "xinglan", "name": "星澜", "path": "xinglan" },
    { "id": "default", "name": "经典", "path": "default" }
  ]
}
```

`path` 是 `assets/skins/` 下的文件夹名，须与 `id` 一样使用 `[a-z0-9][a-z0-9_-]{0,31}`。

## `skin.json` 字段

| 字段 | 说明 |
| --- | --- |
| `id` | 与文件夹名、注册表一致 |
| `name` | 设置里显示的名称 |
| `version` | 皮肤自身版本 |
| `preview` | 设置里的预览图（相对本文件夹，png/svg） |
| `css` | 可选。额外样式表，选择该皮肤时插入。失败则回退 |
| `tokensCss` | 可选。设计令牌源（星澜的 `tokens.css`），应用已把其变量映射进默认主题 |
| `logo` / `logoMark` | 可选。顶栏与启动页标志 SVG |
| `icons` | 可选。`逻辑名 → svg 路径`。未提供的名称仍用内置图标。建议包含：`home`、`community`、`chat`、`profile`、`search`、`bell`、`back`、`plus`、`more`、`send` |
| `buttons` | 可选。`normal` / `pressed` / `disabled` 的说明（供设计对照；实际观感以 `css` 和 CSS 变量为准） |
| `components` | 可选。按选择器的覆盖说明，同样由 `css` 落地 |

不要在 `css` 里写死业务文案或改页面结构，只改色彩、圆角、阴影、按键与图标。

## 添加一套新皮肤

1. 新建 `assets/skins/<id>/`，放入 `skin.json` 和资源（预览图、`skin.css`、可选图标与标志）。
2. 在 `assets/skins/index.json` 的 `skins` 数组里加一条 `{ "id": "<id>", "name": "显示名", "path": "<id>" }`。
3. 重新构建：`node scripts/build.mjs`（会把 `assets/skins/` 整目录复制到 `dist/assets/skins/`）。
4. 不必改客户端业务代码。若样式表或 JSON 加载失败，会回到 `default` 或注册表里的下一套可用皮肤。

## 星澜令牌与经典回退

星澜的色彩、圆角、阴影、字体栈写在 `assets/skins/xinglan/tokens.css`，并已映射到 `src/00_head.html` 的现有 CSS 变量（`--cv`、`--bg`、`--ac`、`--r-btn` 等），作为应用的默认主题。深色为默认；浅色是同一套令牌的白天版本；设置里可覆盖，也可选「跟随系统」。VIP 香槟金仍由服务端确认后的 `data-vip=gold` 叠加。

选择「经典」时，`default/skin.css` 把上述变量和 `.pb` / `.ib` 改回原来的胶囊按钮和 Facebook 蓝，不改功能流程。

## 字体

不打包完整 Noto 字体文件。页面字体栈优先使用系统已安装的 **Noto Sans CJK SC** / **Noto Sans SC**，然后是苹方、冬青黑体、微软雅黑和系统 UI 字体。许可说明见 `docs/LICENSES-xinglan.md`（图标、标志和启动屏为原创 MIT；Noto 为 OFL 1.1）。
