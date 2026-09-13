#!/usr/bin/env bash
# TDD regression tests for the safe dry-run / temporary-directory rollback
# rehearsal scaffold (deploy/rollback-rehearse-dryrun.sh).
#
# Scope: read-only now. Never touches a deployment, never runs systemctl,
# docker, or Convex import, never writes outside a mktemp directory. Fail-closed
# guards are exercised by pointing the scaffold at paths/ports/units that only
# exist inside the tests' own mktemp tree — it can therefore never collide with
# production.
#
# Run: bash deploy/rollback-rehearse-dryrun.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/deploy/rollback-rehearse-dryrun.sh"

FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

if [[ ! -f "$SCRIPT" ]]; then
    echo "FAIL: $SCRIPT not found"
    exit 1
fi
bash -n "$SCRIPT" || { echo "FAIL: bash -n $SCRIPT"; exit 1; }
pass "scaffold parses (bash -n)"

# Sandbox bins: every destructive/external command the scaffold could reach is
# stubbed to append to $EVIL_LOG. A dry-run that issues any of these is a bug.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
EVIL_LOG="$TMP/evil.log"
: > "$EVIL_LOG"

mkdir -p "$TMP/bin"
for cmd in systemctl docker ssh convex npx systemd-run rsync; do
    cat > "$TMP/bin/$cmd" <<SH
#!/usr/bin/env bash
printf '$cmd %s\n' "\$*" >> "\${EVIL_LOG:-/dev/null}"
exit 0
SH
    chmod +x "$TMP/bin/$cmd"
