# Research Predictive Search + Pulse Scanability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make research hub **搜索企业** a working predictive combobox (industry bridge + recent opens, nameCn-first) and lightly improve **市场动态** scanability (platform chip, relative time, optional company resolve chip).

**Architecture:** Extend `GET /api/research/industry` with optional `q` filter over bridge entities. Web adds `ResearchCompanyPredictInput` (debounced combobox, localStorage recents, pin via existing resolve endpoint) wired on `ResearchIndexPage`. Pulse section gains platform + relative-time chips and optional nameCn link when resolve hits. No AI, no omnibox-only path, no notify/CRM.

**Tech Stack:** TypeScript BFF (`apps/api`), React + vitest (`apps/web`), existing industry bridge, `date-fns/formatDistanceToNow` for relative time.

**Design spec:** `docs/superpowers/specs/2026-07-22-research-predictive-search-pulse-ux-design.md`

## Global Constraints

- Prediction sources v1: **industry bridge + local recent opens only** — no AI suggest.
- Identity unchanged: `canonicalKey` for new brands (e.g. FANUC → `fanuc`); legacy 宝力机械 → `pro-technic-machinery`, 宝惠 → `polywell`.
- Row labels **nameCn-first**; navigate with `?persona=hr`.
- Showcase honesty preserved: do not present seed pulse as live market intel; golden cards keep **展示数据** badge.
- Page-local focus shortcut only (no global Cmd+K stealing resume desk).
- Prefer fixture/unit tests; no live NewsNow required.
- No production deploy / origin push.

---

## File map

| Path | Role |
|------|------|
| `apps/api/src/services/research-industry-bridge.ts` | Add `q` filter helper on CNC list |
| `apps/api/src/services/research-industry-bridge-service.ts` | Pass `q` through |
| `apps/api/src/services/research-industry-bridge.test.ts` | Pure filter tests |
| `apps/api/src/routes/research.ts` | OpenAPI `q` on industry browse |
| `apps/api/src/routes/research.test.ts` | Route test for `q` |
| `apps/web/src/lib/research-recent-companies.ts` | localStorage recent opens (pure API + storage) |
| `apps/web/src/lib/research-recent-companies.test.ts` | Cap 8 / order tests |
| `apps/web/src/components/research/ResearchCompanyPredictInput.tsx` | Combobox UI |
| `apps/web/src/components/research/ResearchCompanyPredictInput.test.tsx` | Combobox behavior |
| `apps/web/src/pages/ResearchIndexPage.tsx` | Wire predict input + pulse polish |
| `apps/web/src/pages/ResearchIndexPage.test.tsx` | Hub integration |

---

### Task 1: Industry browse `q` filter (API)

**Files:**
- Modify: `apps/api/src/services/research-industry-bridge.ts`
- Modify: `apps/api/src/services/research-industry-bridge-service.ts`
- Modify: `apps/api/src/services/research-industry-bridge.test.ts`
- Modify: `apps/api/src/routes/research.ts`
- Modify: `apps/api/src/routes/research.test.ts`

**Interfaces:**
- Consumes: existing `listCncBridgeEntities`, `BridgeEntity`
- Produces:
  - `filterBridgeEntities(entities: BridgeEntity[], q: string): BridgeEntity[]`
  - `listCncBridgeEntities(..., options?: { limit?: number; includeNonCnc?: boolean; q?: string })`
  - `listResearchIndustryBrowse(options?: { limit?: number; includeNonCnc?: boolean; q?: string })`
  - Route query: `q?: string`

- [x] **Step 1: Failing pure tests for `q` filter**

Add to `research-industry-bridge.test.ts`:

```typescript
import { filterBridgeEntities, listCncBridgeEntities } from "./research-industry-bridge.js";

it("filterBridgeEntities matches nameCn / nameEn / companyKey / aliases", () => {
  const entities = listCncBridgeEntities(brands);
  const fanucHits = filterBridgeEntities(entities, "发那");
  expect(fanucHits.some((e) => e.companyKey === "fanuc")).toBe(true);
  const enHits = filterBridgeEntities(entities, "fanuc");
  expect(enHits.some((e) => e.companyKey === "fanuc")).toBe(true);
  const baoli = filterBridgeEntities(entities, "宝力");
  expect(baoli.some((e) => e.companyKey === "pro-technic-machinery")).toBe(true);
});

it("filterBridgeEntities empty q returns input unchanged", () => {
  const entities = listCncBridgeEntities(brands);
  expect(filterBridgeEntities(entities, "   ")).toEqual(entities);
});
```

