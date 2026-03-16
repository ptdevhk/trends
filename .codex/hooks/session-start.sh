#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

export CMUX_HOOK_PROVIDER="codex"
export CMUX_PROJECT_DIR="${CMUX_PROJECT_DIR:-$PROJECT_DIR}"
export CMUX_SESSION_START_OUTPUT_MODE="text"
export CMUX_SESSION_STATE_PREFIX="${CMUX_SESSION_STATE_PREFIX:-codex-autopilot}"
export CMUX_SESSION_FILE="${CMUX_SESSION_FILE:-/tmp/codex-current-session-id}"
export CMUX_SESSION_ACTIVITY_SCRIPT="${CMUX_SESSION_ACTIVITY_SCRIPT:-$PROJECT_DIR/.claude/hooks/session-activity-capture.sh}"
export CMUX_SESSION_START_DEBUG_LOG="${CMUX_SESSION_START_DEBUG_LOG:-/tmp/codex-session-start-debug.log}"

exec "$PROJECT_DIR/scripts/hooks/cmux-session-start-core.sh"
