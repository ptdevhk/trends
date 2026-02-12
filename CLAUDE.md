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

<!-- AGENT_POLICY:BEGIN -->
## Agent Governance Policy (Canonical)

- Canonical policy file: `AGENTS.md`
- Generated mirror file: `dev-docs/AGENTS.md`
- Do not edit `dev-docs/AGENTS.md` directly.
- After policy edits, run `npx tsx scripts/agent-governance/sync-policy.ts`.

### Source Matrix (strict order)
1. Local repository sources, including `dev-docs/*.txt` and implementation files.
2. Context7 references for library/framework/API behavior and usage details.
3. Official web sources only when freshness-sensitive or time-sensitive facts are required.

### Evidence Contract
- For non-trivial technical design/recommendation responses, include a `Sources Used` section.
- `Sources Used` must include:
  - Repo-relative file paths consulted.
  - Context7 library IDs queried.
  - Web URLs only when freshness-sensitive facts are used.
- Use `none` for any category with no source usage.

### Enforcement
- Sync generated policy mirror with `make sync-agent-policy`.
- Validate policy drift with `make check-agent-policy`.
- Validate governance skill package and installed copy with `make check-agent-skill`.
- `make check` must fail if policy or governance skill checks fail.
<!-- AGENT_POLICY:END -->

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
make check            # Run all checks (Python + TypeScript)
make check-python     # Python imports + config validation
make check-node       # TypeScript typecheck + lint (uses bun locally)
make check-build      # Full build validation
make help             # Show all available commands
```

---

## Coding Conventions

### Package Manager & Runtime
- **Local dev**: Use `bun` / `bunx`. Fall back to `npm` / `npx` only if bun is unavailable.
- **GitHub CI**: Use `npm` / `npx` only. Do not depend on bun in CI workflows.
- In shell scripts, use the fallback pattern: `if command -v bun > /dev/null; then bun ...; else npm ...; fi`
- Both `bun.lock` and `package-lock.json` are maintained.
- Target: **Node 22** (LTS). Global `fetch` is available - no polyfills needed.
- Python uses `uv` for dependency management (not pip directly).

### TypeScript
- Always use `node:` prefix for Node.js built-in imports (e.g., `import fs from 'node:fs'`)
- Do not use the `any` type - use `unknown` and narrow, or define proper types
- Do not use type casts (`as`) unless absolutely necessary - prefer zod parsing for runtime validation
- Do not use dynamic imports unless following an existing pattern in the codebase
- When using try/catch, never suppress errors silently - always `console.error` caught errors

### General
- Do not modify README.md unless explicitly asked
- Do not write docs or comments unless explicitly asked
- Prefer editing existing files over creating new ones

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ News Crawler │  │ Job Boards   │  │ Manual Upload│  │ Email Ingest │    │
│  │ (50+ sites)  │  │ (job5156)    │  │ (CSV/JSON)   │  │ (IMAP)       │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
└─────────┼─────────────────┼─────────────────┼─────────────────┼────────────┘
          │                 │                 │                 │
          ▼                 ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           STORAGE LAYER                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  output/*.db (SQLite)          output/resumes/samples/*.json        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Hono BFF API (:3000)          FastAPI Worker (:8000)               │   │
│  │  - /api/trends                  - Scheduler                          │   │
│  │  - /api/resumes                 - AI Matching                        │   │
│  │  - /api/job-descriptions        - Crawl triggers                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PRESENTATION LAYER                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ React Web (:5173)│  │ MCP Server (:3333)│  │ Notifications            │  │
│  │ - Resume Review  │  │ - AI Analysis    │  │ - Feishu, Telegram       │  │
│  │ - News Dashboard │  │ - Query Tools    │  │ - WeChat Work, Email     │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Resume Screening System (Main Development Direction)

### Design Philosophy: Minimal Human-in-the-Loop

**Core Principle**: Users provide only essential inputs (location + keywords), and the system handles everything else automatically. Configuration is **pre-configured** with sensible defaults but **fully editable** when needed.

### Core User Inputs (Minimal Required)

| Input | Required | Example | Notes |
|-------|----------|---------|-------|
| **Location** | ✅ Yes | `东莞`, `广州` | Single or multiple |
| **Keywords** | ✅ Yes | `车床 销售`, `CNC` | Space-separated |
| **Job Description** | ⚙️ Auto-select | `lathe-sales` | Auto-matched or user-selected |

All other parameters have smart defaults and are auto-configured.

### Automated Workflow (3-Step Flow)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          USER INPUT (MINIMAL)                                │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────────────────────┐  │
│  │  Location   │  │    Keywords      │  │  Job Description (optional)   │  │
│  │  东莞       │  │  车床 销售       │  │  [Auto-select or Pick from   │  │
│  └─────────────┘  └──────────────────┘  │   dropdown]                   │  │
│                                          └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STEP 1: AUTO-CONFIGURE (No User Action)                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 1. Match keywords to Job Description (JD) from library              │   │
│  │ 2. Create/resume Session with location + keywords                   │   │
│  │ 3. Set default filters (experience, education, salary ranges)       │   │
│  │ 4. Configure AI agents (screener → evaluator → final)               │   │
│  │ 5. Set notification preferences (WeChat Work, Email)                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│               STEP 2: AUTO-COLLECT & MATCH (Runs Automatically)              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 1. Browser Extension crawls job board with location + keywords      │   │
│  │ 2. Extract resumes → normalize → deduplicate                        │   │
│  │ 3. AI Screener: Initial pass (batch, parallel)                      │   │
│  │ 4. AI Evaluator: Detailed scoring (top candidates only)             │   │
│  │ 5. Store results with match scores + recommendations                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                STEP 3: REVIEW & ACT (HR Human-in-the-Loop)                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ HR sees: Pre-sorted candidates ranked by AI match score             │   │
│  │                                                                       │   │
│  │ Actions: ✅ Shortlist  ❌ Reject  📞 Contact  📝 Add Notes           │   │
│  │                                                                       │   │
│  │ Smart Features:                                                       │   │
│  │ • One-click bulk actions (shortlist all 80+ score)                  │   │
│  │ • Auto-send notifications for shortlisted candidates                │   │
│  │ • AI-generated outreach messages (optional)                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Configuration System (Edit When Needed)

#### 1. Search Profiles (`config/search-profiles/`)

Pre-configured search profiles that combine location + keywords + filters:

```yaml
# config/search-profiles/dongguan-lathe-sales.yaml
id: dongguan-lathe-sales
name: 东莞车床销售招聘
location: 东莞
keywords:
  - 车床
  - 销售
  - CNC
