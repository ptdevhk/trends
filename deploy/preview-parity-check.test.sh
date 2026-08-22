#!/usr/bin/env bash
# Structural tests for preview-parity-check.sh (handoff R4): the minScore
# bucket must warn (not fail) under API version drift, mirroring the search
# totals gate — summary.total ignores minScore on both sides, so a bucket
# mismatch with differing versions is the same version-drift signal.
# Run: bash deploy/preview-parity-check.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

PARITY="$ROOT/deploy/preview-parity-check.sh"

bash -n "$PARITY" && pass "bash -n clean" || fail "bash -n failed"

# 1. CHECK_MIN_SCORE condition simplified (no redundant ==80 branch)
if grep -q 'if \[ -n "${CHECK_MIN_SCORE:-}" \]; then' "$PARITY"; then
    pass "CHECK_MIN_SCORE condition simplified"
else
    fail "CHECK_MIN_SCORE condition not simplified"
fi
if grep -q 'CHECK_MIN_SCORE:-}" = "80"' "$PARITY"; then
    fail "redundant ==80 branch still present"
else
    pass "no redundant ==80 branch"
fi

# 2. minScore mismatch gated on version drift (warn), mirroring search totals
if grep -q 'minScore bucket differs under API version drift' "$PARITY"; then
    pass "minScore drift warn message present"
else
    fail "minScore drift warn message missing"
fi
if grep -q '\[ "$VERSION_DRIFT" -eq 1 \] && \[ "$PARITY_ALLOW_VERSION_DRIFT" != "0" \] && \[ "$PARITY_STRICT_SEARCH" != "1" \]' "$PARITY"; then
    pass "drift gate condition present"
else
    fail "drift gate condition missing"
fi

# 3. strict path still hard-fails
if grep -q 'log_error "minScore bucket mismatch"' "$PARITY"; then
    pass "strict mismatch still fails"
else
    fail "strict mismatch path missing"
fi

# 4. semantics documented (summary.total ignores minScore)
if grep -q 'summary.total ignores minScore' "$PARITY"; then
    pass "minScore semantics documented"
else
    fail "minScore semantics comment missing"
fi

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "$FAIL FAILURES"; exit 1; }
