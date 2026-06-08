#!/usr/bin/env bash
# check-route-auth.sh — Verify API route files match the route auth policy matrix.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROUTES_DIR="${ROUTES_DIR:-$ROOT_DIR/apps/api/src/routes}"
POLICY_FILE="${ROUTE_AUTH_POLICY_FILE:-$ROOT_DIR/scripts/route-auth-policy.json}"
FAIL=0

POLICY_ROWS="$(
  node - "$POLICY_FILE" <<'NODE'
const fs = require("node:fs");

const policyFile = process.argv[2];
const allowedClasses = new Set([
  "public",
  "telemetry",
  "workspace-read",
  "workspace-write",
  "admin",
  "internal-worker",
  "candidate-link",
]);

if (!fs.existsSync(policyFile)) {
  console.error(`FAIL: route auth policy file missing: ${policyFile}`);
  process.exit(1);
}

let policy;
try {
  policy = JSON.parse(fs.readFileSync(policyFile, "utf8"));
} catch (error) {
  console.error(`FAIL: route auth policy file is invalid JSON: ${error.message}`);
  process.exit(1);
}

if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
  console.error("FAIL: route auth policy file must contain a JSON object");
  process.exit(1);
}

let failed = false;
for (const [file, entry] of Object.entries(policy).sort(([left], [right]) => left.localeCompare(right))) {
  if (!file.endsWith(".ts")) {
    console.error(`FAIL: ${file} — policy key must be a TypeScript route basename`);
    failed = true;
    continue;
  }

  const accessClass = entry && typeof entry === "object" ? entry.class : undefined;
  const reason = entry && typeof entry === "object" ? entry.reason : undefined;

  if (!allowedClasses.has(accessClass)) {
    console.error(`FAIL: ${file} — policy class must be one of ${Array.from(allowedClasses).join(", ")}`);
    failed = true;
  }

  if (typeof reason !== "string" || reason.trim().length === 0) {
    console.error(`FAIL: ${file} — policy reason is required`);
    failed = true;
  }

  if (allowedClasses.has(accessClass) && typeof reason === "string" && reason.trim().length > 0) {
    console.log(`${file}\t${accessClass}\t${reason.trim().replace(/\s+/g, " ")}`);
  }
}

if (failed) {
  process.exit(1);
}
NODE
)" || exit 1

policy_class_for() {
  local base="$1"
  awk -F '\t' -v base="$base" '
    $1 == base { print $2; found = 1 }
    END { if (!found) exit 1 }
  ' <<<"$POLICY_ROWS"
}

has_admin_guard() {
  local file="$1"
  grep -Eq 'requireAdmin|denyIfNotAdmin|getAdminAccessError' "$file" 2>/dev/null
}

has_workspace_user_guard() {
  local file="$1"
  grep -q 'requireWorkspaceUser' "$file" 2>/dev/null
}

ROUTE_POLICY_BASES=""

for file in "$ROUTES_DIR"/*.ts; do
  base=$(basename "$file")

  if [[ "$base" == *.test.ts ]] || [[ "$base" == *.test-d.ts ]] || [[ "$base" == *helpers* ]]; then
    continue
  fi

  if ! grep -q 'createRoute(' "$file" 2>/dev/null; then
    continue
  fi

  ROUTE_POLICY_BASES="$ROUTE_POLICY_BASES $base "

  if ! access_class=$(policy_class_for "$base"); then
    echo "FAIL: $base — has createRoute but no route auth policy entry"
    FAIL=1
    continue
  fi

  case "$access_class" in
    workspace-read|workspace-write)
      if ! has_workspace_user_guard "$file"; then
        echo "FAIL: $base — $access_class policy requires requireWorkspaceUser"
        FAIL=1
      fi
      ;;
    admin)
      if ! has_admin_guard "$file"; then
        echo "FAIL: $base — admin policy requires requireAdmin, denyIfNotAdmin, or getAdminAccessError"
        FAIL=1
      fi
      ;;
    public|telemetry|internal-worker|candidate-link)
      ;;
    *)
      echo "FAIL: $base — unsupported route auth policy class: $access_class"
      FAIL=1
      ;;
  esac
done

while IFS=$'\t' read -r policy_base _policy_class _policy_reason; do
  if [[ "$ROUTE_POLICY_BASES" != *" $policy_base "* ]]; then
    echo "FAIL: $policy_base — policy entry has no matching route file with createRoute"
    FAIL=1
  fi
done <<<"$POLICY_ROWS"

if [[ "$FAIL" -eq 0 ]]; then
  echo "OK: API route files match route auth policy matrix"
  exit 0
else
  echo ""
  echo "Some route files do not match scripts/route-auth-policy.json."
  exit 1
fi
