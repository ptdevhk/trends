#!/bin/bash
# Restore production data into preview Convex via Convex export/import API.
# Run on the preview host as root.
#
# This is the CORRECT way to copy data between Convex deployments.
# DO NOT use raw SQLite file copy — binary version mismatch breaks schema push.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/quiesce.sh"
# shellcheck source=lib-preview-common.sh
source "$SCRIPT_DIR/lib-preview-common.sh"
# shellcheck source=lib-convex-export-fix.sh
source "$SCRIPT_DIR/lib-convex-export-fix.sh"

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
# Wall-clock budget for the `convex import` CLI run. The 2026-08-18 import of
# the full prod snapshot (~50k rows + file storage) exceeded the old 900s
# timeout mid-run; the CLI-side kill left the backend import wedged
# in_progress (single-import lock blocks later syncs — Step 3b.1 now cancels
# such leftovers before upload). Raise/override with CONVEX_IMPORT_TIMEOUT_SEC.
CONVEX_IMPORT_TIMEOUT_SEC="${CONVEX_IMPORT_TIMEOUT_SEC:-3600}"

wait_for_preview_api() {
    local max_wait=120
    local waited=0
    local status=""

    echo "Waiting for preview API to become ready..."
    while true; do
        if ! status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$PREVIEW_API_URL/" 2>/dev/null)"; then
            status="000"
        fi
        case "$status" in
            200|401)
                echo "Preview API ready after ${waited}s (http=$status)"
                return 0
                ;;
        esac
        sleep 2
        waited=$((waited + 2))
        if [ "$waited" -ge "$max_wait" ]; then
            echo "Preview API did not become ready after ${max_wait}s (last http=$status)" >&2
            systemctl status trends-preview-api --no-pager -l >&2 || true
            exit 1
        fi
    done
}

