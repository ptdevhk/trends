# TrendRadar Development Makefile

.PHONY: dev dev-fast dev-critical dev-backend dev-clean dev-mcp dev-crawl dev-web dev-api dev-worker dev-api-worker run crawl mcp mcp-http \
		worker worker-once install install-seed deploy deploy-check deploy-seed install-deps uninstall fetch-docs clean check help docker docker-build docker-down \
		check-python check-node check-build \
		test test-python test-node test-resume test-extension-keyword-mode test-api-search-profiles test-worker-resume-tasks test-collect-url-smoke \
		build-static build-static-fresh build-extension-zip serve-static \
		i18n-check i18n-sync i18n-convert i18n-translate i18n-build \
		refresh-sample refresh-sample-manual prefetch-convex chrome-debug \
		seed seed-full seed-force seed-clear seed-clear-workspace seed-clear-dev \
		clear-resumes \
		cli-build cli-install cli-test \
		sync-agent-policy check-agent-policy install-agent-skill check-agent-skill sync-agent-governance \
		install-skill validate-skill check-skill-install install-test-plan-skill check-test-plan-skill \
		install-browser-ext-skill check-browser-ext-skill \
		sync-resume-ai-prompts check-resume-ai-prompts \
		clean-db fresh-env refresh-env

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
		if command -v node >/dev/null 2>&1 && [ -d "node_modules/better-sqlite3" ]; then \
			if ! node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.prepare('select 1').get(); db.close();" >/dev/null 2>&1; then \
				echo "Detected better-sqlite3 ABI mismatch; rebuilding (npm rebuild better-sqlite3)..."; \
				npm rebuild better-sqlite3 || echo "Warning: npm rebuild better-sqlite3 failed; continuing dev startup."; \
			fi; \
		fi; \
		if ! npx tsx scripts/seed-matches.ts; then \
			echo "Warning: seed-matches failed; continuing dev startup. (Set SKIP_MATCH_SEED=true to skip)"; \
		fi; \
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
		if [ -f "apps/browser-extension/manifest.json" ] && command -v zip >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then \
			./scripts/build-extension-zip.sh || echo "Warning: build-extension-zip failed; /extension download may be stale."; \
		fi; \
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

# Start worker scheduler (runs immediately, verbose; interval from WORKER_INTERVAL_MINUTES or default 30)
dev-worker:
	@if [ -f ".env" ]; then set -a; . ./.env; set +a; fi; \
	if [ -d "apps/worker" ]; then \
		uv run python -m apps.worker --run-now -v; \
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

# Install as systemd services (production) — seeds JDs + runs migrations
install:
	sudo ENV_FILE="$${ENV_FILE:-.env.production}" WORKSPACE_DIR="$$(pwd)" INSTALL_BRANCH="$${INSTALL_BRANCH:-}" ALLOW_NODE_DOWNGRADE="$${ALLOW_NODE_DOWNGRADE:-}" ./scripts/install.sh install

# Install with full demo data (JDs + sample resumes + migrations)
install-seed:
	sudo ENV_FILE="$${ENV_FILE:-.env.production}" WORKSPACE_DIR="$$(pwd)" INSTALL_BRANCH="$${INSTALL_BRANCH:-}" ALLOW_NODE_DOWNGRADE="$${ALLOW_NODE_DOWNGRADE:-}" SEED_RESUMES=1 ./scripts/install.sh install

# Pull, rebuild, and restart all production services
deploy:
	sudo ENV_FILE="$${ENV_FILE:-.env.production}" WORKSPACE_DIR="$$(pwd)" INSTALL_BRANCH="$${INSTALL_BRANCH:-}" FORCE="$${FORCE:-}" ALLOW_NODE_DOWNGRADE="$${ALLOW_NODE_DOWNGRADE:-}" ./scripts/install.sh upgrade

# Show whether deploy would skip, refresh env only, or run a full upgrade
deploy-check:
	sudo ENV_FILE="$${ENV_FILE:-.env.production}" WORKSPACE_DIR="$$(pwd)" INSTALL_BRANCH="$${INSTALL_BRANCH:-}" FORCE="$${FORCE:-}" ALLOW_NODE_DOWNGRADE="$${ALLOW_NODE_DOWNGRADE:-}" ./scripts/install.sh upgrade-check

