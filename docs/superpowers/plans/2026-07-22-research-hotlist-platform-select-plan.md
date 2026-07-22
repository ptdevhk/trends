# Research Hotlist Platform Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace pick which NewsNow-compatible hotlist platforms Research Eng ingests next, via curated seed catalog + workspace overlay + desk 数据源 dialog.

**Architecture:** Load `config/research_hotlist_platforms.yaml`; merge with `workspace_config` key `research.hotlistPlatforms` via pure helpers; GET/PUT `/api/research/platforms`; on ingest, BFF resolves effective IDs and POSTs them to worker `/worker/research/ingest` so `ResearchIngestJob` uses that list (YAML platforms remain fallback when override absent). Hub dialog mirrors pulse-keywords settings pattern.

**Tech Stack:** TypeScript BFF (`apps/api`), Convex `workspace_config` via `workspaceConfigService`, Python worker (`apps/worker`), React hub (`apps/web`), YAML, vitest, pytest.

**Design spec:** `docs/superpowers/specs/2026-07-22-research-hotlist-platform-select-design.md`

## Global Constraints

- Platform IDs are **NewsNow-compatible** strings only (`weibo`, `zhihu`, `cls-hot`, …).
- v1 primary control is **ingest set**, not pulse view filter.
- Workspace-shared prefs (`research.hotlistPlatforms`), not per-user.
- Curated seed pack only — **no** live scrape of GitHub `server/sources` in product path.
- Exclude-all / empty effective → **fall back to seed.defaults** (never hard-empty ingest).
- `config/config.yaml` platforms remain **ops fallback** for CLI/scheduler when no override.
- Do **not** import TrendRadar `DataFetcher` / `NewsAnalyzer` on product path.
- RSS multi-select out of scope (RSS stays YAML).
- Prefer fixture tests; no live NewsNow required for unit tests.
- Local-only: no production deploy / origin push.
- Auth: same workspace user gate as other `/api/research/*` routes.
- Showcase honesty unchanged; test fixtures must not use `weibo.com/example/...`.

---

## File map

| Path | Role |
|------|------|
| `config/research_hotlist_platforms.yaml` | Curated catalog + defaults |
| `apps/api/src/services/research-hotlist-platforms-pack.ts` | Load/parse seed |
| `apps/api/src/services/research-hotlist-platforms.ts` | Pure merge + parse + constants |
| `apps/api/src/services/research-hotlist-platforms.test.ts` | Pure + pack tests |
| `apps/api/src/services/research-hotlist-platforms-service.ts` | I/O: workspace get/put |
| `apps/api/src/services/research-hotlist-platforms-service.test.ts` | Service tests (mock workspace config) |
| `apps/api/src/routes/research.ts` | GET/PUT platforms; ingest body with platforms |
| `apps/api/src/routes/research.test.ts` | Route tests |
| `apps/api/src/services/research-service.ts` | `triggerResearchIngest({ platforms? })` |
| `apps/worker/api.py` | Accept optional JSON `platforms` on ingest trigger |
| `apps/worker/research_ingest.py` | Honor `config_overrides["platforms"]` |
| `apps/worker/tests/test_research_ingest.py` | Override platforms tests |
| `apps/web/src/components/research/HotlistPlatformsDialog.tsx` | 数据源 multi-select dialog |
| `apps/web/src/pages/ResearchIndexPage.tsx` | Load/save platforms + dialog entry |
| `apps/web/src/pages/ResearchIndexPage.test.tsx` | Hub tests |
| `.env.example` | One-line note that workspace overlay drives ingest when set (optional) |

---

### Task 1: Seed pack + pure merge

**Files:**
- Create: `config/research_hotlist_platforms.yaml`
- Create: `apps/api/src/services/research-hotlist-platforms-pack.ts`
- Create: `apps/api/src/services/research-hotlist-platforms.ts`
- Create: `apps/api/src/services/research-hotlist-platforms.test.ts`

