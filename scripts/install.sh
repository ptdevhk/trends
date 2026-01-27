#!/usr/bin/env bash
#
# TrendRadar Production Install Script
# Installs TrendRadar as systemd services on Linux
#
set -euo pipefail

# Configuration
INSTALL_DIR="/opt/trendradar"
CONFIG_DIR="/etc/trendradar"
SERVICE_USER="trendradar"
SERVICE_GROUP="trendradar"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Check if running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

# Check system requirements
check_requirements() {
    log_info "Checking system requirements..."

    # Check for systemd
    if ! command -v systemctl &> /dev/null; then
        log_error "systemd is required but not found"
        exit 1
    fi

    # Check for Python 3.10+
    if ! command -v python3 &> /dev/null; then
        log_error "Python 3 is required but not found"
        exit 1
    fi

    local python_version
    python_version=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
    local major minor
    IFS='.' read -r major minor <<< "$python_version"

    if [[ $major -lt 3 ]] || [[ $major -eq 3 && $minor -lt 10 ]]; then
        log_error "Python 3.10+ is required, found $python_version"
        exit 1
    fi

    log_info "Python $python_version found"
}

# Create system user
create_user() {
    if id "$SERVICE_USER" &>/dev/null; then
        log_info "User $SERVICE_USER already exists"
    else
        log_info "Creating system user $SERVICE_USER..."
        useradd -r -s /sbin/nologin -d "$INSTALL_DIR" -c "TrendRadar Service" "$SERVICE_USER"
    fi
}

# Find source directory
find_source_dir() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    # Check if we're in the scripts directory
    if [[ -f "$script_dir/../trendradar/__main__.py" ]]; then
        echo "$(cd "$script_dir/.." && pwd)"
    elif [[ -f "$script_dir/trendradar/__main__.py" ]]; then
        echo "$script_dir"
    else
        log_error "Cannot find TrendRadar source directory"
        exit 1
    fi
}

# Install application files
install_app() {
    local source_dir="$1"

    log_info "Installing application to $INSTALL_DIR..."

    # Create install directory
    mkdir -p "$INSTALL_DIR"

    # Copy application files
    cp -r "$source_dir/trendradar" "$INSTALL_DIR/"
    cp -r "$source_dir/mcp_server" "$INSTALL_DIR/"
    cp -r "$source_dir/config" "$INSTALL_DIR/"
    cp "$source_dir/requirements.txt" "$INSTALL_DIR/"
    cp "$source_dir/pyproject.toml" "$INSTALL_DIR/" 2>/dev/null || true

    # Create output directory
    mkdir -p "$INSTALL_DIR/output"

    # Set ownership
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_DIR"
}

# Create virtual environment and install dependencies
setup_venv() {
    log_info "Setting up Python virtual environment..."

    cd "$INSTALL_DIR"

    # Create venv if it doesn't exist
    if [[ ! -d ".venv" ]]; then
        sudo -u "$SERVICE_USER" python3 -m venv .venv
    fi

    # Install dependencies
    sudo -u "$SERVICE_USER" .venv/bin/pip install --upgrade pip
    sudo -u "$SERVICE_USER" .venv/bin/pip install -r requirements.txt

    log_info "Dependencies installed"
}

# Setup configuration
setup_config() {
    log_info "Setting up configuration..."

    mkdir -p "$CONFIG_DIR"

    # Create env file from example if it doesn't exist
    if [[ ! -f "$CONFIG_DIR/env" ]]; then
        local source_dir="$1"
        if [[ -f "$source_dir/.env.example" ]]; then
            cp "$source_dir/.env.example" "$CONFIG_DIR/env"
        else
            # Create minimal env file
            cat > "$CONFIG_DIR/env" << 'EOF'
# TrendRadar Environment Configuration
# See documentation for full list of options

# Notification channels (configure at least one)
# FEISHU_WEBHOOK_URL=
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=

# AI configuration (optional)
# AI_ANALYSIS_ENABLED=false
# AI_API_KEY=
# AI_MODEL=deepseek/deepseek-chat

# Remote storage (optional)
# S3_ENDPOINT_URL=
# S3_BUCKET_NAME=
# S3_ACCESS_KEY_ID=
# S3_SECRET_ACCESS_KEY=
EOF
        fi
        log_warn "Created $CONFIG_DIR/env - please edit to configure"
    else
        log_info "Configuration file already exists"
    fi

    # Secure the env file
    chmod 600 "$CONFIG_DIR/env"
    chown "$SERVICE_USER:$SERVICE_GROUP" "$CONFIG_DIR/env"
}

# Install systemd units
install_systemd() {
    local source_dir="$1"

    log_info "Installing systemd units..."

    cp "$source_dir/deploy/systemd/trendradar.service" /etc/systemd/system/
    cp "$source_dir/deploy/systemd/trendradar.timer" /etc/systemd/system/
    cp "$source_dir/deploy/systemd/trendradar-mcp.service" /etc/systemd/system/

    systemctl daemon-reload

    log_info "Systemd units installed"
}

# Enable and start services
start_services() {
    log_info "Enabling services..."

    # Enable timer for crawler
    systemctl enable trendradar.timer

    echo ""
    log_info "Installation complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Edit configuration: sudo nano $CONFIG_DIR/env"
    echo "  2. Start crawler timer: sudo systemctl start trendradar.timer"
    echo "  3. (Optional) Start MCP: sudo systemctl enable --now trendradar-mcp"
    echo ""
    echo "Useful commands:"
    echo "  - Run crawler now:     sudo systemctl start trendradar"
    echo "  - View crawler logs:   journalctl -u trendradar -f"
    echo "  - View MCP logs:       journalctl -u trendradar-mcp -f"
    echo "  - Check timer status:  systemctl list-timers trendradar.timer"
}

# Uninstall function
uninstall() {
    log_info "Uninstalling TrendRadar..."

    # Stop and disable services
    systemctl stop trendradar.timer trendradar-mcp 2>/dev/null || true
    systemctl disable trendradar.timer trendradar-mcp 2>/dev/null || true

    # Remove systemd units
    rm -f /etc/systemd/system/trendradar.service
    rm -f /etc/systemd/system/trendradar.timer
    rm -f /etc/systemd/system/trendradar-mcp.service
    systemctl daemon-reload

    log_info "Systemd units removed"
    log_warn "Application files at $INSTALL_DIR were NOT removed"
    log_warn "Configuration at $CONFIG_DIR was NOT removed"
    log_warn "User $SERVICE_USER was NOT removed"
    echo ""
    echo "To fully remove, run:"
    echo "  sudo rm -rf $INSTALL_DIR"
    echo "  sudo rm -rf $CONFIG_DIR"
    echo "  sudo userdel $SERVICE_USER"
}

# Main
main() {
    case "${1:-install}" in
        install)
            check_root
            check_requirements

            local source_dir
            source_dir="$(find_source_dir)"
            log_info "Source directory: $source_dir"

            create_user
            install_app "$source_dir"
            setup_venv
            setup_config "$source_dir"
            install_systemd "$source_dir"
            start_services
            ;;
        uninstall)
            check_root
            uninstall
            ;;
        *)
            echo "Usage: $0 [install|uninstall]"
            exit 1
            ;;
    esac
}

main "$@"
