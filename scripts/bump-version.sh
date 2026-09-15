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
if ! grep -q "\"version\": \"$NEW_VERSION\"" package.json; then
  if ! grep -qE '"version": "[0-9]+\.[0-9]+\.[0-9]+"' package.json; then
    echo "ERROR: package.json version is missing" >&2
  else
    echo "ERROR: package.json version is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi
if ! grep -q "\"version\": \"$NEW_VERSION\"" apps/api/package.json; then
  if ! grep -qE '"version": "[0-9]+\.[0-9]+\.[0-9]+"' apps/api/package.json; then
    echo "ERROR: apps/api/package.json version is missing" >&2
  else
    echo "ERROR: apps/api/package.json version is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi
if ! grep -q "\"version\": \"$NEW_VERSION\"" apps/web/package.json; then
  if ! grep -qE '"version": "[0-9]+\.[0-9]+\.[0-9]+"' apps/web/package.json; then
    echo "ERROR: apps/web/package.json version is missing" >&2
  else
    echo "ERROR: apps/web/package.json version is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi
if ! grep -q "\"version\": \"$NEW_VERSION\"" packages/shared/package.json; then
  if ! grep -qE '"version": "[0-9]+\.[0-9]+\.[0-9]+"' packages/shared/package.json; then
    echo "ERROR: packages/shared/package.json version is missing" >&2
  else
    echo "ERROR: packages/shared/package.json version is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi
if ! grep -q "\"version\": \"$NEW_VERSION\"" packages/convex/package.json; then
  if ! grep -qE '"version": "[0-9]+\.[0-9]+\.[0-9]+"' packages/convex/package.json; then
    echo "ERROR: packages/convex/package.json version is missing" >&2
  else
    echo "ERROR: packages/convex/package.json version is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi
if ! grep -q "\"version\": \"$NEW_VERSION\"" apps/browser-extension/package.json; then
  if ! grep -qE '"version": "[0-9]+\.[0-9]+\.[0-9]+"' apps/browser-extension/package.json; then
    echo "ERROR: apps/browser-extension/package.json version is missing" >&2
  else
    echo "ERROR: apps/browser-extension/package.json version is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi

# --- Python pyproject.toml + __init__.py ---
sed -i '' "s/^version = \"$CURRENT\"/version = \"$NEW_VERSION\"/" pyproject.toml
if ! grep -qE "^version = \"$NEW_VERSION\"" pyproject.toml; then
  if ! grep -qE '^version = "[0-9]+\.[0-9]+\.[0-9]+"' pyproject.toml; then
    echo "ERROR: pyproject.toml version is missing" >&2
  else
    echo "ERROR: pyproject.toml version is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi
sed -i '' "s/^version = \"$CURRENT\"/version = \"$NEW_VERSION\"/" apps/worker/pyproject.toml
if ! grep -qE "^version = \"$NEW_VERSION\"" apps/worker/pyproject.toml; then
  if ! grep -qE '^version = "[0-9]+\.[0-9]+\.[0-9]+"' apps/worker/pyproject.toml; then
    echo "ERROR: worker pyproject.toml version is missing" >&2
  else
    echo "ERROR: worker pyproject.toml version is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi
sed -i '' "s/__version__ = \"$CURRENT\"/__version__ = \"$NEW_VERSION\"/" apps/worker/__init__.py
if ! grep -q "__version__ = \"$NEW_VERSION\"" apps/worker/__init__.py; then
  if ! grep -qE '__version__ = "[0-9]+\.[0-9]+\.[0-9]+"' apps/worker/__init__.py; then
    echo "ERROR: worker __init__.py __version__ is missing" >&2
  else
    echo "ERROR: worker __init__.py __version__ is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi
sed -i '' "s/__version__ = \"$CURRENT\"/__version__ = \"$NEW_VERSION\"/" trendradar/__init__.py
if ! grep -q "__version__ = \"$NEW_VERSION\"" trendradar/__init__.py; then
  if ! grep -qE '__version__ = "[0-9]+\.[0-9]+\.[0-9]+"' trendradar/__init__.py; then
    echo "ERROR: trendradar __init__.py __version__ is missing" >&2
  else
    echo "ERROR: trendradar __init__.py __version__ is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi

