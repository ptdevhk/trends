# Research Showcase Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/:teamSlug/research` into an HR showcase hub with golden + resume-desk company cards, multi-kind signal density via idempotent operator seed, market pulse, and clear “Showcase data” labeling.

**Architecture:** Config pack → BFF seed service writes K3 companies/aliases + news_items + research_signals (ingestRunId `showcase-seed-v1`) via Convex write-secret; GET `/api/research/showcase` aggregates hub DTO; ResearchIndexPage renders sections. Live ingest remains separate soft-fail path.

**Tech Stack:** TypeScript BFF (`apps/api`), Convex mutations (existing), React web (`apps/web`), YAML config, vitest.

**Design spec:** `docs/superpowers/specs/2026-07-22-research-showcase-hub-design.md`

## Global Constraints

- Reuse K3 `companies` / `company_aliases` / `resolveAlias`; never invent a parallel registry.
- Nested `evidence` on signals; kinds: `company_mention` | `hiring_signal` | `market_move` | `sales_trigger`.
- Seed **idempotent** via stable contentHash / fixed titles / `ingestRunId: showcase-seed-v1`.
- UI must label showcase density; do not present curated rows as live market intel.
- No NewsAnalyzer; no auto policy write; no CRM; no PR7.
- Prefer fixture tests without live NewsNow.

---

## File map

| Path | Role |
|------|------|
| `config/research_showcase.yaml` | Golden + resume-desk companies, aliases, signal templates |
| `packages/shared/src/research/showcase-pack.ts` | Load/parse pack types (or keep in API if simpler) |
| `apps/api/src/services/research-showcase-service.ts` | seed + getShowcase |
| `apps/api/src/routes/research.ts` | GET showcase, POST seed |
| `apps/api/src/routes/research.test.ts` | Route tests |
| `apps/web/src/pages/ResearchIndexPage.tsx` | Hub UI |
| `apps/web/src/pages/ResearchIndexPage.test.tsx` | Hub tests |
| `apps/web/src/components/research/ShowcaseCompanyCard.tsx` | Optional card component |
| `.env.example` | Note showcase seed is operator UI/API (no new env required) |

---

### Task 1: Showcase config pack + parser

**Files:**
- Create: `config/research_showcase.yaml`
- Create: `apps/api/src/services/research-showcase-pack.ts`
- Create: `apps/api/src/services/research-showcase-pack.test.ts`

**Interfaces:**
- Produces: `loadResearchShowcasePack(root?: string): ShowcasePack`
- Pack fields: `version`, `golden[]`, `fromResumeDesk[]`, each with `companyKey`, `displayName`, `nameCn?`, `nameEn?`, `aliases[]`, `signals: { kind, title, snippet? }[]`

- [x] **Step 1: Write YAML pack** with pro-technic, polywell + at least siemens-malaysia, globalfoundries, nestle-malaysia, hino-motors-malaysia (aliases + ≥2 kinds each; golden ≥3 kinds).

- [x] **Step 2: Failing test** — load pack, assert golden includes `pro-technic-machinery`, kinds valid.

- [x] **Step 3: Implement loader** (read file + yaml parse + validate kinds).

- [x] **Step 4: Pass + commit**

```bash
bunx vitest run apps/api/src/services/research-showcase-pack.test.ts
git add config/research_showcase.yaml apps/api/src/services/research-showcase-pack.ts apps/api/src/services/research-showcase-pack.test.ts
git commit -m "feat(research): add showcase company pack config"
```

---

### Task 2: Showcase seed service (Convex writes)

**Files:**
- Create: `apps/api/src/services/research-showcase-service.ts`
- Create: `apps/api/src/services/research-showcase-service.test.ts`

**Interfaces:**
- `seedResearchShowcase(): Promise<{ companies, news, signals }>`  
- For each company: `companies:upsert` + aliases; for each signal template: `research_news:upsertItem` + `research_signals:upsert` with nested evidence, `ingestRunId: "showcase-seed-v1"`, `contentHash: showcase:v1:{companyKey}:{kind}`  
- `getResearchShowcase(teamSlug: string): Promise<ShowcaseResponse>` — list pack companies via signals listByCompany counts + recent news for pulse

- [x] **Step 1: Unit test seed with mocked `callConvexMutation` / `callConvexQuery`** — assert mutation paths and stable contentHash args.

- [x] **Step 2: Implement seed + getShowcase** using existing `callConvexMutation` / `callConvexQuery` + `config.auth.convexWriteSecret`.

- [x] **Step 3: Pass + commit**

```bash
bunx vitest run apps/api/src/services/research-showcase-service.test.ts
git commit -m "feat(research): showcase seed and hub aggregation service"
```

---

### Task 3: API routes

**Files:**
- Modify: `apps/api/src/routes/research.ts`
- Modify: `apps/api/src/routes/research.test.ts`

**Interfaces:**
- `GET /api/research/showcase` → `{ success, golden, fromResumeDesk, pulse, meta }`
- `POST /api/research/showcase/seed` → `{ success, ...counts }`

- [x] **Step 1: Route tests** with mocked service or fetch to Convex.

- [x] **Step 2: Wire OpenAPI routes** (workspace auth same as other research routes).

- [x] **Step 3: Pass + commit**

```bash
bunx vitest run apps/api/src/routes/research.test.ts
git commit -m "feat(research): API for showcase hub and seed"
```

---

### Task 4: Hub UI

**Files:**
- Modify: `apps/web/src/pages/ResearchIndexPage.tsx`
- Modify: `apps/web/src/pages/ResearchIndexPage.test.tsx`
- Optional: `apps/web/src/components/research/ShowcaseCompanyCard.tsx`

**Interfaces:**
- On mount: `GET /api/research/showcase`
- Cards link to `/${teamSlug}/research/${companyKey}?persona=hr`
- Buttons: Seed showcase (`POST .../seed`), Run ingest (existing)
- Badge text: “Showcase data” when `showcase: true`
- Keep search section

- [x] **Step 1: Component tests** with mocked `rawApiClient` — renders golden section when fixture payload present; seed button triggers POST.

- [x] **Step 2: Implement hub layout.**

- [x] **Step 3: Pass + commit**

```bash
npm --workspace @trends/web run test -- src/pages/ResearchIndexPage
git commit -m "feat(research): showcase hub UI with company cards and seed CTA"
```

---

### Task 5: Manual smoke + checklist

- [x] **Step 1:** Dev stack up; login hr-demo; open `/hr/research`.

- [x] **Step 2:** Click Load/Seed showcase; verify cards for pro-technic + polywell + ≥3 resume-desk companies.

- [x] **Step 3:** Open pro-technic page; confirm multi-kind signals.

- [x] **Step 4:** Capture notes under scratch if in harness; no origin push.

### Skeptic follow-ups (post Task 5)

- [x] Honest hub `showcase` labels (ingestRunId `showcase-seed*` only; never live density).
- [x] Soft-dedupe company+kind+ingestRunId; hub kindCounts only count showcase-seed rows.
- [x] Repair historical multi-row kinds only when needed (no always-delete-before-seed).
- [x] Seed returns `signalsCreated` / `newsCreated`; pure re-seed asserts both `0`.
- [x] Live smoke: seed×2 → seed2.signalsCreated=0; pro-technic kindCounts all 1.

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Config pack | 1 |
| Idempotent seed | 2 |
| Hub DTO API | 3 |
| Hub sections UI | 4 |
| Showcase labeling | 4 |
| Market pulse | 2–4 |
| Non-goals preserved | Global |

## Execution handoff

After plan approval:

1. **Subagent-Driven** (recommended)  
2. **Inline** this session  

Which approach?
