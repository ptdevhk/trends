# Research Pulse Keywords Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 市场动态 keyword-steered: CNC/zh-Hans seed pack + workspace overlay prefs + read-path news filter, with hub chips and 管理关键词 UI.

**Architecture:** Load `config/research_pulse_keywords.yaml`; merge with `workspace_config` key `research.pulseKeywords` via pure helpers; filter `listResearchNews` results for `GET /api/research/pulse` and hub showcase pulse; GET/PUT keywords for desk settings. Ingest gate is **not** implemented in v1 (document flag only).

**Tech Stack:** TypeScript BFF (`apps/api`), Convex `workspace_config` via `workspaceConfigService`, React hub (`apps/web`), YAML, vitest.

**Design spec:** `docs/superpowers/specs/2026-07-22-research-pulse-keywords-design.md`

## Global Constraints

- v1 = **read-path filter only**; do **not** implement worker ingest filter (only document `RESEARCH_PULSE_INGEST_FILTER` as later).
- Workspace-shared prefs (`research.pulseKeywords`), not per-user.
- Match = **simple substring** (Latin case-insensitive); no full frequency_words regex engine.
- Exclude-all → **fall back to seed defaults** (never hard-empty effective list).
- Showcase honesty: platform `showcase` labels and golden **展示数据** unchanged.
- Prefer fixture tests; no live NewsNow required.
- Local-only: no production deploy / origin push.
- Auth: same workspace user gate as other `/api/research/*` routes.

---

## File map

| Path | Role |
|------|------|
| `config/research_pulse_keywords.yaml` | Seed CNC keyword groups |
| `apps/api/src/services/research-pulse-keywords-pack.ts` | Load/parse seed |
| `apps/api/src/services/research-pulse-keywords.ts` | Pure merge + filter + normalize |
| `apps/api/src/services/research-pulse-keywords.test.ts` | Pure + pack tests |
| `apps/api/src/services/research-pulse-service.ts` | I/O: workspace get/put + filtered pulse |
| `apps/api/src/routes/research.ts` | GET/PUT keywords, GET pulse |
| `apps/api/src/routes/research.test.ts` | Route tests |
| `apps/api/src/services/research-showcase-service.ts` | Hub pulse uses shared filter helper |
| `apps/web/src/pages/ResearchIndexPage.tsx` | Chips, soft empty, dialog, pulse load |
| `apps/web/src/pages/ResearchIndexPage.test.tsx` | Hub tests |
| `apps/web/src/components/research/PulseKeywordsDialog.tsx` | Optional extract for 管理关键词 |
| `.env.example` | Note deferred `RESEARCH_PULSE_INGEST_FILTER` (one line) |

---

### Task 1: Seed pack + pure merge/filter

**Files:**
- Create: `config/research_pulse_keywords.yaml`
- Create: `apps/api/src/services/research-pulse-keywords-pack.ts`
- Create: `apps/api/src/services/research-pulse-keywords.ts`
- Create: `apps/api/src/services/research-pulse-keywords.test.ts`

**Interfaces:**
- Produces:
  - `PULSE_KEYWORDS_CONFIG_KEY = "research.pulseKeywords"`
  - `PulseKeywordGroup = { id: string; label: string; keywords: string[] }`
  - `PulseKeywordsSeed = { version: string; groups: PulseKeywordGroup[]; defaultKeywords: string[] }`
  - `PulseKeywordsWorkspaceValue = { version: 1; enabled: string[]; excluded: string[]; custom: string[] }`
  - `loadResearchPulseKeywordsSeed(projectRoot?: string): PulseKeywordsSeed`
  - `emptyPulseKeywordsWorkspace(): PulseKeywordsWorkspaceValue`
  - `parsePulseKeywordsWorkspace(raw: unknown): PulseKeywordsWorkspaceValue`
  - `normalizePulseKeyword(k: string): string` — trim, NFKC, Latin lower for compare key; keep display string separate if needed
  - `mergePulseKeywords(seed: PulseKeywordsSeed, workspace: PulseKeywordsWorkspaceValue): string[]` — effective list; empty after exclude → `seed.defaultKeywords`
  - `filterNewsByKeywords<T extends { title: string; rawSnippet?: string; snippet?: string }>(items: T[], keywords: string[]): Array<T & { matchedKeywords: string[] }>`
  - `MAX_CUSTOM_KEYWORDS = 20`, `MAX_KEYWORD_LENGTH = 32`

- [ ] **Step 1: Write seed YAML** (exact content from spec groups: cnc-core, brands, hiring-sales)

