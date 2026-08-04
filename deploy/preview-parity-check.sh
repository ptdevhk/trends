#!/usr/bin/env bash
# Compare production vs preview search/data surfaces for restore parity.
# Both environments require auth as their configured HR demo seat (post
# no-auth→auth). Production and preview use separate cookie jars.
# Read-only. Exit 0 when within tolerances; exit 1 on a strict mismatch.
# Data-only syncs keep preview's newer application code. When API versions
# differ, search totals are reported as a warning by default because search
# semantics can legitimately change; set PARITY_STRICT_SEARCH=1 to fail on
# that difference (or pin preview code to production first).
#
# Usage (on ptcloud):
#   bash deploy/preview-parity-check.sh
#   QUERY='location=China&q=CNC+销售&minRoleYears=1&roleType=sales&minAge=25&maxAge=40' \
#     bash deploy/preview-parity-check.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"
# shellcheck source=lib-preview-auth-session.sh
source "$SCRIPT_DIR/lib-preview-auth-session.sh"

PROD_API="${PROD_API_URL:-http://127.0.0.1:3000}"
PREV_API="${PREVIEW_API_URL:-http://127.0.0.1:3002}"
# Default: the HR CNC sales China query used as staging baseline
QUERY="${QUERY:-location=China&q=CNC+%E9%94%80%E5%94%AE&minRoleYears=1&roleType=sales&minAge=25&maxAge=40}"
TOTAL_TOLERANCE="${TOTAL_TOLERANCE:-0}"
PARITY_ALLOW_VERSION_DRIFT="${PARITY_ALLOW_VERSION_DRIFT:-1}"
PARITY_STRICT_SEARCH="${PARITY_STRICT_SEARCH:-0}"
FAIL=0

# Read production credentials from its env file without sourcing them into the
# parity process. The values stay in shell variables and are never printed.
PROD_ENV_FILE="${PROD_ENV_FILE:-/etc/trends/env}"
PROD_HR_USER="${PROD_HR_USER:-$(read_env_value "$PROD_ENV_FILE" BOOTSTRAP_HR_DEMO_USER)}"
PROD_HR_USER="${PROD_HR_USER:-hr-demo}"
PROD_HR_WS="${PROD_HR_WS:-$(read_env_value "$PROD_ENV_FILE" BOOTSTRAP_HR_DEMO_WORKSPACE)}"
PROD_HR_WS="${PROD_HR_WS:-hr}"
PROD_HR_PASS="${PROD_HR_PASS:-$(read_env_value "$PROD_ENV_FILE" AUTH_HR_DEMO_PASSWORD)}"

