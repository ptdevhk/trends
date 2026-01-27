#!/bin/bash
# install.sh - Production installation script for TrendRadar
# Usage: ./scripts/install.sh [--production] [--user USER] [--dir DIR]
#
# Options:
#   --production  Full production setup with systemd services
#   --user USER   System user for running services (default: trendradar)
#   --dir DIR     Installation directory (default: /opt/trendradar)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Default values
PRODUCTION=false
SERVICE_USER="trendradar"
INSTALL_DIR="/opt/trendradar"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --production)
            PRODUCTION=true
            shift
            ;;
        --user)
            SERVICE_USER="$2"
            shift 2
            ;;
        --dir)
            INSTALL_DIR="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--production] [--user USER] [--dir DIR]"
            echo ""
            echo "Options:"
            echo "  --production  Full production setup with systemd services"
            echo "  --user USER   System user for running services (default: trendradar)"
            echo "  --dir DIR     Installation directory (default: /opt/trendradar)"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# =============================================================================
# Prerequisite Checks
# =============================================================================
check_prerequisites() {
    log_step "Checking prerequisites..."

    # Check if running as root (required for production)
    if [[ "$PRODUCTION" == "true" ]] && [[ $EUID -ne 0 ]]; then
        log_error "Production installation requires root privileges. Run with sudo."
        exit 1
    fi

    # Check for uv
    if ! command -v uv &> /dev/null; then
        log_error "uv is not installed."
        log_info "Install uv: curl -LsSf https://astral.sh/uv/install.sh | sh"
        exit 1
    fi

    # Check for systemctl (Linux only)
    if [[ "$PRODUCTION" == "true" ]] && ! command -v systemctl &> /dev/null; then
        log_error "systemctl not found. This script requires systemd."
        exit 1
    fi

    log_info "All prerequisites met"
}

# =============================================================================
# Development Installation
# =============================================================================
install_dev() {
    log_step "Installing for development..."

    cd "$PROJECT_ROOT"

    # Install Python dependencies
    log_info "Installing Python dependencies..."
    uv sync

    # Check for Node.js dependencies
    if [[ -f "package.json" ]]; then
        log_info "Installing Node.js dependencies..."
        if command -v bun &> /dev/null; then
            bun install
        elif command -v npm &> /dev/null; then
            npm install
        fi
    fi

    log_info "Development installation complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Set up secrets: cp .env.example ~/.secrets/com.trends.app.env"
    echo "  2. Edit secrets: \$EDITOR ~/.secrets/com.trends.app.env"
    echo "  3. Allow direnv: direnv allow"
    echo "  4. Start development: make dev"
}

# =============================================================================
# Production Installation
# =============================================================================
install_production() {
    log_step "Installing for production..."

    # Create service user
    log_info "Creating service user: $SERVICE_USER"
    if ! id "$SERVICE_USER" &>/dev/null; then
        useradd -r -s /bin/false -d "$INSTALL_DIR" "$SERVICE_USER"
    else
        log_warn "User $SERVICE_USER already exists"
    fi

    # Create installation directory
    log_info "Creating installation directory: $INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"

    # Copy project files
    log_info "Copying project files..."
    rsync -a --exclude='.git' --exclude='output' --exclude='.venv' \
          --exclude='node_modules' --exclude='__pycache__' \
          "$PROJECT_ROOT/" "$INSTALL_DIR/"

    # Create output directory
    mkdir -p "$INSTALL_DIR/output"

    # Set ownership
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

    # Install Python dependencies
    log_info "Installing Python dependencies..."
    cd "$INSTALL_DIR"
    sudo -u "$SERVICE_USER" uv sync

    # Create production environment file
    if [[ ! -f "$INSTALL_DIR/.env.production" ]]; then
        log_info "Creating environment file..."
        cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env.production"
        chmod 600 "$INSTALL_DIR/.env.production"
        chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env.production"
        log_warn "Edit $INSTALL_DIR/.env.production with your secrets!"
    fi

    # Install systemd services
    log_info "Installing systemd services..."
    cp "$INSTALL_DIR/deploy/systemd/trendradar.service" /etc/systemd/system/
    cp "$INSTALL_DIR/deploy/systemd/trendradar.timer" /etc/systemd/system/
    cp "$INSTALL_DIR/deploy/systemd/trendradar-mcp.service" /etc/systemd/system/

    # Update service files with correct paths and user
    sed -i "s|/opt/trendradar|$INSTALL_DIR|g" /etc/systemd/system/trendradar.service
    sed -i "s|User=trendradar|User=$SERVICE_USER|g" /etc/systemd/system/trendradar.service
    sed -i "s|Group=trendradar|Group=$SERVICE_USER|g" /etc/systemd/system/trendradar.service

    sed -i "s|/opt/trendradar|$INSTALL_DIR|g" /etc/systemd/system/trendradar-mcp.service
    sed -i "s|User=trendradar|User=$SERVICE_USER|g" /etc/systemd/system/trendradar-mcp.service
    sed -i "s|Group=trendradar|Group=$SERVICE_USER|g" /etc/systemd/system/trendradar-mcp.service

    # Reload systemd
    systemctl daemon-reload

    log_info "Production installation complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Edit secrets: sudo nano $INSTALL_DIR/.env.production"
    echo "  2. Enable services:"
    echo "     sudo systemctl enable trendradar.timer"
    echo "     sudo systemctl enable trendradar-mcp"
    echo "  3. Start services:"
    echo "     sudo systemctl start trendradar.timer"
    echo "     sudo systemctl start trendradar-mcp"
    echo "  4. Check status:"
    echo "     sudo systemctl status trendradar.timer"
    echo "     sudo systemctl status trendradar-mcp"
}

# =============================================================================
# Main
# =============================================================================
main() {
    echo ""
    echo "TrendRadar Installation"
    echo "======================="
    echo ""

    check_prerequisites

    if [[ "$PRODUCTION" == "true" ]]; then
        install_production
    else
        install_dev
    fi
}

main
