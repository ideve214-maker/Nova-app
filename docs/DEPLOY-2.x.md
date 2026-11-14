# VEXO 2.x 发布手册（服务器 + 用户端热更新）

适用于 2.0.0 起的版本。2.0.0 已于 2026-11-15 01:09（北京时间）按本手册上线。
发布由发布负责人执行；开发只在本地构建、测试、暂存，不直接动生产。

生产环境：`root@47.239.0.90`，应用 `/opt/nova/app`（systemd 服务 `nova`，用户 `nova`，`127.0.0.1:8787`），
数据库 `/opt/nova/data/nova.db`（WAL），备份目录 `/opt/nova/backups`，
热更新 `/opt/nova/updates/user/{manifest.json,bundles/}`，nginx 对外 `https://47.239.0.90`。

## 发布顺序（一定先服务器，后清单）

新版前端会调用新接口；清单先切的话，手机装上新包会遇到 404。

1. 备份 → 2. 预演迁移 → 3. 副本冒烟 → 4. 覆盖代码并重启 → 5. 线上检查 → 6. 上传热更新包并切清单 → 7. 看日志确认手机下载完整

## 1. 备份

```sh
TS=$(date +%Y%m%d-%H%M%S); B=/opt/nova/backups; APP=/opt/nova/app
tar --exclude=./node_modules -C $APP -czf $B/app-$TS-pre-<版本>.tgz .
cp -a $APP/.env $B/env.bak-$TS-pre-<版本>
# 数据库用 VACUUM INTO 做一致快照（不要直接 cp 正在写的 WAL 库）
cd $APP && sudo -u nova node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/opt/nova/data/nova.db').exec(\"VACUUM INTO '$B/nova.db.bak-$TS-pre-<版本>'\")"
```

用 `PRAGMA integrity_check` 检查快照结果是否为 `ok`。

## 2. 预演迁移

迁移在服务启动时由 `server/db.mjs` 的 `openDb()` 自动执行（`server/migrations/*.sql`，按文件名顺序，记在 `schema_migrations`）。
上线前先在快照副本上跑一遍：

```sh
S=/opt/nova/stage-<版本>; mkdir -p $S && tar xzf vexo-server-<版本>-<sha>.tar.gz -C $S && chown -R nova:nova $S
ln -sfn /opt/nova/app/node_modules $S/node_modules      # sharp 等依赖在这里
cp $B/nova.db.bak-$TS-pre-<版本> /tmp/mig.db && chown nova /tmp/mig.db
cd $S && sudo -u nova node -e "import('./server/db.mjs').then(m=>{const d=m.openDb('/tmp/mig.db');console.log(d.prepare('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 3').all())})"
```

| 版本 | 迁移 | 内容 |
|---|---|---|
| 2.0.0 | `051_v2.sql` | users 加 badge / badge_at / deleted_at / follower_bonus；polls 加 deleted_at / removed_reason；新表 activities、activity_signups、exchange_posts、dm_grants、projects、project_members、project_tasks、project_posts、user_tags |

## 3. 副本冒烟（推荐）

用生产 `.env`（只在内存里读）在副本库上起一个临时实例（另开端口，如 8899），把注册、登录、动态、评论、好友、私聊、社区、通知和新功能都走一遍，并查看 `ai_moderation_log` 最近几条记录的 `model`（应为 `glm-4-flash`）。
测完按 **PID** 停掉临时实例，不要用 `pkill -f server/index.mjs`，它会匹配到生产进程。删除 stage 目录和副本库。

## 4. 覆盖代码并重启

```sh
for d in server scripts docs src; do cp -a $S/$d/. $APP/$d/; done
cp -a $S/package.json $S/CHANGELOG.md $APP/; cp -a $S/dist/index.html $S/dist/nova_v5.html $APP/dist/
chown -R nova:nova $APP/server $APP/scripts $APP/docs $APP/src $APP/dist $APP/package.json $APP/CHANGELOG.md
sed -i "s/^NOVA_GIT_COMMIT=.*/NOVA_GIT_COMMIT=<完整提交号>/" $APP/.env
systemctl restart nova
for i in $(seq 30); do sleep 1; curl -sf http://127.0.0.1:8787/api/health && break; done
```

不覆盖 `.env`、`data/`、`node_modules/`。

### .env 要求

