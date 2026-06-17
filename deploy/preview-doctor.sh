#!/bin/bash
# Preview environment health check + auto-recovery for preview.pt-mes.com.
#
# Run on the preview host (any user with sudo). Reports on:
#   - Caddy reachability (preview.pt-mes.com)
#   - Convex container health + memory headroom
#   - Convex /version + sync HTTP upgrade
#   - Preview API systemd status + /api/blocks and a public resume query
#   - MCP container status
#   - Recent dmesg OOM kills affecting any preview container
#
# Pass --recover to attempt the safe recovery sequence:
#   1. If Convex container is unhealthy → recreate it (docker compose up -d convex)
#   2. After convex /version returns 200 → restart trends-preview-api
#
# Pass --full to additionally tail recent journal logs.
set -euo pipefail

PREVIEW_DIR=/home/ubuntu/trends-preview
COMPOSE_FILE="$PREVIEW_DIR/docker-compose.preview.yml"
CONVEX_PORT=4210
API_PORT=3002
PUBLIC_HOST=preview.pt-mes.com
RESUME_SMOKE_PATH="/api/resumes?source=convex&paged=true&limit=1"

RECOVER=0
FULL=0
for arg in "$@"; do
    case "$arg" in
        --recover) RECOVER=1 ;;
        --full)    FULL=1 ;;
        -h|--help)
            sed -n '2,18p' "$0"; exit 0 ;;
        *) echo "unknown flag: $arg" >&2; exit 2 ;;
    esac
done

ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m⚠\033[0m %s\n' "$*"; }
fail()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
info()  { printf '  · %s\n' "$*"; }

FAIL=0
SUDO=$([ "$(id -u)" -eq 0 ] && echo "" || echo "sudo")

echo "=== Preview Doctor (preview.pt-mes.com) ==="
date -u +%Y-%m-%dT%H:%M:%SZ

echo
echo "[1/6] Public Caddy"
PUB=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://$PUBLIC_HOST/" || echo 000)
[ "$PUB" = "200" ] && ok "https://$PUBLIC_HOST/ → $PUB" || fail "https://$PUBLIC_HOST/ → $PUB"

echo
echo "[2/6] Convex container"
CON_STATUS=$(docker ps --filter name=trends-preview-convex --format '{{.Status}}' || echo "")
if [ -z "$CON_STATUS" ]; then
    fail "trends-preview-convex container is not running"
elif echo "$CON_STATUS" | grep -q "(unhealthy)"; then
    fail "trends-preview-convex is unhealthy: $CON_STATUS"
else
    ok "trends-preview-convex: $CON_STATUS"
fi

CON_VER=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$CONVEX_PORT/version" || echo 000)
[ "$CON_VER" = "200" ] && ok "convex /version → $CON_VER" || fail "convex /version → $CON_VER"

if docker ps --format '{{.Names}}' | grep -q trends-preview-convex; then
    STATS=$(docker stats --no-stream trends-preview-convex --format '{{.MemUsage}}|{{.MemPerc}}' 2>/dev/null || echo "")
    if [ -n "$STATS" ]; then
        info "memory: $(echo "$STATS" | tr '|' ' ')"
    fi
fi

echo
echo "[3/6] OOM kills (last 24h)"
KILLS=$($SUDO dmesg -T 2>/dev/null | grep -E 'Killed process.*convex-local-ba' | tail -5 || true)
if [ -z "$KILLS" ]; then
    ok "no convex-local-backend OOM kills in dmesg buffer"
else
    fail "convex-local-backend OOM kills detected:"
    echo "$KILLS" | sed 's/^/      /'
    info "Mitigation: see queries/2026-05-29-convex-local-backend-memory-oom.md (raise mem_limit, lower SHARED_UDF_CACHE_MAX_SIZE)"
fi

echo
echo "[4/6] Preview API systemd"
if systemctl is-active --quiet trends-preview-api 2>/dev/null; then
    ok "trends-preview-api is active"
else
    fail "trends-preview-api is NOT active"
fi
RS=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$API_PORT$RESUME_SMOKE_PATH" || echo 000)
BL=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$API_PORT/api/blocks" || echo 000)
[ "$RS" = "200" ] && ok "$RESUME_SMOKE_PATH → $RS" || fail "$RESUME_SMOKE_PATH → $RS"
[ "$BL" = "200" ] && ok "/api/blocks → $BL"          || fail "/api/blocks → $BL"

echo
echo "[5/6] MCP container"
MCP_STATUS=$(docker ps --filter name=trends-preview-mcp --format '{{.Status}}' || echo "")
if [ -z "$MCP_STATUS" ]; then
    warn "trends-preview-mcp is not running (non-critical for resume UI)"
elif echo "$MCP_STATUS" | grep -qi "Restarting"; then
    warn "trends-preview-mcp is in a restart loop: $MCP_STATUS"
    info "Common cause: ModuleNotFoundError 'packages' from PYTHONPATH/sys.path mismatch in container build"
else
    ok "trends-preview-mcp: $MCP_STATUS"
fi

echo
echo "[6/6] Caddy preview vhost"
if $SUDO grep -q 'preview.pt-mes.com' /etc/caddy/Caddyfile; then
    ok "preview.pt-mes.com block present in /etc/caddy/Caddyfile"
else
    fail "preview.pt-mes.com block missing from /etc/caddy/Caddyfile"
fi

echo
if [ $FULL -eq 1 ]; then
    echo "[+] Recent journal (trends-preview-api, last 50 lines)"
    $SUDO journalctl -u trends-preview-api -n 50 --no-pager 2>/dev/null | sed 's/^/    /' || true
    echo
fi

echo "Summary: $FAIL failure(s)."

if [ $FAIL -gt 0 ] && [ $RECOVER -eq 1 ]; then
    echo
    echo "=== Recovery (--recover) ==="
    cd "$PREVIEW_DIR"

    if echo "$CON_STATUS" | grep -q "(unhealthy)" || [ "$CON_VER" != "200" ]; then
        echo "→ Recreating convex container with current compose config…"
        $SUDO docker compose -f "$COMPOSE_FILE" up -d convex
        echo "→ Waiting up to 180s for convex /version=200…"
        for i in $(seq 1 36); do
            sleep 5
            VV=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$CONVEX_PORT/version" || echo 000)
            if [ "$VV" = "200" ]; then
                ok "convex /version → 200 after ${i}x5s"
                break
            fi
        done
    fi

    echo "→ Restarting trends-preview-api…"
    $SUDO systemctl restart trends-preview-api
    sleep 4
    RS2=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$API_PORT$RESUME_SMOKE_PATH" || echo 000)
    BL2=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$API_PORT/api/blocks" || echo 000)
    info "post-recovery $RESUME_SMOKE_PATH → $RS2"
    info "post-recovery /api/blocks → $BL2"
fi

[ $FAIL -gt 0 ] && exit 1 || exit 0