# Deploy with full demo data (re-seeds JDs + sample resumes + migrations)
deploy-seed:
	sudo ENV_FILE="$${ENV_FILE:-.env.production}" WORKSPACE_DIR="$$(pwd)" INSTALL_BRANCH="$${INSTALL_BRANCH:-}" FORCE=1 ALLOW_NODE_DOWNGRADE="$${ALLOW_NODE_DOWNGRADE:-}" SEED_RESUMES=1 ./scripts/install.sh upgrade

# Remove systemd services
uninstall:
	sudo ENV_FILE="$${ENV_FILE:-.env.production}" WORKSPACE_DIR="$$(pwd)" ./scripts/install.sh uninstall

# Refresh runtime env and rebuild the production frontend bundle
refresh-env:
	@if [ ! -f .env.production ]; then echo "Error: .env.production not found"; exit 1; fi
	sudo cp .env.production /etc/trends/env; \
	sudo cp .env.production /opt/trends/.env.production; \
	sudo chmod 600 /etc/trends/env; \
	sudo chmod 600 /opt/trends/.env.production; \
	sudo chown trends:trends /etc/trends/env /opt/trends/.env.production; \
	sudo mkdir -p /opt/trends/apps/web; \
	sudo sh -lc "grep -E '^[[:space:]]*VITE_[A-Za-z0-9_]*=' /opt/trends/.env.production | sort > /opt/trends/apps/web/.env.production || true"; \
	sudo chmod 600 /opt/trends/apps/web/.env.production; \
	sudo chown trends:trends /opt/trends/apps/web/.env.production; \
	sudo -u trends -H sh -lc 'set -a && [ -f /etc/trends/env ] && . /etc/trends/env && set +a && cd /opt/trends && ./scripts/sync-convex-env.sh'; \
	echo "Rebuilding web bundle..."; \
	sudo -u trends -H sh -lc 'cd /opt/trends && npm run --workspace @trends/web build'; \
	sudo systemctl daemon-reload; \
	sudo systemctl restart trends-api trends-worker trends-worker-api trends-mcp; \
	echo "✅ Environment refreshed and services restarted"; \
	sudo systemctl is-active --quiet trends-api && echo "  trends-api: active" || echo "  trends-api: FAILED"; \
	sudo systemctl is-active --quiet trends-worker && echo "  trends-worker: active" || echo "  trends-worker: FAILED"; \
	sudo systemctl is-active --quiet trends-worker-api && echo "  trends-worker-api: active" || echo "  trends-worker-api: FAILED"; \
	sudo systemctl is-active --quiet trends-mcp && echo "  trends-mcp: active" || echo "  trends-mcp: FAILED"

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

# Build browser extension zip for web UI download
build-extension-zip:
	./scripts/build-extension-zip.sh

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

# Install Python/Node dependencies for development, Convex prefetch, and governance bootstrap
install-deps:
	./scripts/install-deps.sh

# Prefetch Convex local backend and dashboard assets into local cache
# Honors CONVEX_MIRROR_MODE / CONVEX_MIRROR_BASES / timeout env knobs; see the script --help surface for details.
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

# Sync generated resume AI prompt runtime artifact from canonical markdown prompts
sync-resume-ai-prompts:
	@if command -v bun > /dev/null 2>&1; then \
		bunx tsx scripts/resume/sync-ai-prompts.ts; \
	else \
		npx tsx scripts/resume/sync-ai-prompts.ts; \
	fi

# Validate generated resume AI prompt runtime artifact is up to date
check-resume-ai-prompts:
	@if command -v bun > /dev/null 2>&1; then \
		bunx tsx scripts/resume/sync-ai-prompts.ts --check; \
	else \
		npx tsx scripts/resume/sync-ai-prompts.ts --check; \
	fi

# Install repo governance skill into the requested skills target (default: ${CODEX_HOME:-$HOME/.codex}/skills)
install-agent-skill:
	@./scripts/skills/install-skill.sh --skill trends-agent-governance --target "$(or $(TARGET),codex)"

# Validate repo governance skill structure + installed skill sync for the selected local target
check-agent-skill:
	@if command -v bun > /dev/null 2>&1; then \
		bunx tsx scripts/skills/validate-skill.ts --skill trends-agent-governance; \
	else \
		npx tsx scripts/skills/validate-skill.ts --skill trends-agent-governance; \
	fi
	@if [ "$$CI" = "true" ]; then \
		echo "Skipping installed skill drift check in CI"; \
	else \
		./scripts/skills/install-skill.sh --skill trends-agent-governance --target "$(or $(TARGET),codex)" --check; \
	fi