jobDescription: lathe-sales  # Auto-linked JD
filters:
  minExperience: 2
  education: [大专, 本科]
  salaryRange: [8000, 20000]
schedule:
  enabled: true
  cron: "0 9 * * 1-5"  # Mon-Fri 9am
notifications:
  wechatWork: true
  email: hr@company.com
```

#### 2. Job Descriptions (`config/job-descriptions/`)

JD system with enhanced auto-matching:

```yaml
# config/job-descriptions/lathe-sales.md (frontmatter)
---
id: jd-lathe-sales
title: 车床销售工程师
auto_match:
  keywords: [车床, CNC车床, 数控车床, STAR, 机床销售]
  locations: [东莞, 广州, 深圳]
  priority: 90  # Higher = preferred when multiple JDs match
  filter_preset: sales-mid
---
```

#### 3. AI Agents (`config/resume/agents.json5`)

Pre-configured agent pipeline with cost-optimized defaults:

```json5
{
  agents: {
    list: [
      { id: "screener", name: "初筛Agent", model: "deepseek/deepseek-chat", 
        config: { batchSize: 50, parallelism: 10, timeout: 30000 } },
      { id: "evaluator", name: "详评Agent", model: "deepseek/deepseek-chat",
        config: { onlyTopPercent: 30, minScreenerScore: 60 } },
      { id: "final", name: "终审Agent", model: "anthropic/claude-sonnet-4-5",
        config: { onlyTopPercent: 10, minEvaluatorScore: 75 } }
    ],
    defaults: {
      screener: { passThreshold: 50 },
      evaluator: { passThreshold: 70 },
      final: { passThreshold: 80 }
    }
  },
  bindings: "auto"
}
```

#### 4. Filter Presets (`config/resume/filter-presets.json5`)

Quick filter presets for common patterns:

```json5
{
  presets: [
    { id: "sales-entry", name: "销售入门级", minExp: 0, maxExp: 3, edu: ["大专", "本科"] },
    { id: "sales-senior", name: "销售资深级", minExp: 5, maxExp: null, edu: ["本科", "硕士"] },
    { id: "engineer-mid", name: "工程师中级", minExp: 3, maxExp: 8, edu: ["本科"] },
    { id: "engineer-senior", name: "高级工程师", minExp: 8, maxExp: null, edu: ["本科", "硕士"] }
  ]
}
```

### UI Design (Minimal Interaction)

#### Quick Start Panel (Default View)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🔍 快速开始                                                                 │
│  ───────────────────────────────────────────────────────────────────────── │
│                                                                              │
│  位置:  [东莞        ▼]     关键词: [车床 销售                    ] [搜索]  │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ ⚡ 智能匹配: 已匹配职位 "车床销售工程师" (lathe-sales)              │   │
│  │    📋 2年+经验 | 💰 8k-20k | 🎓 大专及以上                          │   │
│  │    [使用此配置] [修改配置]                                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Results View (AI Pre-sorted)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  📋 匹配结果                      已处理: 156 | 匹配: 48 | 平均分: 72       │
│  ───────────────────────────────────────────────────────────────────────── │
│                                                                              │
│  [批量操作 ▼] 选中: 0  │  [☐ 全选80分+] [☐ 全部入围] [导出Excel]           │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ ☐  95分 ⭐ 张三 | 5年车床销售 | 本科 | 期望12k | 东莞                  │ │
│  │     🏢 上一家: XX精密机械 → 车床销售主管                               │ │
│  │     💡 AI评语: 经验丰富，有STAR品牌销售经验，符合度高                  │ │
│  │     [✅入围] [❌拒绝] [📞联系] [📝备注]                                 │ │
│  ├───────────────────────────────────────────────────────────────────────┤ │
│  │ ☐  87分    李四 | 3年设备销售 | 本科 | 期望15k | 深圳                  │ │
│  │     🏢 上一家: XX自动化 → 销售工程师                                   │ │
│  │     💡 AI评语: 设备销售经验，需了解车床产品知识                        │ │
│  │     [✅入围] [❌拒绝] [📞联系] [📝备注]                                 │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### API Enhancements

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/search-profiles` | GET/POST | List/create search profiles |
| `/api/search-profiles/:id` | GET/PUT/DELETE | Manage single profile |
| `/api/search-profiles/:id/run` | POST | Execute profile (collect + match) |
| `/api/job-descriptions/match` | POST | Auto-match keywords to JD |
| `/api/filter-presets` | GET | List filter presets |
| `/api/resumes/bulk-action` | POST | Bulk shortlist/reject/contact |
| `/api/notifications/test` | POST | Test notification channel |

