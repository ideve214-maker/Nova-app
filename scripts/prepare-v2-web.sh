#!/usr/bin/env bash
# Install JS deps, add Capacitor tooling matching @capacitor/core, and build
# the web assets that go into the native shell.
# Usage: prepare-v2-web.sh <user|admin> <project-dir>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:?user or admin}"
PROJ="${2:?project dir}"
cd "$ROOT/$PROJ"

echo "==> prepare-v2-web $APP  $(pwd)"
echo "==> node $(node -v)  npm $(npm -v)"

if [ "$APP" = "user" ]; then
  : "${USER_UPDATE_URL:?USER_UPDATE_URL is required}"
  : "${USER_API_BASE:=https://47.239.0.90}"
elif [ "$APP" = "admin" ]; then
  : "${ADMIN_UPDATE_URL:?ADMIN_UPDATE_URL is required}"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    echo "::add-mask::${ADMIN_UPDATE_URL}"
  fi
else
  echo "APP must be user or admin" >&2
  exit 2
fi

echo "==> npm install"
npm install --no-audit --no-fund

CAP_VER="$(node -p "require('@capacitor/core/package.json').version")"
echo "==> Capacitor core ${CAP_VER}; installing cli / ios / android / assets"
# Save to package.json so a later "npm install" in the native build
# scripts does not prune these (npm removes --no-save packages).
npm install --no-audit --no-fund --save-dev \
  "@capacitor/cli@${CAP_VER}" \
  "@capacitor/ios@${CAP_VER}" \
  "@capacitor/android@${CAP_VER}" \
  "@capacitor/assets@3.0.5"

if [ "$APP" = "user" ]; then
  mkdir -p resources
  # @capacitor/assets 默认读项目根目录的 assets/（皮肤和小游戏），会生成默认图标。
  # 图标和启动图放在 resources/，生成时必须带 --assetPath resources。
  copy_asset() { if [ -f "$1" ]; then cp -f "$1" "$2"; fi; }
  copy_asset capacitor/resources/icon.png resources/icon.png
  copy_asset capacitor/resources/icon-only.png resources/icon-only.png
  copy_asset capacitor/resources/icon-foreground.png resources/icon-foreground.png
  copy_asset capacitor/resources/icon-background.png resources/icon-background.png
  if [ ! -f resources/icon.png ] && [ -f capacitor/resources/icon/icon-1024.png ]; then
    cp -f capacitor/resources/icon/icon-1024.png resources/icon.png
  fi
  copy_asset capacitor/resources/splash.png resources/splash.png
  copy_asset capacitor/resources/splash-dark.png resources/splash-dark.png
  copy_asset capacitor/resources/splash-light.png resources/splash-light.png
  if [ ! -f resources/splash.png ] && [ -f capacitor/resources/splash/splash-dark.png ]; then
    cp -f capacitor/resources/splash/splash-dark.png resources/splash.png
  fi
  if [ ! -f resources/splash-dark.png ] && [ -f resources/splash.png ]; then
    cp -f resources/splash.png resources/splash-dark.png
  fi
  test -f resources/icon.png || { echo "ERROR: resources/icon.png missing" >&2; exit 1; }
  test -f resources/splash.png || { echo "ERROR: resources/splash.png missing" >&2; exit 1; }
  if [ -d android ] || [ -d ios ]; then
    npx capacitor-assets generate --assetPath resources \
      --iconBackgroundColor '#000000' --iconBackgroundColorDark '#000000' \
      --splashBackgroundColor '#000000' --splashBackgroundColorDark '#000000'
  fi

  echo "==> node scripts/build.mjs --api-base=${USER_API_BASE} --disable-demo --update-manifest-url=<user>"
  node scripts/build.mjs \
    --api-base="$USER_API_BASE" \
    --disable-demo \
    --update-manifest-url="$USER_UPDATE_URL"

  test -f dist/index.html
  VER="$(node -p "require('./package.json').version")"
  grep -F -q "$USER_UPDATE_URL" dist/index.html || {
    echo "ERROR: user manifest URL not present in dist/index.html" >&2
    exit 1
  }
  grep -F -q "$VER" dist/index.html || {
    echo "ERROR: user version $VER not present in dist/index.html" >&2
    exit 1
  }
  echo "USER_WEB_OK $(wc -c < dist/index.html) bytes version=$VER"
else
  export VITE_NOVA_UPDATE_URL="$ADMIN_UPDATE_URL"
  echo "==> npm run build:spa (VITE_NOVA_UPDATE_URL set)"
  npm run build:spa
  test -f dist-spa/index.html
  if ! grep -R -F -q -- "$ADMIN_UPDATE_URL" dist-spa; then
    echo "ERROR: admin update URL not present in dist-spa" >&2
    exit 1
  fi
  echo "ADMIN_WEB_OK"
fi
