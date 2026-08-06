#!/usr/bin/env bash
# Comprehensive post-upgrade verification for the preview host (ptcloud).
#
# Goes beyond preview-doctor.sh (infrastructure + golden query floors) to verify:
#   1. Version & source identity (version file, .trends-source-meta)
#   2. Service health (systemd units, Docker containers, listening ports)
#   3. HTTP endpoint health (loopback + public HTTPS, 200/401 expected)
#   4. Authentication & session (admin + hr-demo login, protected routes)
#   5. Database integrity (SQLite PRAGMA, candidate_actions count, Convex scan)
#   6. Search quality (authenticated MY + CN CNC sales queries, industryVerified)
#   7. Production isolation proof (.env.preview must not reference prod)
#   8. Production untouched (--prod-sha pin, prod API up, prod version)
#   9. Logs — no critical errors (journalctl + docker logs)
#  10. Summary (pass/fail/warn counts, exit code)
#
# Run ON the preview host:
#   ssh ptcloud 'bash /home/ubuntu/trends-preview/deploy/preview-verify.sh --role preview'
#
# Flags:
#   --role preview          which role to verify (required; only preview supported)
#   --api-url URL           override API URL (default http://127.0.0.1:3002)
#   --expected-version V    expected version string (default: reads version file)
#   --expected-sha SHA      expected source SHA (default: reads .trends-source-meta)
#   --prod-sha SHA          production SHA that must be unchanged (optional)
#   --json                  output a JSON report instead of human-readable
#   -h|--help               usage
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-preview-common.sh" 2>/dev/null || true
# shellcheck source=lib-bff-defaults.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-bff-defaults.sh" 2>/dev/null || true
# shellcheck source=lib-preview-auth-session.sh
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib-preview-auth-session.sh" 2>/dev/null || true

PREVIEW_DIR="${PREVIEW_DIR:-/home/ubuntu/trends-preview}"
PROD_DIR="${PROD_DIR:-/opt/trends}"
PREVIEW_DB="${PREVIEW_DB:-$PREVIEW_DIR/output/resume_screening.db}"
PROD_DB="${PROD_DB:-$PROD_DIR/output/resume_screening.db}"
PREVIEW_ENV_FILE="${PREVIEW_ENV_FILE:-$PREVIEW_DIR/.env.preview}"
PREVIEW_CONVEX_CONTAINER="${PREVIEW_CONVEX_CONTAINER:-trends-preview-convex}"
PREVIEW_MCP_CONTAINER="${PREVIEW_MCP_CONTAINER:-trends-preview-mcp}"
API_URL="${PREVIEW_API_URL:-http://127.0.0.1:3002}"
PUBLIC_HOST="${PREVIEW_PUBLIC_HOST:-preview.pt-mes.com}"
PROD_PUBLIC_HOST="${PROD_PUBLIC_HOST:-trends.pt-mes.com}"
RESUME_SMOKE_PATH="/api/resumes?source=convex&paged=true&limit=1"
LOG_SINCE="${LOG_SINCE:-30 min ago}"

ROLE=""
EXPECTED_VERSION=""
EXPECTED_SHA=""
PROD_SHA=""
JSON_OUT=0

usage() {
    sed -n '2,30p' "$0"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --role) ROLE="${2:-}"; shift 2 ;;
        --api-url) API_URL="${2:-}"; shift 2 ;;
        --expected-version) EXPECTED_VERSION="${2:-}"; shift 2 ;;
        --expected-sha) EXPECTED_SHA="${2:-}"; shift 2 ;;
        --prod-sha) PROD_SHA="${2:-}"; shift 2 ;;
        --json) JSON_OUT=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
done

if [[ -z "$ROLE" ]]; then
    echo "error: --role preview is required" >&2
    exit 2
fi
if [[ "$ROLE" != "preview" ]]; then
    echo "error: only --role preview is supported by this verifier (got: $ROLE)" >&2
    exit 2
fi

# ---------------------------------------------------------------------------
# Counters + output helpers
# ---------------------------------------------------------------------------
PASS=0
FAIL=0
WARN=0
TOTAL=0

# Human-readable output goes to stderr in --json mode so stdout carries only
# the JSON report (machine-parseable).
out() {
    # out <fmt> <args...> — print to stdout, or stderr when JSON_OUT=1
    if [[ "$JSON_OUT" -eq 1 ]]; then
        printf "$@" >&2
    else
        printf "$@"
    fi
}

