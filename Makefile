# TrendRadar Development Makefile

.PHONY: dev dev-mcp dev-crawl dev-web dev-api dev-worker run crawl mcp mcp-http \
        install install-deps uninstall fetch-docs clean check help docker docker-build docker-down

# Default target
.DEFAULT_GOAL := help

# =============================================================================
# Development (Full Experience)
# =============================================================================

# Start all available services (MCP server + crawler + future apps/*)
dev:
	./scripts/dev.sh

# Start only MCP server (HTTP mode for development)
dev-mcp:
	./scripts/dev.sh --mcp-only

# Run crawler only (no long-running services)
dev-crawl:
	./scripts/dev.sh --crawl-only

# Start web frontend only (requires apps/web from Milestone 3)
dev-web:
	@if [ -d "apps/web" ]; then \
		cd apps/web && npm run dev; \
	else \
		echo "apps/web not found. Create it with Milestone 3 (React Frontend)"; \
		exit 1; \
	fi

# Start BFF API only (requires apps/api from Milestone 2)
dev-api:
	@if [ -d "apps/api" ]; then \
		cd apps/api && npm run dev; \
	else \
		echo "apps/api not found. Create it with Milestone 2 (Hono BFF)"; \
		exit 1; \
	fi

# Start FastAPI worker only (requires apps/worker from Milestone 1)
dev-worker:
	@if [ -d "apps/worker" ]; then \
		cd apps/worker && uv run uvicorn main:app --reload --port 8000; \
	else \
		echo "apps/worker not found. Create it with Milestone 1 (FastAPI Wrapper)"; \
		exit 1; \
	fi

# =============================================================================
# Production
# =============================================================================

# Production run (writes root index.html for GitHub Pages)
run:
	uv run python -m trendradar

# Run crawler (alias for run)
crawl:
	uv run python -m trendradar

# MCP server (STDIO mode - for MCP clients like Claude Desktop)
mcp:
	uv run python -m mcp_server.server

# MCP server (HTTP mode - for web-based clients)
mcp-http:
	uv run python -m mcp_server.server --transport http --port 3333

# =============================================================================
# Deployment
# =============================================================================

# Install as systemd services (production)
install:
	sudo ./scripts/install.sh

# Remove systemd services
uninstall:
	sudo ./scripts/install.sh uninstall

# Docker: start containers
docker:
	cd deploy/docker && docker compose up -d

# Docker: build and start containers
docker-build:
	cd deploy/docker && docker compose -f docker-compose-build.yml up -d --build

# Docker: stop containers
docker-down:
	cd deploy/docker && docker compose down

# =============================================================================
# Dependencies
# =============================================================================

# Install Python/Node dependencies for development
install-deps:
	./scripts/install-deps.sh

# =============================================================================
# Documentation
# =============================================================================

# Fetch latest upstream documentation
fetch-docs:
	./dev-docs/fetch-docs.sh

# =============================================================================
# Utilities
# =============================================================================

# Remove generated/cached files
clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	rm -rf node_modules .venv build dist

# Run basic health checks
check:
	uv run python -c "import trendradar; print(f'trendradar v{trendradar.__version__} OK')"

# =============================================================================
# Help
# =============================================================================

help:
	@echo "TrendRadar Development Commands"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Development (Full Experience):"
	@echo "  dev          Start all services (MCP + crawler + apps/*)"
	@echo "  dev-mcp      Start only MCP server (HTTP on port 3333)"
	@echo "  dev-crawl    Run crawler only (no long-running services)"
	@echo "  dev-web      Start web frontend only (apps/web - Milestone 3)"
	@echo "  dev-api      Start BFF API only (apps/api - Milestone 2)"
	@echo "  dev-worker   Start FastAPI worker only (apps/worker - Milestone 1)"
	@echo ""
	@echo "Production:"
	@echo "  run          Run crawler (production mode, full output)"
	@echo "  crawl        Run crawler (alias for run)"
	@echo "  mcp          Start MCP server (STDIO mode)"
	@echo "  mcp-http     Start MCP server (HTTP on port 3333)"
	@echo ""
	@echo "Deployment:"
	@echo "  install      Install as systemd services (requires sudo)"
	@echo "  uninstall    Remove systemd services (requires sudo)"
	@echo "  docker       Start Docker containers"
	@echo "  docker-build Build and start Docker containers"
	@echo "  docker-down  Stop Docker containers"
	@echo ""
	@echo "Dependencies:"
	@echo "  install-deps Install Python/Node deps for development"
	@echo ""
	@echo "Documentation:"
	@echo "  fetch-docs   Fetch latest upstream documentation"
	@echo ""
	@echo "Utilities:"
	@echo "  clean        Remove generated/cached files"
	@echo "  check        Run basic health checks"
	@echo "  help         Show this help message"
	@echo ""
	@echo "Environment Variables:"
	@echo "  ENV_FILE     Path to .env file (default: .env)"
	@echo "  MCP_PORT     MCP server port (default: 3333)"
	@echo "  WORKER_PORT  FastAPI worker port (default: 8000)"
	@echo "  API_PORT     BFF API port (default: 3000)"
	@echo "  WEB_PORT     Web frontend port (default: 5173)"
