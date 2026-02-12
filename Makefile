# TrendRadar Development Makefile

.PHONY: dev dev-fast dev-critical dev-backend dev-clean dev-mcp dev-crawl dev-web dev-api dev-worker dev-api-worker run crawl mcp mcp-http \
		worker worker-once install install-deps uninstall fetch-docs clean check help docker docker-build docker-down \
		check-python check-node check-build \
		test test-python test-node test-resume \
		build-static build-static-fresh serve-static \
		i18n-check i18n-sync i18n-convert i18n-translate i18n-build \
		refresh-sample refresh-sample-manual prefetch-convex chrome-debug \
		seed seed-full seed-force \
		sync-agent-policy check-agent-policy install-agent-skill check-agent-skill sync-agent-governance \
		clean-db fresh-env

# Default target
.DEFAULT_GOAL := help

.PHONY: seed-matches clear-matches verify-critical-path benchmark-critical-path benchmark-critical-path-seeded benchmark-parallelism-matrix

# =============================================================================
# Development (Full Experience)
# =============================================================================

# Start all available services (MCP server + crawler + apps/* + Convex)
dev:
	@chmod +x scripts/sync-convex-env.sh
	@if [ -f "packages/convex/.env.local" ] || [ -f ".env.local" ] || [ -n "$${CONVEX_URL:-}" ]; then \
		./scripts/sync-convex-env.sh; \
	else \
		echo "Skipping Convex env sync (no Convex .env.local found yet)"; \
	fi
	@if [ "$${SKIP_MATCH_SEED:-false}" = "true" ]; then \
		echo "Skipping seed-matches (SKIP_MATCH_SEED=true)"; \
	else \
		npx tsx scripts/seed-matches.ts; \
	fi
	./scripts/dev.sh $(ARGS)

# Start only critical-path services (Convex + scraper + API + web)
dev-critical:
	@WEB_SKIP_API_GEN=true ./scripts/dev.sh --profile critical $(ARGS)

# Start only UI-focused services (Convex + API + web)
dev-fast:
	@WEB_SKIP_API_GEN=true ./scripts/dev.sh --profile fast-ui $(ARGS)

# Start backend-focused services (Convex + MCP + worker + scraper + API)
dev-backend:
	./scripts/dev.sh --profile backend $(ARGS)

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
		uv run uvicorn apps.worker.api:app --reload --port $${TRENDS_WORKER_PORT:-8000}; \
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

# Prefetch Convex local backend and dashboard assets into local cache
prefetch-convex:
	./scripts/prefetch-convex-backend.sh

# =============================================================================
# Documentation
# =============================================================================

# Fetch latest upstream documentation
fetch-docs:
	./dev-docs/fetch-docs.sh

# Sync dev-docs/AGENTS.md from canonical AGENTS policy block
sync-agent-policy:
	@if command -v bun > /dev/null 2>&1; then \
		bunx tsx scripts/agent-governance/sync-policy.ts; \
	else \
		npx tsx scripts/agent-governance/sync-policy.ts; \
	fi

# Validate dev-docs/AGENTS.md matches canonical AGENTS policy block
check-agent-policy:
	@if command -v bun > /dev/null 2>&1; then \
		bunx tsx scripts/agent-governance/sync-policy.ts --check; \
	else \
		npx tsx scripts/agent-governance/sync-policy.ts --check; \
	fi

# Install repo governance skill into ${CODEX_HOME:-$HOME/.codex}/skills
install-agent-skill:
	@./scripts/agent-governance/install-skill.sh

# Validate repo governance skill structure + installed skill sync (local only)
check-agent-skill:
	@if command -v bun > /dev/null 2>&1; then \
		bunx tsx scripts/agent-governance/validate-skill.ts; \
	else \
		npx tsx scripts/agent-governance/validate-skill.ts; \
	fi
	@if [ "$$CI" = "true" ]; then \
		echo "Skipping installed skill drift check in CI"; \
	else \
		./scripts/agent-governance/install-skill.sh --check; \
	fi

# Sync all governance artifacts
sync-agent-governance: sync-agent-policy install-agent-skill

# =============================================================================
# Utilities
# =============================================================================

# Seed Convex with system job descriptions (idempotent)
seed:
	@if command -v bun > /dev/null 2>&1; then \
		bun scripts/seed-convex.ts; \
	else \
		npx tsx scripts/seed-convex.ts; \
	fi

# Seed Convex with system job descriptions + sample resumes (idempotent)
seed-full:
	@if command -v bun > /dev/null 2>&1; then \
		bun scripts/seed-convex.ts --with-resumes; \
	else \
		npx tsx scripts/seed-convex.ts --with-resumes; \
	fi

