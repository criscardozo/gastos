#!/usr/bin/env bash
# Sideload GastosDiarios (iOS app + the embedded watchOS app) onto a connected
# iPhone using the free personal signing team — no Xcode UI needed.
#
# Usage:
#   ./install-device.sh            # auto-detect the connected iPhone
#   ./install-device.sh <UDID>     # pick a specific device
#   ./install-device.sh --list     # just show what's connected
#
# Notes:
#   • The watch app is embedded in the iOS app, so installing the phone app
#     makes it available on the paired watch (enable it in the Watch app if it
#     doesn't appear automatically).
#   • Free-team signing expires after ~7 days — re-run this to refresh. The app
#     itself now warns you two days before (Settings → "Firma válida hasta").
#   • Re-running is only a real refresh because of retire_stale_profiles below:
#     Xcode REUSES a cached provisioning profile while it is still valid, so
#     re-signing on day 6 would otherwise leave you with one day, not seven.
set -uo pipefail
cd "$(dirname "$0")"

SCHEME="GastosDiarios"
PROJECT="GastosDiarios.xcodeproj"
DD="build-device"
BUNDLE_PREFIX="dev.cardozo.gastosdiarios"
PROFILE_DIR="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"

die() { echo "✗ $*" >&2; exit 1; }

# Devices xcodebuild will actually accept, straight from the horse's mouth:
# "{ platform:iOS, arch:arm64, id:00008150-…, name:Kylo }". Excludes simulators
# and the "Any iOS Device" placeholder. Never matches on the device NAME — a
# phone can be called anything.
list_devices() {
  xcodebuild -showdestinations -project "$PROJECT" -scheme "$SCHEME" 2>/dev/null \
    | grep "platform:iOS," \
    | grep -v "Simulator" \
    | grep -v "placeholder"
}

if [ "${1:-}" = "--list" ]; then
  echo "Dispositivos que xcodebuild puede usar:"
  list_devices || echo "  (ninguno)"
  echo
  echo "Estado según devicectl:"
  xcrun devicectl list devices 2>/dev/null || true
  exit 0
fi

# `|| true` on purpose: a failing pipeline here must NOT kill the script before
# it can explain itself (that bug made an earlier version exit silently).
DEVICES="$(list_devices || true)"

UDID="${1:-}"
if [ -z "$UDID" ]; then
  COUNT="$(printf '%s' "$DEVICES" | grep -c . || true)"
  if [ "$COUNT" -eq 0 ]; then
    echo "✗ No encontré ningún iPhone conectado." >&2
    echo >&2
    echo "  Revisá que esté enchufado, desbloqueado y que hayas aceptado 'Confiar'." >&2
    echo "  Para ver qué detecta el sistema:  ./install-device.sh --list" >&2
    exit 1
  fi
  if [ "$COUNT" -gt 1 ]; then
    echo "Hay más de un dispositivo:" >&2
    printf '%s\n' "$DEVICES" >&2
    die "Pasá el UDID que quieras: ./install-device.sh <UDID>"
  fi
  UDID="$(printf '%s' "$DEVICES" | sed -E 's/.*id:([^,}]+).*/\1/' | tr -d ' ')"
  NAME="$(printf '%s' "$DEVICES" | sed -E 's/.*name:(.*)\}.*/\1/' | sed -E 's/ +$//')"
else
  NAME="(indicado a mano)"
fi
[ -n "$UDID" ] || die "No pude extraer el UDID. Probá: ./install-device.sh --list"

echo "→ Dispositivo: ${NAME} — ${UDID}"

# Keep the generated project in sync (new files land in it automatically).
if command -v xcodegen >/dev/null 2>&1; then xcodegen >/dev/null || true; fi

