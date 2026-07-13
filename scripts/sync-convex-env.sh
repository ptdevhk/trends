#!/bin/bash
# Syncs CONVEX_URL from Convex .env.local to apps/web/.env.local
# Also syncs AI env vars into Convex deployment env (AI_API_KEY etc.)
set -euo pipefail

echo "Syncing Convex environment variables..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

LOCAL_CONVEX_SECRET_HELPER="$SCRIPT_DIR/local-convex-write-secret.sh"
if [ -f "$LOCAL_CONVEX_SECRET_HELPER" ]; then
    # shellcheck disable=SC1090
    source "$LOCAL_CONVEX_SECRET_HELPER"
    LOCAL_CONVEX_PROJECT_ROOT="$PROJECT_ROOT"
    ensure_local_convex_write_secret
    if is_local_anonymous_convex; then
        export CONVEX_AGENT_MODE=anonymous
    fi
fi

CONVEX_ENV_PACKAGE="$PROJECT_ROOT/packages/convex/.env.local"
CONVEX_ENV_ROOT="$PROJECT_ROOT/.env.local"
WEB_ENV="$PROJECT_ROOT/apps/web/.env.local"
SYNC_WAIT_SECS="${CONVEX_SYNC_WAIT_SECS:-15}"

CONVEX_ENV=""
if [ -f "$CONVEX_ENV_PACKAGE" ]; then
    CONVEX_ENV="$CONVEX_ENV_PACKAGE"
elif [ -f "$CONVEX_ENV_ROOT" ]; then
    CONVEX_ENV="$CONVEX_ENV_ROOT"
fi

if [ -z "$CONVEX_ENV" ] && [ -z "${CONVEX_URL:-}" ] && [ "$SYNC_WAIT_SECS" -gt 0 ] 2>/dev/null; then
    echo "Waiting up to ${SYNC_WAIT_SECS}s for Convex .env.local..."
    waited=0
    while [ "$waited" -lt "$SYNC_WAIT_SECS" ]; do
        if [ -f "$CONVEX_ENV_PACKAGE" ]; then
            CONVEX_ENV="$CONVEX_ENV_PACKAGE"
            break
        fi
        if [ -f "$CONVEX_ENV_ROOT" ]; then
            CONVEX_ENV="$CONVEX_ENV_ROOT"
            break
        fi
        sleep 1
        waited=$((waited + 1))
    done
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

# For the browser frontend, prefer CONVEX_PUBLIC_URL (public-facing URL through
# a reverse proxy like Caddy) over the internal CONVEX_URL.  This matters for
# self-hosted mode where CONVEX_URL is 127.0.0.1:3210 — unreachable from the
# user's browser.  Cloud mode URLs are already public, so the fallback is fine.
WEB_CONVEX_URL="${CONVEX_PUBLIC_URL:-$CONVEX_URL}"

mkdir -p "$(dirname "$WEB_ENV")"

# Write to web env
if grep -q "^VITE_CONVEX_URL=" "$WEB_ENV" 2>/dev/null; then
    # Use perl for in-place editing to handle URL characters safely.
    perl -i -pe "s|^VITE_CONVEX_URL=.*|VITE_CONVEX_URL=$WEB_CONVEX_URL|" "$WEB_ENV"
else
    echo "VITE_CONVEX_URL=$WEB_CONVEX_URL" >> "$WEB_ENV"
fi

if [ -n "${CONVEX_PUBLIC_URL:-}" ]; then
    echo "Synced VITE_CONVEX_URL=$WEB_CONVEX_URL to $WEB_ENV (from CONVEX_PUBLIC_URL)"
elif [ -n "$CONVEX_ENV" ]; then
    echo "Synced VITE_CONVEX_URL=$WEB_CONVEX_URL to $WEB_ENV (from $CONVEX_ENV)"
else
    echo "Synced VITE_CONVEX_URL=$WEB_CONVEX_URL to $WEB_ENV (from system environment)"
fi

# ---------------------------------------------------------------------------
# Sync runtime env vars into Convex deployment env
# ---------------------------------------------------------------------------
# These keys are read by Convex functions via process.env (analysis_config.ts,
# embeddings.ts, ai_tagging_results.ts, analyze.ts, analysis_tasks.ts).
# The Convex local backend does NOT inherit system env for function runtime —
# keys must be pushed via `npx convex env set`.
# ---------------------------------------------------------------------------

CONVEX_RUNTIME_ENV_KEYS=(
    AI_ANALYSIS_ENABLED
    AI_ANALYSIS_RESUMES_ENABLED
    AI_MODEL
    AI_API_KEY
    AI_API_BASE
    AI_OUTPUT_LOCALE
    AI_ANALYSIS_PARALLELISM
    CONVEX_WRITE_SECRET
)

CONVEX_DIR="$PROJECT_ROOT/packages/convex"
CONVEX_ENV_FILE="$CONVEX_DIR/.env.local"

if [ ! -d "$CONVEX_DIR" ]; then
    echo "Skipping AI env sync: $CONVEX_DIR not found."
    exit 0
fi

synced=0
failed=0

for key in "${CONVEX_RUNTIME_ENV_KEYS[@]}"; do
    value="${!key:-}"
    if [ -z "$value" ]; then
        continue
    fi

    # Escape value for safe shell interpolation
    escaped_value="$(printf '%s' "$value" | sed "s/'/'\\\\''/g")"

    if [ -f "$CONVEX_ENV_FILE" ]; then
        if (cd "$CONVEX_DIR" && npx convex env set --env-file "$CONVEX_ENV_FILE" "$key" "$escaped_value" >/dev/null 2>&1); then
            synced=$((synced + 1))
            echo "  Synced $key to Convex"
        else
            echo "  WARNING: Failed to sync $key to Convex"
            failed=$((failed + 1))
        fi
    else
        if (cd "$CONVEX_DIR" && npx convex env set "$key" "$escaped_value" >/dev/null 2>&1); then
            synced=$((synced + 1))
            echo "  Synced $key to Convex"
        else
            echo "  WARNING: Failed to sync $key to Convex"
            failed=$((failed + 1))
        fi
    fi
done

if [ "$synced" -gt 0 ]; then
    echo "Synced $synced runtime env var(s) to Convex deployment."
elif [ "$failed" -eq 0 ]; then
    echo "No managed runtime env vars found in environment."
fi

if [ "$failed" -gt 0 ]; then
    echo "WARNING: $failed Convex env var(s) failed to sync."
fi
