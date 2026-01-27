# TrendRadar Development Makefile

.PHONY: dev run crawl mcp mcp-http install install-deps fetch-docs clean check help docker docker-build i18n-check i18n-sync i18n-convert i18n-translate i18n-build

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

# i18n (Internationalization)
i18n-check:
	uv run python scripts/i18n/sync_keys.py

i18n-sync:
	uv run python scripts/i18n/sync_keys.py --fix

i18n-convert:
	uv run python scripts/i18n/convert_opencc.py

i18n-translate:
	uv run python scripts/i18n/ai_translate.py

i18n-build:
	uv run python scripts/i18n/build_static.py --clean

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
	@echo ""
	@echo "i18n (Internationalization):"
	@echo "  i18n-check     Check locale files for missing/extra keys"
	@echo "  i18n-sync      Auto-fix missing keys with placeholders"
	@echo "  i18n-convert   Convert zh-Hant to zh-Hans (OpenCC)"
	@echo "  i18n-translate Translate zh-Hant to English (AI)"
	@echo "  i18n-build     Build static sites for all locales"
