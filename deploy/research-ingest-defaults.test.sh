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

echo "=== preview-upgrade.sh ERR-trap capture (set +e sandwich regression) ==="

UPGRADE_SCRIPT="$ROOT/deploy/preview-upgrade.sh"

# Under `set -Eeuo pipefail` + `trap ... ERR`, a `set +e` sandwich does NOT
# suppress the trap: bash fires ERR for a function's own non-zero `return` even
# while errexit is off, so the rc=1 ("changed") return from
# ensure_research_ingest_env_lines aborted the live preview upgrade right after
# it wrote the env keys. The call must now be captured with `cmd || rc=$?`.
grep -q 'ensure_research_ingest_env_lines "\$PREVIEW_ENV_FILE" preview || RESEARCH_ENSURE_RC=\$?' "$UPGRADE_SCRIPT" \
  && pass "preview-upgrade captures ingest ensure via '|| RESEARCH_ENSURE_RC=\$?'" \
  || fail "preview-upgrade missing '|| RESEARCH_ENSURE_RC=\$?' ingest capture"

# A real sandwich is a `set +e` at the start of a line (preceded by tab/space).
# Comments may mention the literal string, so anchor to an actual statement.
if command grep -nE '^[[:space:]]*set +e([[:space:]]|$)' "$UPGRADE_SCRIPT" | command grep -v '^[0-9]*: *#'; then
  fail "preview-upgrade.sh still has a 'set +e' sandwich (ERR-trap landmine):"
  command grep -nE '^[[:space:]]*set +e([[:space:]]|$)' "$UPGRADE_SCRIPT" | command grep -v '^[0-9]*: *#' | sed 's/^/    /'
else
  pass "no 'set +e' sandwich remains in preview-upgrade.sh"
fi

# Siblings had the same landmine: same capture, non-zero-by-design returns.
grep -q 'ensure_bff_env_lines "\$PREVIEW_ENV_FILE" preview "\$PREVIEW_BFF_DEFAULT" || ensure_rc=\$?' "$UPGRADE_SCRIPT" \
  && pass "preview-upgrade captures ensure_bff_env_lines via '|| ensure_rc=\$?'" \
  || fail "preview-upgrade missing '|| ensure_rc=\$?' BFF capture"
# Gate subprocess exits 1 on unverifiable doctor (auth/JSON/timeout). That must
# be the test of an `if` so trap ERR cannot abort after the code is already live.
if grep -A25 'Search-data freshness gate' "$UPGRADE_SCRIPT" | grep -qE '^[[:space:]]*if PREVIEW_DIR='; then
  pass "preview-upgrade runs freshness gate as an if-test (ERR-safe)"
else
  fail "preview-upgrade freshness gate is not an if-test (doctor rc=1 will ERR-abort after deploy)"
fi
if grep -A30 'Search-data freshness gate' "$UPGRADE_SCRIPT" | grep -q 'FRESH_RC=\$?'; then
  pass "preview-upgrade records FRESH_RC=\$? in the gate if-else"
else
  fail "preview-upgrade missing FRESH_RC=\$? capture for the freshness gate"
fi
grep -q '|| RESEARCH_CURL_RC=\$?' "$UPGRADE_SCRIPT" \
  && pass "preview-upgrade captures ingest curl via '|| RESEARCH_CURL_RC=\$?'" \
  || fail "preview-upgrade missing '|| RESEARCH_CURL_RC=\$?' curl capture"

# The script must still keep its own ERR trap (the fix is the capture, not
# dropping the trap).
grep -q "trap 'on_err \$LINENO' ERR" "$UPGRADE_SCRIPT" \
  && pass "preview-upgrade keeps its ERR trap" \
  || fail "preview-upgrade ERR trap removed"
grep -q 'RESEARCH_ENSURE_RC=0' "$UPGRADE_SCRIPT" \
  && pass "preview-upgrade pre-initialises RESEARCH_ENSURE_RC=0" \
  || fail "preview-upgrade missing RESEARCH_ENSURE_RC=0 pre-init"