### Implementation Phases

#### Phase 1: Core Automation (Current Focus)
- [x] Basic resume collection + AI matching
- [ ] Search Profile system
- [ ] Auto-match JD from keywords
- [ ] Filter presets
- [ ] Simplified Quick Start UI

#### Phase 2: Bulk Actions & Notifications
- [ ] Bulk shortlist/reject/contact
- [ ] Auto-notify shortlisted candidates
- [ ] AI-generated outreach messages
- [ ] WeChat Work integration

#### Phase 3: Scheduling & Monitoring
- [ ] Scheduled crawl jobs
- [ ] Dashboard with crawl status
- [ ] Alert on new high-match candidates
- [ ] Historical analytics

#### Phase 4: Plugin Generalization
- [ ] Extract common plugin patterns
- [ ] Plugin configuration UI
- [ ] Plugin marketplace (internal)

---

## Plugin Architecture (Generalizable Pattern)

The Resume Screening pattern can be generalized to other plugin services:

### Plugin Interface

```typescript
interface PluginService {
  id: string;
  name: string;
  configDir: string;  // e.g., 'config/resume/', 'config/news/'
  requiredInputs: PluginInput[];
  configurableItems: ConfigurableItem[];
  pipeline: PipelineStage[];
  outputChannels: OutputChannel[];
}
```

### Example: News Aggregation Plugin

```typescript
const newsPlugin: PluginService = {
  id: 'news-aggregation',
  name: '热点新闻监控',
  configDir: 'config/news/',
  requiredInputs: [
    { id: 'keywords', label: '监控关键词', type: 'text', required: true },
    { id: 'platforms', label: '平台', type: 'multiselect', required: false,
      defaultValue: ['zhihu', 'weibo', 'baidu'] }
  ],
  configurableItems: [
    { id: 'frequency_words', label: '频率词库', type: 'config-file', editableInUI: true },
    { id: 'notification', label: '通知设置', type: 'config-file', editableInUI: true }
  ],
  pipeline: [
    { stage: 'crawl', handler: 'CrawlerService', parallelism: 10 },
    { stage: 'filter', handler: 'FrequencyFilter', configFile: 'frequency_words.txt' },
    { stage: 'dedupe', handler: 'DedupeService' },
    { stage: 'notify', handler: 'NotificationService' }
  ],
  outputChannels: ['feishu', 'telegram', 'email']
};
```

