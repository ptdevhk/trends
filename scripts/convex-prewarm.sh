#!/usr/bin/env bash
# Prewarm the cached Convex local backend so that the subsequent
# `convex dev --local` (or `convex dev --local --local-force-upgrade`) boot fits
# inside Convex CLI's hardcoded 30s port-bind timeout.
#
# Why this exists
# ----------------
# When the anonymous local backend has been idle long enough that its Tantivy
# search indexes are flagged "TooOld", the backend rebuilds them during startup
# before binding port 3210. On modest hardware that rebuild can take 28-40s.
# Convex CLI kills the backend after its startup deadline (default 30s in CLI
# < 1.36.0, configurable via CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS in
# CLI >= 1.36.0) and retries (both locally via `make dev` and in production
# via the trends-convex systemd unit with Restart=on-failure).
#
# Prewarming once, standalone, with no CLI timer, lets the rebuild complete.
# After graceful shutdown, subsequent boots bind port 3210 in a few seconds.
# Even with a longer startup timeout configured, prewarm remains useful to
# reduce perceived startup latency from ~30s to ~5s.
#
# Safety
# ------
#   - Exits 0 if there is nothing to prewarm (no cached binary, no state dir,
#     or explicit opt-out). Never blocks a normal boot.
#   - Releases port 3210 before exiting so the caller can claim it immediately.
#
# Tunables
# --------
#   CONVEX_SKIP_PREWARM=1|true   Skip prewarm entirely.
#   CONVEX_PREWARM_TIMEOUT=120   Max seconds to wait for port 3210 to bind.
#   CONVEX_PORT=3210             Port the backend will bind.
#   CONVEX_PREWARM_SETTLE_SECS=3 Post-bind pause before shutdown, to let
#                                post-bootstrap index work drain to disk.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck disable=SC2034
PREWARM_LOG_PREFIX="[CONVEX-PREWARM]"

log() { printf '%s %s\n' "$PREWARM_LOG_PREFIX" "$*"; }
warn() { printf '%s WARN: %s\n' "$PREWARM_LOG_PREFIX" "$*" >&2; }

is_truthy() {
    case "${1:-}" in
        1|true|TRUE|True|yes|YES|on|ON) return 0 ;;
        *) return 1 ;;
    esac
}

if is_truthy "${CONVEX_SKIP_PREWARM:-}"; then
    log "CONVEX_SKIP_PREWARM set; skipping prewarm."
    exit 0
fi

PORT="${CONVEX_PORT:-3210}"
PREWARM_TIMEOUT="${CONVEX_PREWARM_TIMEOUT:-120}"
SETTLE_SECS="${CONVEX_PREWARM_SETTLE_SECS:-3}"

is_windows_uname() {
    case "$(uname -s 2>/dev/null || echo unknown)" in
        MINGW*|MSYS*|CYGWIN*) return 0 ;;
        *) return 1 ;;
    esac
}

cache_binaries_dir() {
    if is_windows_uname; then
        if [ -n "${LOCALAPPDATA:-}" ]; then
            echo "${LOCALAPPDATA}/convex/binaries"; return
        fi
        if [ -n "${USERPROFILE:-}" ]; then
            echo "${USERPROFILE}/AppData/Local/convex/binaries"; return
        fi
        echo "${HOME}/AppData/Local/convex/binaries"
        return
    fi
    echo "${HOME}/.cache/convex/binaries"
}

binary_name() {
    if is_windows_uname; then echo "convex-local-backend.exe"; else echo "convex-local-backend"; fi
}

