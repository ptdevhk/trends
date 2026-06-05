#!/bin/bash
# Restore production Convex data plus API SQLite state into preview.
# Run on the production host; this script intentionally does not SSH.
set -euo pipefail

PROD_DIR="${PROD_DIR:-/opt/trends}"
PREVIEW_DIR="${PREVIEW_DIR:-/home/ubuntu/trends-preview}"
PROD_DB="${PROD_DB:-$PROD_DIR/output/resume_screening.db}"
PREVIEW_DB="${PREVIEW_DB:-$PREVIEW_DIR/output/resume_screening.db}"
PREVIEW_API_SERVICE="${PREVIEW_API_SERVICE:-trends-preview-api}"
PREVIEW_API_URL="${PREVIEW_API_URL:-http://127.0.0.1:3002}"
CONVEX_RESTORE_SCRIPT="${CONVEX_RESTORE_SCRIPT:-$PROD_DIR/deploy/restore-preview-from-prod.sh}"
MODE="all"
API_STOPPED=0

usage() {
    cat <<EOF
Usage: sudo $0 [--sqlite-only|--convex-only]

Restores production state into preview on the current host.

Default:
  1. Run deploy/restore-preview-from-prod.sh for Convex export/import.
  2. Copy production output/resume_screening.db into preview using sqlite .backup.
  3. Restart and verify the preview API.

Environment overrides:
  PROD_DIR              default: /opt/trends
  PREVIEW_DIR           default: /home/ubuntu/trends-preview
  PROD_DB               default: \$PROD_DIR/output/resume_screening.db
  PREVIEW_DB            default: \$PREVIEW_DIR/output/resume_screening.db
  PREVIEW_API_SERVICE   default: trends-preview-api
  PREVIEW_API_URL       default: http://127.0.0.1:3002
  CONVEX_RESTORE_SCRIPT default: \$PROD_DIR/deploy/restore-preview-from-prod.sh
EOF
}

for arg in "$@"; do
    case "$arg" in
        --sqlite-only) MODE="sqlite-only" ;;
        --convex-only) MODE="convex-only" ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            usage >&2
            echo "Unknown argument: $arg" >&2
            exit 2
            ;;
    esac
done

log() {
    printf '%s\n' "$*"
}

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        echo "Run as root or with sudo." >&2
        exit 1
    fi
}

require_command() {
    local command_name="$1"
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "Missing required command: $command_name" >&2
        exit 1
    fi
}

count_candidate_actions() {
    local db_path="$1"
    sqlite3 "$db_path" "SELECT count(*) FROM candidate_actions;"
}

start_preview_api_on_error() {
    if [ "$API_STOPPED" -eq 1 ]; then
        echo "Restore failed after stopping $PREVIEW_API_SERVICE; attempting to start it again..." >&2
        systemctl start "$PREVIEW_API_SERVICE" || true
    fi
}

wait_for_preview_api() {
    local max_wait=120
    local waited=0

    log "Waiting for preview API to become ready at $PREVIEW_API_URL..."
    while ! curl -fsS "$PREVIEW_API_URL/" >/dev/null 2>&1; do
        sleep 2
        waited=$((waited + 2))
        if [ "$waited" -ge "$max_wait" ]; then
            echo "Preview API did not become ready after ${max_wait}s" >&2
            systemctl status "$PREVIEW_API_SERVICE" --no-pager -l >&2 || true
            exit 1
        fi
    done
    log "Preview API ready after ${waited}s"
}

check_endpoint() {
    local path="$1"
    local status=""

    status="$(curl -s -o /dev/null -w '%{http_code}' "$PREVIEW_API_URL$path" || echo 000)"
    printf '%s: %s\n' "$path" "$status"
    if [ "$status" != "200" ]; then
        echo "Preview endpoint failed: $path returned $status" >&2
        exit 1
    fi
}

