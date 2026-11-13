#!/usr/bin/env bash
# Verify an unsigned IPA or a debug APK and that the bundled web assets
# contain the expected update manifest URL (and user version).
# Usage: verify-v2-package.sh <ipa|apk> <file> <user|admin> <expected-url>
set -euo pipefail

KIND="${1:?ipa or apk}"
FILE="${2:?package path}"
APP="${3:?user or admin}"
URL="${4:?expected manifest URL}"

[ -f "$FILE" ] || { echo "ERROR: missing $FILE" >&2; exit 1; }
ls -lh "$FILE"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

if [ "$KIND" = "ipa" ]; then
  unzip -l "$FILE" | head -40
  unzip -q "$FILE" -d "$STAGE"
  APPDIR="$(find "$STAGE/Payload" -maxdepth 1 -name '*.app' -type d | head -1)"
  [ -n "$APPDIR" ] && [ -d "$APPDIR" ] || { echo "ERROR: no Payload/*.app" >&2; exit 1; }
  echo "==> app bundle: $APPDIR"
  [ -f "$APPDIR/Info.plist" ] || { echo "ERROR: no Info.plist" >&2; exit 1; }
  EXEC=""
  if command -v plutil >/dev/null 2>&1; then
    EXEC="$(plutil -extract CFBundleExecutable raw "$APPDIR/Info.plist" 2>/dev/null || true)"
  elif command -v PlistBuddy >/dev/null 2>&1; then
    EXEC="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APPDIR/Info.plist" 2>/dev/null || true)"
  fi
  if [ -z "$EXEC" ]; then
    # fallback
    if [ -f "$APPDIR/App" ]; then EXEC=App; fi
  fi
  [ -n "$EXEC" ] && [ -f "$APPDIR/$EXEC" ] || { echo "ERROR: missing executable (got '$EXEC')" >&2; ls -la "$APPDIR" | head; exit 1; }
  test -x "$APPDIR/$EXEC" || echo "WARN: executable bit not set on $EXEC"
  file "$APPDIR/$EXEC" || true
  WEB=""
  for d in "$APPDIR/public" "$APPDIR/www"; do
    if [ -d "$d" ]; then WEB="$d"; break; fi
  done
  [ -n "$WEB" ] || { echo "ERROR: no public/ or www/ web assets in .app" >&2; exit 1; }
  if ! grep -R -F -q -- "$URL" "$WEB"; then
    echo "ERROR: manifest URL not found in IPA web assets" >&2
    exit 1
  fi
  if [ "$APP" = "user" ]; then
    grep -R -F -q "0.7.0-m7.r6" "$WEB" || { echo "ERROR: user version not in IPA" >&2; exit 1; }
  fi
  echo "IPA_VERIFY_OK $FILE"
elif [ "$KIND" = "apk" ]; then
  unzip -l "$FILE" | head -40
  unzip -l "$FILE" | grep -q 'AndroidManifest.xml' || { echo "ERROR: no AndroidManifest.xml" >&2; exit 1; }
  unzip -q "$FILE" -d "$STAGE"
  [ -f "$STAGE/AndroidManifest.xml" ] || { echo "ERROR: AndroidManifest.xml missing after extract" >&2; exit 1; }
  # Prefer aapt/apksigner when the Android SDK is present.
  SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
  AAPT="$(find ${SDK:+"$SDK"} "$HOME/Android" /usr/local/lib/android /opt/android-sdk "$STAGE/../.." -name aapt2 -o -name aapt 2>/dev/null | head -1 || true)"
  APKSIGNER="$(find ${SDK:+"$SDK"} "$HOME/Android" /usr/local/lib/android /opt/android-sdk -name apksigner 2>/dev/null | head -1 || true)"
  if [ -n "$AAPT" ]; then
    echo "==> aapt: $AAPT"
    "$AAPT" dump badging "$FILE" | head -20 || "$AAPT" dump xmltree "$FILE" AndroidManifest.xml | head -20
  else
    echo "WARN: aapt not found; relied on zip listing + AndroidManifest.xml"
  fi
  if [ -n "$APKSIGNER" ]; then
    echo "==> apksigner: $APKSIGNER"
    "$APKSIGNER" verify --verbose "$FILE" || echo "WARN: apksigner verify returned $?"
  fi
  WEB=""
  for d in "$STAGE/assets/public" "$STAGE/assets/www" "$STAGE/assets"; do
    if [ -d "$d" ]; then WEB="$d"; break; fi
  done
  [ -n "$WEB" ] || { echo "ERROR: no assets/ web tree in APK" >&2; exit 1; }
  if ! grep -R -F -q -- "$URL" "$WEB"; then
    echo "ERROR: manifest URL not found in APK web assets" >&2
    exit 1
  fi
  if [ "$APP" = "user" ]; then
    grep -R -F -q "0.7.0-m7.r6" "$WEB" || { echo "ERROR: user version not in APK" >&2; exit 1; }
  fi
  echo "APK_VERIFY_OK $FILE"
else
  echo "KIND must be ipa or apk" >&2
  exit 2
fi
