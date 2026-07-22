# Research Persona=HR Real Data — Live-First Company Page + Density + On-Open Refresh

**Status:** Approved for implementation plan (brainstorm 2026-07-22)  
**Branch context:** local `main` (Research Eng P1–thin vertical, pulse keywords, platform select, showcase hub shipped)  
**Related:**  
- Handoff (historical docs-only; product has since shipped P1+): temp `research-eng-full-distill-implementation-handoff-2026-07-21.md`  
- `docs/superpowers/specs/2026-07-21-research-eng-full-distill-design.md`  
- `docs/superpowers/specs/2026-07-22-research-eng-productional-thin-vertical-design.md`  
- `docs/superpowers/specs/2026-07-22-research-hotlist-platform-select-design.md`  
- Wiki donor architecture (analysis only): `~/wiki/projects/trendradar/architecture/`  
- Shared ranking: `packages/shared/src/research/persona-ranking.ts`  
- Projector: `apps/worker/research_project.py`

## Problem

| Today | Gap |
|-------|-----|
| **`?persona=hr`** | Works as URL + toggle; **re-ranks shared Convex rows** correctly |
| **Company page data** | Golden keys (e.g. fanuc) often show **only showcase-seed** signals (`platform: showcase`, `showcase.local` evidence) |
| **Live hotlist** | Ingest stores real `news_items` with real URLs, but **few resolve → CNC `research_signals`** |
| **HR desk truth** | User opens `/hr/research/fanuc?persona=hr` expecting hiring-first **real** intel; gets labeled seed density |
| **TrendRadar wiki** | Donor is crawl→filter→notify; **not** dual-persona company research — distill already chose company-centric signals |

**Live proof (local, 2026-07-22):**  
`GET /api/research/companies/fanuc/signals?persona=hr` → 4 items, all showcase; `?persona=sales` reorders sales_trigger first. Ranking OK; **source quality** is the product gap.

## Goal

Ship a **phased thin vertical** so `/:team/research/:companyKey?persona=hr` is usable with **real fetch and/or real DB rows**, without reopening full TrendRadar merge or PR7 cutover.

### Phases (locked sequence A → B → C)

| Phase | Name | Outcome |
|-------|------|---------|
| **A** | Honesty + live-first presentation | Company page prefers non-showcase signals; seed clearly secondary; evidence links only for real `http(s)` |
| **B** | Live density | After ingest, golden CNC companies more often get **≥1 non-showcase** signal when hotlist titles hit aliases/keywords |
| **C** | On-open refresh (flagged) | Optional rate-limited refresh path when opening company research; then reload signals |

Success is a **checklist**, not a single demo click.

## Non-goals

- Bulk merge of `trendradar/` / permanent SQLite product path  
- PR7 hard cut (still parity-gated)  
- AI signal classifier (v1 stays **rule projector**; AI later)  
- Forking storage per persona (personas remain re-rank only)  
- Auto-write company policy from signals  
- Self-host NewsNow as a hard dependency  
- Full sales CRM / outreach sequences  
- Production deploy / origin push as part of design  

## Locked decisions

| Topic | Choice |
|-------|--------|
| Product scope | **All three thin layers**, sequenced **A → B → C** |
| Persona model | Unchanged: **hr \| sales**, shared `research_signals`, `rankSignalsForPersona` |
| Default query | Hub + cards keep `?persona=hr` |
| Showcase | Remain as **fallback density**, never claim as live market intel |
| Live row definition | `evidence.platform !== "showcase"` **and** not `ingestRunId` prefix `showcase-seed` (both checks for safety) |
| Evidence links | Real external `http(s)` only; never `*.local` / showcase host |
| Ingest writer | Worker still **direct Convex** (`CONVEX_URL` + write secret) |
| Platform set | Uses workspace hotlist platforms overlay when present (prior feature) |
| On-open (C) | **Opt-in env or workspace flag**, rate-limited; never blocks first paint forever |
| Golden companies (B) | At least: pack keys from showcase golden + industry bridge CNC brands used in desk demos (`fanuc`, `makino`, `mazak`, `pro-technic-machinery`, `polywell`, …) |

## Architecture

