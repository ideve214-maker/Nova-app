# NOVA 生产运维备忘（阿里云香港 · Ubuntu 22.04 · Node 22）

当前生产入口：**http://47.239.0.90**（尚无独立域名，HTTP only）。CORS、构建时的 API 根和 CSP `connect-src` 都按这个 Origin 配置，见 `.env.example`（`NOVA_CORS_ORIGIN` 须包含 `http://47.239.0.90`、`capacitor://localhost`、`http://localhost`；`NOVA_API_BASE=http://47.239.0.90`；`NOVA_COOKIE_SECURE=0`、`NOVA_HSTS=0`，配好 HTTPS 后再开）。

本稿对应当前仓库的启动方式与脚本，按「nginx 监听 80，反代到 127.0.0.1:8787，systemd 在 `/opt/nova/app` 跑服务，数据库在 `/opt/nova/data/nova.db`」来写。按实际域名和单元名改占位即可。

**当前 80 端口是纯 HTTP。** 建议尽快在 nginx 上配置 TLS（证书 + 443），然后再打开 `NOVA_HSTS=1` 与 `NOVA_COOKIE_SECURE=1`。在 HTTP 下不要开这两项，否则浏览器会拒绝明文访问或存不下 Secure Cookie。

## systemd 单元示例

文件例如 `/etc/systemd/system/nova.service`（单元名与 `NOVA_SERVICE`、`scripts/backup.sh` 保持一致）：

```ini
[Unit]
Description=NOVA API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/nova/app
EnvironmentFile=/opt/nova/app/.env
ExecStart=/usr/bin/node --no-warnings server/index.mjs
Restart=on-failure
RestartSec=3
User=nova
Group=nova
# 日志进 journald，见下文 journalctl

[Install]
WantedBy=multi-user.target
```

`.env` 从仓库根目录 `.env.example` 复制，填入真实值，**不要**把填好的文件提交进 Git。目录权限：`/opt/nova/data` 与 `/opt/nova/backups` 须对运行用户可写。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nova
```

## nginx 示例（80 反代，已按 SSE 与 50m 上传）

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.example.com;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Connection "";
        # SSE（/api/events）：关闭缓冲并拉长超时
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

服务端请设 `NOVA_TRUST_PROXY=1`，以及 `NOVA_TRUSTED_PROXIES=127.0.0.1,::1`，这样才会采用 nginx 传来的 `X-Forwarded-For`。`NOVA_CORS_ORIGIN` 必须包含管理端 Web Origin、`capacitor://localhost`（iOS）和 `http://localhost`（Android），见 `.env.example`。

## 创建第一个管理员

任选其一（不要使用弱口令或内置默认密码；未同时提供用户名和强密码时**不会**创建账号）：

```bash
cd /opt/nova/app
# 命令行（推荐）
node server/admin-cli.mjs create --username 你的管理员名 --password '这里换成强密码'
# 或：在 .env 里同时写 NOVA_ADMIN_USERNAME 与 NOVA_ADMIN_PASSWORD 后重启一次，仅当该用户名尚不存在时创建
```

用返回的 Bearer（`na_` 开头）登录管理端（Agen）。会话与用户端一样走 Authorization 头，不要把令牌放进 URL。

## 部署与更新

1. 把新版本同步到 `/opt/nova/app`（保留 `.env`，不要覆盖 `data/`）。
2. 如需新的前端壳：`node scripts/build.mjs --api-base=https://你的API源 --disable-demo`（按实际公网地址）。
3. `sudo systemctl restart nova`
4. `curl -sS http://127.0.0.1:8787/api/health` 应返回 `"status":"ok"` 且 `"db":"ok"`。经 nginx：`curl -sS http://127.0.0.1/api/health`。

## 回滚

- **程序**：换回上一份已验证的发布包（zip / bundle），再 `systemctl restart nova`，再查 `/api/health`。
- **数据**：用下面的恢复流程，把库换回更新前的快照（恢复会停服务）。更新前先做一次 `scripts/backup.sh backup`。

## 备份与恢复

备份用 SQLite `VACUUM INTO`，是一致快照，不必先停服务：

```bash
# 默认识别 NOVA_DB=/opt/nova/data/nova.db、NOVA_BACKUP_DIR=/opt/nova/backups，保留最近 14 份
sudo -u nova -E /opt/nova/app/scripts/backup.sh backup
# 或：npm run backup -- --db /opt/nova/data/nova.db --dir /opt/nova/backups --keep 14
```

恢复（会先 `systemctl stop nova`，换文件后再 start）：

```bash
sudo /opt/nova/app/scripts/backup.sh restore /opt/nova/backups/nova-YYYYMMDD-HHMMSS.db
```

定时（每天 03:15，任选一种）：

```cron
# crontab -u nova
15 3 * * * /opt/nova/app/scripts/backup.sh backup >> /opt/nova/backups/backup.log 2>&1
```

