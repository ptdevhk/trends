# TrendRadar Development Makefile

.PHONY: dev crawl dev-mcp mcp mcp-http install-deps install clean check fetch-docs help

# Default target
.DEFAULT_GOAL := help

# Development
dev:
	./scripts/dev.sh

crawl:
	uv run python -m trendradar

dev-mcp:
	uv run python -m mcp_server.server --transport http --port 3333

# MCP server (STDIO mode)
mcp:
	uv run python -m mcp_server.server

# MCP server (HTTP mode)
mcp-http:
	uv run python -m mcp_server.server --transport http --port 3333

# Dependencies
install-deps:
	./scripts/install-deps.sh

# Legacy alias
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
	uv run python -m trendradar --help

# Show help
help:
	@echo "TrendRadar Development Commands"
	@echo ""
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@echo "  dev          Start development environment (runs trendradar)"
	@echo "  crawl        Run crawler manually (old workflow)"
	@echo "  dev-mcp      Start MCP server (HTTP on port 3333)"
	@echo "  mcp          Start MCP server (STDIO)"
	@echo "  mcp-http     Start MCP server (HTTP on port 3333)"
	@echo "  install-deps Install Python/Node dependencies"
	@echo "  install      Install Python dependencies with uv (legacy)"
	@echo "  fetch-docs   Fetch latest upstream documentation"
	@echo "  clean        Remove generated/cached files"
	@echo "  check        Run checks (verify trendradar works)"
	@echo "  help         Show this help message"