(Use the same `brands` fixture already in that describe, or real config suite.)

- [x] **Step 2: Run test — expect FAIL** (filterBridgeEntities missing)

```bash
bunx vitest run apps/api/src/services/research-industry-bridge.test.ts
```

- [x] **Step 3: Implement filter + wire options.q**

In `research-industry-bridge.ts`:

```typescript
export function filterBridgeEntities(entities: BridgeEntity[], q: string): BridgeEntity[] {
  const raw = q.trim().toLowerCase();
  if (!raw) return entities;
  const norm = raw.replace(/[\s\u00A0]+/g, "");
  return entities.filter((e) => {
    const hay = [
      e.companyKey,
      e.nameCn,
      e.nameEn ?? "",
      e.displayName,
      ...e.aliases,
    ]
      .join(" ")
      .toLowerCase()
      .replace(/[\s\u00A0]+/g, "");
    return hay.includes(norm) || hay.includes(raw);
  });
}
```

Extend `listCncBridgeEntities` options with `q?: string`. After building `list`, if `options?.q?.trim()`, set `list = filterBridgeEntities(list, options.q)` **before** applying `limit` (filter first, then slice) so `q` is not applied only to a truncated prefix.

In `research-industry-bridge-service.ts`:

```typescript
export function listResearchIndustryBrowse(options?: {
  limit?: number;
  includeNonCnc?: boolean;
  q?: string;
  industry?: IndustryDataService;
}): BridgeEntity[] {
  const industry = options?.industry ?? defaultService;
  const brands = industry.loadBrands();
  const companies = industry.loadAll().companies;
  return listCncBridgeEntities(brands, companies, {
    limit: options?.limit ?? 60,
    includeNonCnc: options?.includeNonCnc,
    q: options?.q,
  });
}
```

- [x] **Step 4: Route OpenAPI + handler**

In `research.ts` industry browse query schema add:

```typescript
q: z.string().optional(),
```

Handler:

```typescript
const items = listResearchIndustryBrowse({
  limit: query.limit,
  includeNonCnc: query.includeNonCnc === true,
  q: query.q,
});
```

- [x] **Step 5: Route test**

In `research.test.ts`:

```typescript
it("filters industry browse by q for fanuc / 发那科", async () => {
  const auth = createAuthHeaders({ workspaceSlug: "hr", role: "user" });
  const app = createApp();
  const response = await app.request(
    `/api/research/industry?limit=40&q=${encodeURIComponent("发那")}`,
    { headers: auth.headers },
  );
  expect(response.status).toBe(200);
  const body = await parseJsonBody(response);
  expect(body.items.some((i: { companyKey: string }) => i.companyKey === "fanuc")).toBe(true);
  for (const item of body.items) {
    const hay = `${item.companyKey} ${item.nameCn} ${item.nameEn ?? ""}`.toLowerCase();
    expect(hay.includes("fanuc") || hay.includes("发那") || item.nameCn.includes("发那")).toBe(true);
  }
});
```

- [x] **Step 6: Pass + commit**

```bash
bunx vitest run apps/api/src/services/research-industry-bridge.test.ts apps/api/src/routes/research.test.ts
git add apps/api/src/services/research-industry-bridge.ts \
  apps/api/src/services/research-industry-bridge-service.ts \
  apps/api/src/services/research-industry-bridge.test.ts \
  apps/api/src/routes/research.ts apps/api/src/routes/research.test.ts
git commit -m "feat(research): industry browse q filter for predictive search"
```

---

### Task 2: Recent opens helper (web pure)

**Files:**
- Create: `apps/web/src/lib/research-recent-companies.ts`
- Create: `apps/web/src/lib/research-recent-companies.test.ts`

