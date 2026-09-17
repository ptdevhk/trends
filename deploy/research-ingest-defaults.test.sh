#!/usr/bin/env bash
# Structural + helper tests for research-ingest defaults on install/upgrade.
# Run: bash deploy/research-ingest-defaults.test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

echo "=== research-ingest-defaults structural ==="

# shellcheck source=lib-research-ingest-defaults.sh
source "$ROOT/deploy/lib-research-ingest-defaults.sh"

[[ -f "$ROOT/deploy/lib-research-ingest-defaults.sh" ]] && pass "lib-research-ingest-defaults.sh present" || fail "helper missing"
grep -q 'ensure_research_ingest_env_lines()' "$ROOT/deploy/lib-research-ingest-defaults.sh" && pass "helper defines ensure_research_ingest_env_lines" || fail "helper missing function"

# Templates document the keys
grep -q 'RESEARCH_INGEST_ENABLED=1' "$ROOT/.env.example" && pass ".env.example RESEARCH_INGEST_ENABLED=1" || fail ".env.example missing =1"
grep -q 'RESEARCH_INGEST_ENABLED=1' "$ROOT/deploy/env.production" && pass "env.production RESEARCH_INGEST_ENABLED=1" || fail "env.production missing =1"
grep -q 'RESEARCH_INGEST_ENABLED=1' "$ROOT/deploy/env.preview" && pass "env.preview RESEARCH_INGEST_ENABLED=1" || fail "env.preview missing =1"
grep -q '^WORKER_URL=' "$ROOT/deploy/env.preview" && pass "env.preview WORKER_URL explicit" || fail "env.preview missing explicit WORKER_URL"
PREVIEW_WORKER_URL=$(grep -E '^WORKER_URL=' "$ROOT/deploy/env.preview" | head -1 | cut -d= -f2-)
case "$PREVIEW_WORKER_URL" in
  http://127.0.0.1:8003) pass "env.preview WORKER_URL=$PREVIEW_WORKER_URL (:8003)" ;;
  *) fail "env.preview WORKER_URL=$PREVIEW_WORKER_URL should be :8003" ;;
esac

# install.sh calls the helper before worker restarts
grep -q 'lib-research-ingest-defaults' "$ROOT/scripts/install.sh" && pass "install.sh references helper" || fail "install.sh missing helper reference"
grep -q 'ensure_research_ingest_env_lines' "$ROOT/scripts/install.sh" && pass "install.sh calls ensure_research_ingest_env_lines" || fail "install.sh missing ensure call"

# preview-upgrade.sh calls the helper and starts trends-preview-worker
grep -q 'lib-research-ingest-defaults' "$ROOT/deploy/preview-upgrade.sh" && pass "preview-upgrade references helper" || fail "preview-upgrade missing helper reference"
grep -q 'ensure_research_ingest_env_lines' "$ROOT/deploy/preview-upgrade.sh" && pass "preview-upgrade calls ensure_research_ingest_env_lines" || fail "preview-upgrade missing ensure call"
grep -q 'trends-preview-worker\.service' "$ROOT/deploy/preview-upgrade.sh" && pass "preview-upgrade installs/restarts trends-preview-worker" || fail "preview-upgrade missing trends-preview-worker"

# Preview scheduler unit exists
[[ -f "$ROOT/deploy/systemd/trends-preview-worker.service" ]] && pass "trends-preview-worker.service present" || fail "preview worker unit missing"
grep -q 'apps\.worker' "$ROOT/deploy/systemd/trends-preview-worker.service" && pass "preview worker runs apps.worker (scheduler)" || fail "preview worker not scheduler module"
grep -q '\.env\.preview' "$ROOT/deploy/systemd/trends-preview-worker.service" && pass "preview worker EnvironmentFile .env.preview" || fail "preview worker missing EnvironmentFile"
grep -q 'User=ubuntu' "$ROOT/deploy/systemd/trends-preview-worker.service" && pass "preview worker User=ubuntu" || fail "preview worker user wrong"

echo "=== research-ingest-defaults behavioral ==="

