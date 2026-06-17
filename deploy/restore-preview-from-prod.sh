#!/bin/bash
# Restore production data into preview Convex via Convex export/import API.
# Run on the preview host as root.
#
# This is the CORRECT way to copy data between Convex deployments.
# DO NOT use raw SQLite file copy — binary version mismatch breaks schema push.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/quiesce.sh"

TARGET_CONVEX_DIR=/home/ubuntu/trends-preview/packages/convex
SOURCE_CONVEX_DIR=/opt/trends/packages/convex
SOURCE_CONVEX_URL=http://127.0.0.1:3210
# Target (preview) runs in Docker — import happens inside container, see Step 3
TARGET_CONVEX_URL=http://127.0.0.1:4210

trap 'release_writers "$SOURCE_CONVEX_DIR" "$SOURCE_CONVEX_URL"; release_writers "$TARGET_CONVEX_DIR" "$TARGET_CONVEX_URL"' EXIT

EXPORT_PATH=/tmp/prod-convex-export.zip
# Clean up stale exports from previous runs
rm -f "$EXPORT_PATH" /tmp/prod-convex-export-fixed.zip
PROD_DIR="${PROD_DIR:-/opt/trends}"
PROD_CONVEX_DIR="$PROD_DIR/packages/convex"
PREVIEW_DIR="${PREVIEW_DIR:-/home/ubuntu/trends-preview}"
PREVIEW_API_URL="${PREVIEW_API_URL:-http://127.0.0.1:3002}"
PREVIEW_CONVEX_URL="${PREVIEW_CONVEX_URL:-http://127.0.0.1:4210}"
DIGEST_BACKFILL_BATCH_SIZE="${DIGEST_BACKFILL_BATCH_SIZE:-50}"

wait_for_preview_api() {
    local max_wait=120
    local waited=0

    echo "Waiting for preview API to become ready..."
    while ! curl -fsS "$PREVIEW_API_URL/" >/dev/null 2>&1; do
        sleep 2
        waited=$((waited + 2))
        if [ "$waited" -ge "$max_wait" ]; then
            echo "Preview API did not become ready after ${max_wait}s" >&2
            systemctl status trends-preview-api --no-pager -l >&2 || true
            exit 1
        fi
    done
    echo "Preview API ready after ${waited}s"
}

check_preview_endpoint() {
    local path="$1"
    local status=""

    status="$(curl -s -o /dev/null -w '%{http_code}' "$PREVIEW_API_URL$path" || echo 000)"
    printf '%s: %s\n' "$path" "$status"
    if [ "$status" != "200" ]; then
        echo "Preview endpoint failed: $path returned $status" >&2
        exit 1
    fi
}

check_preview_resume_count() {
    local output count

    output="$(docker exec trends-preview-convex bash -c "cd /app/packages/convex && npx convex run resumes:count '{}'" 2>&1)"
    count="$(printf '%s\n' "$output" | grep -E '^[0-9]+$' | tail -1)"
    printf 'preview resumes: %s\n' "${count:-unavailable}"
    if [ -z "$count" ] || [ "$count" -le 0 ]; then
        printf '%s\n' "$output" >&2
        echo "Preview resume count check failed" >&2
        exit 1
    fi
}

run_preview_ai_smoke() {
    local keyword="${PREVIEW_AI_SMOKE_KEYWORD:-CNC}"
    local timeout="${PREVIEW_AI_SMOKE_TIMEOUT_SEC:-300}"

    case "${SKIP_PREVIEW_AI_SMOKE:-}" in
        1|true|yes)
            echo "Skipping preview AI smoke because SKIP_PREVIEW_AI_SMOKE is set."
            return 0
            ;;
    esac

    echo ""
    echo "=== Preview AI Analysis Smoke ==="
    if [ -x "$PREVIEW_DIR/node_modules/.bin/tsx" ]; then
        cd "$PREVIEW_DIR" && \
            CONVEX_URL="$PREVIEW_CONVEX_URL" \
            ANALYSIS_TIMEOUT_SEC="$timeout" \
            "$PREVIEW_DIR/node_modules/.bin/tsx" scripts/verify-critical-path.ts \
                --mode=seeded \
                --keyword="$keyword" \
                --analysis-timeout-sec="$timeout" \
                --json
        return
    fi

    cd "$PREVIEW_DIR" && \
        CONVEX_URL="$PREVIEW_CONVEX_URL" \
        ANALYSIS_TIMEOUT_SEC="$timeout" \
        npx tsx scripts/verify-critical-path.ts \
            --mode=seeded \
            --keyword="$keyword" \
            --analysis-timeout-sec="$timeout" \
            --json
}

