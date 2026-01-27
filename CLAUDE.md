# TrendRadar

Chinese news hot topic aggregator with plugin architecture. Crawls trending news from 11+ platforms (Zhihu, Weibo, Douyin, Baidu, etc.), applies keyword filtering, and pushes notifications to 8+ channels.

## Quick Start

```bash
# 1. Install dependencies
make install-deps

# 2. Set up secrets
cp .env.example ~/.secrets/com.trends.app.env
chmod 600 ~/.secrets/com.trends.app.env
# Edit with your API keys

# 3. Allow direnv (auto-loads secrets)
direnv allow

# 4. Start development
make dev
```

## Language & i18n

- **Chat default**: English (switch only if the user requests)
- **Future code/docs**: English (avoid mass-translating untouched legacy code)
- **UI locales**: `zh-Hant` (default), `zh-Hans`, `en`
- **Static outputs**: `output/site/<locale>/...` (3 variants persisted)
- **Translation tooling**: `scripts/i18n/*` (OpenCC for Chinese variants, AI for English)

## Common Commands

### Development (no Docker required)

```bash
make dev           # Start all services natively
make dev-crawler   # Start only the crawler
make dev-mcp       # Start only the MCP server (HTTP)
make dev-watch     # Auto-reload on file changes
```

### Production

```bash
make run           # Run crawler (full output)
make mcp           # Start MCP server (STDIO mode)
make mcp-http      # Start MCP server (HTTP mode)
```

### Dependencies

```bash
make install-deps  # Install all dependencies (Python + Node.js)
make install       # Install Python dependencies only
make install-prod  # Production setup (systemd services)
```

### Docker

```bash
make docker        # Start Docker services
make docker-down   # Stop Docker services
make docker-build  # Build Docker images
make docker-logs   # View Docker logs
```

## Project Structure

```
trendradar/           # Main application (upstream compatible)
├── __main__.py       # Entry point - NewsAnalyzer
├── context.py        # AppContext - dependency injection
├── core/             # Business logic (config, analyzer, frequency)
├── crawler/          # Data fetching (platforms, RSS)
├── storage/          # SQLite + S3 backends
├── notification/     # Push to 8+ channels
├── report/           # HTML report generation
└── ai/               # LiteLLM integration

mcp_server/           # MCP Server (upstream compatible)
├── server.py         # FastMCP 2.0 with 21 tools
├── tools/            # Tool implementations
├── services/         # Data & cache services
└── utils/            # Utilities

packages/             # Shared constants (reduces env vars)
└── config/
    └── constants.py  # Defaults for all settings

plugins/              # User extensions (outside upstream)
├── crawlers/         # Custom data sources
├── notifiers/        # Custom notification channels
└── ai_providers/     # Custom AI providers

deploy/               # Deployment configurations
├── docker/           # Docker Compose files
└── systemd/          # Native Linux services

config/               # Runtime configuration
├── config.yaml       # Main config
├── frequency_words.txt  # Keyword filters
└── ai_analysis_prompt.txt  # AI prompt template

scripts/              # Development & deployment scripts
├── install-deps.sh   # Install dependencies
├── dev.sh            # Start dev services
└── install.sh        # Production setup
```

## Adding Features

### New Crawler

```bash
# 1. Create plugin file
cp plugins/crawlers/base.py plugins/crawlers/custom/my_source.py

# 2. Implement fetch() method
# 3. Add to config.yaml: platforms: [my_source]
```

### New Notifier

```bash
# 1. Create plugin file
cp plugins/notifiers/base.py plugins/notifiers/custom/discord.py

# 2. Implement send() method
# 3. Set env var: DISCORD_WEBHOOK_URL=...
```

## Configuration

### Environment Setup

```bash
# Secrets file (outside repo)
~/.secrets/com.trends.app.env

# .envrc auto-loads secrets via direnv
direnv allow

# Override with explicit env file
uv run --env-file .env.production python -m trendradar
```

### Key Settings

Defaults in `packages/config/constants.py`. Only secrets need env vars:

| Setting | Default | Description |
|---------|---------|-------------|
| `TIMEZONE` | `Asia/Shanghai` | Timezone for timestamps |
| `REPORT_MODE` | `incremental` | daily / current / incremental |
| `AI_MODEL` | `deepseek/deepseek-chat` | LiteLLM model format |
| `MCP_PORT` | `3333` | MCP HTTP server port |

### Required Secrets

```bash
AI_API_KEY=sk-...              # Required for AI features
TELEGRAM_BOT_TOKEN=...         # At least one notification channel
TELEGRAM_CHAT_ID=...
```

## Architecture

### Key Design Patterns

1. **AppContext (DI)**: Centralized access to config, storage, time
2. **Storage Abstraction**: SQLite local + S3 remote, auto-selected
3. **Mode-based Reports**: daily / current / incremental
4. **LiteLLM**: Unified access to 100+ AI providers
5. **Plugin System**: Extend without modifying core

### Data Flow

```
NewsAnalyzer.run()
├── _crawl_data()              → Fetch from platforms
├── _crawl_rss_data()          → Fetch RSS feeds
├── _execute_mode_strategy()   → Apply report mode
│   ├── count_frequency()      → Statistical analysis
│   ├── _run_ai_analysis()     → AI-powered analysis
│   └── generate_html()        → HTML reports
└── _send_notification()       → Push to channels
```

## Deployment

### Native (systemd)

```bash
sudo ./scripts/install.sh --production

# Enable services
sudo systemctl enable trendradar.timer trendradar-mcp
sudo systemctl start trendradar.timer trendradar-mcp
```

### Docker

```bash
cd deploy/docker
docker compose up -d
```

### GitHub Actions

Runs hourly via `.github/workflows/crawler.yml`

## Syncing from Upstream

```bash
git remote add upstream https://github.com/karlorz/TrendRadar.git
git fetch upstream && git merge upstream/master
```

The `trendradar/` and `mcp_server/` directories are kept upstream-compatible.

## Testing

```bash
# Manual testing
uv run python -m trendradar

# MCP Inspector
npx @modelcontextprotocol/inspector

# Verify imports
uv run python -c "import trendradar; import mcp_server; import plugins"
```

## Code Conventions

- Type hints used throughout
- Config via `ctx.config["KEY"]` or `get_config_value("KEY")`
- Async wrappers use `asyncio.to_thread()` for sync operations
- Plugins outside `trendradar/` to avoid upstream conflicts
