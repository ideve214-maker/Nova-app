#!/usr/bin/env bash
# Launcher icons and splash screens come only from admin/resources.
# capacitor-assets prefers a sibling assets/ directory unless --assetPath is set,
# which would ignore resources/icon.png and ship the default icon.
# This step must fail the build when generation fails. Do not continue.
set -euo pipefail
cd "$(dirname "$0")/.."

# Refuse to fall back to anything else (icon-masked.png, icon.svg or Capacitor defaults).
for f in resources/icon.png resources/splash.png resources/splash-dark.png; do
  if [[ ! -s "$f" ]]; then
    echo "[vexo-admin] missing $f; refusing to generate launcher assets" >&2
    exit 1
  fi
done

if [[ ! -d android ]]; then
  npx cap add android
fi
if [[ ! -d ios ]]; then
  npx cap add ios
fi

npx @capacitor/assets generate --android --ios --assetPath resources \
  --iconBackgroundColor '#05070E' \
  --splashBackgroundColor '#05070E'

# The generator must have written the launcher icons; otherwise fail the build.
for f in android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png \
         ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png; do
  if [[ ! -s "$f" ]]; then
    echo "[vexo-admin] $f was not generated" >&2
    exit 1
  fi
  if [[ "$f" -ot resources/icon.png ]]; then
    echo "[vexo-admin] $f is older than resources/icon.png (not regenerated)" >&2
    exit 1
  fi
done

node scripts/apply-native-version.mjs
node scripts/strip-fine-location.mjs
