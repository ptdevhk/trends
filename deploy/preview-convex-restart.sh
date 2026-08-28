#!/usr/bin/env bash
# Restart trends-preview-convex only after N consecutive host-4210
# POST /api/query failures. Preview only. Never pkill, never touch prod :3210.
#
# Usage (run on ptcloud):
#   bash deploy/preview-convex-restart.sh              # one probe, exit 0/1
#   bash deploy/preview-convex-restart.sh --watch      # loop; report only
#   bash deploy/preview-convex-restart.sh --watch --recover
#   bash deploy/preview-convex-restart.sh --recover    # restart now if this probe fails
#
# Env:
#   PREVIEW_CONVEX_URL          default http://127.0.0.1:4210
#   PREVIEW_CONVEX_CONTAINER    default trends-preview-convex
#   PREVIEW_CONVEX_FAILURES     default 3
#   PREVIEW_CONVEX_INTERVAL     default 60 (seconds, --watch)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"

CONTAINER="${PREVIEW_CONVEX_CONTAINER:-trends-preview-convex}"
BASE_URL="${PREVIEW_CONVEX_URL:-http://127.0.0.1:4210}"
BASE_URL="${BASE_URL%/}"
PROBE_URL="${BASE_URL}/api/query"
FAILURES_N="${PREVIEW_CONVEX_FAILURES:-3}"
INTERVAL="${PREVIEW_CONVEX_INTERVAL:-60}"
WATCH=0
RECOVER=0

for arg in "$@"; do
    case "$arg" in
        --watch) WATCH=1 ;;
        --recover) RECOVER=1 ;;
        --once) WATCH=0 ;;
        -h|--help)
            sed -n '2,16p' "$0"
            exit 0
            ;;
        *)
            log_error "Unknown argument: $arg"
            exit 2
            ;;
    esac
done

if [[ "$BASE_URL" == *":3210"* ]]; then
    log_error "Refusing to probe or restart production Convex (:3210). Got: $BASE_URL"
    exit 1
fi
if [[ "$CONTAINER" != *preview* ]]; then
    log_error "Refusing container name without 'preview': $CONTAINER"
    exit 1
fi

docker_cmd() {
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        docker "$@"
        return
    fi
    if command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
        sudo -n docker "$@"
        return
    fi
    log_error "docker is not usable (tried docker and sudo -n docker)"
    return 1
}

# One-shot POST /api/query. 2xx/4xx = listener answered. 5xx/000 = down.
# No silent retries here — callers count consecutive failures themselves.
convex_query_ok() {
    local url="${1:-$PROBE_URL}"
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
        -X POST \
        -H 'Content-Type: application/json' \
        -d '{"path":"version","args":{},"format":"json"}' \
        "$url" 2>/dev/null || echo 000)"
    code="$(printf '%s' "$code" | tr -d '[:space:]')"
    [[ "$code" =~ ^[1234][0-9][0-9]$ ]]
}

restart_preview_convex() {
    # ONLY docker restart. Never pkill -f convex (self-match hazard).
    log_warn "Restarting $CONTAINER via docker restart (probe failed ${FAILURES_N} consecutive times)"
    docker_cmd restart "$CONTAINER"
}

wait_query_ok() {
    local max_wait="${1:-180}"
    local waited=0
    while (( waited < max_wait )); do
        if convex_query_ok; then
            log_info "POST $PROBE_URL answered after ${waited}s"
            return 0
        fi
        sleep 5
        waited=$((waited + 5))
    done
    log_error "POST $PROBE_URL still down after ${max_wait}s"
    return 1
}

probe_once() {
    if convex_query_ok; then
        log_info "POST $PROBE_URL ok"
        return 0
    fi
    log_warn "POST $PROBE_URL failed"
    return 1
}

recover_if_needed() {
    if (( RECOVER != 1 )); then
        log_info "Would restart $CONTAINER (pass --recover to apply)"
        return 1
    fi
    restart_preview_convex
    wait_query_ok 180
}

if (( WATCH == 0 )); then
    if probe_once; then
        exit 0
    fi
    recover_if_needed || exit 1
    exit 0
fi

log_info "Watching $PROBE_URL every ${INTERVAL}s; restart after ${FAILURES_N} consecutive failures (recover=$RECOVER)"
streak=0
while true; do
    if probe_once; then
        streak=0
    else
        streak=$((streak + 1))
        log_warn "consecutive failures: $streak/$FAILURES_N"
        if (( streak >= FAILURES_N )); then
            recover_if_needed || true
            streak=0
        fi
    fi
    sleep "$INTERVAL"
done