# --- API config + schemas ---
sed -i '' "s/version: \"$CURRENT\"/version: \"$NEW_VERSION\"/" apps/api/src/services/config.ts
if ! grep -q "version: \"$NEW_VERSION\"" apps/api/src/services/config.ts; then
  if ! grep -qE 'version: "[0-9]+\.[0-9]+\.[0-9]+"' apps/api/src/services/config.ts; then
    echo "ERROR: config.ts version is missing" >&2
  else
    echo "ERROR: config.ts version is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi
sed -i '' "s/example: \"$CURRENT\"/example: \"$NEW_VERSION\"/" apps/api/src/schemas/health.ts
if ! grep -q "example: \"$NEW_VERSION\"" apps/api/src/schemas/health.ts; then
  if ! grep -qE 'example: "[0-9]+\.[0-9]+\.[0-9]+"' apps/api/src/schemas/health.ts; then
    echo "ERROR: health.ts example is missing" >&2
  else
    echo "ERROR: health.ts example is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi
sed -i '' "s/version: \"$CURRENT\"/version: \"$NEW_VERSION\"/" apps/api/src/schemas/schemas-validation.test.ts
if ! grep -q "version: \"$NEW_VERSION\"" apps/api/src/schemas/schemas-validation.test.ts; then
  if ! grep -qE 'version: "[0-9]+\.[0-9]+\.[0-9]+"' apps/api/src/schemas/schemas-validation.test.ts; then
    echo "ERROR: schemas-validation.test.ts version is missing" >&2
  else
    echo "ERROR: schemas-validation.test.ts version is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi

# --- OpenAPI spec ---
sed -i '' "s/version: $CURRENT/version: $NEW_VERSION/" apps/api/openapi.yaml
sed -i '' "s/example: '$CURRENT'/example: '$NEW_VERSION'/" apps/api/openapi.yaml
if ! grep -A20 'HealthResponse:' apps/api/openapi.yaml | grep -q "example: '$NEW_VERSION'"; then
  if ! grep -A20 'HealthResponse:' apps/api/openapi.yaml | grep -qE "example: '[0-9]+\\.[0-9]+\\.[0-9]+'"; then
    echo "ERROR: OpenAPI yaml HealthResponse example is missing" >&2
  else
    echo "ERROR: OpenAPI yaml HealthResponse example is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi

# Generated JSON used to be skipped by the leftover CURRENT scan, so a lagged
# HealthResponse example (or a missing one) could survive a bump.
sed -i '' "s/\"$CURRENT\"/\"$NEW_VERSION\"/g" apps/api/openapi.json
python3 - "$NEW_VERSION" <<'PY'
import json
import sys
from pathlib import Path

expected = sys.argv[1]
path = Path("apps/api/openapi.json")
try:
    doc = json.loads(path.read_text())
except Exception:
    print("ERROR: apps/api/openapi.json is unreadable", file=sys.stderr)
    sys.exit(1)
info_version = (doc.get("info") or {}).get("version")
if not isinstance(info_version, str) or not info_version:
    print("ERROR: OpenAPI JSON info.version is missing", file=sys.stderr)
    sys.exit(1)
if info_version != expected:
    print(
        f"ERROR: OpenAPI JSON info.version is {info_version} != {expected}",
        file=sys.stderr,
    )
    sys.exit(1)
example = (
    doc.get("components", {})
    .get("schemas", {})
    .get("HealthResponse", {})
    .get("properties", {})
    .get("version", {})
    .get("example")
)
if not isinstance(example, str) or not example:
    print("ERROR: OpenAPI JSON HealthResponse example is missing", file=sys.stderr)
    sys.exit(1)
if example != expected:
    print(
        f"ERROR: OpenAPI JSON HealthResponse example is {example} != {expected}",
        file=sys.stderr,
    )
    sys.exit(1)
yaml_text = Path("apps/api/openapi.yaml").read_text()
yaml_info = None
for line in yaml_text.splitlines():
    if line.startswith("  version: "):
        yaml_info = line.split(":", 1)[1].strip()
        break
if not yaml_info:
    print("ERROR: OpenAPI YAML info.version is missing", file=sys.stderr)
    sys.exit(1)
if yaml_info != info_version:
    print(
        f"ERROR: OpenAPI yaml/json info.version disagree ({yaml_info} != {info_version})",
        file=sys.stderr,
    )
    sys.exit(1)
if yaml_info != expected:
    print(
        f"ERROR: OpenAPI yaml/json info.version is {yaml_info} != {expected}",
        file=sys.stderr,
    )
    sys.exit(1)
