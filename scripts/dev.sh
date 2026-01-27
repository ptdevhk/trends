#!/bin/bash
# dev.sh - Start all development services natively (no Docker required)
# Usage: ./scripts/dev.sh [crawler|mcp|all]
#
# Services:
#   crawler - Main news crawler/analyzer
#   mcp     - MCP server (HTTP mode on port 3333)
#   all     - Both services (default)

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

log_service() {
    echo -e "${BLUE}[$1]${NC} $2"
}

# Parse arguments
SERVICE="${1:-all}"
MCP_PORT="${MCP_PORT:-3333}"

cd "$PROJECT_ROOT"

# =============================================================================
# Environment Check
# =============================================================================
check_environment() {
    log_info "Checking environment..."

    # Check uv
    if ! command -v uv &> /dev/null; then
        log_error "uv is not installed. Run: curl -LsSf https://astral.sh/uv/install.sh | sh"
        exit 1
    fi

    # Check Python dependencies
    if [[ ! -d ".venv" ]] && [[ ! -f "uv.lock" ]]; then
        log_warn "Dependencies not installed. Running install-deps.sh..."
        "$SCRIPT_DIR/install-deps.sh" --python-only
    fi

    # Check for secrets
    if [[ -z "$AI_API_KEY" ]]; then
        log_warn "AI_API_KEY not set. AI analysis will be disabled."
        log_warn "Set up secrets: cp .env.example ~/.secrets/com.trends.app.env"
    fi

    log_info "Environment check passed"
}

# =============================================================================
# Service Management
# =============================================================================
start_crawler() {
    log_service "CRAWLER" "Starting news crawler..."

    # Development mode: skip root index.html to keep git clean
    export SKIP_ROOT_INDEX=true

    uv run python -m trendradar
}

start_mcp() {
    log_service "MCP" "Starting MCP server on port $MCP_PORT..."

    uv run python -m mcp_server.server --transport http --port "$MCP_PORT"
}

start_all() {
    log_info "Starting all services..."
    echo ""

    # Start MCP server in background
    log_service "MCP" "Starting MCP server on port $MCP_PORT (background)..."
    uv run python -m mcp_server.server --transport http --port "$MCP_PORT" &
    MCP_PID=$!

    # Give MCP server time to start
    sleep 2

    # Trap to cleanup on exit
    trap "log_info 'Shutting down...'; kill $MCP_PID 2>/dev/null; exit" INT TERM

    echo ""
    log_info "MCP server running at http://localhost:$MCP_PORT"
    log_info "Press Ctrl+C to stop all services"
    echo ""

    # Run crawler in foreground
    start_crawler

    # Cleanup
    kill $MCP_PID 2>/dev/null
}

# =============================================================================
# Help
# =============================================================================
show_help() {
    echo "Usage: $0 [SERVICE]"
    echo ""
    echo "Start TrendRadar development services natively (no Docker required)."
    echo ""
    echo "Services:"
    echo "  crawler  Start only the news crawler/analyzer"
    echo "  mcp      Start only the MCP server (HTTP mode)"
    echo "  all      Start both services (default)"
    echo ""
    echo "Environment Variables:"
    echo "  MCP_PORT     MCP server port (default: 3333)"
    echo "  AI_API_KEY   API key for AI analysis"
    echo ""
    echo "Examples:"
    echo "  $0              # Start all services"
    echo "  $0 crawler      # Start only crawler"
    echo "  $0 mcp          # Start only MCP server"
    echo "  MCP_PORT=8080 $0 mcp  # Start MCP on custom port"
}

# =============================================================================
# Main
# =============================================================================
main() {
    case "$SERVICE" in
        crawler)
            check_environment
            start_crawler
            ;;
        mcp)
            check_environment
            start_mcp
            ;;
        all)
            check_environment
            start_all
            ;;
        help|--help|-h)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown service: $SERVICE"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

main
