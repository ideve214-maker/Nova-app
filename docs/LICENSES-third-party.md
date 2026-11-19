# 第三方许可（0.7.0-m7.r6）

下列组件按各自许可使用。应用内「小游戏」页不展示商标名。

## 客户端与服务端库

| 组件 | 版本 | 许可 |
| --- | --- | --- |
| @capacitor/core | 7.6.10 | MIT |
| @capacitor/keyboard | 7.0.6 | MIT |
| @capacitor/status-bar | 7.0.6 | MIT |
| @capacitor/haptics | 7.0.5 | MIT |
| @capgo/capacitor-updater | 7.53.0 | MPL-2.0 |
| nsfwjs | 4.4.0 | MIT |
| @tensorflow/tfjs | 4.22.0 | Apache-2.0 |
| sharp | 0.35.5 | Apache-2.0 |
| DOMPurify | 3.4.17 | MPL-2.0 OR Apache-2.0 |
| @tanstack/virtual-core | 3.19.11 | MIT |
| PhotoSwipe | 5.4.4 | MIT |
| pulltorefreshjs | 0.1.22 | MIT |
| Dexie | 4.4.7 | Apache-2.0 |
| @sentry/browser（Bugsink 兼容） | 11.12.0 | MIT |

## 小游戏

各游戏的 LICENSE 文件在 `assets/games/<id>/`。

| 目录 | 名称 | 上游 | 提交 | 许可 |
| --- | --- | --- | --- | --- |
| 2048 | 2048 | gabrielecirulli/2048 | 478b6ec | MIT |
| tower | 盖楼 | iamkun/tower_game | c6fa84a | MIT |
| gobang | 五子棋 | mumuy/gobang | 21bf0b6 | MIT |
| chess | 中国象棋 | itlwei/Chess | e8b4c0f | MIT |
| snake | 贪吃蛇 | patorjk/JavaScript-Snake | 3243086 | MIT |
| solitaire | 纸牌接龙 | jhatzimalis/solitaire | a737d5a | MIT |
| reversi | 黑白棋 | alex-berson/reversi | c9c1cdc | MIT |
| calc24 | 24点 | mumuy/calc24 | 1a982f5 | MIT |
| mines | 扫雷 | kereszteszsolt/clear-field | edd9b1a | MIT |
| sudoku | 数独 | theabbie/sudoku | 46c55b9 | MIT |
| c4 | 四子棋 | kenrick95/c4 | 5f0b141 | MIT |

## 天气

| 组件 | 来源 | 许可 | 说明 |
| --- | --- | --- | --- |
| 和风天气 API | [dev.qweather.com](https://dev.qweather.com) | 和风天气开发者服务条款 | 仅服务器调用。卡片署名「天气服务由和风天气提供」，并链接到 [qweather.com](https://www.qweather.com)。 |
| 和风天气图标 | [qwd/Icons](https://github.com/qwd/Icons) | 代码 MIT，图标设计 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 官方图标子集内联在 `src/35_weather_icons.js`。版权所有 © 和风天气。 |
| ip2region | [lionsoul2014/ip2region](https://github.com/lionsoul2014/ip2region) | Apache-2.0 或 MIT | 服务器离线 IP→城市。查询客户端在 `server/vendor/ip2region/`。xdb 数据文件不进仓库、不进客户端、不进热更新包。 |

