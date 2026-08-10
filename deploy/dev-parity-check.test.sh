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

# ERR sentinel (measurement error) must never pass — even both-sides-equal,
# even informational
compare_field "corpus" "ERR" "ERR" 1 && fail "ERR/ERR hard passed" || pass "ERR/ERR hard fails"
compare_field "corpus" "8958" "ERR" 1 && fail "ERR hard passed" || pass "ERR hard fails"
compare_field "corpus" "ERR" "8958" 0 && fail "informational ERR passed" || pass "informational ERR fails"

# --- corpus_total pagination (F1): fixture-driven checks --------------------
FIXTURE_DIR="$(mktemp -d)"
trap 'rm -rf "$FIXTURE_DIR"' EXIT

# 2-page fixture: page 1 (no cursor) -> 3 docs + cursor c2; page 2 -> 2 docs + done
cat > "$FIXTURE_DIR/fake_scan.py" <<'PY'
import json, sys
args = json.loads(sys.argv[1])
cursor = args.get("cursor")
page = [{"id": "r%d" % i} for i in range(3 if not cursor else 2)]
print(json.dumps({
    "docs": page,
    "isDone": cursor == "c2",
    "cursor": "c2" if not cursor else None,
}))
PY
OUT="$(corpus_total shell "python3 $FIXTURE_DIR/fake_scan.py __ARGS__")"
[ "$OUT" = "5" ] && pass "corpus_total sums pages (3 + 2 across cursor)" || fail "corpus_total sum: got '$OUT' want 5"

# single page, done on first call
cat > "$FIXTURE_DIR/fake_done.py" <<'PY'
import json, sys
print(json.dumps({"docs": [{"id": "r1"}], "isDone": True, "cursor": None}))
PY
OUT="$(corpus_total shell "python3 $FIXTURE_DIR/fake_done.py __ARGS__")"
[ "$OUT" = "1" ] && pass "corpus_total single-page done" || fail "corpus_total single-page: got '$OUT' want 1"

# parse failure -> NA (existing degradation preserved)
cat > "$FIXTURE_DIR/fake_garbage.py" <<'PY'
import sys
print("this is not json")
PY
OUT="$(corpus_total shell "python3 $FIXTURE_DIR/fake_garbage.py __ARGS__")"
[ "$OUT" = "NA" ] && pass "corpus_total parse failure -> NA" || fail "corpus_total parse failure: got '$OUT' want NA"

# cap hit without isDone -> ERR (cap shrunk via env so the test stays fast)
cat > "$FIXTURE_DIR/fake_loop.py" <<'PY'
import json, sys
print(json.dumps({"docs": [{"id": "r1"}], "isDone": False, "cursor": "c"}))
PY
OUT="$(CORPUS_MAX_PAGES=3 corpus_total shell "python3 $FIXTURE_DIR/fake_loop.py __ARGS__")"
[ "$OUT" = "ERR" ] && pass "corpus_total cap hit -> ERR" || fail "corpus_total cap hit: got '$OUT' want ERR"

# structural: local + REMOTE-heredoc corpus_total definitions stay in sync
BODY_1="$(awk '/^corpus_total\(\) \{/{n++; inbody=(n==1)} inbody{print} inbody && /^\}/{exit}' "$ROOT/deploy/dev-parity-check.sh")"
BODY_2="$(awk '/^corpus_total\(\) \{/{n++; inbody=(n==2)} inbody{print} inbody && /^\}/{exit}' "$ROOT/deploy/dev-parity-check.sh")"
[ -n "$BODY_1" ] && [ "$BODY_1" = "$BODY_2" ] \
    && pass "corpus_total definitions in sync (local + REMOTE heredoc)" \
    || fail "corpus_total definitions drifted between local and REMOTE heredoc"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "$FAIL FAILURES"; exit 1; }
