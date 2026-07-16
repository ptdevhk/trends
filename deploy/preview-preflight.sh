#!/usr/bin/env bash
# Read-only preflight for preview work on ptcloud.
# Confirms host identity, paths, env isolation, and refuses production targets.
#
# Usage:
#   sudo bash deploy/preview-preflight.sh
#   bash deploy/preview-preflight.sh --json
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"

JSON=0
for arg in "$@"; do
    case "$arg" in
        --json) JSON=1 ;;
        -h|--help)
            sed -n '2,10p' "$0"
            exit 0
            ;;
        *)
            log_error "Unknown argument: $arg"
            exit 2
            ;;
    esac
done

FAIL=0
fail() { log_error "$*"; FAIL=$((FAIL + 1)); }
ok()   { log_info "✓ $*"; }

log_step "Preview preflight (read-only)"
print_context_report "preview" "$PREVIEW_DIR" "$PREVIEW_ENV_FILE"
print_context_report "production(read-only)" "$PROD_DIR" "$PROD_ENV_FILE"

# Directory presence
[[ -d "$PREVIEW_DIR" ]] && ok "preview dir exists: $PREVIEW_DIR" || fail "missing preview dir: $PREVIEW_DIR"
[[ -d "$PROD_DIR" ]] && ok "prod dir exists: $PROD_DIR" || fail "missing prod dir: $PROD_DIR"
[[ -f "$PREVIEW_ENV_FILE" ]] && ok "preview env: $PREVIEW_ENV_FILE" || fail "missing $PREVIEW_ENV_FILE"
[[ -f "$PROD_ENV_FILE" ]] && ok "prod env: $PROD_ENV_FILE" || fail "missing $PROD_ENV_FILE"

# Env isolation
if [[ -f "$PREVIEW_ENV_FILE" ]]; then
    if assert_preview_env_file "$PREVIEW_ENV_FILE"; then
        ok "preview env isolation checks passed"
    else
        fail "preview env isolation checks failed"
    fi
fi

# Must not point DB at prod path
if [[ -f "$PREVIEW_DB" ]]; then
    PREVIEW_DB_REAL="$(readlink -f "$PREVIEW_DB" 2>/dev/null || echo "$PREVIEW_DB")"
    PROD_DB_REAL="$(readlink -f "$PROD_DB" 2>/dev/null || echo "$PROD_DB")"
    if [[ "$PREVIEW_DB_REAL" == "$PROD_DB_REAL" ]]; then
        fail "Preview SQLite path resolves to production DB!"
    else
        ok "preview SQLite is separate: $PREVIEW_DB_REAL"
    fi
else
    log_warn "preview SQLite not present yet: $PREVIEW_DB"
fi

# Ports / services
if systemctl is-active --quiet "$PREVIEW_API_SERVICE" 2>/dev/null; then
    ok "$PREVIEW_API_SERVICE active"
else
    log_warn "$PREVIEW_API_SERVICE not active"
fi
if systemctl is-active --quiet trends-api.service 2>/dev/null; then
    ok "production trends-api active (must remain untouched)"
fi

# Convex ports
PROD_CV="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$PROD_CONVEX_URL/version" || echo 000)"
PREV_CV="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$PREVIEW_CONVEX_URL/version" || echo 000)"
[[ "$PROD_CV" == "200" ]] && ok "prod convex /version → $PROD_CV" || log_warn "prod convex /version → $PROD_CV"
[[ "$PREV_CV" == "200" ]] && ok "preview convex /version → $PREV_CV" || log_warn "preview convex /version → $PREV_CV (may need recovery)"

# Public hosts
PROD_WEB="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$PROD_PUBLIC_HOST/" || echo 000)"
PREV_WEB="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$PREVIEW_PUBLIC_HOST/" || echo 000)"
ok "https://$PROD_PUBLIC_HOST/ → $PROD_WEB"
ok "https://$PREVIEW_PUBLIC_HOST/ → $PREV_WEB"

# Guard: install.sh would be dangerous from preview without routing
if [[ -f "$PREVIEW_DIR/scripts/install.sh" ]]; then
    if grep -q 'assert_production_install_target' "$PREVIEW_DIR/scripts/install.sh" 2>/dev/null || \
       grep -q 'assert_production_install_target' "$PROD_DIR/scripts/install.sh" 2>/dev/null; then
        ok "install.sh contains production safety guard"
    else
        log_warn "install.sh may lack production safety guard — use deploy/preview-upgrade.sh instead of bare install.sh"
    fi
fi

if [[ "$JSON" -eq 1 ]]; then
    python3 - <<PY
import json
print(json.dumps({
  "fail": $FAIL,
  "preview_dir": "$PREVIEW_DIR",
  "prod_dir": "$PROD_DIR",
  "preview_convex_http": "$PREV_CV",
  "prod_convex_http": "$PROD_CV",
}, indent=2))
PY
fi

echo
if [[ "$FAIL" -gt 0 ]]; then
    log_error "Preflight FAILED with $FAIL error(s). STOP."
    exit 1
fi
log_info "Preflight OK. Safe to continue preview-only operations."
exit 0
