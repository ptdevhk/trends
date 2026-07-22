# Research Crawler + Industry-Data + Resume Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the real-source loop: timer crawl writes only real intel into Convex, product UI never treats demo-seed as live, unresolved titles feed the existing industry steward queue, and resume/policy deep-links read research by shared `companyKey`.

**Architecture:** Phase A tightens shared live classification + optional Convex purge of `demo-*` signals. Phase B records research unresolved samples into `output/industry-data/unresolved-queue.json`. Phase C hardens resume/policy research deep-links and an optional DB-read signal strip. UI always reads API/DB; worker remains sole product writer.

**Tech Stack:** TypeScript shared + BFF, React web, Python worker, Convex mutations, vitest, pytest.

**Design spec:** `docs/superpowers/specs/2026-07-22-research-crawler-industry-resume-loop-design.md`

## Global Constraints

- Sequence **A → B → C**.
- Product DB for research = **Convex only** (`news_items`, `research_signals`).
- UI **always reads DB** — never scrape on page open.
- Steal crawler **patterns** only — **no** bulk merge of `trendradar/crawler`.
- No auto-write of resume scores / HR status / company policy from news.
- Live definition (all must hold):  
  - `evidence.platform` ∉ {`showcase`, `rss:demo`}  
  - `ingestRunId` not `demo-seed`, not prefix `demo-`, not prefix `showcase-seed`  
  - if URL present: host not `example.com`, not `*.local`
- Showcase seed (`showcase-seed-v1`) may remain labeled 展示数据.
- Unresolved queue reuses **existing** industry store path (not a second product).
- Prefer fixtures; no live NewsNow required for CI.
- Local-only: no production deploy / origin push.

---

## File map

| Path | Role |
|------|------|
| `packages/shared/src/research/live-signal.ts` | Expand live / synthetic rules |
| `packages/shared/src/research/live-signal.test.ts` | Pure tests |
| `apps/api/src/services/research-service.ts` | listCompanySignals uses tightened live helper |
| `apps/api/src/routes/research.ts` | Optional purge route |
| `apps/api/src/routes/research.test.ts` | Live meta + purge tests |
| `packages/convex/convex/research_signals.ts` | Global delete-by-ingest-prefix if missing |
| `apps/api/src/services/research-demo-purge-service.ts` | Purge demo-seed signals |
| `apps/worker/research_ingest.py` | Append unresolved events (thin) |
| `apps/worker/research_unresolved.py` | Map ingest misses → UnresolvedEvent-shaped JSON |
| `apps/worker/tests/test_research_unresolved.py` | Queue append tests |
| `apps/web/src/components/CompanyPolicyBadges.tsx` | Already links research — verify/harden |
| `apps/web/src/components/research/CompanyResearchStrip.tsx` | Optional thin strip (Phase C) |
| Resume/detail or employer surface | Mount strip + tests |
| `.env.example` | Note purge / queue paths if needed |

---

### Task 1: Tighten product-live definition (Phase A)

**Files:**
- Modify: `packages/shared/src/research/live-signal.ts`
- Modify: `packages/shared/src/research/live-signal.test.ts`
- Rebuild: `packages/shared` (`npm --workspace @trends/shared run build`)

**Interfaces:**
- Produces (updated):
  - `isLiveResearchSignal(signal: { evidence?: { platform?: string; url?: string }; ingestRunId?: string | null }): boolean`
  - `isSyntheticResearchSignal(...)` optional helper for tests
  - `partitionAndRankSignalsForPersona` unchanged signature; uses new live predicate

- [ ] **Step 1: Extend failing tests**

```typescript
it("rejects demo-seed and rss:demo and example.com as not live", () => {
  expect(
    isLiveResearchSignal({
      evidence: { platform: "rss:demo", url: "https://example.com/news/1" },
      ingestRunId: "demo-seed",
    }),
  ).toBe(false);
  expect(
    isLiveResearchSignal({
      evidence: { platform: "weibo", url: "https://example.com/x" },
      ingestRunId: "research-abc",
    }),
  ).toBe(false);
  expect(
    isLiveResearchSignal({
      evidence: { platform: "weibo", url: "https://weibo.com/real/1" },
      ingestRunId: "research-abc",
    }),
  ).toBe(true);
  expect(
    isLiveResearchSignal({
      evidence: { platform: "weibo" },
      ingestRunId: "demo-other",
    }),
  ).toBe(false);
});
```

- [ ] **Step 2: Run — expect FAIL** (demo-seed currently treated live)

```bash
bunx vitest run packages/shared/src/research/live-signal.test.ts
```

- [ ] **Step 3: Implement**

