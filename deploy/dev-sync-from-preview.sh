#!/usr/bin/env bash
# Make local dev behave like preview (or prod, with --prod-base).
# Runs on the DEV host; ptcloud is only read (export + .backup).
#
# Usage:
#   bash deploy/dev-sync-from-preview.sh                  # preview -> dev
#   bash deploy/dev-sync-from-preview.sh --prod-base      # prod -> dev
#   bash deploy/dev-sync-from-preview.sh --with-file-storage
#   bash deploy/dev-sync-from-preview.sh --digest-backfill=always|skip
#   bash deploy/dev-sync-from-preview.sh --dry-run
#   ASSUME_YES=1 bash deploy/dev-sync-from-preview.sh
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"
# shellcheck source=lib-dev-common.sh
source "$SCRIPT_DIR/lib-dev-common.sh"
# shellcheck source=lib-convex-export-fix.sh
source "$SCRIPT_DIR/lib-convex-export-fix.sh"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG_DIR="$DEV_ROOT/logs"; mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/dev-sync-$TS.log"
exec > >(tee -a "$LOG_FILE") 2>&1

SOURCE="preview"; WITH_STORAGE=0; DIGEST_MODE="auto"; DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --prod-base) SOURCE="prod" ;;
        --with-file-storage) WITH_STORAGE=1 ;;
        --digest-backfill=auto|--digest-backfill=always|--digest-backfill=skip) DIGEST_MODE="${arg#*=}" ;;
        --dry-run) DRY_RUN=1 ;;
        -h|--help) sed -n '1,16p' "$0"; exit 0 ;;
        *) log_error "Unknown argument: $arg"; exit 2 ;;
    esac
done

# set -E trap: restart API if we stopped it
API_STOPPED=0
on_err() {
    log_error "dev-sync-from-preview failed at line $1 (log: $LOG_FILE)"
    [ "$API_STOPPED" = "1" ] && { log_warn "Restarting dev API..."; dev_start_api || true; }
    exit 1
}
trap 'on_err $LINENO' ERR

log_step "Dev sync from $SOURCE (dry-run=$DRY_RUN)"
print_context_report "dev" "$DEV_ROOT" "$DEV_ROOT/.env"
confirm_or_exit "Replace local dev data with $SOURCE data? (local backup taken first)"

# Phase 0 — preflight + backup
dev_require_stack
if [ "$DRY_RUN" = "1" ]; then log_info "DRY-RUN: would back up local state, export $SOURCE, import, swap, seed, verify."; exit 0; fi
dev_backup_local "$TS"

# Phase 1 — source export (read-only on ptcloud)
log_step "1/5 Export $SOURCE Convex + SQLite (read-only)"
SRC_ZIP="$SYNC_TMP/$SOURCE-convex-export-$TS.zip"
SRC_DB="$SYNC_TMP/$SOURCE-rs-sync-$TS.db"
SRC_EXPORT_REMOTE="/tmp/$SOURCE-convex-export-$TS.zip"
SRC_DB_REMOTE="/tmp/$SOURCE-rs-sync-$TS.db"

if [ "$SOURCE" = "preview" ]; then
    # Preview Convex runs in Docker; export inside the container to the
    # bind-mounted /app dir (lands in /home/ubuntu/trends-preview/ on host),
    # then move to /tmp for scp. Mirror restore-preview-from-prod.sh mechanics.
    ssh ptcloud "bash -s" "$TS" "$WITH_STORAGE" <<'REMOTE'
set -euo pipefail
TS="$1"; WITH_STORAGE="$2"
F="/app/preview-convex-export-$TS.zip"
if [ "$WITH_STORAGE" = "1" ]; then EXTRA="--include-file-storage"; else EXTRA=""; fi
docker exec trends-preview-convex bash -c \
  "cd /app/packages/convex && npx convex export --path $F $EXTRA" >/dev/null
