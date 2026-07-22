# Research Persona=HR Real Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/:team/research/:companyKey?persona=hr` usable with real DB/fetch data: live-first honesty UI, denser live CNC signals from ingest, and optional flagged on-open refresh.

**Architecture:** Shared Convex `research_signals` stay persona-agnostic. Phase A partitions live vs showcase then applies `rankSignalsForPersona`. Phase B hardens worker rule projection + brand resolve so NewsNow titles become live signals. Phase C adds env-gated, rate-limited company-page refresh that reuses workspace ingest platforms.

**Tech Stack:** TypeScript BFF + shared ranking (`@trends/shared`), React company page, Python worker projector/ingest, vitest, pytest.

**Design spec:** `docs/superpowers/specs/2026-07-22-research-persona-hr-real-data-design.md`

## Global Constraints

- Sequence **A → B → C** (do not ship C before A; B may parallel A after A API contract lands).
- Personas **hr | sales** re-rank only — **no** storage fork.
- Live row = `evidence.platform !== "showcase"` **and** `ingestRunId` does not start with `showcase-seed`.
- Evidence links: real `http(s)` only; never `*.local`.
- Worker writes Convex **directly** (no BFF write path for scheduled ingest).
- No TrendRadar bulk merge; no PR7 cutover; no AI classifier in this plan.
- Prefer fixtures; live NewsNow optional for CI.
- Local-only: no production deploy / origin push.
- Hub default links remain `?persona=hr`.

---

## File map

| Path | Role |
|------|------|
| `packages/shared/src/research/live-signal.ts` | Pure `isLiveResearchSignal` + `partitionAndRankSignalsForPersona` |
| `packages/shared/src/research/live-signal.test.ts` | Pure tests |
| `packages/shared/src/index.ts` | Re-export |
| `apps/api/src/services/research-service.ts` | `listCompanySignals` returns live-first items + meta |
| `apps/api/src/routes/research.ts` | OpenAPI schema for meta |
| `apps/api/src/routes/research.test.ts` | Route tests |
| `apps/web/src/components/research/CompanyResearchPanel.tsx` | Sections + banner props |
| `apps/web/src/pages/ResearchCompanyPage.tsx` | Wire meta + optional on-open refresh |
| `apps/web/src/pages/ResearchCompanyPage.test.tsx` | Expand beyond route-mount smoke |
| `apps/worker/research_project.py` | Classifier + brand surface extras |
| `apps/worker/tests/test_research_project.py` | Projector fixtures |
| `apps/worker/research_industry_bridge.py` (if present) / resolve path | Brand surfaces for extras |
| `.env.example` | `RESEARCH_COMPANY_ON_OPEN_REFRESH` |

---

### Task 1: Shared live partition + rank helper (Phase A foundation)

**Files:**
- Create: `packages/shared/src/research/live-signal.ts`
- Create: `packages/shared/src/research/live-signal.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `isLiveResearchSignal(signal: { evidence?: { platform?: string }; ingestRunId?: string | null }): boolean`
  - `partitionAndRankSignalsForPersona<T>(signals: readonly T[], persona: string): { live: T[]; showcase: T[]; items: T[]; meta: { liveCount: number; showcaseCount: number; liveFirst: true } }`
  - Uses existing `rankSignalsForPersona` from `./persona-ranking.js`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  isLiveResearchSignal,
  partitionAndRankSignalsForPersona,
} from "./live-signal.js";

const liveHire = {
  kind: "hiring_signal",
  capturedAt: 2,
  evidence: { platform: "weibo", title: "x" },
  ingestRunId: "research-abc",
};
const liveSales = {
  kind: "sales_trigger",
  capturedAt: 3,
  evidence: { platform: "zhihu", title: "y" },
  ingestRunId: "research-def",
};
const seedHire = {
  kind: "hiring_signal",
  capturedAt: 9,
  evidence: { platform: "showcase", title: "s" },
  ingestRunId: "showcase-seed-v1",
};
const seedSales = {
  kind: "sales_trigger",
  capturedAt: 8,
  evidence: { platform: "showcase", title: "s2" },
  ingestRunId: "showcase-seed-v1",
};

it("isLiveResearchSignal rejects showcase platform and showcase-seed ingest", () => {
  expect(isLiveResearchSignal(liveHire)).toBe(true);
  expect(isLiveResearchSignal(seedHire)).toBe(false);
  expect(
    isLiveResearchSignal({
      evidence: { platform: "weibo" },
      ingestRunId: "showcase-seed-v1",
    }),
  ).toBe(false);
});

it("partition ranks live first for hr then showcase", () => {
  const { items, meta } = partitionAndRankSignalsForPersona(
    [seedSales, liveSales, seedHire, liveHire],
    "hr",
  );
  expect(meta).toEqual({ liveCount: 2, showcaseCount: 2, liveFirst: true });
  expect(items.map((i) => i.kind)).toEqual([
    "hiring_signal", // live hire first for hr
    "sales_trigger",
    "hiring_signal", // showcase hire
    "sales_trigger",
  ]);
  expect(items[0]).toBe(liveHire);
});

it("sales persona reorders live kinds without promoting showcase above live", () => {
  const { items } = partitionAndRankSignalsForPersona(
    [liveHire, liveSales, seedHire],
    "sales",
  );
  expect(items[0]).toBe(liveSales);
  expect(items[1]).toBe(liveHire);
  expect(items[2]).toBe(seedHire);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm --workspace @trends/shared run test -- src/research/live-signal.test.ts
# or: bunx vitest run packages/shared/src/research/live-signal.test.ts
```

