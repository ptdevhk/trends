# Research Showcase Hub — Design

**Status:** Draft for user review (brainstorm 2026-07-22)  
**Branch context:** local `main` (Research Eng P1 + productional thin vertical + Header link-up shipped)  
**Related:**  
- `docs/superpowers/specs/2026-07-21-research-eng-full-distill-design.md`  
- `docs/superpowers/specs/2026-07-22-research-eng-productional-thin-vertical-design.md`  
- Office-hours: `~/wiki/projects/trends/requirements/2026-07-22-office-hours-research-hr-desk-showcase.md` (Slice A done; this is hub + curated density)

**Implementation plan:** `docs/superpowers/plans/2026-07-22-research-showcase-hub-plan.md`

## Problem (evidence from live local data)

| Observation | Implication |
|-------------|-------------|
| `/hr/research` is search-only | Weak showcase; no “start here” |
| Company registry has 2 keys | Nothing to browse |
| `pro-technic-machinery` has 4 multi-kind **seeded** signals; `polywell` has 0 | One demo company only |
| Live NewsNow ingest: news upserted, **signalsInserted=0**, **unresolvedMentions=30** | Entertainment hotlist rarely hits industrial aliases |
| Resume sample employers (GlobalFoundries, Siemens, Nestlé, …) not in registry | HR desk companies and research desk are disconnected |

Link-up (Header → Research, policy badges) is not enough without **product-shaped density** and a **hub layout**.

## Goal

Make `/:teamSlug/research` a **Research Showcase Hub** for HR:

1. Browse golden + showcase employers with multi-kind signal counts  
2. See a market pulse of recent news  
3. Keep search + operator ingest  
4. Load density via **idempotent operator showcase seed** (labeled in UI)

## Non-goals

- Auto-write company policy / CRM / outreach  
- Second company registry (still K3 `companyKey` + aliases)  
- Requiring 抖音/weibo entertainment titles to resolve to CNC firms  
- PR7 hard cut / dual-run green campaign  
- Full AI analyze / notify  
- Embedding full research panel on every resume card (optional later)

## Locked decisions

| Topic | Choice |
|-------|--------|
| Primary user | HR on resume desk (showcase path from resumes + Header) |
| Density source v1 | **Operator showcase seed** (idempotent) |
| Live ingest | Remains available; soft-fail; not the sole source of hub density |
| UI honesty | Label curated rows **“Showcase data”** vs live pulse |
| Personas | Default `hr` from hub cards; company page keeps persona toggle |
| Showcase employers | Golden: pro-technic-machinery, polywell; plus 3–5 resume-derived names with aliases |

## Architecture

```text
Operator seed (CLI / API POST /api/research/showcase/seed)
  → ensure companies + aliases (K3)
  → upsert news_items (contentHash-stable)
  → upsert research_signals (nested evidence, multi-kind per company)
        │
Convex product tables (existing)
        │
BFF
  GET /api/research/showcase          → hub payload (companies + counts + pulse)
  GET /api/research/news              → market pulse (existing)
  GET /api/research/companies/...     → existing
  POST /api/research/showcase/seed    → operator-only seed
        │
Web ResearchIndexPage (hub)
  Start here | From resume desk | Market pulse | Search | Run ingest
```

No new microservice. Seed is a **BFF service** calling Convex write-secret mutations (same pattern as company seed), optional thin worker CLI later.

## Data model

Reuse existing tables. Seed rows should be identifiable:

**Option A (preferred, no schema change):** stable `contentHash` / `ingestRunId` prefix  
- `ingestRunId`: `showcase-seed-v1`  
- news `contentHash`: `showcase:v1:{companyKey}:{kind}:{n}`  
- signal titles fixed strings so upserts are idempotent  

**Option B (if needed later):** optional `source: "showcase" | "live"` on signals — **out of v1** unless hub filtering requires it.

### Showcase company pack (v1 fixed list)

| companyKey | displayName | aliases (min) | signal kinds (min) |
|------------|-------------|---------------|--------------------|
| pro-technic-machinery | 宝力机械 / Pro-Technic | 宝力机械, Pro-Technic | all 4 kinds |
| polywell | 宝惠 / Polywell | 宝惠, Polywell | all 4 kinds |
| globalfoundries | GlobalFoundries | GlobalFoundries, 格芯 | hiring + market + mention |
| siemens-malaysia | Siemens Malaysia | Siemens Malaysia, Siemens | hiring + sales + mention |
| nestle-malaysia | Nestlé Malaysia | Nestlé Malaysia, Nestle | market + sales + mention |
| hino-motors-malaysia | Hino Motors Malaysia | Hino Motors Malaysia, Hino | hiring + mention |