---

## File Structure

```
config/
├── resume/
│   ├── agents.json5           # AI agent configuration
│   ├── session.json5          # Session settings
│   ├── filter-presets.json5   # Filter presets
│   └── skills_words.txt       # Skill keywords
├── job-descriptions/
│   ├── README.md
│   ├── lathe-sales.md         # Example with auto_match config
│   └── ...                    # Other JD files
├── search-profiles/           # Search profiles
│   ├── README.md
│   ├── dongguan-lathe-sales.yaml
│   └── ...
└── notifications/             # Notification templates
    ├── README.md
    ├── shortlist-wechat.md
    └── shortlist-email.md

apps/
├── api/src/
│   ├── routes/
│   │   ├── resumes.ts
│   │   ├── job-descriptions.ts
│   │   ├── search-profiles.ts   # NEW
│   │   └── bulk-actions.ts      # NEW
│   └── services/
│       ├── resume-service.ts
│       ├── job-description-service.ts
│       ├── search-profile-service.ts  # NEW
│       ├── auto-match-service.ts      # NEW
│       └── notification-service.ts    # NEW
├── web/src/
│   ├── components/
│   │   ├── QuickStartPanel.tsx   # NEW
│   │   ├── ConfigPanel.tsx       # NEW (collapsible)
│   │   ├── BulkActionBar.tsx     # NEW
│   │   └── ...
│   └── pages/
│       └── ResumesPage.tsx       # Updated with new panels
└── browser-extension/
    └── ...                       # Existing extension
```

---

## Planning Guidelines (Multi-Agent/Multi-Session)

When creating implementation plans, follow these rules to enable **parallel execution** across different agents, sessions, or worktrees:

### 1. Atomic Tasks
- Each task should be **independently completable** without blocking on other tasks
- Avoid sequential dependencies where possible (Step B waits for Step A)
- If dependencies exist, clearly mark them: `[DEPENDS: Step 0]`

### 2. File Isolation
- Each task should modify **different files** when possible
- If multiple tasks touch the same file, document which sections each task owns
- Use `[CONFLICT RISK: filename]` to flag potential merge conflicts

### 3. Clear Boundaries
Structure each task with:
```markdown
### Task N: [Name]
**Files**: list of files to modify
**Depends**: none | Task X
**Conflict Risk**: none | [filename]
**Verification**: how to test this task independently
```

### 4. Merge-Friendly Structure
- **Each task = one feature** that can be merged independently
- Plan tasks to touch different files/sections to minimize merge conflicts
- When splitting a phase, ensure each step is a self-contained feature

### 5. Agent Handoff
- Include all context needed for a fresh agent to start
- Reference file paths with absolute links: `[file](file:///path/to/file)`
- Don't assume prior conversation context

### Example Structure
```markdown
## Phase 1.5: Location Filter

### Step 0: Browser Extension Update [INDEPENDENT]
**Files**: content.js
**Depends**: none
**Conflict Risk**: none

### Step 1: Shell Script Update [INDEPENDENT]  
**Files**: refresh-sample.sh
**Depends**: none
**Conflict Risk**: none

### Step 2: Python Script Update [DEPENDS: Step 1]
**Files**: refresh-sample.py
**Depends**: Step 1 (uses --location arg)
**Conflict Risk**: none

### Step 3: Makefile Update [INDEPENDENT]
**Files**: Makefile
**Depends**: none
**Conflict Risk**: none
```

---

## Summary

### What Users Do (Minimal)
1. Enter location + keywords
2. Click "Search" (one button)
3. Review AI-sorted results
4. Bulk approve/reject top candidates

### What System Does Automatically
1. Match keywords → best Job Description
2. Apply default filters based on JD
3. Collect resumes from job boards
4. Run multi-stage AI screening
5. Sort by match score
6. Send notifications on actions

### When Users Want More Control
- Expand "Advanced Config" panel
- Select/edit Job Descriptions
- Customize filter criteria
- Set up scheduled runs
- Configure notification channels

This design minimizes the "human-in-the-loop" burden while keeping full configurability available when needed.
