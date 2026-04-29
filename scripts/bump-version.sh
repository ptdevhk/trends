#!/usr/bin/env bash
# bump-version.sh — Bump project version across all workspace files.
# Usage: scripts/bump-version.sh <new-version>
# Example: scripts/bump-version.sh 0.2.1

set -euo pipefail

NEW_VERSION="${1:?Usage: $0 <new-version>}"

# Validate semver-ish
if ! echo "$NEW_VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+'; then
  echo "ERROR: Version must match semver (e.g. 0.2.1), got: $NEW_VERSION" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Read current version from canonical source
CURRENT=$(cat version | tr -d '[:space:]')
if [ "$CURRENT" = "$NEW_VERSION" ]; then
  echo "Already at $NEW_VERSION, nothing to do."
  exit 0
fi

echo "Bumping $CURRENT → $NEW_VERSION"

# --- Single-source-of-truth file ---
echo "$NEW_VERSION" > version

# --- Node package.json (monorepo root + workspaces) ---
find . -name package.json -not -path '*/node_modules/*' -exec sed -i '' "s/\"$CURRENT\"/\"$NEW_VERSION\"/g" {} +

# --- Python pyproject.toml + __init__.py ---
sed -i '' "s/^version = \"$CURRENT\"/version = \"$NEW_VERSION\"/" pyproject.toml
sed -i '' "s/__version__ = \"$CURRENT\"/__version__ = \"$NEW_VERSION\"/" apps/worker/__init__.py
sed -i '' "s/__version__ = \"$CURRENT\"/__version__ = \"$NEW_VERSION\"/" trendradar/__init__.py

# --- API config + schemas ---
sed -i '' "s/version: \"$CURRENT\"/version: \"$NEW_VERSION\"/" apps/api/src/services/config.ts
sed -i '' "s/example: \"$CURRENT\"/example: \"$NEW_VERSION\"/" apps/api/src/schemas/health.ts

# --- OpenAPI spec ---
sed -i '' "s/version: $CURRENT/version: $NEW_VERSION/" apps/api/openapi.yaml
sed -i '' "s/example: '$CURRENT'/example: '$NEW_VERSION'/" apps/api/openapi.yaml

# --- Generated api-types.ts ---
sed -i '' "s/@example $CURRENT/@example $NEW_VERSION/" apps/web/src/lib/api-types.ts

# --- E2E test fixtures ---
sed -i '' "s/appVersion: '$CURRENT'/appVersion: '$NEW_VERSION'/" apps/web/e2e/resume-role-filter.spec.ts
sed -i '' "s/apiVersion: '$CURRENT'/apiVersion: '$NEW_VERSION'/" apps/web/e2e/resume-role-filter.spec.ts
sed -i '' "s/webVersion: '$CURRENT'/webVersion: '$NEW_VERSION'/" apps/web/e2e/resume-role-filter.spec.ts

# --- Lockfiles (force regeneration) ---
echo "Regenerating lockfiles..."
if command -v bun &>/dev/null; then
  rm -f bun.lock
  bun install 2>/dev/null || true
fi
if command -v uv &>/dev/null; then
  uv lock 2>/dev/null || true
fi

# --- Verify no stale references remain (source files only) ---
STALE=$(grep -r "$CURRENT" \
  --include='*.ts' --include='*.py' --include='*.yaml' --include='*.toml' \
  --include='version' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.next \
  --exclude-dir=.venv --exclude-dir=coverage --exclude-dir=output \
  --exclude-dir=resume-backups --exclude-dir=resume-samples \
  --exclude-dir=.chrome-debug-profile \
  -l 2>/dev/null \
  | grep -v '\.test\.' \
  | grep -v '\.spec\.' \
  | grep -v 'openapi\.json' \
  | grep -v 'package-lock\.json' \
  || true)

if [ -n "$STALE" ]; then
  echo "" >&2
  echo "WARNING: Stale '$CURRENT' references remain in:" >&2
  echo "$STALE" >&2
  echo "Review and update manually." >&2
else
  echo "No stale references found. All clean."
fi

echo "Done: $CURRENT → $NEW_VERSION"
