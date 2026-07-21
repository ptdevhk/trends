# Research Eng Productional Thin Vertical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productionalize Research Eng so live hotlist+RSS ingest fills Convex without seed scripts, scheduler/flags are documented, and the desk has search/picker, kind filters, empty states, ingest button, and resume/policy deep links.

**Architecture:** Thin NewsNow-compatible hotlist port (no `NewsAnalyzer`, no permanent `DataFetcher` import) plus existing RSS port feed `ResearchIngestJob` → direct Convex writes. BFF exposes latest ingest run; web adds research index, company-page filters/empty/ingest control, and deep-link polish. PR7 cutover remains out of scope.

**Tech Stack:** Python worker (`apps/worker`), Convex (`packages/convex`), Hono API (`apps/api`), React web (`apps/web`), pytest / vitest / convex-test.

**Design spec:** `docs/superpowers/specs/2026-07-22-research-eng-productional-thin-vertical-design.md`  
**Predecessor (shipped):** `docs/superpowers/specs/2026-07-21-research-eng-full-distill-design.md`

## Global Constraints

- **No NewsAnalyzer** on the product ingest path.
- **No permanent import** of `trendradar.crawler.fetcher.DataFetcher`; port URL/parse/retry ideas only.
- **Direct Convex writes** with `CONVEX_URL` + `CONVEX_WRITE_SECRET` (not BFF for scheduled ingest).
- **Nested `evidence`** on `research_signals`; personas re-rank only.
- **Soft-fail** per hotlist platform and per RSS feed; do not abort the whole run on one source failure.
- **Schedule default off:** `RESEARCH_INGEST_ENABLED` must be set for scheduler registration; operator once-run / UI may force one shot.
- **Non-goals:** PR7 hard cut, dual-run green campaign, AI/notify, CRM, MCP.
- Prefer fixture-driven unit tests (no live network in CI).

---

## File map (expected)

| Path | Role |
|------|------|
| `apps/worker/research_ports.py` | `NewsNowHotlistPort`, pure `parse_newsnow_payload`, keep RSS |
| `apps/worker/research_ingest.py` | Default to NewsNow port; soft-fail fetch loops; env `RESEARCH_HOTLIST_API_URL` |
| `apps/worker/tests/test_research_ports.py` | Fixture JSON/XML parse tests |
| `apps/worker/tests/test_research_ingest.py` | Soft-fail + default port wiring tests |
| `apps/worker/tests/fixtures/newsnow_weibo_success.json` | Recorded NewsNow-shaped payload |
| `packages/convex/convex/research_ops.ts` | `latestIngestRun` query |
| `packages/convex/__tests__/research-ops-convex-test.test.ts` | latest ingest test |
| `apps/api/src/services/research-service.ts` | `getLatestIngestRun` |
| `apps/api/src/routes/research.ts` | `GET /api/research/ingest/latest` |
| `apps/api/src/routes/research.test.ts` | Route test for latest |
| `apps/web/src/pages/ResearchIndexPage.tsx` | Company search/picker |
| `apps/web/src/pages/ResearchCompanyPage.tsx` | kinds, empty, ingest button, latest run |
| `apps/web/src/components/research/*` | Kind filter chips, ingest control |
| `apps/web/src/App.tsx` | `research` index route |
| `apps/web/src/components/CompanyPolicyBadges.tsx` | Research link polish if needed |
| `.env.example` | Research flags docs |

---

### Task 1: NewsNow parse helper + fixture tests

**Files:**
- Create: `apps/worker/tests/fixtures/newsnow_weibo_success.json`
- Create: `apps/worker/tests/test_research_ports.py`
- Modify: `apps/worker/research_ports.py`

**Interfaces:**
- Consumes: existing `NormalizedNewsItem`, `stable_content_hash`
- Produces:
  - `parse_newsnow_payload(platform_id: str, payload: dict | str, captured_at: int) -> list[NormalizedNewsItem]`
  - Raises or returns empty on bad status (see steps)

- [ ] **Step 1: Write fixture file**

