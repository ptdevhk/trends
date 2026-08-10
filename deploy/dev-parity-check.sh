#!/usr/bin/env bash
# Source-aware parity gate for dev sync. Runs on the DEV host.
# Usage: bash deploy/dev-parity-check.sh [--source preview|prod] [--dry-run]
#   preview (default): query totals + verified-employer count are HARD gates.
#   prod: those are informational (v0.4.16 semantics differ by design).
#   Corpus + candidate_actions + auth smoke are always hard.
# Env: TOTAL_TOLERANCE (default 0), ASSUME_YES (not used here).
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"
# shellcheck source=lib-dev-common.sh
source "$SCRIPT_DIR/lib-dev-common.sh"

SOURCE="preview"
for arg in "$@"; do
    case "$arg" in
        --source) SOURCE="preview" ;;
        --source=prod) SOURCE="prod" ;;
        --source=preview) SOURCE="preview" ;;
        --dry-run) echo "dry-run: parity gate would run against source=$SOURCE"; exit 0 ;;
        *) log_error "Unknown argument: $arg"; exit 2 ;;
    esac
done

# --- local (dev) side -------------------------------------------------------
dev_login() {
    local jar="$1" pw="${AUTH_HR_DEMO_PASSWORD:-}"
    [ -n "$pw" ] || { log_error "AUTH_HR_DEMO_PASSWORD unset"; return 1; }
    # Emit only the HTTP status code (body discarded) so callers can compare
    # it against 200; -c still populates the cookie jar for later vec/query
    # checks, and a failed connection yields "000" (never an empty string).
    curl -s -o /dev/null -c "$jar" -w '%{http_code}' -X POST "http://127.0.0.1:$DEV_API_PORT/api/auth/login" \
        -H "Content-Type: application/json" -H "X-Workspace-Slug: hr" \
        -d "{\"username\":\"hr-demo\",\"password\":\"$pw\"}"
}

# --- source side (ptcloud) --------------------------------------------------
# Runs queries INSIDE ptcloud so source credentials never leave the server.
# Usage: SOURCE_SSH --source-cmd CMD SOURCE [QUERY]
# Consumes --source-cmd locally and forwards CMD SOURCE [QUERY] positionally
# through `ssh ptcloud 'bash -s' -- ...`; the remote body defines
# source_cmd_remote and dispatches on $1/$2/$3. The query is base64-encoded
# because ssh rejoins args with spaces and the remote shell would otherwise
# re-parse '&' (and other metacharacters) inside it.
SOURCE_SSH() {
    local flag="${1:-}" cmd="${2:-}" src="${3:-}" q="${4:-}" q_b64=""
    [ "$flag" = "--source-cmd" ] || { log_error "SOURCE_SSH: expected --source-cmd, got: $flag"; return 1; }
    if [ -n "$q" ]; then
        q_b64="$(printf '%s' "$q" | base64 -w0 2>/dev/null || printf '%s' "$q" | base64 | tr -d '\n')"
    fi
    ssh ptcloud 'bash -s' -- "$cmd" "$src" "$q_b64" <<'REMOTE'
set -euo pipefail

# Runs on ptcloud. $1 = cmd (corpus|actions|vec|query), $2 = source
# (preview|prod), $3 = query string (query only). Source choice selects the
# env file, API base, db path and convex run prefix. Credentials are read from
# the source env file inside this session only — never echoed, never written
# to a local file.
source_cmd_remote() {
    local cmd="${1:-}" src="${2:-}" q="${3:-}"
    local env_file api_base db_path
    if [ "$src" = "prod" ]; then
        env_file="/etc/trends/env"
        api_base="http://127.0.0.1:3000"
        db_path="/opt/trends/output/resume_screening.db"
    else
        env_file="/home/ubuntu/trends-preview/.env.preview"
        api_base="http://127.0.0.1:3002"
        db_path="/home/ubuntu/trends-preview/output/resume_screening.db"
    fi
    case "$cmd" in
        corpus)
            if [ "$src" = "prod" ]; then
                ( cd /opt/trends/packages/convex && sudo -u trends env CONVEX_URL=http://127.0.0.1:3210 npx convex run resumes_search:scanResumePageSlim '{"numItems":100000}' ) 2>/dev/null \
                    | python3 -c 'import json,sys; t=sys.stdin.read(); s=t.find("{"); e=t.rfind("}"); print(len(json.loads(t[s:e+1]).get("docs") or []) if s>=0 and e>s else "NA")'
            else
                docker exec trends-preview-convex bash -c "cd /app/packages/convex && npx convex run resumes_search:scanResumePageSlim '{\"numItems\":100000}'" 2>/dev/null \
                    | python3 -c 'import json,sys; t=sys.stdin.read(); s=t.find("{"); e=t.rfind("}"); print(len(json.loads(t[s:e+1]).get("docs") or []) if s>=0 and e>s else "NA")'
            fi
            ;;
        actions)
            sqlite3 "$db_path" 'SELECT count(*) FROM candidate_actions;'
            ;;
        vec|query)
            set -a; source "$env_file" 2>/dev/null; set +a
            local u="${BOOTSTRAP_HR_DEMO_USER:-hr-demo}" p="${AUTH_HR_DEMO_PASSWORD:-}" jar
            [ -n "$p" ] || { echo "NA"; return 0; }
            jar="$(mktemp)"
            curl -s -c "$jar" -X POST "$api_base/api/auth/login" -H "Content-Type: application/json" -H "X-Workspace-Slug: hr" -d "{\"username\":\"$u\",\"password\":\"$p\"}" >/dev/null
            if [ "$cmd" = "vec" ]; then
                curl -s -b "$jar" "$api_base/api/company-industry-verified-employer-count" -H "X-Workspace-Slug: hr" \
                    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("count","NA") if d.get("success") else "NA")'
            else
                curl -s -b "$jar" "$api_base/api/resumes?source=convex&paged=true&limit=1&offset=0&$q" -H "X-Workspace-Slug: hr" \
                    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("summary",{}).get("total","NA"))'
            fi
            rm -f "$jar"
            ;;
        *)
            echo "unknown-cmd"
            return 1
            ;;
    esac
}