Expected: FAIL — module missing

- [ ] **Step 3: Implement**

```typescript
// packages/shared/src/research/live-signal.ts
import { rankSignalsForPersona, type ResearchSignalLike } from "./persona-ranking.js";

export function isLiveResearchSignal(signal: {
  evidence?: { platform?: string };
  ingestRunId?: string | null;
}): boolean {
  const platform = signal.evidence?.platform ?? "";
  if (platform === "showcase") return false;
  const runId = signal.ingestRunId ?? "";
  if (typeof runId === "string" && runId.startsWith("showcase-seed")) return false;
  return true;
}

export function partitionAndRankSignalsForPersona<T extends ResearchSignalLike & {
  evidence?: { platform?: string };
  ingestRunId?: string | null;
}>(signals: readonly T[], persona: string) {
  const live: T[] = [];
  const showcase: T[] = [];
  for (const s of signals) {
    if (isLiveResearchSignal(s)) live.push(s);
    else showcase.push(s);
  }
  const rankedLive = rankSignalsForPersona(live, persona);
  const rankedShowcase = rankSignalsForPersona(showcase, persona);
  return {
    live: rankedLive,
    showcase: rankedShowcase,
    items: [...rankedLive, ...rankedShowcase],
    meta: {
      liveCount: rankedLive.length,
      showcaseCount: rankedShowcase.length,
      liveFirst: true as const,
    },
  };
}
```

Export from `packages/shared/src/index.ts`.

- [ ] **Step 4: Run — expect PASS**

```bash
bunx vitest run packages/shared/src/research/live-signal.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/research/live-signal.ts \
  packages/shared/src/research/live-signal.test.ts \
  packages/shared/src/index.ts
git commit -m "feat(research): shared live-first signal partition for personas"
```

---

### Task 2: API listCompanySignals live-first + meta (Phase A)

**Files:**
- Modify: `apps/api/src/services/research-service.ts`
- Modify: `apps/api/src/routes/research.ts` (list signals response schema)
- Modify: `apps/api/src/routes/research.test.ts`

**Interfaces:**
- Consumes: `partitionAndRankSignalsForPersona` from `@trends/shared`
- Produces: `listCompanySignals` → `{ persona, items, meta: { liveCount, showcaseCount, liveFirst: true } }`

- [ ] **Step 1: Failing route/service expectation**

In `research.test.ts` (or a small service test), after mocking Convex signals with mixed showcase/live:

```typescript
expect(body.meta.liveCount).toBe(1);
expect(body.meta.showcaseCount).toBe(1);
expect(body.meta.liveFirst).toBe(true);
expect(body.items[0].evidence.platform).not.toBe("showcase");
```

Update existing persona rank test to still expect hiring before sales **within live**.

- [ ] **Step 2: Run — expect FAIL**

```bash
bunx vitest run apps/api/src/routes/research.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// research-service.ts listCompanySignals
import { normalizeResearchPersona, partitionAndRankSignalsForPersona } from "@trends/shared";

// after parseSignal filter:
const partitioned = partitionAndRankSignalsForPersona(items, persona);
return {
  persona,
  items: partitioned.items,
  meta: partitioned.meta,
};
```

OpenAPI: add `meta` object to list signals 200 schema.

