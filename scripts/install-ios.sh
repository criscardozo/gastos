#!/usr/bin/env bash
#
# Build, re-sign and install the iPhone app — the whole procedure, so that none
# of it depends on remembering.
#
# Installing ALWAYS renews the signature. The free team reuses whatever
# provisioning profile already exists, so an ordinary build keeps the old expiry
# and reinstalling buys nothing: every install spends days off the same profile
# until the app stops opening. It is not a decision to make by looking at how
# long is left — looking is exactly what leads to skipping it.
#
# The three guards this exists for, each earned:
#
#   1. `xcodebuild ... | grep` returns GREP's exit code, so a failed build reads
#      as success. Verified: a bad scheme exits 65 on its own and 0 through the
#      pipe. Here the status is captured before anything is piped.
#   2. When the build fails the previous bundle is still on disk, so reading the
#      profile dates without checking the build first reports a renewal that
#      never happened.
#   3. A failed build with the profiles moved aside leaves the machine unable to
#      sign at all, so they go back on every FAILING exit path — and only those.
#      Restoring after a success would not restore anything: Xcode mints the new
#      profiles under new filenames, so the old pair would simply pile up, three
#      dead files per run. The trap is disarmed the moment the build is known to
#      have worked. (Measured: 12 profiles before a successful run, 12 after.)
#
# Usage: scripts/install-ios.sh [--device <udid>]

set -euo pipefail

DEVICE="${DEVICE_UDID:-B0ADA2A7-8B96-5DC9-9975-57075F17E0BB}"  # Kylo
if [[ "${1:-}" == "--device" ]]; then DEVICE="$2"; fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$REPO/apps/ios/GastosDiarios.xcodeproj"
DERIVED="${DERIVED_DATA:-$(mktemp -d)/dd}"
PROFILES="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
STASH="$(mktemp -d)/profiles"
BUNDLE_ID="dev.cardozo.gastosdiarios"

# The signing credential, checked BEFORE anything is compiled or moved.
#
# When it is missing, xcodebuild compiles the whole project and then fails with
# "No Accounts: Add a new account in Accounts settings" — which reads as if
# Xcode had never been signed in. It has: the account is in Xcode's prefs and
# the log says exactly what is wrong,
#
#   DVTDeveloperAccountManager: Failed to load credentials for <uuid>:
#   "Invalid credentials in keychain ... missing Xcode-Username"
#
# and then xcodebuild PRUNES the account it could not authenticate, which is
# why the account list reads empty afterwards. The empty list is the
# consequence, not the cause — and reading it as the cause sent this script's
# operator to the wrong instruction twice.
#
# What removes the keychain items is not established. It is not the keychain
# locking (it is unlocked, no-timeout) and it is not this script (which never
# writes to the keychain). The likeliest explanation is the free tier's session
# being invalidated and Xcode discarding the credential on the rejection —
# same family as the seven-day profiles.
if ! security find-generic-password -l "Xcode-Username" >/dev/null 2>&1; then
  cat <<'MSG'
No está la credencial de firma en el keychain (falta el ítem "Xcode-Username").

La cuenta puede seguir figurando en Xcode; lo que se perdió es su credencial,
así que xcodebuild no puede pedir un perfil nuevo. Se arregla volviendo a
firmar:

  Xcode → Settings → Accounts → tu Apple ID → Sign In

y después correr este script de nuevo. No se compiló nada ni se movió ningún
perfil, así que no se gastaron días de firma.
MSG
  exit 1
fi

mkdir -p "$STASH"
restore_profiles() {
  if compgen -G "$STASH/*.mobileprovision" > /dev/null; then
    cp "$STASH"/*.mobileprovision "$PROFILES"/ 2>/dev/null || true
    echo "→ perfiles restaurados (el build no llegó a emitir nuevos)"
  fi
}
trap restore_profiles EXIT

echo "== apartando los perfiles de $BUNDLE_ID =="
# ALL of them, not just the app's: Xcode re-mints whatever is missing in one
# pass, so they come back aligned to the second. One minted on its own drifts —
# this app once had the watch profile expiring five days after the other two.
shopt -s nullglob
for f in "$PROFILES"/*.mobileprovision; do
  app_id="$(security cms -D -i "$f" 2>/dev/null | plutil -extract Entitlements.application-identifier raw -o - - 2>/dev/null || true)"
  case "$app_id" in
    *"${BUNDLE_ID#dev.cardozo.}"*) mv "$f" "$STASH/" && echo "   $app_id" ;;
  esac
done

echo "== compilando =="
set +e
xcodebuild -project "$PROJECT" -scheme GastosDiarios -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates build > "$DERIVED.log" 2>&1
BUILD_STATUS=$?
set -e

if [[ $BUILD_STATUS -ne 0 ]]; then
  echo "BUILD FALLÓ (exit $BUILD_STATUS). Últimas líneas:"
  grep -E "error:|No Accounts" "$DERIVED.log" | head -5 || tail -5 "$DERIVED.log"
  echo
  echo "Si dice 'No Accounts': Xcode → Settings → Accounts, agregá el Apple ID."
  exit "$BUILD_STATUS"
fi

# Only past this line is the bundle on disk the one just built.
trap - EXIT
APP="$DERIVED/Build/Products/Debug-iphoneos/GastosDiarios.app"
echo "== firma del bundle recién construido =="
python3 - "$APP" <<'PY'
import datetime, glob, os, plistlib, re, subprocess, sys, zoneinfo
app = sys.argv[1]
syd = zoneinfo.ZoneInfo("Australia/Sydney")
now = datetime.datetime.now(datetime.timezone.utc)
paths = [os.path.join(app, "embedded.mobileprovision")]
paths += sorted(glob.glob(app + "/PlugIns/*/embedded.mobileprovision"))
paths += sorted(glob.glob(app + "/Watch/*/embedded.mobileprovision"))
worst = None
for path in paths:
    raw = subprocess.run(["security", "cms", "-D", "-i", path], capture_output=True).stdout
    plist = plistlib.loads(re.search(rb"<\?xml.*?</plist>", raw, re.S).group(0))
    expiry = plist["ExpirationDate"].replace(tzinfo=datetime.timezone.utc)
    left = expiry - now
    worst = expiry if worst is None or expiry < worst else worst
    name = path.replace(app + "/", "").replace("/embedded.mobileprovision", "") or "app"
    print(f"   {name:38} vence {expiry.astimezone(syd):%d %b %H:%M}  ({left.days}d {left.seconds//3600}h)")
left = worst - now
print(f"\n   el que manda (el más corto): {worst.astimezone(syd):%d %b %H:%M} — {left.days}d {left.seconds//3600}h")
# Under a day means the renewal did not actually happen: fail loudly rather than
# install something that dies tomorrow.
if left.days < 1:
    print("\n   ERROR: la firma no se renovó (menos de un día). Revisá el build.")
    sys.exit(1)
PY

echo "== instalando en $DEVICE =="
xcrun devicectl device install app --device "$DEVICE" "$APP" | grep -E "App installed|bundleID"
echo "listo."
