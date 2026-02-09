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

# Cleanup state
CLEANUP_DONE=0

declare -a SERVICE_ORDER=("convex" "mcp" "worker" "scraper" "api" "web")
declare -A SERVICE_LABELS=(
    ["convex"]="Convex"
    ["mcp"]="MCP"
    ["worker"]="Worker API"
    ["scraper"]="Scraper"
    ["api"]="BFF API"
    ["web"]="Web UI"
)
declare -A SERVICE_TAGS=(
    ["convex"]="CONVEX"
    ["mcp"]="MCP"
    ["worker"]="WORKER"
    ["scraper"]="SCRAPER"
    ["api"]="API"
    ["web"]="WEB"
)
declare -A SERVICE_LOG_FILES=(
    ["convex"]="convex.log"
    ["mcp"]="mcp.log"
    ["worker"]="worker.log"
    ["scraper"]="scraper.log"
    ["api"]="api.log"
    ["web"]="web.log"
)

# List direct child processes for a parent PID
list_child_pids() {
    local parent_pid="$1"
    if command -v pgrep >/dev/null 2>&1; then
        pgrep -P "$parent_pid" 2>/dev/null || true
    else
        ps -eo pid=,ppid= | awk -v p="$parent_pid" '$2 == p { print $1 }'
    fi
}

# Recursively send a signal to a process and its descendants
kill_process_tree() {
    local pid="$1"
    local signal="$2"
    local children

    children="$(list_child_pids "$pid")"
    for child in $children; do
        kill_process_tree "$child" "$signal"
    done

    kill "$signal" "$pid" 2>/dev/null || true
}

# Send a signal to all descendants of this script
kill_all_children() {
    local signal="$1"
    local children

    children="$(list_child_pids "$$")"
    for child in $children; do
        kill_process_tree "$child" "$signal"
    done
}

# Cleanup function (Graceful + Timeout Kill + Full Child Cleanup)
cleanup() {
    # Avoid running cleanup twice (SIGINT/SIGTERM + EXIT)
    if [ "$CLEANUP_DONE" -eq 1 ]; then
        return
    fi

    # Nothing started, nothing to clean.
    if [ ${#SERVICE_PIDS[@]} -eq 0 ] && [ -z "$(list_child_pids "$$")" ]; then
        CLEANUP_DONE=1
        trap - SIGINT SIGTERM EXIT
        return
    fi

    CLEANUP_DONE=1
    trap - SIGINT SIGTERM EXIT

    echo -e "\n${YELLOW}Shutting down services...${NC}"

    # 1. Print tracked services being stopped in deterministic order
    local service
    local pid
    for service in "${SERVICE_ORDER[@]}"; do
        pid="${SERVICE_PIDS[$service]:-}"
        if is_pid_running "$pid"; then
            echo -e "${CYAN}Stopping $(service_label "$service") (PID: $pid, log: $(service_log_path "$service"))${NC}"
        fi
    done

    # 2. Graceful shutdown for all child processes of this script
    kill_all_children "-TERM"

    # 3. Wait up to 5 seconds for graceful exit
    local timeout=5
    local elapsed=0
    while [ "$elapsed" -lt "$timeout" ]; do
        if [ -z "$(list_child_pids "$$")" ]; then
            break
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done

    # 4. Force kill anything still alive
    if [ -n "$(list_child_pids "$$")" ]; then
        echo -e "${RED}Force killing remaining child processes...${NC}"
        kill_all_children "-KILL"
    fi

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

service_label() {
    local service="$1"
    echo "${SERVICE_LABELS[$service]:-$service}"
}

service_tag() {
    local service="$1"
    echo "${SERVICE_TAGS[$service]:-${service^^}}"
}

service_log_path() {
    local service="$1"
    local file="${SERVICE_LOG_FILES[$service]:-}"
    if [ -z "$file" ]; then
        echo "-"
        return
    fi
    echo "$LOGS_DIR/$file"
}

service_port() {
    local service="$1"
    case "$service" in
        convex) echo "${CONVEX_PORT:-3210}" ;;
        mcp) echo "${MCP_PORT:-3333}" ;;
        worker) echo "${TRENDS_WORKER_PORT:-8000}" ;;
        api) echo "${API_PORT:-3000}" ;;
        web) echo "${WEB_PORT:-5173}" ;;
        *) echo "" ;;
    esac
}

service_url() {
    local service="$1"
    local port
    port="$(service_port "$service")"
    if [ -z "$port" ]; then
        echo "-"
        return
    fi
    echo "http://localhost:$port"
}

is_pid_running() {
    local pid="$1"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

is_service_running() {
    local service="$1"
    local pid="${SERVICE_PIDS[$service]:-}"
    is_pid_running "$pid"
}

has_bun() {
    command -v bun >/dev/null 2>&1
}

local_js_runner() {
    if has_bun; then
        echo "bun"
    else
        echo "npm"
    fi
}

run_local_js_script() {
    local script="$1"
    shift

    if has_bun; then
        bun run "$script" "$@"
        return
    fi

    if [ "$#" -gt 0 ]; then
        npm run --silent "$script" -- "$@"
    else
        npm run --silent "$script"
    fi
}

should_filter_terminal_log_line() {
    local service="$1"
    local line="$2"

    if [ "$service" != "api" ]; then
        return 1
    fi

    case "$line" in
        *"Previous process hasn't exited yet. Force killing..."*)
            return 0
            ;;
        *'error: script "dev" exited with code 130'*)
            return 0
            ;;
        *"npm ERR! code 130"*)
            return 0
            ;;
        *"npm error code 130"*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

