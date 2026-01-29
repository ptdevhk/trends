# TrendRadar Development Makefile

.PHONY: dev dev-mcp dev-crawl dev-web dev-api dev-worker dev-api-worker run crawl mcp mcp-http \
        worker worker-once install install-deps uninstall fetch-docs clean check help docker docker-build docker-down \
        build-static build-static-fresh serve-static \
        i18n-check i18n-sync i18n-convert i18n-translate i18n-build

# Default target
.DEFAULT_GOAL := help

# =============================================================================
# Development (Full Experience)
# =============================================================================

# Start all available services (MCP server + crawler + apps/*)
dev:
	./scripts/dev.sh $(ARGS)

# Start only MCP server (HTTP mode for development)
dev-mcp:
	./scripts/dev.sh --mcp-only $(ARGS)

# Run crawler only (no long-running services)
dev-crawl:
	./scripts/dev.sh --crawl-only $(ARGS)

# Start web frontend only (React + Vite on port 5173)
dev-web:
	@if [ -d "apps/web" ]; then \
		cd apps/web && npm run dev; \
	else \
		echo "apps/web not found. Create it with Milestone 3 (React Frontend)"; \
		exit 1; \
	fi

# Start Hono BFF API only (TypeScript on port 3000)
dev-api:
	@if [ -d "apps/api" ]; then \
		cd apps/api && npm run dev; \
	else \
		echo "apps/api not found. Create it with Milestone 2 (Hono BFF)"; \
		exit 1; \
	fi

# Start FastAPI worker REST API only (port 8000)
dev-api-worker:
	@if [ -d "apps/worker" ]; then \
		uv run uvicorn apps.worker.api:app --reload --port 8000; \
	else \
		echo "apps/worker not found. Create it with Milestone 1 (FastAPI Wrapper)"; \
		exit 1; \
	fi

# Start worker scheduler (runs immediately + every 30 minutes, verbose)
dev-worker:
	@if [ -d "apps/worker" ]; then \
		uv run python -m apps.worker --run-now --interval 30 -v; \
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

# MCP server (STDIO mode - for MCP clients over stdio)
mcp:
	uv run python -m mcp_server.server

# MCP server (HTTP mode - for web-based clients)
mcp-http:
	uv run python -m mcp_server.server --transport http --port 3333

# Worker scheduler (production mode)
worker:
	uv run python -m apps.worker

# Worker scheduler (run once and exit)
worker-once:
	uv run python -m apps.worker --once

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
# Static Site
# =============================================================================

# Build static site from existing output
build-static:
	./scripts/build-static.sh

# Run crawler first, then build static site
build-static-fresh:
	./scripts/build-static.sh --fresh

# Serve static site locally (port 8000)
serve-static:
	@echo "Serving static site at http://localhost:8000"
	python -m http.server -d dist 8000

# =============================================================================
# i18n (Internationalization)
# =============================================================================

# Check locale files for missing/extra keys
i18n-check:
	uv run python scripts/i18n/sync_keys.py

# Auto-fix missing keys with placeholders
i18n-sync:
	uv run python scripts/i18n/sync_keys.py --fix

# Convert zh-Hant to zh-Hans using OpenCC
i18n-convert:
	uv run python scripts/i18n/convert_opencc.py

# Translate zh-Hant to English using AI
i18n-translate:
	uv run python scripts/i18n/ai_translate.py

# Build static sites for all locales
i18n-build:
	uv run python scripts/i18n/build_static.py --clean

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
	@echo "  dev            Start all services (MCP + crawler + apps/*)"
	@echo "  dev-mcp        Start only MCP server (HTTP on port 3333)"
	@echo "  dev-crawl      Run crawler only (no long-running services)"
	@echo "  dev-web        Start React frontend (Vite on port 5173)"
	@echo "  dev-api        Start Hono BFF API server (port 3000)"
	@echo "  dev-api-worker Start FastAPI worker REST API (port 8000)"
	@echo "  dev-worker     Start worker scheduler (run now + verbose)"
	@echo ""
	@echo "Production:"
	@echo "  run            Run crawler (production mode, full output)"
	@echo "  crawl          Run crawler (alias for run)"
	@echo "  mcp            Start MCP server (STDIO mode)"
	@echo "  mcp-http       Start MCP server (HTTP on port 3333)"
	@echo "  worker         Start worker scheduler (default: every 30 min)"
	@echo "  worker-once    Run worker once and exit"
	@echo ""
	@echo "Deployment:"
	@echo "  install        Install as systemd services (requires sudo)"
	@echo "  uninstall      Remove systemd services (requires sudo)"
	@echo "  docker         Start Docker containers"
	@echo "  docker-build   Build and start Docker containers"
	@echo "  docker-down    Stop Docker containers"
	@echo ""
	@echo "Static Site:"
	@echo "  build-static       Build static site from existing output"
	@echo "  build-static-fresh Run crawler first, then build static site"
	@echo "  serve-static       Serve static site locally (port 8000)"
	@echo ""
	@echo "i18n (Internationalization):"
	@echo "  i18n-check     Check locale files for missing/extra keys"
	@echo "  i18n-sync      Auto-fix missing keys with placeholders"
	@echo "  i18n-convert   Convert zh-Hant to zh-Hans (OpenCC)"
	@echo "  i18n-translate Translate zh-Hant to English (AI)"
	@echo "  i18n-build     Build static sites for all locales"
	@echo ""
	@echo "Dependencies:"
	@echo "  install-deps   Install Python/Node deps for development"
	@echo ""
	@echo "Documentation:"
	@echo "  fetch-docs     Fetch latest upstream documentation"
	@echo ""
	@echo "Utilities:"
	@echo "  clean          Remove generated/cached files"
	@echo "  check          Run basic health checks"
	@echo "  help           Show this help message"
	@echo ""
	@echo "Environment Variables:"
	@echo "  ENV_FILE       Path to .env file (default: .env)"
	@echo "  MCP_PORT       MCP server port (default: 3333)"
	@echo "  WORKER_PORT    FastAPI worker port (default: 8000)"
	@echo "  API_PORT       BFF API port (default: 3000)"
	@echo "  WEB_PORT       Web frontend port (default: 5173)"
