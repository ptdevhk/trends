# Research Crawler Distill + Industry-Data + Resume Loop — Design

**Status:** Approved for implementation plan (brainstorm 2026-07-22)  
**Branch context:** local `main` (Research Eng thin vertical, platform select, persona live-first shipped)  
**Related:**  
- Donor crawler analysis: `~/wiki/projects/trendradar/architecture/04-module-crawler.md`  
- Topology (donor): `~/wiki/projects/trendradar/architecture/01-topology.md`  
- Full distill (locked product path): `docs/superpowers/specs/2026-07-21-research-eng-full-distill-design.md`  
- Productional thin vertical: `docs/superpowers/specs/2026-07-22-research-eng-productional-thin-vertical-design.md`  
- Platform select: `docs/superpowers/specs/2026-07-22-research-hotlist-platform-select-design.md`  
- Persona real-data A→B→C: `docs/superpowers/specs/2026-07-22-research-persona-hr-real-data-design.md`  
- Industry pack: `config/industry-data/`  
- Worker ports: `apps/worker/research_ports.py`, `research_ingest.py`, `research_industry_bridge.py`

## Problem

| Surface | Today | Gap |
|---------|-------|-----|
| **Crawl** | Thin NewsNow + RSS ports exist; timer/ingest → Convex is the product path | Domain safety / failed-platform ops incomplete; synthetic **demo-seed** rows still look “live” |
| **DB** | Convex `news_items` + `research_signals` | Product must treat **real ingest only** as live intel |
| **UI** | Company research **reads DB only** (correct) | Users still see demo URLs (`example.com`, `rss:demo`) as 原文 when those rows are stored |
| **industry-data** | `brands.json` + keywords power resume scoring + research bridge | Weak feedback loop from crawl misses → pack growth |
| **Resume desk** | Employer/policy/companyKey exist | Weak **read** link from resume → research signals for the same company |

TrendRadar `04-module-crawler` is a **design donor** (hotlist + RSS adapters, soft-fail, domain safety). Full distill already forbids permanent SQLite corpus and bulk merge of `trendradar/crawler/`.

## Goal

Ship a **full thin loop** (phased **A → B → C**):

1. **A — Real crawl → Convex:** Harden worker fetch/write; never present demo/synthetic rows as live product intel.  
2. **B — Industry-data + resolve spine + steward queue:** Better company resolve; capture unresolved titles for pack/alias improvement.  
3. **C — Resume desk reads research:** Deep-link / thin signal strip by shared `companyKey` (DB read only).

North-star data flow:

```text
Timer / 运行抓取 / workspace platforms
        │
  apps/worker ResearchIngestJob
    NewsNowHotlistPort + RssPort   ← ideas from 04-module-crawler
    normalize → news_items (Convex)
    resolve (industry-data + K3 aliases)
    project → research_signals (nested evidence)
        │
        ▼
  Convex (sole product research store)
        │
   ┌────┴────┐
   ▼         ▼
 Research UI   Resume / policy UI
 (DB read)     (DB read by companyKey)
   │
   └── unresolved samples → steward queue → industry-data / aliases (human)
```

## Non-goals

- Bulk merge of `trendradar/crawler` or `NewsAnalyzer` as product orchestrator  
- SQLite date DBs as research source of truth  
- Auto-write resume scores, HR status, or company policy from news  
- Full TrendRadar AI filter / HTML report / multi-channel notify parity  
- Second company registry (K3 `companyKey` remains identity)  
- Production deploy / origin push as part of design approval  

## Locked decisions

| Topic | Choice |
|-------|--------|
| Scope | **Full loop A+B+C thin**, delivery **phased A → B → C** |
| Crawl owner | `apps/worker` only; steal **patterns** from donor crawler, not monorepo layout |
| Product DB | Convex `news_items` + `research_signals` only |
| UI contract | Always **read DB**; never scrape platforms on page open |
| Company identity | K3 `companies` / `company_aliases` + `config/industry-data` surfaces |
| Live / product intel | Exclude showcase **and** demo/synthetic (see Live definition) |
| Resume | **Read** research; research **does not** mutate resume analysis |
| Stewardship | Unresolved queue is **human-in-loop**; no auto-merge of noisy aliases |
| Platform set | Workspace hotlist overlay + YAML fallback (existing) |

## Live / synthetic definition (product honesty)

A signal is **product-live** only if **all** hold:

1. `evidence.platform` is not `showcase` and not `rss:demo`  
2. `ingestRunId` does not start with `showcase-seed` and is not `demo-seed` / does not start with `demo-`  
3. If `evidence.url` is present: host is not `example.com`, not `*.local`, not empty junk  

Otherwise: **non-live** (hide from “实时信号”, or show only under explicit demo/debug if ever needed — default product UI: **do not show as live 原文**).

Showcase curated seed (`showcase-seed-v1`) may remain as **labeled 展示数据** for empty density (existing product). **Demo-seed synthetic live** is **not** a supported product surface — prefer purge + real ingest.

## Phase A — Real crawl → Convex (harden + honesty)

### Goal

Timer/ingest path produces and surfaces **real** source workflows; UI remains pure DB reader.

### Work