check_preview_endpoint() {
    local path="$1"
    local status=""

    if ! status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$PREVIEW_API_URL$path" 2>/dev/null)"; then
        status="000"
    fi
    printf '%s: %s\n' "$path" "$status"
    if [ "$status" = "401" ]; then
        echo "  -> auth enforced; unauthenticated readiness accepted (authenticated parity is still required)"
    elif [ "$status" != "200" ]; then
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

    # Canonical reseed: admin@dev + hr-demo@hr (never reseed failed product usernames)
    if [ -x "$SCRIPT_DIR/preview-seed-auth.sh" ] || [ -x "$PREVIEW_DIR/deploy/preview-seed-auth.sh" ]; then
        echo "  -> reseeding preview auth (admin + hr-demo)"
        PREVIEW_DIR="$PREVIEW_DIR" bash "${SCRIPT_DIR:-$PREVIEW_DIR/deploy}/preview-seed-auth.sh" 2>/dev/null \
            || PREVIEW_DIR="$PREVIEW_DIR" bash "$PREVIEW_DIR/deploy/preview-seed-auth.sh" || true
    elif [ -x "$PREVIEW_DIR/node_modules/.bin/tsx" ] || command -v bunx >/dev/null 2>&1; then
        echo "  -> reseeding bootstrap admin '$username' (best-effort fallback)"
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
fix_convex_export "$EXPORT_PATH" "$PREVIEW_DIR/packages/convex/convex/schema.ts" /tmp/prod-convex-export-fixed.zip || {
    echo "fix_convex_export failed" >&2
    exit 1
}
# Step 2 copies $EXPORT_PATH — keep it pointing at the fixed zip
EXPORT_PATH=/tmp/prod-convex-export-fixed.zip
ls -lh /tmp/prod-convex-export-fixed.zip

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

echo ""
echo "=== Step 3b.1: Cancel any wedged import before uploading ==="
# A previous sync whose CLI-side `timeout` killed `convex import` mid-run
# leaves the backend import job in_progress; the backend's single-import lock
# then blocks every later sync (2026-08-18 failure mode). Cancel via the
# backend API only — the import journal `documents` table is append-only;
# a middle-row DELETE broke backend startup (2026-08-18), so no journal edits.
if ! cancel_stale_convex_imports; then
    echo "FATAL: could not prove preview Convex import state clean; refusing to import over a possibly wedged import." >&2
    echo "Manual fix: docker restart trends-preview-convex, then re-run this sync." >&2
    exit 1
fi

# Run import inside the container (where 127.0.0.1:3210 resolves to local backend)
docker exec trends-preview-convex bash -c "
    cd /app/packages/convex && \
    timeout ${CONVEX_IMPORT_TIMEOUT_SEC} npx convex import --replace-all /app/prod-convex-export.zip --yes
"

echo ""
echo "=== Step 3c: Re-assert canonical no-hire company policies ==="
# `convex import --replace-all` materializes schema tables missing from the
# export as EMPTY (see Step 1b). If the export predates the no-hire seed (or
# lacks the table), the workspace blacklist settings for 宝力机械 / Pro-Technic
# Machinery and 宝惠 / Polywell would silently vanish on preview while prod
# keeps them. Re-run the idempotent seed so a repeat restore cycle leaves the
# blacklist SET (no-op when the latest revision is already no-hire).
if ! seed_preview_canonical_no_hire "hr"; then
    echo "FATAL: canonical no-hire re-seed failed — preview blacklist would be unset." >&2
    echo "Manual fix: docker exec trends-preview-convex bash -c 'cd /app/packages/convex && WS=\$(npx convex env get CONVEX_WRITE_SECRET | tail -1) && npx convex run companies:seedCanonicalCompanies \"{\\\"workspaceSlug\\\":\\\"hr\\\",\\\"seedNoHireForWorkspace\\\":true,\\\"writeSecret\\\":\\\"\$WS\\\"}\" --env-file .env.local'" >&2
    exit 1
fi

echo ""
echo "=== Step 3c.2: Re-seed reviewed company-industry catalog ==="
# The prod export carries no company_industry_* rows (the catalog was written
# by a July attended bootstrap that predates the export path), so
# --replace-all materializes those schema tables EMPTY on preview while prod
# keeps the catalog. Replay the deterministic reviewed bootstrap plan
# (deploy/seed-data/company-industry-seed-plan.json) through the same mutation
# chain — idempotent, so a repeat restore cycle leaves the catalog SET.
if ! seed_preview_company_industry; then
    echo "FATAL: company-industry re-seed failed — preview catalog would be empty." >&2
    echo "Manual fix: fix the SEED_FATAL error above, then re-run this sync (the seed leg is idempotent)." >&2
    exit 1
fi

echo ""
echo "=== Step 3d: Preview system_settings smoke ==="
# The export fixer keeps system_settings/ but drops environment-local rows
# (maintenanceMode, industryMaintenanceSchedulePaused) so env-local flags
# never propagate, while search-affecting settings (resumeWorkHistoryLimit)
# do — preview no longer reverts to defaults on every sync. Smoke-verify the
# env-local flag did not leak and the search setting propagated.
# Extract the JSON result from a `convex run` line (ANSI-decorated).
# Empty stdout means the query returned null (row absent) — `convex run`
# prints nothing for null, and system_settings:get returns row?.value ?? null.
# Missing rows are the EXPECTED state for env-local keys (filtered from the
# export), so empty input parses as "null" instead of failing.
parse_convex_json_value() {
    python3 -c '
import json, re, sys
data = sys.stdin.read()
data = re.sub(r"\x1b\[[0-9;]*m", "", data)
lines = [ln.strip() for ln in data.splitlines() if ln.strip()]
if not lines:
    print("null")
    sys.exit(0)
for line in lines:
    candidates = [line]
    # tolerate a leading CLI marker (e.g. "✔ false")
    parts = line.split(None, 1)
    if len(parts) == 2:
        candidates.append(parts[1])
    for cand in candidates:
        try:
            print(json.dumps(json.loads(cand), ensure_ascii=False))
            sys.exit(0)
        except ValueError:
            pass
    m = re.search(r"\{.*\}", line, re.DOTALL)
    if m:
        try:
            print(json.dumps(json.loads(m.group(0)), ensure_ascii=False))
            sys.exit(0)
        except ValueError:
            pass
sys.exit(1)
'
}

# Distinguish "convex run failed" (nonzero rc — fail fast) from
# "ran fine, returned null" (rc 0 + empty stdout — absent row).
preview_setting() {
    local key="$1" out rc
    out="$(docker exec trends-preview-convex bash -c \
        "cd /app/packages/convex && npx convex run system_settings:get '{\"key\":\"$key\"}' --env-file .env.local" 2>&1)"
    rc=$?
    if [ "$rc" -ne 0 ]; then
        echo "convex run failed (rc=$rc): $out" >&2
        return 1
    fi
    printf '%s\n' "$out" | parse_convex_json_value
}

prod_setting() {
    local key="$1" out rc
    out="$(sudo -u trends env CONVEX_URL="$SOURCE_CONVEX_URL" bash -c \
        'cd "$1" && npx convex run system_settings:get "$2"' \
        bash "$SOURCE_CONVEX_DIR" "{\"key\":\"$key\"}" 2>&1)"
    rc=$?
    if [ "$rc" -ne 0 ]; then
        echo "convex run failed (rc=$rc): $out" >&2
        return 1
    fi
    printf '%s\n' "$out" | parse_convex_json_value
}

MM_PREVIEW=""
if ! MM_PREVIEW="$(preview_setting maintenanceMode)"; then
    echo "FATAL: cannot read preview system_settings:maintenanceMode" >&2
    exit 1
fi
echo "preview system_settings:maintenanceMode = $MM_PREVIEW"
if [ "$MM_PREVIEW" = "true" ]; then
    echo "FATAL: preview maintenanceMode=true after restore — environment-local flag must not import." >&2
    exit 1
fi
if [ "$MM_PREVIEW" = "null" ]; then
    echo "  -> absent (expected: environment-local key is filtered from the export)"
fi

if RWL_PROD="$(prod_setting resumeWorkHistoryLimit 2>/dev/null)"; then
    if RWL_PREVIEW="$(preview_setting resumeWorkHistoryLimit 2>/dev/null)"; then
        echo "system_settings:resumeWorkHistoryLimit prod=$RWL_PROD preview=$RWL_PREVIEW"
        if [ "$RWL_PROD" = "null" ] && [ "$RWL_PREVIEW" = "null" ]; then
            echo "  -> not configured on either side (nothing to propagate)"
        elif [ "$RWL_PROD" != "$RWL_PREVIEW" ]; then
            echo "  WARN: resumeWorkHistoryLimit differs (warn-only — operator may align deliberately)"
        else
            echo "  -> propagated"
        fi
    else
        echo "  WARN: preview resumeWorkHistoryLimit unreadable (warn-only)"
    fi
else
    echo "  WARN: prod resumeWorkHistoryLimit unreadable (warn-only)"
fi

echo ""
echo "=== Step 4: Resume digests (parity-preserving policy) ==="
# DIGEST_BACKFILL_MODE:
#   skip              — never recompute (default). Preserve production digests for search parity.
#   if-empty          — only backfill when digests appear empty after import
#   if-epoch-changed  — backfill when the code's CURRENT_INGEST_COMPUTE_EPOCH differs from
#                       the epoch stamped in the imported data (prevents stale roleYearsByType
#                       after a code upgrade that changes the compute algorithm)
#   always            — recompute all digests (destroys prod digest text/score fields; search can drift)
# Note: skip is unsafe when a code upgrade follows the restore. The upgraded code
# may compute roleYearsByType with a different algorithm (e.g. verified-only gate),
# but the imported digests still carry the old production values. This causes
# inconsistent search results — some rows match old digest logic, others new.
# Use if-epoch-changed or always when restoring before an upgrade.
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
    if-epoch-changed)
        # Record the code epoch at restore time. preview-upgrade.sh compares
        # this marker against the post-upgrade epoch and rebuilds digests
        # if they differ. This defers the rebuild decision to the upgrade
        # script where the new code is already available.
        CODE_EPOCH=0
        if [ -f "$PREVIEW_DIR/packages/shared/dist/ingest-compute-epoch.js" ]; then
            CODE_EPOCH="$(cd "$PREVIEW_DIR" && node -e \
                "console.log(require('./packages/shared/dist/ingest-compute-epoch.js').CURRENT_INGEST_COMPUTE_EPOCH)" \
                2>/dev/null || echo 0)"
        elif [ -f "$PREVIEW_DIR/packages/shared/src/ingest-compute-epoch.ts" ]; then
            CODE_EPOCH="$(cd "$PREVIEW_DIR" && npx tsx -e \
                "process.stdout.write(String(require('./packages/shared/src/ingest-compute-epoch.ts').CURRENT_INGEST_COMPUTE_EPOCH))" \
                2>/dev/null || echo 0)"
        fi
        echo "$CODE_EPOCH" > "$PREVIEW_DIR/.digest-restore-epoch"
        echo "Recorded restore-time code epoch=$CODE_EPOCH in .digest-restore-epoch"
        # Do not backfill now — preview-upgrade.sh will decide after code sync.
        should_backfill_digests=0
        ;;
    skip|never|0|false|no|"") should_backfill_digests=0 ;;
    *)
        echo "Unknown DIGEST_BACKFILL_MODE=$DIGEST_BACKFILL_MODE (use skip|if-empty|if-epoch-changed|always)" >&2
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
