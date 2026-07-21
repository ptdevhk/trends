# Research Eng Full Distill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Trends-native Research Eng (Convex news items + company signals, worker ingest, API, CLI, HR/Sales desk widgets) and hard-cut legacy TrendRadar SQLite/MCP product path after 3 consecutive parity greens.

**Architecture:** Full distill — no permanent SQLite corpus. Worker `ResearchIngestJob` fetches hotlist/RSS via thin ports, writes Convex `news_items` + `research_signals` linked to existing K3 `companyKey`. BFF `/api/research/*` and `trends research` CLI serve dual personas; web widgets re-rank the same signals. Legacy crawl may shadow only during dual-run.

**Tech Stack:** Convex (`packages/convex`), Python worker (`apps/worker`), Hono/OpenAPI API (`apps/api`), Go CLI (`packages/cli`), React web (`apps/web`), vitest / convex-test / pytest as applicable.

**Design spec:** `docs/superpowers/specs/2026-07-21-research-eng-full-distill-design.md`  
**Vault work item:** `projects/trendradar/work/2026-07-21-research-eng-full-distill/`  
**Donor (no bulk merge):** `karlorz/TrendRadar-dev@v6.10.0-7-gfddcb0fa` + wiki architecture extracts

## Global Constraints

- **Full distill:** product path must not depend on date-partitioned SQLite news DBs after hard cut.
- **No bulk v6 merge** of `trendradar/` / `mcp_server/` into Trends; port thin adapters only.
- **Company identity:** reuse `companies` / `company_aliases` / `resolveAlias`; never invent a parallel registry; never umbrella `BaoLi`.
- **Personas do not fork storage:** `hr` | `sales` only re-rank/filter/copy shared `research_signals`.
- **Signal kinds P1:** `company_mention` | `hiring_signal` | `market_move` | `sales_trigger`.
- **Parity kill switch:** event-based — **3 consecutive** green `trends research parity` runs, then hard cut.
- **P1 non-goals:** no full AI/notify parity, no industry/role/person graphs, no CRM, no upstream TrendRadar contribution, MCP deferred to P2.
- **Auth writes:** Convex mutations use existing `CONVEX_WRITE_SECRET` write-secret pattern (see `packages/convex/convex/companies.ts`).
- Prefer small focused modules over a new `NewsAnalyzer` god-class.

---

## File map (expected)

| Path | Role |
|------|------|
| `packages/convex/convex/schema.ts` | Add `news_items`, `research_signals` (+ optional `news_sources`) |
| `packages/convex/convex/research_news.ts` | Mutations/queries for news items |
| `packages/convex/convex/research_signals.ts` | Mutations/queries for signals + persona ranking helper input |
| `packages/convex/__tests__/research-*.test.ts` | convex-test coverage |
| `apps/worker/research_ingest.py` (or `apps/worker/research/`) | Ingest job orchestration |
| `apps/worker/research_ports.py` | HotlistPort / RssPort interfaces + implementations |
| `apps/worker/research_resolve.py` | Company resolve via API/Convex |
| `apps/worker/research_signals.py` | Mention extract + kind classify (rules first) |
| `apps/worker/tasks.py` | Register `run_research_ingest`; dual-run flag for legacy crawl |
| `apps/worker/scheduler.py` | Schedule research ingest |
| `apps/api/src/routes/research.ts` | `/api/research/*` |
| `apps/api/src/services/research-service.ts` | BFF → Convex |
| `packages/cli/cmd/research.go` | `trends research` subcommands |
| `packages/cli/cmd/root.go` | Register research command |
| `packages/cli/internal/client/research.go` | HTTP client methods |
| `apps/web/src/components/research/*` | Shared signal list + persona toggle |
| `apps/web/src/pages` / desk shells | HR + Sales widget mount points |
| `scripts/research/parity.ts` or CLI-only parity | Dual-run comparison |
| `trendradar/`, `mcp_server/`, SQLite DataService news paths | **PR7 delete targets** only after parity |

---

### Task PR1: Convex schema + research tables

**Files:**
- Modify: `packages/convex/convex/schema.ts`
- Create: `packages/convex/convex/research_news.ts`
- Create: `packages/convex/convex/research_signals.ts`
- Create: `packages/convex/__tests__/research-news-convex-test.test.ts`
- Create: `packages/convex/__tests__/research-signals-convex-test.test.ts`

