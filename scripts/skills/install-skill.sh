#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEST_ROOT="${CODEX_HOME:-$HOME/.codex}/skills"

usage() {
  echo "Usage: $0 --skill <skill-name> [--check]"
}

require_tool() {
  local tool="$1"
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool" >&2
    exit 1
  fi
}

SKILL_NAME=""
CHECK_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skill)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --skill" >&2
        usage
        exit 1
      fi
      SKILL_NAME="$2"
      shift 2
      ;;
    --check)
      CHECK_ONLY=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$SKILL_NAME" ]]; then
  echo "--skill is required" >&2
  usage
  exit 1
fi

if [[ ! "$SKILL_NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "Invalid skill name: $SKILL_NAME" >&2
  echo "Expected lowercase letters, numbers, and hyphens only" >&2
  exit 1
fi

SOURCE_DIR="$REPO_ROOT/dev-docs/skills/$SKILL_NAME"
DEST_DIR="$DEST_ROOT/$SKILL_NAME"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Missing source skill directory: $SOURCE_DIR" >&2
  exit 1
fi

require_tool rsync

if [[ "$CHECK_ONLY" == "true" ]]; then
  if [[ ! -d "$DEST_DIR" ]]; then
    echo "Installed skill not found: $DEST_DIR" >&2
    echo "Run: make install-skill SKILL=$SKILL_NAME" >&2
    exit 1
  fi

  DRIFT_OUTPUT="$(rsync -ani --delete "$SOURCE_DIR"/ "$DEST_DIR"/)"
  if [[ -n "$DRIFT_OUTPUT" ]]; then
    echo "Installed skill drift detected at $DEST_DIR" >&2
    echo "$DRIFT_OUTPUT" >&2
    echo "Run: make install-skill SKILL=$SKILL_NAME" >&2
    exit 1
  fi

  echo "Installed skill is up to date: $DEST_DIR"
  exit 0
fi

mkdir -p "$DEST_ROOT"
rsync -a --delete "$SOURCE_DIR"/ "$DEST_DIR"/
echo "Installed skill to $DEST_DIR"