```json
{
  "status": "success",
  "items": [
    {
      "title": "宝力机械扩产招聘",
      "url": "https://example.com/a",
      "mobileUrl": "https://m.example.com/a",
      "id": "ext-1"
    },
    {
      "title": "  ",
      "url": "https://example.com/skip"
    }
  ]
}
```

- [ ] **Step 2: Write failing tests**

```python
# apps/worker/tests/test_research_ports.py
from pathlib import Path
import json
from apps.worker.research_ports import parse_newsnow_payload

FIXTURE = Path(__file__).parent / "fixtures" / "newsnow_weibo_success.json"

def test_parse_newsnow_success_maps_items():
    payload = json.loads(FIXTURE.read_text())
    items = parse_newsnow_payload("weibo", payload, captured_at=1000)
    assert len(items) == 1
    assert items[0].title == "宝力机械扩产招聘"
    assert items[0].platform == "weibo"
    assert items[0].url == "https://example.com/a"
    assert items[0].external_id == "ext-1"
    assert items[0].content_hash  # non-empty

def test_parse_newsnow_rejects_bad_status():
    items = parse_newsnow_payload("weibo", {"status": "error", "items": [{"title": "x"}]}, 1)
    assert items == []

def test_parse_newsnow_accepts_cache_status():
    items = parse_newsnow_payload(
        "baidu",
        {"status": "cache", "items": [{"title": "标题", "url": "http://u"}]},
        2,
    )
    assert len(items) == 1
    assert items[0].platform == "baidu"
```

- [ ] **Step 3: Run tests — expect fail**

```bash
cd /Users/karlchow/Desktop/code/trends
uv run pytest apps/worker/tests/test_research_ports.py -q
```

Expected: FAIL — `parse_newsnow_payload` missing

- [ ] **Step 4: Implement pure parser in `research_ports.py`**

```python
def parse_newsnow_payload(
    platform_id: str,
    payload: Any,
    captured_at: int,
) -> List[NormalizedNewsItem]:
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return []
    if not isinstance(payload, dict):
        return []
    status = payload.get("status")
    if status not in ("success", "cache"):
        return []
    raw_items = payload.get("items") or []
    result: List[NormalizedNewsItem] = []
    for index, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            continue
        title = raw.get("title")
        if title is None or isinstance(title, float) or not str(title).strip():
            continue
        title = str(title).strip()
        url = raw.get("url") or raw.get("mobileUrl") or raw.get("mobile_url")
        external_id = raw.get("id") or raw.get("external_id")
        content_hash = stable_content_hash(
            platform=platform_id,
            title=title,
            url=str(url) if url else None,
            external_id=str(external_id) if external_id else None,
        )
        result.append(
            NormalizedNewsItem(
                source_id=platform_id,
                platform=platform_id,
                title=title,
                content_hash=content_hash,
                captured_at=captured_at,
                external_id=str(external_id) if external_id else None,
                url=str(url) if url else None,
                rank=index + 1,
            )
        )
    return result
```

- [ ] **Step 5: Run tests — expect pass**

```bash
uv run pytest apps/worker/tests/test_research_ports.py -q
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/worker/research_ports.py apps/worker/tests/test_research_ports.py apps/worker/tests/fixtures/newsnow_weibo_success.json
git commit -m "feat(research): parse NewsNow-shaped hotlist payloads"
```

---

### Task 2: NewsNowHotlistPort HTTP adapter

**Files:**
- Modify: `apps/worker/research_ports.py`
- Modify: `apps/worker/tests/test_research_ports.py`

**Interfaces:**
- Consumes: `parse_newsnow_payload`, urllib fetch with retries
- Produces: `NewsNowHotlistPort(api_url: str | None = None, timeout_seconds=15, max_retries=2)` with `.fetch(platform_id, captured_at) -> list[NormalizedNewsItem]`
- Default API: `https://newsnow.busiyi.world/api/s`
- Request: `GET {api_url}?id={platform_id}&latest`

- [ ] **Step 1: Write failing test with injectable getter**

