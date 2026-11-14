# VEXO 皮肤制作说明

本包以 Xinglan 1.0.0 为结构模板制作。目录层级、文件索引、CSS 变量名和 JSON 令牌键保持兼容；新主题仅改变视觉值与品牌展示。请先阅读 `THEME.md`、`tokens.json` 和 `button_inventory.md`。

## 兼容要求
- `skin.json` 提供皮肤 id、名称、版本、默认模式及文件索引。
- `tokens.css` 与 `tokens.json` 的颜色语义保持一致；不要改变量名。
- `icons/` 保留 24px SVG 描边图标及原文件名。
- `logo/` 包含 VEXO 皮肤标志（旧的 `brand/` 品牌图与启动屏源稿已删除，App 图标与启动屏统一用 `admin/resources/` 的 VEXO 星光版）。
- `preview/` 提供登录、首页、聊天、个人页、社区、设置、VIP、按键样式等预览。
- 主题必须同时支持深色和浅色；控件行为以 `button_inventory.md` 为准。
- 字体使用系统字体栈；Noto Sans SC 遵循 SIL OFL 1.1。原创 SVG/主题代码按 MIT 许可。
