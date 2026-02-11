#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_DIR="$REPO_ROOT/dev-docs/skills/trends-agent-governance"
DEST_ROOT="${CODEX_HOME:-$HOME/.codex}/skills"
DEST_DIR="$DEST_ROOT/trends-agent-governance"

usage() {
  echo "Usage: $0 [--check]"
}

require_tool() {
  local tool="$1"
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool" >&2
    exit 1
  fi
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Missing source skill directory: $SOURCE_DIR" >&2
  exit 1
fi

require_tool rsync

if [[ "${1:-}" == "--check" ]]; then
  if [[ ! -d "$DEST_DIR" ]]; then
    echo "Installed skill not found: $DEST_DIR" >&2
    echo "Run: make install-agent-skill" >&2
    exit 1
  fi

  DRIFT_OUTPUT="$(rsync -ani --delete "$SOURCE_DIR"/ "$DEST_DIR"/)"
  if [[ -n "$DRIFT_OUTPUT" ]]; then
    echo "Installed skill drift detected at $DEST_DIR" >&2
    echo "$DRIFT_OUTPUT" >&2
    echo "Run: make install-agent-skill" >&2
    exit 1
  fi

  echo "Installed skill is up to date: $DEST_DIR"
  exit 0
fi

if [[ -n "${1:-}" ]]; then
  usage
  exit 1
fi

mkdir -p "$DEST_ROOT"
rsync -a --delete "$SOURCE_DIR"/ "$DEST_DIR"/
echo "Installed skill to $DEST_DIR"
