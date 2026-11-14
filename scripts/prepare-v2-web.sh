#!/usr/bin/env bash
# Build the ADMIN app web bundle (dist-spa) before the native shell is made.
# Usage: prepare-v2-web.sh admin <project-dir>
#
# The USER app (VEXO) is NOT prepared with this script any more: the build
# workflow runs scripts/prepare-v2-web.sh from the pinned user commit itself
# (Bob's v7-m7.r8-vexo line), which owns the user app's icons and versions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:?admin}"
PROJ="${2:?project dir}"
[[ "$PROJ" = /* ]] || PROJ="$ROOT/$PROJ"
cd "$PROJ"

if [ "$APP" != "admin" ]; then
  echo "ERROR: build/v2's prepare-v2-web.sh only prepares the admin app." >&2
  echo "       The user app uses scripts/prepare-v2-web.sh from the pinned user commit." >&2
  exit 2
fi

# The admin capacitor.config.ts reads NOVA_ADMIN_UPDATE_URL (or ADMIN_UPDATE_URL /
# VITE_NOVA_UPDATE_URL) and refuses to pack without it.
: "${NOVA_ADMIN_UPDATE_URL:=${ADMIN_UPDATE_URL:-}}"
if [ -z "$NOVA_ADMIN_UPDATE_URL" ]; then
  echo "ERROR: NOVA_ADMIN_UPDATE_URL is empty (repo secret NOVA_ADMIN_UPDATE_URL)." >&2
  exit 1
fi
if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::add-mask::${NOVA_ADMIN_UPDATE_URL}"; fi
export NOVA_ADMIN_UPDATE_URL ADMIN_UPDATE_URL="$NOVA_ADMIN_UPDATE_URL" VITE_NOVA_UPDATE_URL="$NOVA_ADMIN_UPDATE_URL"

echo "==> prepare admin web  $(pwd)"
echo "==> node $(node -v)  npm $(npm -v)"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

CAP_VER="$(node -p "require('@capacitor/core/package.json').version")"
echo "==> Capacitor core ${CAP_VER}; installing cli / ios / android / assets"
npm install --no-audit --no-fund --save-dev \
  "@capacitor/cli@${CAP_VER}" "@capacitor/ios@${CAP_VER}" \
  "@capacitor/android@${CAP_VER}" "@capacitor/assets@3.0.5"

echo "==> npm run build:spa"
npm run build:spa
test -f dist-spa/index.html
# The URL ends up in the native capacitor.config.json at `cap sync` time; the
# build scripts and verify-package.mjs check it there.
echo "ADMIN_WEB_OK version=$(node -p "require('./package.json').version")"
