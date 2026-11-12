# NOVA 生产运维备忘（阿里云香港 · Ubuntu 22.04 · Node 22）

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