```typescript
const SYNTHETIC_PLATFORMS = new Set(["showcase", "rss:demo"]);

function isSyntheticHost(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "example.com" || host.endsWith(".example.com")) return true;
    if (host === "localhost" || host.endsWith(".local")) return true;
    return false;
  } catch {
    return true; // unparseable URL is not product-live evidence
  }
}

export function isLiveResearchSignal(signal: {
  evidence?: { platform?: string; url?: string };
  ingestRunId?: string | null;
}): boolean {
  const platform = (signal.evidence?.platform ?? "").trim();
  if (SYNTHETIC_PLATFORMS.has(platform)) return false;
  const runId = signal.ingestRunId ?? "";
  if (typeof runId === "string") {
    if (runId === "demo-seed" || runId.startsWith("demo-")) return false;
    if (runId.startsWith("showcase-seed")) return false;
  }
  if (isSyntheticHost(signal.evidence?.url)) return false;
  return true;
}
```

**Partition behavior for non-live:** keep non-live in `showcase` bucket for ranking purposes **or** split showcase-seed vs other synthetic:

Locked for this plan: non-live that is `showcase` / `showcase-seed*` → showcase section; other non-live (demo-seed) → **omit from both product sections** (do not show as 原文).

Update `partitionAndRankSignalsForPersona`:

```typescript
for (const s of signals) {
  if (isLiveResearchSignal(s)) live.push(s);
  else if (isShowcaseCurated(s)) showcase.push(s);
  // else drop from product items
}
```

```typescript
function isShowcaseCurated(s: LiveSignalLike): boolean {
  const p = s.evidence?.platform ?? "";
  const run = s.ingestRunId ?? "";
  return p === "showcase" || (typeof run === "string" && run.startsWith("showcase-seed"));
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
bunx vitest run packages/shared/src/research/live-signal.test.ts
npm --workspace @trends/shared run build
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/research/live-signal.ts packages/shared/src/research/live-signal.test.ts
git commit -m "fix(research): exclude demo-seed and synthetic hosts from product-live"
```

---

### Task 2: API regression for demo-seed exclusion (Phase A)

**Files:**
- Modify: `apps/api/src/routes/research.test.ts` (mixed live + demo + showcase case)
- Touch `research-service.ts` only if rebuild of shared is required (logic already in shared)

- [ ] **Step 1: Add route test**

```typescript
it("excludes demo-seed from live and omits from product items when only synthetic", async () => {
  // mock Convex listByCompany with:
  // 1) demo-seed hiring example.com
  // 2) showcase-seed hiring
  // 3) real weibo hiring https://weibo.com/x
  // expect meta.liveCount === 1
  // expect meta.showcaseCount === 1
  // expect items length === 2
  // expect no example.com in live items
});
```

- [ ] **Step 2: Run**

```bash
bunx vitest run apps/api/src/routes/research.test.ts
npm --workspace @trends/api run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/research.test.ts
git commit -m "test(research): API omits demo-seed from product-live signals"
```

---

### Task 3: Purge demo-seed signals (Phase A ops)

**Files:**
- Modify: `packages/convex/convex/research_signals.ts` — add global prefix delete
- Create: `apps/api/src/services/research-demo-purge-service.ts`
- Modify: `apps/api/src/routes/research.ts` — `POST /api/research/signals/purge-demo`
- Modify: `apps/api/src/routes/research.test.ts`

**Interfaces:**
- Produces:
  - Convex `research_signals:deleteByIngestRunPrefix` args `{ writeSecret?, ingestRunIdPrefix: string }` → `{ deleted: number }`
  - `purgeDemoResearchSignals(): Promise<{ deleted: number }>` calls prefix `demo-` and exact handling via prefix `demo` carefully — **use prefix `demo-`** so `demo-seed` matches; also delete exact if needed with second call prefix `demo-seed` only if not covered (`demo-seed`.startsWith(`demo-`) is true)

- [ ] **Step 1: Convex mutation**

```typescript
export const deleteByIngestRunPrefix = mutation({
  args: {
    writeSecret: v.optional(v.string()),
    ingestRunIdPrefix: v.string(),
  },
  handler: async (ctx, args) => {
    requireWriteSecret(args.writeSecret);
    const prefix = args.ingestRunIdPrefix;
    // Scan research_signals — use by_company or full table if index allows.
    // Prefer collect with pagination if table large; for ops purge, take limited batches.
    const rows = await ctx.db.query("research_signals").collect();
    let deleted = 0;
    for (const row of rows) {
      if (typeof row.ingestRunId === "string" && row.ingestRunId.startsWith(prefix)) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return { deleted };
  },
});
```

If full `collect()` is too heavy, document batch ops later; for local/dev volume it is OK.

- [ ] **Step 2: Service + route**