**Interfaces:**
- Produces:
  - `HOTLIST_PLATFORMS_CONFIG_KEY = "research.hotlistPlatforms"`
  - `HotlistPlatform = { id: string; name: string; expectedDomain?: string }`
  - `HotlistPlatformGroup = { id: string; label: string; platforms: HotlistPlatform[] }`
  - `HotlistPlatformsSeed = { version: string; groups: HotlistPlatformGroup[]; defaults: string[]; catalogIds: string[] }`
  - `HotlistPlatformsWorkspaceValue = { version: 1; enabled: string[]; excluded: string[] }`
  - `loadResearchHotlistPlatformsSeed(projectRoot?: string): HotlistPlatformsSeed`
  - `emptyHotlistPlatformsWorkspace(): HotlistPlatformsWorkspaceValue`
  - `parseHotlistPlatformsWorkspace(raw: unknown): HotlistPlatformsWorkspaceValue`
  - `mergeHotlistPlatforms(seed: HotlistPlatformsSeed, workspace: HotlistPlatformsWorkspaceValue): string[]`
  - `MAX_ENABLED_PLATFORMS = 40`, `MAX_PLATFORM_ID_LENGTH = 64`

- [ ] **Step 1: Write seed YAML** (from design spec)

```yaml
version: v1
groups:
  - id: general-cn
    label: 综合热榜
    platforms:
      - id: weibo
        name: 微博
        expectedDomain: weibo.com
      - id: zhihu
        name: 知乎
        expectedDomain: zhihu.com
      - id: baidu
        name: 百度热搜
        expectedDomain: baidu.com
      - id: toutiao
        name: 今日头条
        expectedDomain: toutiao.com
      - id: thepaper
        name: 澎湃新闻
      - id: ifeng
        name: 凤凰网
      - id: tieba
        name: 贴吧
  - id: finance-cn
    label: 财经
    platforms:
      - id: wallstreetcn-hot
        name: 华尔街见闻
        expectedDomain: wallstreetcn.com
      - id: cls-hot
        name: 财联社热门
  - id: video-cn
    label: 视频
    platforms:
      - id: douyin
        name: 抖音
      - id: bilibili-hot-search
        name: bilibili 热搜
        expectedDomain: bilibili.com
defaults:
  - weibo
  - zhihu
  - baidu
  - wallstreetcn-hot
  - cls-hot
  - thepaper
```

- [ ] **Step 2: Failing pure tests**

```typescript
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  emptyHotlistPlatformsWorkspace,
  loadResearchHotlistPlatformsSeed,
  mergeHotlistPlatforms,
  parseHotlistPlatformsWorkspace,
} from "./research-hotlist-platforms.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../");

it("loads seed with catalog + defaults", () => {
  const seed = loadResearchHotlistPlatformsSeed(REPO_ROOT);
  expect(seed.defaults).toContain("weibo");
  expect(seed.defaults).toContain("cls-hot");
  expect(seed.catalogIds).toContain("bilibili-hot-search");
  expect(seed.groups.length).toBeGreaterThanOrEqual(3);
});

it("merge: empty workspace → defaults", () => {
  const seed = loadResearchHotlistPlatformsSeed(REPO_ROOT);
  expect(mergeHotlistPlatforms(seed, emptyHotlistPlatformsWorkspace())).toEqual(seed.defaults);
});

it("merge: enabled subset; unknown dropped; excluded removed; exclude-all falls back", () => {
  const seed = loadResearchHotlistPlatformsSeed(REPO_ROOT);
  expect(
    mergeHotlistPlatforms(seed, {
      version: 1,
      enabled: ["weibo", "not-a-real-id", "cls-hot"],
      excluded: ["weibo"],
    }),
  ).toEqual(["cls-hot"]);

  const wiped = mergeHotlistPlatforms(seed, {
    version: 1,
    enabled: [],
    excluded: [...seed.defaults],
  });
  expect(wiped).toEqual(seed.defaults);
});

it("parseHotlistPlatformsWorkspace tolerates junk", () => {
  expect(parseHotlistPlatformsWorkspace(null)).toEqual(emptyHotlistPlatformsWorkspace());
  expect(parseHotlistPlatformsWorkspace({ enabled: [" weibo "], excluded: [1, "x"] }).enabled).toEqual([
    "weibo",
  ]);
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
bunx vitest run apps/api/src/services/research-hotlist-platforms.test.ts
```

Expected: FAIL — modules missing

- [ ] **Step 4: Implement pack loader + pure merge**

Mirror `research-pulse-keywords-pack.ts` / `research-pulse-keywords.ts`:

