#!/usr/bin/env bash
# Restart cmux Chrome and open the search page (default: auto-export CSV).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="${CMUX_DEVTOOLS_SERVICE:-cmux-devtools}"
TARGET_URL="${1:-https://hr.job5156.com/search?tr_auto_export=csv}"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not available. Falling back to ./scripts/debug.sh" >&2
  exec "$SCRIPT_DIR/debug.sh" "$TARGET_URL"
fi

SUDO=""
if [[ "$(id -u)" != "0" ]] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

if ! $SUDO systemctl status "$SERVICE_NAME" >/dev/null 2>&1; then
  echo "Service $SERVICE_NAME not found. Falling back to ./scripts/debug.sh" >&2
  exec "$SCRIPT_DIR/debug.sh" "$TARGET_URL"
fi

$SUDO systemctl set-environment CHROME_START_URL="$TARGET_URL"
$SUDO systemctl restart "$SERVICE_NAME"
$SUDO systemctl unset-environment CHROME_START_URL

echo "Restarted $SERVICE_NAME with start URL: $TARGET_URL"
