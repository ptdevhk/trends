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

cat >"$TMP_DIR/workspace-write.ts" <<'ROUTE'
import { createRoute } from "@hono/zod-openapi";
import { requireWorkspaceUser } from "../middleware/auth.js";
const route = createRoute({ method: "post", path: "/api/example", responses: {} });
app.use("/api/example", requireWorkspaceUser);
app.openapi(route, () => {});
ROUTE

cat >"$TMP_DIR/inline-admin.ts" <<'ROUTE'
import { createRoute } from "@hono/zod-openapi";
import { getAdminAccessError } from "../middleware/auth.js";
const route = createRoute({ method: "put", path: "/api/example", responses: {} });
app.openapi(route, (c) => {
  const adminError = getAdminAccessError(c);
  if (adminError) return c.json(adminError.body, adminError.status);
});
ROUTE

ROUTES_DIR="$TMP_DIR" bash "$SCRIPT" >/tmp/check-route-auth-pass.out

cat >"$TMP_DIR/missing-auth.ts" <<'ROUTE'
import { createRoute } from "@hono/zod-openapi";
const route = createRoute({ method: "post", path: "/api/example", responses: {} });
app.openapi(route, () => {});
ROUTE

if ROUTES_DIR="$TMP_DIR" bash "$SCRIPT" >/tmp/check-route-auth-fail.out 2>&1; then
  echo "FAIL: checker passed a createRoute file without auth"
  exit 1
fi

if ! grep -q "missing-auth.ts" /tmp/check-route-auth-fail.out; then
  echo "FAIL: checker did not report the unauthenticated route file"
  cat /tmp/check-route-auth-fail.out
  exit 1
fi

echo "OK: check-route-auth recognizes auth middleware and reports gaps"