```ini
# /etc/systemd/system/nova-backup.service
[Unit]
Description=NOVA SQLite backup
[Service]
Type=oneshot
User=nova
EnvironmentFile=/opt/nova/app/.env
ExecStart=/opt/nova/app/scripts/backup.sh backup

# /etc/systemd/system/nova-backup.timer
[Unit]
Description=Daily NOVA backup
[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
[Install]
WantedBy=timers.target
```

`sudo systemctl enable --now nova-backup.timer`

## 健康检查

`GET /api/health`：正常时 HTTP 200，JSON 含 `status: "ok"`、`db: "ok"`（已对数据库执行 `SELECT 1`）。库不可用时为 503。可再看 `disk.low` 是否为磁盘不足。

```bash
curl -fsS http://127.0.0.1:8787/api/health
```

## 日志

本服务把标准输出/错误交给 systemd，用 journal 查看：

```bash
sudo journalctl -u nova -f
sudo journalctl -u nova --since "1 hour ago"
```

结构化错误日志是一行 JSON（`level`、`msg`，敏感字段已脱敏）。不要在日志或审计里查找明文密码、令牌或私聊正文——这些不应被记录。


## 会话风险（简要）

当前 Web 客户端把 Bearer 令牌存在 **localStorage**（`nova_session`）。它会被同源脚本读到：若出现 XSS，或服务器下发的脚本被替换，令牌可能被盗。已采取的缓解：禁止把令牌放进 URL、响应带 CSP 等安全头、可选 HttpOnly + SameSite Cookie 会话（`NOVA_COOKIE_SESSION=1`）并配合 CSRF。**当前是 HTTP，不要打开 `NOVA_COOKIE_SECURE` 和 `NOVA_HSTS`**，否则浏览器可能存不下 Cookie 或拒绝明文访问；上 HTTPS 后再打开，并优先让浏览器走 Cookie 会话以降低 XSS 偷令牌的风险。管理端（Agen）与 Capacitor 仍使用 `Authorization: Bearer`（管理员令牌以 `na_` 开头）。

## 依赖与运行时（简要）

本仓库 **没有 npm 生产依赖**。端到端加密使用的 vodozemac 在 `vendor/` 内。`node:sqlite` 在 Node 22 上仍带实验提示，且是**同步** API，大库或重查询会堵住事件循环；生产请保持定期 `VACUUM INTO` 备份（见上），避免在请求路径上做全表扫描，并关注 Node 发行说明。升级 Node 主版本前应跑一遍服务端测试。

## 把本版本部署到 /opt/nova/app（http://47.239.0.90）

以下按「已有 Ubuntu 22.04、Node 22、nginx 在 80 反代 127.0.0.1:8787、systemd 单元名为 nova」来写。

1. 在本机打好发布包（或用仓库里的 `NOVA_V7_M6.1.zip`），先备份：
   `sudo -u nova -E /opt/nova/app/scripts/backup.sh backup`
2. 把新版本同步到 `/opt/nova/app`（保留现有 `.env` 和 `/opt/nova/data`，不要覆盖数据库）。例如：
   `sudo rsync -a --delete --exclude .env --exclude data --exclude node_modules /tmp/NOVA_V7/ /opt/nova/app/`
3. 若还没有 `.env`：`sudo cp /opt/nova/app/.env.example /opt/nova/app/.env`，按需修改。确保至少包含：
   - `HOST=127.0.0.1`、`PORT=8787`、`NOVA_DB=/opt/nova/data/nova.db`
   - `NOVA_ENV=production`、`NOVA_TRUST_PROXY=1`、`NOVA_TRUSTED_PROXIES=127.0.0.1,::1`
   - `NOVA_CORS_ORIGIN=http://47.239.0.90,capacitor://localhost,http://localhost`
   - `NOVA_API_BASE=http://47.239.0.90`
   - `NOVA_COOKIE_SECURE=0`、`NOVA_HSTS=0`、`NOVA_COOKIE_SESSION=0`（上 HTTPS 后再改）
   - `NOVA_RATE_LIMIT=strict`
   - 法律文档运营者信息（已有默认值）：`NOVA_LEGAL_OPERATOR`、`NOVA_LEGAL_EMAIL`、`NOVA_LEGAL_EFFECTIVE`
4. 在应用目录构建前端（关闭演示，写上 API 根）：
   `cd /opt/nova/app && node scripts/build.mjs --api-base=http://47.239.0.90 --disable-demo`
   可选：`export NOVA_GIT_COMMIT=$(git rev-parse HEAD)` 后启动，便于 `/api/version` 显示提交。
5. `sudo systemctl restart nova`
6. 检查：
   - `curl -fsS http://127.0.0.1:8787/api/health` 应含 `"status":"ok"`、`"db":"ok"` 和 `"version"`
   - `curl -fsS http://127.0.0.1:8787/api/version`
   - `curl -fsS http://127.0.0.1/legal/privacy` 应看到运营者名称，且**没有**「草案」字样
   - `sudo journalctl -u nova -n 50 --no-pager`

回滚：换回上一份发布包，`systemctl restart nova`，必要时用备份恢复数据库（会停服务）。