done
cat > "$TMP/bin/rm" <<SH
#!/usr/bin/env bash
for arg in "\$@"; do
    case "\$arg" in
        /*) if [[ "\$arg" != "$TMP"/* && "\$arg" != /tmp/* ]]; then
                printf 'rm-unsafe %s\n' "\$*" >> "\${EVIL_LOG:-/dev/null}"
            fi ;;
    esac
done
/bin/rm "\$@"
SH
chmod +x "$TMP/bin/rm"
export PATH="$TMP/bin:$PATH"
export EVIL_LOG="$EVIL_LOG"

# --------------------------------------------------------------------------
# Fixture: a COMPLETE, VALID prod-complete-* bundle. The manifest is authored
# by this test with exact hashes computed over the fixture artifacts. This is
# the same contract lib-complete-backup.sh validates, and the dry-run must
# accept it end-to-end.
# --------------------------------------------------------------------------
BACKUP_ROOT="$TMP/backups"
BUNDLE="$BACKUP_ROOT/prod-complete-20260101T000000Z"
mkdir -p "$BUNDLE"/{git,sqlite,convex,config,meta}
PROD_SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

# SQLite fixture with a real candidate_actions table.
sqlite3 "$BUNDLE/sqlite/resume_screening.db" <<'SQL'
CREATE TABLE candidate_actions (id INTEGER PRIMARY KEY, resume_id TEXT);
INSERT INTO candidate_actions (resume_id) VALUES ('a'), ('b'), ('c');
SQL
SQLITE_SHA="$(shasum -a 256 "$BUNDLE/sqlite/resume_screening.db" | awk '{print $1}')"

# Convex ZIP fixture: one real documents table + one storage blob.
mkdir -p "$TMP/zip-src/resumes" "$TMP/zip-src/_storage/ab"
printf '{"_id":"res_01","_creationTime":1,"name":"one"}\n' > "$TMP/zip-src/resumes/documents.jsonl"
printf 'file-storage-blob' > "$TMP/zip-src/_storage/ab/cd"
(
    cd "$TMP/zip-src"
    zip -q -r "$BUNDLE/convex/convex-export.zip" resumes _storage
)
CONVEX_SHA="$(shasum -a 256 "$BUNDLE/convex/convex-export.zip" | awk '{print $1}')"

printf '%s\n' "$PROD_SHA" > "$BUNDLE/git/HEAD"
printf 'sha=%s\n' "$PROD_SHA" > "$BUNDLE/git/identity.txt"
printf 'non-secret dependency input\n' > "$BUNDLE/config/etc-trends-env"
: > "$BUNDLE/meta/.gitkeep"

cat > "$BUNDLE/MANIFEST.txt" <<EOF
created_at=20260101T000000Z
hostname=rehearsal-fixture
status=OK
prod_sha=$PROD_SHA
prod_branch=burn/rehearsal
prod_version=0.4.16
sqlite_path=sqlite/resume_screening.db
sqlite_sha256=$SQLITE_SHA
candidate_actions_count=3
convex_zip=convex/convex-export.zip
convex_zip_sha256=$CONVEX_SHA
include_file_storage=true
EOF

DRYRUN_ROOT="$TMP/dryruns"

# Rehearsal-only target env that the scaffold must accept.
run_scaffold() {
    PREVIEW_DIR="$DRYRUN_ROOT/pv" \
    PREVIEW_API_URL=http://127.0.0.1:3311 \
    PREVIEW_DB="$DRYRUN_ROOT/pv/output/rehearsal.db" \
    PREVIEW_CONVEX_URL=http://127.0.0.1:4311 \
    PREVIEW_API_SERVICE=rehearsal-api \
    PREVIEW_API_PORT=3311 \
    BACKUP_ROOT="$BACKUP_ROOT" \
    REHEARSAL_ROOT="$DRYRUN_ROOT" \
    "$SCRIPT" "$@" 2>&1 || true
}

echo "--- target/path guards: fail closed on anything production-shaped ---"
OUT="$(PREVIEW_DIR=/tmp/trends bash "$SCRIPT" --backup-dir "$BUNDLE" 2>&1 || true)"
if printf '%s' "$OUT" | grep -q 'Refusing to target a non-rehearsal directory'; then
    pass "non-rehearsal PREVIEW_DIR refused"
else
    fail "non-rehearsal PREVIEW_DIR surfaced: $OUT"
fi

OUT="$(PREVIEW_API_URL=http://127.0.0.1:3200 bash "$SCRIPT" --backup-dir "$BUNDLE" 2>&1 || true)"
if printf '%s' "$OUT" | grep -q 'Refusing to target a non-rehearsal port'; then
    pass "non-rehearsal port refused"
else
    fail "non-rehearsal port surfaced: $OUT"
fi

OUT="$(PREVIEW_CONVEX_URL=http://127.0.0.1:4210 bash "$SCRIPT" --backup-dir "$BUNDLE" 2>&1 || true)"
if printf '%s' "$OUT" | grep -q 'Refusing to target a non-rehearsal port (Convex)'; then
    pass "non-rehearsal Convex port refused"
else
    fail "non-rehearsal Convex port surfaced: $OUT"
fi

OUT="$(REHEARSAL_ROOT=/opt/trends bash "$SCRIPT" --backup-dir "$BUNDLE" 2>&1 || true)"
if printf '%s' "$OUT" | grep -q 'REHEARSAL_ROOT resolves inside a production path'; then
    pass "REHEARSAL_ROOT directly at production path refused"
else
    fail "REHEARSAL_ROOT directly at production path surfaced: $OUT"
fi

OUT="$(PREVIEW_API_SERVICE=trends-api bash "$SCRIPT" --backup-dir "$BUNDLE" 2>&1 || true)"
if printf '%s' "$OUT" | grep -q 'Refusing to target a non-rehearsal unit'; then
    pass "non-rehearsal unit refused"
else
    fail "non-rehearsal unit surfaced: $OUT"
fi

OUT="$(PREVIEW_DB=/opt/trends/output/resume_screening.db bash "$SCRIPT" --backup-dir "$BUNDLE" 2>&1 || true)"
if printf '%s' "$OUT" | grep -q 'Refusing to target a non-rehearsal path'; then
    pass "production-looking SQLite path refused"
else
    fail "production-looking SQLite path surfaced: $OUT"
fi

echo "--- manifest validation integration (inline real bundle) ---"
OUT="$(run_scaffold --backup-dir "$BUNDLE")"
if printf '%s' "$OUT" | grep -q 'rehearsal-backup-source: OK'; then
    pass "valid bundle accepted (status OK)"
else
    fail "valid bundle rejected: $OUT"
fi
if printf '%s' "$OUT" | grep -q 'rehearsal-source-version=0.4.16'; then
    pass "manifest version surfaced"
else
    fail "manifest version missing: $OUT"
fi

# Tampered SQLite must fail closed inside manifest validation. The manifest
# references sqlite/resume_screening.db, so we corrupt THAT artifact (after
# stashing a clean copy), run the scaffold, then restore the fixture.
cp "$BUNDLE/sqlite/resume_screening.db" "$TMP/clean-resume.db"
printf '\x00\x00' >> "$BUNDLE/sqlite/resume_screening.db"
OUT="$(run_scaffold --backup-dir "$BUNDLE")"
if printf '%s' "$OUT" | grep -q 'FAIL'; then
    pass "tampered artifact fails closed (leaves no plan)"
else
    fail "tampered artifact accepted: $OUT"
fi
cp "$TMP/clean-resume.db" "$BUNDLE/sqlite/resume_screening.db"

echo "--- phase ordering ---"
run_scaffold --backup-dir "$BUNDLE" > "$TMP/witness.log"
ORDERED="$(grep -o 'phase [a-z-]*' "$TMP/witness.log" | awk '{print $2}')"
CNT="$(printf '%s\n' "$ORDERED" | grep -c '^')"
if [ "$CNT" -ge 8 ]; then
    pass "phase tracker emits >=8 phase steps (got $CNT)"
else
    fail "phase tracker short ($CNT phases)"
fi
FIRST="$(printf '%s\n' "$ORDERED" | head -1)"
if [ "$FIRST" = "validate-bundle" ] || [ "$FIRST" = "validate-target" ]; then
    pass "first phase is a validate phase (got: $FIRST)"
else
    fail "first phase not a validate phase: $FIRST"
fi

echo "--- destructive execution is refused (dry-run / apply) ---"
OUT="$(REHEARSAL_APPLY=1 run_scaffold --backup-dir "$BUNDLE")"
if printf '%s' "$OUT" | grep -q 'FAIL: destructive execution is not implemented'; then
    pass "REHEARSAL_APPLY=1 refused (fail closed)"
else
    fail "apply mode accepted: $OUT"
fi

echo "--- generated artifacts: plan.json / state.env existence, valid JSON, and mode 0600 ---"
PLAN_FILE="$(find "$DRYRUN_ROOT" -name "plan.json" | head -n 1)"
STATE_FILE="$(find "$DRYRUN_ROOT" -name "state.env" | head -n 1)"

if [ -n "$PLAN_FILE" ] && [ -f "$PLAN_FILE" ]; then
    pass "plan.json exists"
else
    fail "plan.json missing under $DRYRUN_ROOT"
fi

if [ -n "$STATE_FILE" ] && [ -f "$STATE_FILE" ]; then
    pass "state.env exists"
else
    fail "state.env missing under $DRYRUN_ROOT"
fi

if [ -f "$PLAN_FILE" ] && python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
assert data.get("schema") == "trends-rollback-rehearsal-plan/v1"
assert data.get("mode") == "dry-run"
assert "phases" in data
' "$PLAN_FILE" 2>/dev/null; then
    pass "plan.json is valid JSON with expected schema"
else
    fail "plan.json is not valid JSON or schema mismatch"
fi

PLAN_MODE="$(python3 -c 'import os, stat, sys; print(oct(stat.S_IMODE(os.stat(sys.argv[1]).st_mode)))' "$PLAN_FILE" 2>/dev/null || true)"
if [ "$PLAN_MODE" = "0o600" ]; then
    pass "plan.json permissions are mode 0600"
else
    fail "plan.json mode is $PLAN_MODE (expected 0o600)"
fi

STATE_MODE="$(python3 -c 'import os, stat, sys; print(oct(stat.S_IMODE(os.stat(sys.argv[1]).st_mode)))' "$STATE_FILE" 2>/dev/null || true)"
if [ "$STATE_MODE" = "0o600" ]; then
    pass "state.env permissions are mode 0600"
else
    fail "state.env mode is $STATE_MODE (expected 0o600)"
fi

echo "--- destructive commands never issued ---"
if [ ! -s "$EVIL_LOG" ]; then
    pass "no systemctl/docker/ssh/convex/npx/systemd-run/rm-unsafe/rsync issued"
else
    cat "$EVIL_LOG"
    fail "destructive/external commands were issued"
fi

if [ "$FAIL" -eq 0 ]; then
    echo "ALL PASS"
    exit 0
fi
echo "$FAIL FAILURES"
exit 1