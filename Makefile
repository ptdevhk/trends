# TrendRadar Development Makefile

.PHONY: dev run crawl mcp mcp-http dev-worker dev-api install install-deps fetch-docs clean check help docker docker-build

# Default target
.DEFAULT_GOAL := help

# Development
dev:
	./scripts/dev.sh

crawl:
	uv run python -m trendradar

dev-mcp:
	uv run python -m mcp_server.server --transport http --port 3333

# FastAPI Worker (REST API)
dev-worker:
	uv run uvicorn apps.worker.main:app --reload --port 8000

# Hono BFF API (TypeScript)
dev-api:
	cd apps/api && npm run dev

# Production run (default behavior, writes root index.html for GitHub Pages)
run:
	uv run python -m trendradar

# MCP server (STDIO mode)
mcp:
	uv run python -m mcp_server.server

# MCP server (HTTP mode)
mcp-http:
	uv run python -m mcp_server.server --transport http --port 3333

# Dependencies
install-deps:
	./scripts/install-deps.sh

# Production install (systemd services)
install:
	sudo ./scripts/install.sh

# Uninstall systemd services
uninstall:
	sudo ./scripts/install.sh uninstall

# Docker targets
docker:
	cd deploy/docker && docker compose up -d

docker-build:
	cd deploy/docker && docker compose -f docker-compose-build.yml up -d --build

docker-down:
	cd deploy/docker && docker compose down

# Documentation
fetch-docs:
	./dev-docs/fetch-docs.sh

# Cleanup
clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	rm -rf node_modules .venv build dist

# Checks
check:
	uv run python -c "import trendradar; print(f'trendradar v{trendradar.__version__} OK')"

# Show help
help:
	@echo "TrendRadar Development Commands"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Development:"
	@echo "  dev          Run crawler using scripts/dev.sh"
	@echo "  crawl        Run crawler manually (old workflow)"
	@echo "  dev-mcp      Start MCP server (HTTP on port 3333)"
	@echo "  dev-worker   Start FastAPI worker (REST API on port 8000)"
	@echo "  dev-api      Start Hono BFF API server (HTTP on port 3000)"
	@echo ""
	@echo "Production:"
	@echo "  run          Run crawler (production mode, full output)"
	@echo "  mcp          Start MCP server (STDIO)"
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
	@echo "  check        Run basic checks"
	@echo "  help         Show this help message"
