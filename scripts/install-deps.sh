#!/bin/bash
# install-deps.sh - Install all project dependencies
# Usage: ./scripts/install-deps.sh [--python-only] [--node-only]
#
# Installs:
#   - Python dependencies via uv
#   - Node.js dependencies via bun (if available) or npm (fallback)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Parse arguments
PYTHON_ONLY=false
NODE_ONLY=false

for arg in "$@"; do
    case $arg in
        --python-only)
            PYTHON_ONLY=true
            shift
            ;;
        --node-only)
            NODE_ONLY=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--python-only] [--node-only]"
            echo ""
            echo "Options:"
            echo "  --python-only  Install only Python dependencies"
            echo "  --node-only    Install only Node.js dependencies"
            echo "  --help, -h     Show this help message"
            exit 0
            ;;
    esac
done

cd "$PROJECT_ROOT"

# =============================================================================
# Python Dependencies
# =============================================================================
install_python_deps() {
    log_info "Installing Python dependencies..."

    if ! command -v uv &> /dev/null; then
        log_error "uv is not installed. Install it from: https://docs.astral.sh/uv/getting-started/installation/"
        exit 1
    fi

    uv sync
    log_info "Python dependencies installed successfully"
}

# =============================================================================
# Node.js Dependencies
# =============================================================================
install_node_deps() {
    # Check if package.json exists
    if [[ ! -f "package.json" ]]; then
        log_info "No package.json found, skipping Node.js dependencies"
        return 0
    fi

    log_info "Installing Node.js dependencies..."

    # Prefer bun if available, fallback to npm
    if command -v bun &> /dev/null; then
        log_info "Using bun for faster installation..."
        bun install
    elif command -v npm &> /dev/null; then
        log_info "Using npm..."
        npm install
    else
        log_warn "Neither bun nor npm found. Skipping Node.js dependencies."
        log_warn "Install Node.js from: https://nodejs.org/"
        return 0
    fi

    log_info "Node.js dependencies installed successfully"
}

# =============================================================================
# Main
# =============================================================================
main() {
    log_info "Installing dependencies for TrendRadar..."
    echo ""

    if [[ "$NODE_ONLY" == "false" ]]; then
        install_python_deps
        echo ""
    fi

    if [[ "$PYTHON_ONLY" == "false" ]]; then
        install_node_deps
        echo ""
    fi

    log_info "All dependencies installed successfully!"
    echo ""
    echo "Next steps:"
    echo "  1. Set up secrets: cp .env.example ~/.secrets/com.trends.app.env"
    echo "  2. Edit secrets: \$EDITOR ~/.secrets/com.trends.app.env"
    echo "  3. Start development: make dev"
}

main