**Interfaces:**
- Consumes: `localStorage` (injectable for tests)
- Produces:
  - `RESEARCH_RECENT_KEY = "trends.research.recentCompanies.v1"`
  - `ResearchRecentCompany = { companyKey: string; nameCn: string; nameEn?: string; openedAt: number }`
  - `loadResearchRecentCompanies(storage?: Storage): ResearchRecentCompany[]`
  - `upsertResearchRecentCompany(entry: Omit<ResearchRecentCompany, "openedAt"> & { openedAt?: number }, storage?: Storage): ResearchRecentCompany[]` — max **8**, newest first, dedupe by companyKey

- [x] **Step 1: Failing tests**

```typescript
import { describe, expect, it } from 'vitest'
import {
  loadResearchRecentCompanies,
  upsertResearchRecentCompany,
} from './research-recent-companies'

function memStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear() { map.clear() },
    getItem(k) { return map.get(k) ?? null },
    setItem(k, v) { map.set(k, String(v)) },
    removeItem(k) { map.delete(k) },
    key() { return null },
  }
}

describe('research-recent-companies', () => {
  it('upserts newest first and caps at 8', () => {
    const s = memStorage()
    for (let i = 0; i < 10; i += 1) {
      upsertResearchRecentCompany(
        { companyKey: `k${i}`, nameCn: `名${i}`, openedAt: i + 1 },
        s,
      )
    }
    const list = loadResearchRecentCompanies(s)
    expect(list).toHaveLength(8)
    expect(list[0]?.companyKey).toBe('k9')
    expect(list.at(-1)?.companyKey).toBe('k2')
  })

  it('moves existing key to front', () => {
    const s = memStorage()
    upsertResearchRecentCompany({ companyKey: 'fanuc', nameCn: '发那科', openedAt: 1 }, s)
    upsertResearchRecentCompany({ companyKey: 'mazak', nameCn: '山崎马扎克', openedAt: 2 }, s)
    upsertResearchRecentCompany({ companyKey: 'fanuc', nameCn: '发那科', openedAt: 3 }, s)
    const list = loadResearchRecentCompanies(s)
    expect(list[0]?.companyKey).toBe('fanuc')
    expect(list.filter((x) => x.companyKey === 'fanuc')).toHaveLength(1)
  })
})
```

- [x] **Step 2: Run — expect FAIL**

```bash
cd apps/web && bunx vitest run src/lib/research-recent-companies.test.ts
```

- [x] **Step 3: Implement**

```typescript
export const RESEARCH_RECENT_KEY = 'trends.research.recentCompanies.v1'
export const RESEARCH_RECENT_MAX = 8

export type ResearchRecentCompany = {
  companyKey: string
  nameCn: string
  nameEn?: string
  openedAt: number
}

function getStore(storage?: Storage): Storage | null {
  if (storage) return storage
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    /* private mode */
  }
  return null
}

export function loadResearchRecentCompanies(storage?: Storage): ResearchRecentCompany[] {
  const store = getStore(storage)
  if (!store) return []
  try {
    const raw = store.getItem(RESEARCH_RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((row): row is ResearchRecentCompany =>
        !!row && typeof row === 'object'
        && typeof (row as ResearchRecentCompany).companyKey === 'string'
        && typeof (row as ResearchRecentCompany).nameCn === 'string'
        && typeof (row as ResearchRecentCompany).openedAt === 'number',
      )
      .slice(0, RESEARCH_RECENT_MAX)
  } catch {
    return []
  }
}

export function upsertResearchRecentCompany(
  entry: { companyKey: string; nameCn: string; nameEn?: string; openedAt?: number },
  storage?: Storage,
): ResearchRecentCompany[] {
  const store = getStore(storage)
  const openedAt = entry.openedAt ?? Date.now()
  const next: ResearchRecentCompany = {
    companyKey: entry.companyKey,
    nameCn: entry.nameCn,
    ...(entry.nameEn ? { nameEn: entry.nameEn } : {}),
    openedAt,
  }
  const prev = loadResearchRecentCompanies(storage).filter((r) => r.companyKey !== next.companyKey)
  const list = [next, ...prev].slice(0, RESEARCH_RECENT_MAX)
  try {
    store?.setItem(RESEARCH_RECENT_KEY, JSON.stringify(list))
  } catch {
    /* ignore quota */
  }
  return list
}
```

- [x] **Step 4: Pass + commit**

