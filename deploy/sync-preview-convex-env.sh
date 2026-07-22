#!/bin/bash
# Hydrate preview AI runtime env from production env and sync it into preview Convex.
# Run on the preview host as root after the preview Convex container is running.
set -euo pipefail

PREVIEW_DIR="${PREVIEW_DIR:-/home/ubuntu/trends-preview}"
PREVIEW_ENV="${PREVIEW_ENV:-$PREVIEW_DIR/.env.preview}"
CONVEX_CONTAINER="${CONVEX_CONTAINER:-trends-preview-convex}"
MODE="${1:-all}"

AI_ENV_KEYS=(
    AI_ANALYSIS_ENABLED
    AI_ANALYSIS_RESUMES_ENABLED
    AI_MODEL
    AI_API_KEY
    OPENAI_API_KEY
    AI_API_BASE
    AI_OUTPUT_LOCALE
    AI_ANALYSIS_PARALLELISM
)

# Required for candidate_blocks / candidate_status overlays after auth upgrade.
# Missing this secret yields "Unauthorized Convex read" and empty statusCounts.
CONVEX_SECRET_ENV_KEYS=(
    CONVEX_WRITE_SECRET
)

# Convex actions call the host BFF; without these, reingest targets container-local
# loopback inside Docker and fails (connection refused). Defaults: lib-bff-defaults.sh.
CONVEX_BFF_ENV_KEYS=(
    BFF_API_URL
    TRENDS_DEPLOYMENT_ROLE
)

PROD_ENV_CANDIDATES=()
if [ -n "${PROD_ENV:-}" ]; then
    PROD_ENV_CANDIDATES+=("$PROD_ENV")
fi
PROD_ENV_CANDIDATES+=(
    /etc/trends/env
    /opt/trends/.env.production
)

usage() {
    cat <<EOF
Usage: PREVIEW_DIR=/home/ubuntu/trends-preview $0 [all|--hydrate-only|--sync-only]

all             Hydrate missing preview AI env vars, then sync to preview Convex.
--hydrate-only  Only fill empty values in .env.preview from production env files.
--sync-only     Only sync existing .env.preview values into preview Convex env.
EOF
}

case "$MODE" in
    all|--hydrate-only|--sync-only) ;;
    -h|--help)
        usage
        exit 0
        ;;
    *)
        usage >&2
        exit 2
        ;;
esac

read_env_value() {
    local file_path="$1"
    local key="$2"

    if [ ! -f "$file_path" ]; then
        return 0
    fi

    python3 - "$file_path" "$key" <<'PYEOF'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
target = sys.argv[2]

for raw_line in path.read_text().splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#"):
        continue
    if line.startswith("export "):
        line = line[len("export "):].strip()
    if "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() == target:
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        print(value)
        break
PYEOF
}

