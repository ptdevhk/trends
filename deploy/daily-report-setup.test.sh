#!/usr/bin/env bash
# Structural + behavioral tests for daily-report deploy setup.
# Run: bash deploy/daily-report-setup.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

echo "=== daily-report-setup structural ==="

[[ -f "$ROOT/deploy/lib-daily-report-setup.sh" ]] && pass "lib-daily-report-setup.sh present" || fail "lib missing"
[[ -x "$ROOT/deploy/daily-report-setup.sh" ]] && pass "daily-report-setup.sh executable" || fail "CLI not executable"

# shellcheck source=lib-daily-report-setup.sh
source "$ROOT/deploy/lib-daily-report-setup.sh"
# shellcheck source=lib-research-ingest-defaults.sh
source "$ROOT/deploy/lib-research-ingest-defaults.sh"

grep -q 'ensure_daily_report_build_env_lines()' "$ROOT/deploy/lib-daily-report-setup.sh" \
  && pass "ensure_daily_report_build_env_lines defined" || fail "missing ensure_daily_report_build_env_lines"
grep -q 'run_daily_report_setup()' "$ROOT/deploy/lib-daily-report-setup.sh" \
  && pass "run_daily_report_setup defined" || fail "missing run_daily_report_setup"

grep -q 'DAILY_REPORT_BUILD_ENABLED=1' "$ROOT/.env.example" && pass ".env.example DAILY_REPORT_BUILD_ENABLED" || fail ".env.example missing daily flag"
grep -q 'DAILY_REPORT_BUILD_ENABLED=1' "$ROOT/deploy/env.production" && pass "env.production DAILY_REPORT_BUILD_ENABLED" || fail "env.production missing daily flag"
grep -q 'DAILY_REPORT_BUILD_ENABLED=1' "$ROOT/deploy/env.preview" && pass "env.preview DAILY_REPORT_BUILD_ENABLED" || fail "env.preview missing daily flag"

grep -q 'run_daily_report_setup_production' "$ROOT/scripts/install.sh" \
  && pass "install.sh defines/calls run_daily_report_setup_production" || fail "install.sh missing daily setup"
grep -q 'TRENDS_INSTALL_REEXEC' "$ROOT/scripts/install.sh" \
  && pass "install.sh has post-align re-exec" || fail "install.sh missing re-exec"
grep -q 'run_daily_report_setup preview' "$ROOT/deploy/preview-upgrade.sh" \
  && pass "preview-upgrade calls run_daily_report_setup" || fail "preview-upgrade missing daily setup"
grep -q 'lib-daily-report-setup' "$ROOT/deploy/preview-upgrade.sh" \
  && pass "preview-upgrade sources daily lib" || fail "preview-upgrade missing daily lib source"

# BFF rebuild uses WORKER_URL (UI 重新生成今日)
grep -q 'WORKER_URL' "$ROOT/apps/api/src/routes/daily-reports.ts" \
  && pass "daily-reports rebuild uses WORKER_URL" || fail "rebuild still WORKER_BASE_URL-only"
grep -q 'WORKER_BASE_URL not configured' "$ROOT/apps/api/src/routes/daily-reports.ts" \
  && fail "stale WORKER_BASE_URL error string" || pass "no stale WORKER_BASE_URL-only error"

# install ensure uses || rc=$? not set +e sandwich for research ensure
if grep -A20 'ensure_research_ingest_env_production()' "$ROOT/scripts/install.sh" | grep -qE 'ensure_research_ingest_env_lines.*"\$CONFIG_DIR/env".*\|\| ensure_rc=\$?'; then
  pass "install ensure captures via || ensure_rc=\$?"
else
  fail "install ensure missing || ensure_rc=\$? capture"
fi

echo "=== daily-report-setup behavioral (env arm) ==="

TMP_ENV="$(mktemp "${TMPDIR:-/tmp}/daily-report-setup-XXXXXX")"
trap 'rm -f "$TMP_ENV"' EXIT

printf 'AI_MODEL=x\n' > "$TMP_ENV"
rc=0
ensure_research_ingest_env_lines "$TMP_ENV" production || rc=$?
grep -q '^RESEARCH_INGEST_ENABLED=1$' "$TMP_ENV" && pass "research flag armed" || fail "research flag missing"
grep -q '^DAILY_REPORT_BUILD_ENABLED=1$' "$TMP_ENV" && pass "daily flag armed via combined ensure" || fail "daily flag not armed"
[[ "$rc" -eq 1 ]] && pass "combined ensure rc=1" || fail "combined ensure rc=$rc"

printf 'DAILY_REPORT_BUILD_ENABLED=0\nRESEARCH_INGEST_ENABLED=1\n' > "$TMP_ENV"
rc=0
ensure_daily_report_build_env_lines "$TMP_ENV" || rc=$?
grep -q '^DAILY_REPORT_BUILD_ENABLED=0$' "$TMP_ENV" && pass "explicit daily=0 preserved" || fail "daily=0 overwritten"

printf 'RESEARCH_INGEST_ENABLED=1\nWORKER_URL=http://127.0.0.1:8000\nRESEARCH_HOTLIST_API_URL=https://newsnow.busiyi.world/api/s\nDAILY_REPORT_BUILD_ENABLED=1\n' > "$TMP_ENV"
rc=0
ensure_research_ingest_env_lines "$TMP_ENV" production || rc=$?
[[ "$rc" -eq 0 ]] && pass "idempotent ensure rc=0" || fail "idempotent rc=$rc"

echo "=== shanghai today helper ==="
TODAY="$(daily_report_shanghai_today)"
[[ "$TODAY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && pass "shanghai today=$TODAY" || fail "bad today=$TODAY"

echo "Summary: $FAIL failure(s)"
[[ "$FAIL" -eq 0 ]]
