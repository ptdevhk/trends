#!/usr/bin/env bash
# Check that the local Node.js major matches the version CI runs (from .nvmrc).
#
# CI (Checks + Tests workflows) runs node $(cat .nvmrc). A local/CI Node
# major mismatch is a silent divergence risk — the exact class of bug that
# stalled the Tests workflow for hours in 2026-07 (stale React 18 hoist made
# CI behave differently from local).
#
# WARNING-only by default (local dev on a different major is often fine).
# Set NODE_VERSION_STRICT=1 to fail instead.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NVM_RC="$(cat "$REPO_ROOT/.nvmrc" | tr -d '[:space:]')"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found on PATH — install Node $(NVM_RC) (see .nvmrc)" >&2
  exit 1
fi

LOCAL_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
TARGET_MAJOR="${NVM_RC%%.*}"

if [ "$LOCAL_MAJOR" = "$TARGET_MAJOR" ]; then
  echo "node version OK: $(node --version) (matches .nvmrc=$NVM_RC, CI node $TARGET_MAJOR)"
  exit 0
fi

if [ "${NODE_VERSION_STRICT:-0}" = "1" ]; then
  echo "error: local node $(node --version) major $LOCAL_MAJOR != CI node $TARGET_MAJOR (.nvmrc)" >&2
  echo "  Install/use node $TARGET_MAJOR (nvm: nvm use; fnm: fnm use; mise: mise use)." >&2
  exit 1
fi

echo "warning: local node $(node --version) major $LOCAL_MAJOR != CI node $TARGET_MAJOR (.nvmrc)"
echo "  CI runs node $TARGET_MAJOR — verify your work on node $TARGET_MAJOR (nvm use / fnm use / mise use) before pushing."
echo "  NODE_VERSION_STRICT=1 makes this a hard failure."
exit 0
