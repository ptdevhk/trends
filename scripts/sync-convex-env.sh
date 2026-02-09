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
    # Fallback for users who ran `convex dev` from repo root.
    CONVEX_ENV="$CONVEX_ENV_ROOT"
else
    echo "Error: Convex .env.local not found."
    echo "Checked: $CONVEX_ENV_PACKAGE and $CONVEX_ENV_ROOT"
    echo "Run 'bunx convex dev' in '$PROJECT_ROOT/packages/convex' first."
    exit 1
fi

# Extract CONVEX_URL
CONVEX_URL="$(grep "^CONVEX_URL=" "$CONVEX_ENV" | cut -d= -f2- || true)"
if [ -z "$CONVEX_URL" ] || [ "$CONVEX_URL" = "null" ]; then
    echo "Error: valid CONVEX_URL not found in $CONVEX_ENV"
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

echo "Synced VITE_CONVEX_URL to $WEB_ENV (from $CONVEX_ENV)"