Ensure `parseSignal` already passes `ingestRunId` and nested `evidence.platform` (it does).

- [ ] **Step 4: Run — expect PASS**

```bash
bunx vitest run apps/api/src/routes/research.test.ts
npm --workspace @trends/api run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/research-service.ts \
  apps/api/src/routes/research.ts \
  apps/api/src/routes/research.test.ts
git commit -m "feat(research): live-first company signals API meta"
```

---

### Task 3: Company page honesty UI (Phase A)

**Files:**
- Modify: `apps/web/src/components/research/CompanyResearchPanel.tsx`
- Modify: `apps/web/src/pages/ResearchCompanyPage.tsx`
- Modify: `apps/web/src/pages/ResearchCompanyPage.test.tsx` (expand with RTL + mocks)

**Interfaces:**
- Consumes: API `meta` + `items` (already ordered)
- Produces: UI sections `实时信号` / `展示数据`, empty-live banner

- [ ] **Step 1: Failing UI tests**

```typescript
// ResearchCompanyPage.test.tsx — mock rawApiClient GET signals
it('shows live-only banner when all signals are showcase', async () => {
  // mock items all platform showcase, meta liveCount 0 showcaseCount 2
  render with MemoryRouter route /hr/research/fanuc?persona=hr + Workspace mock
  await waitFor(() => {
    expect(screen.getByTestId('research-live-empty-banner')).toBeInTheDocument()
  })
  expect(screen.getByTestId('research-section-showcase')).toBeInTheDocument()
})

it('renders live section before showcase when both present', async () => {
  // meta liveCount 1 showcaseCount 1
  await waitFor(() => {
    const live = screen.getByTestId('research-section-live')
    const seed = screen.getByTestId('research-section-showcase')
    expect(live.compareDocumentPosition(seed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm --workspace @trends/web run test -- src/pages/ResearchCompanyPage.test.tsx
```

- [ ] **Step 3: Implement**

`SignalsResponse` type:

```typescript
meta?: { liveCount: number; showcaseCount: number; liveFirst?: boolean }
```

Panel props: `liveCount`, `showcaseCount`, or pass full `meta` + still use ordered `signals`.

UI rules:

- If `liveCount === 0 && showcaseCount > 0`: banner `data-testid="research-live-empty-banner"`.
- Split render: `signals.filter(isLive)` / rest using same `isLiveResearchSignal` from `@trends/shared` **or** trust server order and split by counting meta (prefer import shared helper for client-side section headers).
- Keep existing persona toggle and ingest buttons.
- Evidence link rules already in panel — keep.

- [ ] **Step 4: Run — expect PASS**

```bash
npm --workspace @trends/web run test -- src/pages/ResearchCompanyPage.test.tsx
npm --workspace @trends/web run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/research/CompanyResearchPanel.tsx \
  apps/web/src/pages/ResearchCompanyPage.tsx \
  apps/web/src/pages/ResearchCompanyPage.test.tsx
git commit -m "feat(research): company page live-first honesty for persona=hr"
```

---

### Task 4: Projector density — kinds + brand fixture (Phase B)

**Files:**
- Modify: `apps/worker/research_project.py`
- Modify: `apps/worker/tests/test_research_project.py`

**Interfaces:**
- Consumes: existing `project_title`, `classify_kinds`
- Produces: expanded regex; optional brand-aware extras via `extra_aliases` (already supported)

- [ ] **Step 1: Failing tests**

```python
def test_classify_hiring_cnc_phrasing():
    kinds = classify_kinds("发那科相关渠道招聘应用工程师")
    assert "hiring_signal" in kinds

def test_project_title_live_url_preserved():
    drafts = project_title(
        "发那科扩产与加工中心订单",
        company_key="fanuc",
        platform="weibo",
        url="https://weibo.com/real/123",
        seen_at=1000,
        ingest_run_id="research-xyz",
    )
    assert drafts
    assert any(d.kind == "sales_trigger" or d.kind == "market_move" for d in drafts)
    assert all(d.evidence.get("url") == "https://weibo.com/real/123" for d in drafts)
    assert all(d.evidence.get("platform") == "weibo" for d in drafts)

def test_project_title_with_extra_aliases_resolves_without_company_key():
    class R:
        def resolve(self, alias: str):
            if "发那科" in alias or alias == "发那科":
                return {"companyKey": "fanuc"}
            return None
    # If resolve_first_company uses resolver differently, match existing test patterns in file
    drafts = project_title(
        "发那科招聘工程师",
        resolver=...,  # use existing FakeResolver pattern from test file
        platform="zhihu",
        url="https://www.zhihu.com/question/1",
        seen_at=1,
    )
    assert drafts and drafts[0].company_key == "fanuc"
    assert any(d.kind == "hiring_signal" for d in drafts)
```