```typescript
// research-hotlist-platforms-pack.ts — parse YAML, build catalogIds in group order,
// validate defaults ⊆ catalog, throw on empty defaults

// research-hotlist-platforms.ts
export function mergeHotlistPlatforms(
  seed: HotlistPlatformsSeed,
  workspace: HotlistPlatformsWorkspaceValue,
): string[] {
  const catalog = new Set(seed.catalogIds);
  const base =
    workspace.enabled.length > 0
      ? workspace.enabled.filter((id) => catalog.has(id))
      : [...seed.defaults];
  // preserve catalog order
  const order = seed.catalogIds.filter((id) => base.includes(id));
  const excluded = new Set(workspace.excluded);
  const effective = order.filter((id) => !excluded.has(id));
  if (effective.length === 0) {
    return [...seed.defaults];
  }
  return effective;
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
bunx vitest run apps/api/src/services/research-hotlist-platforms.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add config/research_hotlist_platforms.yaml \
  apps/api/src/services/research-hotlist-platforms-pack.ts \
  apps/api/src/services/research-hotlist-platforms.ts \
  apps/api/src/services/research-hotlist-platforms.test.ts
git commit -m "feat(research): hotlist platform seed pack and pure merge"
```

---

### Task 2: Workspace get/put service

**Files:**
- Create: `apps/api/src/services/research-hotlist-platforms-service.ts`
- Create: `apps/api/src/services/research-hotlist-platforms-service.test.ts`

**Interfaces:**
- Consumes: pack + pure helpers from Task 1; `workspaceConfigService`
- Produces:
  - `HotlistPlatformsState = { seed; workspace; effective: string[] }`
  - `class HotlistPlatformsValidationError extends Error`
  - `getHotlistPlatformsState(workspaceSlug: string): Promise<HotlistPlatformsState>`
  - `putHotlistPlatforms(workspaceSlug, body: { enabled?: string[]; excluded?: string[] }): Promise<HotlistPlatformsState>`

- [ ] **Step 1: Failing service tests** (mock `workspaceConfigService` like pulse keywords service tests)

```typescript
it("get returns seed + empty workspace + defaults effective", async () => {
  // mock getWorkspaceConfigValue → undefined
  const state = await getHotlistPlatformsState("hr");
  expect(state.effective).toEqual(state.seed.defaults);
});

it("put rejects unknown platform id", async () => {
  await expect(
    putHotlistPlatforms("hr", { enabled: ["not-real"] }),
  ).rejects.toBeInstanceOf(HotlistPlatformsValidationError);
});

it("put persists and returns effective", async () => {
  // mock set + get
  const state = await putHotlistPlatforms("hr", {
    enabled: ["weibo", "cls-hot"],
    excluded: [],
  });
  expect(state.effective).toEqual(["weibo", "cls-hot"]);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
bunx vitest run apps/api/src/services/research-hotlist-platforms-service.test.ts
```

- [ ] **Step 3: Implement service**

Pattern from `research-pulse-service.ts` `getPulseKeywordsState` / `putPulseKeywords`:

- Config key: `HOTLIST_PLATFORMS_CONFIG_KEY`
- On put: sanitize string arrays; every non-empty id must be in `seed.catalogIds`; max list length `MAX_ENABLED_PLATFORMS`; max id length `MAX_PLATFORM_ID_LENGTH`
- Store `{ version: 1, enabled, excluded }`

- [ ] **Step 4: Run — expect PASS**

```bash
bunx vitest run apps/api/src/services/research-hotlist-platforms-service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/research-hotlist-platforms-service.ts \
  apps/api/src/services/research-hotlist-platforms-service.test.ts
git commit -m "feat(research): hotlist platforms workspace get/put service"
```

---

### Task 3: API routes GET/PUT `/api/research/platforms`

**Files:**
- Modify: `apps/api/src/routes/research.ts`
- Modify: `apps/api/src/routes/research.test.ts`

**Interfaces:**
- Consumes: `getHotlistPlatformsState`, `putHotlistPlatforms`, `HotlistPlatformsValidationError`
- Produces: OpenAPI routes under existing research auth middleware

- [ ] **Step 1: Failing route tests**

