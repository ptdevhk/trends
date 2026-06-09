#!/usr/bin/env bash
# Upgrades the Convex npm package and local backend binary across environments.
#
# Handles three environments:
#   dev        macOS local dev (auto-detected) — bun install, local prefetch
#   linux-dev  Linux dev VM                   — npm install, local prefetch
#   prod       Linux prod (SSH_HOST, defaults to ptcloud) — patches package.json, prints manual steps
#
# Also writes CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS to .env.local,
# which is the official override for the CLI's startup timeout (available in
# Convex CLI >= 1.36.0).
#
# Usage:
#   scripts/upgrade-convex.sh 1.36.0
#   scripts/upgrade-convex.sh 1.36.0 --dry-run
#   scripts/upgrade-convex.sh 1.36.0 --env prod
#   scripts/upgrade-convex.sh 1.36.0 --clean-cache --timeout 120
#   make upgrade-convex VERSION=1.36.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LOG_PREFIX="[convex-upgrade]"

log() { printf '%s %s\n' "$LOG_PREFIX" "$*"; }
warn() { printf '%s WARN: %s\n' "$LOG_PREFIX" "$*" >&2; }
error() { printf '%s ERROR: %s\n' "$LOG_PREFIX" "$*" >&2; }

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

ENV=""
VERSION=""
DRY_RUN=""
TIMEOUT_SECS="90"
NO_TIMEOUT=""
NO_PREFETCH=""
CLEAN_CACHE=""
SKIP_INSTALL=""

# ---------------------------------------------------------------------------
# Helpers (duplicated with attribution — same functions exist in install.sh,
# dev.sh, convex-prewarm.sh, prefetch-convex-backend.sh)
# ---------------------------------------------------------------------------

has_bun() { command -v bun >/dev/null 2>&1; }

# upsert_env_var_in_file — from install.sh:1088 (portable awk-based)
upsert_env_var_in_file() {
    local file_path="$1"
    local key="$2"
    local value="$3"
    local tmp_file=""

    mkdir -p "$(dirname "$file_path")"
    if [[ ! -f "$file_path" ]]; then
        touch "$file_path"
    fi

    tmp_file="$(mktemp)"
    awk -v key="$key" -v value="$value" '
        BEGIN { updated = 0 }
        $0 ~ "^[[:space:]]*" key "=" {
            print key "=" value
            updated = 1
            next
        }
        { print }
        END {
            if (updated == 0) {
                print key "=" value
            }
        }
    ' "$file_path" > "$tmp_file"
    mv "$tmp_file" "$file_path"
}

# cache_binaries_dir — from convex-prewarm.sh:66 (full Windows support)
cache_binaries_dir() {
    case "$(uname -s 2>/dev/null || echo unknown)" in
        MINGW*|MSYS*|CYGWIN*)
            if [ -n "${LOCALAPPDATA:-}" ]; then
                echo "${LOCALAPPDATA}/convex/binaries"; return
            fi
            if [ -n "${USERPROFILE:-}" ]; then
                echo "${USERPROFILE}/AppData/Local/convex/binaries"; return
            fi
            echo "${HOME}/AppData/Local/convex/binaries"; return
            ;;
    esac
    echo "${HOME}/.cache/convex/binaries"
}

# binary_name — from convex-prewarm.sh:80
binary_name() {
    case "$(uname -s 2>/dev/null || echo unknown)" in
        MINGW*|MSYS*|CYGWIN*) echo "convex-local-backend.exe" ;;
        *) echo "convex-local-backend" ;;
    esac
}