# Force seeding even when DB is not empty (idempotent)
seed-force:
	@if command -v bun > /dev/null 2>&1; then \
		bun scripts/seed-convex.ts --force; \
	else \
		npx tsx scripts/seed-convex.ts --force; \
	fi

# Seed deterministic resume matches into output/resume_screening.db
seed-matches:
	@npx tsx scripts/seed-matches.ts

# Clear cached resume matches from output/resume_screening.db
clear-matches:
	@npx tsx scripts/clear-matches.ts

# Verify critical path (Collection -> Search -> Analysis)
verify-critical-path:
	@if command -v bun > /dev/null 2>&1; then \
		MODE="$(or $(MODE),dual)" \
		KEYWORD="$(or $(KEYWORD),CNC)" \
		LOCATION="$(or $(LOCATION),广东)" \
		COLLECTION_TIMEOUT_SEC="$(or $(COLLECTION_TIMEOUT_SEC),180)" \
		ANALYSIS_TIMEOUT_SEC="$(or $(ANALYSIS_TIMEOUT_SEC),300)" \
		JSON="$(JSON)" \
		bun scripts/verify-critical-path.ts $(ARGS); \
	else \
		MODE="$(or $(MODE),dual)" \
		KEYWORD="$(or $(KEYWORD),CNC)" \
		LOCATION="$(or $(LOCATION),广东)" \
		COLLECTION_TIMEOUT_SEC="$(or $(COLLECTION_TIMEOUT_SEC),180)" \
		ANALYSIS_TIMEOUT_SEC="$(or $(ANALYSIS_TIMEOUT_SEC),300)" \
		JSON="$(JSON)" \
		npx tsx scripts/verify-critical-path.ts $(ARGS); \
	fi

# Benchmark critical path with repeated runs (median/p95 + pass/degraded/fail rates)
benchmark-critical-path:
	@if command -v bun > /dev/null 2>&1; then \
		RUNS="$(or $(RUNS),10)" \
		WARMUP="$(or $(WARMUP),1)" \
		MODES="$(or $(MODES),seeded,dual)" \
		KEYWORD="$(or $(KEYWORD),CNC)" \
		LOCATION="$(or $(LOCATION),广东)" \
		BASELINE="$(BASELINE)" \
		STRICT="$(STRICT)" \
		JSON="$(JSON)" \
		OUT="$(OUT)" \
		bun scripts/benchmark-critical-path.ts $(ARGS); \
	else \
		RUNS="$(or $(RUNS),10)" \
		WARMUP="$(or $(WARMUP),1)" \
		MODES="$(or $(MODES),seeded,dual)" \
		KEYWORD="$(or $(KEYWORD),CNC)" \
		LOCATION="$(or $(LOCATION),广东)" \
		BASELINE="$(BASELINE)" \
		STRICT="$(STRICT)" \
		JSON="$(JSON)" \
		OUT="$(OUT)" \
		npx tsx scripts/benchmark-critical-path.ts $(ARGS); \
	fi

# Convenience benchmark mode for seeded-only verification
benchmark-critical-path-seeded:
	@$(MAKE) benchmark-critical-path \
		MODES=seeded \
		RUNS="$(or $(RUNS),10)" \
		WARMUP="$(or $(WARMUP),1)" \
		KEYWORD="$(or $(KEYWORD),CNC)" \
		LOCATION="$(or $(LOCATION),广东)" \
		BASELINE="$(BASELINE)" \
		STRICT="$(STRICT)" \
		JSON="$(JSON)" \
		OUT="$(OUT)" \
		ARGS="$(ARGS)"

