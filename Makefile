# TrendRadar Development Makefile

.PHONY: dev dev-crawler dev-mcp dev-watch run mcp mcp-http \
        install install-deps install-prod clean help \
        docker docker-up docker-down plugin-new

# Default target
.DEFAULT_GOAL := help

# =============================================================================
# Development (no Docker required)
# =============================================================================

# Start all services natively
dev:
	./scripts/dev.sh all

# Crawler only (dev mode)
dev-crawler:
	./scripts/dev.sh crawler

# MCP server only (HTTP mode)
dev-mcp:
	./scripts/dev.sh mcp

# Auto-reload on file changes (requires watchdog)
dev-watch:
	uv run watchmedo auto-restart -d trendradar/ -d mcp_server/ -p '*.py' -- python -m trendradar

# =============================================================================
# Production Run
# =============================================================================

# Production run (writes root index.html for GitHub Pages)
run:
	uv run python -m trendradar

# MCP server (STDIO mode - for MCP clients like Claude Desktop)
mcp:
	uv run python -m mcp_server.server

# MCP server (HTTP mode)
mcp-http:
	uv run python -m mcp_server.server --transport http --port 3333

# =============================================================================
# Dependencies
# =============================================================================

# Install all dependencies (Python + Node.js if applicable)
install-deps:
	./scripts/install-deps.sh

# Install Python dependencies only (legacy alias)
install:
	uv sync

# Production setup (systemd services)
install-prod:
	./scripts/install.sh --production

# =============================================================================
# Docker Deployment
# =============================================================================

docker: docker-up

docker-up:
	docker compose -f deploy/docker/docker-compose.yml up -d

docker-down:
	docker compose -f deploy/docker/docker-compose.yml down

docker-build:
	docker compose -f deploy/docker/docker-compose.yml build

docker-logs:
	docker compose -f deploy/docker/docker-compose.yml logs -f

# =============================================================================
# Plugins
# =============================================================================

# Scaffold a new plugin
plugin-new:
	@echo "Plugin scaffolding"
	@echo ""
	@echo "Available plugin types:"
	@echo "  - crawler   (data source)"
	@echo "  - notifier  (notification channel)"
	@echo "  - ai        (AI provider)"
	@echo ""
	@echo "Usage:"
	@echo "  cp plugins/crawlers/base.py plugins/crawlers/custom/my_crawler.py"
	@echo "  # Edit the file and implement the required methods"
	@echo "  # Add 'my_crawler' to config.yaml platforms list"

# =============================================================================
# Cleanup
# =============================================================================

# Remove generated files
clean:
	rm -rf output/
	rm -f index.html

# Deep clean (includes caches)
clean-all: clean
	rm -rf __pycache__ .pytest_cache .mypy_cache
	find . -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name '*.pyc' -delete 2>/dev/null || true

# =============================================================================
# Help
# =============================================================================

help:
	@echo "TrendRadar Development Commands"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Development (no Docker):"
	@echo "  dev           Start all services natively"
	@echo "  dev-crawler   Start only the crawler"
	@echo "  dev-mcp       Start only the MCP server (HTTP)"
	@echo "  dev-watch     Auto-reload on file changes"
	@echo ""
	@echo "Production:"
	@echo "  run           Run crawler (full output)"
	@echo "  mcp           Start MCP server (STDIO mode)"
	@echo "  mcp-http      Start MCP server (HTTP mode)"
	@echo ""
	@echo "Dependencies:"
	@echo "  install-deps  Install all dependencies"
	@echo "  install       Install Python dependencies only"
	@echo "  install-prod  Production setup (systemd)"
	@echo ""
	@echo "Docker:"
	@echo "  docker        Start Docker services"
	@echo "  docker-down   Stop Docker services"
	@echo "  docker-build  Build Docker images"
	@echo "  docker-logs   View Docker logs"
	@echo ""
	@echo "Other:"
	@echo "  plugin-new    Show plugin scaffolding help"
	@echo "  clean         Remove generated files"
	@echo "  clean-all     Deep clean (includes caches)"
	@echo "  help          Show this help message"
