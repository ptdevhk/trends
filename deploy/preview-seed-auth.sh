#!/usr/bin/env bash
# Seed canonical preview auth accounts: admin@dev + hr-demo@hr.
# Idempotent. Never seeds failed product usernames.
#
# Usage (on ptcloud, from preview tree or mirror):
#   bash deploy/preview-seed-auth.sh
#   PREVIEW_DIR=/home/ubuntu/trends-preview bash deploy/preview-seed-auth.sh
#
# Env (from .env.preview):
#   AUTH_BOOTSTRAP_PASSWORD, AUTH_HR_DEMO_PASSWORD
#   BOOTSTRAP_* (see deploy/env.preview)
#   BOOTSTRAP_ORPHAN_LOCAL_USERS=purge|ignore  (default purge)
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"

PREVIEW_DIR="${PREVIEW_DIR:-/home/ubuntu/trends-preview}"
PREVIEW_ENV_FILE="${PREVIEW_ENV_FILE:-$PREVIEW_DIR/.env.preview}"
PREVIEW_DB="${PREVIEW_DB:-$PREVIEW_DIR/output/resume_screening.db}"

if [[ ! -f "$PREVIEW_ENV_FILE" ]]; then
    log_error "Missing preview env: $PREVIEW_ENV_FILE"
    exit 1
fi

set -a
# shellcheck disable=SC1090
source "$PREVIEW_ENV_FILE"
set +a

ADMIN_USERS="${BOOTSTRAP_ADMIN_USERS:-admin}"
ADMIN_WS="${BOOTSTRAP_ADMIN_WORKSPACE:-dev}"
ADMIN_PW_ENV="${BOOTSTRAP_ADMIN_PASSWORD_ENV:-AUTH_BOOTSTRAP_PASSWORD}"
HR_USER="${BOOTSTRAP_HR_DEMO_USER:-hr-demo}"
HR_WS="${BOOTSTRAP_HR_DEMO_WORKSPACE:-hr}"
HR_PW_ENV="${BOOTSTRAP_HR_DEMO_PASSWORD_ENV:-AUTH_HR_DEMO_PASSWORD}"
ORPHAN_MODE="${BOOTSTRAP_ORPHAN_LOCAL_USERS:-purge}"
ORPHAN_KEEP="${BOOTSTRAP_ORPHAN_KEEP_USERS:-}"

# Resolve password values via indirection env names when set
_admin_pw="$(printenv "$ADMIN_PW_ENV" 2>/dev/null || true)"
_hr_pw="$(printenv "$HR_PW_ENV" 2>/dev/null || true)"
export AUTH_BOOTSTRAP_PASSWORD="${AUTH_BOOTSTRAP_PASSWORD:-${_admin_pw:-}}"
export AUTH_HR_DEMO_PASSWORD="${AUTH_HR_DEMO_PASSWORD:-${_hr_pw:-}}"
if [[ -z "${AUTH_BOOTSTRAP_PASSWORD:-}" ]]; then
    log_error "AUTH_BOOTSTRAP_PASSWORD / $ADMIN_PW_ENV unset"
    exit 1
fi
if [[ -z "${AUTH_HR_DEMO_PASSWORD:-}" ]]; then
    log_error "AUTH_HR_DEMO_PASSWORD / $HR_PW_ENV unset"
    exit 1
fi
# manage-user --password-env reads these names
export "$ADMIN_PW_ENV=$AUTH_BOOTSTRAP_PASSWORD"
export "$HR_PW_ENV=$AUTH_HR_DEMO_PASSWORD"

run_manage() {
    local username="$1"
    local workspace="$2"
    local pw_env="$3"
    (
        cd "$PREVIEW_DIR"
        if command -v bunx >/dev/null 2>&1; then
            bunx tsx scripts/auth/manage-user.ts \
                --username "$username" \
                --workspace "$workspace" \
                --role admin \
                --password-env "$pw_env" \
                --display-name "$username" \
                --output agent
        elif [[ -x "$PREVIEW_DIR/node_modules/.bin/tsx" ]]; then
            "$PREVIEW_DIR/node_modules/.bin/tsx" scripts/auth/manage-user.ts \
                --username "$username" \
                --workspace "$workspace" \
                --role admin \
                --password-env "$pw_env" \
                --display-name "$username" \
                --output agent
        else
            npx tsx scripts/auth/manage-user.ts \
                --username "$username" \
                --workspace "$workspace" \
                --role admin \
                --password-env "$pw_env" \
                --display-name "$username" \
                --output agent
        fi
    )
}