# patch_convex_dep — patch "convex" dependency in a package.json file.
# Uses env vars to avoid shell-variable injection into JS strings.
patch_convex_dep() {
    local target_version="$1"
    shift
    for pkg_path in "$@"; do
        PKG_PATH="$pkg_path" NEW_VER="$target_version" node -e '
            const fs = require("node:fs");
            const pkg = JSON.parse(fs.readFileSync(process.env.PKG_PATH, "utf8"));
            pkg.dependencies.convex = process.env.NEW_VER;
            fs.writeFileSync(process.env.PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
        '
    done
}

# read_json_field — read a field from a JSON file via env var.
# Usage: read_json_field <file> <dotpath>  e.g. read_json_field pkg.json dependencies.convex
read_json_field() {
    PKG_PATH="$1" FIELD="$2" node -e '
        const pkg = JSON.parse(require("node:fs").readFileSync(process.env.PKG_PATH, "utf8"));
        const parts = process.env.FIELD.split(".");
        let v = pkg;
        for (const p of parts) v = v[p];
        console.log(v ?? "NOT_FOUND");
    '
}

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------

usage() {
    cat <<EOF
Usage: $0 <version> [options]

Upgrades the Convex npm package and prefetches the matching local backend binary.

Arguments:
  <version>     Target Convex version, e.g. 1.36.0 (caret prefix added automatically)

Options:
  --env ENV     Environment: dev (macOS), linux-dev, prod (default: auto-detect)
  --dry-run     Print all steps without side effects
  --timeout N   Value for CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS (default: 90)
  --no-timeout  Skip writing the timeout env var
  --no-prefetch Skip running prefetch-convex-backend.sh
  --clean-cache Remove old cached backend binaries after upgrade
  --skip-install Skip bun/npm install (only patch package.json + env)
  --help        Show this help

Environment auto-detection (when --env is not specified):
  macOS  → dev
  Linux  → linux-dev
  prod   → requires explicit --env prod

Examples:
  $0 1.36.0                        # Upgrade on macOS dev
  $0 1.36.0 --dry-run              # Preview changes
  $0 1.36.0 --env prod             # Show manual prod steps
  $0 1.36.0 --clean-cache          # Remove old binaries from cache
  $0 1.36.0 --timeout 120         # Set 120s startup timeout
  make upgrade-convex VERSION=1.36.0
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --env)
            [[ $# -lt 2 ]] && { error "--env requires a value"; exit 1; }
            ENV="$2"; shift 2 ;;
        --dry-run)
            DRY_RUN=1; shift ;;
        --timeout)
            [[ $# -lt 2 ]] && { error "--timeout requires a value"; exit 1; }
            TIMEOUT_SECS="$2"; shift 2 ;;
        --no-timeout)
            NO_TIMEOUT=1; shift ;;
        --no-prefetch)
            NO_PREFETCH=1; shift ;;
        --clean-cache)
            CLEAN_CACHE=1; shift ;;
        --skip-install)
            SKIP_INSTALL=1; shift ;;
        --help|-h)
            usage; exit 0 ;;
        -*)
            error "Unknown option: $1"; usage; exit 1 ;;
        *)
            if [[ -z "$VERSION" ]]; then
                VERSION="$1"; shift
            else
                error "Unexpected argument: $1"; usage; exit 1
            fi ;;
    esac
done

# ---------------------------------------------------------------------------
# Validate inputs
# ---------------------------------------------------------------------------

if [[ -z "$VERSION" ]]; then
    error "Version argument is required (e.g. 1.36.0)"
    usage; exit 1
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9._]+)?$ ]]; then
    error "Invalid version format: $VERSION (expected semver like 1.36.0)"
    exit 1
fi

if [[ -z "$ENV" ]]; then
    case "$(uname -s)" in
        Darwin) ENV="dev" ;;
        Linux)  ENV="linux-dev" ;;
        *)      ENV="dev" ;;
    esac
    log "Auto-detected environment: $ENV"
fi

case "$ENV" in
    dev|linux-dev|prod) ;;
    *) error "Unknown environment: $ENV (expected dev, linux-dev, or prod)"; exit 1 ;;
esac

# ---------------------------------------------------------------------------
# Resolve file paths & compute once-reused values
# ---------------------------------------------------------------------------

WEB_PKG_JSON="$PROJECT_ROOT/apps/web/package.json"
CONVEX_PKG_JSON="$PROJECT_ROOT/packages/convex/package.json"
CONVEX_ENV_LOCAL="$PROJECT_ROOT/packages/convex/.env.local"
PREFETCH_SCRIPT="$PROJECT_ROOT/scripts/prefetch-convex-backend.sh"
NODE_MODULES_CONVEX_PKG="$PROJECT_ROOT/node_modules/convex/package.json"
CACHE_DIR="$(cache_binaries_dir)"
BIN_NAME="$(binary_name)"