**Interfaces:**
- Consumes: `requireWriteSecret` / `requireReadSecret` pattern from `companies.ts`
- Produces:
  - `api.research_news.upsertItem` / `listRecent`
  - `api.research_signals.upsert` / `listByCompany`
  - Tables: `news_items`, `research_signals` as in design spec

- [ ] **Step 1: Write failing convex-test for upsert + list**

```ts
// packages/convex/__tests__/research-news-convex-test.test.ts
it("upserts news item and lists by capturedAt", async () => {
  const t = convexTest(schema, modules);
  await t.mutation(api.research_news.upsertItem, {
    writeSecret: WRITE_SECRET,
    sourceId: "weibo",
    platform: "weibo",
    title: "宝力机械获订单",
    contentHash: "h1",
    capturedAt: Date.now(),
  });
  const rows = await t.query(api.research_news.listRecent, {
    writeSecret: WRITE_SECRET,
    limit: 10,
  });
  expect(rows.some((r) => r.contentHash === "h1")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/convex && bunx vitest run __tests__/research-news-convex-test.test.ts`  
Expected: FAIL — module/table missing

- [ ] **Step 3: Add schema tables + minimal mutations/queries**

Add to `schema.ts` (field set must match design spec):

```ts
news_items: defineTable({
  sourceId: v.string(),
  platform: v.string(),
  externalId: v.optional(v.string()),
  title: v.string(),
  url: v.optional(v.string()),
  rank: v.optional(v.number()),
  publishedAt: v.optional(v.number()),
  capturedAt: v.number(),
  rawSnippet: v.optional(v.string()),
  contentHash: v.string(),
})
  .index("by_captured_at", ["capturedAt"])
  .index("by_content_hash", ["contentHash"])
  .index("by_platform_captured", ["platform", "capturedAt"]),

research_signals: defineTable({
  companyKey: v.string(),
  kind: v.union(
    v.literal("company_mention"),
    v.literal("hiring_signal"),
    v.literal("market_move"),
    v.literal("sales_trigger"),
  ),
  title: v.string(),
  summary: v.optional(v.string()),
  evidenceTitle: v.string(),
  evidenceUrl: v.optional(v.string()),
  evidencePlatform: v.string(),
  evidenceSeenAt: v.number(),
  evidenceSnippet: v.optional(v.string()),
  newsItemId: v.optional(v.id("news_items")),
  score: v.optional(v.number()),
  capturedAt: v.number(),
  ingestRunId: v.optional(v.string()),
})
  .index("by_company_captured", ["companyKey", "capturedAt"])
  .index("by_kind_captured", ["kind", "capturedAt"]),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/convex && bunx vitest run __tests__/research-news-convex-test.test.ts __tests__/research-signals-convex-test.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/convex/convex/schema.ts packages/convex/convex/research_*.ts packages/convex/__tests__/research-*.test.ts
git commit -m "feat(research): add Convex news_items and research_signals schema"
```

---

### Task PR2: Worker research ingest (fetch + write news)

**Files:**
- Create: `apps/worker/research_ports.py`
- Create: `apps/worker/research_ingest.py`
- Modify: `apps/worker/tasks.py`
- Modify: `apps/worker/scheduler.py`
- Create: `apps/worker/tests/test_research_ingest.py`

**Interfaces:**
- Consumes: platform list from `config/config.yaml` (or env subset); Convex write via HTTP to BFF or Convex client already used by worker
- Produces: `run_research_ingest(config_overrides=None) -> bool` scheduled job; writes `news_items` only in this PR (signals in PR3)

- [ ] **Step 1: Write failing unit test for normalize + contentHash**

```python
def test_content_hash_stable_for_same_title_platform():
    from apps.worker.research_ingest import content_hash_for
    a = content_hash_for(platform="weibo", title="示例标题", url=None)
    b = content_hash_for(platform="weibo", title="示例标题", url=None)
    assert a == b
    assert a != content_hash_for(platform="zhihu", title="示例标题", url=None)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/worker && uv run pytest tests/test_research_ingest.py -q`  
Expected: FAIL — module missing

- [ ] **Step 3: Implement HotlistPort/RssPort stubs + ingest that upserts news**