# Benchmark matrix for parallelism tuning (seeded mode short runs)
benchmark-parallelism-matrix:
	@mkdir -p output/benchmarks
	@timestamp=$$(date +%Y%m%d-%H%M%S); \
	matrix_file="output/benchmarks/parallelism-matrix-$$timestamp.json"; \
	runs="$(or $(RUNS),3)"; \
	warmup="$(or $(WARMUP),0)"; \
	modes="$(or $(MODES),seeded)"; \
	keyword="$(or $(KEYWORD),CNC)"; \
	location="$(or $(LOCATION),广东)"; \
	echo "[]" > "$$matrix_file"; \
	for ai in 2 4 8 12; do \
		for submit in 4 8 16 24; do \
			echo "Benchmarking AI_ANALYSIS_PARALLELISM=$$ai SUBMIT_RESUME_PARALLELISM=$$submit"; \
			run_file=$$(mktemp); \
			if command -v bun > /dev/null 2>&1; then \
				AI_ANALYSIS_PARALLELISM="$$ai" \
				SUBMIT_RESUME_PARALLELISM="$$submit" \
				RUNS="$$runs" \
				WARMUP="$$warmup" \
				MODES="$$modes" \
				KEYWORD="$$keyword" \
				LOCATION="$$location" \
				JSON=1 \
				bun scripts/benchmark-critical-path.ts > "$$run_file"; \
			else \
				AI_ANALYSIS_PARALLELISM="$$ai" \
				SUBMIT_RESUME_PARALLELISM="$$submit" \
				RUNS="$$runs" \
				WARMUP="$$warmup" \
				MODES="$$modes" \
				KEYWORD="$$keyword" \
				LOCATION="$$location" \
				JSON=1 \
				npx tsx scripts/benchmark-critical-path.ts > "$$run_file"; \
			fi; \
			node -e 'const fs = require("node:fs"); const matrixPath = process.argv[1]; const runPath = process.argv[2]; const ai = Number(process.argv[3]); const submit = Number(process.argv[4]); const benchmark = JSON.parse(fs.readFileSync(runPath, "utf8")); const summaryByMode = benchmark.summaryByMode && typeof benchmark.summaryByMode === "object" ? benchmark.summaryByMode : {}; const modeNames = Object.keys(summaryByMode); const selectedMode = modeNames.length > 0 ? modeNames[0] : "seeded"; const selectedSummary = summaryByMode[selectedMode] && typeof summaryByMode[selectedMode] === "object" ? summaryByMode[selectedMode] : {}; const rows = JSON.parse(fs.readFileSync(matrixPath, "utf8")); rows.push({ aiAnalysisParallelism: ai, submitResumeParallelism: submit, mode: selectedMode, count: selectedSummary.count ?? 0, passRate: selectedSummary.passRate ?? 0, degradedRate: selectedSummary.degradedRate ?? 0, failRate: selectedSummary.failRate ?? 0, medianMs: selectedSummary.medianMs ?? null, p95Ms: selectedSummary.p95Ms ?? null, minMs: selectedSummary.minMs ?? null, maxMs: selectedSummary.maxMs ?? null }); fs.writeFileSync(matrixPath, JSON.stringify(rows, null, 2));' "$$matrix_file" "$$run_file" "$$ai" "$$submit"; \
			rm -f "$$run_file"; \
		done; \
	done; \
	echo "Parallelism matrix written to $$matrix_file"; \
	cat "$$matrix_file"

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

# Start Chrome with remote debugging on port 9222 (for CDP/MCP)
chrome-debug:
	@chmod +x scripts/chrome-debug.sh
	./scripts/chrome-debug.sh

# Remove generated/cached files
clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	rm -rf node_modules .venv build dist

# Clean local databases and environment for a fresh start
clean-db:
	@echo "Cleaning local databases..."
	# Remove ignored files in output/ (like .db files) but KEEP tracked samples
	@if command -v git > /dev/null 2>&1 && git rev-parse --is-inside-work-tree > /dev/null 2>&1; then \
		git clean -fdX output/; \
	else \
		rm -f output/*.db output/**/*.db; \
		rm -rf output/news output/rss; \
	fi
	rm -f packages/convex/.env.local apps/web/.env.local
	@if [ -d "$$HOME/.convex/anonymous-convex-backend-state" ]; then \
		echo "Wiping local Convex backend state..."; \
		rm -rf "$$HOME/.convex/anonymous-convex-backend-state"; \
	fi
	@echo "Local databases cleaned."

