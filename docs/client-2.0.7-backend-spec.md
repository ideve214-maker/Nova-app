# 用户端 2.0.7 需要服务端配合的需求（交给 Dift）

用户端 2.0.7 已经做完、不依赖下面任何一项也能发布。下面两项是后续版本要做的，需要服务端先提供接口。

## A. 私聊密钥云端备份（换手机 / 重装后仍能看历史消息）

**现状（2.0.7 已修）**：问题出在客户端：退出登录时删掉了本机的设备密钥，重新登录会生成新设备，旧消息是加密给旧设备的，所以全部显示“无法解密”。另外 Olm 每个消息密钥只能用一次，解开过的消息不能再解，而解开的内容以前只放在内存里，App 重启后也会变成“无法解密”。
2.0.7 起：退出只清内存，设备密钥和已解密的内容按账号保存在本机；注销账号时才删除。**同一台设备**重新登录后，历史消息照常显示。

**还做不到的**：换手机、卸载重装、清除 App 数据以后，本机保存的内容都没了，历史消息仍然无法解密。要解决这个问题，需要服务端保存一份**客户端加密后的备份**。服务端只存密文，拿不到密钥。

### 接口
| 方法 | 路径 | 请求 | 返回 |
|---|---|---|---|
| GET | `/api/e2ee/backup` | 无 | `200 {backup:{version, deviceId, kdf, salt, iv, ciphertext, size, updatedAt}}`；没有备份时返回 `200 {backup:null}` |
| PUT | `/api/e2ee/backup` | `{version, deviceId, kdf:{name:"PBKDF2", hash:"SHA-256", iterations:310000}, salt, iv, ciphertext, prevVersion}` | `200 {backup:{version, updatedAt}}`；`prevVersion` 和服务器上的不一致时返回 `409 BACKUP_CONFLICT`（防止两台设备互相覆盖），返回体里带服务器上的 `version` |
| DELETE | `/api/e2ee/backup` | 无 | `200 {ok:true}` |

- `salt`、`iv`、`ciphertext` 都是 base64。`ciphertext` 由客户端用 AES-256-GCM 加密，内容是 `{accountPickle, sessions, plainCache}`。密钥由用户的**备份密码**（不是登录密码，也可以由登录密码派生，由产品决定）经 PBKDF2 算出，服务端拿不到。
- 存储：新建表 `e2ee_backups(user_id PRIMARY KEY, version INTEGER, device_id TEXT, kdf TEXT, salt TEXT, iv TEXT, ciphertext BLOB, size INTEGER, updated_at INTEGER)`，每个账号只存一份，覆盖写入。
- 限制：`ciphertext` 解码后最大 8 MB（超过返回 `413 BACKUP_TOO_LARGE`）；PUT 每个账号每分钟最多 6 次。
- 注销账号时删除备份。审计日志只记录“备份已更新”和大小，不记录内容。
- 客户端（下个版本做）：登录后检查是否有备份，有的话请用户输入备份密码来恢复；新消息解密后最多 30 秒同步一次备份。

## 其他（服务端 2.1.0 已经做了，客户端已对接）
- 外部帖头像：客户端优先用 `avatar.path`，通过 `apiUrl()` 补全成完整地址；图片加载失败时显示 `avatar.fallback`。
- 私聊文件 / 视频：客户端文件选择器同时写了扩展名和 MIME（安卓只认 MIME，以前 doc/docx 在安卓上选不了）；.mov 按 mp4 上传（新旧服务器都接受）；超过 100 MB 在客户端直接提示；413 时提示“普通 50 MB / VIP 100 MB”。**部署时要确认 nginx 的 `client_max_body_size` ≥ 100m，服务器装了 ffprobe**，否则视频还是发不出去。
- 首页每 2 分钟刷新一次，和导入频率一致。


## J. 外部帖链接预览卡片（可选，客户端已能用兜底样式）

客户端已经把正文里的网址拆出来显示成卡片：没有预览数据时显示网站图标（`https://域名/favicon.ico`）+ 域名 + 路径。服务端补上下面的字段后，卡片自动显示标题、摘要和缩略图：