for f in "$WEB_PKG_JSON" "$CONVEX_PKG_JSON"; do
    if [[ ! -f "$f" ]]; then
        error "Missing package.json: $f"
        exit 1
    fi
done

# If the user passed a bare version like "1.36.0", prepend "^" to match
# the caret-range convention used in both package.json files.
if [[ "$VERSION" =~ ^[0-9] ]]; then
    CARET_VERSION="^${VERSION}"
else
    CARET_VERSION="$VERSION"
fi

log "Target version: $CARET_VERSION (package.json) → resolves to ≥$VERSION"

# ---------------------------------------------------------------------------
# Dry-run
# ---------------------------------------------------------------------------

if [[ "${DRY_RUN:-}" ]]; then
    CURRENT_WEB_CONVEX="$(read_json_field "$WEB_PKG_JSON" "dependencies.convex")"
    CURRENT_CONVEX_CONVEX="$(read_json_field "$CONVEX_PKG_JSON" "dependencies.convex")"

    log "=== DRY RUN — no changes will be made ==="
    log ""
    log "Steps that would be executed:"
    log "  1. Patch apps/web/package.json: convex $CURRENT_WEB_CONVEX → $CARET_VERSION"
    log "  2. Patch packages/convex/package.json: convex $CURRENT_CONVEX_CONVEX → $CARET_VERSION"
    if [[ "$ENV" != "prod" ]]; then
        if [[ ! "${SKIP_INSTALL:-}" ]]; then
            if [[ "$ENV" == "dev" ]] && has_bun; then
                log "  3. Run: bun install"
            else
                log "  3. Run: npm install"
            fi
        fi
        log "  4. Read resolved version from node_modules/convex/package.json"
        if [[ ! "${NO_PREFETCH:-}" ]]; then
            log "  5. Run: scripts/prefetch-convex-backend.sh"
        fi
        if [[ ! "${NO_TIMEOUT:-}" ]]; then
            log "  6. Write CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=$TIMEOUT_SECS to packages/convex/.env.local"
        fi
        if [[ "${CLEAN_CACHE:-}" ]]; then
            log "  7. Clean old binaries from $CACHE_DIR/ (keep new version only)"
        fi
        log "  8. Verify installed version, cached binary, timeout env var"
    else
        log "  3. Print manual prod deployment instructions (no remote changes)"
    fi
    log ""
    log "=== DRY RUN complete ==="
    exit 0
fi

# ---------------------------------------------------------------------------
# Patch package.json files
# ---------------------------------------------------------------------------

log "Patching convex → $CARET_VERSION in package.json files"
patch_convex_dep "$CARET_VERSION" "$WEB_PKG_JSON" "$CONVEX_PKG_JSON"

# ---------------------------------------------------------------------------
# Environment-specific flow
# ---------------------------------------------------------------------------

if [[ "$ENV" == "prod" ]]; then
    log ""
    log "=== Production Upgrade Instructions (SSH_HOST, defaults to ptcloud) ==="
    log ""
    log "The package.json files have been patched locally."
    log "Complete the production upgrade with these manual steps:"
    log ""
    log "  1. Commit and push the package.json changes:"
    log "     git add apps/web/package.json packages/convex/package.json package-lock.json"
    log "     git commit -m 'chore: upgrade convex to $CARET_VERSION'"
    log "     git push"
    log ""
    log "  2. Deploy to prod host:"
    log "     ssh \${SSH_HOST:-ptcloud} && cd /opt/trends && sudo make on-prod-deploy"
    log ""
    log "  3. Add startup timeout to production env config:"
    log "     # Add to /etc/trends/env:"
    log "     CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=$TIMEOUT_SECS"
    log ""
    log "  4. Restart the Convex service:"
    log "     sudo systemctl restart trends-convex.service"
    log ""
    log "  5. Verify:"
    log "     sudo systemctl status trends-convex.service"
    log "     curl -s http://127.0.0.1:3210/version"
    log ""
    exit 0
fi

# ---------------------------------------------------------------------------
# Dev / Linux-dev flow
# ---------------------------------------------------------------------------

