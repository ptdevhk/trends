#!/bin/bash
# Restore preview Convex data into production.
# Run on ptcloud as root.
#
# Direction: PREVIEW -> PROD (overwrites prod data via --replace-all)
# Use Convex export/import API only. NEVER raw SQLite copy.
#
# Safety: caller must have already taken a prod snapshot backup.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/quiesce.sh"

SOURCE_CONVEX_DIR=/home/ubuntu/trends-preview/packages/convex
# Preview Convex runs in Docker on host port 4210
SOURCE_CONVEX_URL=http://127.0.0.1:4210
TARGET_CONVEX_DIR=/opt/trends/packages/convex
TARGET_CONVEX_URL=http://127.0.0.1:3210

trap 'release_writers "$SOURCE_CONVEX_DIR" "$SOURCE_CONVEX_URL"; release_writers "$TARGET_CONVEX_DIR" "$TARGET_CONVEX_URL"' EXIT

PREFLIGHT_EXPORT=/tmp/prod-preflight-export.zip

extract_resume_ids_from_zip() {
    local zip_path="$1"
    local tmp; tmp=$(mktemp -d)
    (cd "$tmp" && unzip -q "$zip_path" 'resumes/documents.jsonl' 2>/dev/null) || { rm -rf "$tmp"; return 0; }
    if [ -f "$tmp/resumes/documents.jsonl" ]; then
        python3 -c "import json,sys; [print(json.loads(l)['_id']) for l in open('$tmp/resumes/documents.jsonl') if l.strip()]"
    fi
    rm -rf "$tmp"
}

audit_resume_ids() {
    local preview_zip="$1"
    local allow_loss="${RESTORE_ALLOW_ID_LOSS:-}"

    echo "=== Pre-flight: resume-ID audit ==="
    echo "Exporting current prod Convex for ID comparison..."
    rm -f "$PREFLIGHT_EXPORT"
    sudo -u trends bash -c "
        cd $TARGET_CONVEX_DIR && \
        CONVEX_URL=$TARGET_CONVEX_URL \
        npx convex export --path $PREFLIGHT_EXPORT --include-file-storage
    " > /dev/null 2>&1
    ls -lh "$PREFLIGHT_EXPORT"

    echo "Extracting ID sets..."
    local preview_ids prod_ids orphans orphan_count
    prod_ids=$(mktemp)
    preview_ids=$(mktemp)
    extract_resume_ids_from_zip "$PREFLIGHT_EXPORT" | sort > "$prod_ids"
    extract_resume_ids_from_zip "$preview_zip"     | sort > "$preview_ids"

    echo "  prod IDs: $(wc -l < "$prod_ids")"
    echo "  preview IDs: $(wc -l < "$preview_ids")"

    orphans=$(comm -23 "$prod_ids" "$preview_ids")
    orphan_count=$(echo "$orphans" | grep -c . || true)
    rm -f "$prod_ids" "$preview_ids" "$PREFLIGHT_EXPORT"

    if [ "$orphan_count" -gt 0 ]; then
        echo "" >&2
        echo "WARNING: $orphan_count prod resume(s) NOT in preview export." >&2
        echo "These would be DELETED by --replace-all, orphaning SQLite candidate_actions." >&2
        echo "First 10 orphans:" >&2
        echo "$orphans" | head -10 >&2
        if [ "$allow_loss" = "1" ]; then
            echo "RESTORE_ALLOW_ID_LOSS=1 — proceeding with acknowledged data loss." >&2
        else
            echo "" >&2
            echo "To proceed anyway: RESTORE_ALLOW_ID_LOSS=1 bash $0" >&2
            exit 1
        fi
    else
        echo "OK: all prod resume IDs present in preview export — no orphan risk."
    fi
}

EXPORT_PATH=/tmp/preview-convex-export.zip
# Clean up stale exports from previous runs
rm -f "$EXPORT_PATH" /tmp/preview-convex-export-fixed.zip
PROD_DIR=/opt/trends
PREVIEW_DIR=/home/ubuntu/trends-preview
DIGEST_BACKFILL_BATCH_SIZE="${DIGEST_BACKFILL_BATCH_SIZE:-50}"

wait_for_prod_api() {
    local max_wait=120
    local waited=0

    echo "Waiting for prod API to become ready..."
    while ! curl -fsS http://127.0.0.1:3000/api/blocks >/dev/null 2>&1; do
        sleep 2
        waited=$((waited + 2))
        if [ "$waited" -ge "$max_wait" ]; then
            echo "Prod API did not become ready after ${max_wait}s" >&2
            systemctl status trends-api --no-pager -l >&2 || true
            exit 1
        fi
    done
    echo "Prod API ready after ${waited}s"
}

echo "=== Pre-flight: quiesce PREVIEW (source) before export ==="
quiesce_writers "$SOURCE_CONVEX_DIR" "$SOURCE_CONVEX_URL" "preview-to-prod-restore"

