Trends is a multi-source data aggregation, AI-powered filtering, and intelligent notification platform with extensible domain support. It features a pluggable architecture for different use cases:

**Extensions:**
- **News Aggregation** (Production): Crawls trending topics from 50+ Chinese platforms (Zhihu, Weibo, Douyin, Baidu, etc.), applies keyword filtering, and pushes to various notification channels
- **Resume Screening** (Main Development Direction): Multi-source resume collection with AI-powered candidate matching for HR efficiency

**Core Capabilities:**
- Multi-source data collection (crawler, RSS, manual import)
- Keyword & AI-powered filtering with configurable criteria
- Multi-channel notifications (Feishu, DingTalk, WeChat Work, Telegram, Email, Slack)
- MCP Server for AI-powered analysis
- Modern web stack: React frontend, Hono BFF API, FastAPI worker

## Quick Start

```bash
make install-deps     # Install Python/Node dependencies
make dev              # Fast start: skip crawl, use existing output/*.db
make dev ARGS=--fresh # Crawl first, then start services
```

## Resume Screening System (Main Development Direction)

Web-based resume multi-source collection, AI-powered screening, and HR efficient review system.

**Core Goal:** Help HR and managers quickly obtain high-quality candidates matching job requirements, reducing manual screening burden.

**Main Feature:** AI-powered resume screening that automatically matches candidates to job requirements using NLP-based content parsing (skills, experience, education extraction), custom screening criteria, and multi-provider AI support (DeepSeek, OpenAI, LiteLLM-compatible).

**Default Audience:** Chinese HR professionals and recruiters
**Default Language:** zh-Hans (Simplified Chinese) for both input and output

### Architecture (Hub-and-Spoke Pattern)

