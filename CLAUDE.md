TrendRadar is a Chinese news hot topic aggregator and analysis tool. It crawls trending news from 50+ platforms (Zhihu, Weibo, Douyin, Baidu, etc.), applies keyword filtering, and pushes notifications to various channels (Feishu, DingTalk, WeChat Work, Telegram, Email, Slack, etc.). It includes an MCP (Model Context Protocol) server for AI-powered news analysis, plus a modern web stack with React frontend, Hono BFF API, and FastAPI worker.

## Quick Start

```bash
make install-deps     # Install Python/Node dependencies
make dev              # Fast start: skip crawl, use existing output/*.db
make dev ARGS=--fresh # Crawl first, then start services
```

## Common Commands

### Development
```bash
make dev              # Fast start: skip crawl, use existing output/*.db
make dev ARGS=--fresh # Full start: crawl first, then start services
make dev ARGS=--force # Kill conflicting port processes
SKIP_CRAWL=false make dev  # Force crawl on startup
make dev-mcp          # Start only MCP server (HTTP on port 3333)
make dev-crawl        # Run crawler only (no long-running services)
make dev-web          # Start React frontend (Vite on port 5173)
make dev-api          # Start Hono BFF API (port 3000)
make dev-worker       # Start FastAPI worker scheduler (port 8000)
make dev-api-worker   # Start FastAPI REST API only
```

### Production
```bash
make run              # Run crawler (production mode, full output)
make crawl            # Alias for run
make mcp              # Start MCP server (STDIO mode)
make mcp-http         # Start MCP server (HTTP on port 3333)
make worker           # Start worker scheduler (default: every 30 min)
make worker-once      # Run worker once and exit
```

### Deployment
```bash
make install          # Install as systemd services (requires sudo)
make uninstall        # Remove systemd services
make docker           # Start Docker containers
make docker-build     # Build and start Docker containers
make docker-down      # Stop Docker containers
```

### Static Site
```bash
make build-static         # Build static site from existing output
make build-static-fresh   # Run crawler first, then build static site
make serve-static         # Serve static site locally (port 8000)
```

### i18n (Internationalization)
```bash
make i18n-check       # Check locale files for missing/extra keys
make i18n-sync        # Auto-fix missing keys with placeholders
make i18n-convert     # Convert zh-Hant to zh-Hans (OpenCC)
make i18n-translate   # Translate zh-Hant to English (AI)
make i18n-build       # Build static sites for all locales
```

### Utilities
```bash
make install-deps     # Install Python/Node dependencies
make fetch-docs       # Fetch latest upstream documentation
make clean            # Remove generated/cached files
make check            # Run basic health checks
make help             # Show all available commands
```

## Architecture

### System Modules

#### Core Crawler (`trendradar/`)
Python application orchestrating crawling, filtering, reporting, and notifications. Entry point is `trendradar/__main__.py` (runs `NewsAnalyzer`).

Key subsystems:
- **`trendradar/core/`**: config loading, analyzer helpers, frequency filtering
- **`trendradar/crawler/`**: fetchers + RSS parsers for 50+ platforms
- **`trendradar/storage/`**: persistence abstraction (local SQLite, remote S3/R2)
- **`trendradar/notification/`**: push to 10+ channels (Feishu, Telegram, Slack, etc.)
- **`trendradar/report/`**: HTML report generation
- **`trendradar/ai/`**: LiteLLM-based AI analysis integration

#### MCP Server (`mcp_server/`)
FastMCP server exposing tools for querying/analysis. Entry point is `mcp_server/server.py`. Tool implementations live in `mcp_server/tools/` with supporting services in `mcp_server/services/`.

#### Web Stack (`apps/`)
- **BFF API (`apps/api/`)**: Hono (TypeScript). Routes in `apps/api/src/routes/`, Zod/OpenAPI schemas in `apps/api/src/schemas/`, data access in `apps/api/src/services/` (direct SQLite reads).
- **Frontend (`apps/web/`)**: React (Vite + shadcn-ui + Tailwind). UI components in `apps/web/src/components/`.
- **Worker (`apps/worker/`)**: FastAPI scheduler + optional REST endpoints (see `apps/worker/api.py`).

#### Configuration (`config/`)
- `config/config.yaml`: platforms, modes, AI settings, notifications
- `config/frequency_words.txt`: keyword filter rules (supports regex like `/pattern/`)
- `config/i18n/`: locale files (zh-Hant is the source of truth)

#### Supporting Directories
- `scripts/`: dev/build/install orchestration + i18n tooling
- `deploy/`: Docker + systemd configs
- `packages/`: shared Python constants + TypeScript types
- `output/`: generated SQLite DBs and artifacts used by the web/API layer

### Data Flow

```
┌─────────────┐     ┌─────────────────────────────────┐
│   React     │────▶│   Hono BFF + TypeScript Data    │
│   (Web)     │     │   (Direct SQLite access)        │
└─────────────┘     │   :3000                         │
     :5173          └────────────────┬────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │   output/news/*.db (SQLite)     │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │   FastAPI Worker (optional)     │
                    │   (Scheduler / crawl helpers)   │
                    │   :8000                         │
                    └─────────────────────────────────┘

┌─────────────┐
│ MCP Server  │
│   :3333     │
└─────────────┘
```

### Key Design Patterns

1. **AppContext (Dependency Injection)**: `trendradar/context.py` provides centralized access to config, storage, time functions.

2. **Storage Backend Abstraction**: `StorageManager` supports both local SQLite and remote S3-compatible storage (Cloudflare R2, etc.).

