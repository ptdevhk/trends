#!/usr/bin/env bash
# Compare production vs preview search/data surfaces for restore parity.
# Preview requires auth as hr-demo on workspace hr (post no-auth→auth).
# Read-only. Exit 0 when within tolerances; exit 1 on mismatch.
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
FAIL=0

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

fetch_summary_prod() {
    local url="$PROD_API/api/resumes?source=convex&paged=true&limit=1&${QUERY}"
    curl -fsS --max-time 60 "$url"
}

fetch_summary_preview() {
    local jar="$1"
    local url="$PREV_API/api/resumes?source=convex&paged=true&limit=1&${QUERY}"
    preview_auth_curl "$jar" "$HR_WS" --max-time 60 "$url"
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
echo "preview_user=$HR_USER workspace=$HR_WS"

if [[ -z "$HR_PASS" ]]; then
    log_error "AUTH_HR_DEMO_PASSWORD unset — cannot auth preview parity"
    exit 1
fi

JAR="/tmp/preview-parity-hr.jar"
if ! preview_auth_login "$HR_USER" "$HR_PASS" "$JAR"; then
    log_error "hr-demo login failed for parity"
    exit 1
fi

PROD_JSON="$(fetch_summary_prod)"
PREV_JSON="$(fetch_summary_preview "$JAR")"

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
        log_error "Search total mismatch: prod=$PROD_TOTAL preview=$PREV_TOTAL delta=$delta (tol=$TOTAL_TOLERANCE)"
        FAIL=1
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
    PT="$(curl -fsS --max-time 60 "$PROD_API/api/resumes?source=convex&paged=true&limit=1&minScore=${MS}&${QUERY}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["summary"]["total"])')"
    VT="$(preview_auth_curl "$JAR" "$HR_WS" --max-time 60 \
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

rm -f "$JAR"

if [ "$FAIL" -ne 0 ]; then
    log_error "PARITY FAIL"
    exit 1
fi
log_info "PARITY OK"
exit 0