```typescript
it("GET /api/research/platforms returns seed + effective", async () => {
  const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
  const app = createApp();
  const response = await app.request("/api/research/platforms", { headers: auth.headers });
  expect(response.status).toBe(200);
  const body = await parseJsonBody(response);
  expect(body.success).toBe(true);
  expect(body.effective).toContain("weibo");
  expect(body.seed.groups.length).toBeGreaterThan(0);
});

it("PUT /api/research/platforms upserts overlay", async () => {
  // mock workspace config set if needed; or use in-memory storage from existing test helpers
  const response = await app.request("/api/research/platforms", {
    method: "PUT",
    headers: { ...auth.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: ["weibo", "cls-hot"], excluded: [] }),
  });
  expect(response.status).toBe(200);
  const body = await parseJsonBody(response);
  expect(body.effective).toEqual(["weibo", "cls-hot"]);
});

it("PUT returns 400 on unknown id", async () => {
  const response = await app.request("/api/research/platforms", {
    method: "PUT",
    headers: { ...auth.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: ["nope"] }),
  });
  expect(response.status).toBe(400);
});
```

- [ ] **Step 2: Run route tests — expect FAIL**

```bash
bunx vitest run apps/api/src/routes/research.test.ts
```

- [ ] **Step 3: Add OpenAPI routes** (after pulse keywords routes; same slug helper)

```typescript
// GET /api/research/platforms → { success, seed, workspace, effective }
// PUT /api/research/platforms body { enabled?, excluded? }
// 400 on HotlistPlatformsValidationError
```

Zod seed shape: groups with platforms `{ id, name, expectedDomain? }`, defaults string array.

- [ ] **Step 4: Run — expect PASS**

```bash
bunx vitest run apps/api/src/routes/research.test.ts
npm --workspace @trends/api run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/research.ts apps/api/src/routes/research.test.ts
git commit -m "feat(research): GET/PUT /api/research/platforms"
```

---

### Task 4: Worker honors platforms override

**Files:**
- Modify: `apps/worker/research_ingest.py`
- Modify: `apps/worker/api.py`
- Modify: `apps/worker/tests/test_research_ingest.py`
- Create or modify: `apps/worker/tests/test_api_research_ingest.py` (if API body tests live separately; otherwise extend existing worker API tests)

**Interfaces:**
- Consumes: existing `ResearchIngestJob(platforms=...)`
- Produces:
  - `run_research_ingest(config_overrides)` applies `platforms` list when present
  - `POST /worker/research/ingest` optional JSON `{ "platforms": string[] }`

- [ ] **Step 1: Failing tests**

```python
def test_run_honors_platforms_override_in_config():
    port = StaticHotlistPort(items_by_platform={
        "weibo": [{"title": "w", "url": "https://weibo.com/1"}],
        "zhihu": [{"title": "z", "url": "https://zhihu.com/1"}],
    })
    client = FakeConvexClient()  # use existing test double from file
    job = ResearchIngestJob(client=client, hotlist_port=port, platforms=["weibo", "zhihu"], rss_feeds=[])
    assert job.run(config_overrides={"platforms": ["weibo"]}) is True
    # assert only weibo fetched — StaticHotlistPort can record calls, or assert news titles
```

Also:

```python
def test_run_research_ingest_builds_job_with_override_platforms(monkeypatch):
    seen = {}
    class CaptureJob:
        def __init__(self, **kwargs):
            seen["platforms"] = kwargs.get("platforms")
        def run(self, config_overrides=None):
            return True
    monkeypatch.setenv("RESEARCH_INGEST_ENABLED", "1")
    monkeypatch.setattr("apps.worker.research_ingest.ResearchIngestJob", CaptureJob)
    # after implementation: run_research_ingest({"platforms": ["cls-hot"]})
    # expect CaptureJob constructed with platforms=["cls-hot"]
```

For HTTP:

```python
# If FastAPI TestClient available:
# POST /worker/research/ingest json={"platforms":["weibo"]} must call run with override
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/worker && python -m pytest tests/test_research_ingest.py -q
```

- [ ] **Step 3: Implement override wiring**

In `research_ingest.py`:

```python
def run_research_ingest(config_overrides: Optional[Dict[str, Any]] = None) -> bool:
    if not research_ingest_enabled():
        logger.info("[ResearchIngest] skipped — RESEARCH_INGEST_ENABLED not set")
        return True
    overrides = config_overrides or {}
    platforms = overrides.get("platforms")
    platforms_arg = None
    if isinstance(platforms, (list, tuple)):
        platforms_arg = [str(p).strip() for p in platforms if str(p).strip()]
    job = ResearchIngestJob(
        platforms=platforms_arg if platforms_arg is not None else None,
    )
    # When platforms_arg is empty list, pass [] (ingest zero hotlist platforms) vs None (yaml).
    # Spec: empty effective never sent from BFF (fallback defaults). Worker: None → yaml; list → use list.
    return job.run(config_overrides=overrides)
```