restore_convex_state() {
    if [ ! -f "$CONVEX_RESTORE_SCRIPT" ]; then
        echo "Missing Convex restore script: $CONVEX_RESTORE_SCRIPT" >&2
        exit 1
    fi

    log "=== Step 1: Restore production Convex state into preview ==="
    bash "$CONVEX_RESTORE_SCRIPT"
}

restore_sqlite_state() {
    local ts=""
    local preview_output_dir=""
    local preview_backup_dir=""
    local prod_backup=""
    local preview_tmp=""
    local prod_count_before=""
    local preview_count_before="missing"
    local preview_count_after=""

    if [ ! -f "$PROD_DB" ]; then
        echo "Missing production SQLite DB: $PROD_DB" >&2
        exit 1
    fi

    ts="$(date +%Y%m%d-%H%M%S)"
    preview_output_dir="$(dirname "$PREVIEW_DB")"
    preview_backup_dir="$preview_output_dir/pre-full-state-restore-$ts"
    prod_backup="/tmp/prod-resume-screening-$ts.db"
    preview_tmp="$preview_output_dir/.resume_screening.db.restore-$ts.tmp"

    log ""
    log "=== Step 2: Restore production SQLite state into preview ==="
    mkdir -p "$preview_output_dir" "$preview_backup_dir"

    prod_count_before="$(count_candidate_actions "$PROD_DB")"
    if [ -f "$PREVIEW_DB" ]; then
        preview_count_before="$(count_candidate_actions "$PREVIEW_DB")"
    fi

    log "Production candidate_actions before restore: $prod_count_before"
    log "Preview candidate_actions before restore: $preview_count_before"

    log "Creating consistent production SQLite backup at $prod_backup..."
    sqlite3 "$PROD_DB" ".timeout 5000" ".backup '$prod_backup'"
    cp "$prod_backup" "$preview_tmp"
    chown ubuntu:ubuntu "$preview_tmp"
    chmod 0644 "$preview_tmp"

    log "Stopping $PREVIEW_API_SERVICE before SQLite swap..."
    trap start_preview_api_on_error ERR
    systemctl stop "$PREVIEW_API_SERVICE"
    API_STOPPED=1

    log "Backing up current preview SQLite files to $preview_backup_dir..."
    for runtime_file in "$PREVIEW_DB" "$PREVIEW_DB-shm" "$PREVIEW_DB-wal"; do
        if [ -e "$runtime_file" ]; then
            cp -a "$runtime_file" "$preview_backup_dir/"
        fi
    done

    log "Replacing preview SQLite DB..."
    rm -f "$PREVIEW_DB" "$PREVIEW_DB-shm" "$PREVIEW_DB-wal"
    mv "$preview_tmp" "$PREVIEW_DB"

    log "Starting $PREVIEW_API_SERVICE..."
    systemctl start "$PREVIEW_API_SERVICE"
    API_STOPPED=0
    trap - ERR

    wait_for_preview_api

    preview_count_after="$(count_candidate_actions "$PREVIEW_DB")"
    log "Preview candidate_actions after restore: $preview_count_after"
    if [ "$preview_count_after" != "$prod_count_before" ]; then
        echo "Preview candidate_actions count does not match production after restore." >&2
        exit 1
    fi

    log "Preview SQLite backup directory: $preview_backup_dir"
}

verify_preview() {
    log ""
    log "=== Step 3: Verify preview API ==="
    check_endpoint "/api/blocks"
    check_endpoint "/api/search-profiles"
}

require_root
require_command sqlite3
require_command curl
require_command systemctl

case "$MODE" in
    all)
        restore_convex_state
        restore_sqlite_state
        verify_preview
        ;;
    sqlite-only)
        restore_sqlite_state
        verify_preview
        ;;
    convex-only)
        restore_convex_state
        ;;
esac

log ""
log "=== Done ==="
log "Preview full-state restore mode: $MODE"
log "Visit https://preview.pt-mes.com/hr/resumes to verify"
