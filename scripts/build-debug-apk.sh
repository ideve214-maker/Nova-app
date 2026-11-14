#!/usr/bin/env bash
# Build the ADMIN app DEBUG APK from a Capacitor project, signed with the
# fixed debug keystore so later builds install over earlier ones.
# Usage: build-debug-apk.sh <project-dir> <output.apk>
#
# Env:
#   APP_VERSION_NAME / APP_VERSION_CODE   e.g. 1.1.0 / 110 (required)
#   NOVA_DEBUG_KEYSTORE_FILE + NOVA_DEBUG_KEYSTORE_PASSWORD +
#   NOVA_DEBUG_KEY_ALIAS + NOVA_DEBUG_KEY_PASSWORD           (required)
#   NOVA_ADMIN_UPDATE_URL                                     (required)
#   ICON_BG (optional, only used when the app has no scripts/generate-capacitor-assets.sh)
#
# The user app (VEXO) is built with the pinned user commit's own
# scripts/build-debug-apk.sh, which uses the same keystore variables.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="${1:?project dir}"
OUT_APK="${2:?output apk path}"
[[ "$PROJ" = /* ]] || PROJ="$ROOT/$PROJ"
[[ "$OUT_APK" = /* ]] || OUT_APK="$ROOT/$OUT_APK"
: "${APP_VERSION_NAME:?APP_VERSION_NAME required}"
: "${APP_VERSION_CODE:?APP_VERSION_CODE required}"
: "${NOVA_ADMIN_UPDATE_URL:?NOVA_ADMIN_UPDATE_URL required}"
: "${NOVA_DEBUG_KEYSTORE_FILE:?NOVA_DEBUG_KEYSTORE_FILE required}"
: "${NOVA_DEBUG_KEYSTORE_PASSWORD:?NOVA_DEBUG_KEYSTORE_PASSWORD required}"
: "${NOVA_DEBUG_KEY_ALIAS:?NOVA_DEBUG_KEY_ALIAS required}"
: "${NOVA_DEBUG_KEY_PASSWORD:?NOVA_DEBUG_KEY_PASSWORD required}"
[ -s "$NOVA_DEBUG_KEYSTORE_FILE" ] || { echo "ERROR: keystore $NOVA_DEBUG_KEYSTORE_FILE missing" >&2; exit 1; }
export ADMIN_UPDATE_URL="$NOVA_ADMIN_UPDATE_URL" VITE_NOVA_UPDATE_URL="$NOVA_ADMIN_UPDATE_URL"
cd "$PROJ"

echo "==> $(pwd)  ->  $OUT_APK"
echo "==> node $(node -v)  npm $(npm -v)  java: $(java -version 2>&1 | head -1)"
test -d node_modules/@capacitor/android || { echo "ERROR: run prepare-v2-web.sh first" >&2; exit 1; }

echo "==> cap add android"
[ -d android ] || npx cap add android

# Icons + splash: only from resources/ (never the sibling assets/ dir), and
# any failure stops the build.
"$ROOT/scripts/generate-icons.sh" "$PROJ" android

echo "==> cap sync android"
npx cap sync android

echo "==> stamp version ${APP_VERSION_NAME} (${APP_VERSION_CODE})"
node "$ROOT/scripts/stamp-version.mjs" . --version-name "$APP_VERSION_NAME" --version-code "$APP_VERSION_CODE"

grep -F -q -- "$NOVA_ADMIN_UPDATE_URL" android/app/src/main/assets/capacitor.config.json || {
  echo "ERROR: admin update URL missing from android capacitor.config.json" >&2
  exit 1
}

# Backend is plain HTTP: make sure cleartext traffic is allowed.
MANIFEST="android/app/src/main/AndroidManifest.xml"
if ! grep -q 'usesCleartextTraffic' "$MANIFEST"; then
  sed -i 's|<application|<application android:usesCleartextTraffic="true"|' "$MANIFEST"
fi
grep -o 'android:usesCleartextTraffic="[^"]*"' "$MANIFEST"

# Fixed debug keystore (same mechanism as the user app's script).
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

echo "==> gradle assembleDebug"
(cd android && chmod +x gradlew && ./gradlew --no-daemon assembleDebug)

APK="android/app/build/outputs/apk/debug/app-debug.apk"
[ -f "$APK" ] || { echo "ERROR: $APK not found"; find android -name '*.apk'; exit 1; }
mkdir -p "$(dirname "$OUT_APK")"
cp "$APK" "$OUT_APK"
ls -lh "$OUT_APK"
echo "APK_OK $OUT_APK"