```typescript
// research-demo-purge-service.ts
export async function purgeDemoResearchSignals(): Promise<{ deleted: number }> {
  const value = await callConvexMutation("research_signals:deleteByIngestRunPrefix", {
    writeSecret: config.auth.convexWriteSecret,
    ingestRunIdPrefix: "demo-",
  });
  // parse deleted
}
```

```typescript
// POST /api/research/signals/purge-demo — requireWorkspaceUser (admin optional if role available; default same as other research ops)
// returns { success: true, deleted }
```

- [ ] **Step 3: Tests mock Convex mutation**

```typescript
it("POST purge-demo calls deleteByIngestRunPrefix with demo-", async () => {
  // mock fetch convex mutation path
  // expect 200 { deleted: N }
});
```

- [ ] **Step 4: Run**

```bash
bunx vitest run apps/api/src/routes/research.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/convex/convex/research_signals.ts \
  apps/api/src/services/research-demo-purge-service.ts \
  apps/api/src/routes/research.ts \
  apps/api/src/routes/research.test.ts
git commit -m "feat(research): purge demo-seed signals ops path"
```

---

### Task 4: Soft domain check on hotlist URLs (Phase A optional harden)

**Files:**
- Modify: `apps/worker/research_ports.py`
- Modify: `apps/worker/tests/test_research_ports.py` (or create if missing)

**Interfaces:**
- Produces: `url_matches_expected_domain(url: str, expected_domain: str | None) -> bool`
- In `parse_newsnow_payload` optional `expected_domain` param: drop items whose url host does not end with expected domain when domain set; if no url, keep

- [ ] **Step 1: Tests**

```python
def test_domain_safety_drops_mismatch():
    payload = {
        "status": "success",
        "items": [
            {"title": "ok", "url": "https://www.weibo.com/x"},
            {"title": "bad", "url": "https://evil.example/x"},
        ],
    }
    items = parse_newsnow_payload("weibo", payload, 1, expected_domain="weibo.com")
    assert len(items) == 1
    assert "weibo.com" in (items[0].url or "")
```

- [ ] **Step 2: Implement pure helper + wire** when platform config carries domain (ingest may load domains from seed later — for v1 pass `None` from job unless easy map from seed yaml).

Minimal: implement helper + unit tests; wire optional arg on parse; job can pass None until seed load exists.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/research_ports.py apps/worker/tests/test_research_ports.py
git commit -m "feat(research): optional expected_domain filter on hotlist items"
```

---

### Task 5: Research unresolved → industry queue (Phase B)

**Files:**
- Create: `apps/worker/research_unresolved.py`
- Modify: `apps/worker/research_ingest.py` (after project_signals_for_items)
- Create: `apps/worker/tests/test_research_unresolved.py`
- Optionally thin bridge to call Node store is **not** required — write JSON compatible with `UnresolvedEvent` shape from pure Python

**Interfaces:**
- Produces:
  - `UnresolvedResearchSample = { surface, title, platform, url?, captured_at, reason: "research_miss" }`
  - `samples_from_unresolved_items(items, unresolved_count logic)` — better: during `project_signals_for_items` return titles that had candidates but no drafts
  - `append_research_unresolved_to_queue(project_root, samples, *, max_per_run=20) -> int appended`

Locked storage: `output/industry-data/unresolved-queue.json` matching:

```json
{
  "version": 1,
  "updatedAt": "...",
  "events": [
    {
      "surface": "某未知品牌",
      "normalizedKey": "...",
      "reason": "miss",
      "at": "ISO-8601"
    }
  ]
}
```

Map research sample → `UnresolvedEvent` with `reason: "miss"` and put title in `surface` or first extracted alias.

- [ ] **Step 1: Failing test**

```python
def test_append_research_unresolved_writes_queue(tmp_path):
    samples = [{"surface": "未知机床厂", "title": "未知机床厂扩产", "platform": "weibo"}]
    n = append_research_unresolved_to_queue(tmp_path, samples)
    assert n == 1
    path = tmp_path / "output" / "industry-data" / "unresolved-queue.json"
    assert path.is_file()
    data = json.loads(path.read_text())
    assert data["events"][0]["surface"] == "未知机床厂"