Adapt FakeResolver to match **existing** helpers in `test_research_project.py`.

- [ ] **Step 2: Run — expect FAIL** if regex too narrow

```bash
python -m pytest apps/worker/tests/test_research_project.py -q
```

- [ ] **Step 3: Expand heuristics (minimal)**

```python
HIRING_RE = re.compile(
    r"招聘|hiring|岗位|职位|招人|headcount|招聘会|应用工程师|人才|校招|社招",
    re.IGNORECASE,
)
SALES_RE = re.compile(
    r"采购|中标|扩产|合作|订单|签约|采购意向|招标|扩能",
    re.IGNORECASE,
)
MARKET_RE = re.compile(
    r"融资|上市|并购|工厂|投产|发布|涨价|降价|市占|加工中心|智能制造|数控系统",
    re.IGNORECASE,
)
```

Do **not** invent AI. Keep `company_mention` always when resolved.

- [ ] **Step 4: Run — expect PASS**

```bash
python -m pytest apps/worker/tests/test_research_project.py -q
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/research_project.py apps/worker/tests/test_research_project.py
git commit -m "feat(research): denser CNC rule projection for live signals"
```

---

### Task 5: Industry bridge surfaces as alias hints on ingest (Phase B)

**Files:**
- Modify: `apps/worker/research_ingest.py` (where `project_signals_for_items` is called)
- Modify or create: `apps/worker/tests/test_research_ingest_project_hints.py` **or** extend `test_research_ingest.py`
- Read: `apps/worker/research_industry_bridge.py` / `IndustryBridgeResolver` already used in ingest

**Interfaces:**
- Produces: `alias_hints` or resolver that also matches brand surfaces from industry data for golden brands

- [ ] **Step 1: Inspect current resolve path in `research_ingest.py`**

Find `IndustryBridgeResolver` / `project_signals_for_items` call site. Note how `resolve_first_company` works.

- [ ] **Step 2: Failing integration-style unit test**

```python
def test_ingest_projects_signal_when_title_contains_fanuc_surface():
    # Static hotlist title "发那科招聘应用工程师" with url https://weibo.com/x
    # Fake Convex alias_map may be empty; industry bridge must still resolve fanuc
    # Assert research_signals:upsert called with companyKey fanuc and platform weibo
```

If industry bridge already resolves in unit env without files, use real loaders; else inject fake bridge list `{"发那科": "fanuc"}`.

- [ ] **Step 3: Implement thinnest fix**

Preferred order:

1. Ensure `IndustryBridgeResolver` is used as primary resolve (already noted in ingest comments).  
2. If titles still miss: pass `extra_aliases` extracted via simple CJK brand list from bridge entities for each item title (substring match of known `nameCn` surfaces).

```python
# pure helper in research_project.py or research_resolve.py
def brand_surfaces_in_text(text: str, surfaces: Sequence[tuple[str, str]]) -> List[str]:
    """Return companyKeys whose surface appears as substring in text."""
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest apps/worker/tests/test_research_project.py apps/worker/tests/test_research_ingest.py -q
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/research_ingest.py apps/worker/research_project.py apps/worker/research_resolve.py apps/worker/tests/
git commit -m "feat(research): brand surface hints improve live signal density"
```

---

### Task 6: On-open refresh flag + cooldown (Phase C)

**Files:**
- Modify: `apps/web/src/pages/ResearchCompanyPage.tsx`
- Modify: `apps/web/src/pages/ResearchCompanyPage.test.tsx`
- Modify: `.env.example`
- Optional API: none if reusing `POST /api/research/ingest/run` (already sends workspace platforms)

**Interfaces:**
- Produces: client-side gate using `import.meta.env.VITE_RESEARCH_COMPANY_ON_OPEN_REFRESH` **or** `GET` meta flag later; plan locks **Vite env** for web + document worker not required for C1

**Locked C1 approach (YAGNI):**

