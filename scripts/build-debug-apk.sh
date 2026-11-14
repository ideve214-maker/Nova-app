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

# Fixed debug keystore (so later builds install over earlier ones).
# Set NOVA_DEBUG_KEYSTORE_FILE (+ _PASSWORD, _KEY_ALIAS, _KEY_PASSWORD) to use it.
if [ -n "${NOVA_DEBUG_KEYSTORE_FILE:-}" ]; then
  : "${NOVA_DEBUG_KEYSTORE_PASSWORD:?NOVA_DEBUG_KEYSTORE_PASSWORD required}"
  : "${NOVA_DEBUG_KEY_ALIAS:?NOVA_DEBUG_KEY_ALIAS required}"
  : "${NOVA_DEBUG_KEY_PASSWORD:?NOVA_DEBUG_KEY_PASSWORD required}"
  [ -s "$NOVA_DEBUG_KEYSTORE_FILE" ] || { echo "ERROR: keystore $NOVA_DEBUG_KEYSTORE_FILE missing"; exit 1; }
  if ! grep -q 'NOVA_DEBUG_KEYSTORE_FILE' android/app/build.gradle; then
    cat >> android/app/build.gradle <<'GRADLE'

android {
    signingConfigs {
        debug {
            storeFile file(System.getenv("NOVA_DEBUG_KEYSTORE_FILE"))
            storePassword System.getenv("NOVA_DEBUG_KEYSTORE_PASSWORD")
            keyAlias System.getenv("NOVA_DEBUG_KEY_ALIAS")
            keyPassword System.getenv("NOVA_DEBUG_KEY_PASSWORD")
        }
    }
    buildTypes { debug { signingConfig signingConfigs.debug } }
}
GRADLE
  fi
  echo "==> signing with fixed debug keystore"
fi

echo "==> gradle assembleDebug"
(cd android && chmod +x gradlew && ./gradlew --no-daemon assembleDebug)

APK="android/app/build/outputs/apk/debug/app-debug.apk"
[ -f "$APK" ] || { echo "ERROR: $APK not found"; find android -name '*.apk'; exit 1; }
mkdir -p "$(dirname "$OUT_APK")"
cp "$APK" "$OUT_APK"
ls -lh "$OUT_APK"
echo "APK_OK $OUT_APK"