PY

# --- Generated api-types.ts ---
sed -i '' "s/@example $CURRENT/@example $NEW_VERSION/" apps/web/src/lib/api-types.ts
if ! grep -q "@example $NEW_VERSION" apps/web/src/lib/api-types.ts; then
  if ! grep -qE '@example [0-9]+\.[0-9]+\.[0-9]+' apps/web/src/lib/api-types.ts; then
    echo "ERROR: api-types @example is missing" >&2
  else
    echo "ERROR: api-types @example is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi

# --- E2E test fixtures ---
sed -i '' "s/appVersion: '$CURRENT'/appVersion: '$NEW_VERSION'/" apps/web/e2e/resume-role-filter.spec.ts
if ! grep -q "appVersion: '$NEW_VERSION'" apps/web/e2e/resume-role-filter.spec.ts; then
  if ! grep -qE "appVersion: '[0-9]+\\.[0-9]+\\.[0-9]+'" apps/web/e2e/resume-role-filter.spec.ts; then
    echo "ERROR: e2e appVersion is missing" >&2
  else
    echo "ERROR: e2e appVersion is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi
sed -i '' "s/apiVersion: '$CURRENT'/apiVersion: '$NEW_VERSION'/" apps/web/e2e/resume-role-filter.spec.ts
if ! grep -q "apiVersion: '$NEW_VERSION'" apps/web/e2e/resume-role-filter.spec.ts; then
  if ! grep -qE "apiVersion: '[0-9]+\\.[0-9]+\\.[0-9]+'" apps/web/e2e/resume-role-filter.spec.ts; then
    echo "ERROR: e2e apiVersion is missing" >&2
  else
    echo "ERROR: e2e apiVersion is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi
sed -i '' "s/webVersion: '$CURRENT'/webVersion: '$NEW_VERSION'/" apps/web/e2e/resume-role-filter.spec.ts
if ! grep -q "webVersion: '$NEW_VERSION'" apps/web/e2e/resume-role-filter.spec.ts; then
  if ! grep -qE "webVersion: '[0-9]+\\.[0-9]+\\.[0-9]+'" apps/web/e2e/resume-role-filter.spec.ts; then
    echo "ERROR: e2e webVersion is missing" >&2
  else
    echo "ERROR: e2e webVersion is not $NEW_VERSION (stale leftover like 0.4.6)." >&2
  fi
  exit 1
fi

# --- Lockfiles (force regeneration) ---
echo "Regenerating lockfiles..."
if command -v bun &>/dev/null; then
  rm -f bun.lock
  bun install 2>/dev/null || true
fi
if command -v uv &>/dev/null; then
  uv lock 2>/dev/null || true
  (cd apps/worker && uv lock 2>/dev/null) || true
fi

# --- Verify no stale references remain (source files only) ---
STALE=$(grep -r "$CURRENT" \
  --include='*.ts' --include='*.py' --include='*.yaml' --include='*.toml' \
  --include='version' --include='openapi.json' --include='package.json' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.next \
  --exclude-dir=.venv --exclude-dir=coverage --exclude-dir=output \
  --exclude-dir=resume-backups --exclude-dir=resume-samples \
  --exclude-dir=.chrome-debug-profile \
  -l 2>/dev/null \
  | grep -v '\.test\.' \
  | grep -v '\.spec\.' \
  | grep -v 'package-lock\.json' \
  || true)

if [ -n "$STALE" ]; then
  echo "" >&2
  echo "ERROR: Stale '$CURRENT' references remain in:" >&2
  echo "$STALE" >&2
  echo "Fail closed: remaining source references must be updated before the bump is done." >&2
  exit 1
fi

# Bump updates these fixtures, but the leftover CURRENT scan skips *.test.* / *.spec.*.
for leftover in \
  apps/api/src/schemas/schemas-validation.test.ts \
  apps/web/e2e/resume-role-filter.spec.ts
do
  if ! grep -q "$NEW_VERSION" "$leftover"; then
    echo "ERROR: $leftover is missing $NEW_VERSION (stale leftover like 0.4.6)." >&2
    exit 1
  fi
  if grep -q "$CURRENT" "$leftover"; then
    echo "ERROR: Stale '$CURRENT' remains in $leftover" >&2
    exit 1
  fi
done

echo "No stale references found. All clean."
echo "Done: $CURRENT → $NEW_VERSION"
