# Research Eng Full Distill — Design (Option 1)

**Status:** Approved 2026-07-21 (grill + re-grill)  
**Implementation plan:** `docs/superpowers/plans/2026-07-21-research-eng-full-distill-plan.md`  
**Vault work item:** `projects/trendradar/work/2026-07-21-research-eng-full-distill/`  
**Donor pin (design only):** `karlorz/TrendRadar-dev` @ `v6.10.0-7-gfddcb0fa` (`fddcb0fa`)  
**Architecture extracts (donor analysis):** `~/wiki/projects/trendradar/architecture/`  
**Worktree branch:** `design/trendradar-v6-migrate-research-agent`

## Goal

Transfer TrendRadar’s **pipeline architecture** into Trends as a first-class **Research Eng** product path: company-centric market / hiring-signal intel for **HR and Sales** personas, stored as **native news items + company signals in Convex**, delivered via **worker ingest + API + CLI + desk widgets**. Do **not** promote the whole TrendRadar runtime (crawl → SQLite date DBs → MCP/API) as a permanent product service. After an event-based dual-run, **hard cut** legacy.

## Locked decisions

| Topic | Choice |
|-------|--------|
| North star | Architecture transfer into Research Eng — not “run bigger TrendRadar” |
| Product | Market / hiring-signal intel; Sales is a second persona on the same core |
| Entity P1 | **Company** (reuse existing `companyKey` / aliases; no second registry) |
| Storage | **Native news items + research signals in Convex** — **full distill**, no permanent SQLite corpus |
| Donor | Pin + architecture extracts = **design donor only** — **no bulk v6 merge** of `trendradar/` / `mcp_server/` |
| Crawl owner | **`apps/worker` first-class ingest job** (thin hotlist/RSS adapters; no `NewsAnalyzer` god-orchestrator for product path) |
| Contracts | Convex queries/mutations + `apps/api` research routes + Go CLI `trends research …` |
| MCP | **Deferred** — optional P2 over new APIs if agent hosts need it |
| Product UI P1 | **HR desk + Sales desk research widgets** (same signals, persona ranking/copy) |
| Approach | **Option 1 — full-stack hard migration** |
| Cutover | Dual-run shadow → **3 consecutive** green parity runs → stop legacy → **hard cut** / delete legacy product path |
| Risk stance | Accept risk for one coherent full-stack milestone |

## Explicit non-goals (P1)

- Full AI analyze / translate / multi-channel **notify** parity with TrendRadar
- Industry / role / person entity graphs
- Sales CRM, outreach automation, or resume-module auto-writes
- Upstream contribution of fork AI hardening to sansan0/TrendRadar
- Bulk package sync of vendored `trendradar/` + `mcp_server/` as the main path
- Long-term dual-brain (SQLite as API source of truth beside Convex)
- New standalone research microservice process (ingest stays on worker)

## Problem with legacy path

Today Trends still vendors TrendRadar-shaped code:

```text
[Legacy — keep only for dual-run shadow]
  crawl (NewsAnalyzer) → SQLite date DBs → MCP / DataService /api/trends
```

That path is **ops/background plumbing**. Results are not a first-class Research Eng product for company/HR/Sales desks. Full distill replaces it:

```text
[Target — sole product path after hard cut]
  Sources (hotlist HTTP, RSS)
       │
  apps/worker ResearchIngestJob
    HotlistPort / RssPort → normalize news items
    CompanyResolver (alias → companyKey)
    SignalProjector → researchSignals + evidence
       │ Convex mutations (write secret pattern)
  Convex: newsItems / newsSources / researchSignals + companies
       │
  apps/api /api/research/*  ·  packages/cli trends research
       │
  apps/web HR desk widget · Sales desk widget
```

## Target architecture

### Layers

| Layer | Responsibility |
|-------|----------------|
| **Sources** | Platform hotlists + RSS (config-driven platform list; safety patterns stolen from donor crawler, not the monorepo layout) |
| **Worker ingest** | Scheduled `ResearchIngestJob`: fetch → normalize → upsert news → resolve companies → emit signals |
| **Convex** | Durable **news items** + **research signals**; company identity remains K3 `companies` / `company_aliases` |
| **API BFF** | Authenticated `/api/research/*` for web and CLI |
| **CLI** | `trends research company`, `trends research ingest --once`, `trends research parity` |
| **Web** | Thin widgets on HR and Sales desks: list signals, evidence links, persona toggle |
| **Legacy** | Shadow crawl only during dual-run; then disabled and removed |

### What we steal from TrendRadar (ideas / thin ports)

- Platform list + crawl safety patterns (`DataFetcher`-class behavior)
- RSS freshness rules
- Keyword vs AI filter exclusivity (ADR-004) as **optional ingest filters**, not product core
- LiteLLM-style enrichment as a later optional signal enricher
- MCP **tool shapes** only if P2 MCP is added over Convex/API

### What we abandon

- `NewsAnalyzer` orchestrator as product spine
- HTML report megamodule and multi-channel notify as product features
- Date-partitioned SQLite as API source of truth
- Bulk merge of pin tree into Trends root

## Data model (Convex)

### Reuse (existing)

- `companies` — immutable `companyKey`, display names, status
- `company_aliases` — `aliasNormalized` → `companyKey` (`resolveAlias` already exists)
- `company_policy_revisions` — **not** rewritten by Research Eng; signals may later inform operators but P1 does not auto-write policy

### New tables (names locked for plan)