PREVIEW_ENV_FILE="${PREVIEW_ENV_FILE:-${PREVIEW_DIR:-/home/ubuntu/trends-preview}/.env.preview}"
if [[ -f "$PREVIEW_ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$PREVIEW_ENV_FILE"
    set +a
fi

HR_USER="${BOOTSTRAP_HR_DEMO_USER:-hr-demo}"
HR_WS="${BOOTSTRAP_HR_DEMO_WORKSPACE:-hr}"
HR_PASS="${AUTH_HR_DEMO_PASSWORD:-}"

preview_auth_login_at() {
    local api="$1"
    local username="$2"
    local password="$3"
    local jar="$4"
    local previous_api="${PREVIEW_API_URL:-}"
    local result=0

    PREVIEW_API_URL="$api" preview_auth_login "$username" "$password" "$jar" || result=$?
    if [[ -n "$previous_api" ]]; then
        PREVIEW_API_URL="$previous_api"
    else
        unset PREVIEW_API_URL
    fi
    return "$result"
}

fetch_summary_prod() {
    local jar="$1"
    local url="$PROD_API/api/resumes?source=convex&paged=true&limit=1&${QUERY}"
    preview_auth_curl "$jar" "$PROD_HR_WS" --max-time 60 "$url"
}

fetch_summary_preview() {
    local jar="$1"
    local url="$PREV_API/api/resumes?source=convex&paged=true&limit=1&${QUERY}"
    preview_auth_curl "$jar" "$HR_WS" --max-time 60 "$url"
}

api_version() {
    local api="$1"
    local body
    body="$(curl -sS --max-time 10 "$api/health" 2>/dev/null || true)"
    BODY="$body" python3 - <<'PY'
import json, os
try:
    value = json.loads(os.environ.get("BODY", "{}"))
    version = value.get("version")
    print(version if isinstance(version, str) and version else "unknown")
except Exception:
    print("unknown")
PY
}

count_sqlite() {
    local db="$1"
    if [ ! -f "$db" ]; then
        echo "missing"
        return
    fi
    sqlite3 "$db" "SELECT count(*) FROM candidate_actions;" 2>/dev/null || echo "err"
}

log_step "Preview parity check"
echo "query=$QUERY"
echo "total_tolerance=$TOTAL_TOLERANCE"
echo "production_user=$PROD_HR_USER workspace=$PROD_HR_WS"
echo "preview_user=$HR_USER workspace=$HR_WS"
PROD_VERSION="$(api_version "$PROD_API")"
PREV_VERSION="$(api_version "$PREV_API")"
echo "api_version production=$PROD_VERSION preview=$PREV_VERSION"
VERSION_DRIFT=0
if [[ "$PROD_VERSION" != "unknown" && "$PREV_VERSION" != "unknown" && "$PROD_VERSION" != "$PREV_VERSION" ]]; then
    VERSION_DRIFT=1
    log_warn "API version drift: production=$PROD_VERSION preview=$PREV_VERSION"
fi

if [[ -z "$PROD_HR_PASS" ]]; then
    log_error "Production AUTH_HR_DEMO_PASSWORD unset — cannot auth production parity"
    exit 1
fi
if [[ -z "$HR_PASS" ]]; then
    log_error "Preview AUTH_HR_DEMO_PASSWORD unset — cannot auth preview parity"
    exit 1
fi

PROD_JAR="${PARITY_PROD_COOKIE_JAR:-/tmp/preview-parity-prod-hr.jar}"
PREV_JAR="${PARITY_PREVIEW_COOKIE_JAR:-/tmp/preview-parity-preview-hr.jar}"
cleanup() {
    rm -f "$PROD_JAR" "$PREV_JAR"
}
trap cleanup EXIT

if ! preview_auth_login_at "$PROD_API" "$PROD_HR_USER" "$PROD_HR_PASS" "$PROD_JAR"; then
    log_error "production HR demo login failed for parity"
    exit 1
fi
if ! preview_auth_login_at "$PREV_API" "$HR_USER" "$HR_PASS" "$PREV_JAR"; then
    log_error "preview HR demo login failed for parity"
    exit 1
fi

PROD_JSON="$(fetch_summary_prod "$PROD_JAR")"
PREV_JSON="$(fetch_summary_preview "$PREV_JAR")"

eval "$(PROD_JSON="$PROD_JSON" PREV_JSON="$PREV_JSON" python3 <<'PY'
import json, os
prod = json.loads(os.environ["PROD_JSON"])
prev = json.loads(os.environ["PREV_JSON"])
ps = prod.get("summary") or {}
vs = prev.get("summary") or {}
print(f"PROD_TOTAL={ps.get('total')}")
print(f"PREV_TOTAL={vs.get('total')}")
print(f"PROD_STATUS={json.dumps(ps.get('statusCounts') or {}, separators=(',', ':'))}")
print(f"PREV_STATUS={json.dumps(vs.get('statusCounts') or {}, separators=(',', ':'))}")
PY
)"

PROD_CA="$(count_sqlite "$PROD_DB")"
PREV_CA="$(count_sqlite "$PREVIEW_DB")"

echo "search_total   prod=$PROD_TOTAL preview=$PREV_TOTAL"
echo "candidate_actions sqlite prod=$PROD_CA preview=$PREV_CA"
echo "statusCounts   prod=$PROD_STATUS"
echo "statusCounts   prev=$PREV_STATUS"

# Totals
if [ -z "${PROD_TOTAL:-}" ] || [ -z "${PREV_TOTAL:-}" ] || [ "$PROD_TOTAL" = "None" ] || [ "$PREV_TOTAL" = "None" ]; then
    log_error "Could not parse search totals"
    FAIL=1
else
    delta=$((PROD_TOTAL - PREV_TOTAL))
    if [ "$delta" -lt 0 ]; then delta=$((-delta)); fi
    if [ "$delta" -gt "$TOTAL_TOLERANCE" ]; then
        if [ "$VERSION_DRIFT" -eq 1 ] && [ "$PARITY_ALLOW_VERSION_DRIFT" != "0" ] && [ "$PARITY_STRICT_SEARCH" != "1" ]; then
            log_warn "Search total differs under API version drift: prod=$PROD_TOTAL preview=$PREV_TOTAL delta=$delta (tol=$TOTAL_TOLERANCE); set PARITY_STRICT_SEARCH=1 to fail"
        else
            log_error "Search total mismatch: prod=$PROD_TOTAL preview=$PREV_TOTAL delta=$delta (tol=$TOTAL_TOLERANCE)"
            FAIL=1
        fi
    else
        log_info "Search totals OK (delta=$delta)"
    fi
fi

if [ "$PROD_CA" != "$PREV_CA" ]; then
    log_error "SQLite candidate_actions mismatch: prod=$PROD_CA preview=$PREV_CA"
    FAIL=1
else
    log_info "SQLite candidate_actions OK ($PROD_CA)"
fi

# Preview must expose statusCounts when authenticated as hr-demo on hr
if [ "$PREV_STATUS" = "{}" ] || [ -z "$PREV_STATUS" ]; then
    log_error "Preview statusCounts empty for hr-demo/$HR_WS (check CONVEX_WRITE_SECRET on Convex)"
    FAIL=1
else
    log_info "Preview statusCounts present"
fi

# Prefer exact match when both sides have statusCounts
if [ "$PROD_STATUS" != "{}" ] && [ "$PREV_STATUS" != "{}" ] && [ "$PROD_STATUS" != "$PREV_STATUS" ]; then
    log_warn "statusCounts differ prod vs preview (may be workspace/auth mode). prod=$PROD_STATUS prev=$PREV_STATUS"
    # Soft: if PARITY_STRICT_STATUS=1 hard fail
    if [ "${PARITY_STRICT_STATUS:-0}" = "1" ]; then
        log_error "PARITY_STRICT_STATUS=1 and statusCounts mismatch"
        FAIL=1
    fi
fi

# Optional minScore bucket
if [ "${CHECK_MIN_SCORE:-}" = "80" ] || [ -n "${CHECK_MIN_SCORE:-}" ]; then
    MS="${CHECK_MIN_SCORE:-80}"
    PT="$(preview_auth_curl "$PROD_JAR" "$PROD_HR_WS" --max-time 60 \
        "$PROD_API/api/resumes?source=convex&paged=true&limit=1&minScore=${MS}&${QUERY}" \
        | python3 -c 'import sys,json;print(json.load(sys.stdin)["summary"]["total"])')"
    VT="$(preview_auth_curl "$PREV_JAR" "$HR_WS" --max-time 60 \
        "$PREV_API/api/resumes?source=convex&paged=true&limit=1&minScore=${MS}&${QUERY}" \
        | python3 -c 'import sys,json;print(json.load(sys.stdin)["summary"]["total"])')"
    echo "minScore>=$MS prod=$PT preview=$VT"
    if [ "$PT" != "$VT" ]; then
        log_error "minScore bucket mismatch"
        FAIL=1
    else
        log_info "minScore bucket OK"
    fi
fi

if [ "$FAIL" -ne 0 ]; then
    log_error "PARITY FAIL"
    exit 1
fi
log_info "PARITY OK"
exit 0