Adjust constructor call carefully:

```python
kwargs = {}
if "platforms" in overrides and isinstance(overrides["platforms"], (list, tuple)):
    kwargs["platforms"] = [str(p).strip() for p in overrides["platforms"] if str(p).strip()]
job = ResearchIngestJob(**kwargs)
```

In `ResearchIngestJob.run`, stop ignoring overrides for platforms if constructor already applied them (constructor is enough).

In `apps/worker/api.py`:

```python
from pydantic import BaseModel, Field
from typing import List, Optional

class ResearchIngestRequest(BaseModel):
    platforms: Optional[List[str]] = None

@router.post("/worker/research/ingest", ...)
async def trigger_research_ingest(body: ResearchIngestRequest = ResearchIngestRequest()):
    ...
    overrides = {}
    if body.platforms is not None:
        overrides["platforms"] = body.platforms
    success = await asyncio.to_thread(run_research_ingest, overrides or None)
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd apps/worker && python -m pytest tests/test_research_ingest.py -q
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/research_ingest.py apps/worker/api.py apps/worker/tests/test_research_ingest.py
git commit -m "feat(research): worker ingest accepts platforms override"
```

---

### Task 5: BFF ingest proxy passes workspace effective platforms

**Files:**
- Modify: `apps/api/src/services/research-service.ts`
- Modify: `apps/api/src/routes/research.ts` (ingest handler)
- Modify: `apps/api/src/routes/research.test.ts`

**Interfaces:**
- Consumes: `getHotlistPlatformsState` (or export `getEffectiveHotlistPlatforms(workspaceSlug)`)
- Produces: `triggerResearchIngest(opts?: { platforms?: string[] })` POSTs JSON body to worker

- [ ] **Step 1: Failing test**

```typescript
it("POST /api/research/ingest/run sends effective platforms to worker", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/worker/research/ingest")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      expect(Array.isArray(body.platforms)).toBe(true);
      expect(body.platforms.length).toBeGreaterThan(0);
      return new Response(JSON.stringify({ success: true, mode: "research-ingest", message: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return convexSuccess(null);
  });
  const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
  const app = createApp();
  const response = await app.request("/api/research/ingest/run", {
    method: "POST",
    headers: auth.headers,
  });
  expect(response.status).toBe(200);
  expect(fetchSpy).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — expect FAIL** (body empty today)

```bash
bunx vitest run apps/api/src/routes/research.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// research-service.ts
export async function triggerResearchIngest(opts?: {
  platforms?: string[];
}): Promise<...> {
  const response = await fetch(`${workerUrl}/worker/research/ingest`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      opts?.platforms != null ? { platforms: opts.platforms } : {},
    ),
  });
  ...
}

// research.ts ingest handler
app.openapi(ingestRunRoute, async (c) => {
  const workspaceSlug = resolveResearchWorkspaceSlug(c);
  const { effective } = await getHotlistPlatformsState(workspaceSlug);
  const result = await triggerResearchIngest({ platforms: effective });
  return c.json(result, 200);
});
```

Optional response field `platforms: string[]` for desk feedback — include if cheap:

```json
{ "success": true, "mode": "research-ingest", "message": "...", "platforms": ["weibo", "..."] }
```

Update OpenAPI schema if added.

- [ ] **Step 4: Run — expect PASS**

```bash
bunx vitest run apps/api/src/routes/research.test.ts
npm --workspace @trends/api run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/research-service.ts apps/api/src/routes/research.ts apps/api/src/routes/research.test.ts
git commit -m "feat(research): ingest/run proxies workspace platform set"
```

---

### Task 6: Hub 数据源 dialog + wire

**Files:**
- Create: `apps/web/src/components/research/HotlistPlatformsDialog.tsx`
- Modify: `apps/web/src/pages/ResearchIndexPage.tsx`
- Modify: `apps/web/src/pages/ResearchIndexPage.test.tsx`

**Interfaces:**
- Consumes: `GET/PUT /api/research/platforms`, existing `POST /api/research/ingest/run`
- Produces: dialog props similar to `PulseKeywordsDialog`

- [ ] **Step 1: Failing hub tests**

```typescript
it('opens 数据源 dialog and saves platform selection', async () => {
  // mock GET /api/research/platforms with seed groups + effective defaults
  // mock PUT
  render(<MemoryRouter><ResearchIndexPage /></MemoryRouter>)
  await waitFor(() => expect(screen.getByTestId('research-platforms-open')).toBeInTheDocument())
  fireEvent.click(screen.getByTestId('research-platforms-open'))
  await waitFor(() => expect(screen.getByTestId('research-platforms-dialog')).toBeInTheDocument())
  // uncheck one default / check video platform
  fireEvent.click(screen.getByTestId('research-platform-toggle-douyin'))
  fireEvent.click(screen.getByTestId('research-platforms-save'))
  await waitFor(() => {
    expect(putMock).toHaveBeenCalledWith(
      '/api/research/platforms',
      expect.objectContaining({ body: expect.objectContaining({ enabled: expect.any(Array) }) }),
    )
  })
})

