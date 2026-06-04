#!/bin/bash
# Migration test: v0.2.1 backup → v0.3.0 upgrade
# Usage: BACKUP_FILE=/abs/path/resumes-prod-dev.tar.gz scripts/migration-test-run.sh [PHASE]
# PHASE: 1 = v0.2.1 restore + baseline
#        2 = upgrade to HEAD + migrate + verify
#        all = both phases (default)
#
# Prerequisites:
#   - BACKUP_FILE points to a portable resume backup for phase 1/all
#   - BACKUP_FILE must not live under output/resume-backups; migration tests should not depend on ignored local backups
#   - bun, node, npx available
#   - Ports 3210/3211/3000/5173 free (script kills stale processes)

set -euo pipefail
cd "$(dirname "$0")/.."

BACKUP_FILE="${BACKUP_FILE:-}"
RESET_MODE="${RESET_MODE:-migration-only}"
CONFIRM_FRESH_SANDBOX="${CONFIRM_FRESH_SANDBOX:-}"
CONVEX_PORT=3210
BASE_URL="http://localhost:3000"
RESULTS_DIR="output/migration-test-results"
PHASE="${1:-all}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG="$RESULTS_DIR/migration-test-$TIMESTAMP.log"
ORIGINAL_BRANCH=""
DEV_PID=""

mkdir -p "$RESULTS_DIR"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

cleanup() {
    log "Cleaning up..."
    if [ -n "$DEV_PID" ]; then
        kill_dev_ports
    fi
    if [ -n "$ORIGINAL_BRANCH" ]; then
        git checkout "$ORIGINAL_BRANCH" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Kill processes listening on dev ports (Convex 3210/3211, API 3000, Vite 5173)
kill_dev_ports() {
    for port in 3210 3211 3000 5173; do
        pids=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null) || true
        if [ -n "$pids" ]; then
            log "  Killing port $port PIDs: $pids"
            echo "$pids" | xargs kill 2>/dev/null || true
        fi
    done
    sleep 3
}

wait_for_convex() {
    local max_wait=90
    local waited=0
    log "Waiting for Convex at http://127.0.0.1:$CONVEX_PORT..."
    while ! curl -fsS "http://127.0.0.1:$CONVEX_PORT/version" >/dev/null 2>&1; do
        sleep 2
        waited=$((waited + 2))
        if [ $waited -ge $max_wait ]; then
            log "ERROR: Convex not ready after ${max_wait}s"
            return 1
        fi
    done
    log "Convex ready after ${waited}s"
}

wait_for_api() {
    local max_wait=120
    local waited=0
    log "Waiting for API at $BASE_URL..."
    while ! curl -fsS "$BASE_URL/api/health" >/dev/null 2>&1 && ! curl -fsS "$BASE_URL" >/dev/null 2>&1; do
        sleep 2
        waited=$((waited + 2))
        if [ $waited -ge $max_wait ]; then
            log "ERROR: API not ready after ${max_wait}s"
            return 1
        fi
    done
    log "API ready after ${waited}s"
}

install_and_build() {
    log "Installing dependencies..."
    if command -v bun >/dev/null 2>&1; then
        bun install 2>&1 | tail -5 | tee -a "$LOG"
    else
        npm install --legacy-peer-deps 2>&1 | tail -5 | tee -a "$LOG"
    fi
    # Build shared package (required before API/Convex can start)
    if command -v bun >/dev/null 2>&1; then
        bun run --filter '@trends/shared' build 2>&1 | tail -3 | tee -a "$LOG"
    else
        npm --workspace @trends/shared run build 2>&1 | tail -3 | tee -a "$LOG"
    fi
}

