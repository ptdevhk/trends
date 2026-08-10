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

# Build fixture export: one table with showBlocked, one to drop, one missing from schema
mkdir -p "$TMP/src/screening_sessions" "$TMP/src/system_settings" "$TMP/src/job_descriptions"
printf '{"_id":"s1","config":{"filters":{"showBlocked":true,"q":"cnc"}}}\n' > "$TMP/src/screening_sessions/documents.jsonl"
printf '"uniform"\n' > "$TMP/src/screening_sessions/generated_schema.jsonl"
printf '{"_id":"x","maintenanceMode":true}\n' > "$TMP/src/system_settings/documents.jsonl"
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
# 2. system_settings dropped
unzip -l "$TMP/out.zip" | grep -q "system_settings/" && fail "system_settings still present" || pass "system_settings dropped"
# 3. missing schema table materialized empty
unzip -p "$TMP/out.zip" resume_digests/documents.jsonl | grep -q . && fail "resume_digests not empty" || pass "resume_digests materialized empty"
unzip -p "$TMP/out.zip" resume_digests/generated_schema.jsonl | grep -q uniform || fail "resume_digests schema marker missing"
# 4. existing tables survive
unzip -p "$TMP/out.zip" job_descriptions/documents.jsonl | grep -q '"jd1"' && pass "job_descriptions preserved" || fail "job_descriptions lost"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "$FAIL FAILURES"; exit 1; }
