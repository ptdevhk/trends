# TrendRadar Development Makefile

.PHONY: dev dev-samples dev-fast dev-critical dev-backend dev-clean dev-mcp dev-crawl dev-convex dev-convex-stop dev-convex-restart dev-convex-refresh dev-convex-ensure dev-convex-status dev-web dev-api dev-worker dev-api-worker \
		local-run-crawler local-run-mcp local-run-mcp-http local-run-worker local-run-worker-once run crawl mcp mcp-http worker worker-once \
		on-prod-install on-prod-deploy on-prod-deploy-check on-prod-uninstall on-prod-refresh-env on-prod-preview-restore-full-state prod-install prod-deploy prod-deploy-check install deploy deploy-check uninstall refresh-env preview-restore-full-state restore-preview-full-state \
		preview-backup-prod on-host-backup-prod-complete on-host-preview-preflight on-host-preview-clone-from-prod on-host-preview-upgrade on-host-preview-isolate preview-deploy preview-restore-data preview-doctor preview-smoke \
		on-host-preview-rehearse-backup on-host-preview-rehearse-resume on-host-preview-rehearse-rollback on-host-preview-verify-snapshot on-host-preview-run-migrations \
		install-deps fetch-docs clean check help docker docker-build docker-down \
		check-python check-node check-node-tests-types check-build ci-local \
		test test-python test-node test-resume test-extension-keyword-mode test-api-search-profiles test-worker-resume-tasks test-collect-url-smoke my-scoring my-scoring-e2e \
		migration-test migration-test-fresh-sandbox \
		build-static build-static-fresh build-extension-zip serve-static \
		i18n-check i18n-sync i18n-convert i18n-translate i18n-build \
		refresh-sample refresh-sample-manual prefetch-convex chrome-debug \
		backfill-candidate-status backfill-candidate-status-live \
		debug-51job-detail \
		install-hooks \
		seed seed-full seed-force seed-clear seed-clear-workspace seed-clear-dev \
		seed-clear-demo-resumes \
		backup-resumes restore-resumes remote-backup-prod backup-prod local-restore-from-prod restore-from-prod restore-resumes-restart clear-resume-analyses clear-resume-analyses-restart \
		clear-resumes \
		cli-build cli-install cli-test \
		sync-agent-policy check-agent-policy sync-project-skills check-project-skills install-global-skills \
		check-route-auth check-mutation-entry-points check-local-convex-write-secret auth-workspace-smoke auth-provider-membership \
		install-skill validate-skill check-skill-install install-test-plan-skill check-test-plan-skill \
		install-browser-ext-skill check-browser-ext-skill \
		sync-resume-ai-prompts check-resume-ai-prompts \
		sync-resume-field-usage-policy check-resume-field-usage-policy \
		sync-search-profile-templates check-search-profile-templates \
		clean-db fresh-env refresh-env verify-workflow-dataset

# Default target
.DEFAULT_GOAL := help

.PHONY: seed-matches clear-matches verify-critical-path verify-workflow-dataset verify-top6 benchmark-critical-path benchmark-critical-path-seeded benchmark-parallelism-matrix benchmark-dev-resume-latency verify-dev-resume-latency doctor-search-freshness

# Search-data freshness: ingestComputeEpoch lag + golden MY/CN minRoleYears totals.
# Auth: TRENDS_AUTH_USERNAME / TRENDS_AUTH_PASSWORD (e.g. demo-admin).
# Exit 2 = compute-stale; exit 3 = golden floor fail; 0 = ok or API unreachable (explicit).
doctor-search-freshness:
	@npx tsx scripts/search-data-freshness-doctor.ts --api-url "$${API_URL:-http://localhost:3000}" --workspace "$${WORKSPACE:-dev}" --json; \
	exit $$?

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

# Start dev stack with sample resume snapshots pulled from the sample repo
dev-samples:
	@$(MAKE) restore-sample-snapshots
	@$(MAKE) dev

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

# Start only local Convex dev backend
dev-convex:
	@./scripts/dev.sh --convex-only --no-seed $(ARGS)

# Stop only local Convex dev backend listeners
dev-convex-stop:
	@project_root="$(CURDIR)"; \
	convex_port="$${CONVEX_PORT:-3210}"; \
	site_port="$${CONVEX_SITE_PORT:-3211}"; \
	tmux_session="$${CONVEX_TMUX_SESSION:-trends-convex}"; \
	pids="$$( { \
		lsof -tiTCP:"$$convex_port" -sTCP:LISTEN 2>/dev/null; \
		lsof -tiTCP:"$$site_port" -sTCP:LISTEN 2>/dev/null; \
		pgrep -f "$$project_root/node_modules/.bin/convex dev" 2>/dev/null; \
	} | sort -u )"; \
	tmux_active="false"; \
	if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$$tmux_session" 2>/dev/null; then \
		tmux_active="true"; \
	fi; \
	if [ -z "$$pids" ] && [ "$$tmux_active" != "true" ]; then \
		echo "No local Convex listeners found on ports $$convex_port/$$site_port."; \
		exit 0; \
	fi; \
	if [ "$$tmux_active" = "true" ]; then \
		echo "Stopping local Convex tmux session: $$tmux_session"; \
		tmux kill-session -t "$$tmux_session" 2>/dev/null || true; \
	fi; \
	if [ -n "$$pids" ]; then \
		echo "Stopping local Convex process groups for PIDs: $$pids"; \
		for pid in $$pids; do \
			pgid="$$(ps -o pgid= -p "$$pid" | tr -d '[:space:]')"; \
			if [ -n "$$pgid" ]; then \
				kill -TERM -"$$pgid" 2>/dev/null || true; \
			else \
				kill -TERM "$$pid" 2>/dev/null || true; \
			fi; \
		done; \
	fi; \
	for _ in 1 2 3 4 5 6 7 8 9 10; do \
		tmux_running="false"; \
		if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$$tmux_session" 2>/dev/null; then \
			tmux_running="true"; \
		fi; \
		if ! ss -ltn "( sport = :$$convex_port or sport = :$$site_port )" | rg -q ":$$convex_port|:$$site_port" \
			&& ! pgrep -f "$$project_root/node_modules/.bin/convex dev" >/dev/null 2>&1 \
			&& [ "$$tmux_running" != "true" ]; then \
			echo "Local Convex stopped."; \
			exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "Local Convex is still running after SIGTERM; use make dev-clean if you need a full cleanup."; \
	exit 1

# Restart only local Convex dev backend
dev-convex-restart:
	@$(MAKE) dev-convex-stop || exit $$?; \
	$(MAKE) dev-convex

# Refresh local Convex in a detached tmux session when available
dev-convex-refresh:
	@project_root="$(CURDIR)"; \
	convex_port="$${CONVEX_PORT:-3210}"; \
	refresh_wait_secs="$${CONVEX_REFRESH_WAIT_SECS:-45}"; \
	tmux_session="$${CONVEX_TMUX_SESSION:-trends-convex}"; \
	$(MAKE) dev-convex-stop || exit $$?; \
	if ! command -v tmux >/dev/null 2>&1; then \
		echo "tmux not found; falling back to foreground make dev-convex-restart."; \
		$(MAKE) dev-convex-restart; \
		exit $$?; \
	fi; \
	if tmux has-session -t "$$tmux_session" 2>/dev/null; then \
		tmux kill-session -t "$$tmux_session" 2>/dev/null || true; \
	fi; \
	tmux new-session -d -s "$$tmux_session" "cd '$$project_root' && $(MAKE) dev-convex"; \
	echo "Waiting up to $$refresh_wait_secs seconds for local Convex to become ready..."; \
	for _ in $$(seq 1 "$$refresh_wait_secs"); do \
		if curl -fsS "http://127.0.0.1:$$convex_port/version" >/dev/null 2>&1; then \
			echo "Local Convex refreshed and ready at http://127.0.0.1:$$convex_port via tmux session $$tmux_session"; \
			exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "Local Convex did not become ready after tmux refresh; recent tmux output follows:"; \
	tmux capture-pane -pt "$$tmux_session:0" -S -40 2>/dev/null || true; \
	exit 1

# Ensure local Convex is reachable before maintenance operations run
dev-convex-ensure:
	@convex_port="$${CONVEX_PORT:-3210}"; \
	if curl -fsS "http://127.0.0.1:$$convex_port/version" >/dev/null 2>&1; then \
		echo "Local Convex already reachable at http://127.0.0.1:$$convex_port"; \
		exit 0; \
	fi; \
	$(MAKE) dev-convex-refresh