sudo mv "/home/ubuntu/trends-preview/preview-convex-export-$TS.zip" "/tmp/preview-convex-export-$TS.zip"
sudo chmod 0644 "/tmp/preview-convex-export-$TS.zip"
sqlite3 /home/ubuntu/trends-preview/output/resume_screening.db ".timeout 5000" ".backup '/tmp/preview-rs-sync-$TS.db'"
ls -lh "/tmp/preview-convex-export-$TS.zip" "/tmp/preview-rs-sync-$TS.db"
REMOTE
else
    # Prod Convex runs as the trends service user (like restore-preview-from-prod.sh)
    ssh ptcloud "bash -s" "$TS" "$WITH_STORAGE" <<'REMOTE'
set -euo pipefail
TS="$1"; WITH_STORAGE="$2"
if [ "$WITH_STORAGE" = "1" ]; then EXTRA="--include-file-storage"; else EXTRA=""; fi
cd /opt/trends/packages/convex
sudo -u trends env CONVEX_URL=http://127.0.0.1:3210 npx convex export \
  --path "/tmp/prod-convex-export-$TS.zip" $EXTRA >/dev/null
sudo chmod 0644 "/tmp/prod-convex-export-$TS.zip"
sudo -u trends sqlite3 /opt/trends/output/resume_screening.db ".timeout 5000" ".backup '/tmp/prod-rs-sync-$TS.db'"
ls -lh "/tmp/prod-convex-export-$TS.zip" "/tmp/prod-rs-sync-$TS.db"
REMOTE
fi

scp "ptcloud:$SRC_EXPORT_REMOTE" "$SRC_ZIP"
scp "ptcloud:$SRC_DB_REMOTE" "$SRC_DB"
log_info "Downloaded: $(ls -lh "$SRC_ZIP" | awk '{print $5}') export, $(ls -lh "$SRC_DB" | awk '{print $5}') sqlite"

# Phase 2 — adaptive fix
log_step "2/5 Fix export"
FIXED_ZIP="$SYNC_TMP/$SOURCE-convex-export-fixed-$TS.zip"
fix_convex_export "$SRC_ZIP" "$DEV_ROOT/packages/convex/convex/schema.ts" "$FIXED_ZIP"

# Phase 3 — import
dev_import_convex "$FIXED_ZIP"

# Phase 4 — adaptive digests
log_step "4/5 Digest policy (mode=$DIGEST_MODE)"
SRC_EPOCH="$(digest_epoch_from_export "$SRC_ZIP")"
LOCAL_EPOCH="$(local_digest_epoch)"
log_info "source digest epoch=$SRC_EPOCH local code epoch=$LOCAL_EPOCH"
BACKFILL=0
case "$DIGEST_MODE" in
    always) BACKFILL=1 ;;
    skip) BACKFILL=0 ;;
    auto) [ "$SRC_EPOCH" -lt "$LOCAL_EPOCH" ] && BACKFILL=1 ;;
esac
if [ "$BACKFILL" = "1" ]; then backfill_dev_digests; else log_info "Keeping source digests verbatim."; fi

# Phase 5 — SQLite swap + auth + API restart
log_step "5/5 SQLite swap, auth, API restart"
dev_stop_api && API_STOPPED=1
dev_swap_sqlite "$SRC_DB"
# load dev .env for seed passwords
set -a; source "$DEV_ROOT/.env"; set +a
dev_seed_auth
API_STOPPED=0
dev_start_api

# Parity gate
bash "$SCRIPT_DIR/dev-parity-check.sh" --source="$SOURCE" || {
    log_error "Parity gate failed. Rollback: restore output/backups/pre-sync-$TS/ + re-import $SYNC_TMP/local-backup-$TS.zip"
    exit 1
}

cat <<EOF

=== Dev sync from $SOURCE complete ===
log=$LOG_FILE
source=$SOURCE digest_mode=$DIGEST_MODE file_storage=$WITH_STORAGE
backups: $SYNC_TMP/local-backup-$TS.zip + output/backups/pre-sync-$TS/
EOF