- Port **ideas** from donor `DataFetcher` / RSS fetcher (safety, timeouts); do **not** call `NewsAnalyzer.run()`.
- Prefer writing through existing API/worker Convex bridge patterns already in the monorepo; if none for research yet, add a thin authenticated write helper used only by ingest.
- Env flag `RESEARCH_INGEST_ENABLED=1` to gate schedule.

- [ ] **Step 4: Wire scheduler job (interval can match crawl, e.g. 30m)**

- [ ] **Step 5: Run worker tests**

Run: `cd apps/worker && uv run pytest tests/test_research_ingest.py -q`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/worker/research_*.py apps/worker/tasks.py apps/worker/scheduler.py apps/worker/tests/test_research_ingest.py
git commit -m "feat(research): worker ResearchIngestJob writes native news items"
```

---

### Task PR3: Company resolve + signal projector

**Files:**
- Create: `apps/worker/research_resolve.py`
- Create: `apps/worker/research_project.py`
- Modify: `apps/worker/research_ingest.py` (call projector after news upsert)
- Create: `apps/worker/tests/test_research_project.py`
- Modify: `packages/convex/convex/research_signals.ts` if batch upsert needed

**Interfaces:**
- Consumes: `api.companies.resolveAlias` (via BFF `/api/companies` or Convex); news item titles/snippets
- Produces: `project_signals_for_items(items) -> list[SignalDraft]` with `companyKey` + `kind`

- [ ] **Step 1: Write failing tests for mention → companyKey**

```python
def test_resolve_prefers_alias_hit(monkeypatch):
    # mock resolveAlias returning pro-technic-machinery for 宝力机械
    drafts = project_title("宝力机械扩产招聘销售")
    assert any(d.company_key == "pro-technic-machinery" for d in drafts)
    assert any(d.kind in {"company_mention", "hiring_signal", "sales_trigger"} for d in drafts)