- 帖子（和评论，可选）返回 `linkPreviews: [{url, title, description, image, siteName}]`，单个也可以用 `linkPreview: {...}`。`url` 要和正文里的网址一致（客户端按网址匹配，忽略末尾 `/`）。
- 抓取时机：外部帖入库时顺便抓（就在 AI 审查那一步之前），用户帖发帖后异步抓。只读 `<head>` 里的 `og:title / og:description / og:image / og:site_name`，没有就用 `<title>` 和 `meta description`。
- 安全：只允许 http/https；解析域名后拒绝内网和回环地址（防 SSRF）；跟随跳转最多 3 次且每次都重新检查；超时 5 秒；最多读 256KB；`image` 建议走现有的 `/api/import/avatar` 同类代理，返回相对地址，客户端用 `apiUrl()` 拼。
- 可选单独接口：`GET /api/link-preview?u=<url>` → `{url,title,description,image,siteName}`，按网址缓存 7 天。

## K. 自动翻译（客户端已做，服务端做了能省额度）

客户端现状：开了自动翻译后，进屏幕的外文内容合并成一次 `POST /api/ai/translate`（`[[1]] … [[2]] …` 分段，最多 8 段 / 约 1800 字），译文存本机。限制是每人每小时 60 次（`LIMITS.translate`），客户端自限 40 次。

建议服务端：
1. **入库时就翻**：外部帖和外部评论在 AI 审查那次调用里顺便产出中文译文（原文已是中文就跳过），返回 `translations: {zh: "…"}`（以后可加 `en`）。客户端优先用这个字段，完全不再调用翻译接口。
2. **批量接口**（可选）：`POST /api/ai/translate/batch {items:[{id, text}], to:'zh'|'en'}` → `{items:[{id, text}]}`，按「原文哈希 + 目标语言」做持久缓存（所有用户共享，命中不计次数），一批算 1 次额度，最多 20 条 / 6000 字。上线后在 `/api/health` 的 `features.translateBatch=true`，客户端再切过去。

## M. 个性化推荐（Dift 已在 2.1.2 分支 `db8f51d` 实现，迁移 067；客户端已按实际返回联调）

- `GET /api/me/interests` → `{like:[category], dislike:[category], hiddenSources:[origin], onboarded:bool}`；`PUT` 传同样结构。`category` 取值：`tech / game / crypto / finance / news / life / other`；`origin` 用帖子的 `source`（如 `ithome`）。
- `POST /api/feed/not-interested {postId, reason:'post'|'category'|'source'}`：`category` 把该帖分类加进 dislike，`source` 把该帖来源加进 hiddenSources（客户端本地也同步更新并立刻从列表里移除）。
- `POST /api/feed/signals {events:[{postId, dwellMs, action, at}]}`：`action` 取 `view|open|open_origin|like|save|share|hide`；`at` 是毫秒时间戳；每批最多 100 条，客户端每 30 秒或切到后台时发（切到后台用 keepalive）。`view` 的 `dwellMs` 只统计帖子露出 ≥50% 的时间，<500ms 不报。
- 客户端遇到 404 / 405 / 501 静默停用对应功能；5xx 和 429 会把这批留到下次再发（本地最多攒 300 条）。
- 排序（Dift）：偏好权重 + 随时间衰减的行为分 + 新鲜度，约 20% 随机探索；dislike 分类、隐藏来源、标了不感兴趣的帖子不出。兴趣分只算真人，AI 账号的浏览不计。
- 客户端按 2.1.2 实际行为处理：`PUT` 以返回为准（服务端会规范化重叠项），跳过选择页时只发 `{onboarded:true}`；`not-interested` 用返回的 `interests` 刷新本地偏好，`NO_CATEGORY / NO_SOURCE / NOT_FOUND` 只提示不报错；`signals` 遇到 429 `RATE_LIMIT` 暂停 90 秒再发，400（`BAD_ACTION / TOO_MANY_EVENTS`）丢弃这一批不重试。
