#!/bin/bash
set -e

APT_UPDATED=0

usage() {
    echo "Usage: $0 [--help]"
    echo "Installs local Python/Node dependencies, ensures the Go CLI toolchain, builds bin/trends, and bootstraps repo/local skill artifacts."
    echo ""
    echo "Repo-managed skills are synced into .agents/skills + .claude/skills."
    echo "Configured external global skills are installed with 'npx skills add -g' using direct skill URLs."
    echo "Configured URLs live in config/skills/install.yaml."
    echo ""
    echo "Environment:"
    echo "  CONVEX_MIRROR_MODE     Convex prefetch mode override: off|fallback|mirror-first"
    echo "                         Default is fallback, or off when CI=true/1"
    echo "  CONVEX_MIRROR_BASES    Convex prefetch mirror base URLs (comma-separated)"
    echo "  CONVEX_DOWNLOAD_TIMEOUT_SECS / CONVEX_CONNECT_TIMEOUT_SECS"
    echo "                         Convex prefetch timeout overrides"
    echo "  CONVEX_CURL_NO_SILENT  When true/1, keep Convex prefetch curl progress output enabled"
    echo "  CI                     When true/1, shared Convex prefetch mode defaults to off, uses npm, and skips governance sync"
    echo ""
    echo "See ./scripts/prefetch-convex-backend.sh --help for the full Convex prefetch env contract."
}

log_info() {
    echo "[INFO] $*"
}

log_error() {
    echo "[ERROR] $*" >&2
}

if [ "$#" -gt 0 ]; then
    case "$1" in
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
fi

resolve_convex_mirror_mode() {
    local mode="${CONVEX_MIRROR_MODE:-}"
    if [ -z "${mode}" ]; then
        if is_ci_env; then
            echo "off"
            return
        fi
        echo "fallback"
        return
    fi
    case "${mode}" in
        off|fallback|mirror-first)
            echo "${mode}"
            ;;
        *)
            echo "Invalid CONVEX_MIRROR_MODE: ${mode}" >&2
            echo "Expected one of: off, fallback, mirror-first" >&2
            exit 1
            ;;
    esac
}

is_ci_env() {
    [ "${CI:-}" = "true" ] || [ "${CI:-}" = "1" ]
}

run_with_sudo_if_needed() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
        return
    fi

    if command -v sudo >/dev/null 2>&1; then
        sudo "$@"
        return
    fi

    log_error "Need elevated privileges to install Go system-wide. Re-run with sudo available, or install Go manually."
    exit 1
}

apt_install() {
    if ! command -v apt-get >/dev/null 2>&1; then
        log_error "apt-get not found and required system packages are missing."
        exit 1
    fi

    if [ "$APT_UPDATED" -eq 0 ]; then
        run_with_sudo_if_needed apt-get update
        APT_UPDATED=1
    fi

    run_with_sudo_if_needed env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}

ensure_download_tools() {
    if command -v curl >/dev/null 2>&1 && command -v tar >/dev/null 2>&1; then
        return
    fi

    log_info "Installing system download tools required for Go bootstrap..."
    apt_install ca-certificates curl tar
}

os_release_value() {
    local key="$1"

    if [ ! -f /etc/os-release ]; then
        return 1
    fi

    awk -F= -v key="$key" '$1 == key { gsub(/"/, "", $2); print $2; exit }' /etc/os-release
}

is_supported_ubuntu_go_host() {
    local distro_id=""
    local version_id=""

    distro_id="$(os_release_value ID 2>/dev/null || true)"
    version_id="$(os_release_value VERSION_ID 2>/dev/null || true)"

    if [ "$distro_id" != "ubuntu" ]; then
        return 1
    fi

    case "$version_id" in
        18.04|20.04|22.04|24.04)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