```python
def test_newsnow_port_builds_query_and_parses(monkeypatch):
    from apps.worker.research_ports import NewsNowHotlistPort

    calls = []
    def fake_get(url: str) -> str:
        calls.append(url)
        return json.dumps({
            "status": "success",
            "items": [{"title": "T1", "url": "http://x", "id": "1"}],
        })

    port = NewsNowHotlistPort(api_url="https://example.test/api/s", getter=fake_get)
    items = port.fetch("weibo", captured_at=9)
    assert len(items) == 1
    assert "id=weibo" in calls[0]
    assert "latest" in calls[0]
    assert items[0].title == "T1"
```

- [ ] **Step 2: Run — expect fail; implement `NewsNowHotlistPort`**

```python
DEFAULT_NEWSNOW_API_URL = "https://newsnow.busiyi.world/api/s"

@dataclass
class NewsNowHotlistPort:
    api_url: Optional[str] = None
    timeout_seconds: float = 15.0
    max_retries: int = 2
    getter: Optional[Callable[[str], Optional[str]]] = None  # test inject

    def fetch(self, platform_id: str, captured_at: int) -> List[NormalizedNewsItem]:
        base = (self.api_url or DEFAULT_NEWSNOW_API_URL).rstrip("/")
        url = f"{base}?id={platform_id}&latest"
        body = self._get(url)
        if not body:
            return []
        return parse_newsnow_payload(platform_id, body, captured_at)

    def _get(self, url: str) -> Optional[str]:
        if self.getter is not None:
            return self.getter(url)
        # existing retry urllib pattern from HttpHotlistPort
        ...
```

Keep `HttpHotlistPort` for optional `RESEARCH_HOTLIST_BASE_URL` path-style endpoints if already used; document NewsNow as the product default.

- [ ] **Step 3: Tests pass; commit**

```bash
uv run pytest apps/worker/tests/test_research_ports.py -q
git add apps/worker/research_ports.py apps/worker/tests/test_research_ports.py
git commit -m "feat(research): NewsNow hotlist port for live platform fetch"
```

---

### Task 3: Wire ingest job to NewsNow + soft-fail per source

**Files:**
- Modify: `apps/worker/research_ingest.py`
- Modify: `apps/worker/tests/test_research_ingest.py`
- Modify: `.env.example`

**Interfaces:**
- Default hotlist port: `NewsNowHotlistPort(api_url=os.environ.get("RESEARCH_HOTLIST_API_URL") or None)`
- Optional legacy path-style: if `RESEARCH_HOTLIST_BASE_URL` set and `RESEARCH_HOTLIST_API_URL` unset, keep `HttpHotlistPort` (compat)
- Per-platform / per-feed: try/except or empty on failure; continue; do not fail whole run solely because one platform returned empty
- Whole-run still fails on Convex write errors

- [ ] **Step 1: Failing test — soft-fail hotlist**

```python
class BoomHotlist:
    def fetch(self, platform_id, captured_at):
        if platform_id == "bad":
            raise RuntimeError("upstream")
        return []

def test_ingest_continues_when_one_platform_raises():
    # RecordingConvex from existing tests
    ...
    job = ResearchIngestJob(
        client=client,
        hotlist_port=BoomHotlist(),
        rss_port=StaticRssPort(),
        platforms=["bad", "weibo"],
        rss_feeds=[],
        now_ms=lambda: 1,
    )
    # monkeypatch BoomHotlist weibo to return one item via a smarter fake
    ok = job.run()
    assert ok is True
```

Use a hotlist fake that raises on first platform and returns one item on second; assert news upsert still called.

- [ ] **Step 2: Implement soft-fail loops + default NewsNow port**

