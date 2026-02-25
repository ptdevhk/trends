#!/usr/bin/env bash
#
# Trends Production Install Script
# Installs the full Trends stack as systemd services on Ubuntu.
#
set -euo pipefail

INSTALL_DIR="/opt/trends"
CONFIG_DIR="/etc/trends"
SYSTEMD_DIR="/etc/systemd/system"
SERVICE_USER="trends"
SERVICE_GROUP="trends"

SERVICES=(
    "trends-api.service"
    "trends-worker.service"
    "trends-worker-api.service"
    "trends-mcp.service"
    "trends-crawler.service"
)
TIMER="trends-crawler.timer"
LEGACY_UNITS=(
    "trendradar.service"
    "trendradar.timer"
    "trendradar-mcp.service"
)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

APT_UPDATED=0

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)."
        exit 1
    fi
}

check_systemd() {
    if ! command -v systemctl >/dev/null 2>&1; then
        log_error "systemd is required but not found."
        exit 1
    fi
}

require_apt() {
    if ! command -v apt-get >/dev/null 2>&1; then
        log_error "apt-get is required. This installer currently supports Ubuntu/Debian systems."
        exit 1
    fi
}

apt_install() {
    local packages=("$@")
    if [[ ${#packages[@]} -eq 0 ]]; then
        return
    fi
    if [[ "$APT_UPDATED" -eq 0 ]]; then
        apt-get update
        APT_UPDATED=1
    fi
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${packages[@]}"
}

ensure_base_dependencies() {
    require_apt
    apt_install ca-certificates curl git gnupg
}

ensure_node_22() {
    local node_major=""
    if command -v node >/dev/null 2>&1; then
        node_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
    fi

    if [[ "$node_major" == "22" ]]; then
        log_info "Node.js $(node -v) already installed."
        return
    fi

    log_info "Installing Node.js 22 (NodeSource)..."
    ensure_base_dependencies
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get update
    APT_UPDATED=1
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs

    node_major="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
    if [[ "$node_major" != "22" ]]; then
        log_error "Expected Node.js 22, found $(node -v)."
        exit 1
    fi
    log_info "Installed Node.js $(node -v)."
}

ensure_uv() {
    if command -v uv >/dev/null 2>&1; then
        log_info "uv already installed: $(uv --version)"
        return
    fi

    log_info "Installing uv..."
    ensure_base_dependencies
    curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

    if ! command -v uv >/dev/null 2>&1; then
        log_error "uv installation failed."
        exit 1
    fi
    log_info "Installed uv: $(uv --version)"
}

run_as_service_user() {
    local cmd="$1"
    if command -v sudo >/dev/null 2>&1; then
        sudo -u "$SERVICE_USER" bash -lc "$cmd"
    else
        runuser -u "$SERVICE_USER" -- bash -lc "$cmd"
    fi
}

create_service_user() {
    if id "$SERVICE_USER" >/dev/null 2>&1; then
        log_info "User $SERVICE_USER already exists."
        usermod -d "$INSTALL_DIR" -s /bin/bash "$SERVICE_USER" >/dev/null 2>&1 || true
        return
    fi

    log_info "Creating system user $SERVICE_USER..."
    useradd --system --home-dir "$INSTALL_DIR" --shell /bin/bash --user-group "$SERVICE_USER"
}

resolve_repo_url() {
    if [[ -n "${REPO_URL:-}" ]]; then
        echo "$REPO_URL"
        return
    fi

    local script_dir source_root remote_url
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    source_root="$(cd "$script_dir/.." && pwd)"

    if git -C "$source_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        remote_url="$(git -C "$source_root" config --get remote.origin.url || true)"
        if [[ -n "$remote_url" ]]; then
            echo "$remote_url"
            return
        fi
    fi

    log_error "Unable to determine repository URL. Set REPO_URL explicitly, e.g. REPO_URL=https://github.com/ptdevhk/trends.git"
    exit 1
}

clone_or_update_repo() {
    mkdir -p "$INSTALL_DIR"
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"

    if [[ -d "$INSTALL_DIR/.git" ]]; then
        log_info "Repository already exists at $INSTALL_DIR, pulling latest changes..."
        run_as_service_user "cd '$INSTALL_DIR' && git pull --ff-only"
        return
    fi

    if [[ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
        log_error "$INSTALL_DIR exists and is not an initialized git repository. Clean it or clone manually first."
        exit 1
    fi

    local repo_url
    repo_url="$(resolve_repo_url)"
    log_info "Cloning repository into $INSTALL_DIR from $repo_url..."
    run_as_service_user "git clone '$repo_url' '$INSTALL_DIR'"
}

sync_dependencies() {
    log_info "Syncing Python dependencies with uv..."
    run_as_service_user "cd '$INSTALL_DIR' && uv sync"

    log_info "Installing Node dependencies..."
    run_as_service_user "cd '$INSTALL_DIR' && npm install"
}

build_artifacts() {
    log_info "Building @trends/shared..."
    run_as_service_user "cd '$INSTALL_DIR' && npm run --workspace @trends/shared build"

    log_info "Building @trends/api..."
    run_as_service_user "cd '$INSTALL_DIR' && npm run --workspace @trends/api build"

    log_info "Generating @trends/web API types..."
    run_as_service_user "cd '$INSTALL_DIR' && npm --workspace @trends/web run gen:api"

    log_info "Building @trends/web..."
    run_as_service_user "cd '$INSTALL_DIR' && npm run --workspace @trends/web build"
}

setup_env_file() {
    mkdir -p "$CONFIG_DIR"

    if [[ ! -f "$CONFIG_DIR/env" ]]; then
        if [[ -f "$INSTALL_DIR/deploy/env.production" ]]; then
            cp "$INSTALL_DIR/deploy/env.production" "$CONFIG_DIR/env"
            log_warn "Created $CONFIG_DIR/env from deploy/env.production. Please review values."
        elif [[ -f "$INSTALL_DIR/.env.example" ]]; then
            cp "$INSTALL_DIR/.env.example" "$CONFIG_DIR/env"
            log_warn "Created $CONFIG_DIR/env from .env.example. Please review values."
        else
            cat > "$CONFIG_DIR/env" << 'EOF'
# Trends production environment
DEBUG=false
TIMEZONE=Asia/Hong_Kong
TZ=Asia/Hong_Kong
EOF
            log_warn "Created minimal $CONFIG_DIR/env. Please configure required variables."
        fi
    else
        log_info "$CONFIG_DIR/env already exists; keeping existing configuration."
    fi

    chmod 600 "$CONFIG_DIR/env"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$CONFIG_DIR/env"
}

remove_legacy_units() {
    log_info "Removing legacy trendradar unit files (if present)..."
    local unit
    for unit in "${LEGACY_UNITS[@]}"; do
        systemctl stop "$unit" 2>/dev/null || true
        systemctl disable "$unit" 2>/dev/null || true
        rm -f "$SYSTEMD_DIR/$unit"
    done
}

install_systemd_units() {
    local source_dir="$INSTALL_DIR/deploy/systemd"
    local unit

    log_info "Installing trends systemd unit files..."
    for unit in "${SERVICES[@]}" "$TIMER"; do
        if [[ ! -f "$source_dir/$unit" ]]; then
            log_error "Missing unit file: $source_dir/$unit"
            exit 1
        fi
        cp "$source_dir/$unit" "$SYSTEMD_DIR/$unit"
    done
}

enable_units() {
    log_info "Reloading systemd daemon..."
    systemctl daemon-reload

    log_info "Enabling trends services and timer..."
    local unit
    for unit in "${SERVICES[@]}" "$TIMER"; do
        systemctl enable "$unit"
    done
}

restart_units() {
    log_info "Reloading systemd daemon..."
    systemctl daemon-reload

    log_info "Restarting trends services..."
    systemctl restart trends-api.service trends-worker.service trends-worker-api.service trends-mcp.service
    systemctl restart trends-crawler.timer
}

stop_port_processes() {
    local port="$1"
    local pids pid
    pids="$(ss -ltnp "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"

    if [[ -z "$pids" ]]; then
        return
    fi

    log_warn "Stopping existing process(es) on port $port: $pids"
    for pid in $pids; do
        kill "$pid" 2>/dev/null || true
    done

    sleep 2
    for pid in $pids; do
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null || true
        fi
    done
}

print_caddy_block() {
    cat << 'EOF'

Recommended Caddyfile block:

trends.pt-mes.com {
    tls leotse@datadigitalisation.com
    encode gzip

    # React SPA — production build served as static files
    root * /opt/trends/apps/web/dist
    try_files {path} /index.html
    file_server

    # BFF API — Hono on port 3000
    handle /api/* {
        reverse_proxy 127.0.0.1:3000
    }

    # MCP HTTP — optional, for AI clients
    handle /mcp/* {
        reverse_proxy 127.0.0.1:3333
    }
}
EOF
}

install_flow() {
    check_root
    check_systemd
    ensure_base_dependencies
    ensure_node_22
    ensure_uv
    create_service_user
    clone_or_update_repo
    sync_dependencies
    build_artifacts
    setup_env_file
    stop_port_processes 3000
    remove_legacy_units
    install_systemd_units
    enable_units

    echo ""
    log_info "Installation completed."
    echo ""
    echo "Next steps:"
    echo "  1. Edit env file: sudo nano $CONFIG_DIR/env"
    echo "  2. Add/update Caddy site block: sudo nano /etc/caddy/Caddyfile"
    echo "  3. Reload Caddy: sudo systemctl reload caddy"
    echo "  4. Start services:"
    echo "     sudo systemctl start trends-api trends-worker trends-worker-api trends-mcp trends-crawler.timer"
    echo "  5. Verify:"
    echo "     systemctl status trends-api trends-worker trends-worker-api trends-mcp trends-crawler.timer"
    echo "     curl -s http://127.0.0.1:3000/api/health"
    echo "     curl -s https://trends.pt-mes.com/"
    print_caddy_block
}

upgrade_flow() {
    check_root
    check_systemd
    ensure_base_dependencies
    ensure_node_22
    ensure_uv

    if [[ ! -d "$INSTALL_DIR/.git" ]]; then
        log_error "$INSTALL_DIR is not a git repository. Run install first."
        exit 1
    fi

    create_service_user
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
    log_info "Pulling latest code..."
    run_as_service_user "cd '$INSTALL_DIR' && git pull --ff-only"

    sync_dependencies
    build_artifacts
    stop_port_processes 3000
    remove_legacy_units
    install_systemd_units
    restart_units

    echo ""
    log_info "Upgrade completed. Services restarted."
    echo "Check status with:"
    echo "  systemctl status trends-api trends-worker trends-worker-api trends-mcp trends-crawler.timer"
}

uninstall_flow() {
    check_root
    check_systemd

    log_info "Stopping and disabling trends services..."
    systemctl stop trends-api.service trends-worker.service trends-worker-api.service trends-mcp.service trends-crawler.timer trends-crawler.service 2>/dev/null || true
    systemctl disable trends-api.service trends-worker.service trends-worker-api.service trends-mcp.service trends-crawler.timer trends-crawler.service 2>/dev/null || true

    remove_legacy_units

    log_info "Removing trends unit files..."
    local unit
    for unit in "${SERVICES[@]}" "$TIMER"; do
        rm -f "$SYSTEMD_DIR/$unit"
    done
    systemctl daemon-reload

    log_info "Uninstall complete."
    log_warn "Application files at $INSTALL_DIR were NOT removed."
    log_warn "Configuration at $CONFIG_DIR was NOT removed."
    log_warn "User $SERVICE_USER was NOT removed."
    echo ""
    echo "To fully remove manually:"
    echo "  sudo rm -rf $INSTALL_DIR"
    echo "  sudo rm -rf $CONFIG_DIR"
    echo "  sudo userdel $SERVICE_USER"
}

main() {
    case "${1:-install}" in
        install)
            install_flow
            ;;
        upgrade)
            upgrade_flow
            ;;
        uninstall)
            uninstall_flow
            ;;
        *)
            echo "Usage: $0 [install|upgrade|uninstall]"
            exit 1
            ;;
    esac
}

main "$@"
