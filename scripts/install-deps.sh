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
    echo "Prefetching Convex local backend binary (mirror mode: ${EFFECTIVE_CONVEX_MIRROR_MODE})..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    "$SCRIPT_DIR/prefetch-convex-backend.sh" || echo "Warning: Convex prefetch failed (non-fatal)"
fi

# Sync agent governance artifacts (policy mirror + Codex skill install)
if [ "${CI:-}" != "true" ]; then
    echo "Syncing agent governance artifacts..."
    _SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if command -v bun > /dev/null 2>&1; then
        bunx tsx "$_SCRIPT_DIR/agent-governance/sync-policy.ts" || echo "Warning: Agent policy sync failed (non-fatal)"
    else
        npx tsx "$_SCRIPT_DIR/agent-governance/sync-policy.ts" || echo "Warning: Agent policy sync failed (non-fatal)"
    fi
    "$_SCRIPT_DIR/agent-governance/install-skill.sh" || echo "Warning: Agent skill install failed (non-fatal)"
else
    echo "Skipping agent governance sync in CI"
fi

echo "Done!"
