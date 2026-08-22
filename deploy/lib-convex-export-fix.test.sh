#!/usr/bin/env bash
# Tests for lib-convex-export-fix.sh. Run: bash deploy/lib-convex-export-fix.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# shellcheck source=lib-convex-export-fix.sh
source "$ROOT/deploy/lib-convex-export-fix.sh"

# Build fixture export: one table with showBlocked, system_settings with
# real-shape rows (keyed by "key"), one table missing from schema
mkdir -p "$TMP/src/screening_sessions" "$TMP/src/system_settings" "$TMP/src/job_descriptions"
printf '{"_id":"s1","config":{"filters":{"showBlocked":true,"q":"cnc"}}}\n' > "$TMP/src/screening_sessions/documents.jsonl"
printf '"uniform"\n' > "$TMP/src/screening_sessions/generated_schema.jsonl"
printf '{"_id":"m1","key":"maintenanceMode","value":false,"updatedAt":0,"updatedBy":"restore-script"}\n' > "$TMP/src/system_settings/documents.jsonl"
printf '{"_id":"p1","key":"industryMaintenanceSchedulePaused","value":true,"updatedAt":0,"updatedBy":"restore-script"}\n' >> "$TMP/src/system_settings/documents.jsonl"
printf '{"_id":"r1","key":"resumeWorkHistoryLimit","value":15,"updatedAt":0,"updatedBy":"operator"}\n' >> "$TMP/src/system_settings/documents.jsonl"
printf '"uniform"\n' > "$TMP/src/system_settings/generated_schema.jsonl"
printf '{"_id":"jd1"}\n' > "$TMP/src/job_descriptions/documents.jsonl"
printf '"uniform"\n' > "$TMP/src/job_descriptions/generated_schema.jsonl"
( cd "$TMP/src" && zip -rq "$TMP/in.zip" . )

cat > "$TMP/schema.ts" <<'SCHEMA'
export const schema = {
  job_descriptions: defineTable({}),
  resume_digests: defineTable({}),
  system_settings: defineTable({}),
}
SCHEMA

fix_convex_export "$TMP/in.zip" "$TMP/schema.ts" "$TMP/out.zip"

# 1. showBlocked stripped
unzip -p "$TMP/out.zip" screening_sessions/documents.jsonl | grep -q showBlocked && fail "showBlocked not stripped" || pass "showBlocked stripped"
# 2. system_settings kept, but environment-local rows dropped
unzip -l "$TMP/out.zip" | grep -q "system_settings/" || fail "system_settings dropped entirely"
unzip -p "$TMP/out.zip" system_settings/documents.jsonl | grep -q '"key":"maintenanceMode"' && fail "maintenanceMode row not dropped" || pass "maintenanceMode row dropped"
unzip -p "$TMP/out.zip" system_settings/documents.jsonl | grep -q '"key":"industryMaintenanceSchedulePaused"' && fail "industryMaintenanceSchedulePaused row not dropped" || pass "industryMaintenanceSchedulePaused row dropped"
# 3. non-env-local settings survive (search-affecting settings must propagate)
unzip -p "$TMP/out.zip" system_settings/documents.jsonl | grep -q '"key":"resumeWorkHistoryLimit"' && pass "resumeWorkHistoryLimit preserved" || fail "resumeWorkHistoryLimit lost"
# 4. missing schema table materialized empty
unzip -p "$TMP/out.zip" resume_digests/documents.jsonl | grep -q . && fail "resume_digests not empty" || pass "resume_digests materialized empty"
unzip -p "$TMP/out.zip" resume_digests/generated_schema.jsonl | grep -q uniform || fail "resume_digests schema marker missing"
# 5. existing tables survive
unzip -p "$TMP/out.zip" job_descriptions/documents.jsonl | grep -q '"jd1"' && pass "job_descriptions preserved" || fail "job_descriptions lost"

# 6. RETURN trap must not leak past fix_convex_export (regression: the trap
#    survives the function's return, but local `work` is gone — a later
#    function/source completion fires it and under `set -u` the caller aborts
#    with "work: unbound variable"). The subshell must finish exit 0 with no
#    unbound-variable error.
printf 'true\n' > "$TMP/leak-src.sh"
set +e
leak_out="$(
    {
        set -u
        # shellcheck source=lib-convex-export-fix.sh
        source "$ROOT/deploy/lib-convex-export-fix.sh"
        fix_convex_export "$TMP/in.zip" "$TMP/schema.ts" "$TMP/out-leak.zip" >/dev/null
        dummy_func() { :; }
        dummy_func
        source "$TMP/leak-src.sh"
        echo "SUBSHELL_OK"
    } 2>&1
)"
leak_status=$?
set -e
if [ "$leak_status" -eq 0 ] \
    && ! printf '%s' "$leak_out" | grep -q "unbound variable" \
    && printf '%s' "$leak_out" | grep -q "SUBSHELL_OK"; then
    pass "no RETURN-trap leak after fix_convex_export (set -u subshell completes)"
else
    fail "RETURN trap leaked past fix_convex_export (status=$leak_status, output: $leak_out)"
fi

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "$FAIL FAILURES"; exit 1; }