# Dispatch: $1=cmd, $2=source, $3=query (base64)
Q="$(printf '%s' "${3:-}" | base64 -d 2>/dev/null || true)"
source_cmd_remote "$1" "$2" "$Q"
REMOTE
}

# compare_field LABEL DEV_VALUE SRC_VALUE HARD_IF_SOURCE
# Numeric fields honor TOTAL_TOLERANCE; "NA" never fails informational checks.
compare_field() {
    local label="$1" dev_v="$2" src_v="$3" hard="$4"
    local ok=1
    if [ "$src_v" = "NA" ] || [ "$dev_v" = "NA" ]; then
        [ "$hard" = "1" ] && ok=0
    elif [[ "$dev_v" =~ ^[0-9]+$ ]] && [[ "$src_v" =~ ^[0-9]+$ ]]; then
        local diff=$(( dev_v - src_v )); [ ${diff#-} -le "${TOTAL_TOLERANCE:-0}" ] || ok=0
    else
        [ "$dev_v" = "$src_v" ] || ok=0
    fi
    if [ "$ok" = "1" ]; then
        log_info "parity OK   $label: dev=$dev_v src=$src_v${hard:+ (hard)}"
        return 0
    fi
    if [ "$hard" = "1" ]; then
        log_error "parity FAIL $label: dev=$dev_v src=$src_v (hard)"
        return 1
    fi
    log_warn "parity INFO $label: dev=$dev_v src=$src_v (informational)"
    return 0
}

# --- gather -----------------------------------------------------------------
main() {
HARD="1"; [ "$SOURCE" = "prod" ] && HARD="0"
DEV_JAR="$(mktemp)"; SRC_JAR="$(mktemp)"; FAILED=0
set +e
DEV_LOGIN_CODE="$(dev_login "$DEV_JAR")" || true
compare_field "auth-smoke(hr-demo login)" "$DEV_LOGIN_CODE" 200 1 || FAILED=$((FAILED + 1))

# corpus (resumes) via convex scan on both backends
DEV_CORPUS="$(cd "$DEV_ROOT/packages/convex" && CONVEX_URL="$DEV_CONVEX_URL" npx convex run resumes_search:scanResumePageSlim '{"numItems":100000}' 2>/dev/null | python3 -c 'import json,sys; t=sys.stdin.read(); s=t.find("{"); e=t.rfind("}"); print(len(json.loads(t[s:e+1]).get("docs") or []) if s>=0 and e>s else "NA")')"
SRC_CORPUS="$(SOURCE_SSH --source-cmd corpus "$SOURCE" 2>/dev/null)"
compare_field "corpus(resumes)" "$DEV_CORPUS" "$SRC_CORPUS" 1 || FAILED=$((FAILED + 1))

# candidate_actions via sqlite counts
DEV_ACTIONS="$(sqlite3 "$DEV_ROOT/output/resume_screening.db" 'SELECT count(*) FROM candidate_actions;')"
SRC_ACTIONS="$(SOURCE_SSH --source-cmd actions "$SOURCE" 2>/dev/null)"
compare_field "candidate_actions" "$DEV_ACTIONS" "$SRC_ACTIONS" 1 || FAILED=$((FAILED + 1))

# verified employers via API (admin-only; hr-demo is admin post-sync)
DEV_VEC="$(curl -s -b "$DEV_JAR" "http://127.0.0.1:$DEV_API_PORT/api/company-industry-verified-employer-count" -H "X-Workspace-Slug: hr" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("count","NA") if d.get("success") else "NA")' 2>/dev/null)"
SRC_VEC="$(SOURCE_SSH --source-cmd vec "$SOURCE" 2>/dev/null)"
compare_field "verified-employers" "$DEV_VEC" "$SRC_VEC" "$HARD" || FAILED=$((FAILED + 1))

# baseline query totals (UAT query + no-gate query)
for Q in "q=CNC+Sales&location=Malaysia&minRoleYears=1&roleFilterType=sales" "q=CNC+Sales&location=Malaysia"; do
    DEV_T="$(curl -s -b "$DEV_JAR" "http://127.0.0.1:$DEV_API_PORT/api/resumes?source=convex&paged=true&limit=1&offset=0&$Q" -H "X-Workspace-Slug: hr" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("summary",{}).get("total","NA"))' 2>/dev/null)"
    SRC_T="$(SOURCE_SSH --source-cmd query "$SOURCE" "$Q" 2>/dev/null)"
    compare_field "query[$Q]" "$DEV_T" "$SRC_T" "$HARD" || FAILED=$((FAILED + 1))
done
set -e
rm -f "$DEV_JAR" "$SRC_JAR"

log_step "Parity report (source=$SOURCE) done"
[ "$FAILED" -eq 0 ] || { log_error "$FAILED parity check(s) failed"; exit 1; }
log_info "All parity checks passed."
}

# Guard: run the gate only when executed directly. The fixture test sources
# this file to reach compare_field without any live calls.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main
fi