ok()    { TOTAL=$((TOTAL+1)); PASS=$((PASS+1)); out '  \033[32m✓\033[0m %s\n' "$*"; }
warn()  { TOTAL=$((TOTAL+1)); WARN=$((WARN+1)); out '  \033[33m⚠\033[0m %s\n' "$*"; }
fail()  { TOTAL=$((TOTAL+1)); FAIL=$((FAIL+1)); out '  \033[31m✗\033[0m %s\n' "$*"; }
info()  { out '  · %s\n' "$*"; }
section() { out '\n[%s] %s\n' "$1" "$2"; }

# JSON report accumulator (only populated in --json mode)
JSON_CHECKS=""

json_check() {
    # json_check <section> <name> <status> <detail>
    local section_name="$1" name="$2" status="$3" detail="${4:-}"
    if [[ "$JSON_OUT" -eq 1 ]]; then
        local entry
        entry="$(printf '{"section":%s,"name":%s,"status":%s,"detail":%s}' \
            "$(printf '%s' "$section_name" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" \
            "$(printf '%s' "$name" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" \
            "$(printf '%s' "$status" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" \
            "$(printf '%s' "$detail" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")"
        if [[ -n "$JSON_CHECKS" ]]; then
            JSON_CHECKS="$JSON_CHECKS,$entry"
        else
            JSON_CHECKS="$entry"
        fi
    fi
}

# Wrap ok/warn/fail so every human line is also recorded for --json
_ok()   { ok "$@";   json_check "$CURRENT_SECTION" "$1" "pass" "${*:2}"; }
_warn() { warn "$@"; json_check "$CURRENT_SECTION" "$1" "warn" "${*:2}"; }
_fail() { fail "$@"; json_check "$CURRENT_SECTION" "$1" "fail" "${*:2}"; }

CURRENT_SECTION=""

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
ADMIN_JAR="$(mktemp /tmp/preview-verify-admin.XXXXXX.jar)"
HR_JAR="$(mktemp /tmp/preview-verify-hr.XXXXXX.jar)"

cleanup() {
    rm -f "$ADMIN_JAR" "$HR_JAR"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
http_code() {
    # http_code <url> [extra curl args...]
    local url="$1"
    shift
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$@" "$url" 2>/dev/null || true)"
    [[ -n "$code" ]] || code="000"
    printf '%s' "$code"
}

meta_get() {
    # meta_get <key> — read a KEY=value line from .trends-source-meta
    local key="$1"
    [[ -f "$PREVIEW_DIR/.trends-source-meta" ]] || return 0
    grep -E "^${key}=" "$PREVIEW_DIR/.trends-source-meta" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true
}

json_value() {
    # json_value <json> <python expression on parsed object>
    # e.g. json_value "$body" "d['summary']['total']"
    local json="$1" expr="$2"
    JSON_BODY="$json" python3 -c '
import json, os, sys
try:
    d = json.loads(os.environ["JSON_BODY"])
except Exception:
    sys.exit(1)
try:
    print(eval(sys.argv[1]))
except Exception:
    sys.exit(1)
' "$expr" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# 0. Context
# ---------------------------------------------------------------------------
out '=== Preview Post-Upgrade Verification ===\n'
out '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
info "role: $ROLE"
info "preview dir: $PREVIEW_DIR"
info "api url: $API_URL"
info "public host: $PUBLIC_HOST"

# ---------------------------------------------------------------------------
# 1. Version & Source Identity
# ---------------------------------------------------------------------------
CURRENT_SECTION="1-version-source-identity"
section "1/10" "Version & Source Identity"

VERSION_FILE="$PREVIEW_DIR/version"
if [[ -f "$VERSION_FILE" ]]; then
    ACTUAL_VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
    if [[ -z "$EXPECTED_VERSION" ]]; then
        EXPECTED_VERSION="$ACTUAL_VERSION"
        info "expected version (from version file): $EXPECTED_VERSION"
    fi
    if [[ "$ACTUAL_VERSION" == "$EXPECTED_VERSION" ]]; then
        _ok "version file matches expected ($ACTUAL_VERSION)"
    else
        _fail "version file mismatch: actual=$ACTUAL_VERSION expected=$EXPECTED_VERSION"
    fi
else
    _fail "version file missing: $VERSION_FILE"
fi

if [[ -f "$PREVIEW_DIR/.trends-source-meta" ]]; then
    META_SHA="$(meta_get SOURCE_SHA)"
    META_REF="$(meta_get SOURCE_REF)"
    META_VERSION="$(meta_get SOURCE_VERSION)"
    if [[ -z "$EXPECTED_SHA" ]]; then
        EXPECTED_SHA="$META_SHA"
        info "expected sha (from .trends-source-meta): ${EXPECTED_SHA:-<empty>}"
    fi
    if [[ -n "$META_SHA" && "$META_SHA" == "$EXPECTED_SHA" ]]; then
        _ok "SOURCE_SHA matches expected ($META_SHA)"
    else
        _fail "SOURCE_SHA mismatch: actual=${META_SHA:-<empty>} expected=${EXPECTED_SHA:-<empty>}"
    fi
    if [[ -n "$META_REF" ]]; then
        if [[ -z "$EXPECTED_VERSION" ]]; then
            _warn "SOURCE_REF present but no expected version to compare against: ref=$META_REF"
        elif [[ "$META_REF" == *"$EXPECTED_VERSION"* || "$META_REF" == *"preview-$EXPECTED_VERSION"* || "$META_REF" == *"v$EXPECTED_VERSION"* ]]; then
            _ok "SOURCE_REF contains expected ref ($META_REF)"
        else
            _warn "SOURCE_REF does not mention expected version: ref=$META_REF version=$EXPECTED_VERSION"
        fi
    else
        _warn "SOURCE_REF missing in .trends-source-meta"
    fi
    if [[ -n "$META_VERSION" && "$META_VERSION" == "$EXPECTED_VERSION" ]]; then
        _ok "SOURCE_VERSION matches expected ($META_VERSION)"
    else
        _warn "SOURCE_VERSION mismatch: actual=${META_VERSION:-<empty>} expected=$EXPECTED_VERSION"
    fi
else
    _fail ".trends-source-meta missing — cannot verify source identity"
fi

# ---------------------------------------------------------------------------
# 2. Service Health
# ---------------------------------------------------------------------------
CURRENT_SECTION="2-service-health"
section "2/10" "Service Health"

if systemctl is-active --quiet trends-preview-api 2>/dev/null; then
    _ok "trends-preview-api is active"
else
    _fail "trends-preview-api is NOT active"
fi
if systemctl is-active --quiet trends-api 2>/dev/null; then
    _ok "trends-api (production) is active"
else
    _fail "trends-api (production) is NOT active"
fi

CON_STATUS="$(docker ps --filter name="$PREVIEW_CONVEX_CONTAINER" --format '{{.Status}}' 2>/dev/null || echo "")"
if [[ -z "$CON_STATUS" ]]; then
    _fail "$PREVIEW_CONVEX_CONTAINER container is not running"
elif echo "$CON_STATUS" | grep -q "Up" && ! echo "$CON_STATUS" | grep -q "(unhealthy)"; then
    _ok "$PREVIEW_CONVEX_CONTAINER: $CON_STATUS"
elif echo "$CON_STATUS" | grep -q "(unhealthy)"; then
    _fail "$PREVIEW_CONVEX_CONTAINER is unhealthy: $CON_STATUS"
else
    _fail "$PREVIEW_CONVEX_CONTAINER not Up: $CON_STATUS"
fi

MCP_STATUS="$(docker ps --filter name="$PREVIEW_MCP_CONTAINER" --format '{{.Status}}' 2>/dev/null || echo "")"
if [[ -z "$MCP_STATUS" ]]; then
    _warn "$PREVIEW_MCP_CONTAINER is not running (non-critical for resume UI)"
elif echo "$MCP_STATUS" | grep -q "Up"; then
    _ok "$PREVIEW_MCP_CONTAINER: $MCP_STATUS"
else
    _warn "$PREVIEW_MCP_CONTAINER not Up: $MCP_STATUS"
fi

for port in 3002 4210 3000 3210; do
    if (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$port ") || \
       (command -v netstat >/dev/null 2>&1 && netstat -ltn 2>/dev/null | grep -q ":$port "); then
        _ok "port $port is listening"
    else
        _fail "port $port is NOT listening"
    fi
done

# ---------------------------------------------------------------------------
# 3. HTTP Endpoint Health
# ---------------------------------------------------------------------------
CURRENT_SECTION="3-http-endpoints"
section "3/10" "HTTP Endpoint Health"

check_endpoint() {
    # check_endpoint <label> <url> [extra curl args...]
    local label="$1" url="$2"
    shift 2
    local code
    code="$(http_code "$url" "$@")"
    if [[ "$code" == "200" || "$code" == "401" ]]; then
        _ok "$label → $code"
    elif [[ "$code" == "000" ]]; then
        _fail "$label → 000 (unreachable)"
    elif [[ "$code" =~ ^5 ]]; then
        _fail "$label → $code (5xx)"
    else
        _warn "$label → $code (expected 200 or 401)"
    fi
}

check_endpoint "loopback /api/blocks" "$API_URL/api/blocks"
check_endpoint "loopback /api/resumes (unauth)" "$API_URL$RESUME_SMOKE_PATH"
check_endpoint "loopback convex /version" "http://127.0.0.1:4210/version"
check_endpoint "public https /" "https://$PUBLIC_HOST/"
check_endpoint "public https /api/blocks" "https://$PUBLIC_HOST/api/blocks"
check_endpoint "public https /convex/version" "https://$PUBLIC_HOST/convex/version"

# ---------------------------------------------------------------------------
# 4. Authentication & Session
# ---------------------------------------------------------------------------
CURRENT_SECTION="4-auth-session"
section "4/10" "Authentication & Session"

if [[ -f "$PREVIEW_ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$PREVIEW_ENV_FILE"
    set +a
else
    _fail "preview env file missing: $PREVIEW_ENV_FILE"
fi

ADMIN_USER="${BOOTSTRAP_ADMIN_USERS:-}"
ADMIN_USER="${ADMIN_USER%%,*}"
ADMIN_USER="${ADMIN_USER:-admin}"
HR_USER="${BOOTSTRAP_HR_DEMO_USER:-hr-demo}"
ADMIN_WS="${BOOTSTRAP_ADMIN_WORKSPACE:-dev}"
HR_WS="${BOOTSTRAP_HR_DEMO_WORKSPACE:-hr}"

if [[ -n "${AUTH_BOOTSTRAP_PASSWORD:-}" ]] && type preview_auth_login >/dev/null 2>&1; then
    if preview_auth_login "$ADMIN_USER" "$AUTH_BOOTSTRAP_PASSWORD" "$ADMIN_JAR"; then
        _ok "admin login ($ADMIN_USER)"
        ADMIN_CODE="$(preview_auth_curl "$ADMIN_JAR" "$ADMIN_WS" -o /dev/null -w '%{http_code}' "$API_URL$RESUME_SMOKE_PATH" 2>/dev/null || echo 000)"
        if [[ "$ADMIN_CODE" == "200" ]]; then
            _ok "admin resumes ($ADMIN_WS) → $ADMIN_CODE"
        else
            _fail "admin resumes ($ADMIN_WS) → $ADMIN_CODE"
        fi
    else
        _fail "admin login ($ADMIN_USER) failed"
    fi
else
    _warn "AUTH_BOOTSTRAP_PASSWORD unset or session helper missing — skip admin login"
fi

if [[ -n "${AUTH_HR_DEMO_PASSWORD:-}" ]] && type preview_auth_login >/dev/null 2>&1; then
    if preview_auth_login "$HR_USER" "$AUTH_HR_DEMO_PASSWORD" "$HR_JAR"; then
        _ok "hr-demo login ($HR_USER)"
        HR_CODE="$(preview_auth_curl "$HR_JAR" "$HR_WS" -o /dev/null -w '%{http_code}' "$API_URL$RESUME_SMOKE_PATH" 2>/dev/null || echo 000)"
        if [[ "$HR_CODE" == "200" ]]; then
            _ok "hr-demo resumes ($HR_WS) → $HR_CODE"
        else
            _fail "hr-demo resumes ($HR_WS) → $HR_CODE"
        fi
    else
        _fail "hr-demo login ($HR_USER) failed"
    fi
else
    _warn "AUTH_HR_DEMO_PASSWORD unset — skip hr-demo login"
fi

# ---------------------------------------------------------------------------
# 5. Database Integrity
# ---------------------------------------------------------------------------
CURRENT_SECTION="5-database-integrity"
section "5/10" "Database Integrity"

if [[ -f "$PREVIEW_DB" ]]; then
    INTEGRITY="$(sqlite3 "$PREVIEW_DB" "PRAGMA integrity_check;" 2>/dev/null | head -1 || echo error)"
    if [[ "$INTEGRITY" == "ok" ]]; then
        _ok "SQLite integrity_check → ok"
    else
        _fail "SQLite integrity_check → ${INTEGRITY:-<empty>}"
    fi
    ACTIONS_COUNT="$(sqlite3 "$PREVIEW_DB" "SELECT count(*) FROM candidate_actions;" 2>/dev/null || echo error)"
    if [[ "$ACTIONS_COUNT" =~ ^[0-9]+$ ]]; then
        _ok "candidate_actions count = $ACTIONS_COUNT"
    else
        _fail "candidate_actions count query failed: ${ACTIONS_COUNT:-<empty>}"
    fi
else
    _fail "preview SQLite DB missing: $PREVIEW_DB"
fi

PREVIEW_DB_REAL="$(readlink -f "$PREVIEW_DB" 2>/dev/null || echo "$PREVIEW_DB")"
PROD_DB_REAL="$(readlink -f "$PROD_DB" 2>/dev/null || echo "$PROD_DB")"
if [[ "$PREVIEW_DB_REAL" == "$PROD_DB_REAL" ]]; then
    _fail "preview DB resolves to production DB: $PREVIEW_DB_REAL"
else
    _ok "preview DB is separate from prod DB"
    info "preview: $PREVIEW_DB_REAL"
    info "prod:    $PROD_DB_REAL"
fi

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "$PREVIEW_CONVEX_CONTAINER"; then
    CONVEX_SCAN="$(docker exec "$PREVIEW_CONVEX_CONTAINER" bash -lc "cd /app/packages/convex && npx convex run resumes_search:scanResumePageSlim '{\"numItems\":1}'" 2>&1 || true)"
    if echo "$CONVEX_SCAN" | grep -q '"docs"'; then
        _ok "convex scanResumePageSlim succeeded"
    else
        _fail "convex scanResumePageSlim failed"
        info "$(echo "$CONVEX_SCAN" | head -c 300)"
    fi
else
    _fail "$PREVIEW_CONVEX_CONTAINER not running — cannot run convex scan"
fi

# ---------------------------------------------------------------------------
# 6. Search Quality (Authenticated)
# ---------------------------------------------------------------------------
CURRENT_SECTION="6-search-quality"
section "6/10" "Search Quality (Authenticated)"

MY_TOTAL=""
CN_TOTAL=""
INDUSTRY_VERIFIED=0

if [[ -n "${AUTH_HR_DEMO_PASSWORD:-}" ]] && type preview_auth_curl >/dev/null 2>&1; then
    MY_BODY="$(preview_auth_curl "$HR_JAR" "$HR_WS" \
        "$API_URL/api/resumes?source=convex&location=Malaysia&q=CNC+Sales&minRoleYears=1&limit=10&roleType=sales" 2>/dev/null || true)"
    MY_TOTAL="$(json_value "$MY_BODY" "d['summary']['total']")"
    if [[ -n "$MY_TOTAL" && "$MY_TOTAL" =~ ^[0-9]+$ && "$MY_TOTAL" -gt 0 ]]; then
        _ok "MY query (CNC Sales) total=$MY_TOTAL"
    else
        _fail "MY query (CNC Sales) total=${MY_TOTAL:-<empty>} — expected > 0"
    fi

    CN_BODY="$(preview_auth_curl "$HR_JAR" "$HR_WS" \
        "$API_URL/api/resumes?source=convex&location=China&q=CNC+%E9%94%80%E5%94%AE&minRoleYears=1&limit=10&roleType=sales" 2>/dev/null || true)"
    CN_TOTAL="$(json_value "$CN_BODY" "d['summary']['total']")"
    if [[ -n "$CN_TOTAL" && "$CN_TOTAL" =~ ^[0-9]+$ && "$CN_TOTAL" -gt 0 ]]; then
        _ok "CN query (CNC 销售) total=$CN_TOTAL"
    else
        _fail "CN query (CNC 销售) total=${CN_TOTAL:-<empty>} — expected > 0"
    fi

    # Verify at least one result carries industryVerified work-history evidence
    # (field lives at data[].ingestData.roleSignals[].matchedWorkEntries[].industryVerified)
    INDUSTRY_VERIFIED="$(JSON_BODY="$MY_BODY" python3 -c '
import json, os, sys
try:
    d = json.loads(os.environ["JSON_BODY"])
except Exception:
    sys.exit(0)
count = 0
for item in d.get("data") or []:
    for signal in (item.get("ingestData") or {}).get("roleSignals") or []:
        for entry in signal.get("matchedWorkEntries") or []:
            if entry.get("industryVerified") is True:
                count += 1
print(count)
' 2>/dev/null || echo 0)"
    if [[ -n "$INDUSTRY_VERIFIED" && "$INDUSTRY_VERIFIED" =~ ^[0-9]+$ && "$INDUSTRY_VERIFIED" -gt 0 ]]; then
        _ok "industryVerified work-history entries found in MY results ($INDUSTRY_VERIFIED)"
    else
        _warn "no industryVerified work-history entries in MY results (field may be absent in response)"
    fi
else
    _warn "hr-demo session unavailable — skip search quality checks"
fi

# ---------------------------------------------------------------------------
# 7. Production Isolation Proof
# ---------------------------------------------------------------------------
CURRENT_SECTION="7-production-isolation"
section "7/10" "Production Isolation Proof"

if [[ -f "$PREVIEW_ENV_FILE" ]]; then
    if grep -q 'trends\.pt-mes\.com' "$PREVIEW_ENV_FILE"; then
        _fail ".env.preview references production host (trends.pt-mes.com)"
    else
        _ok ".env.preview does not reference production host"
    fi

    if grep -q '4210' "$PREVIEW_ENV_FILE"; then
        _ok ".env.preview references preview Convex port 4210"
    else
        _warn ".env.preview does not mention port 4210"
    fi

    if grep -q '3210' "$PREVIEW_ENV_FILE"; then
        _warn ".env.preview mentions production Convex port 3210 (check it is only in comments)"
    else
        _ok ".env.preview does not reference production Convex port 3210"
    fi

    CONVEX_URL_LINE="$(grep '^CONVEX_URL=' "$PREVIEW_ENV_FILE" 2>/dev/null | head -1 || true)"
    if [[ "$CONVEX_URL_LINE" == *"4210"* ]]; then
        _ok "CONVEX_URL targets preview Convex (:4210)"
    else
        _fail "CONVEX_URL does not contain :4210: ${CONVEX_URL_LINE:-<unset>}"
    fi
    if [[ "$CONVEX_URL_LINE" == *"3210"* ]]; then
        _fail "CONVEX_URL targets production Convex (:3210): $CONVEX_URL_LINE"
    else
        _ok "CONVEX_URL does not target :3210"
    fi

    CONVEX_PUBLIC_LINE="$(grep '^CONVEX_PUBLIC_URL=' "$PREVIEW_ENV_FILE" 2>/dev/null | head -1 || true)"
    if [[ "$CONVEX_PUBLIC_LINE" == *"preview.pt-mes.com"* ]]; then
        _ok "CONVEX_PUBLIC_URL targets preview host"
    else
        _fail "CONVEX_PUBLIC_URL does not contain preview.pt-mes.com: ${CONVEX_PUBLIC_LINE:-<unset>}"
    fi

    AUTH_ORIGINS_LINE="$(grep '^AUTH_ALLOWED_ORIGINS=' "$PREVIEW_ENV_FILE" 2>/dev/null | head -1 || true)"
    if [[ "$AUTH_ORIGINS_LINE" == *"trends.pt-mes.com"* ]]; then
        _fail "AUTH_ALLOWED_ORIGINS includes production host: $AUTH_ORIGINS_LINE"
    else
        _ok "AUTH_ALLOWED_ORIGINS does not include production host"
    fi

    TELEGRAM_LINE="$(grep '^TELEGRAM_BOT_TOKEN=' "$PREVIEW_ENV_FILE" 2>/dev/null | head -1 || true)"
    if [[ -z "$TELEGRAM_LINE" || "$TELEGRAM_LINE" == "TELEGRAM_BOT_TOKEN=" || "$TELEGRAM_LINE" == 'TELEGRAM_BOT_TOKEN=""' ]]; then
        _ok "TELEGRAM_BOT_TOKEN empty/unset (isolation)"
    else
        _warn "TELEGRAM_BOT_TOKEN is set on preview — expected empty for isolation"
    fi
else
    _fail "preview env file missing: $PREVIEW_ENV_FILE"
fi

# ---------------------------------------------------------------------------
# 8. Production Untouched
# ---------------------------------------------------------------------------
CURRENT_SECTION="8-production-untouched"
section "8/10" "Production Untouched"

if [[ -n "$PROD_SHA" ]]; then
    if [[ -d "$PROD_DIR/.git" ]]; then
        ACTUAL_PROD_SHA="$(sudo -u "$PROD_SERVICE_USER" git -C "$PROD_DIR" rev-parse HEAD 2>/dev/null || echo "")"
        if [[ -n "$ACTUAL_PROD_SHA" && "$ACTUAL_PROD_SHA" == "$PROD_SHA" ]]; then
            _ok "production SHA unchanged ($ACTUAL_PROD_SHA)"
        else
            _fail "production SHA changed: actual=${ACTUAL_PROD_SHA:-<unreadable>} expected=$PROD_SHA"
        fi
    else
        _fail "production dir has no .git: $PROD_DIR"
    fi
else
    info "--prod-sha not provided — skipping production SHA pin check"
fi

if systemctl is-active --quiet trends-api 2>/dev/null; then
    _ok "trends-api (production) is active"
else
    _fail "trends-api (production) is NOT active"
fi

PROD_CODE="$(http_code "https://$PROD_PUBLIC_HOST/api/blocks")"
if [[ "$PROD_CODE" == "200" || "$PROD_CODE" == "401" ]]; then
    _ok "production https /api/blocks → $PROD_CODE"
else
    _fail "production https /api/blocks → $PROD_CODE (expected 200 or 401)"
fi

if [[ -f "$PROD_DIR/version" ]]; then
    PROD_VERSION="$(tr -d '[:space:]' < "$PROD_DIR/version")"
    _ok "production version: $PROD_VERSION"
else
    _warn "production version file missing: $PROD_DIR/version"
fi

# ---------------------------------------------------------------------------
# 9. Logs — No Critical Errors
# ---------------------------------------------------------------------------
CURRENT_SECTION="9-logs"
section "9/10" "Logs — No Critical Errors"

SUDO=$([ "$(id -u)" -eq 0 ] && echo "" || echo "sudo")

JOURNAL_HITS="$($SUDO journalctl -u trends-preview-api --since "$LOG_SINCE" --no-pager 2>/dev/null | grep -Ei 'FATAL|Unhandled|ECONNREFUSED 127\.0\.0\.1:3210' || true)"
if [[ -z "$JOURNAL_HITS" ]]; then
    _ok "no FATAL/Unhandled/ECONNREFUSED:3210 in trends-preview-api journal (since \"$LOG_SINCE\")"
else
    _fail "critical errors in trends-preview-api journal:"
    echo "$JOURNAL_HITS" | tail -5 | sed 's/^/      /' >&2
fi

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "$PREVIEW_CONVEX_CONTAINER"; then
    DOCKER_HITS="$(docker logs "$PREVIEW_CONVEX_CONTAINER" --since "$LOG_SINCE" 2>&1 | grep -Ei 'error|fatal' | grep -v DEBUG || true)"
    if [[ -z "$DOCKER_HITS" ]]; then
        _ok "no error/fatal lines in convex container logs (since \"$LOG_SINCE\")"
    else
        _warn "error/fatal lines in convex container logs (some debug errors are benign):"
        echo "$DOCKER_HITS" | tail -5 | sed 's/^/      /' >&2
    fi
else
    _warn "$PREVIEW_CONVEX_CONTAINER not running — cannot inspect container logs"
fi

# ---------------------------------------------------------------------------
# 10. Summary
# ---------------------------------------------------------------------------
CURRENT_SECTION="10-summary"
section "10/10" "Summary"

out '\n  checks: %s   passed: %s   failed: %s   warnings: %s\n' "$TOTAL" "$PASS" "$FAIL" "$WARN"

if [[ "$JSON_OUT" -eq 1 ]]; then
    python3 - "$PASS" "$FAIL" "$WARN" "$TOTAL" "$JSON_CHECKS" <<'PY'
import json, sys
passed, failed, warned, total, checks = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
report = {
    "schema": "trends-preview-verify/v1",
    "role": "preview",
    "result": "passed" if int(failed) == 0 else "failed",
    "summary": {
        "total": int(total),
        "passed": int(passed),
        "failed": int(failed),
        "warnings": int(warned),
    },
    "checks": json.loads(f"[{checks}]") if checks else [],
    "completedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
}
print(json.dumps(report, indent=2))
PY
fi

if [[ "$FAIL" -gt 0 ]]; then
    out '\nRESULT: FAILED (%s failure(s))\n' "$FAIL"
    exit 1
fi
out '\nRESULT: PASSED\n'
exit 0
