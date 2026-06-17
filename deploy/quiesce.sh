#!/bin/bash
# Shared quiesce/release helpers for Convex restore scripts.
# Sources by restore-preview-from-prod.sh and restore-prod-from-preview.sh.
#
# Usage:
#   source "$(dirname "$0")/quiesce.sh"
#   quiesce_writers "$CONVEX_DIR" "$CONVEX_URL" "preview-restore"
#   ... export/import ...
#   release_writers "$CONVEX_DIR" "$CONVEX_URL"

set -e

DRAIN_MAX_WAIT=90
DRAIN_POLL_INTERVAL=5
DRAIN_THRESHOLD=1  # tolerate 1 stuck task

quiesce_writers() {
    local convex_dir="$1"
    local convex_url="$2"
    local reason="${3:-restore}"

    echo "=== Quiescing writers (reason: $reason) ==="

    # Set maintenance flag
    sudo -u trends bash -c "
        cd '$convex_dir' && \
        CONVEX_URL='$convex_url' \
        npx convex run system_settings:set '{\"key\":\"maintenanceMode\",\"value\":true,\"updatedBy\":\"restore-script\",\"reason\":\"$reason\"}' 2>&1
    " | tail -3

    # Wait for in-flight analysis + resume tasks to drain
    echo "Waiting for in-flight writers to drain (max ${DRAIN_MAX_WAIT}s)..."
    local waited=0
    while [ "$waited" -lt "$DRAIN_MAX_WAIT" ]; do
        local analysis_pending resume_pending
        analysis_pending=$(sudo -u trends bash -c "
            cd '$convex_dir' && \
            CONVEX_URL='$convex_url' \
            npx convex run analysis_tasks:countProcessing '{}' 2>&1
        " | grep -E '^[0-9]+$' | tail -1)
        resume_pending=$(sudo -u trends bash -c "
            cd '$convex_dir' && \
            CONVEX_URL='$convex_url' \
            npx convex run resume_tasks:countProcessing '{}' 2>&1
        " | grep -E '^[0-9]+$' | tail -1)

        analysis_pending="${analysis_pending:-0}"
        resume_pending="${resume_pending:-0}"
        local total=$((analysis_pending + resume_pending))

        if [ "$total" -le "$DRAIN_THRESHOLD" ]; then
            echo "Drained after ${waited}s (analysis=$analysis_pending, resume=$resume_pending)"
            return 0
        fi

        echo "  pending: analysis=$analysis_pending resume=$resume_pending (waited ${waited}s)"
        sleep "$DRAIN_POLL_INTERVAL"
        waited=$((waited + DRAIN_POLL_INTERVAL))
    done

    echo "WARNING: Drain did not complete after ${DRAIN_MAX_WAIT}s — proceeding anyway" >&2
}

release_writers() {
    local convex_dir="$1"
    local convex_url="$2"

    echo "=== Releasing writers ==="
    sudo -u trends bash -c "
        cd '$convex_dir' && \
        CONVEX_URL='$convex_url' \
        npx convex run system_settings:set '{\"key\":\"maintenanceMode\",\"value\":false,\"updatedBy\":\"restore-script\"}' 2>&1
    " | tail -3
    echo "Writers released."
}
