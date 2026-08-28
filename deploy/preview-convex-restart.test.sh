#!/usr/bin/env bash
# Regression tests for preview-convex-restart.sh. Never contacts a deployment.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/deploy/preview-convex-restart.sh"
FAIL=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL + 1)); }

if [[ ! -f "$SCRIPT" ]]; then
    echo "FAIL: $SCRIPT not found"
    exit 1
fi

if grep -nE '^[[:space:]]*(pkill|killall)([[:space:]]|$)' "$SCRIPT"; then
    fail "script must never invoke pkill/killall"
else
    pass "no pkill/killall invocation"
fi

if grep -q 'docker restart' "$SCRIPT" && grep -q 'trends-preview-convex' "$SCRIPT"; then
    pass "docker restart targets preview container"
else
    fail "missing docker restart of trends-preview-convex"
fi

if grep -q '/api/query' "$SCRIPT" && grep -q 'POST' "$SCRIPT"; then
    pass "probes POST /api/query"
else
    fail "probe is not POST /api/query"
fi

# Refuse production :3210
OUT="$(PREVIEW_CONVEX_URL=http://127.0.0.1:3210 bash "$SCRIPT" --once 2>&1 || true)"
if printf '%s' "$OUT" | grep -q 'Refusing to probe or restart production Convex'; then
    pass "refuses :3210"
else
    fail "did not refuse :3210: $OUT"
fi

# Refuse non-preview container name
OUT="$(PREVIEW_CONVEX_CONTAINER=trends-convex bash "$SCRIPT" --once 2>&1 || true)"
if printf '%s' "$OUT" | grep -q "Refusing container name without 'preview'"; then
    pass "refuses non-preview container"
else
    fail "did not refuse non-preview container: $OUT"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
RESTARTS="$TMP/restarts"

# Fake curl: HTTP code from $CURL_CODE (default 200)
cat > "$TMP/bin/curl" << 'PY'
#!/usr/bin/env bash
code="${CURL_CODE:-200}"
# Honor -w '%{http_code}' used by the script
if printf '%s' "$*" | grep -q '%{http_code}'; then
    printf '%s' "$code"
    exit 0
fi
exit 0
PY
chmod +x "$TMP/bin/curl"

cat > "$TMP/bin/docker" << 'PY'
#!/usr/bin/env bash
if [[ "${1:-}" == "info" ]]; then
    exit 0
fi
if [[ "${1:-}" == "restart" ]]; then
    printf '%s\n' "${2:-}" >> "$RESTARTS_FILE"
    exit 0
fi
exit 0
PY
chmod +x "$TMP/bin/docker"

export PATH="$TMP/bin:$PATH"
export RESTARTS_FILE="$RESTARTS"
: > "$RESTARTS"

# Successful probe, no restart
CURL_CODE=200 bash "$SCRIPT" --once >/dev/null
if [[ ! -s "$RESTARTS" ]]; then
    pass "ok probe does not restart"
else
    fail "ok probe restarted: $(cat "$RESTARTS")"
fi

# Failed probe without --recover does not restart
: > "$RESTARTS"
if CURL_CODE=000 bash "$SCRIPT" --once >/dev/null 2>&1; then
    fail "failed probe exited 0 without --recover"
else
    pass "failed probe exits non-zero"
fi
if [[ ! -s "$RESTARTS" ]]; then
    pass "failed probe without --recover does not restart"
else
    fail "failed probe restarted without --recover: $(cat "$RESTARTS")"
fi

# Failed probe with --recover restarts the preview container
: > "$RESTARTS"
# After restart, wait_query_ok will probe again — flip to 200 on second call
cat > "$TMP/bin/curl" << 'PY'
#!/usr/bin/env bash
count_file="${CURL_COUNT_FILE:-/tmp/curl-count}"
n=0
if [[ -f "$count_file" ]]; then
    n="$(cat "$count_file")"
fi
n=$((n + 1))
printf '%s' "$n" > "$count_file"
if [[ "$n" -eq 1 ]]; then
    printf '%s' "000"
else
    printf '%s' "200"
fi
exit 0
PY
chmod +x "$TMP/bin/curl"
export CURL_COUNT_FILE="$TMP/curl-count"
: > "$CURL_COUNT_FILE"
if CURL_CODE=000 bash "$SCRIPT" --recover --once >/dev/null 2>&1; then
    pass "recover path exits 0 after restart"
else
    fail "recover path failed"
fi
if grep -qx 'trends-preview-convex' "$RESTARTS"; then
    pass "recover restarts trends-preview-convex"
else
    fail "recover did not restart preview container: $(cat "$RESTARTS" 2>/dev/null || true)"
fi

if [[ "$FAIL" -eq 0 ]]; then
    echo "ALL PASS"
    exit 0
fi
echo "$FAIL FAILURES"
exit 1