- Web only: if `VITE_RESEARCH_COMPANY_ON_OPEN_REFRESH === "1"`, after first successful signals load, call existing `POST /api/research/ingest/run` once per `companyKey` per tab session **or** `sessionStorage` key `research.refresh.<companyKey>` with timestamp; cooldown **5 minutes**.
- Do **not** block first paint: fire refresh in `useEffect` after paint; on complete, `loadSignals()` again.
- Manual **运行抓取** always available.

- [ ] **Step 1: Failing tests**

```typescript
it('does not auto ingest when on-open flag off', async () => {
  // ensure env mock false
  render page
  await waitFor signals
  expect(postMock).not.toHaveBeenCalledWith('/api/research/ingest/run', expect.anything())
})

it('auto ingest once when flag on and cooldown free', async () => {
  vi.stubEnv('VITE_RESEARCH_COMPANY_ON_OPEN_REFRESH', '1')
  // clear sessionStorage
  render page
  await waitFor(() => {
    expect(postMock).toHaveBeenCalledWith('/api/research/ingest/run', expect.anything())
  })
})
```

Note: Vitest env stubbing may use `vi.stubEnv` (Vitest 1+) or `import.meta.env` mock via vi.stubGlobal — match project patterns.

If env hard to test, extract:

```typescript
export function shouldAutoRefreshCompany(opts: {
  enabled: boolean
  companyKey: string
  now: number
  lastRefreshAt: number | null
  cooldownMs: number
}): boolean
```

Pure-test that helper; wire page to use it.

- [ ] **Step 2: Implement pure helper + page wire**

```typescript
// apps/web/src/lib/research-company-refresh.ts
export const RESEARCH_COMPANY_REFRESH_COOLDOWN_MS = 5 * 60 * 1000

export function shouldAutoRefreshCompany(...): boolean {
  if (!enabled || !companyKey) return false
  if (lastRefreshAt == null) return true
  return now - lastRefreshAt >= cooldownMs
}
```

- [ ] **Step 3: `.env.example`**

```bash
# VITE_RESEARCH_COMPANY_ON_OPEN_REFRESH=1
# When set, research company page may trigger workspace ingest after first paint (5m cooldown).
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm --workspace @trends/web run test -- src/pages/ResearchCompanyPage.test.tsx src/lib/research-company-refresh.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ResearchCompanyPage.tsx \
  apps/web/src/lib/research-company-refresh.ts \
  apps/web/src/lib/research-company-refresh.test.ts \
  apps/web/src/pages/ResearchCompanyPage.test.tsx \
  .env.example
git commit -m "feat(research): flagged on-open company refresh with cooldown"
```

---

### Task 7: Docs smoke checklist + regression suite

**Files:**
- Optional one-liner in `docs/agent-runbook.md` under research (only if section exists)

- [ ] **Step 1: Run full focused suite**

```bash
bunx vitest run packages/shared/src/research/live-signal.test.ts \
  apps/api/src/routes/research.test.ts
python -m pytest apps/worker/tests/test_research_project.py apps/worker/tests/test_research_ingest.py -q
npm --workspace @trends/web run test -- src/pages/ResearchCompanyPage.test.tsx
npm --workspace @trends/api run typecheck
npm --workspace @trends/web run typecheck
```

Expected: all pass

- [ ] **Step 2: Manual smoke (optional)**

1. Open `/hr/research/fanuc?persona=hr` — banner if live empty; showcase labeled  
2. Toggle sales — live (if any) reorders  
3. With `VITE_RESEARCH_COMPANY_ON_OPEN_REFRESH=1`, confirm single ingest post  
4. No `showcase.local` as clickable evidence  

- [ ] **Step 3: Commit only if runbook/docs changed**

```bash
git add docs/agent-runbook.md  # if touched
git commit -m "docs(research): persona hr real-data smoke notes"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Phase A live-first order | 1–2 |
| Phase A honesty UI / banner / sections | 3 |
| Live definition (platform + ingestRunId) | 1 |
| Evidence link honesty | 3 (keep panel rules) |
| Phase B projector density | 4 |
| Phase B brand resolve / aliases | 5 |
| Phase C flagged on-open + cooldown | 6 |
| No persona storage fork | Global + all tasks |
| No AI / no PR7 / no TrendRadar merge | Global |
| Fixture-first tests | All |

**Placeholder scan:** none intentional.  
**Type consistency:** `meta.liveCount`, `meta.showcaseCount`, `meta.liveFirst: true` used end-to-end.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-research-persona-hr-real-data-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with checkpoints  

Which approach?