```text
                    ┌─────────────────────────────┐
  NewsNow / RSS  ──►│ ResearchIngestJob           │
  (platforms set)   │  news_items upsert          │
                    │  resolveAlias / industry    │
                    │  research_project → signals │
                    └─────────────┬───────────────┘
                                  ▼
                         Convex research_signals
                         (nested evidence; no persona fork)
                                  │
         GET /companies/:key/signals?persona=hr|sales
                                  │
                    rankSignalsForPersona (shared)
                                  │
         Phase A: live-first partition + honesty UI
         Phase C: optional POST refresh → re-GET
                                  ▼
              /:team/research/:key?persona=hr
```

| Piece | Role |
|-------|------|
| Shared store | One signal table; kinds from full-distill taxonomy |
| Persona | Sort only (`packages/shared`) |
| Phase A | Read-path + web presentation |
| Phase B | Worker projector / alias / seed keywords → more live rows |
| Phase C | Operator/desk refresh trigger with limits |

## Phase A — Honesty + live-first presentation

### API (optional but preferred)

Extend or document existing list response:

```json
{
  "success": true,
  "persona": "hr",
  "items": [ /* ranked */ ],
  "meta": {
    "liveCount": 2,
    "showcaseCount": 4,
    "liveFirst": true
  }
}
```

**Ordering for response `items`:**

1. Partition into `live` vs `showcase` (definition above).  
2. `rankSignalsForPersona(live, persona)` then `rankSignalsForPersona(showcase, persona)`.  
3. Concatenate **live first**, then showcase (or omit showcase when `?liveOnly=1` — optional query for later).

If no API change in A, web may partition client-side — but **server-side is preferred** so CLI/API stay consistent.

### Web company page

- Header: real `nameCn` (already resolving via industry).  
- Banner when `liveCount === 0 && showcaseCount > 0`:  
  **「当前仅有展示数据；运行抓取或等待热榜命中后显示实时信号」**  
- Section labels: **实时信号** / **展示数据** (if both present).  
- Evidence: real URL → 原文; showcase → 种子证据（非外链）.  
- Persona toggle keeps `?persona=` and re-fetches/re-ranks.  
- Empty live + empty showcase: existing ingest CTA.

### Tests

- Fixture mix of live + showcase → live kinds appear first under `persona=hr`.  
- `persona=sales` reorders live kinds without interleaving showcase above live.  
- No evidence link for `showcase.local`.

## Phase B — Live density (ingest → real signals)

### Problem detail

Live news rarely becomes CNC signals because:

1. Hotlist titles rarely contain registered aliases.  
2. Rule heuristics (`招聘|采购|…`) miss industry phrasing.  
3. Resolve is title/snippet only; no brand dictionary pass beyond alias table.

### Locked approach (thin, no AI)

1. **Alias coverage:** Ensure showcase golden + CNC bridge brands have aliases in Convex (seed/repair script or extend showcase seed companies — **not** a second registry).  
2. **Projector:**  
   - Keep kinds taxonomy.  
   - Add **brand surface match** using industry bridge / seed brand list when `resolveAlias` misses but normalized title contains brand surface (reuse `resolveResearchCompanySurface` / worker industry bridge if already on worker path).  
   - Slightly expand hiring/sales/market regex with CNC-safe terms already in pulse keywords seed (e.g. `扩产`, `加工中心` as weak `market_move` / context only when brand resolved).  
3. **Ingest platforms:** Prefer finance + general portals for denser industrial news (workspace 数据源 defaults already bias this).  
4. **Honesty:** Live projected rows must use **NewsNow/RSS url** in evidence, never showcase hosts.

### Acceptance (B)

| # | Criterion |
|---|-----------|
| B1 | After one successful ingest with network (or recorded fixture pipeline), **at least one** golden company has `liveCount ≥ 1` in test env **or** fixture-based integration proves projector emits live draft for a recorded hotlist title containing `发那科` / `宝力机械` |
| B2 | Unit tests: title `发那科招聘应用工程师` → `hiring_signal` + real url evidence when company resolves  
| B3 | Showcase seed still works; does not block live upserts |

Network-optional CI: **fixture projector tests** mandatory; live NewsNow optional smoke.