# Free-team profiles live 7 days, and Xcode hands back a cached one as long as
# it has any life left — so a reinstall on day 6 gives you a build that dies
# tomorrow. Move ours out of the way when they weren't issued in the last few
# hours, which makes -allowProvisioningUpdates fetch fresh 7-day ones. They are
# moved, not deleted, so a failed re-issue is recoverable.
retire_stale_profiles() {
  [ -d "$PROFILE_DIR" ] || return 0
  command -v python3 >/dev/null 2>&1 || return 0

  local stale
  stale="$(python3 - "$PROFILE_DIR" "$BUNDLE_PREFIX" <<'PYTHON'
import datetime, pathlib, plistlib, subprocess, sys

directory, prefix = pathlib.Path(sys.argv[1]), sys.argv[2]
# Anything with less life than this was issued before today, so re-signing
# against it would inherit its old expiry.
KEEP_ABOVE_DAYS = 6.5
now = datetime.datetime.now(datetime.timezone.utc)

for path in sorted(directory.glob("*.mobileprovision")):
    decoded = subprocess.run(
        ["security", "cms", "-D", "-i", str(path)],
        capture_output=True,
    )
    if decoded.returncode != 0:
        continue
    try:
        profile = plistlib.loads(decoded.stdout)
    except Exception:
        continue
    name = str(profile.get("Name", ""))
    expiry = profile.get("ExpirationDate")
    if prefix not in name or expiry is None:
        continue
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=datetime.timezone.utc)
    days_left = (expiry - now).total_seconds() / 86400
    if days_left < KEEP_ABOVE_DAYS:
        print(f"{path}\t{name}\t{days_left:.1f}")
PYTHON
)"

  [ -n "$stale" ] || return 0
  mkdir -p "$DD/retired-profiles"
  while IFS=$'\t' read -r path name days; do
    [ -n "$path" ] || continue
    echo "  · renuevo el perfil de ${name} (le quedaban ${days} días)"
    mv "$path" "$DD/retired-profiles/" 2>/dev/null || true
  done <<< "$stale"
}

echo "→ Revisando la vigencia de los perfiles de firma…"
retire_stale_profiles

echo "→ Compilando y firmando (puede tardar un minuto)…"
set -o pipefail
if ! xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Debug \
  -destination "platform=iOS,id=$UDID" \
  -derivedDataPath "$DD" \
  -allowProvisioningUpdates \
  build 2>&1 | tail -40
then
  die "Falló la compilación o la firma (mirá el detalle arriba)."
fi

APP="$DD/Build/Products/Debug-iphoneos/$SCHEME.app"
[ -d "$APP" ] || die "No encontré el .app compilado en $APP"

# Say plainly how long THIS build lives — the whole point of the retirement
# step above is that this should read ~7 days after every run.
if command -v python3 >/dev/null 2>&1; then
  python3 - "$APP/embedded.mobileprovision" <<'PYTHON' || true
import datetime, plistlib, subprocess, sys

decoded = subprocess.run(
    ["security", "cms", "-D", "-i", sys.argv[1]], capture_output=True
)
if decoded.returncode == 0:
    profile = plistlib.loads(decoded.stdout)
    expiry = profile["ExpirationDate"]
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=datetime.timezone.utc)
    local = expiry.astimezone()
    days = (expiry - datetime.datetime.now(datetime.timezone.utc)).total_seconds() / 86400
    print(f"→ Firma válida hasta {local:%d/%m/%Y %H:%M} ({days:.1f} días)")
PYTHON
fi

echo "→ Instalando en el dispositivo…"
# devicectl indexes devices by its own identifier, but also accepts the
# hardware UDID; fall back to the name if it doesn't.
if ! xcrun devicectl device install app --device "$UDID" "$APP" 2>/dev/null; then
  xcrun devicectl device install app --device "$NAME" "$APP" \
    || die "La instalación falló. Probá: ./install-device.sh --list"
fi

cat <<'EOF'

✓ Instalada. Después de esto:
  • Solo la primera vez — iPhone: Ajustes → General → VPN y gestión de
    dispositivos → confiá en tu certificado de desarrollador.
  • iPhone: abrí la app Watch → Gastos Diarios → activá "Mostrar app en
    Apple Watch" si no apareció sola.
  • Iniciá sesión con Google en el teléfono (el reloj escribe a través de él).
  • La firma dura ~7 días; la app te avisa 2 días antes. Volvé a correr esto
    para renovarla.
EOF