echo "=== ERR-trap harness: '|| rc=\$?' survives set -Eeuo pipefail + trap ERR ==="

HARNESS_ENV="$(mktemp "${TMPDIR:-/tmp}/research-ingest-err-XXXXXX")"
rm -f "$HARNESS_ENV"
trap 'rm -f "$TMP_ENV" "$HARNESS_ENV"' EXIT

# $1 = sandwich (pre-fix) | orrc (post-fix). Runs in a real `bash -c` subshell
# with the same flags + trap shape as preview-upgrade.sh. Prints TRAP_FIRED when
# the ERR trap fires; prints "SURVIVED rc=<n>" when the capture held.
run_err_harness() {
  HARNESS_ENV="$HARNESS_ENV" HARNESS_STYLE="$1" HARNESS_HELPER="$ROOT/deploy/lib-research-ingest-defaults.sh" \
    bash -c '
      set -Eeuo pipefail
      trap "echo TRAP_FIRED; exit 1" ERR
      # shellcheck disable=SC1090
      source "$HARNESS_HELPER"
      if [[ "$HARNESS_STYLE" == "sandwich" ]]; then
        set +e
        ensure_research_ingest_env_lines "$HARNESS_ENV" preview
        rc=$?
        set -e
      else
        rc=0
        ensure_research_ingest_env_lines "$HARNESS_ENV" preview || rc=$?
      fi
      echo "SURVIVED rc=$rc"
    ' 2>&1 || true
}

# 1) Bug proof: the old set +e sandwich must fire the trap.
printf 'AI_MODEL=x\n' > "$HARNESS_ENV"
SANDWICH_OUT="$(run_err_harness sandwich)"
[[ "$SANDWICH_OUT" == *TRAP_FIRED* ]] \
  && pass "set +e sandwich DOES fire ERR trap under set -E (bug reproduced)" \
  || fail "set +e sandwich unexpectedly survived: $SANDWICH_OUT"
[[ "$SANDWICH_OUT" != *SURVIVED* ]] \
  && pass "set +e sandwich never reaches the rc capture (aborts)" \
  || fail "set +e sandwich survived — bug not reproduced"

# 2) Fix proof: `|| rc=$?` survives and reports rc=1 while adding the keys.
printf 'AI_MODEL=x\n' > "$HARNESS_ENV"
ORRC_OUT="$(run_err_harness orrc)"
[[ "$ORRC_OUT" != *TRAP_FIRED* ]] \
  && pass "'|| rc=\$?' does NOT fire the ERR trap" \
  || fail "'|| rc=\$?' still fired the ERR trap: $ORRC_OUT"
[[ "$ORRC_OUT" == *"SURVIVED rc=1"* ]] \
  && pass "'|| rc=\$?' survives and reports rc=1 (changed)" \
  || fail "'|| rc=\$?' rc wrong: $ORRC_OUT"
grep -q '^RESEARCH_INGEST_ENABLED=1$' "$HARNESS_ENV" \
  && pass "changed-run still wrote RESEARCH_INGEST_ENABLED=1" \
  || fail "changed-run did not write the env keys"
grep -q '^WORKER_URL=http://127.0.0.1:8003$' "$HARNESS_ENV" \
  && pass "changed-run still wrote preview WORKER_URL :8003" \
  || fail "changed-run did not write WORKER_URL"
grep -q '^RESEARCH_HOTLIST_API_URL=https://newsnow.busiyi.world/api/s$' "$HARNESS_ENV" \
  && pass "changed-run still wrote RESEARCH_HOTLIST_API_URL" \
  || fail "changed-run did not write RESEARCH_HOTLIST_API_URL"

# 3) Idempotent re-run through the same harness → rc=0 (unchanged), no trap.
ORRC_OUT2="$(run_err_harness orrc)"
[[ "$ORRC_OUT2" == *"SURVIVED rc=0"* ]] \
  && pass "'|| rc=\$?' second run reports rc=0 (unchanged)" \
  || fail "second-run rc wrong: $ORRC_OUT2"

