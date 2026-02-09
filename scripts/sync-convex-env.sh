#!/bin/bash
# Syncs CONVEX_URL from Convex .env.local to apps/web/.env.local
set -euo pipefail

echo "Syncing Convex environment variables..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

CONVEX_ENV_PACKAGE="$PROJECT_ROOT/packages/convex/.env.local"
CONVEX_ENV_ROOT="$PROJECT_ROOT/.env.local"
WEB_ENV="$PROJECT_ROOT/apps/web/.env.local"

CONVEX_ENV=""
if [ -f "$CONVEX_ENV_PACKAGE" ]; then
    CONVEX_ENV="$CONVEX_ENV_PACKAGE"
elif [ -f "$CONVEX_ENV_ROOT" ]; then
    CONVEX_ENV="$CONVEX_ENV_ROOT"
fi

# Extract CONVEX_URL: prefer .env.local file, fall back to system environment
if [ -n "$CONVEX_ENV" ]; then
    CONVEX_URL="$(grep "^CONVEX_URL=" "$CONVEX_ENV" | cut -d= -f2- || true)"
elif [ -n "${CONVEX_URL:-}" ]; then
    echo "Using CONVEX_URL from system environment"
else
    echo "Error: No .env.local found and CONVEX_URL not set in environment."
    echo "Checked: $CONVEX_ENV_PACKAGE and $CONVEX_ENV_ROOT"
    exit 1
fi

if [ -z "$CONVEX_URL" ] || [ "$CONVEX_URL" = "null" ]; then
    echo "Error: valid CONVEX_URL not found"
    exit 1
fi

mkdir -p "$(dirname "$WEB_ENV")"

# Write to web env
if grep -q "^VITE_CONVEX_URL=" "$WEB_ENV" 2>/dev/null; then
    # Use perl for in-place editing to handle URL characters safely.
    perl -i -pe "s|^VITE_CONVEX_URL=.*|VITE_CONVEX_URL=$CONVEX_URL|" "$WEB_ENV"
else
    echo "VITE_CONVEX_URL=$CONVEX_URL" >> "$WEB_ENV"
fi

if [ -n "$CONVEX_ENV" ]; then
    echo "Synced VITE_CONVEX_URL to $WEB_ENV (from $CONVEX_ENV)"
else
    echo "Synced VITE_CONVEX_URL to $WEB_ENV (from system environment)"
fi