## Phase C — On-open refresh (flagged)

### Behavior

When user opens `/:team/research/:companyKey?persona=hr`:

1. Paint immediately with current DB signals (A presentation).  
2. If flag on and cooldown elapsed: fire **background** refresh:  
   - Prefer **lightweight** path: `POST /api/research/ingest/run` already workspace-scoped platforms (heavy) **or**  
   - Better thin path: `POST /api/research/companies/:companyKey/refresh` that triggers worker job with optional `focusCompanyKey` / limited platforms (if implementable without redesign).  
3. On success, re-GET signals; toast “已更新”.  
4. On fail, silent or soft banner; keep existing rows.

### Flags

- Env: `RESEARCH_COMPANY_ON_OPEN_REFRESH=1` (default off).  
- Optional workspace config later: `research.companyRefresh` — **not required in C1**.

### Rate limits

- Per workspace + companyKey: **≥ 5 minutes** between automatic on-open refreshes.  
- Manual **运行抓取** on company page always allowed (existing button).  
- Never await full multi-platform ingest before first paint.

### Acceptance (C)

| # | Criterion |
|---|-----------|
| C1 | Flag off → zero extra ingest calls on open |
| C2 | Flag on → at most one refresh per cooldown window |
| C3 | First paint does not wait on worker |

## Data honesty matrix

| Row type | persona ranking | UI section | Evidence link |
|----------|-----------------|------------|---------------|
| Live NewsNow/RSS projected | Yes | 实时信号 | Real URL |
| Showcase seed | Yes, after live | 展示数据 | None (label only) |
| Test fixture | N/A | N/A | `example.invalid` only in tests |

## Testing strategy

| Layer | Phase |
|-------|-------|
| Shared ranking unit tests (existing) | A regression |
| API list live-first order | A |
| Web company page sections | A |
| Projector unit + recorded titles | B |
| Ingest soft-fail unchanged | B |
| Refresh flag + cooldown | C |
| No live NewsNow required for default CI | All |

## Rollout

1. **A** only — immediate UX honesty for HR demos.  
2. **B** — density so A has something to show.  
3. **C** — reduce “stale until manual ingest” friction once B works.

## Success criteria (end of A+B+C)

| # | Criterion |
|---|-----------|
| 1 | `/hr/research/fanuc?persona=hr` shows hiring-first ranking among **live** rows when any live rows exist |
| 2 | Showcase never presented as sole truth without banner when live empty |
| 3 | Real evidence links only for real hosts |
| 4 | Fixture/integration proves projector can create live signals from brand+hiring titles |
| 5 | On-open refresh is off by default and rate-limited when on |
| 6 | No persona storage fork; no TrendRadar bulk merge |

## Relationship to handoff / wiki

| Source | Use |
|--------|-----|
| Full-distill handoff | Confirms nested evidence, direct Convex writes, persona widgets, PR7 gates — **honor** |
| Wiki `architecture/*` | Donor crawl/filter/notify topology — **ideas only**, not product runtime |
| Deep-research (market) | Dual persona on shared signals + explainable evidence — **aligns** with ranking model |
| Platform select feature | Feeds B/C by controlling which hotlists are ingested |

## Follow-ups (later)

- AI kind classification  
- Pulse filter by platform  
- `?liveOnly=1` for operators  
- Resume detail deep-link with persona + live badge  
- Metrics: liveCount per company over time  

## Sources Used

Local repository sources:

- `packages/shared/src/research/persona-ranking.ts`  
- `apps/worker/research_project.py`, `apps/worker/research_ingest.py`  
- `apps/web/src/pages/ResearchCompanyPage.tsx`, `CompanyResearchPanel.tsx`  
- `docs/superpowers/specs/2026-07-21-research-eng-full-distill-design.md`  
- Handoff: `research-eng-full-distill-implementation-handoff-2026-07-21.md`  

Wiki:

- `projects/trendradar/architecture/00-reimplementation-blueprint.md` (+ module index)  

External (freshness, product patterns only):

- B2B sales intelligence vs talent intelligence signal-ranking patterns (2025–2026 market writeups via grok-search)  
