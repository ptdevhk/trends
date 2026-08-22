#!/usr/bin/env bash
# Single entrypoint: make preview a data-faithful clone of production (optional code pin).
#
# Design contract (state surfaces that MUST be synced for HR UI parity):
#   1. Convex tables: resumes, resume_digests, resume_analyses, candidate_status,
#      candidate_blocks, job_descriptions, search_profiles, analysis_*, etc.
#   2. SQLite: output/resume_screening.db (candidate_actions and related)
#   3. Preview-only config: .env.preview (never overwrite with prod)
#   4. Optional: application code pin to prod SHA (separate from data)
#
# Critical policies:
#   - DIGEST_BACKFILL_MODE=skip by default (recomputing digests breaks search totals)
#   - Admin login / AI smoke do not abort data import
#   - Force-recreate preview Convex after import when unhealthy
#   - Parity check after sync
#
# Usage (on ptcloud as root):
#   sudo ASSUME_YES=1 bash deploy/preview-sync-from-prod.sh
#   sudo ASSUME_YES=1 bash deploy/preview-sync-from-prod.sh --with-code-pin
#   sudo ASSUME_YES=1 bash deploy/preview-sync-from-prod.sh --data-only
#
# Env: DIGEST_BACKFILL_MODE, RUN_PREVIEW_AI_SMOKE, RESTORE_STRICT, TOTAL_TOLERANCE, QUERY
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="${LOG_DIR:-/var/log/trends}"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/preview-sync-from-prod-${TS}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

WITH_CODE_PIN=0
DATA_ONLY=1
for arg in "$@"; do
    case "$arg" in
        --with-code-pin) WITH_CODE_PIN=1; DATA_ONLY=0 ;;
        --data-only) DATA_ONLY=1; WITH_CODE_PIN=0 ;;
        -h|--help)
            sed -n '2,30p' "$0"
            exit 0
            ;;
        *)
            log_error "Unknown argument: $arg"
            exit 2
            ;;
    esac
done

require_root
export DIGEST_BACKFILL_MODE="${DIGEST_BACKFILL_MODE:-skip}"
export RUN_PREVIEW_AI_SMOKE="${RUN_PREVIEW_AI_SMOKE:-0}"
export RESTORE_STRICT="${RESTORE_STRICT:-0}"
export SKIP_PREVIEW_AI_SMOKE=1
export CONVEX_RESTORE_SCRIPT="${CONVEX_RESTORE_SCRIPT:-$SCRIPT_DIR/restore-preview-from-prod.sh}"

# Load write secret for quiesce from prod env (do not print it)
if [ -f /etc/trends/env ]; then
    # shellcheck disable=SC1091
    set -a; source /etc/trends/env; set +a
    export CONVEX_WRITE_SECRET
fi

on_err() {
    log_error "preview-sync-from-prod failed at line $1 (log: $LOG_FILE)"
    # Always try to clear prod maintenance if we set it
    if [ -n "${CONVEX_WRITE_SECRET:-}" ]; then
        sudo -u trends env CONVEX_URL=http://127.0.0.1:3210 bash -c \
            'cd /opt/trends/packages/convex && npx convex run system_settings:set "{\"key\":\"maintenanceMode\",\"value\":false,\"updatedBy\":\"preview-sync-fail\"}"' \
            2>/dev/null || true
    fi
    exit 1
}
trap 'on_err $LINENO' ERR

log_step "Preview sync from production"
print_context_report "production" "$PROD_DIR" "$PROD_ENV_FILE"
print_context_report "preview" "$PREVIEW_DIR" "$PREVIEW_ENV_FILE"
confirm_or_exit "Sync production DATA into preview (preview will be replaced; production code unchanged)?"

# --- Phase 0: preflight ---
log_step "0/6 Preflight"
bash "$SCRIPT_DIR/preview-preflight.sh" || log_warn "Preflight reported issues; continuing with caution"

