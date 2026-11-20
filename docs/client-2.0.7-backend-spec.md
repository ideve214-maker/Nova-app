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

## C. 群聊端到端加密

**结论**：一次做完的工作量比较大（客户端约 3–4 天，服务端约 1.5 天，加上测试），这次 2.0.7 不做，先给方案。现在服务端会拒绝群聊加密消息（`chats.mjs` 返回 `E2EE_GROUP`）。

**方案**：用和私聊同一个库（vodozemac）里的 Megolm（`GroupSession` / `InboundGroupSession`，库里已经带了，不用加依赖）。这是 Matrix/Element 群聊用的方案：
1. 每个发送者在每个群里有一个出站 `GroupSession`。群消息只加密一次，所有成员共用。
2. 会话密钥（`session_key`）通过**现有的私聊 Olm 通道**逐个发给群里每个成员的每台设备（复用 `/api/e2ee/keys/claim`）。
3. 有人加群：给他发当前的会话密钥，他看不到加群之前的消息。有人退群或被踢：所有人轮换新的会话，他看不到之后的消息。
4. 群消息的密文格式：`{v:1, alg:"megolm", sessionId, body}`。

### 服务端需要做
| 方法 | 路径 | 请求 | 说明 |
|---|---|---|---|
| POST | `/api/conversations/:id/messages` | 现有接口，允许 `kind=group` 时 `encrypted:true`，`ciphertext` 为 `{v:1,alg:"megolm",sessionId,body}` | 去掉 `E2EE_GROUP` 拦截，按 alg 校验格式；群聊加密消息不跑屏蔽词、@所有人 改为客户端在密文外带 `mentions:[userId]/"all"`（明文元数据） |
| POST | `/api/e2ee/room-keys` | `{conversationId, sessionId, to:[{userId, deviceId, type, body}]}` | 发送方把用 Olm 加密的会话密钥投递给每台设备；服务器只转存，最多 500 条/次 |
| GET | `/api/e2ee/room-keys?since=` | 无 | 拉取发给本设备的会话密钥（按 `recipient_device_id`），拉取后 7 天删除 |
| GET | `/api/conversations/:id/devices` | 无 | 返回群成员全部未撤销设备 `{userId, deviceId, identityKey}`，用来分发会话密钥 |
| SSE | `e2ee.room_key` / `conversation.members_changed` | — | 收到新会话密钥、成员变化时通知客户端（成员变化后客户端轮换会话） |

- 存储：`e2ee_room_keys(id, conversation_id, session_id, sender_user_id, sender_device_id, recipient_user_id, recipient_device_id, type, body, created_at)`；`messages` 表复用现有的 `encrypted / ciphertext / e2ee_type` 字段（`e2ee_type='megolm'`），`olm_session_id` 存 Megolm 的 `sessionId`。
- 群里的成员变化接口（加人、踢人、退群）在返回和推送里带上 `membersVersion`，客户端靠它判断要不要轮换会话。
- 群聊加密以后，服务端的消息搜索、导出、举报看不到内容；举报时由客户端把解密后的内容随举报一起提交（和私聊一样）。

### 客户端（Bob）
`26_e2ee.js` 加 Megolm 收发、会话密钥分发和轮换；`22_chat.js` 的群聊发送走加密；群聊横幅改成“群聊已加密”。上线开关：服务端 `/api/health` 返回 `features.groupE2ee:true` 后客户端才加密，旧版本客户端看到加密的群消息时显示“请更新到最新版本查看”。

## 其他（服务端 2.1.0 已经做了，客户端已对接）
- 外部帖头像：客户端优先用 `avatar.path`，通过 `apiUrl()` 补全成完整地址；图片加载失败时显示 `avatar.fallback`。
- 私聊文件 / 视频：客户端文件选择器同时写了扩展名和 MIME（安卓只认 MIME，以前 doc/docx 在安卓上选不了）；.mov 按 mp4 上传（新旧服务器都接受）；超过 100 MB 在客户端直接提示；413 时提示“普通 50 MB / VIP 100 MB”。**部署时要确认 nginx 的 `client_max_body_size` ≥ 100m，服务器装了 ffprobe**，否则视频还是发不出去。
- 首页每 2 分钟刷新一次，和导入频率一致。
