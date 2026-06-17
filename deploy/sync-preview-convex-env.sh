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

    for key in "${AI_ENV_KEYS[@]}"; do
        value="$(read_env_value "$PREVIEW_ENV" "$key")"
        if [ -z "$value" ]; then
            continue
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
    echo "Synced $synced preview AI env var(s) into Convex."
}

if [ "$MODE" = "all" ] || [ "$MODE" = "--hydrate-only" ]; then
    hydrate_preview_env
fi

require_ai_key_if_resume_ai_enabled

if [ "$MODE" = "all" ] || [ "$MODE" = "--sync-only" ]; then
    sync_convex_env
fi
