# NOVA 皮肤制作说明（给其他 AI）

本包是 NOVA App 的「星澜 Xinglan」皮肤（id: xinglan），作为制作新皮肤的模板。新皮肤请保持**完全相同的目录结构和文件名**，只改视觉内容。

## 目录结构
- `skin.json` 皮肤名称、id、版本、文件索引。新皮肤改 id 和 name（id 用小写英文）。
- `tokens.css` / `tokens.json` 设计变量：颜色（dark/light 两套）、字体、字号、圆角、阴影、按钮各状态（普通/按下/禁用）。两份数值必须一致，变量名不要改，只改值。
- `THEME.md` 主题规范说明。
- `icons/*.svg` 界面图标，24px 描边风格：home, community, chat, profile, search, bell, plus, send, back, more, settings, vip。新皮肤需提供同名同尺寸的全部图标。`direction.html` 是图标总览。
- `logo/` 标志：nova-mark.svg（图形）、nova-lockup.svg（图形+文字）、nova-app-icon.svg。
- `brand/user/`、`brand/admin/` 用户端和管理端的 App 图标（icon.svg + 16–1024 各尺寸 PNG）和启动屏（splash-dark/light，1170x2532，SVG/HTML/PNG）。两端样式必须一致，管理端必须带醒目的「管理端」三个字。`brand/shared/` 为共用标志；`build_brand.py`、`render_pngs.mjs` 是生成 PNG 的脚本。
- `preview/` 关键页效果图（登录、动态、聊天、社区、个人页、VIP 付款、设置，深浅两版）和按键样式表 `buttons.png`（源 `buttons.html`，改 CSS 变量即可重渲染）。
- `button_inventory.md` App 全部 58 个画面、214 个交互控件清单，新皮肤要覆盖到这些控件。
- `LICENSES.md` 字体、图标许可。

## 规则
1. 只用可商用许可的字体和图标（OFL / MIT / Apache 等），在 LICENSES.md 写明来源和许可证。
2. 必须同时提供深色和浅色两套。
3. 图片优先 SVG；PNG 请给 2x/3x。
4. 每套新皮肤都要附效果图和按键样式表。