```bash
cd apps/web && bunx vitest run src/lib/research-recent-companies.test.ts
git add apps/web/src/lib/research-recent-companies.ts apps/web/src/lib/research-recent-companies.test.ts
git commit -m "feat(research): local recent company opens for typeahead"
```

---

### Task 3: ResearchCompanyPredictInput combobox

**Files:**
- Create: `apps/web/src/components/research/ResearchCompanyPredictInput.tsx`
- Create: `apps/web/src/components/research/ResearchCompanyPredictInput.test.tsx`

**Interfaces:**
- Consumes: `rawApiClient`, `upsertResearchRecentCompany`, `loadResearchRecentCompanies`, `useNavigate` (or `onSelect` callback for testability)
- Produces component props:

```typescript
export type PredictCompanyHit = {
  companyKey: string
  nameCn: string
  nameEn?: string
  displayName?: string
  type?: string
  source: 'recent' | 'resolve' | 'industry' | 'showcase'
}

type Props = {
  teamSlug: string
  /** Optional golden chips when recent empty */
  showcaseSuggestions?: Array<{ companyKey: string; nameCn: string; nameEn?: string }>
  debounceMs?: number // default 250
  onNavigate?: (href: string) => void // default useNavigate
}
```

Behavior (from spec):
- Focus + empty query → recent (then showcase suggestions if recent empty / as short group)
- Typing debounced → `GET /api/research/industry?limit=24&q=` + `GET /api/research/industry/resolve?q=`; pin resolve hit
- Row nameCn-first; keyboard combobox a11y; Enter selects active; Escape closes
- Select → upsert recent + navigate `/${teamSlug}/research/${companyKey}?persona=hr`

- [x] **Step 1: Failing component tests**

Mock `rawApiClient` and recent storage:

```typescript
// Key cases:
// 1) focus empty shows recent from storage mock
// 2) type "发那" debounced → industry GET with q + resolve; list includes fanuc nameCn 发那科
// 3) resolve pin first when hit present
// 4) click / Enter calls navigate with /hr/research/fanuc?persona=hr and upserts recent
```

Use fake timers for debounce if needed (`vi.useFakeTimers()` + advance 250ms).

- [x] **Step 2: Run — expect FAIL**

```bash
cd apps/web && bunx vitest run src/components/research/ResearchCompanyPredictInput.test.tsx
```

- [x] **Step 3: Implement combobox**

Skeleton structure:

```tsx
export function ResearchCompanyPredictInput({ teamSlug, showcaseSuggestions = [], debounceMs = 250, onNavigate }: Props) {
  // state: q, focused, items, loading, activeIndex, recent
  // debounce effect → fetch industry + resolve when q.trim()
  // listbox open when focused && (items.length || recent.length || showcase...)
  // select(hit) { upsert...; navigate(`/...`) }
  return (
    <div className="relative" data-testid="research-predict-root">
      <Input
        role="combobox"
        aria-expanded={isOpen}
        aria-controls="research-predict-listbox"
        aria-autocomplete="list"
        data-testid="research-company-search"
        ...
      />
      {isOpen ? (
        <ul id="research-predict-listbox" role="listbox" data-testid="research-predict-listbox">
          {/* groups: 最近打开 / 匹配 / 展示推荐 */}
        </ul>
      ) : null}
    </div>
  )
}
```

Do **not** import full `GoogleSearchBar`. Copy only a11y/keyboard patterns.

- [x] **Step 4: Pass + commit**

```bash
cd apps/web && bunx vitest run src/components/research/ResearchCompanyPredictInput.test.tsx
git add apps/web/src/components/research/ResearchCompanyPredictInput.tsx \
  apps/web/src/components/research/ResearchCompanyPredictInput.test.tsx
git commit -m "feat(research): predictive company combobox for hub search"
```

---

### Task 4: Wire hub + pulse polish

**Files:**
- Modify: `apps/web/src/pages/ResearchIndexPage.tsx`
- Modify: `apps/web/src/pages/ResearchIndexPage.test.tsx`

**Interfaces:**
- Consumes: `ResearchCompanyPredictInput`, showcase golden for suggestions, existing pulse array
- Produces: updated hub sections

- [x] **Step 1: Replace submit-only search UI with predict input**