- AI 审查（智谱 glm-4-flash，免费；**不用 DeepSeek**）：2.x 读取 `ZHIPU_API_KEY`（或 `AI_API_KEY`），默认接口为 `https://open.bigmodel.cn/api/paas/v4`。
  旧版读的是 `GROQ_API_KEY` / `GROQ_API_BASE`，2.0.0 上线时已在生产 `.env` 补了 `ZHIPU_API_KEY`（值同旧的 key），旧两行保留不影响。
  可选：`AI_MODEL`、`AI_API_BASE`、`AI_RPM`（默认 25）、`AI_RPD`（默认 900）。
- 2.0.1 新增的 AI 功能（翻译、技能匹配、官方助手）共用同一个 key 和总额度，另有每人限额，见 CHANGELOG。

## 5. 线上检查

- `curl -s http://127.0.0.1:8787/api/health`：`version`、`commit` 应为新版本，`db: ok`
- 新接口不带登录时应返回 401（例如 `/api/exchange`、`/api/projects`），不能是 404
- `journalctl -u nova --since "-5 min" | grep -i error` 应为空
- nginx 5xx 计数：`awk '$9>=500' /var/log/nginx/access.log | tail`

失败时立即回滚（见下文）。

## 6. 热更新包与清单

包由 `node scripts/build.mjs --api-base=https://47.239.0.90 --disable-demo --update-manifest-url=https://47.239.0.90/updates/user/manifest.json`
加 `node scripts/make-bundle.mjs --games-base=https://47.239.0.90/updates/user/games/` 生成。缺少部署配置时脚本拒绝出包。

```sh
scp vexo-<版本>-<sha>.zip root@47.239.0.90:/opt/nova/updates/user/bundles/
chown root:www-data .../bundles/vexo-<版本>-<sha>.zip && chmod 644 ...
curl -sk https://47.239.0.90/updates/user/bundles/vexo-<版本>-<sha>.zip | sha256sum    # 必须与暂存的 .sha256 一致，大小一致
cd /opt/nova/updates/user && cp -a manifest.json manifest.json.bak-$(date +%Y%m%d-%H%M%S)-pre-<版本>
# 先写临时文件再 mv（原子替换），属主 root:www-data，权限 640
```

清单格式：

```json
{"version":"2.0.0","url":"https://47.239.0.90/updates/user/bundles/vexo-2.0.0-030fb9e.zip","checksum":"<sha256>","sha256":"<sha256>"}
```

iOS 更新插件（capgo 7.53）整个下载约有 25 秒上限。包现在约 1.35MB；包变大以后要留意，下载不完就改发安装包。

## 7. 确认手机下载完整

```sh
grep -E "CapacitorUpdater|111\.16\.201\.80" /var/log/nginx/access.log | grep "vexo-<版本>"
# 期望：... "GET /updates/user/bundles/vexo-<版本>-<sha>.zip HTTP/2.0" 200 <完整字节数> "-" "CapacitorUpdater/7.53.0 ..."
```

## 回滚

先回滚清单（不再推新包），再回滚服务器。已经装上新包的手机不会自动退回旧包。

```sh
cp -a /opt/nova/updates/user/manifest.json.bak-<TS>-pre-<版本> /opt/nova/updates/user/manifest.json

B=/opt/nova/backups; T=<备份时间戳>
systemctl stop nova
tar xzf $B/app-$T-pre-<版本>.tgz -C /opt/nova/app
cp -a $B/env.bak-$T-pre-<版本> /opt/nova/app/.env
rm -f /opt/nova/data/nova.db-wal /opt/nova/data/nova.db-shm
cp $B/nova.db.bak-$T-<快照名> /opt/nova/data/nova.db
chown nova:nova /opt/nova/data/nova.db /opt/nova/app/.env
systemctl start nova && curl -s http://127.0.0.1:8787/api/health
```

回滚数据库会丢掉快照之后写入的数据；只有迁移本身出问题时才回滚库，代码问题只回滚代码即可（新增的列和表对旧代码无害）。

### 2.0.0 的备份（2026-11-15）

- 应用：`/opt/nova/backups/app-20261115-010248-pre-2.0.0.tgz`
- `.env`：`/opt/nova/backups/env.bak-20261115-010248-pre-2.0.0`
- 数据库：`nova.db.bak-20261115-010248-pre-2.0.0`，以及重启前的快照 `nova.db.bak-20261115-010248-swap-pre-2.0.0`
- 清单：`/opt/nova/updates/user/manifest.json.bak-20261115-011108-pre-2.0.0`（1.0.7）
