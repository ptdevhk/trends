#!/bin/bash
set -e

usage() {
    echo "Usage: $0 [--help]"
    echo "Installs local Python/Node dependencies and bootstraps repo/local skill artifacts."
    echo ""
    echo "Repo-managed skills are synced into .agents/skills + .claude/skills."
    echo "Configured external global skills are synced into agent-specific roots such as ~/.codex/skills and ~/.claude/skills."
    echo ""
    echo "Environment:"
    echo "  CONVEX_MIRROR_MODE     Convex prefetch mode override: off|fallback|mirror-first"
    echo "                         Default is fallback, or off when CI=true/1"
    echo "  CONVEX_MIRROR_BASES    Convex prefetch mirror base URLs (comma-separated)"
    echo "  CONVEX_DOWNLOAD_TIMEOUT_SECS / CONVEX_CONNECT_TIMEOUT_SECS"
    echo "                         Convex prefetch timeout overrides"
    echo "  CONVEX_CURL_NO_SILENT  When true/1, keep Convex prefetch curl progress output enabled"
    echo "  CI                     When true/1, shared Convex prefetch mode defaults to off, uses npm, and skips governance sync"
    echo ""
    echo "See ./scripts/prefetch-convex-backend.sh --help for the full Convex prefetch env contract."
}

if [ "$#" -gt 0 ]; then
    case "$1" in
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
fi

resolve_convex_mirror_mode() {
    local mode="${CONVEX_MIRROR_MODE:-}"
    if [ -z "${mode}" ]; then
        if is_ci_env; then
            echo "off"
            return
        fi
        echo "fallback"
        return
    fi
    case "${mode}" in
        off|fallback|mirror-first)
            echo "${mode}"
            ;;
        *)
            echo "Invalid CONVEX_MIRROR_MODE: ${mode}" >&2
            echo "Expected one of: off, fallback, mirror-first" >&2
            exit 1
            ;;
    esac
}

is_ci_env() {
    [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]
}

run_tsx() {
    local script_path="$1"
    shift

    if command -v bun > /dev/null 2>&1; then
        bunx tsx "$script_path" "$@"
        return
    fi

    npx tsx "$script_path" "$@"
}

EFFECTIVE_CONVEX_MIRROR_MODE=""
if ! is_ci_env; then
    EFFECTIVE_CONVEX_MIRROR_MODE="$(resolve_convex_mirror_mode)"
fi

echo "Installing Python dependencies..."
uv sync

echo "Installing Node.js dependencies..."
if is_ci_env; then
    npm install
elif command -v bun &> /dev/null; then
    if ! bun install; then
        echo "Warning: bun install failed, falling back to npm install..."
        npm install
    fi
else
    npm install
fi

if [ -d "packages/convex" ]; then
    if [ -z "${EFFECTIVE_CONVEX_MIRROR_MODE}" ]; then
        EFFECTIVE_CONVEX_MIRROR_MODE="$(resolve_convex_mirror_mode)"
    fi
    echo "Prefetching Convex local backend and dashboard assets (mirror mode: ${EFFECTIVE_CONVEX_MIRROR_MODE})..."
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    "$SCRIPT_DIR/prefetch-convex-backend.sh" || echo "Warning: Convex prefetch failed (non-fatal)"
fi

# Sync agent governance artifacts and local skill bootstrap
if ! is_ci_env; then
    echo "Syncing agent governance artifacts and skill bootstrap..."
    _SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    run_tsx "$_SCRIPT_DIR/agent-governance/sync-policy.ts" || echo "Warning: Agent policy sync failed (non-fatal)"
    if [ -x "$_SCRIPT_DIR/skills/sync-project-skills.sh" ]; then
        "$_SCRIPT_DIR/skills/sync-project-skills.sh" || echo "Warning: Project skill sync failed (non-fatal)"
    else
        echo "Warning: Project skill sync script not found (non-fatal)"
    fi
    run_tsx "$_SCRIPT_DIR/skills/install-global-skills.ts" || echo "Warning: Global skill install failed (non-fatal)"
else
    echo "Skipping agent governance sync and skill bootstrap in CI"
fi

echo "Done!"