# Install any repo skill into the requested skills target (default: ${CODEX_HOME:-$HOME/.codex}/skills)
install-skill:
	@if [ -z "$(SKILL)" ]; then \
		echo "SKILL is required. Usage: make install-skill SKILL=<skill-name> [TARGET=codex|agents|all]"; \
		exit 1; \
	fi
	@./scripts/skills/install-skill.sh --skill "$(SKILL)" --target "$(or $(TARGET),codex)"

# Validate skill structure for any repo skill
validate-skill:
	@if [ -z "$(SKILL)" ]; then \
		echo "SKILL is required. Usage: make validate-skill SKILL=<skill-name>"; \
		exit 1; \
	fi
	@if command -v bun > /dev/null 2>&1; then \
		bunx tsx scripts/skills/validate-skill.ts --skill "$(SKILL)"; \
	else \
		npx tsx scripts/skills/validate-skill.ts --skill "$(SKILL)"; \
	fi

# Check installed skill drift for any repo skill
check-skill-install:
	@if [ -z "$(SKILL)" ]; then \
		echo "SKILL is required. Usage: make check-skill-install SKILL=<skill-name> [TARGET=codex|agents|all]"; \
		exit 1; \
	fi
	@./scripts/skills/install-skill.sh --skill "$(SKILL)" --target "$(or $(TARGET),codex)" --check

# Install resume-qa-hybrid-mcp skill into the requested skills target (default: ${CODEX_HOME:-$HOME/.codex}/skills)
install-test-plan-skill:
	@$(MAKE) install-skill SKILL=resume-qa-hybrid-mcp TARGET="$(or $(TARGET),codex)"

# Check installed drift for resume-qa-hybrid-mcp skill
check-test-plan-skill:
	@$(MAKE) validate-skill SKILL=resume-qa-hybrid-mcp
	@$(MAKE) check-skill-install SKILL=resume-qa-hybrid-mcp TARGET="$(or $(TARGET),codex)"

# Install browser-extension-dev skill into the requested skills target (default: ${CODEX_HOME:-$HOME/.codex}/skills)
install-browser-ext-skill:
	@$(MAKE) install-skill SKILL=browser-extension-dev TARGET="$(or $(TARGET),codex)"

# Check browser-extension-dev skill structure + installed drift
check-browser-ext-skill:
	@$(MAKE) validate-skill SKILL=browser-extension-dev
	@$(MAKE) check-skill-install SKILL=browser-extension-dev TARGET="$(or $(TARGET),codex)"

# Sync all governance artifacts
sync-agent-governance: sync-agent-policy install-agent-skill

# =============================================================================
# Utilities
# =============================================================================

cli-build:
	@mkdir -p bin
	@cd packages/cli && go build -o ../../bin/trends .

cli-install:
	@cd packages/cli && go install .

cli-test:
	@cd packages/cli && go test ./...

# Seed Convex with system job descriptions (idempotent)
seed:
	@if command -v bun > /dev/null 2>&1; then \
		bun scripts/seed-convex.ts --force; \
	else \
		npx tsx scripts/seed-convex.ts --force; \
	fi

# Seed Convex with system job descriptions + sample resumes (idempotent)
seed-full:
	@if command -v bun > /dev/null 2>&1; then \
		bun scripts/seed-convex.ts --with-resumes --force $(if $(SAMPLE),--sample $(SAMPLE)); \
	else \
		npx tsx scripts/seed-convex.ts --with-resumes --force $(if $(SAMPLE),--sample $(SAMPLE)); \
	fi

# Force seeding even when DB is not empty (idempotent)
seed-force:
	@if command -v bun > /dev/null 2>&1; then \
		bun scripts/seed-convex.ts --force; \
	else \
		npx tsx scripts/seed-convex.ts --force; \
	fi

# Clear all Convex seeded data (full reset)
seed-clear:
	@npm --workspace @trends/convex exec convex run seed:clearAll

# Clear workspace-scoped Convex data only (defaults to dev)
seed-clear-workspace:
	@npm --workspace @trends/convex exec convex run seed:clearWorkspaceData '{"workspaceSlug":"$(or $(WORKSPACE),dev)"}'

