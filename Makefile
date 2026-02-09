# TrendRadar Development Makefile

.PHONY: dev dev-clean dev-mcp dev-crawl dev-web dev-api dev-worker dev-api-worker run crawl mcp mcp-http \
        worker worker-once install install-deps uninstall fetch-docs clean check help docker docker-build docker-down \
        check-python check-node check-build \
        test test-python test-node test-resume \
        build-static build-static-fresh serve-static \
        i18n-check i18n-sync i18n-convert i18n-translate i18n-build \
        refresh-sample refresh-sample-manual

# Default target
.DEFAULT_GOAL := help

# =============================================================================
# Development (Full Experience)
# =============================================================================

# Start all available services (MCP server + crawler + apps/*)
# Start all available services (MCP server + crawler + apps/* + Convex)
dev:
	@chmod +x scripts/sync-convex-env.sh
	@./scripts/sync-convex-env.sh
	@# Run convex dev in background or parallel? dev.sh handles procfile-like behavior?
	@# Assuming dev.sh runs a procfile or similar. Let's add it there or just run it here if simple.
	@# Actually, let's just delegate to dev.sh and add convex there if possible, 
	@# BUT user asked to add steps in dev script 'make dev'.
	@# Let's verify dev.sh content. For now, just running dev.sh.
	./scripts/dev.sh $(ARGS)

# Stop/clean any stale development services and ports
dev-clean:
	@chmod +x scripts/clean-dev.sh
	@./scripts/clean-dev.sh

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

# Refresh resume sample data automatically via CDP
refresh-sample:
	@KEYWORD="$(or $(KEYWORD),销售)" SAMPLE="$(or $(SAMPLE),sample-initial)" \
	CDP_PORT="$(or $(CDP_PORT),9222)" \
	ALLOW_EMPTY="$(ALLOW_EMPTY)" \
	LOCATION="$(LOCATION)" \
	./scripts/refresh-sample.sh --limit $(or $(LIMIT),200) --max-pages $(or $(MAX_PAGES),10)

# Show instructions for refreshing resume sample data
refresh-sample-manual:
	@echo "=== Refresh Resume Sample Data (Manual) ==="
	@echo "1. Log into https://hr.job5156.com in Chrome (extension installed)"
	@echo "2. Navigate to this URL:"
	@echo "   https://hr.job5156.com/search?keyword=销售&tr_auto_export=json&tr_sample_name=sample-initial"
	@echo "   To filter by location, add &location=广东 to the URL"
	@echo "3. Copy downloaded file to: output/resumes/samples/"
	@echo ""
	@echo "The exported file includes metadata for reproduction."

# Remove generated/cached files
clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	rm -rf node_modules .venv build dist

# Run all validation checks (Python + Node.js)
check: check-python check-node
	@echo "All checks passed"

# Python checks
check-python:
	@echo "Running Python checks..."
	@uv run python -c "import trendradar; print(f'  trendradar v{trendradar.__version__} OK')"
	@uv run python -c "import mcp_server; print(f'  mcp_server v{mcp_server.__version__} OK')"
	@uv run python -c "import apps.worker; print(f'  apps.worker v{apps.worker.__version__} OK')"
	@uv run python -c "from trendradar.core.loader import load_config; load_config('config/config.yaml'); print('  config.yaml OK')"

# Node/TypeScript checks (uses Bun locally when available, npm in CI)
check-node:
	@echo "Running Node.js checks..."
	@npm --workspace @trends/web run gen:api
	@git diff --exit-code apps/web/src/lib/api-types.ts >/dev/null || ( \
		echo "apps/web/src/lib/api-types.ts is out of date. Run 'npm --workspace @trends/web run gen:api' and commit changes."; \
		exit 1; \
	)
	@if [ "$$CI" = "true" ]; then \
		npm run --workspaces --if-present typecheck; \
		npm run --workspace @trends/web lint; \
		npm run --workspace @trends/browser-extension lint; \
	elif command -v bun > /dev/null 2>&1; then \
		bun run check; \
	else \
		npm run --workspaces --if-present typecheck; \
		npm run --workspace @trends/web lint; \
		npm run --workspace @trends/browser-extension lint; \
	fi

# Build validation (for CI)
check-build: check
	@echo "Running build validation..."
	@if [ "$$CI" = "true" ] || ! command -v bun > /dev/null 2>&1; then \
		npm run --workspace @trends/shared build; \
		npm run --workspace @trends/api build; \
		npm run --workspace @trends/web build; \
		if [ -n "$$CONVEX_DEPLOYMENT" ]; then npm run --workspace @trends/convex build; else echo "Skipping @trends/convex build (CONVEX_DEPLOYMENT not set)"; fi; \
	else \
		bun run --filter '@trends/shared' --filter '@trends/api' --filter '@trends/web' build; \
		if [ -n "$$CONVEX_DEPLOYMENT" ]; then bun run --filter '@trends/convex' build; else echo "Skipping @trends/convex build (CONVEX_DEPLOYMENT not set)"; fi; \
	fi

# =============================================================================
# Tests
# =============================================================================

test: test-python test-node                ## Run all tests (Python + TypeScript)

test-python:                               ## Run Python tests
	@echo "Running Python tests..."
	@uv run pytest tests/ -v

test-node:                                 ## Run TypeScript tests (bun locally, npm in CI)
	@echo "Running Node.js tests..."
	@if find apps packages -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) -print -quit 2>/dev/null | grep -q .; then \
		if [ "$$CI" = "true" ]; then \
			npm test; \
		elif command -v bun > /dev/null 2>&1; then \
			bun run test; \
		else \
			npm test; \
		fi; \
	else \
		echo "No TypeScript tests found (*.test.ts/*.test.tsx), skipping"; \
	fi

test-resume:                               ## Validate resume fixtures
	@echo "Validating resume fixtures..."
	@npx tsx scripts/test-resume-fixtures.ts

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
	@echo "  dev-clean      Kill stale dev processes and free dev ports"
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
	@echo "  refresh-sample Auto-refresh resume sample data via CDP"
	@echo "  refresh-sample-manual Show manual instructions for refreshing resume sample data"
	@echo "  clean          Remove generated/cached files"
	@echo "  check          Run validation checks (Python + Node)"
	@echo "  check-python   Run Python checks only"
	@echo "  check-node     Run Node.js checks only"
	@echo "  check-build    Run checks + build validation"
	@echo "  test           Run all tests (Python + Node)"
	@echo "  test-python    Run Python tests only"
	@echo "  test-node      Run Node.js tests only"
	@echo "  test-resume    Validate resume fixtures"
	@echo "  help           Show this help message"
	@echo ""
	@echo "Environment Variables:"
	@echo "  ENV_FILE       Path to .env file (default: .env)"
	@echo "  MCP_PORT       MCP server port (default: 3333)"
	@echo "  WORKER_PORT    FastAPI worker port (default: 8000)"
	@echo "  API_PORT       BFF API port (default: 3000)"
	@echo "  WEB_PORT       Web frontend port (default: 5173)"
	@echo "  CDP_PORT       Chrome DevTools port (default: 9222)"
	@echo "  ALLOW_EMPTY    Allow empty resume samples (set to 1)"
	@echo "  KEYWORD        Search keyword for refresh-sample (default: 销售)"
	@echo "  SAMPLE         Sample name for refresh-sample (default: sample-initial)"
	@echo "  LOCATION       Location filter for refresh-sample (e.g. 广东)"