# Show local Convex listener/process/data status
dev-convex-status:
	@convex_port="$${CONVEX_PORT:-3210}"; \
	site_port="$${CONVEX_SITE_PORT:-3211}"; \
	state_dir="$${CONVEX_STATE_DIR:-$$HOME/.convex/anonymous-convex-backend-state/anonymous-agent}"; \
	echo "Local Convex listeners:"; \
	ss -ltnp "( sport = :$$convex_port or sport = :$$site_port )" || true; \
	echo ""; \
	echo "Local Convex processes:"; \
	listener_pids="$$( { \
		lsof -tiTCP:"$$convex_port" -sTCP:LISTEN 2>/dev/null; \
		lsof -tiTCP:"$$site_port" -sTCP:LISTEN 2>/dev/null; \
	} | sort -u )"; \
	pids="$$( { \
		printf '%s\n' "$$listener_pids"; \
		for pid in $$listener_pids; do \
			current="$$pid"; \
			for _ in 1 2 3; do \
				parent="$$(ps -o ppid= -p "$$current" | tr -d '[:space:]')"; \
				if [ -z "$$parent" ] || [ "$$parent" -le 1 ]; then \
					break; \
				fi; \
				printf '%s\n' "$$parent"; \
				current="$$parent"; \
			done; \
		done; \
	} | sed '/^[[:space:]]*$$/d' | sort -u | tr '\n' ' ' | xargs )"; \
	if [ -n "$$pids" ]; then \
		ps -o pid,ppid,pgid,rss,%mem,etime,cmd -p $$pids; \
	else \
		echo "No local Convex processes found."; \
	fi; \
	echo ""; \
	echo "Local Convex state:"; \
	if [ -d "$$state_dir" ]; then \
		du -sh "$$state_dir"; \
		ls -lh "$$state_dir"/convex_local_backend.sqlite3 2>/dev/null || true; \
	else \
		echo "State directory not found: $$state_dir"; \
	fi; \
	echo ""; \
	if ! curl -fsS "http://127.0.0.1:$$convex_port/version" >/dev/null 2>&1; then \
		echo "Convex at http://127.0.0.1:$$convex_port is not reachable."; \
		exit 0; \
	fi; \
	runner="npx"; \
	if command -v bun >/dev/null 2>&1; then runner="bunx"; fi; \
	echo "Resume count:"; \
	(cd packages/convex && "$$runner" convex run resumes:count); \
	echo ""; \
	echo "Resume tasks:"; \
	(cd packages/convex && "$$runner" convex run resume_tasks:list)

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
		if [ -f ".env" ]; then set -a; . ./.env; set +a; fi; \
		cd apps/api && npm run dev; \
	else \
		echo "apps/api not found. Create it with Milestone 2 (Hono BFF)"; \
		exit 1; \
	fi

# Start FastAPI worker REST API only (port 8000)
dev-api-worker:
	@if [ -d "apps/worker" ]; then \
		if [ -f ".env" ]; then set -a; . ./.env; set +a; fi; \
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

# Local run: production-mode on laptop (NOT on prod host)
local-run-crawler:
	uv run python -m trendradar

run: local-run-crawler
crawl: local-run-crawler

local-run-mcp:
	uv run python -m mcp_server.server

mcp: local-run-mcp

local-run-mcp-http:
	uv run python -m mcp_server.server --transport http --port 3333

mcp-http: local-run-mcp-http

local-run-worker:
	uv run python -m apps.worker

worker: local-run-worker

local-run-worker-once:
	uv run python -m apps.worker --once

worker-once: local-run-worker-once

# =============================================================================
# On-prod host (ssh in first: ssh <host> && cd /opt/trends && make <target>)
# =============================================================================

# Runs on prod host ONLY. Install as systemd services — seeds JDs only + runs migrations
on-prod-install:
	sudo REPO_URL="$${REPO_URL:-}" ENV_FILE="$${ENV_FILE:-.env.production}" WORKSPACE_DIR="$$(pwd)" INSTALL_BRANCH="$${INSTALL_BRANCH:-}" ALLOW_NODE_DOWNGRADE="$${ALLOW_NODE_DOWNGRADE:-}" ./scripts/install.sh install

prod-install: on-prod-install
install: on-prod-install