```python
# research_ingest.py __init__
api_url = os.environ.get("RESEARCH_HOTLIST_API_URL")
base_url = os.environ.get("RESEARCH_HOTLIST_BASE_URL")
if hotlist_port is not None:
    self.hotlist_port = hotlist_port
elif api_url or not base_url:
    self.hotlist_port = NewsNowHotlistPort(api_url=api_url or None)
else:
    self.hotlist_port = HttpHotlistPort(base_url=base_url)

# in run():
for platform_id in self.platforms:
    try:
        items = self.hotlist_port.fetch(platform_id, started_at)
        collected.extend(items)
    except Exception as error:
        logger.warning("[ResearchIngest] hotlist %s failed: %s", platform_id, error)

for feed in self.rss_feeds:
    try:
        items = self.rss_port.fetch(feed["id"], feed["url"], started_at)
        collected.extend(items)
    except Exception as error:
        logger.warning("[ResearchIngest] rss %s failed: %s", feed.get("id"), error)
```

- [ ] **Step 3: Document flags in `.env.example`**

```bash
# Research Eng native ingest (Convex news_items + research_signals)
# RESEARCH_INGEST_ENABLED=1
# RESEARCH_HOTLIST_API_URL=https://newsnow.busiyi.world/api/s
# RESEARCH_HOTLIST_BASE_URL=          # optional path-style alternate; prefer API_URL
# RESEARCH_HOTLIST_PROXY_URL=
# LEGACY_TRENDRADAR_CRAWL=1          # shadow only; not required for product path
```

- [ ] **Step 4: Tests pass; commit**

```bash
uv run pytest apps/worker/tests/test_research_ingest.py apps/worker/tests/test_research_ports.py -q
git add apps/worker/research_ingest.py apps/worker/tests/test_research_ingest.py .env.example
git commit -m "feat(research): default NewsNow ingest with soft-fail sources"
```

---

### Task 4: Convex `latestIngestRun` + BFF route

**Files:**
- Modify: `packages/convex/convex/research_ops.ts`
- Modify: `packages/convex/__tests__/research-ops-convex-test.test.ts`
- Modify: `apps/api/src/services/research-service.ts`
- Modify: `apps/api/src/routes/research.ts`
- Modify: `apps/api/src/routes/research.test.ts`

**Interfaces:**
- Produces: `api.research_ops.latestIngestRun` → latest by `startedAt` desc or null
- Produces: `GET /api/research/ingest/latest` → `{ success, run }`

- [ ] **Step 1: Failing convex-test**

```ts
it("returns latest ingest run by startedAt", async () => {
  const t = createTest();
  await t.mutation(api.research_ops.startIngestRun, {
    writeSecret: WRITE_SECRET,
    runId: "old",
    startedAt: 1000,
    enabledPlatforms: ["weibo"],
  });
  await t.mutation(api.research_ops.finishIngestRun, {
    writeSecret: WRITE_SECRET,
    runId: "old",
    finishedAt: 1100,
    status: "success",
    newsInserted: 1,
  });
  await t.mutation(api.research_ops.startIngestRun, {
    writeSecret: WRITE_SECRET,
    runId: "new",
    startedAt: 2000,
    enabledPlatforms: ["weibo"],
  });
  const latest = await t.query(api.research_ops.latestIngestRun, {
    writeSecret: WRITE_SECRET,
  });
  expect(latest?.runId).toBe("new");
});
```

- [ ] **Step 2: Implement query**

```ts
export const latestIngestRun = query({
  args: { writeSecret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    requireReadSecret(args.writeSecret);
    return await ctx.db
      .query("research_ingest_runs")
      .withIndex("by_started_at")
      .order("desc")
      .first();
  },
});
```

- [ ] **Step 3: BFF service + route + test (mock Convex query path `research_ops:latestIngestRun`)**

```ts
// research-service.ts
export async function getLatestIngestRun(): Promise<unknown | null> {
  const value = await callConvexQuery("research_ops:latestIngestRun", {
    writeSecret: config.auth.convexWriteSecret,
  });
  return value ?? null;
}
```

```ts
// research.ts — OpenAPI GET /api/research/ingest/latest
app.openapi(latestIngestRoute, async (c) => {
  const run = await getLatestIngestRun();
  return c.json({ success: true as const, run }, 200);
});
```

- [ ] **Step 4: Run tests; commit**

