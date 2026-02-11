#!/usr/bin/env bash
# Wrapper to start Chrome with remote debugging on port 9222.
# This uses the existing extension debug script which handles Mac paths and profiles.
set -euo pipefail

DEBUG_PORT="${CHROME_DEBUG_PORT:-9222}"

# Pre-detect if Chrome is already running with remote debugging enabled on this port
if curl -fs "http://127.0.0.1:${DEBUG_PORT}/json/version" >/dev/null 2>&1; then
  echo "✅ Found an existing Chrome instance with remote debugging on port ${DEBUG_PORT}."
  echo "Listing active pages:"
  curl -s "http://127.0.0.1:${DEBUG_PORT}/json" | grep -E '"title":|"url":' | head -n 10
  echo "..."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

exec "${ROOT_DIR}/apps/browser-extension/scripts/debug.sh" "$@"