run_migrations() {
    log "Running v0.3.0 migration sequence..."
    local migrations=(
        backfillSourceKey
        backfillTaggingEnvelope
        backfillWorkspaceSlugs
        backfillJob5156ProfileUrls
        backfillJob5156WorkHistoryEducation
        backfillJob5156LocationHierarchy
        backfillManual51jobStructuredContent
        backfillIngestData
        backfillAge
        backfillSearchText
        backfillEvidenceText
        backfillPrimaryRuleScore
        validateDataConsistency
    )
    for migration in "${migrations[@]}"; do
        log "  Running: $migration"
        result=$(npm --workspace @trends/convex exec convex run migrations:$migration '{}' 2>&1) || {
            log "  ERROR: $migration failed: $result"
            echo "$result" >> "$LOG"
            return 1
        }
        log "  Done: $migration"
    done
    log "All migrations complete"
}

require_phase1_backup() {
    if [ -z "$BACKUP_FILE" ]; then
        log "ERROR: BACKUP_FILE is required for phase 1/all."
        log "Usage: BACKUP_FILE=/abs/path/resumes-prod-dev.tar.gz $0 [1|all]"
        exit 1
    fi

    case "$BACKUP_FILE" in
        output/resume-backups/*|./output/resume-backups/*|"$PWD"/output/resume-backups/*)
            log "ERROR: BACKUP_FILE must not point inside output/resume-backups."
            log "Use an external fixture path so migration tests do not restore from ignored local backups."
            exit 1
            ;;
    esac

    if [ ! -f "$BACKUP_FILE" ]; then
        log "ERROR: Backup file not found: $BACKUP_FILE"
        exit 1
    fi

    log "Backup: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
}

prepare_fresh_sandbox() {
    if [ "$RESET_MODE" != "fresh-sandbox" ]; then
        return 0
    fi

    if [ "$PHASE" = "2" ]; then
        log "ERROR: RESET_MODE=fresh-sandbox is not valid with phase 2 only."
        log "Run phase 1 or all so the reset, restore baseline, and upgrade remain coupled."
        exit 1
    fi

    if [ "$CONFIRM_FRESH_SANDBOX" != "1" ]; then
        log "ERROR: CONFIRM_FRESH_SANDBOX=1 is required for RESET_MODE=fresh-sandbox."
        exit 1
    fi

    log "=== FRESH SANDBOX RESET ==="
    kill_dev_ports
    DEV_PID=""

    log "Removing ignored local state under output/ while preserving output/resume-backups..."
    if [ -d output ]; then
        if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
            git clean -fdX output/ -e output/resume-backups/
        else
            rm -f output/resume_screening.db output/resume_screening.db-shm output/resume_screening.db-wal
            rm -rf output/rss
        fi
    fi

    log "Removing local Convex and web environment selectors..."
    rm -f packages/convex/.env.local apps/web/.env.local

    if [ -d "$HOME/.convex/anonymous-convex-backend-state" ]; then
        log "Wiping anonymous local Convex backend state..."
        rm -rf "$HOME/.convex/anonymous-convex-backend-state"
    fi

    rm -f "$RESULTS_DIR/baseline-count.txt"
    log "Fresh sandbox reset complete"
}

# === PHASE 1: v0.2.1 restore + baseline ===
phase1() {
    log "=== PHASE 1: v0.2.1 Restore + Baseline ==="

    require_phase1_backup
    prepare_fresh_sandbox

    kill_dev_ports

    # Save current branch for cleanup
    ORIGINAL_BRANCH=$(git branch --show-current)

    # Guard: dirty tree blocks checkout
    if ! git diff --quiet || ! git diff --cached --quiet; then
        log "ERROR: Working tree is dirty. Stash or commit changes before running migration test."
        exit 1
    fi

    # Checkout v0.2.1
    log "Checking out v0.2.1..."
    git checkout v0.2.1 2>&1 | tee -a "$LOG"

    install_and_build

    # Start dev in background
    log "Starting dev (v0.2.1)..."
    SKIP_MATCH_SEED=true make dev-critical > "$RESULTS_DIR/dev-v021.log" 2>&1 &
    DEV_PID=$!
    log "Dev PID: $DEV_PID"

    # Wait for Convex first, then API
    wait_for_convex
    wait_for_api

    # Clear resumes before restore
    log "Clearing existing resumes..."
    make clear-resumes 2>&1 | tee -a "$LOG" || {
        log "WARNING: clear-resumes failed, attempting retry..."
        sleep 5
        make clear-resumes 2>&1 | tee -a "$LOG"
    }

    # Restore backup
    log "Restoring backup..."
    SKIP_AUTO_BACKUP=1 make restore-resumes FILE="$BACKUP_FILE" MODE=replace YES=1 2>&1 | tee -a "$LOG"

    # Wait for restore to settle
    sleep 5

    # Baseline verification
    log "Recording baseline metrics..."
    scripts/migration-test-verify.sh "$BASE_URL" "$RESULTS_DIR/baseline-v021-$TIMESTAMP.log"

    # Save baseline count via Convex CLI (API response format varies between versions)
    BASELINE_COUNT=$(npm --workspace @trends/convex exec convex run resumes:count '{}' 2>/dev/null || echo "error")
    echo "$BASELINE_COUNT" > "$RESULTS_DIR/baseline-count.txt"
    log "Baseline count: $BASELINE_COUNT"

    # Stop dev
    kill_dev_ports
    DEV_PID=""

    log "=== PHASE 1 COMPLETE ==="
    log "Baseline saved to $RESULTS_DIR/baseline-v021-$TIMESTAMP.log"
}

# === PHASE 2: upgrade to HEAD + migrate + verify ===
phase2() {
    log "=== PHASE 2: Upgrade to HEAD + Migrate + Verify ==="

    kill_dev_ports

    # Read baseline count
    BASELINE_COUNT=$(cat "$RESULTS_DIR/baseline-count.txt" 2>/dev/null || echo "unknown")
    log "Baseline count: $BASELINE_COUNT"

    # Checkout HEAD
    log "Checking out HEAD (v0.3.0)..."
    git checkout main 2>&1 | tee -a "$LOG"

    install_and_build

    # Start dev in background
    log "Starting dev (v0.3.0)..."
    SKIP_MATCH_SEED=true make dev-critical > "$RESULTS_DIR/dev-v030.log" 2>&1 &
    DEV_PID=$!
    log "Dev PID: $DEV_PID"

    # Wait for Convex first, then API
    wait_for_convex
    wait_for_api

    # Run migrations
    run_migrations

    # Wait for migrations to settle
    sleep 5

    # Post-upgrade verification
    log "Running post-upgrade verification..."
    scripts/migration-test-verify.sh "$BASE_URL" "$RESULTS_DIR/post-upgrade-$TIMESTAMP.log"

    # Compare counts via Convex CLI
    POST_COUNT=$(npm --workspace @trends/convex exec convex run resumes:count '{}' 2>/dev/null || echo "error")
    log "Post-upgrade count: $POST_COUNT"
    log "Baseline count: $BASELINE_COUNT"

    if [ "$POST_COUNT" = "error" ] || [ "$BASELINE_COUNT" = "error" ]; then
        log "WARN: Count comparison unreliable — one or both counts failed"
    elif [ "$POST_COUNT" = "$BASELINE_COUNT" ]; then
        log "PASS: Resume count matches baseline"
    else
        log "FAIL: Resume count mismatch! baseline=$BASELINE_COUNT post=$POST_COUNT"
    fi

    # Stop dev
    kill_dev_ports
    DEV_PID=""

    log "=== PHASE 2 COMPLETE ==="
    log "Results saved to $RESULTS_DIR/post-upgrade-$TIMESTAMP.log"
}

# === MAIN ===
log "Migration test starting (phase=$PHASE)"
log "Results directory: $RESULTS_DIR"

case "$PHASE" in
    1) phase1 ;;
    2) phase2 ;;
    all)
        phase1
        log ""
        log "Pausing 10s before Phase 2..."
        sleep 10
        phase2
        ;;
    *)
        log "Unknown phase: $PHASE"
        log "Usage: $0 [1|2|all]"
        exit 1
        ;;
esac

log ""
log "=== MIGRATION TEST COMPLETE ==="
log "Logs: $RESULTS_DIR/"
log "Review: cat $LOG"