# 4) rc=2 (missing file) also survives the capture.
rm -f "$HARNESS_ENV"
ORRC_OUT3="$(run_err_harness orrc)"
[[ "$ORRC_OUT3" == *"SURVIVED rc=2"* ]] \
  && pass "'|| rc=\$?' survives missing-file rc=2" \
  || fail "missing-file rc wrong: $ORRC_OUT3"

echo "=== freshness-gate ERR-trap: external bash exit 1 (doctor rc=1) ==="
# preview-upgrade invokes `bash "$FRESHNESS_SCRIPT"`, not a function. The
# 2026-09-17 leftover was that `set +e` sandwich still ERR-traps on that
# subprocess exit 1, aborting after the code was already live. Prove sandwich
# still fires and the if-test capture survives.
GATE_FAKE="$(mktemp "${TMPDIR:-/tmp}/freshness-gate-fake-XXXXXX")"
printf '#!/usr/bin/env bash\nexit 1\n' > "$GATE_FAKE"
chmod +x "$GATE_FAKE"
trap 'rm -f "$TMP_ENV" "$HARNESS_ENV" "$GATE_FAKE"' EXIT

run_gate_err_harness() {
  HARNESS_STYLE="$1" GATE_FAKE="$GATE_FAKE" \
    bash -c '
      set -Eeuo pipefail
      on_err() { echo "TRAP_FIRED line=$1"; exit 99; }
      trap "on_err $LINENO" ERR
      FRESHNESS_SCRIPT="$GATE_FAKE"
      FRESH_RC=0
      if [[ "$HARNESS_STYLE" == "sandwich" ]]; then
        set +e
        PREVIEW_DIR=x PREVIEW_ENV_FILE=y \
          PREVIEW_API_URL=z PREVIEW_PUBLIC_HOST=h \
          GATE_STRICT=1 SCHEDULE_REINGEST=1 \
          bash "$FRESHNESS_SCRIPT" --role preview --api-url http://x --workspace dev
        FRESH_RC=$?
        set -e
      else
        if PREVIEW_DIR=x PREVIEW_ENV_FILE=y \
          PREVIEW_API_URL=z PREVIEW_PUBLIC_HOST=h \
          GATE_STRICT=1 SCHEDULE_REINGEST=1 \
          bash "$FRESHNESS_SCRIPT" --role preview --api-url http://x --workspace dev
        then
          FRESH_RC=0
        else
          FRESH_RC=$?
        fi
      fi
      echo "SURVIVED rc=$FRESH_RC"
    ' 2>&1 || true
}

GATE_SANDWICH_OUT="$(run_gate_err_harness sandwich)"
[[ "$GATE_SANDWICH_OUT" == *TRAP_FIRED* ]] \
  && pass "set +e sandwich DOES fire ERR trap on external bash exit 1" \
  || fail "expected sandwich to fire ERR on gate exit 1, got: $GATE_SANDWICH_OUT"
[[ "$GATE_SANDWICH_OUT" != *SURVIVED* ]] \
  && pass "set +e sandwich never reaches FRESH_RC capture for gate exit 1" \
  || fail "sandwich survived gate exit 1 — leftover not reproduced: $GATE_SANDWICH_OUT"

GATE_IF_OUT="$(run_gate_err_harness ifelse)"
[[ "$GATE_IF_OUT" != *TRAP_FIRED* ]] \
  && pass "if-test capture does NOT fire ERR trap on gate exit 1" \
  || fail "if-test still fired ERR trap: $GATE_IF_OUT"
[[ "$GATE_IF_OUT" == *"SURVIVED rc=1"* ]] \
  && pass "if-test capture survives and reports FRESH_RC=1" \
  || fail "if-test rc wrong: $GATE_IF_OUT"

echo "Summary: $FAIL failure(s)"
[[ "$FAIL" -eq 0 ]]