# Runs on prod host ONLY. Preflight workspace branch, snapshot Convex, then pull/rebuild/restart production services (JDs only)
on-prod-deploy:
	@case "$$(pwd -P)" in \
		*/trends-preview|*/trends-preview/*) \
			echo "ERROR: on-prod-deploy refused — cwd is preview ($$(pwd -P))."; \
			echo "Use: make deploy  (routes to preview-upgrade) or sudo bash deploy/preview-upgrade.sh"; \
			exit 1 ;; \
	esac
	sudo REPO_URL="$${REPO_URL:-}" ENV_FILE="$${ENV_FILE:-.env.production}" WORKSPACE_DIR="$$(pwd)" INSTALL_BRANCH="$${INSTALL_BRANCH:-}" FORCE="$${FORCE:-}" ALLOW_NODE_DOWNGRADE="$${ALLOW_NODE_DOWNGRADE:-}" ./scripts/install.sh upgrade

prod-deploy: on-prod-deploy

# Context-aware deploy:
#   /opt/trends            → production upgrade via install.sh
#   /home/ubuntu/trends-preview → preview upgrade (never touches production)
#   elsewhere              → hard fail with guidance
deploy:
	@cwd="$$(pwd -P)"; \
	case "$$cwd" in \
		*/trends-preview|*/trends-preview/*) \
			echo "→ preview deploy (cwd=$$cwd)"; \
			sudo ASSUME_YES="$${ASSUME_YES:-}" SOURCE_REF="$${SOURCE_REF:-origin/main}" bash ./deploy/preview-upgrade.sh ;; \
		/opt/trends|/opt/trends/*) \
			echo "→ production deploy (cwd=$$cwd)"; \
			$(MAKE) --no-print-directory on-prod-deploy ;; \
		*) \
			echo "ERROR: make deploy must be run from /opt/trends (prod) or .../trends-preview (preview)."; \
			echo "  cwd=$$cwd"; \
			echo "  Preview:  cd /home/ubuntu/trends-preview && make deploy"; \
			echo "  Prod:     cd /opt/trends && make deploy"; \
			exit 1 ;; \
	esac

# Runs on prod host ONLY. Show whether deploy would skip, refresh env only, or run a full upgrade
on-prod-deploy-check:
	@case "$$(pwd -P)" in \
		*/trends-preview|*/trends-preview/*) \
			echo "ERROR: on-prod-deploy-check refused — cwd is preview."; \
			exit 1 ;; \
	esac
	sudo REPO_URL="$${REPO_URL:-}" ENV_FILE="$${ENV_FILE:-.env.production}" WORKSPACE_DIR="$$(pwd)" INSTALL_BRANCH="$${INSTALL_BRANCH:-}" FORCE="$${FORCE:-}" ALLOW_NODE_DOWNGRADE="$${ALLOW_NODE_DOWNGRADE:-}" ./scripts/install.sh upgrade-check

prod-deploy-check: on-prod-deploy-check

deploy-check:
	@cwd="$$(pwd -P)"; \
	case "$$cwd" in \
		*/trends-preview|*/trends-preview/*) \
			echo "→ preview deploy-check (read-only preflight)"; \
			sudo bash ./deploy/preview-preflight.sh ;; \
		/opt/trends|/opt/trends/*) \
			$(MAKE) --no-print-directory on-prod-deploy-check ;; \
		*) \
			echo "ERROR: make deploy-check must be run from /opt/trends or .../trends-preview (cwd=$$cwd)"; \
			exit 1 ;; \
	esac

# Runs on prod host ONLY. Remove systemd services
on-prod-uninstall:
	sudo ENV_FILE="$${ENV_FILE:-.env.production}" WORKSPACE_DIR="$$(pwd)" ./scripts/install.sh uninstall

uninstall: on-prod-uninstall

# Runs on prod host ONLY. Refresh runtime env and rebuild the production frontend bundle
on-prod-refresh-env:
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
	sudo -u trends -H sh -lc 'cd /opt/trends && npm run --workspace @trends/web build && printf "git_sha=%s\ngit_branch=%s\nbuilt_at=%s\n" "$$(git rev-parse HEAD 2>/dev/null || true)" "$$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)" "$$(date -u +%Y-%m-%dT%H:%M:%SZ)" > apps/web/dist/.trends-build-meta && chmod 600 apps/web/dist/.trends-build-meta'; \
	sudo systemctl daemon-reload; \
	sudo systemctl restart trends-api trends-worker trends-worker-api trends-mcp; \
	echo "✅ Environment refreshed and services restarted"; \
	sudo systemctl is-active --quiet trends-api && echo "  trends-api: active" || echo "  trends-api: FAILED"; \
	sudo systemctl is-active --quiet trends-worker && echo "  trends-worker: active" || echo "  trends-worker: FAILED"; \
	sudo systemctl is-active --quiet trends-worker-api && echo "  trends-worker-api: active" || echo "  trends-worker-api: FAILED"; \
	sudo systemctl is-active --quiet trends-mcp && echo "  trends-mcp: active" || echo "  trends-mcp: FAILED"

refresh-env: on-prod-refresh-env

# Runs on prod host ONLY. Restore production Convex + SQLite candidate-action state into preview
on-prod-preview-restore-full-state:
	sudo ./deploy/restore-preview-full-state-from-prod.sh $(ARGS)

preview-restore-full-state: on-prod-preview-restore-full-state
restore-preview-full-state: on-prod-preview-restore-full-state

# Dual-target: follows $API_URL. Defaults to http://localhost:3000 (local).
# Backup live resume records to a portable JSON or .tar.gz file
backup-resumes:
	@API_URL="$${API_URL:-$${TRENDS_API_URL:-http://localhost:3000}}" \
	WORKSPACE="$${WORKSPACE:-dev}" \
	OUT="$${OUT:-}" \
	LIMIT="$${LIMIT:-}" \
	RESUME_IDS="$${RESUME_IDS:-}" \
	SOURCE_HOSTS="$${SOURCE_HOSTS:-}"; \
	if command -v bun >/dev/null 2>&1; then \
		bun run scripts/resume/backup-resumes.ts; \
	else \
		npx tsx scripts/resume/backup-resumes.ts; \
	fi

# Restore live resume records from a portable JSON or .tar.gz backup
restore-resumes:
	@API_URL="$${API_URL:-$${TRENDS_API_URL:-http://localhost:3000}}" \
	WORKSPACE="$${WORKSPACE:-dev}" \
	FILE="$${FILE:-}" \
	MODE="$${MODE:-upsert}" \
	YES="$${YES:-}"; \
	if command -v bun >/dev/null 2>&1; then \
		bun run scripts/resume/restore-resumes.ts; \
	else \
		npx tsx scripts/resume/restore-resumes.ts; \
	fi

# Derive a small restore-compatible backup from a full portable resume backup
resume-lite-backup:
	@COUNT="$${COUNT:-20}" \
	FILE="$${FILE:-output/resume-backups/resumes-prod-dev-20260512-111129.tar.gz}" \
	OUT="$${OUT:-output/resume-backups/resumes-prod-dev-lite-top$${COUNT}.tar.gz}"; \
	export COUNT FILE OUT; \
	if command -v bun >/dev/null 2>&1; then \
		bun run scripts/resume/create-lite-backup.ts; \
	else \
		npx tsx scripts/resume/create-lite-backup.ts; \
	fi

# One-liner: SSH tunnel → backup prod workspace → close tunnel
# Defaults: SSH_HOST=ptcloud, TUNNEL_PORT=13000, WORKSPACE=dev
# OUT defaults to output/resume-backups/resumes-prod-<workspace>-<timestamp>.tar.gz
# Runs on LAPTOP; opens SSH tunnel to remote prod API.
# One-liner: SSH tunnel → backup prod workspace → close tunnel
# Defaults: SSH_HOST=ptcloud, TUNNEL_PORT=13000, WORKSPACE=dev
# OUT defaults to output/resume-backups/resumes-prod-<workspace>-<timestamp>.tar.gz
remote-backup-prod:
	@SSH_HOST="$${SSH_HOST:-ptcloud}"; \
	TUNNEL_PORT="$${TUNNEL_PORT:-13000}"; \
	WORKSPACE="$${WORKSPACE:-dev}"; \
	OUT="$${OUT:-output/resume-backups/resumes-prod-$${WORKSPACE}-$$(date +%Y%m%d-%H%M%S).tar.gz}"; \
	mkdir -p "$$(dirname "$$OUT")"; \
	echo "→ opening tunnel $$TUNNEL_PORT → $$SSH_HOST:3000"; \
	ssh -f -N -L "$$TUNNEL_PORT:127.0.0.1:3000" "$$SSH_HOST" || { echo "ssh tunnel failed"; exit 1; }; \
	trap "kill $$(lsof -ti:$$TUNNEL_PORT) 2>/dev/null || true" EXIT; \
	API_URL="http://127.0.0.1:$$TUNNEL_PORT" WORKSPACE="$$WORKSPACE" OUT="$$OUT" \
		TRENDS_AUTH_USERNAME="$${TRENDS_AUTH_USERNAME:-}" \
		TRENDS_AUTH_PASSWORD="$${TRENDS_AUTH_PASSWORD:-}" \
		$(MAKE) --no-print-directory backup-resumes

backup-prod: remote-backup-prod

# One-liner: clear dev, replace-restore from FILE (auto-backup enabled, MODE=replace YES=1 preset)
# Required: FILE=<path to .tar.gz or .json>
# Defaults: WORKSPACE=dev, API_URL=http://localhost:3000
local-restore-from-prod:
	@if [ -z "$(FILE)" ]; then echo "FILE=<path> is required"; exit 1; fi
	@echo "→ clearing dev resumes (loop until partial:false)"
	@while $(MAKE) --no-print-directory clear-resumes 2>&1 | tee /tmp/clear-resumes.out | grep -q '"partial": true'; do :; done
	@$(MAKE) --no-print-directory restore-resumes FILE="$(FILE)" MODE=replace YES=1 \
		API_URL="$${API_URL:-http://localhost:3000}" WORKSPACE="$${WORKSPACE:-dev}" \
		TRENDS_AUTH_USERNAME="$${TRENDS_AUTH_USERNAME:-}" \
		TRENDS_AUTH_PASSWORD="$${TRENDS_AUTH_PASSWORD:-}" \
		SKIP_AUTO_BACKUP="$${SKIP_AUTO_BACKUP:-1}"
	@echo "→ backfilling derived fields and resume digests"
	@$(MAKE) --no-print-directory backfill-derived-fields
	@echo "→ checking derived field coverage"
	@$(MAKE) --no-print-directory check-derived-fields

restore-from-prod: local-restore-from-prod

# --- Preview deployment (preview.pt-mes.com on ptcloud) ---
#
# Full CLI runbook: docs/preview-upgrade-runbook.md
# Preferred on-host flow (preview only — never upgrades production):
#   sudo bash deploy/backup-prod-complete.sh
#   sudo bash deploy/preview-preflight.sh
#   sudo bash deploy/preview-clone-from-prod.sh
#   sudo bash deploy/restore-preview-full-state-from-prod.sh
#   cd /home/ubuntu/trends-preview && make deploy   # → preview-upgrade.sh

# Complete production backup (on ptcloud as root; read-mostly, export only)
preview-backup-prod:
	@SSH_HOST="$${SSH_HOST:-ptcloud}"; \
	echo "→ complete production backup on $$SSH_HOST"; \
	ssh "$$SSH_HOST" 'sudo ASSUME_YES=1 bash /opt/trends/deploy/backup-prod-complete.sh 2>/dev/null || \
		sudo ASSUME_YES=1 bash /home/ubuntu/trends/deploy/backup-prod-complete.sh'

# On-host: complete production backup (no SSH)
on-host-backup-prod-complete:
	sudo ASSUME_YES="$${ASSUME_YES:-1}" bash ./deploy/backup-prod-complete.sh

# On-host: preview preflight (read-only)
on-host-preview-preflight:
	sudo bash ./deploy/preview-preflight.sh

# On-host: clone production application version into preview
on-host-preview-clone-from-prod:
	sudo ASSUME_YES="$${ASSUME_YES:-}" bash ./deploy/preview-clone-from-prod.sh

# On-host: upgrade preview to latest (SOURCE_REF default origin/main)
on-host-preview-upgrade:
	sudo ASSUME_YES="$${ASSUME_YES:-}" SOURCE_REF="$${SOURCE_REF:-origin/main}" bash ./deploy/preview-upgrade.sh

# On-host: isolate preview integrations (Telegram etc.)
on-host-preview-isolate:
	sudo ASSUME_YES=1 bash ./deploy/preview-isolate-integrations.sh --apply

# On-host: single entrypoint prod→preview data parity sync (backup + convex + sqlite + parity)
on-host-preview-sync-from-prod:
	sudo ASSUME_YES="$${ASSUME_YES:-1}" DIGEST_BACKFILL_MODE="$${DIGEST_BACKFILL_MODE:-skip}" bash ./deploy/preview-sync-from-prod.sh $(ARGS)

# On-host: read-only prod vs preview search/sqlite parity
on-host-preview-parity-check:
	bash ./deploy/preview-parity-check.sh

# On-host: seed admin@dev + hr-demo@hr (+ orphan purge)
on-host-preview-seed-auth:
	bash ./deploy/preview-seed-auth.sh

# On-host: sync preview (default) or prod data into local dev + parity gate
on-host-dev-sync-from-preview:
	bash ./deploy/dev-sync-from-preview.sh $(ARGS)

# On-host: full migration gate (seed + doctor + parity)
on-host-preview-gate:
	bash ./deploy/preview-migration-gate.sh

# On-host: selected historical backup replay.
# This is distinct from the current live-production clone targets above.
on-host-preview-rehearse-backup:
	@if [ -z "$${BACKUP_DIR:-}" ] || [ -z "$${TARGET_REF:-}" ]; then \
		echo "BACKUP_DIR=<prod-complete-dir> and TARGET_REF=<exact-ref> are required"; \
		exit 2; \
	fi
	sudo env ASSUME_YES="$${ASSUME_YES:-}" \
		PREVIEW_REHEARSAL_ROOT="$${PREVIEW_REHEARSAL_ROOT:-/var/backups/trends/preview-rehearsals}" \
		bash ./deploy/preview-rehearse-backup.sh \
		--backup-dir "$$BACKUP_DIR" --target-ref "$$TARGET_REF" \
		$${ASSUME_YES:+--assume-yes}

on-host-preview-rehearse-resume:
	@if [ -z "$${RUN_ID:-}" ]; then echo "RUN_ID=<run-id> is required"; exit 2; fi
	sudo env ASSUME_YES="$${ASSUME_YES:-}" \
		PREVIEW_REHEARSAL_ROOT="$${PREVIEW_REHEARSAL_ROOT:-/var/backups/trends/preview-rehearsals}" \
		bash ./deploy/preview-rehearse-backup.sh --run-id "$$RUN_ID" \
		$${BROWSER_EVIDENCE:+--browser-evidence "$$BROWSER_EVIDENCE"} \
		$${ASSUME_YES:+--assume-yes}

on-host-preview-rehearse-rollback:
	@if [ -z "$${RUN_ID:-}" ]; then echo "RUN_ID=<run-id> is required"; exit 2; fi
	sudo env PREVIEW_REHEARSAL_ROOT="$${PREVIEW_REHEARSAL_ROOT:-/var/backups/trends/preview-rehearsals}" \
		bash ./deploy/preview-rehearse-backup.sh --run-id "$$RUN_ID" --phase rollback

on-host-preview-verify-snapshot:
	@if [ -z "$${RUN_ID:-}" ] || [ -z "$${MODE:-}" ]; then \
		echo "RUN_ID=<run-id> and MODE=baseline|upgraded are required"; exit 2; \
	fi
	sudo env PREVIEW_REHEARSAL_ROOT="$${PREVIEW_REHEARSAL_ROOT:-/var/backups/trends/preview-rehearsals}" \
		bash ./deploy/preview-verify-snapshot.sh --mode "$$MODE" \
		--run-dir "$${PREVIEW_REHEARSAL_ROOT:-/var/backups/trends/preview-rehearsals}/$$RUN_ID"

on-host-preview-run-migrations:
	@if [ -z "$${RUN_ID:-}" ]; then echo "RUN_ID=<run-id> is required"; exit 2; fi
	sudo env PREVIEW_REHEARSAL_ROOT="$${PREVIEW_REHEARSAL_ROOT:-/var/backups/trends/preview-rehearsals}" \
		bash ./deploy/preview-run-migrations.sh \
		--run-dir "$${PREVIEW_REHEARSAL_ROOT:-/var/backups/trends/preview-rehearsals}/$$RUN_ID"

preview-seed-auth:
	@SSH_HOST="$${SSH_HOST:-ptcloud}"; \
	ssh "$$SSH_HOST" 'bash /home/ubuntu/trends/deploy/preview-seed-auth.sh 2>/dev/null || \
		bash /home/ubuntu/trends-preview/deploy/preview-seed-auth.sh'

preview-gate:
	@SSH_HOST="$${SSH_HOST:-ptcloud}"; \
	ssh "$$SSH_HOST" 'bash /home/ubuntu/trends/deploy/preview-migration-gate.sh 2>/dev/null || \
		bash /home/ubuntu/trends-preview/deploy/preview-migration-gate.sh'

# Full preview deploy: sync code from SOURCE_REF (default origin/main), install, build, restart.
# Requires SSH access to ptcloud. Prefer on-host preview-upgrade when already on the host.
# Example: SOURCE_REF=v0.4.14 make preview-deploy
preview-deploy:
	@SSH_HOST="$${SSH_HOST:-ptcloud}"; \
	SOURCE_REF="$${SOURCE_REF:-origin/main}"; \
	echo "→ deploying preview to $$SSH_HOST via preview-upgrade.sh (SOURCE_REF=$$SOURCE_REF)"; \
	ssh "$$SSH_HOST" "set -e; \
		export SOURCE_REF='$$SOURCE_REF' ASSUME_YES=1; \
		if [ -x /home/ubuntu/trends-preview/deploy/preview-upgrade.sh ]; then \
			cd /home/ubuntu/trends-preview && sudo env ASSUME_YES=1 SOURCE_REF=\"$$SOURCE_REF\" bash deploy/preview-upgrade.sh; \
		elif [ -x /home/ubuntu/trends/deploy/preview-upgrade.sh ]; then \
			sudo env ASSUME_YES=1 SOURCE_REF=\"$$SOURCE_REF\" bash /home/ubuntu/trends/deploy/preview-upgrade.sh; \
		else \
			sudo bash /home/ubuntu/trends/deploy/setup-preview.sh; \
			sudo systemctl restart trends-preview-api; \
		fi"; \
	echo "→ verifying endpoints"; \
	ssh "$$SSH_HOST" "curl -s -o /dev/null -w 'Web: %{http_code}\n' https://preview.pt-mes.com/ && \
		curl -s -o /dev/null -w 'API: %{http_code}\n' http://127.0.0.1:3002/api/blocks"

# Restore production Convex data into preview. Requires SSH access to ptcloud.
preview-restore-data:
	@SSH_HOST="$${SSH_HOST:-ptcloud}"; \
	echo "→ restoring prod data into preview on $$SSH_HOST"; \
	ssh "$$SSH_HOST" "sudo bash /opt/trends/deploy/restore-preview-from-prod.sh 2>/dev/null || \
		sudo bash /home/ubuntu/trends/deploy/restore-preview-from-prod.sh"

# On-host preview doctor
preview-doctor:
	@SSH_HOST="$${SSH_HOST:-ptcloud}"; \
	ssh "$$SSH_HOST" 'bash /home/ubuntu/trends-preview/deploy/preview-doctor.sh --full 2>/dev/null || \
		bash /home/ubuntu/trends/deploy/preview-doctor.sh --full'

# Quick smoke check for preview endpoints
preview-smoke:
	@echo -n "Web: "; curl -s -o /dev/null -w '%{http_code}' https://preview.pt-mes.com/; echo
	@echo -n "API: "; curl -s -o /dev/null -w '%{http_code}' https://preview.pt-mes.com/api/blocks; echo
	@echo -n "Convex: "; curl -s -o /dev/null -w '%{http_code}' https://preview.pt-mes.com/convex/version; echo

# Dual-target: follows $API_URL. Defaults to http://localhost:3000 (local).
# Restore resume records, then restart local Convex to release retained restore RSS
restore-resumes-restart:
	@$(MAKE) dev-convex-ensure
	@$(MAKE) restore-resumes API_URL="$(API_URL)" WORKSPACE="$(WORKSPACE)" FILE="$(FILE)" MODE="$(MODE)" YES="$(YES)"
	@$(MAKE) dev-convex-refresh

# Push latest resume snapshot to the sample repo (ptdevhk/trends-resume-samples)
# SNAPSHOT_EXCLUDE: comma-separated filename globs to skip (default excludes seek recommended)
push-sample-snapshots:
	@SAMPLE_REPO="$${SAMPLE_REPO:-ptdevhk/trends-resume-samples}" \
	SNAPSHOT_DIR="$${SNAPSHOT_DIR:-}" \
	SNAPSHOT_EXCLUDE="$${SNAPSHOT_EXCLUDE:-}"; \
	if command -v bun >/dev/null 2>&1; then \
		GH_TOKEN="$${GH_TOKEN:-$$(gh auth token)}" bun run scripts/resume/push-sample-snapshots.ts; \
	else \
		GH_TOKEN="$${GH_TOKEN:-$$(gh auth token)}" npx tsx scripts/resume/push-sample-snapshots.ts; \
	fi

# Pull resume snapshots from the sample repo into output/resume-samples
pull-sample-snapshots:
	@SAMPLE_REPO="$${SAMPLE_REPO:-ptdevhk/trends-resume-samples}" \
	OUT_DIR="$${OUT_DIR:-}"; \
	if command -v bun >/dev/null 2>&1; then \
		bun run scripts/resume/pull-sample-snapshots.ts; \
	else \
		npx tsx scripts/resume/pull-sample-snapshots.ts; \
	fi

# Pull snapshots and restore in one step
restore-sample-snapshots: pull-sample-snapshots
	@$(MAKE) restore-resumes FILE=output/resume-samples RECOMPUTE_DERIVED_FIELDS=1

# Clear resume AI analyses directly in Convex, batching large datasets safely
clear-resume-analyses:
	@batch_size="$${BATCH_SIZE:-50}"; \
	job_description="$${JOB_DESCRIPTION:-}"; \
	resume_ids="$${RESUME_IDS:-}"; \
	output_flag=""; \
	if [ "$${JSON:-}" = "1" ] || [ "$${JSON:-}" = "true" ] || [ "$${JSON:-}" = "yes" ]; then \
		output_flag="-o json"; \
	fi; \
	resume_id_flags=""; \
	if [ -n "$$resume_ids" ]; then \
		OLD_IFS="$$IFS"; \
		IFS=,; \
		for resume_id in $$resume_ids; do \
			trimmed=$$(printf "%s" "$$resume_id" | xargs); \
			if [ -n "$$trimmed" ]; then \
				resume_id_flags="$$resume_id_flags --resume-id $$trimmed"; \
			fi; \
		done; \
		IFS="$$OLD_IFS"; \
		fi; \
	cd packages/cli && eval "go run . resume debug clear-analyses --batch-size $$batch_size $$output_flag $${job_description:+--job-description $$job_description} $$resume_id_flags"

# Search resumes through the Go CLI
resume-search:
	@query="$${QUERY:-$${Q:-}}"; \
	if [ -z "$$query" ]; then \
		echo "Usage: make resume-search QUERY='CNC 销售' [SOURCE=sample|convex] [LIMIT=50] [JSON=1] [API_URL=http://localhost:3000] [WORKSPACE=dev]"; \
		exit 1; \
	fi; \
	source="$${SOURCE:-sample}"; \
	limit="$${LIMIT:-50}"; \
	api_url="$${API_URL:-$${TRENDS_API_URL:-http://localhost:3000}}"; \
	workspace="$${WORKSPACE:-$${TRENDS_WORKSPACE:-dev}}"; \
	output_flag=""; \
	if [ "$${JSON:-}" = "1" ] || [ "$${JSON:-}" = "true" ] || [ "$${JSON:-}" = "yes" ]; then \
		output_flag="-o json"; \
	fi; \
	cd packages/cli && eval "go run . --api-url $$api_url --workspace $$workspace $$output_flag resume search \"$$query\" --source $$source --limit $$limit"

# Show one resume with detailed work history through the Go CLI
resume-show:
	@resume_id="$${ID:-$${RESUME_ID:-}}"; \
	if [ -z "$$resume_id" ]; then \
		echo "Usage: make resume-show ID=<resume-id> [SOURCE=sample|convex] [SAMPLE=sample-initial] [JSON=1] [API_URL=http://localhost:3000] [WORKSPACE=dev]"; \
		exit 1; \
	fi; \
	source="$${SOURCE:-sample}"; \
	sample_name="$${SAMPLE:-}"; \
	api_url="$${API_URL:-$${TRENDS_API_URL:-http://localhost:3000}}"; \
	workspace="$${WORKSPACE:-$${TRENDS_WORKSPACE:-dev}}"; \
	output_flag=""; \
	sample_flag=""; \
	if [ "$${JSON:-}" = "1" ] || [ "$${JSON:-}" = "true" ] || [ "$${JSON:-}" = "yes" ]; then \
		output_flag="-o json"; \
	fi; \
	if [ -n "$$sample_name" ]; then \
		sample_flag="--sample $$sample_name"; \
	fi; \
	cd packages/cli && eval "go run . --api-url $$api_url --workspace $$workspace $$output_flag resume show $$resume_id --source $$source $$sample_flag"

# Clear resume AI analyses, then restart local Convex to release scan-time RSS
clear-resume-analyses-restart:
	@$(MAKE) dev-convex-ensure
	@$(MAKE) clear-resume-analyses BATCH_SIZE="$(BATCH_SIZE)" JOB_DESCRIPTION="$(JOB_DESCRIPTION)" RESUME_IDS="$(RESUME_IDS)" JSON="$(JSON)"
	@$(MAKE) dev-convex-refresh

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
build-extension:
	cd apps/browser-extension && npm run build

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

# Install Python/Node dependencies, ensure the Go CLI toolchain, build bin/trends, and bootstrap local dev assets
install-deps:
	./scripts/install-deps.sh
	@$(MAKE) install-hooks

# Activate repo-managed git hooks (pre-push: i18n-check, etc.)
install-hooks:
	git config core.hooksPath .githooks

# Prefetch Convex local backend and dashboard assets into local cache
# Honors the shared Convex prefetch contract for CI=true/1 plus CONVEX_MIRROR_MODE / CONVEX_MIRROR_BASES / timeout / curl env knobs; see the script --help surface for full details.
prefetch-convex:
	./scripts/prefetch-convex-backend.sh

# Upgrade Convex CLI package and local backend binary
# Usage: make upgrade-convex VERSION=1.36.0
#        make upgrade-convex VERSION=1.36.0 ENV=prod
#        make upgrade-convex VERSION=1.36.0 TIMEOUT=120
upgrade-convex:
	./scripts/upgrade-convex.sh "$(VERSION)" $(if $(ENV),--env $(ENV),) $(if $(TIMEOUT),--timeout $(TIMEOUT),)

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

# Sync generated resume field usage runtime artifact from canonical JSON5 policy
sync-resume-field-usage-policy:
	@if command -v bun > /dev/null 2>&1; then \
		bunx tsx scripts/resume/sync-field-usage-policy.ts; \
	else \
		npx tsx scripts/resume/sync-field-usage-policy.ts; \
	fi

# Validate generated resume field usage runtime artifact is up to date
check-resume-field-usage-policy:
	@if command -v bun > /dev/null 2>&1; then \
		bunx tsx scripts/resume/sync-field-usage-policy.ts --check; \
	else \
		npx tsx scripts/resume/sync-field-usage-policy.ts --check; \
	fi

# Sync generated search profile template runtime artifact from canonical YAML profiles
sync-search-profile-templates:
	@if command -v bun > /dev/null 2>&1; then \
		bunx tsx scripts/resume/sync-search-profile-templates.ts; \
	else \
		npx tsx scripts/resume/sync-search-profile-templates.ts; \
	fi

# Validate generated search profile template runtime artifact is up to date
check-search-profile-templates:
	@if command -v bun > /dev/null 2>&1; then \
		bunx tsx scripts/resume/sync-search-profile-templates.ts --check; \
	else \
		npx tsx scripts/resume/sync-search-profile-templates.ts --check; \
	fi

# Sync committed repo project skills into .agents/skills and .claude/skills
sync-project-skills:
	@./scripts/skills/sync-project-skills.sh

# Validate repo project skill structure + committed sync drift
check-project-skills:
	@./scripts/skills/sync-project-skills.sh --check

# Install configured external global skills from config/skills/install.yaml
install-global-skills:
	@if command -v bun > /dev/null 2>&1; then \
		bunx tsx scripts/skills/install-global-skills.ts; \
	else \
		npx tsx scripts/skills/install-global-skills.ts; \
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

# Clear only workspace-demo resume records without wiping real resumes
seed-clear-demo-resumes:
	@if command -v bun > /dev/null 2>&1; then \
		CONVEX_URL="$(CONVEX_URL)" bun scripts/resume/clear-workspace-demo-resumes.ts $(if $(JSON),--json) $(ARGS); \
	else \
		CONVEX_URL="$(CONVEX_URL)" npx tsx scripts/resume/clear-workspace-demo-resumes.ts $(if $(JSON),--json) $(ARGS); \
	fi

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

# Verify a source-aware resume workflow dataset and visible-result mix
verify-workflow-dataset:
	@set -- --query "$(or $(QUERY),CNC Sales)" --workspace "$(or $(WORKSPACE),dev)" --limit "$(or $(LIMIT),200)" --top "$(or $(TOP),10)"; \
	if [ -n "$(LOCATION)" ]; then set -- "$$@" --location "$(LOCATION)"; fi; \
	if [ -n "$(SOURCE_KEY)" ]; then set -- "$$@" --source-key "$(SOURCE_KEY)"; fi; \
	if [ -n "$(JOB_DESCRIPTION)" ]; then set -- "$$@" --job-description "$(JOB_DESCRIPTION)"; fi; \
	if [ -n "$(API_BASE_URL)" ]; then set -- "$$@" --api-base-url "$(API_BASE_URL)"; fi; \
	if [ -n "$(CONVEX_URL)" ]; then set -- "$$@" --convex-url "$(CONVEX_URL)"; fi; \
	if [ -n "$(JSON)" ]; then set -- "$$@" --json; fi; \
	if command -v bun > /dev/null 2>&1; then \
		bun scripts/resume/verify-workflow-dataset.ts "$$@" $(ARGS); \
	else \
		npx tsx scripts/resume/verify-workflow-dataset.ts "$$@" $(ARGS); \
	fi

# Run the Top 6 verification & orchestration suite (service probe/spawn + 6 suites)
verify-top6:
	@if command -v bun > /dev/null 2>&1; then \
		bunx tsx scripts/run-top6-verification.ts $(ARGS); \
	else \
		npx tsx scripts/run-top6-verification.ts $(ARGS); \
	fi

# Run E2E smoke tests via DevTools MCP / Playwright CDP
e2e:
	@echo "Running E2E smoke tests via DevTools..."
	@npx tsx scripts/e2e-smoke.ts

# Run guided v0.2.1 -> main migration compatibility workflow
# Requires BACKUP_FILE outside output/resume-backups for PHASE=1/all.
migration-test:
	@PHASE="$${PHASE:-$(or $(PHASE),all)}"; \
	BACKUP_FILE="$${BACKUP_FILE:-$(BACKUP_FILE)}"; \
	if [ "$$PHASE" != "2" ] && [ -z "$$BACKUP_FILE" ]; then \
		echo "BACKUP_FILE=<path> is required for migration-test PHASE=$$PHASE"; \
		echo "Example: make migration-test BACKUP_FILE=/tmp/trends-resume-backups/resumes-prod-dev.tar.gz"; \
		exit 1; \
	fi; \
	case "$$BACKUP_FILE" in \
		output/resume-backups/*|./output/resume-backups/*|"$(CURDIR)"/output/resume-backups/*) \
			echo "migration-test refuses BACKUP_FILE inside output/resume-backups"; \
			echo "Use an external fixture path so tests do not depend on ignored local backups."; \
			exit 1; \
			;; \
	esac; \
	RESET_MODE="$${RESET_MODE:-$(RESET_MODE)}" \
	CONFIRM_FRESH_SANDBOX="$${CONFIRM_FRESH_SANDBOX:-$(CONFIRM_FRESH_SANDBOX)}" \
	BACKUP_FILE="$$BACKUP_FILE" scripts/migration-test-run.sh "$$PHASE"

# Run migration compatibility workflow from an explicit fresh local app-state sandbox.
# Destructive: removes local SQLite DBs, local Convex anonymous state, and local env selectors.
migration-test-fresh-sandbox:
	@if [ "$(YES)" != "1" ]; then \
		echo "YES=1 is required for migration-test-fresh-sandbox"; \
		echo "Example: make migration-test-fresh-sandbox YES=1 BACKUP_FILE=/tmp/trends-resume-backups/resumes-prod-dev.tar.gz"; \
		exit 1; \
	fi; \
	PHASE="$${PHASE:-$(or $(PHASE),all)}"; \
	BACKUP_FILE="$${BACKUP_FILE:-$(BACKUP_FILE)}"; \
	if [ "$$PHASE" = "2" ]; then \
		echo "migration-test-fresh-sandbox requires PHASE=1 or PHASE=all"; \
		exit 1; \
	fi; \
	RESET_MODE=fresh-sandbox CONFIRM_FRESH_SANDBOX=1 BACKUP_FILE="$$BACKUP_FILE" \
		$(MAKE) --no-print-directory migration-test PHASE="$$PHASE"

# Run all derived-field backfill migrations (searchText reindex + verifiedRoleYears backfill)
backfill-derived-fields:
	@echo "→ force-validating data consistency (reindex + backfill + search index refresh)"
	@./bin/trends migrate validate-consistency --force

# Backfill candidate_status from SQLite candidate_actions to Convex (dry-run by default)
backfill-candidate-status:
	@npx tsx scripts/backfill-candidate-status.ts --dry-run $(ARGS)

# Backfill candidate_status (live — writes to Convex)
backfill-candidate-status-live:
	@npx tsx scripts/backfill-candidate-status.ts $(ARGS)

# Check derived field coverage via BFF API
check-derived-fields:
	@curl -s "$${API_URL:-http://localhost:3000}/api/resumes/field-coverage" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'scanned={d[\"scanned\"]} missingSearchText={d[\"missingSearchText\"]} missingVerifiedRoleYears={d[\"missingVerifiedRoleYears\"]} hasRoleSignals={d[\"hasRoleSignals\"]}')"

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

# Benchmark local /dev/resumes before and after a local Convex refresh
benchmark-dev-resume-latency:
	@if command -v bun > /dev/null 2>&1; then \
		URL="$(or $(URL),http://127.0.0.1:5173/dev/resumes)" \
		RUNS="$(or $(RUNS),2)" \
		WARMUP="$(or $(WARMUP),1)" \
		TIMEOUT_MS="$(or $(TIMEOUT_MS),30000)" \
		REFRESH="$(if $(filter undefined,$(origin REFRESH)),true,$(REFRESH))" \
		BASELINE="$(BASELINE)" \
		STRICT="$(STRICT)" \
		JSON="$(JSON)" \
		OUT="$(OUT)" \
		bun scripts/benchmark-dev-resume-latency.ts $(ARGS); \
	else \
		URL="$(or $(URL),http://127.0.0.1:5173/dev/resumes)" \
		RUNS="$(or $(RUNS),2)" \
		WARMUP="$(or $(WARMUP),1)" \
		TIMEOUT_MS="$(or $(TIMEOUT_MS),30000)" \
		REFRESH="$(if $(filter undefined,$(origin REFRESH)),true,$(REFRESH))" \
		BASELINE="$(BASELINE)" \
		STRICT="$(STRICT)" \
		JSON="$(JSON)" \
		OUT="$(OUT)" \
		npx tsx scripts/benchmark-dev-resume-latency.ts $(ARGS); \
	fi

# Run the local /dev/resumes regression gate against the latest prior artifact
verify-dev-resume-latency:
	@$(MAKE) benchmark-dev-resume-latency \
		URL="$(or $(URL),http://127.0.0.1:5173/dev/resumes)" \
		RUNS="$(or $(RUNS),1)" \
		WARMUP="$(or $(WARMUP),1)" \
		TIMEOUT_MS="$(or $(TIMEOUT_MS),30000)" \
		REFRESH="$(if $(filter undefined,$(origin REFRESH)),true,$(REFRESH))" \
		BASELINE="$(or $(BASELINE),latest)" \
		STRICT="$(if $(filter undefined,$(origin STRICT)),true,$(STRICT))" \
		JSON="$(JSON)" \
		OUT="$(OUT)" \
		ARGS="$(ARGS)"

# Refresh resume sample data automatically via CDP
refresh-sample:
	@KEYWORD="$(or $(KEYWORD),销售)" SAMPLE="$(or $(SAMPLE),sample-initial)" \
	CDP_PORT="$(or $(CDP_PORT),9222)" \
	ALLOW_EMPTY="$(ALLOW_EMPTY)" \
	LOCATION="$(LOCATION)" \
	SOURCE="$(or $(SOURCE),job5156)" \
	MARKET="$(or $(MARKET),MY)" \
	ROLE_TITLES="$(ROLE_TITLES)" \
		./scripts/refresh-sample.sh --limit $(or $(LIMIT),50) --max-pages $(or $(MAX_PAGES),10)

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

# Inspect one synced 51job resume's parsed detail fields/workHistory via Trends CLI
debug-51job-detail:
	@if [ -z "$(RESUME_ID)" ]; then \
		echo "Usage: make debug-51job-detail RESUME_ID=<resume-id> [RAW_PATH=/tmp/51job-<resume-id>-raw.json]"; \
		exit 1; \
	fi
	./scripts/debug-51job-detail.sh "$(RESUME_ID)" "$(RAW_PATH)"

# Start Chrome with remote debugging on port 9222 (for CDP/MCP).
# SSOT is the installed playwright-cli `chrome-debug` command; the repo script
# is a shim that also passes --load-unpacked apps/browser-extension.
chrome-debug:
	@chmod +x scripts/chrome-debug.sh
	./scripts/chrome-debug.sh

# Re-sync the debug-safe clone from the real Chrome profile before launch.
# Chrome should be fully closed before running this target.
# The shim re-installs the collector after the clone is refreshed.
chrome-debug-refresh:
	@chmod +x scripts/chrome-debug.sh
	./scripts/chrome-debug.sh --refresh-from-default


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

# Run all validation checks (Python + Node.js + project skill sync + canonical policy validation)
check: check-python check-node check-project-skills check-agent-policy check-concept-drift check-route-auth check-mutation-entry-points check-convex-function-paths check-seed-bootstrap-admins check-local-convex-write-secret
	@echo "All checks passed"

# Auth gating lint — verify API route files have auth middleware
check-route-auth:
	@bash scripts/check-route-auth.sh

# Mutation registry lint — verify every public Convex mutation is registered
# in packages/convex/convex/_mutations_registry.ts (quiesce-coverage audit).
check-mutation-entry-points:
	@bash scripts/check-mutation-entry-points.sh

# Convex function-path lint — verify every BFF callConvex*("module:name") resolves
# to a public query/mutation/action export (or a barrel re-export); prevents
# "Could not find public function" runtime 500s after module refactors.
check-convex-function-paths:
	@npx tsx scripts/check-convex-function-paths.ts

# Bootstrap admin seeding — verify seed_bootstrap_admins() parsing/no-op logic
# in scripts/install.sh (deploy-time admin seeding for the auth refactor).
check-seed-bootstrap-admins:
	@bash scripts/seed-bootstrap-admins.test.sh

# Local Convex write secret - verify local-only detection, stable persistence,
# mode protection, and cloud no-op behavior.
check-local-convex-write-secret:
	@bash scripts/local-convex-write-secret.test.sh

# Concept drift check — flags vault concept pages that may need review after code changes
check-concept-drift:
	@bash scripts/check-concept-drift.sh

# AI model compatibility check — validates AI_MODEL against AI_API_BASE
check-model:
	@bash scripts/ai-model-check.sh

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
	@# Verify @trends/shared dist is not stale (source newer than dist)
	@if [ -f packages/shared/dist/index.js ] && find packages/shared/src -type f -newer packages/shared/dist/index.js -print -quit | grep -q .; then \
		echo "Rebuilding @trends/shared (source is newer than dist)..."; \
		npm run --workspace @trends/shared build; \
	fi
	@npm run check:resume-ai-prompts
	@npm run check:resume-field-usage-policy
	@npm run check:search-profile-templates
	@npm run check:resume-skills-locales
	@npm --workspace @trends/web run gen:api
	@git diff --exit-code apps/web/src/lib/api-types.ts >/dev/null || ( \
		echo "apps/web/src/lib/api-types.ts is out of date. Run 'npm --workspace @trends/web run gen:api' and commit changes."; \
		exit 1; \
	)
	@echo "Checking browser extension content.js is in sync..."
	@cd apps/browser-extension && npm run build
	@git diff --exit-code apps/browser-extension/content.js >/dev/null || ( \
		echo "apps/browser-extension/content.js is out of date. Run 'cd apps/browser-extension && npm run build' and commit changes."; \
		exit 1; \
	)
	@if [ "$$CI" = "true" ] || [ "$$CI" = "1" ]; then \
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
	@$(MAKE) check-node-tests-types

# Test-file typecheck gate (apps/api). Catches phantom-type test assertions
# (e.g. Q3's minExperience) that the package tsconfig excludes from `tsc`.
# Wired into check-node. Adds ~10s (the test program re-typechecks apps/api
# source; composite project references would dedupe but are a separate
# initiative). HARD-BLOCKING as of T5: the latent test-type error baseline
# reached 0 (PRs #1285-#1289), so new test-file type errors now fail make
# check. Override with TESTS_TYPES_GATE=report-only for a non-blocking run.
TESTS_TYPES_GATE ?= hard
check-node-tests-types:
	@echo "Running apps/api test-file typecheck (gate=$(TESTS_TYPES_GATE))..."
	@mkdir -p logs
	@if npm run --workspace @trends/api typecheck:tests > logs/tests-types.log 2>&1; then \
		echo "  apps/api test-file types: 0 errors"; \
	elif [ "$(TESTS_TYPES_GATE)" = "hard" ]; then \
		ERRS=$$(grep -cE "error TS[0-9]+" logs/tests-types.log || true); \
		if [ "$$ERRS" -gt 0 ]; then \
			echo "  apps/api test-file typecheck FAILED ($$ERRS errors):"; \
			grep -E "error TS[0-9]+" logs/tests-types.log | head -n 10 | sed 's/^/    /'; \
			[ "$$ERRS" -gt 10 ] && echo "    ... ($$((ERRS - 10)) more in logs/tests-types.log)"; \
		else \
			echo "  apps/api test-file typecheck FAILED (no TS errors — likely a tooling/infra failure):"; \
			tail -n 20 logs/tests-types.log | sed 's/^/    /'; \
		fi; \
		echo "  Run 'npm --workspace @trends/api run typecheck:tests' for full output."; \
		exit 1; \
	else \
		ERRS=$$(grep -cE "error TS[0-9]+" logs/tests-types.log || true); \
		echo "  apps/api test-file typecheck: $$ERRS errors (report-only — cleanup in progress, T2-T5)"; \
		grep -E "error TS[0-9]+" logs/tests-types.log | head -n 10 | sed 's/^/    /'; \
		[ "$$ERRS" -gt 10 ] && echo "    ... ($$((ERRS - 10)) more in logs/tests-types.log)"; \
	fi

# Build validation (for CI)
check-build: check
	@echo "Running build validation..."
	@if [ "$$CI" = "true" ] || [ "$$CI" = "1" ] || ! command -v bun > /dev/null 2>&1; then \
		npm run --workspace @trends/shared build; \
		npm run --workspace @trends/api build; \
		npm run --workspace @trends/web build; \
		if [ -n "$$CONVEX_DEPLOYMENT" ]; then npm run --workspace @trends/convex build; else echo "Skipping @trends/convex build (CONVEX_DEPLOYMENT not set)"; fi; \
	else \
		bun run --filter '@trends/shared' --filter '@trends/api' --filter '@trends/web' build; \
		if [ -n "$$CONVEX_DEPLOYMENT" ]; then bun run --filter '@trends/convex' build; else echo "Skipping @trends/convex build (CONVEX_DEPLOYMENT not set)"; fi; \
	fi

# CI-parity local gate: run the same steps as the Checks + Tests workflows
# (node-version parity, i18n, agent policy, check-build, test-coverage) so the
# loop-class failures of 2026-07 (React 18 root hoist, unstable i18n-mock `t`,
# vitest hangs) surface locally instead of burning a 30-minute CI run.
# NODE_VERSION_STRICT=1 makes the node-major check a hard failure.
ci-local:
	@bash scripts/check-node-version.sh
	@$(MAKE) i18n-check
	@$(MAKE) check-agent-policy
	@CI=true $(MAKE) check-build
	@$(MAKE) test-coverage
	@echo ""
	@echo "✅ ci-local: all CI gates passed (Checks + Tests parity)"

# =============================================================================
# Tests
# =============================================================================

test: test-python test-node                ## Run all tests (Python + TypeScript)

test-python:                               ## Run Python tests
	@echo "Running Python tests..."
	@uv run pytest apps/worker/tests tests/ -v

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

my-scoring:                                ## Run MY market scoring unit + integration tests
	@echo "Running MY scoring unit/integration suite..."
	@if command -v bun > /dev/null 2>&1; then \
		bun run test:scoring:my; \
	else \
		npm run test:scoring:my; \
	fi

my-scoring-e2e:                            ## Run MY market scoring Playwright e2e (dev:fast webServer)
	@echo "Running MY scoring e2e..."
	@if command -v bun > /dev/null 2>&1; then \
		bun run test:scoring:my:e2e; \
	else \
		npm run test:scoring:my:e2e; \
	fi

test-worker-resume-tasks:                  ## Run worker resume task keyword assembly tests
	@echo "Running worker resume task tests..."
	@uv run pytest apps/worker/tests/test_resume_tasks.py tests/test_resume_tasks.py -q

test-collect-url-smoke:                    ## Run quick smoke for Collect URL keyword concatenation
	@echo "Running Collect URL smoke check..."
	@if command -v bun > /dev/null 2>&1; then \
		bun run test:e2e:collect-url; \
	else \
		npm run test:e2e:collect-url; \
	fi

auth-workspace-smoke:                      ## Run auth/session/CSRF workspace smoke (requires AUTH_SMOKE_EMAIL/PASSWORD)
	@echo "Running auth workspace smoke check..."
	@bunx tsx scripts/auth-workspace-smoke.ts

auth-provider-membership:                  ## Manage provider membership preapprovals (ARGS="list-identities --provider casdoor")
	@bunx tsx scripts/auth/manage-provider-membership.ts $(ARGS)

auth-provider-claims-smoke:                ## Run fixture-driven Casdoor/WeCom provider claims smoke
	@bunx tsx scripts/auth/casdoor-wecom-claims-smoke.ts

test-coverage:                             ## Run Node.js tests with coverage
	@echo "Running Node.js tests with coverage..."
	@npm run --workspace @trends/shared build
	@cd apps/web && npm run test -- --coverage
	@npx vitest run --coverage apps/api/src packages/convex/convex packages/shared/src scripts/extension-zip-integrity.test.ts

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
	@echo "Local dev stack (runs on your laptop):"
	@echo "  dev            Start all services (MCP + crawler + apps/*)"
	@echo "  dev-samples    Start dev stack with sample resume snapshots from the sample repo"
	@echo "  dev-fast       Start fast UI loop (Convex + API + web)"
	@echo "  dev-critical   Start critical-path loop (Convex + scraper + API + web)"
	@echo "  dev-backend    Start backend loop (Convex + MCP + worker + scraper + API)"
	@echo "  dev-clean      Kill stale dev processes and free dev ports"
	@echo "  dev-mcp        Start only MCP server (HTTP on port 3333)"
	@echo "  dev-crawl      Run crawler only (no long-running services)"
	@echo "  dev-convex     Start only local Convex dev backend"
	@echo "  dev-convex-stop Stop local Convex listeners on ports 3210/3211 and the default Convex tmux session"
	@echo "  dev-convex-restart Restart only local Convex dev backend (foreground)"
	@echo "  dev-convex-refresh Refresh local Convex in detached tmux mode when tmux is available"
	@echo "  dev-convex-ensure Start local Convex only when http://127.0.0.1:3210 is currently unreachable"
	@echo "  dev-convex-status Show local Convex listeners, process RSS, state size, resume count, and backlog"
	@echo "  dev-web        Start React frontend (Vite on port 5173)"
	@echo "  dev-api        Start Hono BFF API server (port 3000)"
	@echo "  dev-api-worker Start FastAPI worker REST API (port 8000)"
	@echo "  dev-worker     Start worker scheduler (run now + verbose)"
	@echo ""
	@echo "Local run (production-mode on your laptop, NOT on prod host):"
	@echo "  local-run-crawler  Run crawler (alias: run/crawl)"
	@echo "  local-run-mcp      Start MCP server, STDIO mode (alias: mcp)"
	@echo "  local-run-mcp-http Start MCP server, HTTP on port 3333 (alias: mcp-http)"
	@echo "  local-run-worker   Start worker scheduler (alias: worker)"
	@echo "  local-run-worker-once Run worker once and exit (alias: worker-once)"
	@echo ""
	@echo "Remote (laptop -> remote host via SSH tunnel):"
	@echo "  remote-backup-prod One-shot: SSH tunnel -> backup prod -> close tunnel"
	@echo "                    Defaults: SSH_HOST=ptcloud, WORKSPACE=dev, OUT=timestamped (alias: backup-prod)"
	@echo "                    Example: make remote-backup-prod SSH_HOST=myhost WORKSPACE=hr"
	@echo ""
	@echo "Dual-target (follows $API_URL; defaults to localhost):"
	@echo "  backup-resumes     Export resumes to portable backup"
	@echo "  restore-resumes    Restore resumes from backup file (MODE=replace|merge, YES=1 for replace)"
	@echo "  restore-resumes-restart Restore + restart local Convex"
	@echo ""
	@echo "Restore to local dev (laptop-only):"
	@echo "  local-restore-from-prod One-shot: clear dev + replace-restore from FILE (alias: restore-from-prod)"
	@echo "                         MODE=replace YES=1 preset; auto-writes safety pre-backup"
	@echo "                         Example: make local-restore-from-prod FILE=output/resume-backups/resumes-prod-dev-...tar.gz"
	@echo ""
	@echo "On prod host (ssh in first: ssh <host> && cd /opt/trends):"
	@echo "  on-prod-install        Install as systemd services, requires sudo (alias: prod-install/install)"
	@echo "  on-prod-deploy         Preflight + snapshot + upgrade, requires sudo (alias: prod-deploy/deploy)"
	@echo "  on-prod-deploy-check   Dry run deploy precheck (alias: prod-deploy-check/deploy-check)"
	@echo "  on-prod-refresh-env    Refresh env + rebuild web bundle (alias: refresh-env)"
	@echo "  on-prod-preview-restore-full-state"
	@echo "                         Restore prod Convex + SQLite candidate actions into preview"
	@echo "                         (alias: preview-restore-full-state/restore-preview-full-state)"
	@echo "  on-host-preview-rehearse-backup"
	@echo "                         Replay selected historical prod-complete backup; stops after baseline"
	@echo "                         Requires BACKUP_DIR=<dir> TARGET_REF=<exact-ref>"
	@echo "  on-host-preview-rehearse-resume Resume attended rehearsal at approval/browser gate (RUN_ID=...)"
	@echo "  on-host-preview-rehearse-rollback Explicit evidence-preserving preview rollback (RUN_ID=...)"
	@echo "  on-host-preview-verify-snapshot Manual snapshot verification (RUN_ID=... MODE=baseline|upgraded)"
	@echo "  on-host-preview-run-migrations Manual canonical preview migrations (RUN_ID=...)"
	@echo "  on-prod-uninstall      Remove systemd services, requires sudo (alias: uninstall)"
	@echo "                         See ./scripts/install.sh --help for branch preflight, rollback backups, CI=true/1"
	@echo ""
	@echo "Local tooling:"
	@echo "  check / test              Validate / test the repo"
	@echo "  check-node / check-python / check-build"
	@echo "  migration-test            Run v0.2.1 -> main migration workflow (requires external BACKUP_FILE)"
	@echo "  migration-test-fresh-sandbox Run migration-test after a guarded full local app-state reset"
	@echo "  install-deps              Install deps + build bin/trends + prefetch Convex"
	@echo "  prefetch-convex           Prefetch Convex local backend + dashboard"
	@echo "  cli-build / cli-install / cli-test"
	@echo "  docker / docker-build / docker-down"
	@echo "  build-static / build-static-fresh / build-extension-zip / serve-static"
	@echo "  fetch-docs"
	@echo "  i18n-check / i18n-sync / i18n-convert / i18n-translate / i18n-build"
	@echo "  install-hooks"
	@echo "  sync-agent-* / install-*-skill / check-*-skill / validate-skill"
	@echo "  sync-search-profile-templates / check-search-profile-templates"
	@echo ""
	@echo "Utilities:"
	@echo "  resume-search   Search resumes via the Go CLI"
	@echo "                 Uses QUERY=, optional SOURCE=sample|convex, LIMIT=50, JSON=1, API_URL, WORKSPACE"
	@echo "  resume-show     Show one resume with detailed work history via the Go CLI"
	@echo "                 Uses ID=<resume-id>, optional SOURCE=sample|convex, JSON=1, API_URL, WORKSPACE"
	@echo "  seed           Seed Convex with system job descriptions"
	@echo "  seed-full      Seed Convex with system job descriptions + sample resumes"
	@echo "  seed-force     Force seed Convex even if DB is not empty"
	@echo "  seed-clear     Clear all Convex seeded data (seed:clearAll)"
	@echo "  seed-clear-workspace WORKSPACE=<slug> Clear workspace-scoped Convex data (default: dev)"
	@echo "  seed-clear-dev Clear workspace-scoped Convex data for dev"
	@echo "  seed-clear-demo-resumes Clear only demo resumes tagged workspace-demo"
	@echo "  clear-resumes  Clear resume-related Convex collections"
	@echo "  seed-matches   Seed deterministic resume matches for dev mode"
	@echo "  clear-matches  Clear cached resume matches from SQLite"
	@echo "  verify-critical-path Run critical-path smoke verification (Collection -> Search -> Analysis)"
	@echo "  verify-workflow-dataset Verify source mix, query matches, and visible results for a resume workflow dataset"
	@echo "  verify-top6     Run Top 6 verification & orchestration suite (service probe/spawn + 6 suites)"
	@echo "  benchmark-critical-path Run repeated critical-path benchmark (median/p95 + rates)"
	@echo "  benchmark-critical-path-seeded Run seeded-only benchmark profile"
	@echo "  benchmark-parallelism-matrix Run AI/submit parallelism benchmark matrix"
	@echo "  benchmark-dev-resume-latency Measure local /dev/resumes before/after make dev-convex-refresh"
	@echo "  verify-dev-resume-latency Run strict local /dev/resumes regression gate against latest artifact"
	@echo "  refresh-sample Auto-refresh resume sample data via CDP"
	@echo "  refresh-sample-manual Show manual instructions for refreshing resume sample data"
	@echo "  debug-51job-detail Inspect one synced 51job resume via Trends CLI backup"
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
	@echo "  my-scoring     Run MY market scoring unit + integration tests"
	@echo "  my-scoring-e2e Run MY market scoring Playwright e2e"
	@echo "  test-worker-resume-tasks Run worker keyword assembly tests"
	@echo "  test-collect-url-smoke Run Collect button URL smoke check"
	@echo "  auth-workspace-smoke Run auth/session/CSRF workspace smoke (requires AUTH_SMOKE_EMAIL/PASSWORD)"
	@echo "  auth-provider-membership Manage provider membership preapprovals (ARGS='list-identities --provider casdoor')"
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
	@echo "  CONVEX_MIRROR_MODE Shared Convex prefetch source order for dev/install/deploy: off|fallback|mirror-first"
	@echo "                     When CI=true/1, shared Convex prefetch mode defaults to off"
	@echo "  CI             Set true/1 when running shared prefetch-backed entrypoints in CI"
	@echo "  CONVEX_MIRROR_BASES / CONVEX_DOWNLOAD_TIMEOUT_SECS / CONVEX_CONNECT_TIMEOUT_SECS"
	@echo "                 Shared Convex prefetch mirror-base and timeout overrides for dev/install/deploy"
	@echo "  CONVEX_CURL_NO_SILENT Set true/1 to keep shared Convex prefetch curl progress output enabled"
	@echo "  SKIP_MATCH_SEED Set to true to skip automatic seed-matches in make dev"
	@echo "  SERVICE_PROFILE Default service profile when running scripts/dev.sh (full|critical|fast-ui|backend)"
	@echo "  CONVEX_STARTUP_TIMEOUT / CONVEX_STARTUP_RETRIES / CONVEX_RETRY_DELAY_SECS"
	@echo "                 Dev Convex startup timeout and retry controls"
	@echo "  CONVEX_LOCAL_BACKEND_VERSION / CONVEX_LOCAL_FORCE_UPGRADE"
	@echo "                 Dev Convex local backend version pin and first-attempt upgrade behavior"
	@echo "  WEB_SKIP_API_GEN Set to true to start web without OpenAPI type generation"
	@echo "  MCP_PORT       MCP server port (default: 3333)"
	@echo "  TRENDS_WORKER_PORT FastAPI worker port (default: 8000)"
	@echo "  API_PORT       BFF API port (default: 3000)"
	@echo "  WEB_PORT       Web frontend port (default: 5173)"
	@echo "  CDP_PORT       Chrome DevTools port (default: 9222)"
	@echo "  ALLOW_EMPTY    Allow empty resume samples (set to 1)"
	@echo "  KEYWORD        Search keyword for refresh-sample / verify / benchmark"
	@echo "  SAMPLE         Sample name for refresh-sample (default: sample-initial)"
	@echo "  RESUME_ID      51job resumeId for make debug-51job-detail"
	@echo "  RAW_PATH       Optional raw detail payload JSON path for make debug-51job-detail"
	@echo "  LOCATION       Location filter for refresh-sample / verify / benchmark"
	@echo "  RUNS           Benchmark measured runs per mode (default: 10, matrix: 3)"
	@echo "  WARMUP         Benchmark warmup runs per mode (default: 1, matrix: 0)"
	@echo "  MODES          Benchmark modes list (default: seeded,dual; matrix: seeded)"
	@echo "  BASELINE       Baseline benchmark JSON path for regression compare"
	@echo "  STRICT         Set 1/true to fail benchmark on >25% slowdown"
	@echo "  OUT            Benchmark JSON output path (set to 1/true for default path)"
	@echo "  MODE           Verification mode for verify-critical-path (dual|live|seeded)"
	@echo "  QUERY          Query for verify-workflow-dataset (default: CNC Sales)"
	@echo "  SOURCE_KEY     Source key filter for verify-workflow-dataset (e.g. seek, job5156)"
	@echo "  JOB_DESCRIPTION Optional JD id for verify-workflow-dataset score display"
	@echo "  COLLECTION_TIMEOUT_SEC Collection stage timeout for verify-critical-path"
	@echo "  ANALYSIS_TIMEOUT_SEC Analysis stage timeout for verify-critical-path"
	@echo "  API_BASE_URL   API base URL override for verify-workflow-dataset"
	@echo "  LIMIT / TOP    Scan limit and top visible rows for verify-workflow-dataset"
	@echo "  JSON           Set to 1/true for JSON verify/benchmark output"
