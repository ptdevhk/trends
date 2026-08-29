#!/usr/bin/env bash
# Launch Chrome with remote debugging for extension development.
# Usage: ./scripts/debug.sh [URL]
# On darwin, prefer Chrome for Testing / Chromium before branded Google Chrome.
# Branded 137+ skips the unpack flag. 152 still ignores it. Pipe CDP, not :9222.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"
USER_DATA_DIR="${EXT_DIR}/.chrome-debug-profile"
TARGET_URL="${1:-https://hr.job5156.com/search}"
DEBUG_PORT="${CHROME_DEBUG_PORT:-9222}"

# (Auto-detection moved to wrapper script)

detect_chrome() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # Standard Mac paths (check fixed paths first to avoid space-splitting issues with wildcards)
    local mac_paths=(
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    )

    if [[ -x "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" ]]; then
      echo "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
      return 0
    fi


    # Fallback to slower wildcard search for Puppeteer/Testing builds if needed
    # We use a temporary file glob to avoid space issues
    local pup_paths
    pup_paths=$(ls -d "$HOME"/.cache/puppeteer/chrome/*/chrome-mac-*/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing 2>/dev/null | head -n 1)
    if [[ -n "$pup_paths" ]] && [[ -x "$pup_paths" ]]; then
       echo "$pup_paths"
       return 0
    fi
    for p in "${mac_paths[@]}"; do
      if [[ -x "$p" ]]; then
        echo "$p"
        return 0
      fi
    done
  else
    for chrome_cmd in \
      "chromium-browser" \
      "chromium" \
      "google-chrome-unstable" \
      "google-chrome-stable" \
      "google-chrome"; do
      if command -v "$chrome_cmd" &>/dev/null; then
        command -v "$chrome_cmd"
        return 0
      fi
    done
  fi
  return 1
}

CHROME="${CHROME:-}"
if [[ -z "$CHROME" ]]; then
  CHROME="$(detect_chrome || true)"
fi

if [[ -n "$CHROME" ]] && [[ ! -x "$CHROME" ]]; then
  if command -v "$CHROME" &>/dev/null; then
    CHROME="$(command -v "$CHROME")"
  fi
fi

if [[ -z "$CHROME" ]] || [[ ! -x "$CHROME" ]]; then
  cat <<EOF_MSG
Error: Chrome/Chromium not found.

For best compatibility, install one of:
  - Chrome for Testing: npx @puppeteer/browsers install chrome@stable
  - Chromium: brew install chromium (macOS) or apt install chromium (Linux)

Or set CHROME to your Chrome binary path.
EOF_MSG
  exit 1
fi

CHROME_VERSION_STR="$($CHROME --version 2>/dev/null || true)"
CHROME_VERSION="$(echo "$CHROME_VERSION_STR" | grep -oE '[0-9]+' | head -1 || true)"
IS_BRANDED_CHROME=false
if [[ "$CHROME_VERSION_STR" == Google\ Chrome* ]] && [[ "$CHROME_VERSION_STR" != *"for Testing"* ]] && [[ "$CHROME_VERSION_STR" != *"Canary"* ]]; then
  if [[ -n "$CHROME_VERSION" ]] && [[ "$CHROME_VERSION" -ge 137 ]]; then
    IS_BRANDED_CHROME=true
  fi
fi

mkdir -p "$USER_DATA_DIR"

echo "Starting Chrome with remote debugging on port $DEBUG_PORT"
echo "Chrome: $CHROME"
echo "Version: ${CHROME_VERSION_STR:-unknown}"
echo "Extension: $EXT_DIR"
echo "Profile: $USER_DATA_DIR"
echo "URL: $TARGET_URL"
echo ""

if [[ "$IS_BRANDED_CHROME" == true ]]; then
  echo "Warning: branded Chrome 137+ detected. --load-extension is not available (dropped in 137; 152 still ignores it)."
  echo "Load unpacked path:"
  echo "  $EXT_DIR"
  echo "CDP Extensions.loadUnpacked is pipe-only; it does not work over :9222."
  echo "Load the extension manually via chrome://extensions."
  echo ""
  "$CHROME" \
    --remote-debugging-port="$DEBUG_PORT" \
    --user-data-dir="$USER_DATA_DIR" \
    --no-first-run \
    --no-default-browser-check \
    "$TARGET_URL"
else
  "$CHROME" \
    --remote-debugging-port="$DEBUG_PORT" \
    --user-data-dir="$USER_DATA_DIR" \
    --load-extension="$EXT_DIR" \
    --no-first-run \
    --no-default-browser-check \
    "$TARGET_URL"
fi