# --- Phase 1: production backup ---
log_step "1/6 Production complete backup"
if [ -x "$SCRIPT_DIR/backup-prod-complete.sh" ]; then
    ASSUME_YES=1 SKIP_RESUME_EXPORT=1 bash "$SCRIPT_DIR/backup-prod-complete.sh" || {
        log_error "Production backup failed — STOP"
        exit 1
    }
else
    log_warn "backup-prod-complete.sh missing; skipping complete backup"
fi

# --- Phase 2: optional code pin ---
if [ "$WITH_CODE_PIN" -eq 1 ]; then
    log_step "2/6 Pin preview application to production SHA"
    ASSUME_YES=1 SKIP_DOCKER_RESTART=1 bash "$SCRIPT_DIR/preview-clone-from-prod.sh"
else
    log_step "2/6 Skip code pin (data-only). Preview keeps current app tree."
fi

# --- Phase 3: full data restore ---
log_step "3/6 Convex + SQLite full-state restore"
ASSUME_YES=1 \
DIGEST_BACKFILL_MODE="$DIGEST_BACKFILL_MODE" \
RUN_PREVIEW_AI_SMOKE=0 \
RESTORE_STRICT=0 \
CONVEX_RESTORE_SCRIPT="$CONVEX_RESTORE_SCRIPT" \
    bash "$SCRIPT_DIR/restore-preview-full-state-from-prod.sh"

# --- Phase 4: isolate preview integrations ---
log_step "4/6 Isolate preview integrations"
ASSUME_YES=1 bash "$SCRIPT_DIR/preview-isolate-integrations.sh" --apply || true

# --- Phase 5: ensure Convex healthy + API restart ---
log_step "5/6 Stabilize preview Convex + API"
cd "$PREVIEW_DIR"
if [ -f docker-compose.preview.yml ]; then
    recreate=0
    if convex_healthy "$PREVIEW_CONVEX_URL"; then
        if [ "${FORCE_CONVEX_RECREATE:-0}" = "1" ]; then
            recreate=1
            log_info "FORCE_CONVEX_RECREATE=1 — force-recreating despite healthy /version"
        else
            log_info "Preview Convex already healthy (/version 200) — skipping force-recreate (override: FORCE_CONVEX_RECREATE=1)"
        fi
    else
        recreate=1
        log_info "Preview Convex not healthy — force-recreating"
    fi
    if [ "$recreate" -eq 1 ]; then
        docker compose -f docker-compose.preview.yml up -d --force-recreate convex
        for i in $(seq 1 48); do
            code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$PREVIEW_CONVEX_URL/version" || echo 000)"
            health="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' trends-preview-convex 2>/dev/null || echo miss)"
            if [ "$code" = "200" ]; then
                log_info "Preview Convex ready (http=$code health=$health)"
                break
            fi
            sleep 5
        done
    fi
fi
systemctl restart "$PREVIEW_API_SERVICE"
wait_for_http "$PREVIEW_API_URL/api/blocks" 120

# --- Phase 6: parity ---
log_step "6/6 Parity check"
if [ -x "$SCRIPT_DIR/preview-parity-check.sh" ]; then
    TOTAL_TOLERANCE="${TOTAL_TOLERANCE:-0}" bash "$SCRIPT_DIR/preview-parity-check.sh" || {
        log_error "Parity check failed. Inspect digests/search indexes; try DIGEST_BACKFILL_MODE=skip re-import."
        exit 1
    }
else
    log_warn "preview-parity-check.sh missing"
fi

# Ensure prod not left in maintenance
if [ -n "${CONVEX_WRITE_SECRET:-}" ]; then
    sudo -u trends env CONVEX_URL=http://127.0.0.1:3210 bash -c \
        'cd /opt/trends/packages/convex && npx convex run system_settings:set "{\"key\":\"maintenanceMode\",\"value\":false,\"updatedBy\":\"preview-sync-done\"}"' \
        2>/dev/null || true
fi

cat <<EOF

=== Preview sync from production complete ===
log=$LOG_FILE
digest_policy=$DIGEST_BACKFILL_MODE
code_pin=$WITH_CODE_PIN
Visit: https://preview.pt-mes.com/hr/resumes
EOF