echo "=== Quiesce source (prod) before export ==="
quiesce_writers "$SOURCE_CONVEX_DIR" "$SOURCE_CONVEX_URL" "prod-to-preview-restore"

echo "=== Step 1: Export production Convex data ==="
sudo -u trends bash -c "cd '$PROD_CONVEX_DIR' && \
    CONVEX_URL=http://127.0.0.1:3210 \
    npx convex export --path '$EXPORT_PATH' --include-file-storage"

ls -lh "$EXPORT_PATH"

echo ""
echo "=== Step 1b: Strip schema-incompatible fields from export ==="
# v0.3.0 dropped screening_sessions.config.filters.showBlocked
# Production data still has it → import aborts. Strip before import.
FIX_DIR=$(mktemp -d)
cd "$FIX_DIR"
unzip -q "$EXPORT_PATH"
python3 - "$PREVIEW_DIR/packages/convex/convex/schema.ts" <<'PYEOF'
import json, os
import pathlib
import re
import sys

path = 'screening_sessions/documents.jsonl'
if os.path.exists(path):
    docs = [json.loads(line) for line in open(path) if line.strip()]
    changed = 0
    for d in docs:
        if isinstance(d.get('config'), dict) and isinstance(d['config'].get('filters'), dict):
            if d['config']['filters'].pop('showBlocked', None) is not None:
                changed += 1
    with open(path, 'w') as f:
        f.write('\n'.join(json.dumps(d, ensure_ascii=False) for d in docs) + '\n')
    print(f"Stripped showBlocked from {changed}/{len(docs)} screening_sessions documents")

# Exclude system_settings table — it carries the source's maintenance flag
# and should not propagate to the target environment
import shutil
if os.path.exists('system_settings'):
    shutil.rmtree('system_settings')
    print("Excluded system_settings/ from import (maintenance flag is environment-local)")

schema_path = pathlib.Path(sys.argv[1])
if not schema_path.exists():
    raise SystemExit(f"Missing preview Convex schema: {schema_path}")

