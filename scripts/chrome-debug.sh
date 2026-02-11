#!/usr/bin/env bash
# Wrapper to start Chrome with remote debugging on port 9222.
# This uses the existing extension debug script which handles Mac paths and profiles.
set -euo pipefail

DEBUG_PORT="${CHROME_DEBUG_PORT:-9222}"

# Check if a VALID debug instance is already running on the port
if curl -fs "http://127.0.0.1:${DEBUG_PORT}/json/version" >/dev/null 2>&1; then
  if pgrep -f "chrome-debug-profile" > /dev/null 2>&1; then
    echo "✅ Found an existing debug Chrome instance on port ${DEBUG_PORT}. Reusing it."
    exit 0
  fi
fi

# Aggressively ensure no other Chrome is running (as requested)
echo "🛑 No working debug instance found. Ensuring all other Chrome instances are closed..."

if [[ "$OSTYPE" == "darwin"* ]]; then
  # MacOS specific
  pkill -ax "Google Chrome" 2>/dev/null || true
  pkill -ax "Google Chrome Canary" 2>/dev/null || true
  pkill -ax "Chromium" 2>/dev/null || true
else
  # Linux specific
  pkill -x "google-chrome" 2>/dev/null || true
  pkill -x "google-chrome-stable" 2>/dev/null || true
  pkill -x "google-chrome-unstable" 2>/dev/null || true
  pkill -x "chromium" 2>/dev/null || true
  pkill -x "chromium-browser" 2>/dev/null || true
fi

# Catch anything else using our specific debug profile (works on both)
if pgrep -f "chrome-debug-profile" > /dev/null 2>&1; then
  pgrep -f "chrome-debug-profile" | xargs kill -9 2>/dev/null || true
fi
sleep 2 # Give OS time to release locks
echo "✅ All instances stopped."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="${ROOT_DIR}/logs/chrome-debug.log"

mkdir -p "$(dirname "$LOG_FILE")"

echo "🚀 Starting Chrome in detached mode..."
echo "Log file: $LOG_FILE"

nohup "${ROOT_DIR}/apps/browser-extension/scripts/debug.sh" "$@" > "$LOG_FILE" 2>&1 &

# Wait up to 5 seconds for the debugger to become available
echo -n "Waiting for debugger on port ${DEBUG_PORT}..."
for i in {1..10}; do
  if curl -fs "http://127.0.0.1:${DEBUG_PORT}/json/version" >/dev/null 2>&1; then
    echo -e "\n✅ Chrome is up and listening on port ${DEBUG_PORT}!"
    exit 0
  fi
  echo -n "."
  sleep 0.5
done

echo -e "\n⚠️ Chrome started but port ${DEBUG_PORT} is not responsive yet."
echo "Check logs at: $LOG_FILE"
