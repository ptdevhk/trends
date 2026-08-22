#!/usr/bin/env bash
# Tests for preview sync hardening (handoff D1/D2/R3):
#   - cancel_stale_convex_imports / stale_import_ids_from_sqlite
#     (lib-preview-common.sh) — wedged in_progress import cleanup via the
#     backend cancel API, never via journal deletes (append-only journal)
#   - CONVEX_IMPORT_TIMEOUT_SEC (restore-preview-from-prod.sh) — configurable
#     import timeout replacing the fixed 900s
#   - Step 3d system_settings smoke (restore-preview-from-prod.sh) — env-local
#     keys absent = expected null, convex run failure = fail fast
# Run: bash deploy/restore-stale-import.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

COMMON="$ROOT/deploy/lib-preview-common.sh"
RESTORE="$ROOT/deploy/restore-preview-from-prod.sh"

# shellcheck source=lib-preview-common.sh
source "$COMMON"

echo "--- structural: helpers exist and are wired ---"
bash -n "$COMMON" && bash -n "$RESTORE" && pass "bash -n clean" || fail "bash -n failed"

grep -q '^stale_import_ids_from_sqlite()' "$COMMON" && pass "stale_import_ids_from_sqlite defined" || fail "stale_import_ids_from_sqlite missing"
grep -q '^cancel_stale_convex_imports()' "$COMMON" && pass "cancel_stale_convex_imports defined" || fail "cancel_stale_convex_imports missing"
grep -q '9A977BA13592DE3CB25B9458012D507A' "$COMMON" && pass "import journal table id constant used" || fail "import journal table id constant missing"
grep -q 'sqlite3 -readonly' "$COMMON" && pass "journal read is read-only" || fail "journal read not read-only"
if grep -qE 'DELETE FROM|delete from' "$COMMON"; then
    fail "helper contains DELETE FROM (journal is append-only)"
else
    pass "no DELETE FROM in helper (append-only honored)"
fi
grep -q '/api/cancel_import' "$COMMON" && pass "cancel uses backend API /api/cancel_import" || fail "cancel API path missing"

grep -q 'CONVEX_IMPORT_TIMEOUT_SEC="${CONVEX_IMPORT_TIMEOUT_SEC:-3600}"' "$RESTORE" && pass "CONVEX_IMPORT_TIMEOUT_SEC default 3600" || fail "CONVEX_IMPORT_TIMEOUT_SEC default missing"
grep -q 'timeout ${CONVEX_IMPORT_TIMEOUT_SEC} npx convex import' "$RESTORE" && pass "import uses CONVEX_IMPORT_TIMEOUT_SEC" || fail "import does not use CONVEX_IMPORT_TIMEOUT_SEC"
if grep -q 'timeout 900' "$RESTORE"; then
    fail "literal timeout 900 still present"
else
    pass "no literal timeout 900"
fi
grep -q 'cancel_stale_convex_imports' "$RESTORE" && pass "restore script calls cancel_stale_convex_imports" || fail "restore script missing cancel call"
grep -q 'refusing to import over a possibly wedged import' "$RESTORE" && pass "fail-fast message present" || fail "fail-fast message missing"
CANCEL_LINE="$(grep -n 'cancel_stale_convex_imports' "$RESTORE" | head -1 | cut -d: -f1)"
IMPORT_LINE="$(grep -n 'npx convex import --replace-all' "$RESTORE" | head -1 | cut -d: -f1)"
if [ -n "$CANCEL_LINE" ] && [ -n "$IMPORT_LINE" ] && [ "$CANCEL_LINE" -lt "$IMPORT_LINE" ]; then
    pass "cancel runs before import (line $CANCEL_LINE < $IMPORT_LINE)"
else
    fail "cancel not before import (cancel=$CANCEL_LINE import=$IMPORT_LINE)"
fi

echo "--- functional: stale_import_ids_from_sqlite on fixture journals ---"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

make_journal() {
    local db="$1"
    sqlite3 "$db" <<'SQL'
CREATE TABLE documents (
  id BLOB,
  ts INTEGER,
  table_id BLOB,
  json_value TEXT,
  deleted INTEGER,
  prev_ts INTEGER
);
SQL
}

# Combined fixture mirroring the real preview backend journal layout.
# Import journal rows carry table_id x'9A977BA13592DE3CB25B9458012D507A'.
make_journal "$TMP/journal.sqlite3"
sqlite3 "$TMP/journal.sqlite3" <<'SQL'
-- A: wedged import, two in_progress revisions (must dedup to one id)
INSERT INTO documents VALUES (x'01',100,x'9A977BA13592DE3CB25B9458012D507A','{"_id":"imp-wedged","state":{"state":"in_progress"},"checkpoints":[]}',0,NULL);
INSERT INTO documents VALUES (x'02',200,x'9A977BA13592DE3CB25B9458012D507A','{"_id":"imp-wedged","state":{"state":"in_progress"},"checkpoints":[]}',0,100);
-- B: in_progress superseded by completed (must NOT be flagged)
INSERT INTO documents VALUES (x'03',300,x'9A977BA13592DE3CB25B9458012D507A','{"_id":"imp-completed","state":{"state":"in_progress"},"checkpoints":[]}',0,NULL);
INSERT INTO documents VALUES (x'04',400,x'9A977BA13592DE3CB25B9458012D507A','{"_id":"imp-completed","state":{"state":"completed","completedRows":49516},"checkpoints":[]}',0,300);
-- C: failed latest (must NOT be flagged)
INSERT INTO documents VALUES (x'05',500,x'9A977BA13592DE3CB25B9458012D507A','{"_id":"imp-failed","state":{"state":"failed"},"checkpoints":[]}',0,NULL);
-- D: non-import table row shaped like in_progress, no checkpoints marker (must NOT be flagged)
INSERT INTO documents VALUES (x'06',600,x'ABABABABABABABABABABABABABABABAB','{"_id":"doc-other","state":{"state":"in_progress"}}',0,NULL);
-- E: tombstoned import (latest revision deleted; must NOT be flagged)
INSERT INTO documents VALUES (x'07',700,x'9A977BA13592DE3CB25B9458012D507A','{"_id":"imp-deleted","state":{"state":"in_progress"},"checkpoints":[]}',0,NULL);
INSERT INTO documents VALUES (x'08',800,x'9A977BA13592DE3CB25B9458012D507A','{"_id":"imp-deleted","state":{"state":"in_progress"},"checkpoints":[]}',1,700);
SQL

