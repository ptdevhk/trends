#!/usr/bin/env bash
# Launch Chrome with remote debugging for extension development
# Usage: ./scripts/debug.sh [URL]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"
USER_DATA_DIR="${EXT_DIR}/.chrome-debug-profile"
TARGET_URL="${1:-https://hr.job5156.com/search}"
DEBUG_PORT="${DEBUG_PORT:-9222}"

resolve_chrome() {
    if [[ -n "${CHROME:-}" ]]; then
        if [[ -x "$CHROME" ]]; then
            echo "$CHROME"
            return 0
        fi
        if command -v "$CHROME" >/dev/null 2>&1; then
            command -v "$CHROME"
            return 0
        fi
        echo "Error: CHROME is set but not executable: $CHROME" >&2
        return 1
    fi

    if [[ "${OSTYPE:-}" == "darwin"* ]]; then
        local mac_chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        if [[ -x "$mac_chrome" ]]; then
            echo "$mac_chrome"
            return 0
        fi
    fi

    local candidate
    for candidate in google-chrome google-chrome-stable chromium chromium-browser chrome; do
        if command -v "$candidate" >/dev/null 2>&1; then
            command -v "$candidate"
            return 0
        fi
    done

    return 1
}

CHROME_BIN="$(resolve_chrome || true)"
if [[ -z "$CHROME_BIN" ]]; then
    echo "Error: Chrome executable not found." >&2
    echo "Install Google Chrome/Chromium, or set CHROME=/path/to/chrome." >&2
    exit 1
fi

mkdir -p "$USER_DATA_DIR"

echo "Starting Chrome with remote debugging on port $DEBUG_PORT..."
echo "  Chrome:     $CHROME_BIN"
echo "  Extension:  $EXT_DIR"
echo "  Profile:    $USER_DATA_DIR"
echo "  URL:        $TARGET_URL"
echo ""
echo "MCP: Use the chrome-devtools-9222 MCP server."

exec "$CHROME_BIN" \
    --remote-debugging-port="$DEBUG_PORT" \
    --user-data-dir="$USER_DATA_DIR" \
    --disable-extensions-except="$EXT_DIR" \
    --load-extension="$EXT_DIR" \
    --no-first-run \
    --no-default-browser-check \
    "$TARGET_URL"