```bash
bunx vitest run packages/convex/__tests__/research-ops-convex-test.test.ts apps/api/src/routes/research.test.ts
git add packages/convex/convex/research_ops.ts packages/convex/__tests__/research-ops-convex-test.test.ts \
  apps/api/src/services/research-service.ts apps/api/src/routes/research.ts apps/api/src/routes/research.test.ts
git commit -m "feat(research): expose latest ingest run for desk UX"
```

---

### Task 5: Web research index (company search/picker)

**Files:**
- Create: `apps/web/src/pages/ResearchIndexPage.tsx`
- Create: `apps/web/src/pages/ResearchIndexPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Route: `/:teamSlug/research` (exact) **before** `research/:companyKey`
- Calls `GET /api/research/companies/search?q=`
- Navigates to `/${teamSlug}/research/${companyKey}?persona=hr`

- [ ] **Step 1: Failing route mount test**

```ts
// ResearchIndexPage.test.tsx + App structural check
it("App mounts research index and company routes", () => {
  const source = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
  expect(source).toContain('path="research"');
  expect(source).toContain('path="research/:companyKey"');
});
```

- [ ] **Step 2: Implement `ResearchIndexPage`**

Minimal UI:

- `PageHeader` title Research
- Search input `data-testid="research-company-search"`
- On submit/debounce: `rawApiClient.GET('/api/research/companies/search', { params: { query: { q } } })`
- Result list links to company page
- Empty query hint: type company name or key

- [ ] **Step 3: Wire App.tsx**

```tsx
const LazyResearchIndexPage = lazy(async () => {
  const module = await import('@/pages/ResearchIndexPage')
  return { default: module.ResearchIndexPage }
})
// inside MainShell routes, order matters:
<Route path="research" element={<RouteSuspense><LazyResearchIndexPage /></RouteSuspense>} />
<Route path="research/:companyKey" element={... existing ...} />
```

- [ ] **Step 4: Web tests; commit**

```bash
npm --workspace @trends/web run test -- src/pages/ResearchIndexPage src/pages/ResearchCompanyPage
git add apps/web/src/pages/ResearchIndexPage.tsx apps/web/src/pages/ResearchIndexPage.test.tsx apps/web/src/App.tsx
git commit -m "feat(research): add research index company search"
```

---

### Task 6: Company page — kind filters, empty state, ingest button

**Files:**
- Modify: `apps/web/src/components/research/CompanyResearchPanel.tsx`
- Modify: `apps/web/src/components/research/CompanyResearchPanel.test.tsx`
- Create: `apps/web/src/components/research/ResearchIngestButton.tsx` (optional if kept inline)
- Modify: `apps/web/src/pages/ResearchCompanyPage.tsx`
- Create/modify tests for company page behavior

**Interfaces:**
- `?kinds=hiring_signal,sales_trigger` optional multi filter (client-side)
- Empty: show message + latest ingest snippet + Run ingest
- Ingest: `rawApiClient.POST('/api/research/ingest/run')` then refetch signals + latest

- [ ] **Step 1: Panel tests — kind filter**

```tsx
it("filters signals by selected kinds", () => {
  render(
    <MemoryRouter>
      <CompanyResearchPanel
        companyKey="pro-technic-machinery"
        signals={fixtureSignals}
        persona="hr"
        selectedKinds={["hiring_signal"]}
      />
    </MemoryRouter>,
  );
  const rows = screen.getAllByTestId("company-research-signal");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveAttribute("data-kind", "hiring_signal");
});
```

- [ ] **Step 2: Implement filter chips + ranking then filter**

```ts
// after rankSignalsForPersona:
const filtered = selectedKinds?.length
  ? ranked.filter((s) => selectedKinds.includes(s.kind))
  : ranked
```

Sync `selectedKinds` from `searchParams.get('kinds')?.split(',').filter(Boolean)`.

- [ ] **Step 3: Empty state + ingest control on page**

```tsx
// ResearchCompanyPage
const [latestRun, setLatestRun] = useState<...>(null)
const [ingesting, setIngesting] = useState(false)