resolve_required_go_version() {
    local version=""

    version="$(awk '$1 == "go" { print $2; exit }' packages/cli/go.mod)"
    if [ -z "$version" ]; then
        log_error "Unable to determine required Go version from packages/cli/go.mod."
        exit 1
    fi

    echo "$version"
}

detect_go_version() {
    local version=""

    if ! command -v go >/dev/null 2>&1; then
        return 1
    fi

    version="$(go env GOVERSION 2>/dev/null || true)"
    version="${version#go}"
    if [ -z "$version" ]; then
        version="$(go version 2>/dev/null | awk '{print $3}' | sed 's/^go//')"
    fi
    if [ -z "$version" ]; then
        return 1
    fi

    echo "$version"
}

version_to_sort_key() {
    local version="$1"
    local major="0"
    local minor="0"
    local patch="0"

    IFS=. read -r major minor patch <<EOF
$version
EOF

    printf "%03d%03d%03d\n" "${major:-0}" "${minor:-0}" "${patch:-0}"
}

version_gte() {
    [ "$(version_to_sort_key "$1")" -ge "$(version_to_sort_key "$2")" ]
}

resolve_go_platform() {
    local go_os=""
    local go_arch=""

    case "$(uname -s)" in
        Linux)
            go_os="linux"
            ;;
        Darwin)
            go_os="darwin"
            ;;
        *)
            log_error "Unsupported OS for automatic Go installation: $(uname -s)"
            exit 1
            ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64)
            go_arch="amd64"
            ;;
        arm64|aarch64)
            go_arch="arm64"
            ;;
        *)
            log_error "Unsupported architecture for automatic Go installation: $(uname -m)"
            exit 1
            ;;
    esac

    echo "$go_os $go_arch"
}

install_go_from_tarball() {
    local version="$1"
    local go_os=""
    local go_arch=""
    local archive_name=""
    local download_url=""
    local temp_dir=""

    read -r go_os go_arch <<EOF
$(resolve_go_platform)
EOF

    archive_name="go${version}.${go_os}-${go_arch}.tar.gz"
    download_url="https://go.dev/dl/${archive_name}"
    temp_dir="$(mktemp -d)"

    log_info "Downloading Go ${version} from ${download_url}..."
    curl -fsSL "$download_url" -o "${temp_dir}/${archive_name}"

    log_info "Installing Go ${version} to /usr/local/go..."
    run_with_sudo_if_needed rm -rf /usr/local/go
    run_with_sudo_if_needed tar -C /usr/local -xzf "${temp_dir}/${archive_name}"
    run_with_sudo_if_needed ln -sf /usr/local/go/bin/go /usr/local/bin/go
    run_with_sudo_if_needed ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt

    export PATH="/usr/local/go/bin:/usr/local/bin:$PATH"
    hash -r
    rm -rf "$temp_dir"
}

install_go_from_ubuntu_apt() {
    log_info "Installing Go from the Ubuntu longsleep/golang-backports PPA..."
    apt_install software-properties-common
    run_with_sudo_if_needed add-apt-repository -y ppa:longsleep/golang-backports
    APT_UPDATED=0
    apt_install golang-go
    if [ -e /usr/local/bin/go ] || [ -L /usr/local/bin/gofmt ] || [ -d /usr/local/go ]; then
        run_with_sudo_if_needed rm -f /usr/local/bin/go /usr/local/bin/gofmt
        run_with_sudo_if_needed rm -rf /usr/local/go
    fi
    export PATH="/usr/bin:$PATH"
    hash -r
}