```

- [ ] **Step 2: Run to verify fail; implement rule-based classifier (no LLM required in P1)**

Heuristic sketch (lock in code comments; tune later):

- Always emit `company_mention` when alias resolves
- If title matches hiring keywords (招聘|hiring|岗位|职位) → also `hiring_signal`
- If matches sales/expansion (采购|中标|扩产|合作) → also `sales_trigger`
- Else market language → `market_move` optional

Unresolved mentions: **skip** for P1 widgets (log count).

- [ ] **Step 3: Upsert `research_signals` with evidence fields**

- [ ] **Step 4: Tests pass; commit**

```bash
git commit -m "feat(research): project company signals from ingested news"
```

---

### Task PR4: API `/api/research/*` + CLI `trends research`

**Files:**
- Create: `apps/api/src/routes/research.ts`
- Create: `apps/api/src/services/research-service.ts`
- Create: `apps/api/src/routes/research.test.ts` (or service tests)
- Modify: `apps/api/src/app.ts` (mount routes)
- Create: `packages/cli/cmd/research.go`
- Create: `packages/cli/internal/client/research.go`
- Modify: `packages/cli/cmd/root.go`
- Create: `packages/cli/cmd/research_test.go`

**Interfaces:**
- Produces HTTP:
  - `GET /api/research/news`
  - `GET /api/research/companies/:companyKey/signals?persona=hr|sales`
  - `GET /api/research/companies/search?q=`
  - `GET /api/research/parity` (stub OK until PR6; or 501 until PR6)
- Produces CLI:
  - `trends research company <query> --persona hr|sales`
  - `trends research ingest --once` (calls worker or API)
  - `trends research parity`

**Persona ranking (shared pure function — put in `packages/shared` if both API and web need it):**

```ts
// kind priority by persona (stable sort key)
// hr:    hiring_signal > market_move > company_mention > sales_trigger
// sales: sales_trigger > market_move > company_mention > hiring_signal
```

- [ ] **Step 1: API route tests (mock research-service)**

- [ ] **Step 2: Implement routes + service**

- [ ] **Step 3: CLI tests for flag parsing / client URL paths**

- [ ] **Step 4: Implement CLI + register on root**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(research): API and CLI for company signals and news"
```

---

### Task PR5: Web HR + Sales desk widgets

**Files:**
- Create: `apps/web/src/components/research/CompanyResearchPanel.tsx`
- Create: `apps/web/src/components/research/personaRanking.ts` (or import shared)
- Create: `apps/web/src/components/research/CompanyResearchPanel.test.tsx`
- Modify: HR desk surface (e.g. resumes / policies context — pick existing authenticated desk shell)
- Modify: Sales-oriented surface (or same panel with `persona="sales"` default on a sales entry route)
- i18n locale keys for empty/error/title

**Interfaces:**
- Consumes: `GET /api/research/companies/:companyKey/signals?persona=`
- Produces: panel with persona toggle, signal list, evidence links

- [ ] **Step 1: Component unit test — persona toggle changes order of fixture signals**

- [ ] **Step 2: Implement panel + mount on HR and Sales desks**

Mount guidance:

- HR: near company policy / resumes desk company context (`PoliciesPage` company list or resume desk side panel when company selected)
- Sales: same component with default `persona="sales"` on a sales-facing route or second mount in workspace shell nav “Research (Sales)”

If no dedicated Sales route exists yet, add a minimal authenticated route e.g. `/:workspace/research/sales` and `/:workspace/research/hr` rather than inventing CRM.

- [ ] **Step 3: Run web unit tests**

Run: `npm --workspace @trends/web run test -- src/components/research`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(research): HR and Sales desk company research widgets"
```

---

### Task PR6: Parity harness + dual-run wiring

**Files:**
- Create: `packages/cli/cmd/research_parity.go` or extend `research.go`
- Create: `apps/api/src/services/research-parity-service.ts`
- Modify: `apps/worker/tasks.py` — keep legacy `run_crawl_analyze` behind `LEGACY_TRENDRADAR_CRAWL=1` for shadow only
- Create: tests for parity comparison pure function
- Document golden companies list in `config/research_parity.yaml` or env `RESEARCH_GOLDEN_COMPANY_KEYS`

**Parity rules (from design):**

1. Native news count ≥ **80%** of shadow SQLite count for enabled platforms (when shadow available).
2. Each golden `companyKey` has ≥ 1 signal.
3. Ingest not empty (news_items > 0) on a green run.

Green run: all rules pass. Track consecutive greens in a small Convex table **or** local status file under worker status path — pick one and document in CLI output.

- [ ] **Step 1: Unit test parity decision table (pass/fail fixtures)**

- [ ] **Step 2: Implement `trends research parity` + API**

- [ ] **Step 3: Dual-run: both jobs schedulable; product reads Convex only**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(research): dual-run parity harness with 3-green kill switch"
```

---

### Task PR7: Hard cut — disable and delete legacy product path

**Preconditions:**

- [ ] **Step 0: Confirm 3 consecutive green parity runs** (ops evidence in log/PR description)

**Files (delete or gut after disable):**

- `trendradar/` package usage from worker product path (`tasks.run_crawl_analyze` remove/replace)
- `mcp_server/` if only SQLite news tools remain unused
- `apps/api` SQLite news `DataService` trends routes **or** re-point `/api/trends` to Convex research news if anything still needs the name
- `deploy/docker` trendradar / trendradar-mcp services
- `deploy/systemd` trends-crawler pointing at `python -m trendradar` if replaced by worker research ingest

**Interfaces:**
- Sole crawl/ingest: `run_research_ingest`
- Sole news product API: `/api/research/*` (and any intentional alias)

- [ ] **Step 1: Disable legacy units/flags in deploy configs; ship that first if needed**

- [ ] **Step 2: Remove code paths that import `NewsAnalyzer` for scheduled product crawl**

- [ ] **Step 3: Delete or archive unused SQLite MCP news surface; update README/runbooks**

- [ ] **Step 4: Smoke: worker ingest, API research, CLI research, web widgets — no SQLite dependency**

- [ ] **Step 5: Commit cutover**

```bash
git commit -m "feat(research): hard cut legacy TrendRadar SQLite crawl and MCP news path"
```

---

## Cross-links

- Design: `docs/superpowers/specs/2026-07-21-research-eng-full-distill-design.md`
- Donor architecture: `~/wiki/projects/trendradar/architecture/00-reimplementation-blueprint.md` (ideas only)
- Related company registry design: `docs/superpowers/specs/2026-07-17-company-registry-policy-design.md`

## Execution order

PR1 → PR2 → PR3 → PR4 → PR5 → PR6 → (dual-run ops) → PR7  

Do not start PR7 without three consecutive parity greens.

## Execution handoff

After this plan is approved for implementation:

1. **Subagent-Driven (recommended)** — one PR task per subagent + review between tasks  
2. **Inline Execution** — executing-plans with checkpoints  

This docs-only commit does **not** implement application code.
