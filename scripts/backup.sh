#!/usr/bin/env bash
# 生产备份与恢复（VACUUM INTO 一致性快照）。
# 备份：scripts/backup.sh backup
# 恢复：scripts/backup.sh restore /opt/nova/backups/nova-YYYYMMDD-HHMMSS.db
# 环境：NOVA_DB、NOVA_BACKUP_DIR、NOVA_BACKUP_KEEP、NOVA_SERVICE（systemd 单元名，默认 nova）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export NOVA_DB="${NOVA_DB:-/opt/nova/data/nova.db}"
export NOVA_BACKUP_DIR="${NOVA_BACKUP_DIR:-/opt/nova/backups}"
export NOVA_BACKUP_KEEP="${NOVA_BACKUP_KEEP:-14}"
SERVICE="${NOVA_SERVICE:-nova}"
NODE="${NODE:-node}"

cmd="${1:-backup}"
case "$cmd" in
  backup)
    mkdir -p "$NOVA_BACKUP_DIR"
    "$NODE" "$ROOT/scripts/backup.mjs" backup --db "$NOVA_DB" --dir "$NOVA_BACKUP_DIR" --keep "$NOVA_BACKUP_KEEP"
    ;;
  restore)
    src="${2:-}"
    if [ -z "$src" ]; then
      echo "用法：$0 restore /opt/nova/backups/nova-YYYYMMDD-HHMMSS.db" >&2
      exit 1
    fi
    if [ ! -f "$src" ]; then
      echo "找不到备份：$src" >&2
      exit 1
    fi
    if command -v systemctl >/dev/null 2>&1 && [ "${NOVA_SKIP_SERVICE:-}" != "1" ]; then
      echo "停止 $SERVICE …"
      sudo systemctl stop "$SERVICE"
    else
      echo "未调用 systemctl（NOVA_SKIP_SERVICE=1 或本机没有 systemd）。请确认没有进程正在占用 $NOVA_DB。"
    fi
    "$NODE" "$ROOT/scripts/backup.mjs" restore --from "$src" --db "$NOVA_DB"
    if command -v systemctl >/dev/null 2>&1 && [ "${NOVA_SKIP_SERVICE:-}" != "1" ]; then
      echo "启动 $SERVICE …"
      sudo systemctl start "$SERVICE"
      sudo systemctl --no-pager --lines=20 status "$SERVICE" || true
    fi
    ;;
  *)
    echo "用法：$0 backup | restore <备份文件>" >&2
    exit 1
    ;;
esac
