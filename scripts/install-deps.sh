#!/bin/bash
set -e

resolve_convex_mirror_mode() {
    if [ -n "${CONVEX_MIRROR_MODE:-}" ]; then
        echo "${CONVEX_MIRROR_MODE}"
        return
    fi
    if [ "${CI:-}" = "true" ]; then
        echo "off"
        return
    fi
    echo "fallback"
}

echo "Installing Python dependencies..."
uv sync

echo "Installing Node.js dependencies..."
if [ "${CI:-}" = "true" ]; then
    npm install
elif command -v bun &> /dev/null; then
    bun install
else
    npm install
fi

if [ -d "packages/convex" ]; then
    EFFECTIVE_CONVEX_MIRROR_MODE="$(resolve_convex_mirror_mode)"
    echo "Prefetching Convex local backend and dashboard assets (mirror mode: ${EFFECTIVE_CONVEX_MIRROR_MODE})..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    "$SCRIPT_DIR/prefetch-convex-backend.sh" || echo "Warning: Convex prefetch failed (non-fatal)"
fi

echo "Done!"
