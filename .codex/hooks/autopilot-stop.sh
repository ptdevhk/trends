#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

export CMUX_HOOK_PROVIDER="codex"
export CMUX_PROJECT_DIR="${CMUX_PROJECT_DIR:-$PROJECT_DIR}"
export CMUX_AUTOPILOT_ENABLED="${CMUX_AUTOPILOT_ENABLED:-0}"
export CMUX_AUTOPILOT_STATE_PREFIX="${CMUX_AUTOPILOT_STATE_PREFIX:-codex-autopilot}"
export CMUX_AUTOPILOT_CURRENT_SESSION_FILE="${CMUX_AUTOPILOT_CURRENT_SESSION_FILE:-/tmp/codex-current-session-id}"
export CMUX_AUTOPILOT_ENABLE_REVIEW_WINDOW="${CMUX_AUTOPILOT_ENABLE_REVIEW_WINDOW:-0}"
export CMUX_AUTOPILOT_INLINE_WRAPUP="${CMUX_AUTOPILOT_INLINE_WRAPUP:-1}"
# Codex uses hidden monitoring sleeps, so default to monitoring from the
# first hook instead of waiting for a later visible polling phase.
export CMUX_AUTOPILOT_MONITORING_THRESHOLD="${CMUX_AUTOPILOT_MONITORING_THRESHOLD:-0}"
export CMUX_SESSION_ACTIVITY_SCRIPT="${CMUX_SESSION_ACTIVITY_SCRIPT:-$PROJECT_DIR/.claude/hooks/session-activity-capture.sh}"

# Codex launches hook commands through the user's login shell. If shell startup
# exports stale AUTOPILOT_* defaults, ordinary interactive sessions can be
# forced into autopilot unexpectedly. Gate Codex autopilot on the cmux-scoped
# flag and only allow the generic env var path when the wrapper is explicitly
# enabled by the autopilot runner.
if [ "$CMUX_AUTOPILOT_ENABLED" = "1" ]; then
  export AUTOPILOT_KEEP_RUNNING_DISABLED="${AUTOPILOT_KEEP_RUNNING_DISABLED:-0}"
else
  export AUTOPILOT_KEEP_RUNNING_DISABLED="1"
fi

exec "$PROJECT_DIR/scripts/hooks/cmux-autopilot-stop-core.sh"
