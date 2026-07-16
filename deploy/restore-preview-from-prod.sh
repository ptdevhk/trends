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

verify_preview_admin_login() {
    # Verify the bootstrap admin can authenticate.
    # Soft-fail by default: data restore must not abort after Convex import
    # because admin login is independent of resume/status parity.
    # Set RESTORE_STRICT=1 to hard-fail on admin login failure.
    local password="${AUTH_BOOTSTRAP_PASSWORD:-}"
    local username="${BOOTSTRAP_ADMIN_USERS%%,*}"
    username="${username:-admin}"
    local strict="${RESTORE_STRICT:-0}"

    if [ -z "$password" ]; then
        echo "  -> AUTH_BOOTSTRAP_PASSWORD not set; skipping admin login check"
        return 0
    fi

    # Best-effort reseed before check (idempotent upsert).
    if [ -x "$PREVIEW_DIR/node_modules/.bin/tsx" ] || command -v bunx >/dev/null 2>&1; then
        echo "  -> reseeding bootstrap admin '$username' (best-effort)"
        (
            set -a
            # shellcheck disable=SC1091
            source "$PREVIEW_DIR/.env.preview" 2>/dev/null || true
            set +a
            cd "$PREVIEW_DIR"
            if command -v bunx >/dev/null 2>&1; then
                bunx tsx scripts/auth/manage-user.ts --username "$username" --workspace "${BOOTSTRAP_ADMIN_WORKSPACE:-dev}" --role admin --password-env AUTH_BOOTSTRAP_PASSWORD --output agent || true
            else
                "$PREVIEW_DIR/node_modules/.bin/tsx" scripts/auth/manage-user.ts --username "$username" --workspace "${BOOTSTRAP_ADMIN_WORKSPACE:-dev}" --role admin --password-env AUTH_BOOTSTRAP_PASSWORD --output agent || true
            fi
        ) || true
    fi

    local body
    body="$(curl -s -X POST "$PREVIEW_API_URL/api/auth/login" \
        -H 'Content-Type: application/json' \
        -d "{\"username\":\"$username\",\"password\":\"$password\"}" 2>&1)"

    if echo "$body" | grep -q '"success":true'; then
        printf '  admin login (%s): OK\n' "$username"
        return 0
    fi

    echo "  admin login ($username): FAILED" >&2
    echo "  Response: $body" >&2
    echo "  Hint: re-seed with:" >&2
    echo "    cd $PREVIEW_DIR && set -a; source .env.preview; set +a \\" >&2
    echo "      && bunx tsx scripts/auth/manage-user.ts --username $username --workspace dev --role admin --password-env AUTH_BOOTSTRAP_PASSWORD --output agent" >&2
    case "$strict" in
        1|true|yes)
            exit 1
            ;;
        *)
            echo "  -> continuing (RESTORE_STRICT not set). Data parity is independent of admin login." >&2
            return 0
            ;;
    esac
}

check_preview_resume_page() {
    local output count

    output="$(docker exec trends-preview-convex bash -c "cd /app/packages/convex && npx convex run resumes_search:scanResumePageSlim '{\"numItems\":1}'" 2>&1)"
    count="$(OUTPUT="$output" python3 <<'PYEOF'
import json
import os

source = os.environ["OUTPUT"]
start = source.find("{")
end = source.rfind("}")
if start == -1 or end == -1 or end < start:
    raise SystemExit(0)
value = json.loads(source[start : end + 1])
print(len(value.get("docs") or []))
PYEOF
)"
    printf 'preview resume page size: %s\n' "${count:-unavailable}"
    if [ -z "$count" ] || [ "$count" -le 0 ]; then
        printf '%s\n' "$output" >&2
        echo "Preview resume page check failed" >&2
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
    timeout 900 npx convex import --replace-all /app/prod-convex-export.zip --yes
"

echo ""
echo "=== Step 4: Resume digests (parity-preserving policy) ==="
# DIGEST_BACKFILL_MODE:
#   skip     — never recompute (default). Preserve production digests for search parity.
#   if-empty — only backfill when digests appear empty after import
#   always   — recompute all digests (destroys prod digest text/score fields; search can drift)
DIGEST_BACKFILL_MODE="${DIGEST_BACKFILL_MODE:-skip}"
DIGEST_IMPORTED_COUNT="$(unzip -l /tmp/prod-convex-export-fixed.zip 2>/dev/null | awk '/resume_digests\/documents\.jsonl/ {print $1; found=1} END{if(!found) print 0}' || echo 0)"
# Heuristic: documents.jsonl size > 100 bytes means digests were exported
DIGEST_FILE_BYTES=0
if [ -f /tmp/prod-convex-export-fixed.zip ]; then
    DIGEST_FILE_BYTES="$(unzip -p /tmp/prod-convex-export-fixed.zip resume_digests/documents.jsonl 2>/dev/null | wc -c | tr -d ' ' || echo 0)"
fi
echo "Digest policy: DIGEST_BACKFILL_MODE=$DIGEST_BACKFILL_MODE export_digest_bytes=${DIGEST_FILE_BYTES:-0}"

should_backfill_digests=0
case "$DIGEST_BACKFILL_MODE" in
    always|force|1|true|yes) should_backfill_digests=1 ;;
    if-empty)
        if [ "${DIGEST_FILE_BYTES:-0}" -lt 100 ]; then
            should_backfill_digests=1
        fi
        ;;
    skip|never|0|false|no|"") should_backfill_digests=0 ;;
    *)
        echo "Unknown DIGEST_BACKFILL_MODE=$DIGEST_BACKFILL_MODE (use skip|if-empty|always)" >&2
        exit 2
        ;;
esac

if [ "$should_backfill_digests" -eq 0 ]; then
    echo "Skipping digest backfill — keeping imported production digests (search parity)."
else
    echo "Rebuilding resume digests (this can change search totals vs production)..."
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
fi

echo ""
echo "=== Step 5: Restart API to pick up fresh data ==="
systemctl restart trends-preview-api
wait_for_preview_api

echo ""
echo "=== Verification ==="
# Source .env.preview for auth credentials (available after systemd restart)
set -a; source "$PREVIEW_DIR/.env.preview" 2>/dev/null || true; set +a
check_preview_endpoint "/api/blocks"
check_preview_resume_page
verify_preview_admin_login
# AI smoke is optional for data-restore; default skip unless explicitly enabled.
case "${RUN_PREVIEW_AI_SMOKE:-0}" in
    1|true|yes) run_preview_ai_smoke ;;
    *) echo "Skipping AI smoke (set RUN_PREVIEW_AI_SMOKE=1 to enable)." ;;
esac

echo ""
echo "=== Done ==="
echo "Visit https://preview.pt-mes.com/hr/resumes to verify"
echo "Parity check: bash deploy/preview-parity-check.sh"