echo ""
echo "=== Step 1: Export PREVIEW Convex data ==="
# Preview Convex runs in Docker. Export inside the container where port 3210 is correct.
# Host-side export fails because the host workspace .env.local points at container-internal ports.
docker exec \
    -e CONVEX_DEPLOYMENT=anonymous:anonymous-convex \
    -e CONVEX_URL=http://127.0.0.1:3210 \
    trends-preview-convex \
    bash -c "cd /app/packages/convex && npx convex export --path /app/preview-convex-export.zip --include-file-storage"

# Copy out of container via docker exec cat.
# NOTE: docker cp fails intermittently with bind-mount paths ("Could not find the file").
# docker exec cat to stdout is more reliable.
docker exec trends-preview-convex cat /app/preview-convex-export.zip > "$EXPORT_PATH"
ls -lh "$EXPORT_PATH"

echo ""
echo "=== Step 1b: Strip schema-incompatible fields against prod schema ==="
# Prod schema is source of truth now. Same script logic as restore-preview-from-prod.sh.
FIX_DIR=$(mktemp -d)
cd "$FIX_DIR"
unzip -q "$EXPORT_PATH"
python3 - "$PROD_DIR/packages/convex/convex/schema.ts" <<'PYEOF'
import json, os
import pathlib
import re
import sys

# v0.3.0 dropped screening_sessions.config.filters.showBlocked
# Preview data should not have it but prod schema rejects it if present.
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
    raise SystemExit(f"Missing prod Convex schema: {schema_path}")

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
EXPORT_PATH=/tmp/preview-convex-export-fixed.zip
rm -f "$EXPORT_PATH"
zip -rq "$EXPORT_PATH" *
cd /
rm -rf "$FIX_DIR"
ls -lh "$EXPORT_PATH"

echo ""
echo "=== Pre-flight: quiesce PROD (target) before import ==="
quiesce_writers "$TARGET_CONVEX_DIR" "$TARGET_CONVEX_URL" "preview-to-prod-restore-target"

audit_resume_ids "$EXPORT_PATH"

echo ""
echo "=== Step 2: Import into PROD Convex (replace-all) ==="
# Prod Convex runs on bare metal as the trends user.
cp "$EXPORT_PATH" "$PROD_DIR/packages/convex/preview-convex-export.zip"
chown trends:trends "$PROD_DIR/packages/convex/preview-convex-export.zip"

sudo -u trends bash -c "
    cd $PROD_DIR/packages/convex && \
    CONVEX_URL=http://127.0.0.1:3210 \
    timeout 900 npx convex import --replace-all preview-convex-export.zip --yes
"

echo ""
echo "=== Step 3: Rebuild resume digests ==="
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
    if ! output="$(sudo -u trends bash -c "cd $PROD_DIR/packages/convex && CONVEX_URL=http://127.0.0.1:3210 npx convex run resumes_search:backfillResumeDigests '$call_args'" 2>&1)"; then
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
echo "=== Post-restore: ID preservation verification ==="
verify_id_preservation() {
    local sqlite_db="/opt/trends/output/resume_screening.db"
    local convex_sqlite="$TARGET_CONVEX_DIR/.convex/local/default/convex_local_backend.sqlite3"

    if [ ! -f "$sqlite_db" ]; then
        echo "No SQLite candidate_actions DB found — skipping verification"
        return 0
    fi

    local missing=0
    while IFS= read -r resume_id; do
        local found
        found=$(sudo -u trends sqlite3 "$convex_sqlite" \
            "SELECT count(*) FROM documents WHERE deleted=0 AND json_value LIKE '%${resume_id}%';" 2>/dev/null || echo "0")
        if [ "$found" = "0" ]; then
            echo "ORPHANED: $resume_id" >&2
            missing=$((missing + 1))
        fi
    done < <(sudo -u trends sqlite3 "$sqlite_db" "SELECT DISTINCT resume_id FROM candidate_actions;" 2>/dev/null)

    if [ "$missing" -gt 0 ]; then
        echo "FATAL: $missing SQLite resume_id(s) orphaned after restore." >&2
        echo "Roll back via safety snapshot before proceeding." >&2
        exit 1
    fi
    echo "All SQLite resume_id references resolve in Convex."
}
verify_id_preservation

echo ""
echo "=== Step 4: Restart prod API to pick up fresh data ==="
systemctl restart trends-api
wait_for_prod_api

echo ""
echo "=== Verification ==="
echo -n "/api/blocks: " && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/blocks
echo -n "/api/search-profiles: " && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/search-profiles
echo -n "/api/search-profiles/stats: " && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/search-profiles/stats

echo ""
echo "=== Done ==="
echo "Visit https://pt-mes.com/hr/resumes to verify"