| Item | Detail |
|------|--------|
| **A1 Live filter** | Extend shared `isLiveResearchSignal` (or successor) with demo/synthetic rules above; API partition + web sections use it |
| **A2 Optional purge** | Ops path to delete signals with `ingestRunId` prefix `demo-` / exact `demo-seed` (reuse Convex delete-by-prefix pattern) |
| **A3 Fetch harden** | Soft-fail + log failed platforms (already); optional `expectedDomain` soft-check on hotlist URLs when seed lists domain |
| **A4 Ports** | Stay on NewsNow-compatible `GET {api}?id={platform}&latest` + RSS; no donor import |
| **A5 Ingest** | Workspace effective platforms drive run (existing); document timer = `RESEARCH_INGEST_ENABLED` + scheduler |

### Acceptance (A)

| # | Criterion |
|---|-----------|
| A1 | Company page live section never shows `demo-seed` / `example.com` / `rss:demo` as live |
| A2 | Real NewsNow/RSS rows with real hosts still rank live-first under `?persona=hr` |
| A3 | Unit tests cover live definition; no live NewsNow required for CI |
| A4 | UI still only GETs signals from API/DB |

## Phase B — Industry-data + resolve spine + steward queue

### Goal

More crawl titles resolve to CNC `companyKey`; misses feed pack improvement.

### Work

| Item | Detail |
|------|--------|
| **B1 Resolve** | Keep industry bridge → K3 fallback as single worker resolve path; document as spine for research + hub search |
| **B2 Pack** | `config/industry-data/brands.json` (+ keywords) remains brand surface source; expand aliases for golden CNC brands as PRs |
| **B3 Unresolved queue** | On ingest, record samples when title has candidate surfaces but no resolve (cap per run); reuse existing industry unresolved store (`output/industry-data/unresolved-queue.json` via `industry-unresolved-store` / queue pure helpers), extended with research-source tags if needed — not a second queue product |
| **B4 Steward** | Human reviews queue → industry-data PR and/or `companies:addAlias`; never auto-write policy |

### Acceptance (B)

| # | Criterion |
|---|-----------|
| B1 | Fixture: title with 发那科 / 宝力机械 → projected signal with real platform + url when provided |
| B2 | Unresolved path records at least one sample in tests when resolve fails |
| B3 | Resume scoring still loads industry-data without regression in existing goldens |

## Phase C — Resume desk reads research

### Goal

Same `companyKey` connects talent desk to market signals (read-only).

### Work

| Item | Detail |
|------|--------|
| **C1 Deep-link** | Employer / company policy badges → `/{team}/research/{companyKey}?persona=hr` (harden consistency) |
| **C2 Optional strip** | Thin “research pulse” on resume/company context: liveCount + last signal title from `listCompanySignals` (DB read) |
| **C3 No reverse write** | Explicit: no mutation of resume analysis from research ingest |

### Acceptance (C)

| # | Criterion |
|---|-----------|
| C1 | From a known employer with `companyKey`, one click opens research with persona=hr |
| C2 | Strip (if shipped) fails soft when research empty; no crawl on resume page load |
| C3 | No resume write APIs called from research code paths |

## Architecture (layers)

| Layer | Responsibility |
|-------|----------------|
| **Sources** | NewsNow-compatible hotlist + RSS (config + workspace overlay) |
| **Worker** | Fetch → normalize → upsert news → resolve → project signals; soft-fail |
| **Convex** | Durable news + signals; K3 companies/aliases |
| **industry-data** | Static brand/keyword pack; steward-updated |
| **API** | `/api/research/*` read + ingest trigger; honesty meta |
| **Web research** | Hub + company page; DB read; persona re-rank |
| **Web resume** | Deep-link + optional strip; DB read only |
| **Steward queue** | Unresolved samples for humans |

## Relationship to donor crawler (`04-module-crawler`)

| Steal | Abandon |
|-------|---------|
| Hotlist HTTP adapter shape | SQLite date partitions as product store |
| RSS fetch/parse ideas | `NewsAnalyzer` god orchestration |
| Soft-fail per source | Full notify/report/MCP product path |
| Domain safety idea | Bulk package sync of `trendradar/crawler` |
| Config-driven platform list | Dual-brain long-term |

## Testing strategy

| Phase | CI (no live network) | Optional smoke |
|-------|----------------------|----------------|
| A | Live-definition unit tests; API partition tests | Company page after purge |
| B | Projector + bridge fixtures; queue unit | Ingest once with proxy |
| C | Route/link tests; strip mock | Resume → research click |

## Rollout

1. Land **A** (honesty + optional purge) — immediate UX truth.  
2. Land **B** (resolve + queue) — density of real company signals.  
3. Land **C** (resume read path) — desk loop closed.

## Success criteria (end of A+B+C)

| # | Criterion |
|---|-----------|
| 1 | Product-live signals only from real ingest evidence rules |
| 2 | Timer/ingest remains sole writer of research news/signals for product |
| 3 | UI always reads DB; 原文 is stored `evidence.url` |
| 4 | industry-data improves via steward queue, not silent auto-alias spam |
| 5 | Resume can open research for same `companyKey` without second registry |
| 6 | No bulk TrendRadar crawler merge; no SQLite product path |

## Follow-ups (later)

- AI kind classification  
- Full domain hard-drop on mismatch  
- MCP over research APIs  
- Metrics dashboard for unresolved rate  

## Sources Used

Local repository sources:

- `docs/superpowers/specs/2026-07-21-research-eng-full-distill-design.md`  
- `apps/worker/research_ports.py`, `research_ingest.py`, `research_industry_bridge.py`  
- `config/industry-data/`  
- `packages/shared/src/research/live-signal.ts`  
- Prior research specs (platform select, persona real-data)  

Wiki:

- `projects/trendradar/architecture/04-module-crawler.md`  
- `projects/trendradar/architecture/01-topology.md`  