stream_service_logs() {
    local service="$1"
    local color="$2"
    local tag
    tag="$(service_tag "$service")"

    while IFS= read -r line; do
        if should_filter_terminal_log_line "$service" "$line"; then
            continue
        fi
        log "$tag" "$color" "$line"
    done
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
    local services_to_check=("$@")
    if [ ${#services_to_check[@]} -eq 0 ]; then
        services_to_check=("convex" "mcp" "worker" "api" "web")
    fi

    local ports=()
    local names=()
    local conflicts=()

    for service in "${services_to_check[@]}"; do
        local port
        port="$(service_port "$service")"
        if [ -z "$port" ]; then
            continue
        fi

        ports+=("$port")
        names+=("$(service_label "$service")")
    done

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
            echo -e "Or run: ${CYAN}./scripts/clean-dev.sh${NC}"
            echo ""
            return 1
        fi
    fi

    return 0
}

# Start MCP server
start_mcp_server() {
    local port="${MCP_PORT:-3333}"

    if ! check_port "$port"; then
        log "MCP" "$YELLOW" "Port $port already in use, skipping MCP server"
        return 0
    fi

    log "MCP" "$BLUE" "Starting MCP server on http://localhost:$port"

    cd "$PROJECT_ROOT"
    local cmd="uv run python -m mcp_server.server --transport http --port $port"
    if [ -f "$ENV_FILE" ]; then
        cmd="uv run --env-file $ENV_FILE python -m mcp_server.server --transport http --port $port"
    fi

    # Use process substitution to capture correct PID
    eval "$cmd" > >(tee "$(service_log_path "mcp")" | stream_service_logs "mcp" "$BLUE") 2>&1 &
    SERVICE_PIDS["mcp"]=$!
}

# Start crawler in watch mode (runs once, can be re-triggered)
start_crawler() {
    log "CRAWLER" "$GREEN" "Running initial crawl..."

    cd "$PROJECT_ROOT"
    export SKIP_ROOT_INDEX=true

    local cmd="uv run python -m trendradar"
    if [ -f "$ENV_FILE" ]; then
        cmd="uv run --env-file $ENV_FILE python -m trendradar"
    fi

    eval "$cmd" > >(tee "$LOGS_DIR/crawler.log" | while read line; do log "CRAWLER" "$GREEN" "$line"; done) 2>&1 &
    # We generally don't track crawler PID for cleanup as it exits, but let's track it just in case
    # SERVICE_PIDS["crawler"]=$! 
    # Actually wait for crawler if it's a one-off? The original script waited via pipe. 
    # But for 'watch mode' (if implemented) implies background. 
    # Current code implies run once.
    wait $!
    log "CRAWLER" "$GREEN" "Crawl complete. MCP server continues running."
}

# Start web frontend (future: apps/web)
start_web() {
    local port="${WEB_PORT:-5173}"

    if [ -d "$PROJECT_ROOT/apps/web" ]; then
        if ! check_port "$port"; then
            log "WEB" "$YELLOW" "Port $port already in use, skipping web server"
            return 0
        fi

        local runner
        runner="$(local_js_runner)"

        log "WEB" "$CYAN" "Generating API types ($runner run gen:api)..."
        (
            cd "$PROJECT_ROOT/apps/web"
            if ! run_local_js_script gen:api >/dev/null 2>&1; then
                log "WEB" "$YELLOW" "Failed to generate API types (continuing)"
            fi
        )

        log "WEB" "$CYAN" "Starting web frontend on http://localhost:$port ($runner run dev)"
        cd "$PROJECT_ROOT/apps/web"

        run_local_js_script dev --port "$port" > >(tee "$(service_log_path "web")" | stream_service_logs "web" "$CYAN") 2>&1 &
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
            return 0
        fi

        local runner
        runner="$(local_js_runner)"

        log "API" "$CYAN" "Starting BFF API on http://localhost:$port ($runner run dev)"
        cd "$PROJECT_ROOT/apps/api"

        PORT="$port" run_local_js_script dev > >(tee "$(service_log_path "api")" | stream_service_logs "api" "$CYAN") 2>&1 &
        SERVICE_PIDS["api"]=$!
    else
        log "API" "$YELLOW" "apps/api not found (planned for Milestone 2)"
    fi
}

# Start FastAPI worker (future: apps/worker)
start_worker() {
    local port="${TRENDS_WORKER_PORT:-8000}"

    if [ -d "$PROJECT_ROOT/apps/worker" ]; then
        if ! check_port "$port"; then
            log "WORKER" "$YELLOW" "Port $port already in use, skipping worker"
            return 0
        fi

        log "WORKER" "$CYAN" "Starting FastAPI worker on http://localhost:$port"
        cd "$PROJECT_ROOT/apps/worker"
        
        local cmd="uv run uvicorn api:app --reload --port $port"
        if [ -f "$ENV_FILE" ]; then
            cmd="uv run --env-file $ENV_FILE uvicorn api:app --reload --port $port"
        fi

        eval "$cmd" > >(tee "$(service_log_path "worker")" | stream_service_logs "worker" "$CYAN") 2>&1 &
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
        source "$PROJECT_ROOT/apps/web/.env.local"
    fi
    
    if [ -z "$VITE_CONVEX_URL" ] && [ -z "$CONVEX_URL" ]; then
         log "SCRAPER" "$YELLOW" "CONVEX_URL not found. Waiting for Convex to start..."
         sleep 5
         if [ -f "$PROJECT_ROOT/apps/web/.env.local" ]; then
             source "$PROJECT_ROOT/apps/web/.env.local"
         fi
    fi
    
    if [ -z "$CONVEX_URL" ] && [ -n "$VITE_CONVEX_URL" ]; then
        export CONVEX_URL="$VITE_CONVEX_URL"
    fi
    
    if [ -z "${CONVEX_URL:-}" ]; then
        log "SCRAPER" "$YELLOW" "CONVEX_URL not available. Skipping scraper."
        return 0
    fi

    cd "$PROJECT_ROOT"
    local cmd="uv run python scripts/worker.py"
    if [ -f "$ENV_FILE" ]; then
        cmd="uv run --env-file $ENV_FILE python scripts/worker.py"
    fi

    eval "$cmd" > >(tee "$(service_log_path "scraper")" | stream_service_logs "scraper" "$CYAN") 2>&1 &
    SERVICE_PIDS["scraper"]=$!
    
    # Check if it died immediately
    sleep 1
    if ! kill -0 $! 2>/dev/null; then
         log "SCRAPER" "$RED" "Scraper failed to start. Check logs."
    else
         log "SCRAPER" "$CYAN" "Scraper running (PID: $!)"
    fi
}

# Start Convex backend
start_convex() {
    local port="${CONVEX_PORT:-3210}"
    local convex_env_local="$PROJECT_ROOT/packages/convex/.env.local"

    # Case 1: CONVEX_URL already set in system env (e.g., cloud deployment).
    # Skip starting local convex dev, just sync the URL to downstream consumers.
    if [ -n "${CONVEX_URL:-}" ]; then
        log "CONVEX" "$GREEN" "CONVEX_URL already set ($CONVEX_URL). Skipping local convex dev."
        if [ -f "$SCRIPT_DIR/sync-convex-env.sh" ]; then
            "$SCRIPT_DIR/sync-convex-env.sh" || true
        fi
        return 0
    fi

    if [ ! -d "$PROJECT_ROOT/packages/convex" ]; then
        log "CONVEX" "$YELLOW" "packages/convex not found"
        return 0
    fi

    # Case 2: No .env.local — use CONVEX_AGENT_MODE=anonymous to bootstrap.
    # This skips the interactive login prompt and creates a local anonymous project.
    if [ ! -f "$convex_env_local" ]; then
        log "CONVEX" "$CYAN" "No Convex .env.local found. Bootstrapping with anonymous agent mode..."
        export CONVEX_AGENT_MODE=anonymous
    fi

    # Case 3: .env.local exists (or just set agent mode for bootstrap) — start convex dev.
    if ! check_port "$port"; then
        log "CONVEX" "$GREEN" "Port $port is in use. Assuming Convex is already running."
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

    $cmd > >(tee "$(service_log_path "convex")" | stream_service_logs "convex" "$CYAN") 2>&1 &
    SERVICE_PIDS["convex"]=$!

    sleep 5

    if [ -f "$SCRIPT_DIR/sync-convex-env.sh" ]; then
        "$SCRIPT_DIR/sync-convex-env.sh" || true
    fi
}

# Print service status
print_status() {
    echo ""
    echo -e "${GREEN}Services running:${NC}"
    printf "  %-12s | %-24s | %-8s | %s\n" "Service" "URL" "PID" "Log"
    printf "  %-12s-+-%-24s-+-%-8s-+-%s\n" "------------" "------------------------" "--------" "------------------------"

    local service
    local pid
    local started=0
    for service in "${SERVICE_ORDER[@]}"; do
        pid="${SERVICE_PIDS[$service]:-}"
        if ! is_pid_running "$pid"; then
            continue
        fi

        started=$((started + 1))
        printf "  %-12s | %-24s | %-8s | %s\n" \
            "$(service_label "$service")" \
            "$(service_url "$service")" \
            "$pid" \
            "$(service_log_path "$service")"
    done

    if [ "$started" -eq 0 ]; then
        echo "  (no active tracked services)"
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
                echo "  TRENDS_WORKER_PORT FastAPI worker port (default: 8000)"
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
    if ! check_all_ports "${services[@]}"; then
        log "DEV" "$YELLOW" "Resolve conflicts first: ./scripts/clean-dev.sh (or rerun with --force)."
        trap - EXIT
        exit 1
    fi

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
