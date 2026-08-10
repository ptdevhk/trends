#!/usr/bin/env bash
# Tests for dev-parity-check.sh. Run: bash deploy/dev-parity-check.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

# shellcheck source=lib-preview-common.sh
source "$ROOT/deploy/lib-preview-common.sh"
# shellcheck source=lib-dev-common.sh
source "$ROOT/deploy/lib-dev-common.sh"
# shellcheck source=dev-parity-check.sh
source "$ROOT/deploy/dev-parity-check.sh"

compare_field "corpus" "8958" "8958" 1 && pass "equal hard pass" || fail "equal hard failed"
compare_field "corpus" "8957" "8958" 1 && fail "unequal hard passed" || pass "unequal hard fails"
TOTAL_TOLERANCE=1 compare_field "query" "48" "49" 1 && pass "tolerance 1 ok" || fail "tolerance 1 failed"
TOTAL_TOLERANCE=0 compare_field "query" "48" "49" 1 && fail "tolerance 0 passed" || pass "tolerance 0 fails"
compare_field "query" "48" "NA" 0 && pass "informational NA ok" || fail "informational NA failed"
compare_field "query" "48" "49" 0 && pass "informational mismatch ok" || fail "informational mismatch failed"
compare_field "query" "NA" "48" 0 && pass "informational dev-NA ok" || fail "informational dev-NA failed"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "$FAIL FAILURES"; exit 1; }
