#!/usr/bin/env bash
# Launcher icons and splash screens come only from admin/resources.
# capacitor-assets prefers a sibling assets/ directory unless --assetPath is set,
# which would ignore resources/icon.png and ship the default icon.
# This step must fail the build when generation fails. Do not continue.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -d android ]]; then
  npx cap add android
fi
if [[ ! -d ios ]]; then
  npx cap add ios
fi

npx @capacitor/assets generate --android --ios --assetPath resources \
  --iconBackgroundColor '#05070E' \
  --splashBackgroundColor '#05070E'

node scripts/apply-native-version.mjs
node scripts/strip-fine-location.mjs