log_step "Seed preview bootstrap accounts"
log_info "admin users=$ADMIN_USERS workspace=$ADMIN_WS"
log_info "hr-demo user=$HR_USER workspace=$HR_WS"
log_info "orphan_mode=$ORPHAN_MODE"

IFS=',' read -ra ADMIN_ARR <<< "$ADMIN_USERS"
for u in "${ADMIN_ARR[@]}"; do
    u="$(echo "$u" | xargs)"
    [[ -z "$u" ]] && continue
    log_info "seeding ops admin '$u' → $ADMIN_WS"
    run_manage "$u" "$ADMIN_WS" "$ADMIN_PW_ENV"
    if [[ "${BOOTSTRAP_ADMIN_ALSO_HR:-}" =~ ^(1|true|yes)$ ]]; then
        log_info "also granting '$u' → $HR_WS"
        run_manage "$u" "$HR_WS" "$ADMIN_PW_ENV"
    fi
done

log_info "seeding HR demo '$HR_USER' → $HR_WS"
run_manage "$HR_USER" "$HR_WS" "$HR_PW_ENV"
if [[ "${BOOTSTRAP_HR_DEMO_ALSO_DEV:-}" =~ ^(1|true|yes)$ ]]; then
    log_info "also granting '$HR_USER' → $ADMIN_WS"
    run_manage "$HR_USER" "$ADMIN_WS" "$HR_PW_ENV"
fi

# Build keep-set of local provider_subjects
KEEP_LIST="$ADMIN_USERS,$HR_USER,$ORPHAN_KEEP"
KEEP_SQL=""
IFS=',' read -ra KEEP_ARR <<< "$KEEP_LIST"
for k in "${KEEP_ARR[@]}"; do
    k="$(echo "$k" | xargs)"
    [[ -z "$k" ]] && continue
    if [[ -n "$KEEP_SQL" ]]; then
        KEEP_SQL+=","
    fi
    # escape single quotes
    k_esc="${k//\'/\'\'}"
    KEEP_SQL+="'$k_esc'"
done

PURGED=0
if [[ -f "$PREVIEW_DB" && -n "$KEEP_SQL" ]]; then
    case "$ORPHAN_MODE" in
        purge|PURGE)
            log_info "Purging orphan local users not in keep-set"
            # List orphans
            mapfile -t ORPHANS < <(sqlite3 "$PREVIEW_DB" \
                "SELECT provider_subject || '|' || user_id FROM auth_identities
                 WHERE provider = 'local'
                   AND provider_subject NOT IN ($KEEP_SQL);" 2>/dev/null || true)
            for row in "${ORPHANS[@]:-}"; do
                [[ -z "$row" ]] && continue
                subj="${row%%|*}"
                uid="${row##*|}"
                log_info "purge local user subject=$subj user_id=$uid"
                sqlite3 "$PREVIEW_DB" <<SQL
BEGIN;
DELETE FROM auth_sessions WHERE user_id = '$uid';
DELETE FROM auth_password_credentials WHERE user_id = '$uid';
DELETE FROM workspace_memberships WHERE user_id = '$uid';
DELETE FROM auth_identities WHERE user_id = '$uid';
DELETE FROM auth_events WHERE user_id = '$uid';
DELETE FROM users WHERE id = '$uid';
COMMIT;
SQL
                PURGED=$((PURGED + 1))
            done
            ;;
        ignore|IGNORE|"")
            mapfile -t ORPHANS < <(sqlite3 "$PREVIEW_DB" \
                "SELECT provider_subject FROM auth_identities
                 WHERE provider = 'local'
                   AND provider_subject NOT IN ($KEEP_SQL);" 2>/dev/null || true)
            if [[ ${#ORPHANS[@]} -gt 0 && -n "${ORPHANS[0]:-}" ]]; then
                log_warn "orphan local users present (ignored): ${ORPHANS[*]}"
            fi
            ;;
        *)
            log_warn "Unknown BOOTSTRAP_ORPHAN_LOCAL_USERS=$ORPHAN_MODE (use purge|ignore)"
            ;;
    esac
fi

log_info "Seed complete (purged_orphans=$PURGED)"
echo "{\"success\":true,\"adminUsers\":\"$ADMIN_USERS\",\"hrDemoUser\":\"$HR_USER\",\"hrWorkspace\":\"$HR_WS\",\"purgedOrphans\":$PURGED}"