# Wipe everything including dependencies and logs for a fresh environment
fresh-env: clean clean-db
	@echo "Cleaning logs..."
	rm -rf logs/*.log api.log web.log
	@echo "Reinstalling dependencies..."
	$(MAKE) install-deps
	@echo "Fresh environment ready."

# Run all validation checks (Python + Node.js)
check: check-python check-node check-agent-policy check-agent-skill
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
		(cd apps/web && npm test); \
	else \
		echo "No TypeScript tests found (*.test.ts/*.test.tsx), skipping"; \
	fi

test-coverage:                             ## Run Node.js tests with coverage
	@echo "Running Node.js tests with coverage..."
	@(cd apps/web && npm run test -- --coverage)

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
	@echo "  dev-fast       Start fast UI loop (Convex + API + web)"
	@echo "  dev-critical   Start critical-path loop (Convex + scraper + API + web)"
	@echo "  dev-backend    Start backend loop (Convex + MCP + worker + scraper + API)"
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
	@echo "  prefetch-convex Prefetch Convex local backend + dashboard assets"
	@echo ""
	@echo "Documentation:"
	@echo "  fetch-docs     Fetch latest upstream documentation"
	@echo "  sync-agent-policy Sync generated dev-docs/AGENTS.md from canonical AGENTS policy"
	@echo "  check-agent-policy Validate generated dev-docs/AGENTS.md is up to date"
	@echo "  install-agent-skill Install governance skill into ~/.codex/skills"
	@echo "  check-agent-skill Validate governance skill, command, rules file, and installed copy drift"
	@echo "  sync-agent-governance Run policy sync + skill install"
	@echo ""
	@echo "Utilities:"
	@echo "  seed           Seed Convex with system job descriptions"
	@echo "  seed-full      Seed Convex with system job descriptions + sample resumes"
	@echo "  seed-force     Force seed Convex even if DB is not empty"
	@echo "  seed-matches   Seed deterministic resume matches for dev mode"
	@echo "  clear-matches  Clear cached resume matches from SQLite"
	@echo "  verify-critical-path Run critical-path smoke verification (Collection -> Search -> Analysis)"
	@echo "  benchmark-critical-path Run repeated critical-path benchmark (median/p95 + rates)"
	@echo "  benchmark-critical-path-seeded Run seeded-only benchmark profile"
	@echo "  benchmark-parallelism-matrix Run AI/submit parallelism benchmark matrix"
	@echo "  refresh-sample Auto-refresh resume sample data via CDP"
	@echo "  refresh-sample-manual Show manual instructions for refreshing resume sample data"
	@echo "  chrome-debug   Start Google Chrome with remote debugging (port 9222)"
	@echo "  clean          Remove generated/cached files"
	@echo "  check          Run validation checks (Python + Node)"
	@echo "  check-python   Run Python checks only"
	@echo "  check-node     Run Node.js checks only"
	@echo "  check-build    Run checks + build validation"
	@echo "  test           Run all tests (Python + Node)"
	@echo "  test-python    Run Python tests only"
	@echo "  test-node      Run Node.js tests only"
	@echo "  test-resume    Validate resume fixtures"
	@echo "  clean-db       Clean local databases and environment (Convex state + SQLite)"
	@echo "  fresh-env      Wipe everything and reinstall dependencies (nuclear option)"
	@echo "  help           Show this help message"
	@echo ""
	@echo "Environment Variables:"
	@echo "  ENV_FILE       Optional env file path (unset by default)"
	@echo "  SKIP_MATCH_SEED Set to true to skip automatic seed-matches in make dev"
	@echo "  SERVICE_PROFILE Default service profile when running scripts/dev.sh (full|critical|fast-ui|backend)"
	@echo "  WEB_SKIP_API_GEN Set to true to start web without OpenAPI type generation"
	@echo "  MCP_PORT       MCP server port (default: 3333)"
	@echo "  TRENDS_WORKER_PORT FastAPI worker port (default: 8000)"
	@echo "  API_PORT       BFF API port (default: 3000)"
	@echo "  WEB_PORT       Web frontend port (default: 5173)"
	@echo "  CDP_PORT       Chrome DevTools port (default: 9222)"
	@echo "  ALLOW_EMPTY    Allow empty resume samples (set to 1)"
	@echo "  KEYWORD        Search keyword for refresh-sample / verify / benchmark"
	@echo "  SAMPLE         Sample name for refresh-sample (default: sample-initial)"
	@echo "  LOCATION       Location filter for refresh-sample / verify / benchmark"
	@echo "  RUNS           Benchmark measured runs per mode (default: 10, matrix: 3)"
	@echo "  WARMUP         Benchmark warmup runs per mode (default: 1, matrix: 0)"
	@echo "  MODES          Benchmark modes list (default: seeded,dual; matrix: seeded)"
	@echo "  BASELINE       Baseline benchmark JSON path for regression compare"
	@echo "  STRICT         Set 1/true to fail benchmark on >25% slowdown"
	@echo "  OUT            Benchmark JSON output path (set to 1/true for default path)"
	@echo "  MODE           Verification mode for verify-critical-path (dual|live|seeded)"
	@echo "  COLLECTION_TIMEOUT_SEC Collection stage timeout for verify-critical-path"
	@echo "  ANALYSIS_TIMEOUT_SEC Analysis stage timeout for verify-critical-path"
	@echo "  JSON           Set to 1/true for JSON verify/benchmark output"