```

- [ ] **Step 2: Implement append** (merge existing file if present)

- [ ] **Step 3: Wire ingest** after unresolved count: extract up to 20 candidate surfaces from items that produced zero drafts but `extract_candidate_aliases` non-empty

- [ ] **Step 4: Run**

```bash
python -m pytest apps/worker/tests/test_research_unresolved.py apps/worker/tests/test_research_ingest.py -q
```

- [ ] **Step 5: Commit**

```bash
git add apps/worker/research_unresolved.py apps/worker/research_ingest.py apps/worker/tests/test_research_unresolved.py
git commit -m "feat(research): append unresolved crawl titles to industry queue"
```

---

### Task 6: Resume/policy research deep-link consistency (Phase C)

**Files:**
- Modify: `apps/web/src/components/CompanyPolicyBadges.tsx` (verify `?persona=hr`)
- Grep for other research links missing persona
- Create/modify tests for badges

- [ ] **Step 1: Inventory**

```bash
rg -n "research/\$\{|/research/" apps/web/src --glob '*.tsx'
```

Ensure every product link includes `?persona=hr` (or active persona).

- [ ] **Step 2: Tests**

```typescript
it('company policy badge links to research with persona=hr', () => {
  // render badge with companyKey
  expect(link).toHaveAttribute('href', expect.stringContaining('/research/'))
  expect(link.getAttribute('href')).toMatch(/persona=hr/)
})
```

- [ ] **Step 3: Fix any missing persona query**

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/CompanyPolicyBadges.tsx apps/web/src/components/CompanyPolicyBadges.test.tsx
git commit -m "fix(research): policy badges always deep-link with persona=hr"
```

---

### Task 7: Optional research strip on resume context (Phase C)

**Files:**
- Create: `apps/web/src/components/research/CompanyResearchStrip.tsx`
- Create: `apps/web/src/components/research/CompanyResearchStrip.test.tsx`
- Mount on one existing surface that already has `companyKey` (e.g. near `CompanyPolicyBadges` on resume detail — only if a single clear mount point exists without large refactor)

**Interfaces:**
- Props: `{ companyKey: string; teamSlug: string }`
- Fetches `GET /api/research/companies/:key/signals?persona=hr&limit=5`
- Renders: link “企业研究” + `liveCount` if meta present + first live title; soft-empty if none
- **No** ingest on mount

- [ ] **Step 1: Component tests with mocked API**

```typescript
it('shows live count and link', async () => { ... })
it('soft empty when no signals', async () => { ... })
```

- [ ] **Step 2: Mount at one site** (prefer resume detail company block — search `CompanyPolicyBadges` usage)

- [ ] **Step 3: Typecheck + test**

```bash
npm --workspace @trends/web run test -- src/components/research/CompanyResearchStrip.test.tsx
npm --workspace @trends/web run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/research/CompanyResearchStrip.tsx \
  apps/web/src/components/research/CompanyResearchStrip.test.tsx \
  <mount file>
git commit -m "feat(research): resume-adjacent research strip reads signals from DB"
```

If mount point is unclear, **ship strip unmounted** behind export + test only, and note mount in follow-up — but prefer one real mount.

---

### Task 8: Docs + full regression

**Files:**
- Modify: `.env.example` — one line on purge endpoint and live rules if useful
- Optional: `docs/agent-runbook.md` research section

- [ ] **Step 1: Run suite**

```bash
bunx vitest run packages/shared/src/research/live-signal.test.ts apps/api/src/routes/research.test.ts
python -m pytest apps/worker/tests/test_research_ports.py apps/worker/tests/test_research_unresolved.py apps/worker/tests/test_research_ingest.py -q
npm --workspace @trends/web run test -- src/components/research/CompanyResearchStrip.test.tsx src/components/research/CompanyResearchPanel.test.tsx
npm --workspace @trends/api run typecheck
npm --workspace @trends/web run typecheck
npm --workspace @trends/shared run build
```

- [ ] **Step 2: Manual smoke**

1. `POST /api/research/signals/purge-demo` (auth)  
2. Open `/hr/research/pro-technic-machinery?persona=hr` — no `example.com` in 实时信号  
3. `POST /api/research/ingest/run` — real platforms only  
4. Resume policy badge → research with persona=hr  

- [ ] **Step 3: Commit docs if changed**

```bash
git add .env.example
git commit -m "docs(research): real-source loop ops notes"
```

---

## Self-review (plan vs spec)

| Spec item | Task |
|-----------|------|
| A1 Live filter demo/synthetic | 1–2 |
| A2 Purge demo- | 3 |
| A3 Domain safety soft | 4 |
| A4 Ports stay NewsNow | Global + 4 |
| B3 Unresolved → industry queue | 5 |
| B1 Resolve spine (document/existing) | 5 uses existing bridge |
| C1 Deep-link persona=hr | 6 |
| C2 Optional strip | 7 |
| C3 No resume write | Global + 7 |
| No bulk crawler merge | Global |

**Placeholder scan:** none intentional.  
**Type consistency:** live definition shared; purge prefix `demo-`; queue path `output/industry-data/unresolved-queue.json`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-research-crawler-industry-resume-loop-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with checkpoints  

Which approach?