3. **Mode-based Report Generation**: Three modes control output behavior:
   - `daily`: All news accumulated today
   - `current`: Only currently-on-chart news
   - `incremental`: Only newly appeared news

4. **LiteLLM Integration**: AI features use LiteLLM for unified access to 100+ AI providers (DeepSeek, OpenAI, Gemini, etc.).

5. **Layered API Architecture**: React → Hono BFF (TypeScript data layer) → SQLite

6. **Fast Dev Mode**:
   - Skip crawl on dev startup (use existing SQLite output)
   - Optional `--fresh` / `SKIP_CRAWL=false` to crawl first

## Finding Code

| Looking for... | Start here |
|----------------|------------|
| Crawler entry point | `trendradar/__main__.py` (`NewsAnalyzer`) |
| Fetchers/RSS parsers | `trendradar/crawler/` |
| Frequency filtering | `trendradar/core/frequency.py`, `config/frequency_words.txt` |
| Config parsing | `trendradar/core/config.py` |
| API endpoints (BFF) | `apps/api/src/routes/` |
| API schemas (BFF) | `apps/api/src/schemas/` |
| MCP tools | `mcp_server/tools/` |
| React components | `apps/web/src/components/` |

Tip: when paths drift, use ripgrep: `rg -n "createRoute" apps/api/src/routes` / `rg -n "NewsAnalyzer" trendradar`.

## i18n (Internationalization)

### Locales
- **zh-Hant** (Traditional Chinese) - Source of truth
- **zh-Hans** (Simplified Chinese) - Generated via OpenCC
- **en** (English) - AI-translated

### Translation Workflow
```bash
# 1. Edit source locale
vim config/i18n/zh-Hant.yaml

# 2. Check all locales have same keys
make i18n-check

# 3. Generate Simplified Chinese from Traditional
make i18n-convert

# 4. Translate to English (requires AI_API_KEY)
make i18n-translate

# 5. Build static sites for all locales
make i18n-build
```

### CI Integration
The `i18n-check` job runs in `.github/workflows/checks.yml` to ensure all locales stay in sync.

## Deployment

### Native (systemd)
```bash
sudo ./scripts/install.sh           # Install services
sudo systemctl start trendradar.timer   # Start crawler (every 30 min)
sudo systemctl start trendradar-mcp     # Start MCP server
sudo systemctl status trendradar-mcp    # Check status
```

### Docker
```bash
cd deploy/docker
docker compose up -d trendradar         # Crawler service
docker compose up -d trendradar-mcp     # MCP server
```

### GitHub Actions
- **crawler.yml**: Runs every 33 minutes, stores output as artifacts
- **deploy-pages.yml**: Deploys static site to GitHub Pages
- **checks.yml**: Runs code checks, i18n validation, secret scanning

## Configuration

### Main Config Files
- `config/config.yaml` - Main config (50+ platforms, modes, AI settings, notifications)
- `config/frequency_words.txt` - Keyword groups for filtering (supports regex: `/pattern/`)
- `config/ai_analysis_prompt.txt` - Custom AI analysis prompt template

### Environment Variables

**Required Secrets:**
- `AI_API_KEY` - AI provider API key
- `AI_MODEL` - Model identifier (e.g., `deepseek/deepseek-chat`)

**Optional - Notifications:**
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `FEISHU_WEBHOOK_URL`
- `SLACK_WEBHOOK_URL`
- `DINGTALK_WEBHOOK_URL`, `DINGTALK_SECRET`

**Optional - Remote Storage:**
- `S3_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `S3_REGION`

**Development Mode:**
- `ENV_FILE` - Path to `.env` file (default: `.env`)
- `SKIP_CRAWL` - Skip crawl on dev startup (default: true; set to false to crawl)
- `SKIP_ROOT_INDEX` - Skip generating root `index.html` (useful in dev to avoid git pollution)
- `USE_MOCK` - Deprecated (removed)

**Service Ports:**
- `API_PORT` - BFF API port (default: 3000)
- `WEB_PORT` - Web frontend port (default: 5173)
- `WORKER_PORT` - FastAPI worker port (default: 8000)
- `MCP_PORT` - MCP server port (default: 3333)

## API Reference

### BFF Endpoints (Hono - port 3000)

**Get trending news:**
```bash
curl "http://localhost:3000/api/trends"
```
→ `{"success":true,"summary":{"total":123,"returned":50},"data":[{"title":"...","platform":"zhihu","platform_name":"Zhihu Hot List","rank":1}]}`

**Get topics (keyword frequency):**
```bash
curl "http://localhost:3000/api/topics?mode=current&top_n=10"
```
→ `{"success":true,"topics":[{"keyword":"AI","frequency":15}],"generated_at":"..."}`

**Search news:**
```bash
curl "http://localhost:3000/api/search?q=AI&limit=10"
```
→ `{"success":true,"results":[{"title":"...","platform":"weibo","platform_name":"Weibo Hot Search"}],"total":10}`

**Health check:**
```bash
curl "http://localhost:3000/health"
```
→ `{"status":"healthy","timestamp":"...","version":"..."}`

### Worker Endpoints (FastAPI - port 8000)

**Health check:**
```bash
curl "http://localhost:8000/health"
```

FastAPI docs: `http://localhost:8000/docs`

### MCP Server (HTTP - port 3333)

Test tools via MCP Inspector:
```bash
npx @modelcontextprotocol/inspector
```

## Code Conventions

- Type hints used throughout Python code
- Config values accessed via `ctx.config["KEY"]` pattern
- Async wrappers in MCP server use `asyncio.to_thread()` for sync operations
- TypeScript uses Zod for schema validation in apps/api
- React components use shadcn-ui + Tailwind CSS in apps/web
