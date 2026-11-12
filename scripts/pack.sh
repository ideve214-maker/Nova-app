#!/usr/bin/env bash
# 用法：scripts/pack.sh M2.4.1  → 生成 ../releases/NOVA_V7_M2.4.1_日期.zip
# ZIP 内含完整项目（源码、文档、Git 历史、构建产物），不含 node_modules 和数据库文件。
set -e
cd "$(dirname "$0")/.."
DIR="$(basename "$PWD")"
node scripts/build.mjs >/dev/null
OUT="NOVA_V7_${1}_$(date +%Y%m%d).zip"
mkdir -p ../releases && rm -f "../releases/$OUT"
cd .. && zip -qr "releases/$OUT" "$DIR" -x '*/node_modules/*' '*.db' '*.db-wal' '*.db-shm' '*/.DS_Store'
echo "releases/$OUT"; unzip -tq "releases/$OUT" | tail -1