hydrate_preview_env() {
    if [ ! -f "$PREVIEW_ENV" ]; then
        echo "Missing preview env file: $PREVIEW_ENV" >&2
        exit 1
    fi

    python3 - "$PREVIEW_ENV" "${PROD_ENV_CANDIDATES[@]}" <<'PYEOF'
import pathlib
import shlex
import sys

keys = [
    "AI_ANALYSIS_ENABLED",
    "AI_ANALYSIS_RESUMES_ENABLED",
    "AI_MODEL",
    "AI_API_KEY",
    "OPENAI_API_KEY",
    "AI_API_BASE",
    "AI_OUTPUT_LOCALE",
    "AI_ANALYSIS_PARALLELISM",
]

preview_path = pathlib.Path(sys.argv[1])
prod_paths = [pathlib.Path(p) for p in sys.argv[2:] if p]

def parse_env(path: pathlib.Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values

preview_values = parse_env(preview_path)
prod_values_by_path = [(path, parse_env(path)) for path in prod_paths]
updates: dict[str, tuple[str, pathlib.Path]] = {}

def format_env_line(prefix: str, key: str, value: str) -> str:
    return f"{prefix}{key}={shlex.quote(value)}"

for key in keys:
    if preview_values.get(key):
        continue
    for prod_path, prod_values in prod_values_by_path:
        value = prod_values.get(key)
        if value:
            updates[key] = (value, prod_path)
            preview_values[key] = value
            break

if not updates:
    print("No missing preview AI env vars were hydrated.")
    raise SystemExit(0)

lines = preview_path.read_text().splitlines()
seen: set[str] = set()
new_lines: list[str] = []

for raw_line in lines:
    stripped = raw_line.strip()
    prefix = ""
    body = stripped
    if body.startswith("export "):
        prefix = "export "
        body = body[len("export "):].strip()
    if "=" not in body or body.startswith("#"):
        new_lines.append(raw_line)
        continue
    key, _ = body.split("=", 1)
    key = key.strip()
    if key in updates:
        new_lines.append(format_env_line(prefix, key, updates[key][0]))
        seen.add(key)
    else:
        new_lines.append(raw_line)

for key, (value, _) in updates.items():
    if key not in seen:
        new_lines.append(format_env_line("", key, value))

preview_path.write_text("\n".join(new_lines) + "\n")
for key, (_, source_path) in updates.items():
    print(f"Hydrated {key} from {source_path}")
PYEOF

    chmod 600 "$PREVIEW_ENV"
    if id ubuntu >/dev/null 2>&1; then
        chown ubuntu:ubuntu "$PREVIEW_ENV"
    fi
}

require_ai_key_if_resume_ai_enabled() {
    local resumes_enabled=""
    local ai_key=""
    local openai_key=""

    resumes_enabled="$(read_env_value "$PREVIEW_ENV" AI_ANALYSIS_RESUMES_ENABLED)"
    ai_key="$(read_env_value "$PREVIEW_ENV" AI_API_KEY)"
    openai_key="$(read_env_value "$PREVIEW_ENV" OPENAI_API_KEY)"

    if [ "$resumes_enabled" != "false" ] && [ -z "$ai_key" ] && [ -z "$openai_key" ]; then
        echo "Preview resume AI is enabled but AI_API_KEY/OPENAI_API_KEY is empty in $PREVIEW_ENV." >&2
        echo "Set it there or provide it in /etc/trends/env or /opt/trends/.env.production before syncing Convex env." >&2
        exit 1
    fi
}

sync_convex_env() {
    local key=""
    local value=""
    local synced=0

    if ! docker inspect "$CONVEX_CONTAINER" >/dev/null 2>&1; then
        echo "Preview Convex container not found: $CONVEX_CONTAINER" >&2
        exit 1
    fi

    # Ensure durable defaults when .env.preview predates BFF wiring.
    # Defaults from lib-bff-defaults.sh / PREVIEW_PUBLIC_HOST — not hard-coded hosts here.
    # shellcheck source=lib-bff-defaults.sh
    if [ -f "$(dirname "$0")/lib-bff-defaults.sh" ]; then
        # shellcheck disable=SC1091
        source "$(dirname "$0")/lib-bff-defaults.sh"
    fi
    local preview_bff_default
    if type preview_public_bff_url >/dev/null 2>&1; then
        preview_bff_default="$(preview_public_bff_url)"
    else
        preview_bff_default="https://${PREVIEW_PUBLIC_HOST:-preview.pt-mes.com}"
    fi
    # Repair missing OR container-local BFF in .env.preview before any Convex env set.
    # Without this, a bad container-local value would be synced into Convex.
    if type ensure_bff_env_lines >/dev/null 2>&1; then
        local ensure_rc=0
        set +e
        ensure_bff_env_lines "$PREVIEW_ENV" preview "$preview_bff_default"
        ensure_rc=$?
        set -e
        case "$ensure_rc" in
          1) echo "Set BFF_API_URL=${preview_bff_default} in $PREVIEW_ENV before Convex sync." ;;
          2) echo "Repaired BFF_API_URL → ${preview_bff_default} in $PREVIEW_ENV before Convex sync." ;;
        esac
    fi
    # Always push role default when still empty after ensure
    if [ -z "$(read_env_value "$PREVIEW_ENV" BFF_API_URL)" ]; then
        echo "WARN: BFF_API_URL still empty in $PREVIEW_ENV — pushing ${preview_bff_default} to Convex only" >&2
        if docker exec -e CONVEX_ENV_VALUE="$preview_bff_default" "$CONVEX_CONTAINER" bash -lc \
            'cd /app/packages/convex && npx convex env set BFF_API_URL "$CONVEX_ENV_VALUE" >/dev/null'; then
            synced=$((synced + 1))
            echo "Synced BFF_API_URL (default ${preview_bff_default}) into preview Convex env."
        fi
    fi
    if [ -z "$(read_env_value "$PREVIEW_ENV" TRENDS_DEPLOYMENT_ROLE)" ]; then
        if docker exec -e CONVEX_ENV_VALUE="preview" "$CONVEX_CONTAINER" bash -lc \
            'cd /app/packages/convex && npx convex env set TRENDS_DEPLOYMENT_ROLE "$CONVEX_ENV_VALUE" >/dev/null'; then
            synced=$((synced + 1))
            echo "Synced TRENDS_DEPLOYMENT_ROLE=preview into preview Convex env."
        fi
    fi

    for key in "${AI_ENV_KEYS[@]}" "${CONVEX_SECRET_ENV_KEYS[@]}" "${CONVEX_BFF_ENV_KEYS[@]}"; do
        value="$(read_env_value "$PREVIEW_ENV" "$key")"
        if [ -z "$value" ]; then
            if [[ " ${CONVEX_SECRET_ENV_KEYS[*]} " == *" $key "* ]]; then
                echo "WARN: $key empty in $PREVIEW_ENV — candidate status/blocks will fail with Unauthorized Convex read" >&2
            fi
            if [[ " ${CONVEX_BFF_ENV_KEYS[*]} " == *" $key "* ]]; then
                # Defaults applied above when empty.
                continue
            fi
            continue
        fi
        # Never push container-local BFF into Convex even if ensure was skipped
        if [[ "$key" == "BFF_API_URL" ]] && type is_container_local_bff_url >/dev/null 2>&1 \
            && is_container_local_bff_url "$value"; then
            echo "WARN: refusing to sync container-local BFF_API_URL=$value; using ${preview_bff_default}" >&2
            value="$preview_bff_default"
        fi

        if docker exec -e CONVEX_ENV_VALUE="$value" "$CONVEX_CONTAINER" bash -lc "cd /app/packages/convex && npx convex env set '$key' \"\$CONVEX_ENV_VALUE\" >/dev/null"; then
            synced=$((synced + 1))
            echo "Synced $key into preview Convex env."
        else
            echo "Failed to sync $key into preview Convex env." >&2
            exit 1
        fi
    done

    if [ "$synced" -eq 0 ]; then
        echo "No preview AI env vars were available to sync." >&2
        exit 1
    fi
    echo "Synced $synced preview Convex env var(s)."
}

if [ "$MODE" = "all" ] || [ "$MODE" = "--hydrate-only" ]; then
    hydrate_preview_env
fi

require_ai_key_if_resume_ai_enabled

if [ "$MODE" = "all" ] || [ "$MODE" = "--sync-only" ]; then
    sync_convex_env
fi