TMP_ENV="$(mktemp "${TMPDIR:-/tmp}/research-ingest-XXXXXX")"
trap 'rm -f "$TMP_ENV"' EXIT

# 1) Missing flag → adds 1 (rc=1 changed)
printf 'AI_MODEL=x\n' > "$TMP_ENV"
set +e
ensure_research_ingest_env_lines "$TMP_ENV" production
RC=$?
set -e
grep -q '^RESEARCH_INGEST_ENABLED=1$' "$TMP_ENV" && pass "missing flag → adds =1" || fail "missing flag not added"
[[ "$RC" -eq 1 ]] && pass "missing-flag rc=1 (changed)" || fail "missing-flag rc=$RC expected 1"

# 2) Explicit 0 unchanged (and not re-added)
printf 'RESEARCH_INGEST_ENABLED=0\n' > "$TMP_ENV"
set +e; ensure_research_ingest_env_lines "$TMP_ENV" production; RC=$?; set -e
grep -q '^RESEARCH_INGEST_ENABLED=0$' "$TMP_ENV" && pass "explicit 0 unchanged" || fail "explicit 0 overwritten"

# 3) Preview missing WORKER_URL → :8003
printf 'RESEARCH_INGEST_ENABLED=1\n' > "$TMP_ENV"
set +e; ensure_research_ingest_env_lines "$TMP_ENV" preview; RC=$?; set -e
grep -q '^WORKER_URL=http://127.0.0.1:8003$' "$TMP_ENV" && pass "preview missing WORKER_URL → :8003" || fail "preview WORKER_URL not :8003"
grep -q '^RESEARCH_HOTLIST_API_URL=https://newsnow.busiyi.world/api/s$' "$TMP_ENV" && pass "missing hotlist URL → NewsNow default" || fail "hotlist URL not added"

# 4) Preview WORKER_URL wrong port (:8000) → repaired to :8003
printf 'RESEARCH_INGEST_ENABLED=1\nWORKER_URL=http://127.0.0.1:8000\n' > "$TMP_ENV"
set +e; ensure_research_ingest_env_lines "$TMP_ENV" preview; RC=$?; set -e
grep -q '^WORKER_URL=http://127.0.0.1:8003$' "$TMP_ENV" && pass "preview wrong-port WORKER_URL repaired → :8003" || fail "preview wrong-port not repaired"
grep -q 'WORKER_URL=http://127.0.0.1:8000' "$TMP_ENV" && fail "stale :8000 WORKER_URL remains" || pass "no stale :8000 WORKER_URL"

# 5) Production missing WORKER_URL → :8000
printf 'RESEARCH_INGEST_ENABLED=1\n' > "$TMP_ENV"
set +e; ensure_research_ingest_env_lines "$TMP_ENV" production; RC=$?; set -e
grep -q '^WORKER_URL=http://127.0.0.1:8000$' "$TMP_ENV" && pass "production missing WORKER_URL → :8000" || fail "production WORKER_URL not :8000"

# 6) Set RESEARCH_HOTLIST_API_URL is NOT overwritten
printf 'RESEARCH_INGEST_ENABLED=1\nRESEARCH_HOTLIST_API_URL=http://custom/x\nWORKER_URL=http://127.0.0.1:8003\n' > "$TMP_ENV"
set +e; ensure_research_ingest_env_lines "$TMP_ENV" preview; RC=$?; set -e
grep -q '^RESEARCH_HOTLIST_API_URL=http://custom/x$' "$TMP_ENV" && pass "set hotlist URL not overwritten" || fail "set hotlist URL overwritten"

# 7) Non-loopback WORKER_URL left alone (explicit external target)
printf 'RESEARCH_INGEST_ENABLED=1\nWORKER_URL=https://worker.example.com:9999\n' > "$TMP_ENV"
set +e; ensure_research_ingest_env_lines "$TMP_ENV" preview; RC=$?; set -e
grep -q '^WORKER_URL=https://worker.example.com:9999$' "$TMP_ENV" && pass "non-loopback WORKER_URL preserved" || fail "non-loopback WORKER_URL rewritten"

echo "Summary: $FAIL failure(s)"
[[ "$FAIL" -eq 0 ]]
