#!/usr/bin/env bash
# p12f live round-trip: BFF export/import + CLI backup/restore + gate P4 step simulation.
# Run from repo root with: set -a; source .env; set +a && bash scripts/t12-live-roundtrip.sh
set -Eeuo pipefail

API="${API:-http://127.0.0.1:3000}"
JAR="$(mktemp)"
export PREVIEW_API_URL="$API"

log() { echo "== $*"; }
fail() { echo "FAIL: $*"; exit 1; }

ADMIN_USER="${BOOTSTRAP_ADMIN_USERS:-admin}"
ADMIN_USER="${ADMIN_USER%%,*}"
: "${AUTH_BOOTSTRAP_PASSWORD:?AUTH_BOOTSTRAP_PASSWORD required}"

# --- grant admin membership on scratch workspaces (upsert preserves dev) ---
log "grant admin membership on scratch workspaces"
for ws in p12-live-ws p12-live-target p12-live-target2; do
  bunx tsx scripts/auth/manage-user.ts --username "$ADMIN_USER" --workspace "$ws" \
    --role admin --password-env AUTH_BOOTSTRAP_PASSWORD --display-name "$ADMIN_USER" \
    --output agent >/dev/null || fail "manage-user $ws"
done

# --- login (mirrors preview_auth_login) ---
log "login admin"
BODY="$(curl -sS -c "$JAR" -b "$JAR" -X POST "$API/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$AUTH_BOOTSTRAP_PASSWORD\"}")"
echo "$BODY" | grep -q '"success":true' || fail "admin login: $BODY"
CSRF="$(awk '$6=="trends_csrf"{print $7}' "$JAR" 2>/dev/null | tail -1)"
echo "csrf=${CSRF:-<none>}"

auth_curl() { # auth_curl <workspace> <args...>
  local ws="$1"; shift
  curl -sS -b "$JAR" -c "$JAR" -H "X-CSRF-Token: $CSRF" -H "X-Workspace-Slug: $ws" "$@"
}

# --- seed ---
log "seed p12-live-ws"
bunx tsx scripts/t12-live-roundtrip.ts seed

# --- BFF export hr-ops ---
log "BFF export hr-ops (p12-live-ws)"
auth_curl p12-live-ws "$API/api/workspace/export?profile=hr-ops" > /tmp/p12f-hr-ops.json
python3 - /tmp/p12f-hr-ops.json <<'PY' || fail "hr-ops envelope invalid"
import json, sys
with open(sys.argv[1]) as f:
    doc = json.load(f)
ok = (
    doc.get("success") is True
    and doc.get("schemaVersion") == 1
    and doc.get("profile") == "hr-ops"
    and isinstance(doc.get("tables"), dict)
)
sys.exit(0 if ok else 1)
PY
echo "envelope OK: $(python3 -c 'import json; d=json.load(open("/tmp/p12f-hr-ops.json")); print({k: len(v) for k, v in d["tables"].items()})')"

# --- BFF import replace into p12-live-target ---
log "BFF import replace (p12-live-target)"
python3 - <<'PY'
import json
doc = json.load(open("/tmp/p12f-hr-ops.json"))
body = {
    "schemaVersion": doc["schemaVersion"],
    "profile": doc["profile"],
    "mode": "replace",
    "tables": doc["tables"],
}
json.dump(body, open("/tmp/p12f-import-body.json", "w"))
PY
auth_curl p12-live-target -X POST "$API/api/workspace/import" \
  -H 'Content-Type: application/json' -d @/tmp/p12f-import-body.json > /tmp/p12f-import-result.json
python3 - <<'PY' || fail "import result unexpected"
import json
doc = json.load(open("/tmp/p12f-import-result.json"))
assert doc.get("success") is True and doc.get("mode") == "replace", doc
print("import result:", json.dumps({"applied": doc["applied"], "deleted": doc["deleted"]}))
PY
bunx tsx scripts/t12-live-roundtrip.ts verify p12-live-target hr-ops

# --- CLI backup full + restore merge (CLI session auth is dev-workspace-only by design) ---
log "seed dev (CLI target)"
bunx tsx scripts/t12-live-roundtrip.ts seed dev

log "CLI backup full (dev)"
make cli-build >/dev/null 2>&1 || fail "cli-build"
TRENDS_AUTH_USERNAME="$ADMIN_USER" TRENDS_AUTH_PASSWORD="$AUTH_BOOTSTRAP_PASSWORD" \
  ./bin/trends workspace backup --profile full --api-url "$API" --workspace dev \
  --out /tmp/p12f-cli-backup.json --output json
grep -q '"profile":"full"' /tmp/p12f-cli-backup.json || grep -q '"profile": "full"' /tmp/p12f-cli-backup.json || fail "CLI backup envelope missing profile=full"
python3 -c 'import json; d=json.load(open("/tmp/p12f-cli-backup.json")); assert d.get("success") and d.get("profile")=="full"; print("CLI backup OK:", {k: len(v) for k, v in d["tables"].items()})'

log "CLI restore merge (dev)"
TRENDS_AUTH_USERNAME="$ADMIN_USER" TRENDS_AUTH_PASSWORD="$AUTH_BOOTSTRAP_PASSWORD" \
  ./bin/trends workspace restore /tmp/p12f-cli-backup.json --mode merge --api-url "$API" \
  --workspace dev --output json
bunx tsx scripts/t12-live-roundtrip.ts verify dev full

# --- Gate P4 step simulation (same commands as preview-migration-gate.sh step 6) ---
log "gate P4 step simulation"
SNAPSHOT_FILE="/tmp/p12f-gate-snapshot-$$.json"
if curl -sS -c "$JAR" -b "$JAR" \
    -H "X-CSRF-Token: $CSRF" \
    -H "X-Workspace-Slug: p12-live-ws" \
    --max-time 60 "$API/api/workspace/export?profile=hr-ops" > "$SNAPSHOT_FILE.tmp" \
    && python3 - "$SNAPSHOT_FILE.tmp" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    doc = json.load(f)
ok = (
    doc.get("success") is True
    and doc.get("schemaVersion") == 1
    and doc.get("profile") == "hr-ops"
    and isinstance(doc.get("tables"), dict)
)
sys.exit(0 if ok else 1)
PY
then
    mv "$SNAPSHOT_FILE.tmp" "$SNAPSHOT_FILE"
    echo "gate artifact OK: $SNAPSHOT_FILE"
else
    rm -f "$SNAPSHOT_FILE.tmp"
    fail "gate P4 step simulation failed"
fi

# --- cleanup ---
log "cleanup"
bunx tsx scripts/t12-live-roundtrip.ts cleanup
rm -f "$JAR" /tmp/p12f-*.json /tmp/p12f-gate-snapshot-*.json*
echo "ROUNDTRIP_PASS"