**`news_sources`** (optional thin registry; may be config-only in first PR if simpler)

- `sourceId` (e.g. platform id or feed id)
- `kind`: `hotlist` | `rss`
- `displayName`
- `enabled`

**`news_items`**

- `sourceId`, `platform` (string)
- `externalId` (stable id within source when available)
- `title`, `url?`, `rank?`, `publishedAt?`, `capturedAt`
- `rawSnippet?`
- `contentHash` (dedupe key)
- Indexes: by `capturedAt`, by `contentHash`, by `platform` + `capturedAt`

**`research_signals`**

- `companyKey` (required for company-linked signals; unresolved mentions may be dropped or held provisional — P1: prefer resolve-or-skip for dual-persona widgets)
- `kind`: `company_mention` | `hiring_signal` | `market_move` | `sales_trigger`
- `title`, `summary?`
- `evidence`: `{ newsItemId?, title, url?, platform, seenAt, snippet? }`
- `score?` (optional numeric strength; personas re-rank if present)
- `capturedAt`, `ingestRunId?`
- Indexes: by `companyKey` + `capturedAt`, by `kind` + `capturedAt`

Personas (**hr** | **sales**) do **not** fork the store. They re-rank / filter / copy the same `research_signals` rows.

### Signal taxonomy (P1 minimal)

| Kind | Intent |
|------|--------|
| `company_mention` | Company name appears in news/RSS |
| `hiring_signal` | Hiring / headcount / role demand language |
| `market_move` | Funding, product, industry shift |
| `sales_trigger` | Buying / expansion / partnership language useful for prospecting |

## Contracts

### API (illustrative paths for plan)

- `GET /api/research/news` — list recent native news items (filters: platform, since, limit)
- `GET /api/research/companies/:companyKey/signals?persona=hr|sales`
- `GET /api/research/companies/search?q=` — resolve via existing company list/alias
- `POST /api/research/ingest/run` — ops trigger (authz-restricted) optional if worker-only is enough
- `GET /api/research/parity` — dual-run comparison report (ops)

Auth follows existing BFF patterns (session / workspace). Convex writes use existing **write secret** pattern (`CONVEX_WRITE_SECRET`), same as `companies.ts`.

### CLI

```text
trends research company <query> --persona hr|sales
trends research ingest --once
trends research parity
```

Output formats: existing CLI `agent|table|json|csv`.

### Web widgets

- **HR desk:** company research panel — hiring/market emphasis ranking
- **Sales desk:** same company — sales_trigger / market_move emphasis ranking
- Shared evidence links into news item / external URL
- Attach near existing company/policy operator surfaces where practical (e.g. policies / company context); exact route wiring is plan detail

## Dual-run and hard cut

### Dual-run

- Legacy path may still crawl to SQLite for **shadow comparison only**.
- Product readers (web widgets, research API, CLI research) **must not** depend on SQLite.
- New worker ingest is the sole writer of Convex news + signals for product.

### Parity kill switch (event-based, not calendar)

Kill criterion: **`trends research parity` green 3 consecutive scheduled runs**, then:

1. Disable legacy crawl/MCP/SQLite news readers (compose/systemd/worker `NewsAnalyzer` entry).
2. **Hard cut** delete series: remove product dependency on `trendradar/` crawl path, `mcp_server` SQLite tools, and SQLite-backed news `DataService` paths.
3. Rollback = git revert of cutover + re-enable units (dual-run must have been green before delete).

### Parity gates (minimum)

- Native news item count ≥ configured fraction of shadow SQLite count for enabled platforms (exact threshold in plan; default proposal **≥ 80%**).
- Golden companies (seeded registry keys such as `pro-technic-machinery`, `polywell`, plus 3–5 real aliases) each have **≥ 1** `research_signals` row on a green run.
- Sample title overlap / contentHash sample check does not show total empty ingest.

## P1 definition of done

- [ ] Worker ingest writes **native news items** for enabled platforms/RSS into Convex
- [ ] Company resolve uses existing **`companyKey` / aliases**
- [ ] Signals in Convex with evidence (title, url, platform, seenAt)
- [ ] CLI `trends research company` works for **hr** and **sales**
- [ ] HR + Sales desk widgets show the same company with persona-specific ranking
- [ ] Parity **3 consecutive** greens → legacy crawl/MCP/SQLite readers **stopped and removed** from the running product path (hard cut PR series)

## PR DAG (summary; detail in plan)

| PR | Deliverable |
|----|-------------|
| **PR1** | Convex schema + tests (`news_items`, `research_signals`, optional `news_sources`) |
| **PR2** | Worker ingest adapters + schedule + write path |
| **PR3** | Company resolve + signal projector |
| **PR4** | API `/api/research/*` + CLI `trends research` |
| **PR5** | Web HR + Sales widgets |
| **PR6** | Parity harness + dual-run wiring |
| **PR7** | Cutover: disable legacy → hard cut delete legacy product path |

## Relationship to earlier “v6 sync first” idea

**Superseded.** Re-grill rejected bulk v6 merge and permanent SQLite corpus. Pin remains a **donor** for architecture and thin port patterns only.

## Sources used

- Local: grill/re-grill Option 1 approval; `packages/convex/convex/schema.ts` (K3 companies); `apps/worker/tasks.py` (legacy `NewsAnalyzer` crawl); `packages/cli/cmd/root.go`; wiki `projects/trendradar/architecture/*`
- Donor pin: `karlorz/TrendRadar-dev@v6.10.0-7-gfddcb0fa`
