#!/usr/bin/env bash
# Sideload GastosDiarios (iOS app + the embedded watchOS app) onto a physically
# connected iPhone using the free personal signing team — no Xcode UI needed.
#
# Usage:
#   ./install-device.sh          # auto-detect the connected iPhone
#   ./install-device.sh <UDID>   # target a specific device
#
# Notes:
#   • The watch app is embedded in the iOS app; installing the phone app makes
#     it available on the paired watch (enable it in the iPhone's Watch app if
#     it doesn't auto-install).
#   • Free-team signing expires after ~7 days — just re-run this to refresh.
set -euo pipefail
cd "$(dirname "$0")"

SCHEME="GastosDiarios"
PROJECT="GastosDiarios.xcodeproj"
DD="build-device"

# 1) Resolve the target device UDID (arg overrides auto-detection).
UDID="${1:-}"
if [ -z "$UDID" ]; then
  UDID=$(xcrun xctrace list devices 2>/dev/null \
    | awk '/^== Simulators ==/{exit} {print}' \
    | grep -i "iphone" \
    | head -1 \
    | sed -E 's/.*\(([^)]+)\)[[:space:]]*$/\1/')
fi
if [ -z "$UDID" ]; then
  echo "✗ No connected iPhone found. Plug it in, unlock it, and tap 'Trust'."
  echo "  List devices with:  xcrun devicectl list devices"
  echo "  Then re-run:        ./install-device.sh <UDID>"
  exit 1
fi
echo "→ Target device: $UDID"

# 2) Keep the generated project in sync, then build + sign for the device.
if command -v xcodegen >/dev/null 2>&1; then xcodegen >/dev/null; fi

echo "→ Building and signing (free team, may take a minute)…"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Debug \
  -destination "platform=iOS,id=$UDID" \
  -derivedDataPath "$DD" \
  -allowProvisioningUpdates \
  build

APP="$DD/Build/Products/Debug-iphoneos/$SCHEME.app"
[ -d "$APP" ] || { echo "✗ Build product not found at $APP"; exit 1; }

# 3) Install to the device (the embedded watch app rides along).
echo "→ Installing to device…"
xcrun devicectl device install app --device "$UDID" "$APP"

cat <<'EOF'

✓ Installed. Next steps:
  • First time only — iPhone: Settings → General → VPN & Device Management
    → trust your Apple ID developer certificate.
  • iPhone: open the Watch app → Gastos Diarios → turn on "Show App on
    Apple Watch" if it didn't auto-install.
  • Sign in with Google on the phone app (the watch relays writes through it).
  • Free-team signing lasts ~7 days — re-run this script to refresh.
EOF