In **搜索企业** section:
- Render `<ResearchCompanyPredictInput teamSlug={teamSlug} showcaseSuggestions={golden mapped to nameCn/companyKey} />`
- Keep secondary **搜索** button that still hits `/api/research/companies/search` for full result list **or** documents that Enter-without-active-option triggers list search with current `q` from predict input (lift `q` state or use ref). Spec: active option wins; else list search fallback.

Minimum acceptable: predict input is primary; list search remains with shared `q` state:

```tsx
const [q, setQ] = useState('')
// Predict input: controlled value + onChange setQ
// Button search still uses q
```

- [x] **Step 2: Pulse polish**

For each pulse item:
- Badge/chip with `platform`
- Relative time via `formatDistanceToNow(new Date(capturedAt), { addSuffix: true })` from `date-fns/formatDistanceToNow` (same as `SchedulerStatus`)
- Optional: if `title` length ≤ 40, call resolve once (debounced batch not required in v1 — skip network spam: only resolve when platform is not `showcase` OR skip auto-resolve in v1 and only show platform+time)

**Plan default for optional company chip (YAGNI):** implement platform + relative time only in this task. Document company-chip as optional follow-up if resolve-per-row is too chatty; **or** resolve only the first 5 non-showcase titles once after load with `Promise.all` and cache in state. Prefer **first 5 non-showcase resolve** if cheap:

```typescript
// after pulse load: for items.slice(0,5) where platform !== 'showcase', GET resolve?q= first CJK run or full title
```

If flaky/noisy, ship platform+time only and leave company chip for a one-line follow-up note in commit body.

- [x] **Step 3: Update hub tests**

- Mock `GET /api/research/industry` + resolve for predict if exercised via page
- Assert `research-predict-listbox` or `research-company-search` role combobox present
- Assert pulse item still renders; if platform chip added, `data-testid="research-pulse-platform"`
- Showcase **展示数据** badge still present on golden cards

- [x] **Step 4: Pass + commit**

```bash
cd apps/web && bunx vitest run src/pages/ResearchIndexPage.test.tsx src/components/research/ResearchCompanyPredictInput.test.tsx
git add apps/web/src/pages/ResearchIndexPage.tsx apps/web/src/pages/ResearchIndexPage.test.tsx
git commit -m "feat(research): hub wire predictive search and pulse chips"
```

---

### Task 5: Focused verification gate

**Files:** none (verification only)

- [x] **Step 1: Run focused suites**

```bash
bunx vitest run \
  apps/api/src/services/research-industry-bridge.test.ts \
  apps/api/src/routes/research.test.ts

cd apps/web && bunx vitest run \
  src/lib/research-recent-companies.test.ts \
  src/components/research/ResearchCompanyPredictInput.test.tsx \
  src/pages/ResearchIndexPage.test.tsx
```

Expected: all pass.

- [x] **Step 2: Optional live smoke** (if API+auth up)

```bash
# login hr-demo; GET /api/research/industry?q=发那 → fanuc
# open /hr/research; type 发那; select → /hr/research/fanuc?persona=hr
```

If auth unavailable, skip; unit evidence is sufficient per design.

- [x] **Step 3: Final commit only if dirty** (docs checklist)

Mark this plan file task boxes complete when executing.

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| Industry `q` filter | 1 |
| Recent opens localStorage cap 8 | 2 |
| Predictive combobox + resolve pin + navigate persona=hr | 3 |
| Hub wire + secondary list search | 4 |
| Pulse platform + relative time (+ optional company chip) | 4 |
| nameCn-first / identity / showcase honesty | 1, 3, 4 |
| Focused tests | 1–5 |
| Non-goals (AI, omnibox-only, global Cmd+K, notify) | Constraints — no task |

## Plan self-review

1. **Spec coverage:** Primary search + secondary pulse mapped; company chip scoped as first-5 non-showcase optional in Task 4 to avoid N+1 spam.  
2. **Placeholders:** None; code blocks are concrete.  
3. **Types:** `PredictCompanyHit` / `ResearchRecentCompany` / `BridgeEntity` names consistent across tasks.  
4. **Filter order:** Filter before limit documented in Task 1 to avoid wrong truncation.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-22-research-predictive-search-pulse-ux-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session, executing-plans with checkpoints  

Which approach?