if [[ ! "${SKIP_INSTALL:-}" ]]; then
    if [[ "$ENV" == "dev" ]] && has_bun; then
        log "Running: bun install"
        (cd "$PROJECT_ROOT" && bun install)
    else
        log "Running: npm install"
        (cd "$PROJECT_ROOT" && npm install)
    fi
else
    log "Skipping install (--skip-install)"
fi

RESOLVED_VERSION="$(read_json_field "$NODE_MODULES_CONVEX_PKG" "version")"
log "Resolved installed version: $RESOLVED_VERSION"

if [[ ! "${NO_PREFETCH:-}" ]]; then
    if [[ -x "$PREFETCH_SCRIPT" ]]; then
        log "Prefetching Convex backend binary..."
        if ! "$PREFETCH_SCRIPT"; then
            warn "Prefetch failed — backend will download on first 'make dev'"
        fi
    else
        warn "Prefetch script not found: $PREFETCH_SCRIPT"
    fi
else
    log "Skipping prefetch (--no-prefetch)"
fi

if [[ ! "${NO_TIMEOUT:-}" ]]; then
    log "Writing CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=$TIMEOUT_SECS to $CONVEX_ENV_LOCAL"
    upsert_env_var_in_file "$CONVEX_ENV_LOCAL" "CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS" "$TIMEOUT_SECS"
else
    log "Skipping timeout env var (--no-timeout)"
fi

if [[ "${CLEAN_CACHE:-}" ]]; then
    if [[ -d "$CACHE_DIR" ]]; then
        log "Cleaning old backend binaries from $CACHE_DIR (keeping $RESOLVED_VERSION)"
        find "$CACHE_DIR" -mindepth 1 -maxdepth 1 -type d | while IFS= read -r dir; do
            dirname="$(basename "$dir")"
            # Keep precompiled-* dirs — dev.sh pins --local-backend-version to them
            if [[ "$dirname" == "$RESOLVED_VERSION" ]] || [[ "$dirname" == precompiled-* ]]; then
                log "  Keeping: $dirname"
            else
                log "  Removing: $dirname"
                rm -rf "$dir"
            fi
        done
    else
        log "Cache directory does not exist: $CACHE_DIR"
    fi
fi

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------

VERIFY_OK=""

if [[ "$RESOLVED_VERSION" != "NOT_FOUND" && -n "$RESOLVED_VERSION" ]]; then
    log "Verify: node_modules/convex version=$RESOLVED_VERSION ✓"
else
    warn "Verify: could not read resolved version from node_modules"
    VERIFY_OK=1
fi

BINARY_FOUND=""
for search_dir in "$CACHE_DIR/$RESOLVED_VERSION" "$CACHE_DIR"/precompiled-*; do
    if [[ -x "$search_dir/$BIN_NAME" ]]; then
        log "Verify: cached binary at $search_dir/$BIN_NAME ✓"
        BINARY_FOUND=1
        break
    fi
done
if [[ ! "${BINARY_FOUND:-}" ]]; then
    warn "Verify: no cached binary found for version $RESOLVED_VERSION"
    VERIFY_OK=1
fi

if [[ ! "${NO_TIMEOUT:-}" ]]; then
    if grep -q "CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=$TIMEOUT_SECS" "$CONVEX_ENV_LOCAL" 2>/dev/null; then
        log "Verify: CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=$TIMEOUT_SECS in .env.local ✓"
    else
        warn "Verify: CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS not found in .env.local"
        VERIFY_OK=1
    fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

log ""
if [[ ! "${VERIFY_OK:-}" ]]; then
    log "=== Upgrade complete ==="
else
    log "=== Upgrade complete (with warnings) ==="
fi
log ""
log "  Package version:  $CARET_VERSION"
log "  Resolved version: $RESOLVED_VERSION"
log "  Environment:      $ENV"
log "  Timeout:          CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=$TIMEOUT_SECS"
log ""
log "Next steps:"
log "  1. Test: make dev"
log "  2. Commit: git add apps/web/package.json packages/convex/package.json package-lock.json"
log "             git commit -m 'chore: upgrade convex to $CARET_VERSION'"
log ""
if [[ "${VERIFY_OK:-}" ]]; then
    log "Rollback (if needed):"
    log "  git checkout -- apps/web/package.json packages/convex/package.json package-lock.json"
    log "  bun install  # or npm install"
fi