List is **config-driven** in `config/research_showcase.yaml` so operators can extend without code.

### Seed signal content

For each company, create 1 news item + 1–4 signals with nested evidence:

```ts
evidence: {
  title: string,
  platform: "showcase",
  seenAt: number,
  url?: string,
  snippet?: string,
}
```

Kinds: `company_mention` | `hiring_signal` | `market_move` | `sales_trigger`  
Copy: short bilingual-friendly titles (EN/CN mix OK) describing industrial hiring/expansion — **not** celebrity 抖音 titles.

## API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/research/showcase` | workspace user | Hub DTO: `{ golden, fromResumeDesk, pulse, meta }` |
| POST | `/api/research/showcase/seed` | workspace user (operator) | Idempotent seed; returns counts created/updated |
| existing | news, signals, search, ingest | unchanged | |

### Showcase DTO (sketch)

```ts
type ShowcaseCompanyCard = {
  companyKey: string
  displayName: string
  nameCn?: string
  nameEn?: string
  kindCounts: Record<string, number>
  signalCount: number
  showcase: boolean  // true if any signal has ingestRunId showcase-seed-v1
  href: string       // /:team/research/:key?persona=hr
}

type ShowcaseResponse = {
  success: true
  golden: ShowcaseCompanyCard[]
  fromResumeDesk: ShowcaseCompanyCard[]
  pulse: Array<{ title: string; platform: string; url?: string; capturedAt: number }>
  meta: {
    lastIngest: unknown | null
    showcaseSeedVersion: "v1"
  }
}
```

`fromResumeDesk` keys come from config pack (resume-derived list), not a live scan of all resumes in v1 (avoids heavy BFF work). Config may note “aligned with sample resume employers.”

## Web UX — ResearchIndexPage

Replace bare search with sections:

1. **Header** — title “Research”, short subtitle for HR  
2. **Start here** — golden cards (signal count chips by kind)  
3. **From your resume desk** — showcase employer cards  
4. **Market pulse** — last N news from `listResearchNews` (or showcase pulse if empty)  
5. **Search** — existing search control  
6. **Operator bar** — Run ingest · Seed showcase · last ingest summary  

Empty states: if seed not run, primary CTA **“Load showcase data”** calling seed endpoint.

Company page: unchanged core; optional badge “Showcase data” when `ingestRunId` starts with `showcase-seed`.

## CLI (optional thin)

```text
trends research showcase seed
trends research showcase status
```

May defer CLI to plan Task N if API + UI seed is enough for v1.

## Testing

| Layer | Coverage |
|-------|----------|
| Seed pure pack | Fixture YAML parse + idempotent contentHash list |
| Convex | Existing upsert dedupe; optional seed integration via mutations in unit tests with write secret |
| API | `GET /showcase` shape; `POST /seed` returns counters (mock Convex) |
| Web | Hub renders golden cards from fixture props; seed button calls client; structural route remains |

No live NewsNow required for green CI.

## Risks

| Risk | Mitigation |
|------|------------|
| Users confuse showcase with live intel | UI label + platform `showcase` + ingestRunId prefix |
| Seed grows unbounded | Fixed config pack v1; versioned run id |
| Resume employers drift from samples | Config list documented; not auto-scraped every request |
| Live ingest still sparse | Expected; pulse section shows raw news honesty |

## Success criteria

1. Open `/hr/research` without typing: see ≥2 golden + ≥3 showcase employer cards with **multi-kind** counts after one seed.  
2. Click card → company page with signals (persona hr).  
3. Market pulse shows recent titles (live or seeded).  
4. Search still works.  
5. Showcase clearly labeled; no policy auto-write.

## Implementation order (preview)

1. `config/research_showcase.yaml` + load helper  
2. Seed service (companies + news + signals)  
3. API showcase GET + seed POST + tests  
4. Hub UI redesign + tests  
5. Optional CLI  
6. Manual smoke: seed → hub → company page  

## Approval

- Brainstorm approach: Showcase hub + curated density  
- Density source: operator showcase seed  
- §1 design: locked 2026-07-22  
- Written spec: **pending user review** before implementation