Cloned from [OpenClaw](https://github.com/openclaw/openclaw)'s gateway architecture. Reference: https://context7.com/openclaw/openclaw/llms.txt

```
┌─────────────────────────────────────────────────────────────────┐
│                     Gateway (Control Plane)                      │
│  - WebSocket-based orchestration                                 │
│  - Session state & candidate profile management                  │
│  - Multi-agent routing with isolated workspaces                  │
│  - Deterministic routing via bindings                            │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Input Sources  │  │   AI Providers  │  │  Output Channels│
│  - Job Boards   │  │  - DeepSeek     │  │  - WeChat Work  │
│  - Manual Upload│  │  - OpenAI       │  │  - Email        │
│  - Email Ingest │  │  - LiteLLM      │  │  - ATS Webhook  │
│  - ATS Webhook  │  │  - Gemini       │  │  - Internal Sys │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Multi-Agent Pipeline

Following OpenClaw's multi-agent routing pattern with deterministic bindings:

```json5
{
  agents: {
    list: [
      { id: "screener", name: "Initial Screener", model: "deepseek/deepseek-chat" },
      { id: "evaluator", name: "Technical Evaluator", model: "anthropic/claude-sonnet-4-5" },
      { id: "final", name: "Final Decision", model: "anthropic/claude-opus-4-5" }
    ]
  },
  bindings: [
    { agentId: "screener", match: { source: "job_board" } },
    { agentId: "screener", match: { source: "manual_upload" } },
    { agentId: "evaluator", match: { stage: "technical_review" } },
    { agentId: "final", match: { stage: "final_decision" } }
  ]
}
```

### Source Plugin Pattern

Adapted from OpenClaw's Channel Plugin SDK:

```typescript
export const sourcePlugin: SourcePlugin = {
  id: 'job_board',
  displayName: '智通直聘',
  configSchema: { /* JSON Schema */ },
  async start({ cfg, log }) { /* initialize connection */ },
  outbound: { async notify(ctx) { /* send to HR */ } },
  async onResume({ candidate, resume, metadata }) { /* process resume */ }
}
```

| OpenClaw Channel | Resume Screening Source |
|-----------------|------------------------|
| WhatsApp | Email ingestion |
| Telegram | Job board API (智通直聘) |
| Slack | Manual upload portal |
| Discord | ATS webhook |

### Skills System (Extensibility)

Following OpenClaw's SKILL.md pattern with scoring:

```markdown
---
name: senior_python_developer
description: Screening criteria for senior Python developer positions
---

# Required Criteria
- 5+ years Python experience
- Django or FastAPI framework knowledge
- Database design experience (PostgreSQL/MySQL)

# Preferred Criteria
- AI/ML project experience
- Open source contributions
- Team leadership experience

# Scoring
- Required: Each criterion = 20 points (max 60)
- Preferred: Each criterion = 10 points (max 30)
- Passing threshold: 70 points

# Tools
Use `resume_extract` to parse skills and experience.
Use `skill_match` to calculate matching score.
```

### Session & Tools Configuration

```json5
{
  session: {
    scope: "per-candidate",
    resetTriggers: ["/archive", "/reject"],
    retention: { mode: "until-hired", archiveAfterDays: 90 }
  },
  tools: {
    resume_extract: { enabled: true, formats: ["pdf", "docx", "html"] },
    skill_match: { enabled: true, threshold: 0.7 },
    linkedin_verify: { enabled: true, apiKey: "${LINKEDIN_API_KEY}" }
  },
  notifications: {
    wechat_work: { enabled: true, webhook: "${WECHAT_WORK_WEBHOOK}" },
    email: { enabled: true, smtp: { host: "smtp.example.com", port: 587 } }
  }
}
```

### System Flow

```
Resume Sources → Gateway → Multi-Agent Pipeline → AI Screening & Matching → Push to HR → Tracking & Annotation
```

### Sample Data Generation

Resume sample files in `output/resumes/samples/` include provenance metadata for reproduction.

**Quick regeneration (automated via CDP):**
```bash
make refresh-sample                          # Default: 销售 -> sample-initial.json
make refresh-sample KEYWORD=python           # Custom keyword
make refresh-sample KEYWORD=python SAMPLE=sample-python
make refresh-sample ALLOW_EMPTY=1            # Allow saving empty sample
```
Chrome must be running with remote debugging enabled and the extension installed/enabled.
Manual fallback: `make refresh-sample-manual`.

**Quick regeneration (semi-manual):**
1. Log into https://hr.job5156.com in Chrome (with the browser extension installed)
2. Navigate to: `https://hr.job5156.com/search?keyword=销售&tr_auto_export=json&tr_sample_name=sample-initial`
3. Copy the downloaded `sample-initial.json` into `output/resumes/samples/`

**Sample file format:**
```json
{
  "metadata": {
    "sourceUrl": "https://hr.job5156.com/search?keyword=销售",
    "searchCriteria": { "keyword": "销售" },
    "generatedAt": "2026-02-03T09:27:52.152Z",
    "reproduction": "Navigate to sourceUrl, then add ?tr_auto_export=json"
  },
  "data": []
}
```

**URL Parameters:**
- `?keyword=<term>` - Search keyword (Chinese/English)
- `?tr_auto_export=json` - Auto-download JSON with metadata
- `?tr_sample_name=<name>` - Custom filename (e.g., `sample-initial`)

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
make check            # Run all checks (Python + TypeScript)
make check-python     # Python imports + config validation
make check-node       # TypeScript typecheck + lint (uses bun locally)
make check-build      # Full build validation
make help             # Show all available commands
```

## Architecture

### System Modules

#### Core Engine (`trendradar/`)
Python application orchestrating data collection, filtering, reporting, and notifications. Entry point is `trendradar/__main__.py` (runs `DataAnalyzer`).

Key subsystems:
- **`trendradar/core/`**: config loading, analyzer helpers, frequency filtering
- **`trendradar/crawler/`**: data fetchers + parsers (News: 50+ platforms, Resume: job boards)
- **`trendradar/storage/`**: persistence abstraction (local SQLite, remote S3/R2)
- **`trendradar/notification/`**: push to 10+ channels (Feishu, Telegram, Slack, etc.)
- **`trendradar/report/`**: HTML report generation
- **`trendradar/ai/`**: LiteLLM-based AI analysis integration

#### MCP Server (`mcp_server/`)
FastMCP server exposing tools for querying/analysis. Entry point is `mcp_server/server.py`. Tool implementations live in `mcp_server/tools/` with supporting services in `mcp_server/services/`.

#### Web Stack (`apps/`)
- **BFF API (`apps/api/`)**: Hono (TypeScript). Routes in `apps/api/src/routes/`, Zod/OpenAPI schemas in `apps/api/src/schemas/`, data access in `apps/api/src/services/` (direct SQLite reads + resume JSON samples).
- **Frontend (`apps/web/`)**: React (Vite + shadcn-ui + Tailwind). Routes: `/resumes` (default), `/trends`. UI components in `apps/web/src/components/`.
- **Worker (`apps/worker/`)**: FastAPI scheduler + optional REST endpoints (see `apps/worker/api.py`).
- **Browser Extension (`apps/browser-extension/`)**: Chrome/Edge extension for resume extraction from hr.job5156.com. Scripts in `apps/browser-extension/scripts/`.

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
                    │   output/*.db (SQLite)          │
                    │   output/resumes/samples/*.json │
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
   - `daily`: All data accumulated today
   - `current`: Only currently active data
   - `incremental`: Only newly appeared data

4. **LiteLLM Integration**: AI features use LiteLLM for unified access to 100+ AI providers (DeepSeek, OpenAI, Gemini, etc.).

5. **Layered API Architecture**: React → Hono BFF (TypeScript data layer) → SQLite

6. **Fast Dev Mode**:
   - Skip crawl on dev startup (use existing SQLite output)
   - Optional `--fresh` / `SKIP_CRAWL=false` to crawl first

## Finding Code

| Looking for... | Start here |
|----------------|------------|
| Core engine entry point | `trendradar/__main__.py` (`DataAnalyzer`) |
| Data fetchers/parsers | `trendradar/crawler/` |
| Frequency filtering | `trendradar/core/frequency.py`, `config/frequency_words.txt` |
| Config parsing | `trendradar/core/config.py` |
| API endpoints (BFF) | `apps/api/src/routes/` |
| API schemas (BFF) | `apps/api/src/schemas/` |
| MCP tools | `mcp_server/tools/` |
| React components | `apps/web/src/components/` |
| Browser extension | `apps/browser-extension/` (see `CLAUDE.md` there) |
| Chrome DevTools MCP | `apps/browser-extension/CLAUDE.md` (browser automation tools) |

Tip: when paths drift, use ripgrep: `rg -n "createRoute" apps/api/src/routes` / `rg -n "DataAnalyzer" trendradar`.

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

> **Note:** Service names use the legacy `trendradar` prefix for backward compatibility.

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

## Tests

### Python (pytest)
- Framework: pytest (preferred) or unittest
- Location: `tests/` directory at project root
- Naming: `test_*.py` or `*_test.py`
- Run: `uv run pytest` or `make test-python`

### TypeScript (vitest)
- Framework: vitest
- Location: Place test files next to source using `.test.ts` extension
- Run: `make test-node` (uses bun locally, npm in CI)

### Running Tests
```bash
make test           # Run all tests (Python + TypeScript)
make test-python    # Run Python tests only
make test-node      # Run TypeScript tests only
```

### Guidelines

- Do not use mocks unless absolutely necessary
- Do not skip tests based on missing environment variables
- Make tests resilient to timing and ordering
- Keep tests focused and independent

## Logs

When running `make dev` (or `./scripts/dev.sh`), service logs are written to `logs/{service}.log`:

- **mcp.log**: MCP server output (port 3333)
- **api.log**: Hono BFF API output (port 3000)
- **worker.log**: FastAPI worker output (port 8000)
- **web.log**: Vite dev server output (port 5173)
- **crawler.log**: Crawler output (when using `--fresh`)

Log files are overwritten on each run. Use `tail -f logs/<file>` to follow live output.

### Production (systemd)

Logs are written to systemd journal:

```bash
journalctl -u trendradar -f        # Follow crawler logs
journalctl -u trendradar-mcp -f    # Follow MCP server logs
journalctl -u trendradar -n 100    # Last 100 lines
```

### Log Levels

- **Worker**: Configurable via `--verbose` (DEBUG) or `--quiet` (WARNING)
- **Crawler/MCP**: Uses print statements (no level control)
- **API**: Hono logger middleware for request/response logging

## API Reference

### News Aggregation Extension

#### BFF Endpoints (Hono - port 3000)

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

#### Worker Endpoints (FastAPI - port 8000)

**Health check:**
```bash
curl "http://localhost:8000/health"
```

FastAPI docs: `http://localhost:8000/docs`

#### MCP Server (HTTP - port 3333)

**Start the server:**
```bash
# STDIO mode (for MCP clients over stdio)
uv run python -m mcp_server.server

# HTTP mode (for web clients)
uv run python -m mcp_server.server --transport http --port 3333
```

**Test tools via MCP Inspector:**
```bash
npx @modelcontextprotocol/inspector
```

### Resume Screening Extension (Sample Data)

#### BFF Endpoints (Hono - port 3000)

**List resume samples:**
```bash
curl "http://localhost:3000/api/resumes/samples"
```
→ `{"success":true,"samples":[{"name":"sample-initial","filename":"sample-initial.json","updatedAt":"...","size":12345}]}`

**Get resumes (latest sample):**
```bash
curl "http://localhost:3000/api/resumes"
```
→ `{"success":true,"sample":{"name":"sample-initial"},"summary":{"total":25,"returned":25},"data":[{"name":"...","jobIntention":"..."}]}`

**Get resumes (specific sample + search):**
```bash
curl "http://localhost:3000/api/resumes?sample=sample-initial&q=sales&limit=20"
```
→ `{"success":true,"summary":{"total":5,"returned":5},"data":[{"name":"...","jobIntention":"Sales Manager"}]}`

## Code Conventions

- Type hints used throughout Python code
- Config values accessed via `ctx.config["KEY"]` pattern
- Async wrappers in MCP server use `asyncio.to_thread()` for sync operations
- TypeScript uses Zod for schema validation in apps/api
- React components use shadcn-ui + Tailwind CSS in apps/web

### Package Manager

- **CI (remote)**: Always use `npm` / `npx` for reproducible builds
- **Local dev**: Use `bun` / `bunx` for faster installs and execution
- **Python**: Use `uv run` for Python scripts

Makefile targets auto-detect bun availability:
```bash
# Uses bun if available, falls back to npm
make check-node
make check-build
make test-node
```

### Running Scripts from Project Root

**Preferred: Direct shell script execution** (works with any package manager):

```bash
./apps/browser-extension/scripts/cmux-setup-profile.sh
./scripts/dev.sh
```

**Workspace scripts via package manager:**

```bash
# bun (local dev)
bun run --filter @trends/browser-extension cmux:setup-profile

# npm (CI)
npm run cmux:setup-profile --workspace @trends/browser-extension

# Python (uv)
uv run python -m mcp_server.server
```

## Agent Guidelines

### Documentation Check
- **dev-docs/**: Always check this directory for cached documentation (e.g., LiteLLM, FastMCP) before implementation.
  - If you encounter a repository URL, use the `context7` tool to query for more detailed documentation.
- **Job5156 Specs**: See `dev-docs/job5156/manual.md` for detailed operational rules and definitions for the 智通直聘 platform.

## Chinese Text Handling (zh-Hans)

The default audience is Chinese HR professionals. Follow these guidelines for robust Simplified Chinese input/output handling.

### Character Encoding

- **Python file I/O**: Always use `encoding="utf-8"` explicitly
- **JSON serialization**: Always use `ensure_ascii=False` to preserve Chinese characters
- **SQLite**: UTF-8 by default, use parameterized queries (never string concat)
- **HTTP URLs**: Use `encodeURIComponent()` / `URLSearchParams` for proper encoding

### Delimiter Handling

Chinese input may use different delimiter characters:

| Type | ASCII | Chinese | Regex Pattern |
|------|-------|---------|---------------|
| Comma | `,` (U+002C) | `，` (U+FF0C) | `/[,，、]/g` |
| Enumeration | N/A | `、` (U+3001) | Include in comma pattern |
| Space | ` ` (U+0020) | `　` (U+3000) | `/[\s\u3000]+/g` |

**Best practice**: When splitting user input by comma, always use `/[,，、]/g` to handle all variants.

### Keyword/Search Input

Platform search supports multi-keyword input separated by spaces (e.g., `五金 销售`). Users may enter either half-width space (U+0020) or full-width space (U+3000); normalize before processing or matching.

For multi-keyword search (e.g., `车床 销售`):

1. **Normalize spaces**: Convert full-width space (U+3000) to half-width (U+0020)
2. **Collapse multiple**: Multiple spaces → single space
3. **Trim**: Remove leading/trailing whitespace
4. **URL encoding**: Space becomes `+` or `%20` in query strings

```typescript
function normalizeKeyword(keyword: string): string {
  return keyword
    .replace(/[\u3000]/g, " ") // Full-width → half-width
    .replace(/\s+/g, " ") // Collapse
    .trim();
}
```

### Text Comparison

- Use `.localeCompare()` for sorting Chinese strings
- Apply `.normalize("NFC")` before comparison if handling user input from multiple sources
- Use case-insensitive matching for mixed Chinese/English text

### Common Chinese Patterns

Resume data often contains these patterns:

| Field | Pattern | Example |
|-------|---------|---------|
| Age | Contains `岁` | `28岁` |
| Experience | Contains `年` (not `元`) | `5年` |
| Salary | Contains `元` | `8000-12000元/月`, `面议` |
| Education | Matches /(中专\|高中\|大专\|本科\|硕\|博\|研究生\|MBA\|EMBA)/ | `本科` |

### File Naming with Chinese

When using Chinese in filenames:

- Sanitize using: `.replace(/[\\/:*?"<>|]/g, "-")`
- Replace spaces with hyphens: `.replace(/\s+/g, "-")`
- Limit length: `.slice(0, 80)`
