#!/usr/bin/env bash
# check-route-auth.sh — Verify that API route files have auth middleware.
#
# Checks each route file in apps/api/src/routes/ for:
# 1. Import of requireAdmin or denyIfNotAdmin from workspace middleware
# 2. At least one app.use() with requireAdmin or inline denyIfNotAdmin check
#
# Exit 0 if all route files with createRoute have auth.
# Exit 1 if any route file has createRoute but no auth mechanism detected.

set -euo pipefail

ROUTES_DIR="apps/api/src/routes"
FAIL=0
SKIP_FILES=(
  # Health/version — public endpoints
  "health.ts"
  "version.ts"
  "system.ts"
  # Public read-only data endpoints
  "search.ts"
  "rss.ts"
  "topics.ts"
  "trends.ts"
  "industry.ts"
  # User-facing session/action/state endpoints (workspace-scoped, no admin required)
  "sessions.ts"
  "actions.ts"
  "web-vitals.ts"
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
  "blocks.ts"
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
  has_require_admin=false
  has_deny_inline=false

  if grep -q 'requireAdmin' "$file" 2>/dev/null; then
    has_require_admin=true
  fi
  if grep -q 'denyIfNotAdmin' "$file" 2>/dev/null; then
    has_deny_inline=true
  fi

  if [[ "$has_require_admin" == false ]] && [[ "$has_deny_inline" == false ]]; then
    echo "FAIL: $base — has createRoute but no requireAdmin or denyIfNotAdmin"
    FAIL=1
  fi
done

if [[ "$FAIL" -eq 0 ]]; then
  echo "OK: All API route files have auth middleware"
  exit 0
else
  echo ""
  echo "Some route files are missing auth gating. Add requireAdmin or denyIfNotAdmin."
  exit 1
fi
