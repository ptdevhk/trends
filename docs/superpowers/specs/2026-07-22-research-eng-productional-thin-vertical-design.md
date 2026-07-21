# Research Eng Productional Thin Vertical — Design

**Status:** Approved 2026-07-22  
**Branch context:** local `main` (Research Eng P1 already merged)  
**Predecessor:** `docs/superpowers/specs/2026-07-21-research-eng-full-distill-design.md` (P1 shipped)  
**Implementation plan:** `docs/superpowers/plans/2026-07-22-research-eng-productional-thin-vertical-plan.md`

## Goal

Turn the working Research Eng **showcase** into a **productional thin vertical** operators and HR/Sales can use without seed scripts:

1. **Live data:** hotlist + RSS → native Convex `news_items` / `research_signals`
2. **Ops path:** scheduled ingest when flagged + reliable once-run (CLI / API / in-UI button)
3. **Desk UX:** company discovery, empty/error states, kind filters, resume/policy deep links, operator ingest control

Success is a **checklist**, not a single demo click:

| # | Criterion |
|---|-----------|
| 1 | `trends research ingest --once` (or API / UI button) pulls **live** hotlist + RSS, resolves aliases, writes Convex; research page shows signals **without** manual seed |
| 2 | `RESEARCH_INGEST_ENABLED=1` registers the scheduler job; flag and hotlist URL documented in `.env.example` |
| 3 | Desk: company search/picker + empty state; kind filters; resume/policy deep links; in-page ingest button with run feedback |

## Non-goals (this cycle)

- **PR7 hard cut** of legacy TrendRadar/SQLite product path (still gated on 3 consecutive green `research_parity_runs`)
- Full dual-run **ops campaign** to manufacture greens (parity plumbing already exists; ops execution is separate)
- Full AI analyze / translate / multi-channel notify
- Sales CRM, outreach, industry/role/person graphs
- MCP product surface
- Bulk merge of donor `trendradar/` / `mcp_server/`

## Locked approach

**Thin NewsNow-compatible hotlist adapter + existing RSS port + desk UX extras.**

- Do **not** call `NewsAnalyzer` on the product path.
- Do **not** import donor `DataFetcher` as a permanent dependency; **port** URL shape, status handling (`success` | `cache`), retries, and title normalization ideas only.
- Worker continues to write **directly** to Convex with `CONVEX_URL` + `CONVEX_WRITE_SECRET`.
- Personas remain re-rank only; storage stays shared nested `evidence`.

## Architecture

```text
config/config.yaml platforms.sources + rss.sources
        │
apps/worker ResearchIngestJob
  NewsNowHotlistPort  ──HTTP──► NewsNow-compatible API (?id=<platform>&latest)
  HttpRssPort         ──HTTP──► RSS/Atom feeds
        │ normalize → contentHash
  research_news:upsertItem
  companies:resolveAlias (direct Convex query)
  research_project → research_signals:upsert (nested evidence)
  research_ops start/finish ingest run
        │
Convex: news_items / research_signals / research_ingest_runs
        │
apps/api /api/research/*  (reads + POST ingest/run proxy)
        │
apps/web
  /:teamSlug/research                (optional index: search/picker)
  /:teamSlug/research/:companyKey?persona=&kinds=
  Policies + ResumeDetail deep links
  In-page “Run ingest” → POST /api/research/ingest/run
```

## Data flow — hotlist

### Port contract

Extend or replace `HttpHotlistPort` with a **NewsNow-compatible** implementation:

| Concern | Decision |
|---------|----------|
| Default base URL | Donor default `https://newsnow.busiyi.world/api/s` (override `RESEARCH_HOTLIST_API_URL`) |
| Request | `GET {base}?id={platformId}&latest` |
| Success statuses | JSON `status` in `{ "success", "cache" }` only; other statuses = soft failure for that platform |
| Item mapping | Map API items to `NormalizedNewsItem` (`title`, `url`/`mobileUrl`, rank if present, `external_id` if present) |
| contentHash | Existing `stable_content_hash` (prefer external id) |
| Retries | 2 retries, timeout ~10–15s, backoff; **per-platform soft fail** (log + continue other platforms) |
| Proxy | Optional `RESEARCH_HOTLIST_PROXY_URL` if already needed in env; no new infra |

Platform id list: `load_enabled_platforms()` from `config/config.yaml` `platforms.sources` when `platforms.enabled`.

### RSS

Keep `HttpRssPort` + `load_rss_feeds()` from `config/config.yaml` `rss.sources` when `rss.enabled`. Soft-fail per feed.

### Resolve + project

Unchanged rules from P1:

- Direct `companies:resolveAlias`
- Always `company_mention` when resolved; heuristics for hiring / sales / market
- Unresolved mentions skipped + `unresolvedMentions` on ingest run

### Ingest run observability

`research_ingest_runs` already stores counters. This cycle may expose **latest ingest run** to the BFF for empty-state / button feedback:

- Prefer new thin query `research_ops:latestIngestRun` (or list recent limit 1) if not already available
- BFF: `GET /api/research/ingest/latest` (authenticated) returning status, finishedAt, counters, error?

## Flags & operator paths

| Path | Behavior |
|------|----------|
| Scheduler | Job registered only if `RESEARCH_INGEST_ENABLED` truthy (already) |
| `POST /api/research/ingest/run` | Proxies worker; worker manual endpoint may force-enable for one shot (already) |
| CLI `trends research ingest --once` | Existing |
| UI button | Calls same BFF POST; workspace-auth only; show toast + poll/refetch signals |