it('shows effective platform count summary when loaded', async () => {
  await waitFor(() => expect(screen.getByTestId('research-platforms-summary')).toBeInTheDocument())
  expect(screen.getByTestId('research-platforms-summary')).toHaveTextContent(/数据源/)
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm --workspace @trends/web run test -- src/pages/ResearchIndexPage.test.tsx
```

- [ ] **Step 3: Implement dialog + hub**

`HotlistPlatformsDialog.tsx`:

- Props: `open`, `onOpenChange`, `initial: { seed, workspace, effective } | null`, `saving`, `onSave({ enabled, excluded })`
- UI: group headings + checkbox per platform id
- Local draft: checked set derived from effective on open
- On save: `enabled = checked ids in catalog order`; `excluded = []` **or** encode unchecked defaults as excluded if starting from defaults-only mode  
  **Locked UI rule (simple):** always save `enabled = currently checked catalog ids` (must be non-empty; if user unchecks all, disable Save and show “至少选择一个平台”). Do **not** rely on exclude-all fallback for the dialog path.

`ResearchIndexPage.tsx`:

- Load platforms state next to keywords load
- Button `data-testid="research-platforms-open"` label **数据源**
- Summary chip `data-testid="research-platforms-summary"` e.g. `数据源 6`
- Existing **运行抓取** already hits ingest/run — after Task 5 it uses effective set automatically

- [ ] **Step 4: Run — expect PASS**

```bash
npm --workspace @trends/web run test -- src/pages/ResearchIndexPage.test.tsx
npm --workspace @trends/web run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/research/HotlistPlatformsDialog.tsx \
  apps/web/src/pages/ResearchIndexPage.tsx \
  apps/web/src/pages/ResearchIndexPage.test.tsx
git commit -m "feat(research): hub 数据源 dialog for hotlist platforms"
```

---

### Task 7: Docs touch + smoke checklist

**Files:**
- Modify: `.env.example` (one comment line near `RESEARCH_HOTLIST_API_URL` if present)
- Optional: short note in `docs/agent-runbook.md` under research (only if file already documents research ingest)

- [ ] **Step 1: Document operator path**

```bash
# .env.example near hotlist URL:
# Workspace desk "数据源" stores research.hotlistPlatforms; POST /api/research/ingest/run
# sends effective platform IDs to the worker. Without overlay, worker uses config/config.yaml.
```

- [ ] **Step 2: Manual smoke (local, optional for agent)**

1. Login as `hr-demo`, open `/hr/research`  
2. Open 数据源 → enable `weibo` + `cls-hot` only → Save  
3. GET `/api/research/platforms` → effective matches  
4. POST ingest/run (or UI button) → worker logs only those platforms  
5. Confirm no `weibo.com/example` URLs in live pulse  

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(research): note workspace hotlist platform overlay for ingest"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Curated seed pack YAML | Task 1 |
| Pure merge + empty fallback | Task 1 |
| Workspace key `research.hotlistPlatforms` | Task 2 |
| GET/PUT `/api/research/platforms` | Task 3 |
| Ingest uses effective IDs | Tasks 4–5 |
| Desk 数据源 dialog | Task 6 |
| NewsNow ID contract / no bulk TrendRadar | Global constraints + Task 1 catalog |
| RSS out of scope | Global constraints |
| Tests without live NewsNow | All tasks use fixtures |
| Showcase honesty | Global constraints; no change required |

**Placeholder scan:** none intentional.  
**Type consistency:** `HotlistPlatformsWorkspaceValue`, `effective: string[]`, config key `research.hotlistPlatforms` used throughout.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-research-hotlist-platform-select-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session, batch with checkpoints  

Which approach?
