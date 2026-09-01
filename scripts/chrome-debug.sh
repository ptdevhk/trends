#!/usr/bin/env bash
# Thin wrapper. SSOT is karlorz/agent-skills playwright-cli `chrome-debug`
# (chrome-debug-contract v4+). Do not vendor a second launcher in this repo.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="${ROOT_DIR}/apps/browser-extension"
THIS_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/chrome-debug.sh"

if ! command -v chrome-debug >/dev/null 2>&1; then
  echo "[ERROR] chrome-debug not found on PATH." >&2
  echo "Install the playwright-cli launcher (karlorz/agent-skills):" >&2
  echo "  bash \"\$PLAYWRIGHT_CLI_PLUGIN_ROOT/scripts/setup-playwright-cli.sh\" --project ${ROOT_DIR}" >&2
  exit 1
fi

resolved="$(command -v chrome-debug)"
if [[ "${resolved}" == "${THIS_SCRIPT}" ]]; then
  echo "[ERROR] chrome-debug resolves to this shim. Install the playwright-cli launcher on PATH." >&2
  exit 1
fi

args=()
if [[ -f "${EXT_DIR}/manifest.json" ]]; then
  args+=(--load-unpacked "${EXT_DIR}")
fi
exec chrome-debug "${args[@]}" "$@"