schema_tables = re.findall(
    r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*defineTable\(",
    schema_path.read_text(),
    flags=re.MULTILINE,
)
created_empty_tables = []
for table in schema_tables:
    table_dir = pathlib.Path(table)
    if table_dir.exists():
        continue
    table_dir.mkdir()
    (table_dir / "generated_schema.jsonl").write_text('"uniform"\n')
    (table_dir / "documents.jsonl").write_text("")
    created_empty_tables.append(table)

if created_empty_tables:
    print("Materialized missing schema tables as empty: " + ", ".join(created_empty_tables))
PYEOF
EXPORT_PATH=/tmp/prod-convex-export-fixed.zip
rm -f "$EXPORT_PATH"
zip -rq "$EXPORT_PATH" *
cd /
rm -rf "$FIX_DIR"
ls -lh "$EXPORT_PATH"

echo ""
echo "=== Step 2: Copy export into preview workspace (Docker bind mount) ==="
cp "$EXPORT_PATH" "$PREVIEW_DIR/prod-convex-export.zip"
chown ubuntu:ubuntu "$PREVIEW_DIR/prod-convex-export.zip"

echo ""
echo "=== Step 3: Import into preview Convex ==="
# Restart the Convex container so it sees the freshly copied export file
# (bind mounts can go stale on long-running containers)
echo "Restarting preview Convex to ensure bind mount is fresh..."
cd "$PREVIEW_DIR" && docker compose -f docker-compose.preview.yml restart convex
# Wait for health
echo "Waiting for Convex to become healthy..."
timeout 180 bash -c 'while [ "$(docker inspect --format="{{.State.Health.Status}}" trends-preview-convex 2>/dev/null)" != "healthy" ]; do sleep 10; done'

# The preview Convex container needs the .env.local pointing at its own deployment.
# The deployment name comes from /app/packages/convex/.convex/local/default/config.json
DEPLOY_NAME=$(docker exec trends-preview-convex sh -c \
    'cat /app/packages/convex/.convex/local/default/config.json' \
    | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["deploymentName"])')

echo "Deployment name: $DEPLOY_NAME"

cat > "$PREVIEW_DIR/packages/convex/.env.local" <<EOF
CONVEX_DEPLOYMENT=anonymous:$DEPLOY_NAME
CONVEX_URL=http://127.0.0.1:3210
CONVEX_SITE_URL=http://127.0.0.1:3211
EOF

echo ""
echo "=== Step 3b: Sync preview AI env into Convex ==="
PREVIEW_DIR="$PREVIEW_DIR" "$PREVIEW_DIR/deploy/sync-preview-convex-env.sh"

# Run import inside the container (where 127.0.0.1:3210 resolves to local backend)
docker exec trends-preview-convex bash -c "
    cd /app/packages/convex && \
    timeout 600 npx convex import --replace-all /app/prod-convex-export.zip --yes
"

echo ""
echo "=== Step 4: Rebuild resume digests ==="
# The production export can omit empty derived tables. After replace-all imports,
# rebuild resume_digests so preview search uses the same hot-table path as prod.
digest_cursor=""
digest_total=0
digest_iteration=1
while true; do
    call_args="$(CURSOR="$digest_cursor" DIGEST_BACKFILL_BATCH_SIZE="$DIGEST_BACKFILL_BATCH_SIZE" python3 <<'PYEOF'
import json
import os

args = {"limit": int(os.environ["DIGEST_BACKFILL_BATCH_SIZE"])}
cursor = os.environ.get("CURSOR")
if cursor:
    args["cursor"] = cursor
print(json.dumps(args))
PYEOF
)"

    echo "Backfilling resume_digests batch $digest_iteration..."
    if ! output="$(docker exec trends-preview-convex bash -c "cd /app/packages/convex && npx convex run resumes_search:backfillResumeDigests '$call_args'" 2>&1)"; then
        printf '%s\n' "$output"
        echo "resume_digests backfill failed" >&2
        exit 1
    fi

    parsed="$(OUTPUT="$output" python3 <<'PYEOF'
import json
import os

source = os.environ["OUTPUT"]
start = source.find("{")
end = source.rfind("}")
if start == -1 or end == -1 or end < start:
    raise SystemExit(f"Could not parse Convex response: {source}")
value = json.loads(source[start : end + 1])
processed = int(value.get("processed") or 0)
is_done = 1 if value.get("isDone") else 0
cursor = value.get("cursor") or ""
print(f"{processed}\t{is_done}\t{cursor}")
PYEOF
)"
    processed="${parsed%%$'\t'*}"
    rest="${parsed#*$'\t'}"
    is_done="${rest%%$'\t'*}"
    digest_cursor="${rest#*$'\t'}"
    digest_total=$((digest_total + processed))

    if [ "$is_done" = "1" ]; then
        break
    fi
    if [ -z "$digest_cursor" ]; then
        echo "resume_digests backfill did not finish but returned no cursor" >&2
        exit 1
    fi
    digest_iteration=$((digest_iteration + 1))
done
echo "Backfilled resume_digests for $digest_total resumes"

echo ""
echo "=== Step 5: Restart API to pick up fresh data ==="
systemctl restart trends-preview-api
wait_for_preview_api

echo ""
echo "=== Verification ==="
check_preview_endpoint "/api/blocks"
check_preview_endpoint "/api/search-profiles/stats"
check_preview_resume_count
run_preview_ai_smoke

echo ""
echo "=== Done ==="
echo "Visit https://preview.pt-mes.com/hr/resumes to verify"
