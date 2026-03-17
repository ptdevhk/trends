#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CODEX_DEST_ROOT="${CODEX_HOME:-$HOME/.codex}/skills"
AGENTS_DEST_ROOT="${AGENTS_HOME:-$HOME/.agents}/skills"

usage() {
  echo "Usage: $0 --skill <skill-name> [--target codex|agents|all] [--check]"
  echo "Default target: codex"
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
TARGET="codex"

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
    --target)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --target" >&2
        usage
        exit 1
      fi
      TARGET="$2"
      shift 2
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

if [[ ! "$TARGET" =~ ^(codex|agents|all)$ ]]; then
  echo "Invalid target: $TARGET" >&2
  echo "Expected one of: codex, agents, all" >&2
  exit 1
fi

SOURCE_DIR="$REPO_ROOT/dev-docs/skills/$SKILL_NAME"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Missing source skill directory: $SOURCE_DIR" >&2
  exit 1
fi

require_tool rsync

target_roots=()
case "$TARGET" in
  codex)
    target_roots=("$CODEX_DEST_ROOT")
    ;;
  agents)
    target_roots=("$AGENTS_DEST_ROOT")
    ;;
  all)
    target_roots=("$CODEX_DEST_ROOT" "$AGENTS_DEST_ROOT")
    ;;
esac

if [[ "$CHECK_ONLY" == "true" ]]; then
  for dest_root in "${target_roots[@]}"; do
    dest_dir="$dest_root/$SKILL_NAME"
    if [[ ! -d "$dest_dir" ]]; then
      echo "Installed skill not found: $dest_dir" >&2
      echo "Run: make install-skill SKILL=$SKILL_NAME TARGET=$TARGET" >&2
      exit 1
    fi

    DRIFT_OUTPUT="$(rsync -ani --delete "$SOURCE_DIR"/ "$dest_dir"/)"
    if [[ -n "$DRIFT_OUTPUT" ]]; then
      echo "Installed skill drift detected at $dest_dir" >&2
      echo "$DRIFT_OUTPUT" >&2
      echo "Run: make install-skill SKILL=$SKILL_NAME TARGET=$TARGET" >&2
      exit 1
    fi

    echo "Installed skill is up to date: $dest_dir"
  done
  exit 0
fi

for dest_root in "${target_roots[@]}"; do
  dest_dir="$dest_root/$SKILL_NAME"
  mkdir -p "$dest_dir"
  rsync -a --delete "$SOURCE_DIR"/ "$dest_dir"/
  echo "Installed skill to $dest_dir"
done