latest_cached_binary() {
    local root="$1"
    local name="$2"
    local candidate
    [ -d "$root" ] || return 1
    while IFS= read -r candidate; do
        if [ -x "$candidate/$name" ]; then
            echo "$candidate/$name"
            return 0
        fi
    done < <(find "$root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -r)
    return 1
}

port_in_use() {
    if command -v lsof >/dev/null 2>&1; then
        lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
    elif command -v ss >/dev/null 2>&1; then
        ss -tuln 2>/dev/null | grep -q ":$PORT "
    else
        (echo > /dev/tcp/127.0.0.1/"$PORT") >/dev/null 2>&1
    fi
}

read_deployment_from_env_file() {
    local path="$1"
    [ -f "$path" ] || return 1
    local raw
    raw="$(grep -E '^[[:space:]]*CONVEX_DEPLOYMENT[[:space:]]*=' "$path" 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '\r"'"'")"
    if [ -n "$raw" ]; then
        echo "$raw"; return 0
    fi
    return 1
}

detect_state_dir() {
    # Prefer a state dir keyed off the CONVEX_DEPLOYMENT env var (format
    # "anonymous:<name>"). If unset in the environment, read it from the
    # project's packages/convex/.env.local, then the repo root .env.local.
    local base="${HOME}/.convex/anonymous-convex-backend-state"
    [ -d "$base" ] || return 1

    local deployment="${CONVEX_DEPLOYMENT:-}"
    if [ -z "$deployment" ]; then
        deployment="$(read_deployment_from_env_file "$PROJECT_ROOT/packages/convex/.env.local" 2>/dev/null || true)"
    fi
    if [ -z "$deployment" ]; then
        deployment="$(read_deployment_from_env_file "$PROJECT_ROOT/.env.local" 2>/dev/null || true)"
    fi

    if [ -n "$deployment" ]; then
        local name="${deployment#anonymous:}"
        if [ -d "$base/$name" ] && [ -f "$base/$name/convex_local_backend.sqlite3" ]; then
            echo "$base/$name"; return 0
        fi
        # A deployment was declared but its state dir doesn't exist yet — this
        # is a first-run scenario, nothing to prewarm. Do NOT fall back to a
        # different project's state dir.
        return 1
    fi

    # No deployment declared anywhere. Fall back to the first state dir with a
    # DB file (best effort for one-project machines).
    local candidate
    while IFS= read -r candidate; do
        if [ -f "$candidate/convex_local_backend.sqlite3" ]; then
            echo "$candidate"; return 0
        fi
    done < <(find "$base" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)

    return 1
}

if port_in_use; then
    log "Port $PORT already listening; assuming backend is already warm."
    exit 0
fi

BINARY="$(latest_cached_binary "$(cache_binaries_dir)" "$(binary_name)" 2>/dev/null || true)"
if [ -z "${BINARY:-}" ]; then
    log "No cached convex-local-backend binary found; skipping prewarm."
    exit 0
fi

STATE_DIR="$(detect_state_dir 2>/dev/null || true)"
if [ -z "${STATE_DIR:-}" ]; then
    log "No anonymous backend state dir with an existing DB; skipping prewarm (first run does not need it)."
    exit 0
fi

log "Using binary: $BINARY"
log "Using state dir: $STATE_DIR"
log "Port=$PORT timeout=${PREWARM_TIMEOUT}s settle=${SETTLE_SECS}s"

PREWARM_LOG="${CONVEX_PREWARM_LOG:-$STATE_DIR/.prewarm.log}"
: > "$PREWARM_LOG" || true

# Launch the backend. `env -u TZ` mirrors dev.sh behaviour (some builds dislike
# non-UTC TZ values during startup).
# shellcheck disable=SC2164
cd "$STATE_DIR"

# Resolve instance name and secret to support newer backend versions
DEPLOYMENT_VAL="${CONVEX_DEPLOYMENT:-}"
if [ -z "$DEPLOYMENT_VAL" ]; then
    DEPLOYMENT_VAL="$(read_deployment_from_env_file "$PROJECT_ROOT/packages/convex/.env.local" 2>/dev/null || true)"
fi
if [ -z "$DEPLOYMENT_VAL" ]; then
    DEPLOYMENT_VAL="$(read_deployment_from_env_file "$PROJECT_ROOT/.env.local" 2>/dev/null || true)"
fi
INST_NAME="anonymous-trends"
if [ -n "$DEPLOYMENT_VAL" ]; then
    INST_NAME="${DEPLOYMENT_VAL#anonymous:}"
fi

INST_SECRET="0000000000000000000000000000000000000000000000000000000000000000"
if command -v openssl >/dev/null 2>&1; then
    INST_SECRET="$(openssl rand -hex 32 2>/dev/null || echo "$INST_SECRET")"
fi

if [ -n "${TZ:-}" ]; then
    env -u TZ "$BINARY" --instance-name "$INST_NAME" --instance-secret "$INST_SECRET" --port "$PORT" --site-proxy-port "$((PORT + 1))" > "$PREWARM_LOG" 2>&1 &
else
    "$BINARY" --instance-name "$INST_NAME" --instance-secret "$INST_SECRET" --port "$PORT" --site-proxy-port "$((PORT + 1))" > "$PREWARM_LOG" 2>&1 &
fi
PREWARM_PID=$!
log "Backend started (pid=$PREWARM_PID)."

cleanup() {
    if kill -0 "$PREWARM_PID" 2>/dev/null; then
        kill -TERM "$PREWARM_PID" 2>/dev/null || true
        local waited=0
        while kill -0 "$PREWARM_PID" 2>/dev/null && [ "$waited" -lt 10 ]; do
            sleep 1; waited=$((waited + 1))
        done
        if kill -0 "$PREWARM_PID" 2>/dev/null; then
            kill -KILL "$PREWARM_PID" 2>/dev/null || true
            sleep 1
        fi
    fi

    # Ensure the port is actually free before returning — systemd may start the
    # next unit immediately after ExecStartPre exits.
    local wait_left=10
    while port_in_use && [ "$wait_left" -gt 0 ]; do
        sleep 1; wait_left=$((wait_left - 1))
    done
    if port_in_use; then
        warn "Port $PORT still held after shutdown attempt."
    else
        log "Backend stopped; port $PORT is free."
    fi
}
trap cleanup EXIT INT TERM

# Wait for port to bind.
elapsed=0
interval=2
while [ "$elapsed" -lt "$PREWARM_TIMEOUT" ]; do
    if port_in_use; then
        log "Port $PORT bound after ${elapsed}s — indexes warm."
        break
    fi
    if ! kill -0 "$PREWARM_PID" 2>/dev/null; then
        warn "Backend process exited before binding port $PORT. Last 20 log lines:"
        tail -n 20 "$PREWARM_LOG" >&2 || true
        # Still exit 0 — we don't want to block the real boot which will print
        # the same error with its own policy.
        exit 0
    fi
    sleep "$interval"
    elapsed=$((elapsed + interval))
done

if ! port_in_use; then
    warn "Prewarm timed out after ${PREWARM_TIMEOUT}s waiting for port $PORT. Continuing anyway."
    exit 0
fi

# Let any post-bind index flush finish before we SIGTERM. Only settle when
# the bind took long enough to suggest a Tantivy rebuild was needed; fast
# binds (< 10s) don't need the drain period.
if [ "$elapsed" -ge 10 ]; then
    sleep "$SETTLE_SECS"
fi

exit 0
