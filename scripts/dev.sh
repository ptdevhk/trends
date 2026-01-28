#!/bin/bash
set -e

# TrendRadar Development Environment
# Starts all available services concurrently with proper process management

ENV_FILE="${ENV_FILE:-.env}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Service PIDs for cleanup
declare -A SERVICE_PIDS

# Cleanup function
cleanup() {
    echo -e "\n${YELLOW}Shutting down services...${NC}"
    for service in "${!SERVICE_PIDS[@]}"; do
        pid="${SERVICE_PIDS[$service]}"
        if kill -0 "$pid" 2>/dev/null; then
            echo -e "${CYAN}Stopping $service (PID: $pid)${NC}"
            kill "$pid" 2>/dev/null || true
        fi
    done
    wait 2>/dev/null || true
    echo -e "${GREEN}All services stopped.${NC}"
    exit 0
}

# Trap signals for cleanup
trap cleanup SIGINT SIGTERM EXIT

# Print banner
print_banner() {
    echo -e "${CYAN}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║           TrendRadar Development Environment               ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Log with timestamp and service name
log() {
    local service="$1"
    local color="$2"
    local message="$3"
    echo -e "${color}[$(date '+%H:%M:%S')] [$service]${NC} $message"
}

# Check if a port is available
check_port() {
    local port="$1"
    if command -v lsof &>/dev/null; then
        ! lsof -i ":$port" &>/dev/null
    elif command -v ss &>/dev/null; then
        ! ss -tuln | grep -q ":$port "
    else
        # Fallback: try to connect
        ! (echo >/dev/tcp/localhost/"$port") 2>/dev/null
    fi
}

# Start MCP server
start_mcp_server() {
    local port="${MCP_PORT:-3333}"

    if ! check_port "$port"; then
        log "MCP" "$YELLOW" "Port $port already in use, skipping MCP server"
        return 1
    fi

    log "MCP" "$BLUE" "Starting MCP server on http://localhost:$port"

    cd "$PROJECT_ROOT"
    if [ -f "$ENV_FILE" ]; then
        uv run --env-file "$ENV_FILE" python -m mcp_server.server --transport http --port "$port" 2>&1 | \
            while IFS= read -r line; do
                log "MCP" "$BLUE" "$line"
            done &
    else
        uv run python -m mcp_server.server --transport http --port "$port" 2>&1 | \
            while IFS= read -r line; do
                log "MCP" "$BLUE" "$line"
            done &
    fi
    SERVICE_PIDS["mcp"]=$!
}

# Start crawler in watch mode (runs once, can be re-triggered)
start_crawler() {
    log "CRAWLER" "$GREEN" "Running initial crawl..."

    cd "$PROJECT_ROOT"
    # Set SKIP_ROOT_INDEX to avoid git pollution in dev
    export SKIP_ROOT_INDEX=true

    if [ -f "$ENV_FILE" ]; then
        uv run --env-file "$ENV_FILE" python -m trendradar 2>&1 | \
            while IFS= read -r line; do
                log "CRAWLER" "$GREEN" "$line"
            done
    else
        uv run python -m trendradar 2>&1 | \
            while IFS= read -r line; do
                log "CRAWLER" "$GREEN" "$line"
            done
    fi

    log "CRAWLER" "$GREEN" "Crawl complete. MCP server continues running."
}

# Start web frontend (future: apps/web)
start_web() {
    local port="${WEB_PORT:-5173}"

    if [ -d "$PROJECT_ROOT/apps/web" ]; then
        if ! check_port "$port"; then
            log "WEB" "$YELLOW" "Port $port already in use, skipping web server"
            return 1
        fi

        log "WEB" "$CYAN" "Starting web frontend on http://localhost:$port"
        cd "$PROJECT_ROOT/apps/web"
        npm run dev 2>&1 | \
            while IFS= read -r line; do
                log "WEB" "$CYAN" "$line"
            done &
        SERVICE_PIDS["web"]=$!
    else
        log "WEB" "$YELLOW" "apps/web not found (planned for Milestone 3)"
    fi
}

# Start BFF API (future: apps/api)
start_api() {
    local port="${API_PORT:-3000}"

    if [ -d "$PROJECT_ROOT/apps/api" ]; then
        if ! check_port "$port"; then
            log "API" "$YELLOW" "Port $port already in use, skipping API server"
            return 1
        fi

        log "API" "$CYAN" "Starting BFF API on http://localhost:$port"
        cd "$PROJECT_ROOT/apps/api"
        npm run dev 2>&1 | \
            while IFS= read -r line; do
                log "API" "$CYAN" "$line"
            done &
        SERVICE_PIDS["api"]=$!
    else
        log "API" "$YELLOW" "apps/api not found (planned for Milestone 2)"
    fi
}

# Start FastAPI worker (future: apps/worker)
start_worker() {
    local port="${WORKER_PORT:-8000}"

    if [ -d "$PROJECT_ROOT/apps/worker" ]; then
        if ! check_port "$port"; then
            log "WORKER" "$YELLOW" "Port $port already in use, skipping worker"
            return 1
        fi

        log "WORKER" "$CYAN" "Starting FastAPI worker on http://localhost:$port"
        cd "$PROJECT_ROOT/apps/worker"
        if [ -f "$ENV_FILE" ]; then
            uv run --env-file "$ENV_FILE" uvicorn main:app --reload --port "$port" 2>&1 | \
                while IFS= read -r line; do
                    log "WORKER" "$CYAN" "$line"
                done &
        else
            uv run uvicorn main:app --reload --port "$port" 2>&1 | \
                while IFS= read -r line; do
                    log "WORKER" "$CYAN" "$line"
                done &
        fi
        SERVICE_PIDS["worker"]=$!
    else
        log "WORKER" "$YELLOW" "apps/worker not found (planned for Milestone 1)"
    fi
}

# Print service status
print_status() {
    echo ""
    echo -e "${GREEN}Services running:${NC}"
    echo -e "  ${BLUE}MCP Server:${NC}  http://localhost:${MCP_PORT:-3333}"

    if [ -d "$PROJECT_ROOT/apps/worker" ]; then
        echo -e "  ${CYAN}Worker API:${NC}  http://localhost:${WORKER_PORT:-8000}"
    fi
    if [ -d "$PROJECT_ROOT/apps/api" ]; then
        echo -e "  ${CYAN}BFF API:${NC}     http://localhost:${API_PORT:-3000}"
    fi
    if [ -d "$PROJECT_ROOT/apps/web" ]; then
        echo -e "  ${CYAN}Web UI:${NC}      http://localhost:${WEB_PORT:-5173}"
    fi

    echo ""
    echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"
    echo ""
}

# Main
main() {
    print_banner

    # Load environment
    if [ -f "$PROJECT_ROOT/$ENV_FILE" ]; then
        log "DEV" "$GREEN" "Using environment from: $ENV_FILE"
    else
        log "DEV" "$YELLOW" "No $ENV_FILE found, using system environment"
    fi

    # Parse command line arguments
    local services=()
    while [[ $# -gt 0 ]]; do
        case $1 in
            --mcp-only)
                services=("mcp")
                shift
                ;;
            --crawl-only)
                services=("crawl")
                shift
                ;;
            --all)
                services=("mcp" "crawl" "worker" "api" "web")
                shift
                ;;
            --help|-h)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --mcp-only    Start only MCP server"
                echo "  --crawl-only  Run crawler only (no long-running services)"
                echo "  --all         Start all services (including future apps/*)"
                echo "  --help        Show this help message"
                echo ""
                echo "Environment variables:"
                echo "  ENV_FILE      Path to .env file (default: .env)"
                echo "  MCP_PORT      MCP server port (default: 3333)"
                echo "  WORKER_PORT   FastAPI worker port (default: 8000)"
                echo "  API_PORT      BFF API port (default: 3000)"
                echo "  WEB_PORT      Web frontend port (default: 5173)"
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    # Default: start MCP and run crawler
    if [ ${#services[@]} -eq 0 ]; then
        services=("mcp" "crawl" "worker" "api" "web")
    fi

    # Start requested services
    for service in "${services[@]}"; do
        case $service in
            mcp) start_mcp_server ;;
            crawl) start_crawler ;;
            worker) start_worker ;;
            api) start_api ;;
            web) start_web ;;
        esac
    done

    # If we have any long-running services, print status and wait
    if [ ${#SERVICE_PIDS[@]} -gt 0 ]; then
        print_status

        # Wait for all background processes
        wait
    fi
}

main "$@"
