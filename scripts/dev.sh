#!/usr/bin/env bash
set -e

# TrendRadar Development Environment
# Starts all available services concurrently with proper process management

ENV_FILE="${ENV_FILE:-.env}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOGS_DIR="$PROJECT_ROOT/logs"

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

# Ensure native Node modules are compatible with the active Node runtime.
# This handles cases where dependencies were installed under a different Node version.
ensure_node_native_modules() {
    local has_api_or_web=false
    if [ -d "$PROJECT_ROOT/apps/api" ] || [ -d "$PROJECT_ROOT/apps/web" ]; then
        has_api_or_web=true
    fi

    if [ "$has_api_or_web" != "true" ]; then
        return 0
    fi

    if ! command -v node >/dev/null 2>&1; then
        log "DEV" "$YELLOW" "Node.js not found; skipping native module compatibility check"
        return 0
    fi

    if [ ! -d "$PROJECT_ROOT/node_modules/better-sqlite3" ]; then
        # Dependencies might not be installed yet; startup commands will surface that separately.
        return 0
    fi

    local healthcheck="const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.prepare('select 1').get(); db.close();"
    if node -e "$healthcheck" >/dev/null 2>&1; then
        return 0
    fi

    local node_ver
    node_ver="$(node -v 2>/dev/null || echo 'unknown')"
    log "DEV" "$YELLOW" "Detected better-sqlite3 ABI mismatch for Node $node_ver; rebuilding..."

    cd "$PROJECT_ROOT"
    if ! npm rebuild better-sqlite3 >/dev/null 2>&1; then
        log "DEV" "$RED" "Failed to rebuild better-sqlite3. Try: npm rebuild better-sqlite3"
        return 1
    fi

    if ! node -e "$healthcheck" >/dev/null 2>&1; then
        log "DEV" "$RED" "better-sqlite3 still failed after rebuild. Try: rm -rf node_modules && npm install"
        return 1
    fi

    log "DEV" "$GREEN" "better-sqlite3 rebuilt successfully for Node $node_ver"
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

# Get PIDs of what's using a port (space-separated)
get_port_pids() {
    local port="$1"
    if command -v lsof &>/dev/null; then
        lsof -i ":$port" -t 2>/dev/null | tr '\n' ' ' | xargs
    fi
}

# Check all required ports upfront
check_all_ports() {
    local ports=("${CONVEX_PORT:-3210}" "${MCP_PORT:-3333}" "${WORKER_PORT:-8000}" "${API_PORT:-3000}" "${WEB_PORT:-5173}")
    local names=("Convex" "MCP" "Worker" "API" "Web")
    local conflicts=()

    for i in "${!ports[@]}"; do
        local port="${ports[$i]}"
        local name="${names[$i]}"
        if ! check_port "$port"; then
            local pids=$(get_port_pids "$port")
            local first_pid=$(echo "$pids" | awk '{print $1}')
            local cmd=""
            if [ -n "$first_pid" ]; then
                cmd=$(ps -p "$first_pid" -o comm= 2>/dev/null || echo "unknown")
            fi
            conflicts+=("$name:$port:$pids:$cmd")
        fi
    done

    if [ ${#conflicts[@]} -gt 0 ]; then
        echo -e "${RED}⚠ Port conflicts detected:${NC}"
        echo ""
        for conflict in "${conflicts[@]}"; do
            IFS=':' read -r name port pids cmd <<< "$conflict"
            echo -e "  ${YELLOW}$name${NC} (port $port) - PID $pids ($cmd)"
        done
        echo ""

        if [ "$FORCE_KILL" = "true" ]; then
            echo -e "${YELLOW}Killing conflicting processes...${NC}"
            for conflict in "${conflicts[@]}"; do
                IFS=':' read -r name port pids cmd <<< "$conflict"
                for pid in $pids; do
                    if [ -n "$pid" ]; then
                        kill -9 "$pid" 2>/dev/null && \
                            echo -e "  ${GREEN}Killed $name (PID $pid)${NC}"
                    fi
                done
            done
            echo ""
            sleep 1  # Give ports time to free up
        else
            echo -e "Run with ${CYAN}--force${NC} to kill conflicting processes"
            echo -e "Or manually: ${CYAN}kill -9 <PID>${NC}"
            echo ""
        fi
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
            tee "$LOGS_DIR/mcp.log" | \
            while IFS= read -r line; do
                log "MCP" "$BLUE" "$line"
            done &
    else
        uv run python -m mcp_server.server --transport http --port "$port" 2>&1 | \
            tee "$LOGS_DIR/mcp.log" | \
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
            tee "$LOGS_DIR/crawler.log" | \
            while IFS= read -r line; do
                log "CRAWLER" "$GREEN" "$line"
            done
    else
        uv run python -m trendradar 2>&1 | \
            tee "$LOGS_DIR/crawler.log" | \
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

        log "WEB" "$CYAN" "Generating API types..."
        (
            cd "$PROJECT_ROOT"
            if ! npm --workspace @trends/web run gen:api >/dev/null 2>&1; then
                log "WEB" "$YELLOW" "Failed to generate API types (continuing)"
            fi
        )

        log "WEB" "$CYAN" "Starting web frontend on http://localhost:$port"
        cd "$PROJECT_ROOT/apps/web"
        npm run dev -- --port "$port" 2>&1 | \
            tee "$LOGS_DIR/web.log" | \
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
        PORT="$port" npm run dev 2>&1 | \
            tee "$LOGS_DIR/api.log" | \
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
            uv run --env-file "$ENV_FILE" uvicorn api:app --reload --port "$port" 2>&1 | \
                tee "$LOGS_DIR/worker.log" | \
                while IFS= read -r line; do
                    log "WORKER" "$CYAN" "$line"
                done &
        else
            uv run uvicorn api:app --reload --port "$port" 2>&1 | \
                tee "$LOGS_DIR/worker.log" | \
                while IFS= read -r line; do
                    log "WORKER" "$CYAN" "$line"
                done &
        fi
        SERVICE_PIDS["worker"]=$!
    else
        log "WORKER" "$YELLOW" "apps/worker not found (planned for Milestone 1)"
    fi
}

# Start Scraping Worker (Python + CDP)
start_scraper() {
    log "SCRAPER" "$CYAN" "Starting Scraping Worker..."
    
    # Ensure CONVEX_URL is available
    if [ -f "$PROJECT_ROOT/apps/web/.env.local" ]; then
        # Load env vars from web app (synced from convex)
        source "$PROJECT_ROOT/apps/web/.env.local"
    fi
    
    # Fallback to defaults or check if CONVEX_URL is set
    if [ -z "$VITE_CONVEX_URL" ] && [ -z "$CONVEX_URL" ]; then
         log "SCRAPER" "$YELLOW" "CONVEX_URL not found. Waiting for Convex to start..."
         sleep 5
         if [ -f "$PROJECT_ROOT/apps/web/.env.local" ]; then
             source "$PROJECT_ROOT/apps/web/.env.local"
         fi
    fi
    
    # Use VITE_CONVEX_URL if CONVEX_URL is not set
    if [ -z "$CONVEX_URL" ] && [ -n "$VITE_CONVEX_URL" ]; then
        export CONVEX_URL="$VITE_CONVEX_URL"
    fi
    
    if [ -z "$CONVEX_URL" ]; then
         log "SCRAPER" "$RED" "Failed to find CONVEX_URL. Worker may fail."
    fi

    cd "$PROJECT_ROOT"
    if [ -f "$ENV_FILE" ]; then
        uv run --env-file "$ENV_FILE" python scripts/worker.py 2>&1 | \
            tee "$LOGS_DIR/scraper.log" | \
            while IFS= read -r line; do
                log "SCRAPER" "$CYAN" "$line"
            done &
    else
        uv run python scripts/worker.py 2>&1 | \
            tee "$LOGS_DIR/scraper.log" | \
            while IFS= read -r line; do
                log "SCRAPER" "$CYAN" "$line"
            done &
    fi
    SERVICE_PIDS["scraper"]=$!
}

# Start Convex backend
start_convex() {
    local port="${CONVEX_PORT:-3210}" 
    
    if [ -d "$PROJECT_ROOT/packages/convex" ]; then
        if ! check_port "$port"; then
            log "CONVEX" "$GREEN" "Port $port is in use. Assuming Convex is already running."
            # Sync env vars just in case
            if [ -f "$SCRIPT_DIR/sync-convex-env.sh" ]; then
                 "$SCRIPT_DIR/sync-convex-env.sh" || true
            fi
            return 0
        fi

        log "CONVEX" "$CYAN" "Starting Convex Dev..."
        cd "$PROJECT_ROOT/packages/convex"
        
        local cmd="npx convex dev"
        if command -v bun >/dev/null 2>&1; then
             cmd="bunx convex dev"
        fi

        $cmd 2>&1 | \
            tee "$LOGS_DIR/convex.log" | \
            while IFS= read -r line; do
                log "CONVEX" "$CYAN" "$line"
            done &
        SERVICE_PIDS["convex"]=$!
        
        # Give it a moment to write .env.local
        sleep 5
        
        # Sync env vars
        if [ -f "$SCRIPT_DIR/sync-convex-env.sh" ]; then
             "$SCRIPT_DIR/sync-convex-env.sh" || true
        fi
    else
        log "CONVEX" "$YELLOW" "packages/convex not found"
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

    mkdir -p "$LOGS_DIR"

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
            --skip-crawl)
                SKIP_CRAWL=true
                shift
                ;;
            --fresh)
                SKIP_CRAWL=false
                shift
                ;;
            --all)
                services=("mcp" "crawl" "worker" "api" "web")
                shift
                ;;
            --force|-f)
                FORCE_KILL=true
                shift
                ;;
            --help|-h)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --mcp-only    Start only MCP server"
                echo "  --crawl-only  Run crawler only (no long-running services)"
                echo "  --skip-crawl  Skip initial crawl and start servers immediately (default)"
                echo "  --fresh       Run crawl first, then start servers"
                echo "  --all         Start all services (including future apps/*)"
                echo "  --force, -f   Kill processes using required ports"
                echo "  --help        Show this help message"
                echo ""
                echo "Environment variables:"
                echo "  ENV_FILE      Path to .env file (default: .env)"
                echo "  SKIP_CRAWL    Skip crawl on startup (default: true; set to false to crawl)"
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

    # Default: fast dev mode (skip crawl unless explicitly disabled)
    if [ ${#services[@]} -eq 0 ]; then
        if [ "$SKIP_CRAWL" != "false" ] && [ "$SKIP_CRAWL" != "0" ]; then
            services=("convex" "mcp" "worker" "scraper" "api" "web")
        else
            services=("convex" "mcp" "crawl" "worker" "scraper" "api" "web")
        fi
    fi

    # Check for port conflicts upfront
    check_all_ports

    # Native modules can break when Node version changes between installs/runs.
    ensure_node_native_modules

    # Start requested services
    for service in "${services[@]}"; do
        case $service in
            convex) start_convex ;;
            mcp) start_mcp_server ;;
            crawl) start_crawler ;;
            worker) start_worker ;;
            scraper) start_scraper ;;
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