OUT="$(stale_import_ids_from_sqlite "$TMP/journal.sqlite3")"
printf '%s\n' "$OUT" | grep -qx 'imp-wedged' && pass "wedged import detected" || fail "wedged import not detected"
COUNT="$(printf '%s\n' "$OUT" | sed '/^[[:space:]]*$/d' | wc -l)"
if [ "$COUNT" -eq 1 ]; then
    pass "exactly one stale id (dedup/supersede/tombstone/other-table filtered)"
else
    fail "unexpected stale id count=$COUNT: $(printf '%s' "$OUT" | tr '\n' ' ')"
fi

# Clean journal (no in_progress anywhere) -> empty output, exit 0
make_journal "$TMP/clean.sqlite3"
sqlite3 "$TMP/clean.sqlite3" <<'SQL'
INSERT INTO documents VALUES (x'01',100,x'9A977BA13592DE3CB25B9458012D507A','{"_id":"imp-only","state":{"state":"completed","completedRows":10},"checkpoints":[]}',0,NULL);
SQL
CLEAN_OUT="$(stale_import_ids_from_sqlite "$TMP/clean.sqlite3")"
if [ -z "$(printf '%s' "$CLEAN_OUT" | sed '/^[[:space:]]*$/d')" ]; then
    pass "clean journal -> empty"
else
    fail "clean journal returned: $CLEAN_OUT"
fi

# Missing journal -> exit 1
set +e
stale_import_ids_from_sqlite "$TMP/does-not-exist.sqlite3" >/dev/null 2>&1
MISSING_STATUS=$?
set -e
if [ "$MISSING_STATUS" -ne 0 ]; then
    pass "missing journal -> exit 1"
else
    fail "missing journal accepted (exit 0)"
fi

echo "--- functional: Step 3d settings smoke parser ---"
# Extract parse_convex_json_value verbatim from the restore script (ends at
# the first column-0 brace after the function's opening line).
awk '/^parse_convex_json_value\(\)/{f=1} f{print} f && /^}/{exit}' "$RESTORE" > "$TMP/parser.sh"
source "$TMP/parser.sh"

if [ "$(printf '' | parse_convex_json_value)" = "null" ]; then
    pass "empty output -> null (absent row)"
else
    fail "empty output did not parse to null"
fi
if [ "$(printf 'false\n' | parse_convex_json_value)" = "false" ]; then
    pass "plain false -> false"
else
    fail "plain false not parsed"
fi
if [ "$(printf '\xe2\x9c\x94 false\n' | parse_convex_json_value)" = "false" ]; then
    pass "CLI marker line -> false"
else
    fail "CLI marker line not parsed"
fi
if [ "$(printf '{"key":"x","value":3}\n' | parse_convex_json_value)" = '{"key": "x", "value": 3}' ]; then
    pass "JSON object -> echoed"
else
    fail "JSON object not echoed"
fi
set +e
printf 'not json at all\n' | parse_convex_json_value >/dev/null 2>&1
PARSE_BAD=$?
set -e
if [ "$PARSE_BAD" -ne 0 ]; then
    pass "unparseable output -> exit 1"
else
    fail "unparseable output accepted"
fi

echo "--- structural: Step 3d smoke (R3) ---"
grep -q 'rc=\$?' "$RESTORE" && pass "settings helpers capture convex run rc" || fail "settings helpers missing rc capture"
grep -q 'convex run failed (rc=' "$RESTORE" && pass "convex run failure -> fail fast" || fail "convex run failure message missing"
grep -q 'print("null")' "$RESTORE" && pass "parser null semantics present" || fail "parser null semantics missing"
grep -q 'absent (expected: environment-local key is filtered' "$RESTORE" && pass "absent-row message present" || fail "absent-row message missing"
grep -q 'not configured on either side' "$RESTORE" && pass "both-null RWL message present" || fail "both-null RWL message missing"
grep -q 'FATAL: preview maintenanceMode=true' "$RESTORE" && pass "maintenanceMode=true FATAL gate intact" || fail "maintenanceMode FATAL gate missing"
grep -q 'maintenanceMode' "$RESTORE" && grep -q 'resumeWorkHistoryLimit' "$RESTORE" && pass "smoke checks both keys" || fail "smoke keys missing"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "$FAIL FAILURES"; exit 1; }
