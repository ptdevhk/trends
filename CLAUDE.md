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

### Environment Variables
- `ENV_FILE` - Path to .env file (default: .env)
- `SKIP_CRAWL` - Skip crawl on dev startup (default: true; set to false to crawl)
- `MCP_PORT` - MCP server port (default: 3333)
- `WORKER_PORT` - FastAPI worker port (default: 8000)
- `API_PORT` - BFF API port (default: 3000)
- `WEB_PORT` - Web frontend port (default: 5173)

## Architecture

### Package Structure

```
trends/
├── trendradar/           # Core Python application (v5.4.0)
│   ├── __main__.py       # Entry point - NewsAnalyzer orchestrates workflow
│   ├── context.py        # AppContext - dependency injection container
│   ├── core/             # Business logic (config, analyzer, frequency)
│   ├── crawler/          # Data fetching (fetcher, rss/)
│   ├── storage/          # Persistence (SQLite local, S3 remote)
│   ├── notification/     # Push notifications (10+ channels)
│   ├── report/           # HTML report generation
│   └── ai/               # AI integration (LiteLLM-based)
│
├── mcp_server/           # MCP Server package (v3.1.7)
│   ├── server.py         # FastMCP 2.0 server with 21 tools
│   ├── tools/            # 6 tool classes (data_query, analytics, search, etc.)
│   ├── services/         # Data and cache services
│   └── utils/            # Date parsing, validators
│
├── apps/                 # Modern web stack
│   ├── worker/           # FastAPI wrapper + APScheduler
│   │   ├── api.py        # REST endpoints (/health, /trends, /search)
│   │   ├── scheduler.py  # APScheduler setup
│   │   ├── tasks.py      # Scheduled task definitions
│   │   └── main.py       # Worker entry point
│   ├── api/              # Hono BFF (TypeScript)
│   │   ├── src/routes/   # health, trends, topics, search, rss
│   │   ├── src/schemas/  # Zod validation schemas
│   │   ├── src/services/ # Data layer (direct SQLite)
│   │   │   ├── data-service.ts   # Main data access
│   │   │   ├── cache-service.ts  # TTL cache
│   │   │   ├── parser-service.ts # SQLite + config parsing
│   │   │   └── db.ts             # SQLite helpers
│   │   └── openapi.yaml  # API contract
│   └── web/              # React frontend (Vite + shadcn-ui)
│       ├── src/components/   # TrendList, TrendItem, PlatformFilter, etc.
│       ├── src/i18n/         # react-i18next setup
│       └── src/hooks/        # Custom React hooks
│
├── packages/             # Shared code
│   ├── config/           # Shared Python constants
│   └── shared/           # Shared TypeScript types
│
├── config/               # Configuration files
│   ├── config.yaml       # Main config (platforms, modes, AI, notifications)
│   ├── frequency_words.txt   # Keyword groups for filtering
│   ├── ai_analysis_prompt.txt    # AI analysis prompt template
│   └── i18n/             # Internationalization
│       ├── zh-Hant.yaml  # Traditional Chinese (source of truth)
│       ├── zh-Hans.yaml  # Simplified Chinese (OpenCC-generated)
│       ├── en.yaml       # English (AI-translated)
│       └── tm.json       # Translation memory
│
├── scripts/              # Build and utility scripts
│   ├── dev.sh            # Multi-service startup orchestrator
│   ├── install.sh        # systemd service installer
│   ├── install-deps.sh   # Dependency installer
│   ├── build-static.sh   # Static site generator
│   └── i18n/             # Translation tooling
│       ├── sync_keys.py      # Verify all locales have all keys
│       ├── convert_opencc.py # zh-Hant ↔ zh-Hans conversion
│       ├── ai_translate.py   # AI translation for English
│       └── build_static.py   # Build static sites for all locales
│
├── deploy/               # Deployment configurations
│   ├── docker/           # Docker Compose files
│   │   ├── docker-compose.yml
│   │   ├── Dockerfile
│   │   └── Dockerfile.mcp
│   └── systemd/          # systemd service files
│       ├── trendradar.service
│       ├── trendradar.timer
│       └── trendradar-mcp.service
│
├── dev-docs/             # Auto-fetched documentation
│   ├── packages.yaml     # Sources to fetch
│   └── fetch-docs.sh     # Fetch script
│
└── .github/workflows/    # CI/CD pipelines
    ├── crawler.yml       # Scheduled crawling
    ├── deploy-pages.yml  # GitHub Pages deployment
    ├── checks.yml        # Code quality + i18n-check + secret scanning
    ├── docker.yml        # Docker image building
    └── fetch-docs.yml    # Documentation sync
```

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
- `SKIP_CRAWL` - Skip crawl on dev startup (default: true; set to false to crawl)
- `USE_MOCK` - Deprecated (removed)

## Running Individual Components

### Crawler/Analyzer
```bash
uv run python -m trendradar

# Development mode (skips root index.html)
SKIP_ROOT_INDEX=true uv run python -m trendradar
```

### MCP Server
```bash
# STDIO mode (for MCP clients over stdio)
uv run python -m mcp_server.server

# HTTP mode (for web clients)
uv run python -m mcp_server.server --transport http --port 3333
```

### FastAPI Worker
```bash
# REST API only
uv run uvicorn apps.worker.api:app --reload --port 8000

# Scheduler mode (runs immediately + every 30 min)
uv run python -m apps.worker --run-now --interval 30 -v
```

### React Frontend
```bash
cd apps/web && npm run dev
```

### Hono BFF API
```bash
cd apps/api && npm run dev
```

## Testing Notes

- No formal test suite exists; manual testing via `python -m trendradar`
- MCP tools can be tested via MCP Inspector: `npx @modelcontextprotocol/inspector`
- Sample data in `output/` directory for MCP testing
- Worker API endpoints: `curl localhost:8000/health`
- BFF API endpoints: `curl localhost:3000/api/trends`
- BFF topics endpoint: `curl localhost:3000/api/topics`
- BFF health (no worker dependency): `curl localhost:3000/health`

## Code Conventions

- Type hints used throughout Python code
- Config values accessed via `ctx.config["KEY"]` pattern
- Async wrappers in MCP server use `asyncio.to_thread()` for sync operations
- TypeScript uses Zod for schema validation in apps/api
- React components use shadcn-ui + Tailwind CSS in apps/web
