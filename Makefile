# TrendRadar Development Makefile

.PHONY: dev run crawl mcp mcp-http install install-deps fetch-docs clean check help

# Default target
.DEFAULT_GOAL := help

# Development
dev:
	./scripts/dev.sh

crawl:
	uv run python -m trendradar

dev-mcp:
	uv run python -m mcp_server.server --transport http --port 3333

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

# Legacy install (alias)
install:
	uv sync

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
	@echo ""
	@echo "Production:"
	@echo "  run          Run crawler (production mode, full output)"
	@echo "  mcp          Start MCP server (STDIO)"
	@echo "  mcp-http     Start MCP server (HTTP on port 3333)"
	@echo ""
	@echo "Dependencies:"
	@echo "  install-deps Install Python/Node deps"
	@echo "  install      Install Python deps with uv (legacy)"
	@echo ""
	@echo "Documentation:"
	@echo "  fetch-docs   Fetch latest upstream documentation"
	@echo ""
	@echo "Utilities:"
	@echo "  clean        Remove generated/cached files"
	@echo "  check        Run basic checks"
	@echo "  help         Show this help message"
