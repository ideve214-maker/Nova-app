#!/usr/bin/env bash
# Build an UNSIGNED device IPA from a Capacitor project directory.
# Usage: build-unsigned-ipa.sh <project-dir> <output.ipa>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="${1:?project dir}"
OUT_IPA="${2:?output ipa path}"
cd "$ROOT/$PROJ"

echo "==> $(pwd)  ->  $OUT_IPA"
echo "==> node $(node -v)  npm $(npm -v)"
xcodebuild -version

echo "==> npm install"
# sharp (capacitor-assets) may need its install script
npm install --no-audit --no-fund

echo "==> cap add ios"
npx cap add ios

echo "==> capacitor-assets (ios icons/splash)"
# Dummy www/manifest.json so assets CLI does not fail on pwa (admin has no www)
mkdir -p www
if [ ! -f www/manifest.json ]; then echo '{}' > www/manifest.json; fi
npx capacitor-assets generate --iconBackgroundColor '#0A0C14' --splashBackgroundColor '#0A0C14' || {
  echo "WARN: capacitor-assets failed, continuing (cap add already drops default icons)"
}

echo "==> cap sync ios"
npx cap sync ios

INFO="ios/App/App/Info.plist"
if [ ! -f "$INFO" ]; then
  echo "ERROR: Info.plist not found at $INFO"
  ls -la ios/App/App || true
  find ios -name 'Info.plist' -print
  exit 1
fi

echo "==> set NSAppTransportSecurity NSAllowsArbitraryLoads=true"
python3 - <<PY
import plistlib
from pathlib import Path
p = Path("$INFO")
raw = p.read_bytes()
try:
    data = plistlib.loads(raw)
except Exception as e:
    raise SystemExit(f"failed to parse {p}: {e}")
ats = data.get("NSAppTransportSecurity")
if not isinstance(ats, dict):
    ats = {}
ats["NSAllowsArbitraryLoads"] = True
data["NSAppTransportSecurity"] = ats
# keep display name already set by Capacitor
p.write_bytes(plistlib.dumps(data, fmt=plistlib.FMT_XML))
print("Info.plist ATS:", data.get("NSAppTransportSecurity"))
print("CFBundleIdentifier:", data.get("CFBundleIdentifier"))
print("CFBundleDisplayName:", data.get("CFBundleDisplayName") or data.get("CFBundleName"))
PY

# Show resulting plist snippet
/usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity' "$INFO" || true

# Prefer workspace if CocoaPods created one
if [ -f ios/App/Podfile ]; then
  echo "==> pod install"
  (cd ios/App && pod install --silent)
fi

if [ -f ios/App/App.xcworkspace ] || [ -f ios/App/Pods/Manifest.lock ]; then
  if [ -f ios/App/App.xcworkspace ]; then
    XCODE_PROJ=(-workspace ios/App/App.xcworkspace)
  else
    XCODE_PROJ=(-project ios/App/App.xcodeproj)
  fi
else
  XCODE_PROJ=(-project ios/App/App.xcodeproj)
fi

SCHEME=App
DERIVED="$PWD/derived"
ARCHIVE="$PWD/build/App.xcarchive"
mkdir -p "$PWD/build" "$DERIVED"
rm -rf "$DERIVED" "$ARCHIVE"
mkdir -p "$DERIVED"

SIGN_FLAGS=(
  CODE_SIGNING_ALLOWED=NO
  CODE_SIGNING_REQUIRED=NO
  CODE_SIGN_IDENTITY=
  DEVELOPMENT_TEAM=
  PROVISIONING_PROFILE_SPECIFIER=
  SKIP_INSTALL=NO
)

echo "==> resolve Swift packages (if any)"
xcodebuild "${XCODE_PROJ[@]}" -scheme "$SCHEME" -resolvePackageDependencies \
  -derivedDataPath "$DERIVED" \
  -destination 'generic/platform=iOS' \
  || echo "WARN: resolvePackageDependencies returned $?"

# Shared log
LOG="$PWD/build/xcodebuild.log"
mkdir -p "$PWD/build"

find_app() {
  # Prefer archive product, then device Release build
  local found
  found="$(find "$ARCHIVE" "$DERIVED" -path '*/Applications/*.app' -type d 2>/dev/null | head -n 1 || true)"
  if [ -z "$found" ]; then
    found="$(find "$DERIVED" -path '*Release-iphoneos*.app' -type d 2>/dev/null | head -n 1 || true)"
  fi
  if [ -z "$found" ]; then
    found="$(find "$DERIVED" -name '*.app' -type d 2>/dev/null | grep -v Simulator | grep -v iphonesimulator | head -n 1 || true)"
  fi
  printf '%s' "$found"
}

package_ipa() {
  local APP="$1"
  local DEST="$2"
  if [ -z "$APP" ] || [ ! -d "$APP" ]; then
    echo "ERROR: .app not found"
    find "$DERIVED" "$PWD/build" -name '*.app' -o -name '*.xcarchive' | head -50
    return 1
  fi
  echo "==> packaging $APP  ($(du -sh "$APP" | awk '{print $1}'))"
  # Basic sanity
  ls -la "$APP" | head
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist" || true
  /usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$APP/Info.plist" || true
  /usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity' "$APP/Info.plist" || true
  local STAGE
  STAGE="$(mktemp -d)"
  mkdir -p "$STAGE/Payload"
  cp -a "$APP" "$STAGE/Payload/"
  # zip must have Payload at the root; .ipa is a zip
  mkdir -p "$(dirname "$DEST")"
  (cd "$STAGE" && zip -qry "$DEST" Payload)
  ls -lh "$DEST"
  echo "IPA_OK $DEST"
}

echo "==> xcodebuild archive (unsigned)"
set +e
xcodebuild archive \
  "${XCODE_PROJ[@]}" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -derivedDataPath "$DERIVED" \
  "${SIGN_FLAGS[@]}" \
  2>&1 | tee "$LOG" | tail -n 80
ARC_RC=${PIPESTATUS[0]}
set -e
echo "archive exit: $ARC_RC"

APP="$(find_app)"
if [ "$ARC_RC" -ne 0 ] || [ -z "$APP" ]; then
  echo "==> archive did not produce an .app, falling back to xcodebuild build"
  tail -n 80 "$LOG" || true
  set +e
  xcodebuild build \
    "${XCODE_PROJ[@]}" \
    -scheme "$SCHEME" \
    -configuration Release \
    -sdk iphoneos \
    -destination 'generic/platform=iOS' \
    -derivedDataPath "$DERIVED" \
    "${SIGN_FLAGS[@]}" \
    2>&1 | tee "$LOG" | tail -n 80
  BLD_RC=${PIPESTATUS[0]}
  set -e
  echo "build exit: $BLD_RC"
  APP="$(find_app)"
  if [ "$BLD_RC" -ne 0 ] || [ -z "$APP" ]; then
    echo "ERROR: unsigned build failed"
    tail -n 120 "$LOG" || true
    find "$DERIVED" -name '*.app' | head
    exit 1
  fi
fi

# Absolute output path
if [[ "$OUT_IPA" != /* ]]; then
  OUT_IPA="$ROOT/$OUT_IPA"
fi
package_ipa "$APP" "$OUT_IPA"