# Shortcut: clear only dev workspace-scoped data
seed-clear-dev:
	@$(MAKE) seed-clear-workspace WORKSPACE=dev

# Clear resume-related Convex collections via resetDatabase
clear-resumes:
	@npm --workspace @trends/convex exec convex run resume_tasks:resetDatabase

# Seed deterministic resume matches into output/resume_screening.db
seed-matches:
	@if command -v node >/dev/null 2>&1 && [ -d "node_modules/better-sqlite3" ]; then \
		if ! node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.prepare('select 1').get(); db.close();" >/dev/null 2>&1; then \
			echo "Detected better-sqlite3 ABI mismatch; rebuilding (npm rebuild better-sqlite3)..."; \
			npm rebuild better-sqlite3; \
		fi; \
	fi
	@npx tsx scripts/seed-matches.ts

# Clear cached resume matches from output/resume_screening.db
clear-matches:
	@if command -v node >/dev/null 2>&1 && [ -d "node_modules/better-sqlite3" ]; then \
		if ! node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.prepare('select 1').get(); db.close();" >/dev/null 2>&1; then \
			echo "Detected better-sqlite3 ABI mismatch; rebuilding (npm rebuild better-sqlite3)..."; \
			npm rebuild better-sqlite3; \
		fi; \
	fi
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

# Run E2E smoke tests via DevTools MCP / Playwright CDP
e2e:
	@echo "Running E2E smoke tests via DevTools..."
	@npx tsx scripts/e2e-smoke.ts

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

# Run all validation checks (Python + Node.js + governance skill validation; honors TARGET=all)
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
	@npm run check:resume-ai-prompts
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

test-extension-keyword-mode:               ## Run extension keyword mode precedence regression
	@echo "Running extension keyword mode regression..."
	@if command -v bun > /dev/null 2>&1; then \
		bun run test:extension:keyword-mode; \
	else \
		npm run test:extension:keyword-mode; \
	fi

test-api-search-profiles:                  ## Run search-profiles dispatch keyword route test
	@echo "Running API search-profiles route test..."
	@if command -v bun > /dev/null 2>&1; then \
		bun run test:api:search-profiles; \
	else \
		npm run test:api:search-profiles; \
	fi

test-worker-resume-tasks:                  ## Run worker resume task keyword assembly tests
	@echo "Running worker resume task tests..."
	@uv run pytest tests/test_resume_tasks.py -q

test-collect-url-smoke:                    ## Run quick smoke for Collect URL keyword concatenation
	@echo "Running Collect URL smoke check..."
	@if command -v bun > /dev/null 2>&1; then \
		bun run test:e2e:collect-url; \
	else \
		npm run test:e2e:collect-url; \
	fi

