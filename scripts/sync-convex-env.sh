#!/bin/bash
# Syncs CONVEX_URL from packages/convex/.env.local to apps/web/.env.local
echo "Syncing Convex environment variables..."

CONVEX_ENV="packages/convex/.env.local"
WEB_ENV="apps/web/.env.local"

if [ ! -f "$CONVEX_ENV" ]; then
    echo "Error: $CONVEX_ENV not found. Run 'npx convex dev' in packages/convex first."
    exit 1
fi

# Extract CONVEX_URL
CONVEX_URL=$(grep "^CONVEX_URL=" "$CONVEX_ENV" | cut -d= -f2-)

if [ -z "$CONVEX_URL" ]; then
    echo "Error: CONVEX_URL not found in $CONVEX_ENV"
    exit 1
fi

# Write to web env
# Check if VITE_CONVEX_URL already exists
if grep -q "^VITE_CONVEX_URL=" "$WEB_ENV" 2>/dev/null; then
    # Update existing
    # Use perl for in-place editing to handle special chars in URL better than sed on some systems
    perl -i -pe "s|^VITE_CONVEX_URL=.*|VITE_CONVEX_URL=$CONVEX_URL|" "$WEB_ENV"
else
    # Append
    echo "VITE_CONVEX_URL=$CONVEX_URL" >> "$WEB_ENV"
fi

echo "Synced VITE_CONVEX_URL to $WEB_ENV"
