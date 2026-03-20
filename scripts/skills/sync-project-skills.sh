#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v bun >/dev/null 2>&1; then
  exec bunx tsx "$SCRIPT_DIR/sync-project-skills.ts" "$@"
fi

exec npx tsx "$SCRIPT_DIR/sync-project-skills.ts" "$@"