ensure_go() {
    local required_version=""
    local current_version=""
    local host_os=""

    required_version="$(resolve_required_go_version)"
    current_version="$(detect_go_version || true)"

    if [ -n "$current_version" ] && version_gte "$current_version" "$required_version"; then
        log_info "Go ${current_version} already satisfies packages/cli/go.mod (required: ${required_version})."
        return
    fi

    host_os="$(uname -s)"
    if [ -n "$current_version" ]; then
        log_info "Go ${current_version} is older than required ${required_version}; installing a newer toolchain..."
    else
        log_info "Go not found; installing required toolchain ${required_version}..."
    fi

    if [ "$host_os" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
        brew upgrade go >/dev/null 2>&1 || brew install go
        hash -r
    elif [ "$host_os" = "Linux" ] && is_supported_ubuntu_go_host; then
        install_go_from_ubuntu_apt
    else
        ensure_download_tools
        install_go_from_tarball "$required_version"
    fi

    current_version="$(detect_go_version || true)"
    if [ -z "$current_version" ] || ! version_gte "$current_version" "$required_version"; then
        log_error "Go installation failed. Expected >= ${required_version}, found ${current_version:-missing}."
        exit 1
    fi

    log_info "Using Go ${current_version}."
}

run_tsx() {
    local script_path="$1"
    shift

    if command -v bun > /dev/null 2>&1; then
        bunx tsx "$script_path" "$@"
        return
    fi

    npx tsx "$script_path" "$@"
}

EFFECTIVE_CONVEX_MIRROR_MODE=""
if ! is_ci_env; then
    EFFECTIVE_CONVEX_MIRROR_MODE="$(resolve_convex_mirror_mode)"
fi

echo "Installing Python dependencies..."
uv sync

# Verify critical Python imports; reinstall if corrupted (e.g. fastmcp-slim missing modules)
if ! "$PROJECT_ROOT/.venv/bin/python" -c "from fastmcp import FastMCP; from litellm import completion" 2>/dev/null; then
    echo "Python environment corrupted — reinstalling..."
    uv sync --reinstall-package fastmcp --reinstall-package litellm
fi

echo "Installing Node.js dependencies..."
if is_ci_env; then
    npm install
elif command -v bun &> /dev/null; then
    if ! bun install; then
        echo "Warning: bun install failed, falling back to npm install..."
        npm install
    fi
else
    npm install
fi

echo "Ensuring Go toolchain for the Trends CLI..."
ensure_go

echo "Building Trends CLI..."
make cli-build

# Build workspace packages that require compilation before use
echo "Building browser extension content script..."
if [ -d "apps/browser-extension" ] && [ -f "apps/browser-extension/esbuild.config.mjs" ]; then
    if is_ci_env; then
        npm --workspace @trends/browser-extension run build
    elif command -v bun &> /dev/null; then
        bun run --cwd apps/browser-extension build
    else
        npm --workspace @trends/browser-extension run build
    fi
fi

if [ -d "packages/convex" ]; then
    if [ -z "${EFFECTIVE_CONVEX_MIRROR_MODE}" ]; then
        EFFECTIVE_CONVEX_MIRROR_MODE="$(resolve_convex_mirror_mode)"
    fi
    echo "Prefetching Convex local backend and dashboard assets (mirror mode: ${EFFECTIVE_CONVEX_MIRROR_MODE})..."
    SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    "$SCRIPTS_DIR/prefetch-convex-backend.sh" || echo "Warning: Convex prefetch failed (non-fatal)"
fi

# Skill bootstrap (non-CI only)
#   1. Agent governance policy sync
#   2. Project skills — rsync repo skills into .agents/skills + .claude/skills (repo-local only, never global)
#   3. External global skills — install from config/skills/install.yaml global: section via npx skills add -g
if ! is_ci_env; then
	echo "Bootstrapping skills..."
	SKILL_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
	run_tsx "$SKILL_SCRIPT_DIR/agent-governance/sync-policy.ts" || echo "Warning: Agent policy sync failed (non-fatal)"
	"$SKILL_SCRIPT_DIR/skills/sync-project-skills.sh" || echo "Warning: Project skill sync failed (non-fatal)"
	run_tsx "$SKILL_SCRIPT_DIR/skills/install-global-skills.ts" || echo "Warning: Global skill install failed (non-fatal)"
else
	echo "Skipping skill bootstrap in CI"
fi

echo "Done!"
