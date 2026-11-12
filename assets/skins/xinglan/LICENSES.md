# 星澜 Xinglan 主题提案 · 许可与来源

本目录内新增的主题、图标、启动屏和预览，只用可商用许可的字体与图形（OFL / MIT / Apache 2.0 或为本提案原创）。未使用未授权的字体、图标库或图片。

## 1. 字体：Noto Sans CJK SC（含 Noto Sans SC）

| 项 | 说明 |
| --- | --- |
| 名称 | Noto Sans CJK SC Bold / Regular |
| 来源 | [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk)，亦见于 [Google Fonts · Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC) |
| 许可 | **SIL Open Font License 1.1**（可商用、可嵌入、可转换轮廓；保留保留字体名限制） |
| 本提案中的用法 | ① 预览截图与启动屏渲染使用系统已安装的 Noto Sans CJK SC，**未把字体文件打进应用包**；② 「NOVA」「管理端」「星澜」等标志文字已转为 **SVG 轮廓路径**（出自 Bold 字重），不依赖运行时字体。上线若要打包字体，请从官方仓库自行下载并遵守 OFL。 |
| OFL 文本 | https://openfontlicense.org/open-font-license-official-text/ |

系统字体栈里还写了 `-apple-system`、`BlinkMacSystemFont`、`Segoe UI`、`PingFang SC`、`Hiragino Sans GB`、`Microsoft YaHei`，仅作各平台回退，**不随本提案分发**。

## 2. 原创图形（本提案）

| 项 | 说明 |
| --- | --- |
| 内容 | 星澜标志（四角新星 + 双层微澜）、用户端/管理端应用图标、深色/浅色启动屏、界面图标方向稿、按键样式表与主题令牌 |
| 作者 | 为本提案原创，供 NOVA 项目使用 |
| 许可 | **MIT License**（可商用、可修改、可再分发；保留版权声明即可） |
| 路径 | `/workspace/nova-theme/theme_v1/`、`/workspace/nova-theme/brand/`、`/workspace/nova-theme/preview/` |

MIT 许可声明：

```
Copyright (c) 2026 NOVA 星澜主题提案

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 3. 原应用中已有、本提案未新引入的资源

| 资源 | 来源 | 许可 | 说明 |
| --- | --- | --- | --- |
| 用户端界面图标路径（主页/社区/聊天等） | 原应用 `src/10_data.js` 中的 Material 风格 path，对应 [Material Design Icons](https://github.com/google/material-design-icons) | **Apache License 2.0** | 本提案未改原仓库；方向稿里给出了一套原创描边图标供后续替换。Apache 2.0 全文：https://www.apache.org/licenses/LICENSE-2.0 |
| 演示头像与风景照片 `assets/av-*.jpg`、`bg-*.jpg`、收款码 `pay-*.jpg` | 原 NOVA 工程已有资源 | 以原项目权属为准 | 仅出现在主题预览截图里，本提案不重新分发这些照片文件。 |

## 4. 构建工具（不随主题交付）

预览截图用了 Puppeteer / Chromium 和无头渲染，它们的许可与主题交付物无关，不打进应用包。
