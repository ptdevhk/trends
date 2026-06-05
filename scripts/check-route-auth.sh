#!/usr/bin/env bash
# check-route-auth.sh — Verify that API route files have auth middleware.
#
# Checks each route file in apps/api/src/routes/ for:
# 1. Admin middleware or inline admin auth checks
# 2. Workspace-user middleware for authenticated non-admin write routes
#
# Exit 0 if all route files with createRoute have auth.
# Exit 1 if any non-public route file has createRoute but no auth mechanism detected.

set -euo pipefail

ROUTES_DIR="${ROUTES_DIR:-apps/api/src/routes}"
FAIL=0
SKIP_FILES=(
  # Health/version — public endpoints
  "health.ts"
  "version.ts"
  # Public read-only data endpoints
  "search.ts"
  "rss.ts"
  "topics.ts"
  "trends.ts"
  "industry.ts"
  # User-facing session/action/state endpoints (workspace-scoped, no admin required)
  "sessions.ts"
  "web-vitals.ts"
  # Auth endpoints are public by design; protected routes consume their sessions.
  "auth.ts"
  # Resume search/match (workspace-scoped read paths)
  "resumes_search.ts"
  "resumes_match.ts"
  # Public submission endpoints (browser extension, candidate-facing)
  "resume-submit.ts"
  "ai-summary.ts"
  "search-alerts.ts"
  "search-analytics.ts"
  "scoring-evaluation.ts"
  # Internal worker endpoints (own auth via WORKER_SECRET)
  "worker.ts"
)

is_skipped() {
  local file="$1"
  local base
  base=$(basename "$file")
  for skip in "${SKIP_FILES[@]}"; do
    if [[ "$base" == "$skip" ]]; then
      return 0
    fi
  done
  return 1
}

for file in "$ROUTES_DIR"/*.ts; do
  base=$(basename "$file")

  # Skip test files, helpers, and known public routes
  if [[ "$base" == *.test.ts ]] || [[ "$base" == *.test-d.ts ]] || [[ "$base" == *helpers* ]]; then
    continue
  fi

  # Check if file has any createRoute calls
  if ! grep -q 'createRoute(' "$file" 2>/dev/null; then
    continue
  fi

  # Skip known public routes
  if is_skipped "$base"; then
    continue
  fi

  # Check for auth mechanism
  has_auth_gate=false

  if grep -q 'requireAdmin' "$file" 2>/dev/null; then
    has_auth_gate=true
  fi
  if grep -q 'denyIfNotAdmin' "$file" 2>/dev/null; then
    has_auth_gate=true
  fi
  if grep -q 'getAdminAccessError' "$file" 2>/dev/null; then
    has_auth_gate=true
  fi
  if grep -q 'requireWorkspaceUser' "$file" 2>/dev/null; then
    has_auth_gate=true
  fi

  if [[ "$has_auth_gate" == false ]]; then
    echo "FAIL: $base — has createRoute but no auth gate"
    FAIL=1
  fi
done

if [[ "$FAIL" -eq 0 ]]; then
  echo "OK: All API route files have auth middleware"
  exit 0
else
  echo ""
  echo "Some route files are missing auth gating. Add requireAdmin, getAdminAccessError, or requireWorkspaceUser."
  exit 1
fi
