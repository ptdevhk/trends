#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESET_SCRIPT="$SCRIPT_DIR/autopilot-reset.sh"
CURRENT_SESSION_FILE="/tmp/codex-current-session-id"
TEST_SESSION="codex-reset-test-$$"
LEGACY_SESSION="codex-reset-legacy-$$"
LIVE_PID=""
PASS=0
FAIL=0

ORIGINAL_CURRENT_EXISTS=0
ORIGINAL_CURRENT_CONTENT=""
if [ -f "$CURRENT_SESSION_FILE" ]; then
  ORIGINAL_CURRENT_EXISTS=1
  ORIGINAL_CURRENT_CONTENT="$(cat "$CURRENT_SESSION_FILE")"
fi

cleanup_session() {
  local sid="$1"
  rm -f \
    "/tmp/codex-autopilot-blocked-${sid}" \
    "/tmp/codex-autopilot-completed-${sid}" \
    "/tmp/codex-autopilot-idle-${sid}" \
    "/tmp/codex-autopilot-pid-${sid}" \
    "/tmp/codex-autopilot-state-${sid}" \
    "/tmp/codex-autopilot-stop-${sid}" \
    "/tmp/codex-autopilot-turns-${sid}" \
    "/tmp/codex-autopilot-wrapup-${sid}"
}

cleanup() {
  cleanup_session "$TEST_SESSION"
  cleanup_session "$LEGACY_SESSION"

  if [ -n "$LIVE_PID" ]; then
    kill "$LIVE_PID" 2>/dev/null || true
  fi

  if [ "$ORIGINAL_CURRENT_EXISTS" -eq 1 ]; then
    printf '%s\n' "$ORIGINAL_CURRENT_CONTENT" > "$CURRENT_SESSION_FILE"
  else
    rm -f "$CURRENT_SESSION_FILE"
  fi
}
trap cleanup EXIT

assert_contains() {
  local desc="$1"
  local haystack="$2"
  local needle="$3"
  if printf '%s\n' "$haystack" | grep -Fq "$needle"; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    expected to find: $needle"
    FAIL=$((FAIL + 1))
  fi
}

assert_file_exists() {
  local desc="$1"
  local path="$2"
  if [ -f "$path" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

assert_file_not_exists() {
  local desc="$1"
  local path="$2"
  if [ ! -f "$path" ]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== autopilot-reset status smoke test ==="

echo ""
echo "Test 1: live codex pid keeps BLOCKED status"
cleanup_session "$TEST_SESSION"
printf '%s\n' "$TEST_SESSION" > "$CURRENT_SESSION_FILE"
printf '3\n' > "/tmp/codex-autopilot-turns-${TEST_SESSION}"
printf '3\n' > "/tmp/codex-autopilot-blocked-${TEST_SESSION}"
bash -c 'exec -a codex sleep 30' &
LIVE_PID=$!
printf '%s\n' "$LIVE_PID" > "/tmp/codex-autopilot-pid-${TEST_SESSION}"

LIVE_OUTPUT="$(bash "$RESET_SCRIPT" --provider codex status)"
assert_contains "live status shows blocked" "$LIVE_OUTPUT" "Status: BLOCKED (actively running)"
assert_file_exists "blocked flag kept for live session" "/tmp/codex-autopilot-blocked-${TEST_SESSION}"

kill "$LIVE_PID" 2>/dev/null || true
LIVE_PID=""

echo ""
echo "Test 2: stale codex pid gets pruned from status"
cleanup_session "$TEST_SESSION"
printf '%s\n' "$TEST_SESSION" > "$CURRENT_SESSION_FILE"
printf '2\n' > "/tmp/codex-autopilot-turns-${TEST_SESSION}"
printf '2\n' > "/tmp/codex-autopilot-blocked-${TEST_SESSION}"
printf '99999999\n' > "/tmp/codex-autopilot-pid-${TEST_SESSION}"

STALE_OUTPUT="$(bash "$RESET_SCRIPT" --provider codex status)"
assert_contains "stale status keeps hook turn count" "$STALE_OUTPUT" "Hook turn: 2"
assert_contains "stale status reports exited session" "$STALE_OUTPUT" "Status: ready (last session exited)"
assert_file_not_exists "stale blocked flag removed" "/tmp/codex-autopilot-blocked-${TEST_SESSION}"
assert_file_not_exists "stale pid flag removed" "/tmp/codex-autopilot-pid-${TEST_SESSION}"

echo ""
echo "Test 3: status-all handles legacy blocked sessions without pid files"
cleanup_session "$TEST_SESSION"
cleanup_session "$LEGACY_SESSION"
printf '%s\n' "$TEST_SESSION" > "$CURRENT_SESSION_FILE"
printf '4\n' > "/tmp/codex-autopilot-turns-${LEGACY_SESSION}"
printf '4\n' > "/tmp/codex-autopilot-blocked-${LEGACY_SESSION}"

STATUS_ALL_OUTPUT="$(bash "$RESET_SCRIPT" --provider codex status-all)"
assert_contains "status-all marks legacy blocked session as exited" "$STATUS_ALL_OUTPUT" "status=ready-exited"
assert_file_not_exists "legacy blocked flag removed" "/tmp/codex-autopilot-blocked-${LEGACY_SESSION}"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
