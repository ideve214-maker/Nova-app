# NOVA 品牌稿 · 星澜 Xinglan（提案，待你过目）

用户端与管理端共用同一套标志、色彩和构图；管理端在图标底部加「管理端」横幅，在启动屏用大号胶囊突出「管理端」。尚未写入任何应用仓库，也未保存到资料库。

## 图标

生产用图是 **满幅正方形**（系统自己裁圆角）。带 `-masked` 的是按 iOS 约 22.8% 圆角裁好的预览，方便先看效果。

| 文件 | 说明 |
| --- | --- |
| `user/icon/icon.svg` | 用户端图标源文件 |
| `user/icon/icon-1024.png` | 用户端 1024×1024 生产图 |
| `user/icon/icon-{16…512}.png` | 常用尺寸（含 180/192/512 等） |
| `user/icon/icon-1024-masked.png` | 圆角预览 |
| `admin/icon/icon.svg` 及同样的 PNG 系列 | 管理端，底部金色分隔 + 靛紫横幅「管理端」 |

## 启动屏

尺寸 1170×2532（iPhone 13/14 Pro 逻辑 @3x 的满屏）。有深色、浅色，SVG / HTML / PNG（另附 @2x）。

| 文件 | 说明 |
| --- | --- |
| `user/splash/splash-dark.svg` `.html` `splash-dark-1170x2532.png` | 用户端深色 |
| `user/splash/splash-light.*` | 用户端浅色 |
| `admin/splash/splash-dark.*` | 管理端深色，大号「管理端」胶囊 |
| `admin/splash/splash-light.*` | 管理端浅色 |

## 合看预览

- `preview/icons-user-admin.png` — 两枚图标并排
- `preview/splashes-4up.png` — 四种启动屏

共用标志：`shared/nova-mark.svg`。令牌见 `../theme_v1/tokens.css` 与 `tokens.json`。许可见 `../LICENSES.md`。
