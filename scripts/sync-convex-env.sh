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
    AI_FALLBACK_MODEL
    AI_API_KEY
    AI_API_BASE
    AI_OUTPUT_LOCALE
    AI_ANALYSIS_PARALLELISM
    CONVEX_WRITE_SECRET
)

CONVEX_DIR="$PROJECT_ROOT/packages/convex"
CONVEX_ENV_FILE="$CONVEX_DIR/.env.local"
ROOT_ENV_FILE="$PROJECT_ROOT/.env"
ROOT_ENV_LOCAL_FILE="$PROJECT_ROOT/.env.local"

# Read KEY=value from env files without sourcing (secrets must not echo).
# Preference order for each key: process env → packages/convex/.env.local →
# root .env.local → root .env. Root .env often holds AI_API_KEY while only
# packages/convex/.env.local is used for Convex URL; without this, AI_API_KEY
# never reaches the local backend and analysis fails with Poe 401.
read_env_file_value() {
    local env_path="$1"
    local key="$2"
    local line
    local value=""

    if [ ! -f "$env_path" ]; then
        return 0
    fi

    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            "$key="*) value="${line#*=}" ;;
        esac
    done < "$env_path"

    value="${value%$'\r'}"
    if [ "${#value}" -ge 2 ]; then
        case "$value" in
            \"*\") value="${value:1:${#value}-2}" ;;
            \'*\') value="${value:1:${#value}-2}" ;;
        esac
    fi
    printf '%s' "$value"
}

resolve_runtime_env_value() {
    local key="$1"
    local value="${!key:-}"

    if [ -z "$value" ]; then
        value="$(read_env_file_value "$CONVEX_ENV_FILE" "$key")"
    fi
    if [ -z "$value" ]; then
        value="$(read_env_file_value "$ROOT_ENV_LOCAL_FILE" "$key")"
    fi
    if [ -z "$value" ]; then
        value="$(read_env_file_value "$ROOT_ENV_FILE" "$key")"
    fi
    printf '%s' "$value"
}

if [ ! -d "$CONVEX_DIR" ]; then
    echo "Skipping AI env sync: $CONVEX_DIR not found."
    exit 0
fi

# Anonymous local backends need this for non-interactive `convex env set`.
if [ -z "${CONVEX_AGENT_MODE:-}" ] && [ -f "$SCRIPT_DIR/local-convex-write-secret.sh" ]; then
    # shellcheck disable=SC1090
    source "$SCRIPT_DIR/local-convex-write-secret.sh"
    LOCAL_CONVEX_PROJECT_ROOT="$PROJECT_ROOT"
    if is_local_anonymous_convex 2>/dev/null; then
        export CONVEX_AGENT_MODE=anonymous
    fi
fi

# Detect local backend readiness. `npx convex env set` against a local deployment
# that is not listening will try to spawn the backend and wait ~30s per call,
# making `make dev` appear hung and failing early keys before the real stack starts.
is_local_convex_url() {
    case "$1" in
        http://127.0.0.1:*|http://localhost:*|https://127.0.0.1:*|https://localhost:*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

extract_url_port() {
    local url="$1"
    local port
    port="$(printf '%s' "$url" | sed -E 's#^[a-zA-Z]+://[^/:]+:([0-9]+).*#\1#')"
    if [ "$port" = "$url" ]; then
        case "$url" in
            https://*) printf '443' ;;
            *) printf '80' ;;
        esac
        return 0
    fi
    printf '%s' "$port"
}

local_backend_ready() {
    local port="$1"
    if command -v curl >/dev/null 2>&1; then
        curl -fsS --max-time 2 "http://127.0.0.1:${port}/version" >/dev/null 2>&1 && return 0
    fi
    if command -v lsof >/dev/null 2>&1; then
        lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
    fi
    return 1
}

RUNTIME_WAIT_SECS="${CONVEX_RUNTIME_SYNC_WAIT_SECS:-0}"
if is_local_convex_url "$CONVEX_URL"; then
    LOCAL_CONVEX_PORT="$(extract_url_port "$CONVEX_URL")"
    if ! local_backend_ready "$LOCAL_CONVEX_PORT"; then
        if [ "${RUNTIME_WAIT_SECS}" -gt 0 ] 2>/dev/null; then
            echo "Waiting up to ${RUNTIME_WAIT_SECS}s for local Convex on port ${LOCAL_CONVEX_PORT} before runtime env sync..."
            waited=0
            while [ "$waited" -lt "$RUNTIME_WAIT_SECS" ]; do
                if local_backend_ready "$LOCAL_CONVEX_PORT"; then
                    break
                fi
                sleep 1
                waited=$((waited + 1))
            done
        fi
    fi
    if ! local_backend_ready "$LOCAL_CONVEX_PORT"; then
        echo "Skipping Convex runtime env sync: local backend not listening on port ${LOCAL_CONVEX_PORT}."
        echo "  (VITE_CONVEX_URL was still written. Runtime keys sync after Convex starts via scripts/dev.sh.)"
        exit 0
    fi
fi

synced=0
failed=0
skipped_empty=0
declare -a PENDING_KEYS=()
declare -a PENDING_VALUES=()

for key in "${CONVEX_RUNTIME_ENV_KEYS[@]}"; do
    value="$(resolve_runtime_env_value "$key")"
    if [ -z "$value" ]; then
        skipped_empty=$((skipped_empty + 1))
        continue
    fi
    PENDING_KEYS+=("$key")
    PENDING_VALUES+=("$value")
done

if [ "${#PENDING_KEYS[@]}" -eq 0 ]; then
    echo "No managed runtime env vars found in environment (checked process env, packages/convex/.env.local, .env.local, .env)."
else
    # Prefer one batched `env set --from-file` (much faster than N CLI startups).
    batch_tmp="$(mktemp "${TMPDIR:-/tmp}/trends-convex-env.XXXXXX")"
    # shellcheck disable=SC2064
    trap 'rm -f "$batch_tmp"' EXIT
    batch_idx=0
    while [ "$batch_idx" -lt "${#PENDING_KEYS[@]}" ]; do
        # Escape values for dotenv: quote if they contain spaces or special chars.
        _bk="${PENDING_KEYS[$batch_idx]}"
        _bv="${PENDING_VALUES[$batch_idx]}"
        case "$_bv" in
            *[$' \t\n"\'\\']*|*[=#]*)
                _bv_escaped="$(printf '%s' "$_bv" | sed 's/\\/\\\\/g; s/"/\\"/g')"
                printf '%s="%s"\n' "$_bk" "$_bv_escaped" >>"$batch_tmp"
                ;;
            *)
                printf '%s=%s\n' "$_bk" "$_bv" >>"$batch_tmp"
                ;;
        esac
        batch_idx=$((batch_idx + 1))
    done

    batch_err="$(mktemp "${TMPDIR:-/tmp}/trends-convex-env-err.XXXXXX")"
    batch_ok=0
    if [ -f "$CONVEX_ENV_FILE" ]; then
        if (cd "$CONVEX_DIR" && npx convex env set --env-file "$CONVEX_ENV_FILE" --from-file "$batch_tmp" --force >"$batch_err" 2>&1); then
            batch_ok=1
        fi
    else
        if (cd "$CONVEX_DIR" && npx convex env set --from-file "$batch_tmp" --force >"$batch_err" 2>&1); then
            batch_ok=1
        fi
    fi

    if [ "$batch_ok" -eq 1 ]; then
        synced="${#PENDING_KEYS[@]}"
        for key in "${PENDING_KEYS[@]}"; do
            echo "  Synced $key to Convex"
        done
        echo "Synced $synced runtime env var(s) to Convex deployment (batched)."
    else
        echo "  Batch env set failed; falling back to per-key sync..."
        if [ -s "$batch_err" ]; then
            # Show a short non-secret hint (first line only).
            head -n 1 "$batch_err" | sed 's/^/  /'
        fi
        rm -f "$batch_err"

        key_idx=0
        while [ "$key_idx" -lt "${#PENDING_KEYS[@]}" ]; do
            key="${PENDING_KEYS[$key_idx]}"
            value="${PENDING_VALUES[$key_idx]}"
            key_err="$(mktemp "${TMPDIR:-/tmp}/trends-convex-env-key-err.XXXXXX")"
            # Pass value as a separate argv — do not shell-quote into a single string
            # (previous escaping could corrupt keys or leave placeholders).
            if [ -f "$CONVEX_ENV_FILE" ]; then
                if (cd "$CONVEX_DIR" && npx convex env set --env-file "$CONVEX_ENV_FILE" "$key" "$value" >"$key_err" 2>&1); then
                    synced=$((synced + 1))
                    echo "  Synced $key to Convex"
                else
                    echo "  WARNING: Failed to sync $key to Convex"
                    if [ -s "$key_err" ]; then
                        head -n 1 "$key_err" | sed 's/^/    /'
                    fi
                    failed=$((failed + 1))
                fi
            else
                if (cd "$CONVEX_DIR" && npx convex env set "$key" "$value" >"$key_err" 2>&1); then
                    synced=$((synced + 1))
                    echo "  Synced $key to Convex"
                else
                    echo "  WARNING: Failed to sync $key to Convex"
                    if [ -s "$key_err" ]; then
                        head -n 1 "$key_err" | sed 's/^/    /'
                    fi
                    failed=$((failed + 1))
                fi
            fi
            rm -f "$key_err"
            key_idx=$((key_idx + 1))
        done

        if [ "$synced" -gt 0 ]; then
            echo "Synced $synced runtime env var(s) to Convex deployment."
        fi
        if [ "$failed" -gt 0 ]; then
            echo "WARNING: $failed Convex env var(s) failed to sync."
        fi
    fi
    rm -f "$batch_err" 2>/dev/null || true
fi

# Lightweight integrity check: AI_API_KEY must not be a short redacted placeholder.
# (CLI sometimes printed sk-... when get was used wrong; set must store full secret.)
_ai_key_len="$(resolve_runtime_env_value AI_API_KEY | wc -c | tr -d ' ')"
if [ "${_ai_key_len:-0}" -gt 0 ] && [ "${_ai_key_len:-0}" -lt 20 ]; then
    echo "WARNING: AI_API_KEY looks too short (${_ai_key_len} chars). Poe/OpenAI keys are usually 40+ chars — analysis will 401."
fi
