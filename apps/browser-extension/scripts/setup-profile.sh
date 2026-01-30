#!/usr/bin/env bash
# Apply pre-loaded Chrome profile files so the extension auto-loads.
# Usage: ./scripts/setup-profile.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"
PROFILE_SEED_DIR="${EXT_DIR}/profile-seed"
USER_DATA_DIR="${CHROME_USER_DATA_DIR:-/root/.config/chrome}"
# Allow override if needed, otherwise use the standard Default profile.
CHROME_PROFILE="${CHROME_PROFILE_DIR:-$USER_DATA_DIR/Default}"
EXTENSION_PATH="/root/workspace/apps/browser-extension"

if pgrep -f "chrome.*--remote-debugging-port" > /dev/null 2>&1; then
  cat <<EOF_MSG
Chrome appears to be running with remote debugging enabled.

To ensure the profile seed is not overwritten, stop Chrome first:
  sudo systemctl stop cmux-devtools

Then re-run:
  ./scripts/setup-profile.sh

After that, restart Chrome:
  sudo systemctl start cmux-devtools
EOF_MSG
  exit 1
fi

if [[ ! -f "$PROFILE_SEED_DIR/Preferences" ]]; then
  cat <<EOF_MSG
Error: profile seed not found at $PROFILE_SEED_DIR/Preferences

Generate it once after manually loading the extension in Chrome:
  mkdir -p "$PROFILE_SEED_DIR"
  cp "$CHROME_PROFILE/Preferences" "$PROFILE_SEED_DIR/Preferences"
  cp "$CHROME_PROFILE/Secure Preferences" "$PROFILE_SEED_DIR/Secure Preferences" 2>/dev/null || true

Then re-run this script.
EOF_MSG
  exit 1
fi

if [[ -f "$CHROME_PROFILE/Preferences" ]] && grep -Fq "$EXTENSION_PATH" "$CHROME_PROFILE/Preferences" 2>/dev/null; then
  echo "Extension already configured in profile."
  exit 0
fi

echo "Applying profile seed to $CHROME_PROFILE"

mkdir -p "$CHROME_PROFILE"

if [[ -f "$CHROME_PROFILE/Preferences" ]]; then
  cp "$CHROME_PROFILE/Preferences" "$CHROME_PROFILE/Preferences.backup.$(date +%s)"
fi

cp "$PROFILE_SEED_DIR/Preferences" "$CHROME_PROFILE/Preferences"
if [[ -f "$PROFILE_SEED_DIR/Secure Preferences" ]]; then
  cp "$PROFILE_SEED_DIR/Secure Preferences" "$CHROME_PROFILE/Secure Preferences"
fi

echo "Profile seed applied. Restart Chrome to load the extension automatically."
echo "Note: extension path must match $EXTENSION_PATH"
