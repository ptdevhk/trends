#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/check-route-auth.sh"

if grep -q '"actions.ts"' "$SCRIPT"; then
  echo "FAIL: actions.ts must not be skipped by route auth checker"
  exit 1
fi

if grep -q '"blocks.ts"' "$SCRIPT"; then
  echo "FAIL: blocks.ts must not be skipped by route auth checker"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
PASS_OUT="$TMP_DIR/pass.out"
FAIL_OUT="$TMP_DIR/fail.out"
POLICY_FILE="$TMP_DIR/route-auth-policy.json"

run_checker() {
  ROUTES_DIR="$TMP_DIR" ROUTE_AUTH_POLICY_FILE="$POLICY_FILE" bash "$SCRIPT" "$@"
}

write_policy() {
  local body="$1"
  printf '%s\n' "$body" >"$POLICY_FILE"
}

cat >"$TMP_DIR/public.ts" <<'ROUTE'
import { createRoute } from "@hono/zod-openapi";
const route = createRoute({ method: "get", path: "/api/public", responses: {} });
app.openapi(route, () => {});
ROUTE

cat >"$TMP_DIR/workspace-write.ts" <<'ROUTE'
import { createRoute } from "@hono/zod-openapi";
import { requireWorkspaceUser } from "../middleware/auth.js";
const route = createRoute({ method: "post", path: "/api/workspace", responses: {} });
app.use("/api/workspace", requireWorkspaceUser);
app.openapi(route, () => {});
ROUTE

cat >"$TMP_DIR/admin.ts" <<'ROUTE'
import { createRoute } from "@hono/zod-openapi";
import { getAdminAccessError } from "../middleware/auth.js";
const route = createRoute({ method: "put", path: "/api/admin", responses: {} });
app.openapi(route, (c) => {
  const adminError = getAdminAccessError(c);
  if (adminError) return c.json(adminError.body, adminError.status);
});
ROUTE

write_policy '{
  "public.ts": {
    "class": "public",
    "reason": "Intentional unauthenticated test route."
  },
  "workspace-write.ts": {
    "class": "workspace-write",
    "reason": "Workspace writes require user membership."
  },
  "admin.ts": {
    "class": "admin",
    "reason": "Admin mutation test route."
  }
}'

run_checker >"$PASS_OUT"

cat >"$TMP_DIR/missing-policy.ts" <<'ROUTE'
import { createRoute } from "@hono/zod-openapi";
const route = createRoute({ method: "get", path: "/api/missing-policy", responses: {} });
app.openapi(route, () => {});
ROUTE

if run_checker >"$FAIL_OUT" 2>&1; then
  echo "FAIL: checker passed a createRoute file without a policy entry"
  exit 1
fi

if ! grep -q "missing-policy.ts" "$FAIL_OUT"; then
  echo "FAIL: checker did not report the route file missing a policy entry"
  cat "$FAIL_OUT"
  exit 1
fi

rm "$TMP_DIR/missing-policy.ts"

cat >"$TMP_DIR/workspace-write.ts" <<'ROUTE'
import { createRoute } from "@hono/zod-openapi";
const route = createRoute({ method: "post", path: "/api/workspace", responses: {} });
app.openapi(route, () => {});
ROUTE

if run_checker >"$FAIL_OUT" 2>&1; then
  echo "FAIL: checker passed a workspace-write policy without requireWorkspaceUser"
  exit 1
fi

if ! grep -q "workspace-write.ts" "$FAIL_OUT"; then
  echo "FAIL: checker did not report the workspace-write guard gap"
  cat "$FAIL_OUT"
  exit 1
fi

cat >"$TMP_DIR/workspace-write.ts" <<'ROUTE'
import { createRoute } from "@hono/zod-openapi";
import { requireWorkspaceUser } from "../middleware/auth.js";
const route = createRoute({ method: "post", path: "/api/workspace", responses: {} });
app.use("/api/workspace", requireWorkspaceUser);
app.openapi(route, () => {});
ROUTE

cat >"$TMP_DIR/admin.ts" <<'ROUTE'
import { createRoute } from "@hono/zod-openapi";
const route = createRoute({ method: "put", path: "/api/admin", responses: {} });
app.openapi(route, () => {});
ROUTE

if run_checker >"$FAIL_OUT" 2>&1; then
  echo "FAIL: checker passed an admin policy without an admin guard"
  exit 1
fi

if ! grep -q "admin.ts" "$FAIL_OUT"; then
  echo "FAIL: checker did not report the admin guard gap"
  cat "$FAIL_OUT"
  exit 1
fi

echo "OK: check-route-auth enforces route policy entries and guard signals"
