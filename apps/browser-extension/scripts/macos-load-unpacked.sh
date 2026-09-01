#!/usr/bin/env bash
# Print the Load unpacked path. Never seed the employer profile.
# Usage: ./scripts/macos-load-unpacked.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"
if [[ "$OSTYPE" != "darwin"* ]]; then
  echo "This helper is macOS-only. On Linux/container use setup-profile.sh."
  exit 1
fi
echo "Collect Chrome install (playwright-cli SSOT, live :9222):"
echo "  chrome-debug --load-unpacked $EXT_DIR"
echo "  # or: make chrome-debug"
echo ""
echo "chrome-debug --restart re-applies that path. Do not load from a worktree."
echo ""
echo "Do not copy apps/browser-extension/profile-seed onto macos Default."
echo "That seed is container-only."
echo "Do not stack debug:pipe / load-unpacked:cli on the collect Chrome."
running=false
if pgrep -x "Google Chrome" >/dev/null 2>&1; then
  running=true
fi
if [[ "$running" == true ]]; then
  echo ""
  echo "Browser is running. Not writing Preferences. Open chrome://extensions yourself."
else
  echo ""
  echo "Browser is not running. Not starting it, and not writing Preferences."
fi
