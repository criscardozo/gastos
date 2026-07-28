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
set -uo pipefail
cd "$(dirname "$0")"

SCHEME="GastosDiarios"
PROJECT="GastosDiarios.xcodeproj"
DD="build-device"

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