async function loadLatest() {
  const { data } = await rawApiClient.GET('/api/research/ingest/latest')
  setLatestRun(data?.run ?? null)
}

async function runIngest() {
  setIngesting(true)
  try {
    await rawApiClient.POST('/api/research/ingest/run', { body: {} })
    // refetch signals + latest
  } finally {
    setIngesting(false)
  }
}
```

UI:

- `data-testid="research-run-ingest"` button
- Empty `data-testid="company-research-empty"` includes CTA when no signals
- Show `latestRun.status` / `finishedAt` / counters when present

- [ ] **Step 4: Tests pass; commit**

```bash
npm --workspace @trends/web run test -- src/components/research src/pages/ResearchCompanyPage
git add apps/web/src/components/research apps/web/src/pages/ResearchCompanyPage.tsx
git commit -m "feat(research): kind filters, empty state, and ingest button"
```

---

### Task 7: Resume / policy deep-link polish

**Files:**
- Modify: `apps/web/src/components/CompanyPolicyBadges.tsx`
- Modify: `apps/web/src/components/CompanyPolicyBadges.test.tsx`
- Verify: `apps/web/src/components/ResumeDetail.tsx` already mounts badges (no change if research link works)

**Interfaces:**
- Badge chip tooltip or small link → `companyResearchHref(companyKey)`
- Banner research link already exists; ensure badge variant exposes research navigation

- [ ] **Step 1: Extend test**

```ts
it("badge variant links to research page for company", () => {
  render(<CompanyPolicyBadges hits={[noHireHit]} />)
  const research = screen.getByTestId("company-policy-research-link");
  expect(research).toHaveAttribute(
    "href",
    "/hr/research/pro-technic-machinery?persona=hr",
  );
});
```

If badge variant currently has no research link, add one next to chip or inside tooltip content as `<a data-testid="company-policy-research-link">`.

- [ ] **Step 2: Implement minimal link; tests pass; commit**

```bash
npm --workspace @trends/web run test -- src/components/CompanyPolicyBadges.test.tsx
git add apps/web/src/components/CompanyPolicyBadges.tsx apps/web/src/components/CompanyPolicyBadges.test.tsx
git commit -m "feat(research): deep link from policy badges to research page"
```

---

### Task 8: Manual live smoke + verification notes

**Files:**
- Optional: short note under `docs/superpowers/research/` only if smoke findings need durability (skip if clean)

- [ ] **Step 1: Ensure stack**

```bash
./scripts/clean-dev.sh
./scripts/dev.sh --force
# wait for web :5173 api :3000 convex :3210
```

- [ ] **Step 2: Once-run ingest (live)**

```bash
# with CONVEX_URL + CONVEX_WRITE_SECRET set, force enable:
RESEARCH_INGEST_ENABLED=1 uv run python -c "from apps.worker.research_ingest import run_research_ingest; print(run_research_ingest())"
# or authenticated CLI if built:
# trends research ingest --once
```

Expected: True / success; Convex has new `news_items` and possibly signals if aliases hit.

- [ ] **Step 3: Desk checklist**

1. Open `http://localhost:5173/hr/research` — search 宝力 / pro-technic  
2. Open company page — persona toggle + kind filters  
3. Empty or populated empty-state / list; click Run ingest  
4. From policies or resume policy badge — research deep link  

- [ ] **Step 4: Capture smoke notes to scratch if in goal harness; otherwise stop**

Do **not** claim PR7; do **not** fabricate parity greens.

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| NewsNow thin hotlist adapter | 1–2 |
| RSS keep + soft-fail | 3 |
| Default env + `.env.example` | 3 |
| Scheduler flag already exists; docs | 3 |
| Soft-fail per source | 3 |
| latestIngestRun + BFF | 4 |
| Research index search | 5 |
| Kind filters | 6 |
| Empty state + ingest button | 6 |
| Resume/policy deep links | 7 |
| Live once-run smoke | 8 |
| No PR7 / no NewsAnalyzer | Global + all tasks |

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-research-eng-productional-thin-vertical-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans and checkpoints  

Which approach?
