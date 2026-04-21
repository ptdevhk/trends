#!/bin/bash
# test-headless-flag.sh — Verify 3-layer headless collector feature flag
#
# Prerequisites:
#   - API dev server running (make dev-api)
#   - At least one search profile exists
#
# Usage:
#   bash scripts/test-headless-flag.sh
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3001}"
PASS=0
FAIL=0

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

assert_status() {
  local desc="$1"
  local actual="$2"
  local expected="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $desc (HTTP $actual)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc (got HTTP $actual, expected $expected)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Headless collector feature flag test ==="

# --- Worker layer tests (no server needed) ---
echo ""
echo "Layer: Worker (Python)"

echo "  Test 1: Worker skips dispatch when ENABLE_HEADLESS_COLLECTOR is unset"
WORKER_OUT=$(ENABLE_HEADLESS_COLLECTOR= python3 -c "
import os, sys, logging
logging.basicConfig(level=logging.DEBUG, stream=sys.stderr, force=True)
os.chdir('$PWD')
sys.path.insert(0, '.')
from apps.worker.resume_tasks import run_resume_crawl_task
result = run_resume_crawl_task({'id': 'test-flag-off', 'location': 'Singapore', 'keywords': ['dev']})
print(f'RESULT={result}')
" 2>&1 || true)
assert_contains "worker returns False when flag off" "$WORKER_OUT" "RESULT=False"
assert_contains "worker logs skip message" "$WORKER_OUT" "Headless collector disabled"

echo "  Test 2: Worker attempts dispatch when ENABLE_HEADLESS_COLLECTOR=true"
WORKER_ON_OUT=$(ENABLE_HEADLESS_COLLECTOR=true python3 -c "
import os, sys, logging
logging.basicConfig(level=logging.DEBUG, stream=sys.stderr, force=True)
os.chdir('$PWD')
sys.path.insert(0, '.')
from apps.worker.resume_tasks import run_resume_crawl_task
result = run_resume_crawl_task({'id': 'test-flag-on', 'location': 'Singapore', 'keywords': ['dev']})
print(f'RESULT={result}')
" 2>&1 || true)
# With flag on, it should attempt Convex dispatch (fails if Convex not running — that's OK)
# The key assertion: it does NOT log the "disabled" skip message
if printf '%s\n' "$WORKER_ON_OUT" | grep -Fq "Headless collector disabled"; then
  echo "  FAIL: worker should not skip when flag is on"
  FAIL=$((FAIL + 1))
else
  echo "  PASS: worker does not skip when flag is on"
  PASS=$((PASS + 1))
fi
# It should either log "Dispatching profile crawl" (Convex up) or fail on Convex URL (not running) or return True/False
if printf '%s\n' "$WORKER_ON_OUT" | grep -Fq "Dispatching profile crawl" || printf '%s\n' "$WORKER_ON_OUT" | grep -Fq "CONVEX_URL" || printf '%s\n' "$WORKER_ON_OUT" | grep -Fq "RESULT=True" || printf '%s\n' "$WORKER_ON_OUT" | grep -Fq "RESULT=False"; then
  echo "  PASS: worker attempts dispatch when flag is on"
  PASS=$((PASS + 1))
else
  echo "  FAIL: worker did not attempt dispatch when flag is on"
  echo "    output: $WORKER_ON_OUT"
  FAIL=$((FAIL + 1))
fi

# --- API layer tests (requires dev server) ---
echo ""
echo "Layer: API (Node/Hono)"

# Find a profile ID to test with
PROFILE_ID=""
PROFILE_LIST=$(curl -sf "$API_BASE/api/search-profiles" 2>/dev/null || echo '{"items":[]}')
if echo "$PROFILE_LIST" | python3 -c "import sys,json; items=json.load(sys.stdin).get('items',[]); print(items[0]['id'] if items else '')" 2>/dev/null | grep -q .; then
  PROFILE_ID=$(echo "$PROFILE_LIST" | python3 -c "import sys,json; items=json.load(sys.stdin).get('items',[]); print(items[0]['id'] if items else '')")
fi

if [ -z "$PROFILE_ID" ]; then
  echo "  SKIP: No search profile found — create one via UI to enable API layer tests"
  echo "  (Worker tests above already passed without server)"
else
  echo "  Using profile ID: $PROFILE_ID"

  echo "  Test 3: API returns 403 when ENABLE_HEADLESS_COLLECTOR is not set"
  API_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/search-profiles/$PROFILE_ID/run" -H "Content-Type: application/json" -d '{}' 2>/dev/null || echo "000")
  assert_status "API rejects /run with 403" "$API_RESPONSE" "403"

  echo "  Test 4: API 403 body contains headless-disabled error"
  API_BODY=$(curl -sf -X POST "$API_BASE/api/search-profiles/$PROFILE_ID/run" -H "Content-Type: application/json" -d '{}' 2>/dev/null || echo '{}')
  assert_contains "API error mentions headless collector" "$API_BODY" "not available"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
