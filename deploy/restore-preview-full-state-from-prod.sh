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
PREVIEW_RESUME_SMOKE_PATH="/api/resumes?source=convex&paged=true&limit=1"
PREVIEW_CONVEX_URL="${PREVIEW_CONVEX_URL:-http://127.0.0.1:4210}"
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
  PREVIEW_CONVEX_URL    default: http://127.0.0.1:4210
  CONVEX_RESTORE_SCRIPT default: \$PROD_DIR/deploy/restore-preview-from-prod.sh
  SKIP_PREVIEW_AI_SMOKE set to 1/true/yes to skip the bounded AI analysis smoke
  RUN_PREVIEW_AI_SMOKE  set to 1 to run AI smoke (default off for data restore)
  DIGEST_BACKFILL_MODE  skip|if-empty|always (default skip — preserves prod search digests)
  RESTORE_STRICT        set to 1 to hard-fail on admin login check
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

run_preview_ai_smoke() {
    local keyword="${PREVIEW_AI_SMOKE_KEYWORD:-CNC}"
    local timeout="${PREVIEW_AI_SMOKE_TIMEOUT_SEC:-300}"

    case "${SKIP_PREVIEW_AI_SMOKE:-}" in
        1|true|yes)
            log "Skipping preview AI smoke because SKIP_PREVIEW_AI_SMOKE is set."
            return 0
            ;;
    esac

    log ""
    log "=== Step 4: Preview AI analysis smoke ==="
    if [ -x "$PREVIEW_DIR/node_modules/.bin/tsx" ]; then
        cd "$PREVIEW_DIR" && \
            CONVEX_URL="$PREVIEW_CONVEX_URL" \
            ANALYSIS_TIMEOUT_SEC="$timeout" \
            "$PREVIEW_DIR/node_modules/.bin/tsx" scripts/verify-critical-path.ts \
                --mode=seeded \
                --keyword="$keyword" \
                --analysis-timeout-sec="$timeout" \
                --json
        return
    fi

    cd "$PREVIEW_DIR" && \
        CONVEX_URL="$PREVIEW_CONVEX_URL" \
        ANALYSIS_TIMEOUT_SEC="$timeout" \
        npx tsx scripts/verify-critical-path.ts \
            --mode=seeded \
            --keyword="$keyword" \
            --analysis-timeout-sec="$timeout" \
            --json
}

restore_convex_state() {
    if [ ! -f "$CONVEX_RESTORE_SCRIPT" ]; then
        # Prefer host mirror / preview tree scripts when prod tree lags.
        if [ -f "$PREVIEW_DIR/deploy/restore-preview-from-prod.sh" ]; then
            CONVEX_RESTORE_SCRIPT="$PREVIEW_DIR/deploy/restore-preview-from-prod.sh"
        elif [ -f /home/ubuntu/trends/deploy/restore-preview-from-prod.sh ]; then
            CONVEX_RESTORE_SCRIPT=/home/ubuntu/trends/deploy/restore-preview-from-prod.sh
        else
            echo "Missing Convex restore script: $CONVEX_RESTORE_SCRIPT" >&2
            exit 1
        fi
    fi

    log "=== Step 1: Restore production Convex state into preview ==="
    log "Using CONVEX_RESTORE_SCRIPT=$CONVEX_RESTORE_SCRIPT"
    log "DIGEST_BACKFILL_MODE=${DIGEST_BACKFILL_MODE:-skip}"
    # Data restore must complete even if admin login / AI smoke would fail.
    DIGEST_BACKFILL_MODE="${DIGEST_BACKFILL_MODE:-skip}" \
    RUN_PREVIEW_AI_SMOKE="${RUN_PREVIEW_AI_SMOKE:-0}" \
    SKIP_PREVIEW_AI_SMOKE="${SKIP_PREVIEW_AI_SMOKE:-1}" \
    RESTORE_STRICT="${RESTORE_STRICT:-0}" \
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

stabilize_preview_convex() {
    log ""
    log "=== Stabilize preview Convex after import/swap ==="
    if [ -f "$PREVIEW_DIR/docker-compose.preview.yml" ]; then
        cd "$PREVIEW_DIR"
        docker compose -f docker-compose.preview.yml up -d --force-recreate convex
        local i=0
        local code="000"
        for i in $(seq 1 48); do
            code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$PREVIEW_CONVEX_URL/version" || echo 000)"
            if [ "$code" = "200" ]; then
                log "Preview Convex /version → 200 after ${i} attempts"
                break
            fi
            sleep 5
        done
        if [ "$code" != "200" ]; then
            echo "Preview Convex did not become healthy after stabilize" >&2
            exit 1
        fi
    fi
    systemctl restart "$PREVIEW_API_SERVICE"
    wait_for_preview_api
}

verify_preview() {
    log ""
    log "=== Step 3: Verify preview API ==="
    # Retries: post-import Convex can reset sockets for 1–2 minutes.
    local path="$1"
    local attempts=20
    local i=0
    local status="000"
    for i in $(seq 1 "$attempts"); do
        status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$PREVIEW_API_URL$path" || echo 000)"
        printf '  try %s %s → %s\n' "$i" "$path" "$status"
        if [ "$status" = "200" ]; then
            return 0
        fi
        sleep 3
    done
    echo "Preview endpoint failed after ${attempts} tries: $path returned $status" >&2
    exit 1
}

verify_preview_endpoints() {
    verify_preview "/api/blocks"
    verify_preview "$PREVIEW_RESUME_SMOKE_PATH"
}

require_root
require_command sqlite3
require_command curl
require_command systemctl

case "$MODE" in
    all)
        restore_convex_state
        restore_sqlite_state
        stabilize_preview_convex
        verify_preview_endpoints
        case "${RUN_PREVIEW_AI_SMOKE:-0}" in
            1|true|yes) run_preview_ai_smoke ;;
            *) log "Skipping AI smoke (set RUN_PREVIEW_AI_SMOKE=1 to enable)." ;;
        esac
        ;;
    sqlite-only)
        restore_sqlite_state
        stabilize_preview_convex
        verify_preview_endpoints
        case "${RUN_PREVIEW_AI_SMOKE:-0}" in
            1|true|yes) run_preview_ai_smoke ;;
            *) log "Skipping AI smoke (set RUN_PREVIEW_AI_SMOKE=1 to enable)." ;;
        esac
        ;;
    convex-only)
        restore_convex_state
        stabilize_preview_convex
        verify_preview_endpoints
        case "${RUN_PREVIEW_AI_SMOKE:-0}" in
            1|true|yes) run_preview_ai_smoke ;;
            *) log "Skipping AI smoke (set RUN_PREVIEW_AI_SMOKE=1 to enable)." ;;
        esac
        ;;
esac

log ""
log "=== Done ==="
log "Preview full-state restore mode: $MODE"
log "Visit https://preview.pt-mes.com/hr/resumes to verify"
log "Parity: bash deploy/preview-parity-check.sh"
