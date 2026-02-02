#!/usr/bin/env bash
# One-shot: stop cmux devtools, apply profile seed, restart Chrome.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="${CMUX_DEVTOOLS_SERVICE:-cmux-devtools}"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not available. Run ./scripts/setup-profile.sh manually." >&2
  exit 1
fi

SUDO=""
if [[ "$(id -u)" != "0" ]] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

$SUDO systemctl stop "$SERVICE_NAME"
"$SCRIPT_DIR/setup-profile.sh"
$SUDO systemctl start "$SERVICE_NAME"

echo "Profile seed applied and $SERVICE_NAME restarted."