Document in `.env.example`:

```bash
# Research Eng native ingest (Convex news + signals)
# RESEARCH_INGEST_ENABLED=1
# RESEARCH_HOTLIST_API_URL=https://newsnow.busiyi.world/api/s
# RESEARCH_HOTLIST_PROXY_URL=
# LEGACY_TRENDRADAR_CRAWL=1   # shadow only; dual-run / PR7 — not required for this vertical
```

Default remains **off** for schedule so local/prod do not surprise-crawl; once-run and UI button remain available for operators.

## Desk UX

### Company discovery

- **Research index** (recommended): `/:teamSlug/research` with search box calling `GET /api/research/companies/search?q=` and navigation to `.../research/:companyKey?persona=hr`
- Keep policies “Research (HR)” links
- Empty company key / 404-style missing company: clear copy + link back to search

### Company page enhancements

| Feature | Behavior |
|---------|----------|
| Persona toggle | Existing `?persona=hr\|sales` |
| Kind filters | Client-side multi-select chips: `hiring_signal`, `sales_trigger`, `market_move`, `company_mention`; optional `?kinds=a,b` query sync |
| Empty state | “No signals yet” + last ingest summary if any + “Run ingest” CTA |
| Error state | API failure message + retry |
| Ingest button | Operator-visible control; POST ingest; disable while in-flight; on success refetch signals |

### Resume / policy deep links

- **Policies:** already links to research; keep
- **CompanyPolicyBadges:** research link already present on banner; ensure badge variant has a research affordance where practical
- **ResumeDetail:** employer / policy hits already render `CompanyPolicyBadges` — ensure research href uses current workspace slug + `?persona=hr` default

No new CRM shell or required top-nav item (P1 lock preserved); research index may be reached via policies or direct URL.

## API surface (delta)

| Method | Path | Notes |
|--------|------|-------|
| Existing | `GET/POST` research news, signals, search, ingest/run, parity | Keep |
| Add | `GET /api/research/ingest/latest` | Latest ingest run for UI empty state / button |
| Optional | signals query `kinds` | Prefer client filter; server filter only if list sizes demand it (P1 lists are small) |

## Testing strategy

| Layer | What |
|-------|------|
| Worker ports | Unit tests with **recorded NewsNow-shaped JSON fixtures** and RSS XML fixtures; no live network in CI |
| Ingest job | Mock ports + recording Convex client; assert news upsert + signal project + finish run |
| API | Route tests for ingest/latest; existing research tests remain |
| Web | Panel: kind filter ordering; empty state + ingest button calls mock client; route mount for index if added |
| Manual / smoke | Live once-run against default NewsNow + one RSS feed in dev (not CI-gating) |

## Risks

| Risk | Mitigation |
|------|------------|
| NewsNow upstream flaky or rate-limited | Soft-fail per platform; retries; cache status accepted; document override URL |
| Few alias hits → empty widgets | Empty state + unresolved counter; seed canonical companies remains operator prerequisite |
| Ingest button abuse | Existing workspace auth; single-flight UI; worker max_instances already 1 for scheduled jobs |
| Scope creep into PR7 | Explicit non-goal; parity API stays read-only in UI unless already present |

## File map (expected)

| Path | Change |
|------|--------|
| `apps/worker/research_ports.py` | NewsNow hotlist parse + fixture-friendly helpers |
| `apps/worker/research_ingest.py` | Soft-fail aggregation; optional latest-run helpers |
| `apps/worker/tests/test_research_ports.py` | New fixture-driven tests |
| `packages/convex/convex/research_ops.ts` | `latestIngestRun` query if missing |
| `apps/api/src/services/research-service.ts` | latest ingest + any proxy tweaks |
| `apps/api/src/routes/research.ts` | `GET .../ingest/latest` |
| `apps/web/src/pages/ResearchCompanyPage.tsx` | filters, empty, ingest button |
| `apps/web/src/pages/ResearchIndexPage.tsx` | search/picker (new) |
| `apps/web/src/App.tsx` | route `research` index |
| `apps/web/src/components/research/*` | kind filter chips, ingest control |
| `apps/web/src/components/CompanyPolicyBadges.tsx` / ResumeDetail | deep link polish |
| `.env.example` | research flags |
| `docs/superpowers/plans/2026-07-22-...-plan.md` | implementation plan (after approval) |

## Implementation order (preview)

1. NewsNow hotlist port + fixture tests  
2. Soft-fail ingest + env docs  
3. latestIngestRun + BFF  
4. Web index search + company page filters/empty/ingest button  
5. Resume/policy deep link polish  
6. Manual live smoke; commit plan tasks as PRs or sequential commits  

## Open decisions (resolved in brainstorm)

| Topic | Decision |
|-------|----------|
| Program vs slice | Productional program; **first cycle** = thin vertical A (live ingest) + B (desk UX) |
| Success | Checklist: once-run live + scheduler flag/docs + search/empty UX |
| Sources | Hotlist **and** RSS |
| Hotlist impl | Thin NewsNow adapter (Approach 1) |
| Extra UX | Ingest button + kind filters + resume deep links |

## Approval

- §1 Goal & architecture: approved in brainstorm  
- §2 Data/UX/tests + extras: approved with “all three” UX extras  
- This written spec: **approved** 2026-07-22; implementation plan written
