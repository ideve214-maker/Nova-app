#!/usr/bin/env bash
# Build the ADMIN app UNSIGNED device IPA from a Capacitor project directory.
# Usage: build-unsigned-ipa.sh <project-dir> <output.ipa>
#
# Env: APP_VERSION_NAME / APP_VERSION_CODE (required), NOVA_ADMIN_UPDATE_URL (required).
# The user app (VEXO) is built with the pinned user commit's own script.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJ="${1:?project dir}"
OUT_IPA="${2:?output ipa path}"
[[ "$PROJ" = /* ]] || PROJ="$ROOT/$PROJ"
[[ "$OUT_IPA" = /* ]] || OUT_IPA="$ROOT/$OUT_IPA"
: "${APP_VERSION_NAME:?APP_VERSION_NAME required}"
: "${APP_VERSION_CODE:?APP_VERSION_CODE required}"
: "${NOVA_ADMIN_UPDATE_URL:?NOVA_ADMIN_UPDATE_URL required}"
export ADMIN_UPDATE_URL="$NOVA_ADMIN_UPDATE_URL" VITE_NOVA_UPDATE_URL="$NOVA_ADMIN_UPDATE_URL"
cd "$PROJ"

echo "==> $(pwd)  ->  $OUT_IPA"
echo "==> node $(node -v)  npm $(npm -v)"
xcodebuild -version
test -d node_modules/@capacitor/ios || { echo "ERROR: run prepare-v2-web.sh first" >&2; exit 1; }

echo "==> cap add ios"
[ -d ios ] || npx cap add ios

# Icons + splash only from resources/; any failure stops the build.
"$ROOT/scripts/generate-icons.sh" "$PROJ" ios

echo "==> cap sync ios"
npx cap sync ios

echo "==> stamp version ${APP_VERSION_NAME} (${APP_VERSION_CODE})"
node "$ROOT/scripts/stamp-version.mjs" . --version-name "$APP_VERSION_NAME" --version-code "$APP_VERSION_CODE"

grep -F -q -- "$NOVA_ADMIN_UPDATE_URL" ios/App/App/capacitor.config.json || {
  echo "ERROR: admin update URL missing from ios capacitor.config.json" >&2
  exit 1
}

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

# CocoaPods: .xcworkspace is a BUNDLE (directory). Never test it with [ -f ].
if [ -f ios/App/Podfile ]; then
  echo "==> pod install (ios/App)"
  (cd ios/App && pod install)
fi

if [ -e ios/App/App.xcworkspace ]; then
  XCODE_PROJ=(-workspace ios/App/App.xcworkspace)
elif [ -e ios/App.xcworkspace ]; then
  XCODE_PROJ=(-workspace ios/App.xcworkspace)
elif [ -e ios/App/App.xcodeproj ]; then
  XCODE_PROJ=(-project ios/App/App.xcodeproj)
else
  echo "ERROR: no Xcode workspace or project under ios/"
  find ios -maxdepth 3 -print
  exit 1
fi
echo "==> using xcodebuild ${XCODE_PROJ[*]}"
ls -ld ios/App/App.xcworkspace ios/App/App.xcodeproj ios/App/Pods 2>/dev/null || true

SCHEME=App
DERIVED="$PWD/derived"
ARCHIVE="$PWD/build/App.xcarchive"
mkdir -p "$PWD/build"
rm -rf "$DERIVED" "$ARCHIVE"
mkdir -p "$DERIVED"

# Unsigned + disable Xcode 16+/26 Swift explicit modules (breaks CocoaPods modules)
SIGN_FLAGS=(
  CODE_SIGNING_ALLOWED=NO
  CODE_SIGNING_REQUIRED=NO
  CODE_SIGN_IDENTITY=
  DEVELOPMENT_TEAM=
  PROVISIONING_PROFILE_SPECIFIER=
  SKIP_INSTALL=NO
  SWIFT_ENABLE_EXPLICIT_MODULES=NO
  COMPILER_INDEX_STORE_ENABLE=NO
)

# No MARKETING_VERSION / CURRENT_PROJECT_VERSION override on the xcodebuild
# command line: versions come only from stamp-version.mjs above.

LOG="$PWD/build/xcodebuild.log"

app_is_complete() {
  local APP="$1"
  [ -n "$APP" ] && [ -d "$APP" ] || return 1
  [ -f "$APP/Info.plist" ] || return 1
  local exec_name
  exec_name="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Info.plist" 2>/dev/null || true)"
  if [ -n "$exec_name" ] && [ -f "$APP/$exec_name" ]; then
    return 0
  fi
  # fallback: any Mach-O executable besides Info.plist
  [ -f "$APP/App" ] && return 0
  return 1
}

find_app() {
  local found="" c
  for c in \
    "$ARCHIVE"/Products/Applications/*.app \
    "$DERIVED"/Build/Intermediates.noindex/ArchiveIntermediates/App/InstallationBuildProductsLocation/Applications/*.app \
    "$DERIVED"/Build/Products/Release-iphoneos/*.app
  do
    if app_is_complete "$c"; then
      found="$c"
      break
    fi
  done
  if [ -z "$found" ]; then
    while IFS= read -r c; do
      if app_is_complete "$c"; then
        found="$c"
        break
      fi
    done < <(find "$ARCHIVE" "$DERIVED" -name '*.app' -type d 2>/dev/null | grep -v -i simulator | grep -v iphonesimulator || true)
  fi
  printf '%s' "$found"
}

package_ipa() {
  local APP="$1"
  local DEST="$2"
  if ! app_is_complete "$APP"; then
    echo "ERROR: complete .app not found (need Info.plist + executable)"
    find "$DERIVED" "$PWD/build" -name '*.app' -type d | head -50
    return 1
  fi
  echo "==> packaging $APP  ($(du -sh "$APP" | awk '{print $1}'))"
  ls -la "$APP" | head
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist" || true
  /usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$APP/Info.plist" || true
  /usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Info.plist" || true
  /usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity' "$APP/Info.plist" || true
  local STAGE
  STAGE="$(mktemp -d)"
  mkdir -p "$STAGE/Payload"
  cp -a "$APP" "$STAGE/Payload/"
  mkdir -p "$(dirname "$DEST")"
  (cd "$STAGE" && zip -qry "$DEST" Payload)
  ls -lh "$DEST"
  # sanity: IPA is a zip with Payload/*.app
  unzip -l "$DEST" | head -20
  echo "IPA_OK $DEST"
}

echo "==> xcodebuild archive (unsigned, workspace-aware)"
set +e
xcodebuild archive \
  "${XCODE_PROJ[@]}" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -derivedDataPath "$DERIVED" \
  "${SIGN_FLAGS[@]}" \
  2>&1 | tee "$LOG"
ARC_RC=${PIPESTATUS[0]}
set -e
echo "archive exit: $ARC_RC"
# keep the last 40 lines visible
tail -n 40 "$LOG" || true

APP="$(find_app)"
if [ "$ARC_RC" -ne 0 ] || ! app_is_complete "$APP"; then
  echo "==> archive did not produce a complete .app, falling back to xcodebuild build"
  set +e
  xcodebuild build \
    "${XCODE_PROJ[@]}" \
    -scheme "$SCHEME" \
    -configuration Release \
    -sdk iphoneos \
    -destination 'generic/platform=iOS' \
    -derivedDataPath "$DERIVED" \
    "${SIGN_FLAGS[@]}" \
    2>&1 | tee "$LOG"
  BLD_RC=${PIPESTATUS[0]}
  set -e
  echo "build exit: $BLD_RC"
  tail -n 40 "$LOG" || true
  APP="$(find_app)"
  if [ "$BLD_RC" -ne 0 ] || ! app_is_complete "$APP"; then
    echo "ERROR: unsigned build failed"
    grep -E "error:|ERROR:|fatal|unable to resolve" "$LOG" | head -40 || true
    exit 1
  fi
fi

if [[ "$OUT_IPA" != /* ]]; then
  OUT_IPA="$ROOT/$OUT_IPA"
fi
package_ipa "$APP" "$OUT_IPA"