```yaml
version: v1
groups:
  - id: cnc-core
    label: 数控机床
    keywords: [数控, 加工中心, 五轴, 机床]
  - id: brands
    label: 重点品牌
    keywords: [发那科, 马扎克, 牧野, 创世纪, 乔锋, 宝力机械, 宝惠]
  - id: hiring-sales
    label: 招聘与商机
    keywords: [招聘, 扩产, 中标, 采购, 订单, 签约]
defaults:
  enabledGroupIds: [cnc-core, brands, hiring-sales]
```

- [ ] **Step 2: Failing pure tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  emptyPulseKeywordsWorkspace,
  filterNewsByKeywords,
  loadResearchPulseKeywordsSeed,
  mergePulseKeywords,
  parsePulseKeywordsWorkspace,
} from "./research-pulse-keywords.js";
// pack loader may live in research-pulse-keywords-pack.ts and re-export

const REPO_ROOT = resolve(import.meta.dirname, "../../../../");

it("loads real seed with CNC defaults", () => {
  const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
  expect(seed.defaultKeywords).toContain("发那科");
  expect(seed.defaultKeywords).toContain("数控");
  expect(seed.groups.length).toBeGreaterThanOrEqual(3);
});

it("merge: seed only when workspace empty", () => {
  const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
  const eff = mergePulseKeywords(seed, emptyPulseKeywordsWorkspace());
  expect(eff).toEqual(seed.defaultKeywords);
});

it("merge: custom additive; excluded removes; exclude-all falls back to seed", () => {
  const seed = loadResearchPulseKeywordsSeed(REPO_ROOT);
  const withCustom = mergePulseKeywords(seed, {
    version: 1,
    enabled: [],
    excluded: [],
    custom: ["刀塔"],
  });
  expect(withCustom).toContain("刀塔");

  const excluded = mergePulseKeywords(seed, {
    version: 1,
    enabled: [],
    excluded: [...seed.defaultKeywords, "刀塔"],
    custom: ["刀塔"],
  });
  expect(excluded).toEqual(seed.defaultKeywords);
});

