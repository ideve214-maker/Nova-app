# r10 发布步骤（用户端 1.0.5 + 服务端 r10 + 管理端 1.1.2）

> 只有在负责人确认后才执行。本文件只写步骤，不会自动部署或发布。

## 0. 版本

| 部分 | 分支 | 版本 |
| --- | --- | --- |
| 用户端网页 + 服务端 | `fix/r10-user` | 1.0.5 |
| 管理端 | `fix/r10-admin` | 1.1.2 |

## 1. 服务器（47.239.0.90，`/opt/nova/app`，systemd 单元 `nova`）

1. 备份数据库：`sudo -u nova -E /opt/nova/app/scripts/backup.sh backup`
2. 同步代码，保留 `.env` 和 `data/`：
   `sudo rsync -a --delete --exclude .env --exclude data --exclude node_modules ./NOVA_r10/ /opt/nova/app/`
3. 在 `/opt/nova/app/.env` 里加一行 `GROQ_API_KEY=...`。可选：`GROQ_RPM`、`GROQ_RPD`。
   - 密钥只写在服务器上，不进 Git。
   - 不填也能运行，这时 AI 审查只走屏蔽词。
4. 构建网页：
   `cd /opt/nova/app && node scripts/build.mjs --api-base=https://47.239.0.90 --disable-demo --update-manifest-url=https://47.239.0.90/updates/user/manifest.json`
5. 重启：`sudo systemctl restart nova`。迁移 `045`–`049` 会在启动时自动执行。
6. 检查：
   - `curl -sk https://127.0.0.1/api/health` 应返回 `status: ok`，并且 `db: ok`。
   - 管理端「营销管理 → AI 审查」应显示“正常”，而不是“未配置”。
7. nginx 的 `client_max_body_size` 要保持在 50m 以上，否则营销素材（最大 30MB）上传会失败。
8. 证书：IP 证书 11 月 19 日到期，需要提前续期。

回滚：换回上一份发布包，然后 `systemctl restart nova`。新表不影响旧代码，不需要回滚数据库。

## 2. 用户端安装包

- **APK**：
  - 需要 GitHub 上的签名密钥 secret，所以只能在 Actions 里打包。
  - 先把 `fix/r10-user` 推到 GitHub，再手动运行工作流 “VEXO user package”。
  - 它会检出 `.github/workflows/user-r8.yml` 里 `USER_REF` 固定的 SHA。
  - 产物 `VEXO.apk` 在这次运行的 Artifacts 里。
- **IPA**：同一个工作流会生成未签名的 IPA。
- **热更新包**（可选）：
  - 在 `dist/` 构建完成后运行 `node scripts/make-bundle.mjs`，得到 `dist-bundles/nova-1.0.5.zip` 和 SHA-256。
  - 再按 `docs/hot-update.md` 更新清单。
  - **清单一改，已安装的用户就会收到更新**，必须先确认再改。

## 3. 下载入口与 GitHub Release

1. 把 APK 复制到服务器下载目录，文件名和以前一致。新文件先放好，确认能下载后再替换旧的链接。
2. 创建 GitHub Release：
   - 标签 `vexo-user-1.0.5`，指向 USER_REF 那个提交。
   - 附件：`VEXO.apk`、`VEXO_Admin.html`。
   - 说明直接用 CHANGELOG 里 1.0.5 的那一节。
3. 管理端网页版：用 `fix/r10-admin` 的 `admin/dist-spa/VEXO_Admin.html`（或 `dist-spa/index.html`）替换服务器上的管理端文件。
