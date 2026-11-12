#!/usr/bin/env bash
# 用法：scripts/pack.sh M1 名称  → 生成 ../releases/NOVA_V5_M1_名称_日期.zip（含完整源码、文档、Git 历史、构建产物）
set -e
cd "$(dirname "$0")/.."
node scripts/build.mjs >/dev/null
OUT="../releases/NOVA_V5_${1}_${2}_$(date +%Y%m%d).zip"
mkdir -p ../releases && rm -f "$OUT"
cd .. && zip -qr "releases/$(basename "$OUT")" NOVA_V5 -x '*/node_modules/*' '*/.DS_Store'
echo "$OUT"; unzip -tq "releases/$(basename "$OUT")" | tail -1
