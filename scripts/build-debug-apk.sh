#!/usr/bin/env bash
# Build a DEBUG APK (debug-keystore signed, installable for testing) from a Capacitor project.
# Usage: build-debug-apk.sh <project-dir> <output.apk>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="${1:?project dir}"
OUT_APK="${2:?output apk path}"
[[ "$OUT_APK" != /* ]] && OUT_APK="$ROOT/$OUT_APK"
cd "$ROOT/$PROJ"

echo "==> $(pwd)  ->  $OUT_APK"
echo "==> node $(node -v)  npm $(npm -v)  java: $(java -version 2>&1 | head -1)"

echo "==> npm install (+ @capacitor/cli and @capacitor/android matching core)"
npm install --no-audit --no-fund
CAP_VER="$(node -p "require('@capacitor/core/package.json').version")"
npm install --no-audit --no-fund --save-dev "@capacitor/cli@${CAP_VER}" "@capacitor/android@${CAP_VER}" "@capacitor/assets@3.0.5"

echo "==> cap add android"
npx cap add android

echo "==> capacitor-assets (android icons/splash) --assetPath resources"
mkdir -p www
[ -f www/manifest.json ] || echo '{}' > www/manifest.json
npx capacitor-assets generate --android --assetPath resources \
  --iconBackgroundColor '#000000' --iconBackgroundColorDark '#000000' \
  --splashBackgroundColor '#000000' --splashBackgroundColorDark '#000000'

echo "==> cap sync android"
npx cap sync android

echo "==> stamp version 1.0.0 and coarse location only"
node "$ROOT/scripts/stamp-native.mjs" .

# Backend is plain HTTP: make sure cleartext traffic is allowed.
MANIFEST="android/app/src/main/AndroidManifest.xml"
if ! grep -q 'usesCleartextTraffic' "$MANIFEST"; then
  sed -i 's|<application|<application android:usesCleartextTraffic="true"|' "$MANIFEST"
fi
grep -o 'android:usesCleartextTraffic="[^"]*"' "$MANIFEST"

echo "==> gradle assembleDebug"
(cd android && chmod +x gradlew && ./gradlew --no-daemon assembleDebug)

APK="android/app/build/outputs/apk/debug/app-debug.apk"
[ -f "$APK" ] || { echo "ERROR: $APK not found"; find android -name '*.apk'; exit 1; }
mkdir -p "$(dirname "$OUT_APK")"
cp "$APK" "$OUT_APK"
ls -lh "$OUT_APK"
echo "APK_OK $OUT_APK"