it("filterNewsByKeywords matches 发那科 and attaches matchedKeywords", () => {
  const items = [
    { title: "发那科推进智能制造", platform: "x", capturedAt: 2 },
    { title: "娱乐八卦无关", platform: "x", capturedAt: 1 },
  ];
  const hits = filterNewsByKeywords(items, ["发那科", "数控"]);
  expect(hits).toHaveLength(1);
  expect(hits[0]!.matchedKeywords).toContain("发那科");
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
bunx vitest run apps/api/src/services/research-pulse-keywords.test.ts
```

- [ ] **Step 4: Implement pack loader + pure helpers**

`research-pulse-keywords-pack.ts`: read YAML (reuse `yaml` parse + project root resolution pattern from `research-showcase-pack.ts`), validate groups/keywords non-empty strings, build `defaultKeywords` from `defaults.enabledGroupIds`.

`research-pulse-keywords.ts`: implement normalize, merge (spec rules), filter (substring; Latin case-insensitive on haystack/keyword).

- [ ] **Step 5: Pass + commit**

```bash
bunx vitest run apps/api/src/services/research-pulse-keywords.test.ts
git add config/research_pulse_keywords.yaml \
  apps/api/src/services/research-pulse-keywords-pack.ts \
  apps/api/src/services/research-pulse-keywords.ts \
  apps/api/src/services/research-pulse-keywords.test.ts
git commit -m "feat(research): pulse keyword seed pack and pure merge/filter"
```

---

### Task 2: Pulse service + keywords GET/PUT routes

**Files:**
- Create: `apps/api/src/services/research-pulse-service.ts`
- Modify: `apps/api/src/routes/research.ts`
- Modify: `apps/api/src/routes/research.test.ts`

**Interfaces:**
- Consumes: `workspaceConfigService.getWorkspaceConfigValue` / private upsert pattern — **prefer** adding thin methods on service OR call existing:

```typescript
// workspace-config-service already has:
getWorkspaceConfigValue(workspaceSlug: string, configKey: string): Promise<unknown>
// Use upsert via a new public method if private upsert is not exported:
// Add if needed:
// async setWorkspaceConfigValue(workspaceSlug: string, configKey: string, configValue: unknown): Promise<void>
```

If `upsertWorkspaceConfigEntry` is private, add:

```typescript
async setWorkspaceConfigValue(workspaceSlug: string, configKey: string, configValue: unknown): Promise<void> {
  await this.upsertWorkspaceConfigEntry(workspaceSlug, configKey, configValue);
}
```

- Produces:
  - `getPulseKeywordsState(workspaceSlug: string): Promise<{ seed; workspace; effective }>`
  - `putPulseKeywords(workspaceSlug: string, body: { enabled?; excluded?; custom? }): Promise<same>`
  - `getResearchPulse(workspaceSlug: string, opts: { limit?: number; all?: boolean }): Promise<{ items; meta }>`
  - Validate custom: max 20, each length ≤ 32; trim; drop empties; 400 on invalid

- [ ] **Step 1: Service unit tests with mocked workspace + listResearchNews**

Mock `workspaceConfigService` and `listResearchNews` from `research-service.js`.

Cases:
- no workspace config → effective = seed defaults
- put custom → get reflects custom in effective
- pulse filters out non-matching titles; `all: true` returns unfiltered with `meta.filtered: false`

- [ ] **Step 2: Implement service**

```typescript
export async function getPulseKeywordsState(workspaceSlug: string) {
  const seed = loadResearchPulseKeywordsSeed();
  const raw = await workspaceConfigService.getWorkspaceConfigValue(
    workspaceSlug,
    PULSE_KEYWORDS_CONFIG_KEY,
  );
  const workspace = parsePulseKeywordsWorkspace(raw);
  const effective = mergePulseKeywords(seed, workspace);
  return { seed, workspace, effective };
}

export async function getResearchPulse(workspaceSlug: string, opts: { limit?: number; all?: boolean }) {
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 50);
  const { effective } = await getPulseKeywordsState(workspaceSlug);
  const raw = await listResearchNews({ limit: opts.all ? limit : 100 }); // fetch wider when filtering
  const rawCount = raw.length;
  if (opts.all) {
    return {
      items: raw.slice(0, limit).map((n) => ({
        title: n.title,
        platform: n.platform,
        ...(n.url ? { url: n.url } : {}),
        capturedAt: n.capturedAt,
        matchedKeywords: [] as string[],
      })),
      meta: { filtered: false, effectiveKeywords: effective, rawCount, matchedCount: rawCount },
    };
  }
  const hits = filterNewsByKeywords(raw, effective);
  const sliced = hits.slice(0, limit);
  return {
    items: sliced.map((n) => ({
      title: n.title,
      platform: n.platform,
      ...(n.url ? { url: n.url } : {}),
      capturedAt: n.capturedAt,
      matchedKeywords: n.matchedKeywords,
    })),
    meta: {
      filtered: true,
      effectiveKeywords: effective,
      rawCount,
      matchedCount: hits.length,
    },
  };
}
```

- [ ] **Step 3: OpenAPI routes** (same auth middleware as other research routes)

| Method | Path |
|--------|------|
| GET | `/api/research/pulse/keywords` |
| PUT | `/api/research/pulse/keywords` |
| GET | `/api/research/pulse` |

Workspace slug from `X-Workspace-Slug` / `c.var.workspaceSlug` — **match existing research showcase pattern** (`X-Workspace-Slug` header fallback `"hr"`).

PUT body schema: `{ enabled: z.array(z.string()).optional(), excluded: ..., custom: ... }`

- [ ] **Step 4: Route tests** with `createAuthHeaders` + mock service or real pure + mocked convex/workspace

- [ ] **Step 5: Pass + commit**

```bash
bunx vitest run apps/api/src/services/research-pulse-keywords.test.ts apps/api/src/routes/research.test.ts
git add apps/api/src/services/research-pulse-service.ts \
  apps/api/src/services/workspace-config-service.ts \
  apps/api/src/routes/research.ts apps/api/src/routes/research.test.ts
git commit -m "feat(research): pulse keywords API and filtered pulse feed"
```

---

### Task 3: Hub pulse uses shared filter

**Files:**
- Modify: `apps/api/src/services/research-showcase-service.ts`
- Modify: `apps/api/src/services/research-showcase-service.test.ts` (if pulse assertions exist)

**Interfaces:**
- Consumes: `getResearchPulse` or shared filter helper with workspaceSlug
- Produces: `getResearchShowcase(teamSlug)` pulse array includes only filtered items (or full items with matchedKeywords) consistent with dedicated pulse

- [ ] **Step 1: Change `getResearchShowcase` to call pulse helper**

Replace raw `listResearchNews({ limit: 12 })` pulse build with:

```typescript
const pulseResult = await getResearchPulse(teamSlug.trim() || "hr", { limit: 12, all: false });
const pulse = pulseResult.items.map((n) => ({
  title: n.title,
  platform: n.platform,
  ...(n.url ? { url: n.url } : {}),
  capturedAt: n.capturedAt,
  ...(n.matchedKeywords?.length ? { matchedKeywords: n.matchedKeywords } : {}),
}));
```

Extend showcase response type optionally with `matchedKeywords` on pulse items (OpenAPI showcase schema may need optional field).

- [ ] **Step 2: Update showcase service test** if it asserts pulse shape from mocks

- [ ] **Step 3: Pass + commit**

```bash
bunx vitest run apps/api/src/services/research-showcase-service.test.ts apps/api/src/routes/research.test.ts
git commit -m "feat(research): showcase hub pulse uses keyword filter"
```

---

### Task 4: Hub UI — chips, soft empty, 管理关键词

**Files:**
- Create (optional extract): `apps/web/src/components/research/PulseKeywordsDialog.tsx`
- Modify: `apps/web/src/pages/ResearchIndexPage.tsx`
- Modify: `apps/web/src/pages/ResearchIndexPage.test.tsx`

**Interfaces:**
- Consumes:
  - `GET /api/research/pulse` and/or showcase pulse already filtered
  - `GET/PUT /api/research/pulse/keywords`
- UI behavior from spec:
  1. Chip row of effective keywords (show first ~8, “+N”)
  2. Click chip → temporary focus filter (client-side filter of items by that keyword) until cleared
  3. Soft empty: `meta.matchedCount===0 && meta.rawCount>0` → banner + 显示全部 (`all=1` refetch)
  4. 管理关键词 dialog: list seed defaults + custom; save PUT; refresh

Prefer loading pulse via **`GET /api/research/pulse`** on the hub (source of meta) instead of only showcase.pulse, **or** extend showcase response with `pulseMeta`. Spec prefers shared helper; **simplest hub path:** keep showcase load for golden/desk; **additionally** load `/api/research/pulse` for 市场动态 section so meta is available.

- [ ] **Step 1: Failing UI tests**

```typescript
// Mock GET /api/research/pulse → filtered empty with rawCount>0 → soft empty banner
// Mock GET keywords → effective chips render
// 显示全部 click → GET pulse?all=1
// 管理关键词 save → PUT then refresh
// golden 展示数据 still present
```

- [ ] **Step 2: Implement UI** (zh-Hans defaultValues)

Dialog minimum:
- Show effective list as checkboxes for seed.defaultKeywords (unchecked = add to excluded on save)
- Input + add for custom
- Save / Cancel

Keep dialog inline in page if extract is heavy — extract preferred if file grows.

- [ ] **Step 3: Pass + commit**

```bash
cd apps/web && bunx vitest run src/pages/ResearchIndexPage.test.tsx
git add apps/web/src/pages/ResearchIndexPage.tsx apps/web/src/pages/ResearchIndexPage.test.tsx \
  apps/web/src/components/research/PulseKeywordsDialog.tsx  # if created
git commit -m "feat(research): pulse keyword chips and settings dialog on hub"
```

---

### Task 5: Docs note + verification gate

**Files:**
- Modify: `.env.example` (one-line comment for deferred ingest flag)
- Modify: plan checkboxes when done

- [ ] **Step 1: Add to `.env.example`**

```bash
# Research pulse ingest filter (NOT implemented in v1 read-path-only design; reserved)
# RESEARCH_PULSE_INGEST_FILTER=false
```

- [ ] **Step 2: Run focused suites**

```bash
bunx vitest run \
  apps/api/src/services/research-pulse-keywords.test.ts \
  apps/api/src/routes/research.test.ts \
  apps/api/src/services/research-showcase-service.test.ts

cd apps/web && bunx vitest run src/pages/ResearchIndexPage.test.tsx
```

Expected: all pass.

- [ ] **Step 3: Commit env note + plan checkbox updates**

```bash
git add .env.example docs/superpowers/plans/2026-07-22-research-pulse-keywords-plan.md
git commit -m "docs(research): pulse keywords plan done + deferred ingest flag note"
```

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| Seed YAML CNC groups | 1 |
| Pure merge + exclude-all → seed fallback | 1 |
| Pure filter + matchedKeywords | 1 |
| Workspace get/put `research.pulseKeywords` | 2 |
| GET filtered pulse + `all=1` | 2 |
| Hub showcase pulse shared filter | 3 |
| Chips, soft empty, 管理关键词 | 4 |
| Ingest gate documented only | 5 |
| Showcase honesty | 3–4 tests |

## Plan self-review

1. **Spec coverage:** All success criteria mapped; ingest implementation explicitly out.  
2. **Placeholders:** None; concrete types and routes.  
3. **Types:** `PulseKeywordsWorkspaceValue` / `effective` / `matchedKeywords` consistent.  
4. **Filter-before-limit:** Pulse fetches wider window when filtering then slices (Task 2).  

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-research-pulse-keywords-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans checkpoints  

Which approach?
