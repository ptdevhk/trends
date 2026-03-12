#!/bin/bash
# Unit tests for session-activity-capture.sh
# Usage: ./.claude/hooks/test-session-activity-capture.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAPTURE_SCRIPT="$SCRIPT_DIR/session-activity-capture.sh"

PASSED=0
FAILED=0

assert() {
  local name="$1"
  shift
  if "$@"; then
    echo "[PASS] $name"
    PASSED=$((PASSED + 1))
  else
    echo "[FAIL] $name"
    FAILED=$((FAILED + 1))
  fi
}

assert_eq() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "[PASS] $name"
    PASSED=$((PASSED + 1))
  else
    echo "[FAIL] $name: expected '$expected', got '$actual'"
    FAILED=$((FAILED + 1))
  fi
}

# Test 1: Script exists and is executable
echo ""
echo "=== Test 1: Script exists and is executable ==="
assert "script exists" test -f "$CAPTURE_SCRIPT"
assert "script is executable" test -x "$CAPTURE_SCRIPT"

# Test 2: Script exits cleanly without JWT (no-op mode)
echo ""
echo "=== Test 2: Script exits cleanly without JWT ==="
unset CMUX_TASK_RUN_JWT 2>/dev/null || true
EXIT_CODE=0
"$CAPTURE_SCRIPT" start "test-session-1" 2>/dev/null || EXIT_CODE=$?
assert_eq "start without JWT exits 0" "0" "$EXIT_CODE"

EXIT_CODE=0
"$CAPTURE_SCRIPT" end "test-session-1" 2>/dev/null || EXIT_CODE=$?
assert_eq "end without JWT exits 0" "0" "$EXIT_CODE"

# Test 3: Script validates arguments (when JWT is set)
echo ""
echo "=== Test 3: Script validates arguments ==="
export CMUX_TASK_RUN_JWT="fake-jwt-for-test"
EXIT_CODE=0
"$CAPTURE_SCRIPT" invalid "test-session-2" 2>/dev/null || EXIT_CODE=$?
assert_eq "invalid action exits 1" "1" "$EXIT_CODE"
unset CMUX_TASK_RUN_JWT

# Test 4: Script handles empty session ID gracefully
echo ""
echo "=== Test 4: Handles empty/default session ID ==="
export CMUX_TASK_RUN_JWT="fake-jwt-for-test"
EXIT_CODE=0
"$CAPTURE_SCRIPT" start "" 2>/dev/null || EXIT_CODE=$?
assert_eq "empty session exits 0" "0" "$EXIT_CODE"

EXIT_CODE=0
"$CAPTURE_SCRIPT" start "default" 2>/dev/null || EXIT_CODE=$?
assert_eq "default session exits 0" "0" "$EXIT_CODE"
unset CMUX_TASK_RUN_JWT

# Test 5: Bash syntax is valid
echo ""
echo "=== Test 5: Bash syntax validation ==="
EXIT_CODE=0
bash -n "$CAPTURE_SCRIPT" 2>/dev/null || EXIT_CODE=$?
assert_eq "bash syntax valid" "0" "$EXIT_CODE"

# Summary
echo ""
echo "=== Summary ==="
echo "Passed: $PASSED"
echo "Failed: $FAILED"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