test-coverage:                             ## Run Node.js tests with coverage
	@echo "Running Node.js tests with coverage..."
	@npm run --workspace @trends/shared build
	@(cd apps/web && npm run test -- --coverage)
	@npx vitest run --coverage apps/api/src

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
	@echo "  deploy         Precheck deployed SHA/env, then skip, env-refresh, or full upgrade (requires sudo)"
	@echo "  deploy-check   Dry run deploy precheck without rebuilding"
	@echo "  refresh-env    Refresh env, sync frontend build vars, and rebuild the production web bundle"
	@echo "  uninstall      Remove systemd services (requires sudo)"
	@echo "  docker         Start Docker containers"
	@echo "  docker-build   Build and start Docker containers"
	@echo "  docker-down    Stop Docker containers"
	@echo ""
	@echo "Static Site:"
	@echo "  build-static       Build static site from existing output"
	@echo "  build-static-fresh Run crawler first, then build static site"
	@echo "  build-extension-zip Build browser extension zip + metadata for web download"
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
	@echo "  install-deps [SKILL_INSTALL_TARGET=codex|agents|all] [CONVEX_MIRROR_MODE=off|fallback|mirror-first]"
	@echo "               Install deps, prefetch Convex assets, and bootstrap governance skill targets"
	@echo "               See ./scripts/install-deps.sh --help for mirror bases, timeout, and curl env knobs"
	@echo "  prefetch-convex [CONVEX_MIRROR_MODE=off|fallback|mirror-first] Prefetch Convex local backend + dashboard assets"
	@echo "                 See ./scripts/prefetch-convex-backend.sh --help for mirror bases, timeout, and curl env knobs"
	@echo ""
	@echo "CLI:"
	@echo "  cli-build      Build Go CLI to bin/trends"
	@echo "  cli-install    Install Go CLI to GOPATH/bin"
	@echo "  cli-test       Run Go CLI tests"
	@echo ""
	@echo "Documentation:"
	@echo "  fetch-docs     Fetch latest upstream documentation"
	@echo "  sync-agent-policy Sync generated dev-docs/AGENTS.md from canonical AGENTS policy"
	@echo "  check-agent-policy Validate generated dev-docs/AGENTS.md is up to date"
	@echo "  install-agent-skill [TARGET=codex|agents|all] Install governance skill into the selected skills dir"
	@echo "  check-agent-skill [TARGET=codex|agents|all] Validate governance skill, command, rules file, and installed copy drift"
	@echo "  install-skill SKILL=<name> [TARGET=codex|agents|all] Install any repo skill into the selected skills dir"
	@echo "  validate-skill SKILL=<name> Validate skill structure from SKILL.md frontmatter"
	@echo "  check-skill-install SKILL=<name> [TARGET=codex|agents|all] Validate installed skill sync with repo source"
	@echo "  install-test-plan-skill [TARGET=codex|agents|all] Install resume-qa-hybrid-mcp into the selected skills dir"
	@echo "  check-test-plan-skill [TARGET=codex|agents|all] Validate resume-qa-hybrid-mcp skill + installed drift"
	@echo "  install-browser-ext-skill [TARGET=codex|agents|all] Install browser-extension-dev into the selected skills dir"
	@echo "  check-browser-ext-skill [TARGET=codex|agents|all] Validate browser-extension-dev skill + installed drift"
	@echo "  sync-agent-governance [TARGET=codex|agents|all] Run policy sync + governance skill install"
	@echo "                     Skill roots honor CODEX_HOME and AGENTS_HOME when set"
	@echo ""
	@echo "Utilities:"
	@echo "  seed           Seed Convex with system job descriptions"
	@echo "  seed-full      Seed Convex with system job descriptions + sample resumes"
	@echo "  seed-force     Force seed Convex even if DB is not empty"
	@echo "  seed-clear     Clear all Convex seeded data (seed:clearAll)"
	@echo "  seed-clear-workspace WORKSPACE=<slug> Clear workspace-scoped Convex data (default: dev)"
	@echo "  seed-clear-dev Clear workspace-scoped Convex data for dev"
	@echo "  clear-resumes  Clear resume-related Convex collections"
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
	@echo "  check [TARGET=codex|agents|all] Run validation checks (Python + Node + governance skill validation)"
	@echo "  check-python   Run Python checks only"
	@echo "  check-node     Run Node.js checks only"
	@echo "  check-build [TARGET=codex|agents|all] Run checks + build validation"
	@echo "  test           Run all tests (Python + Node)"
	@echo "  test-python    Run Python tests only"
	@echo "  test-node      Run Node.js tests only"
	@echo "  test-extension-keyword-mode Run extension keyword mode precedence regression"
	@echo "  test-api-search-profiles Run API route test for profile-run keyword dispatch"
	@echo "  test-worker-resume-tasks Run worker keyword assembly tests"
	@echo "  test-collect-url-smoke Run Collect button URL smoke check"
	@echo "  test-resume    Validate resume fixtures"
	@echo "  clean-db       Clean local databases and environment (Convex state + SQLite)"
	@echo "  fresh-env      Wipe everything and reinstall dependencies (nuclear option)"
	@echo "  help           Show this help message"
	@echo ""
	@echo "Environment Variables:"
	@echo "  ENV_FILE       Env file path (install/deploy default: .env.production; set ENV_FILE= to keep existing deploy env)"
	@echo "  WORKSPACE_DIR  Workspace root used to resolve relative ENV_FILE paths (auto-set by make)"
	@echo "  INSTALL_BRANCH Git branch to deploy into /opt/trends (default: repo default branch)"
	@echo "  FORCE          Set 1/true to bypass deploy precheck and force a full upgrade"
	@echo "  ALLOW_NODE_DOWNGRADE Set 1/true to allow installer to downgrade Node to v22 when a newer Node is already installed"
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
