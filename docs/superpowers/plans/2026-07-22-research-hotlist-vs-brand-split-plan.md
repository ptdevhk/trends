# Research 综合热榜 vs 品牌动态 Implementation Plan

> **For agentic workers:** Inline execution in worktree `.worktrees/research-hotlist-vs-brand-split` on branch `feat/research-hotlist-vs-brand-split`. Steps use checkbox syntax for tracking.

**Goal:** Hub + company split: **综合热榜** (NewsNow pulse, no company gate) vs **品牌动态** (company signals), plus brand RSS density.

**Architecture:** Reuse `GET /api/research/pulse` with optional `hotlistOnly` (drop `rss:*` platforms). Hub renames 市场动态 → 综合热榜. Company page adds tabs; 热榜 tab loads pulse. Extend `config/config.yaml` brand gnews feeds. Optional title highlight when company aliases appear in 热榜 rows.

**Tech Stack:** React + Vitest (web), Hono BFF + vitest (api), Python worker RSS load (config only), Convex unchanged.

**Spec:** `docs/superpowers/specs/2026-07-22-research-hotlist-vs-brand-split-design.md`

## Global Constraints

- Do not loosen company projection / force-attach hotlist → brand.
- Live-first honesty and no demo-seed as live.
- Work only in worktree branch; no origin push unless asked.
- Prefer existing pulse/signals APIs; minimal new surface.

---

### Task 1: Pulse API `hotlistOnly` filter

**Files:**
- Modify: `apps/api/src/services/research-pulse-service.ts`
- Modify: `apps/api/src/routes/research.ts` (query `hotlistOnly`)
- Test: `apps/api/src/services/research-pulse-service.test.ts`

**Produces:** `getResearchPulse(slug, { limit, all, hotlistOnly })` drops items whose `platform` starts with `rss:` when `hotlistOnly === true`.

- [x] Implement filter + query param + tests
- [x] Commit (bundled)

### Task 2: Shared `ResearchHotlistFeed` UI + hub rename

**Files:**
- Create: `apps/web/src/components/research/ResearchHotlistFeed.tsx` (+ test)
- Modify: `apps/web/src/pages/ResearchIndexPage.tsx` (section title 综合热榜, pass hotlistOnly, reuse feed optional)
- Modify: `apps/web/src/pages/ResearchIndexPage.test.tsx`

- [x] Extract list row rendering for reuse
- [x] Hub defaultValue 综合热榜; fetch `?hotlistOnly=1`
- [x] Tests
- [x] Commit (bundled)

### Task 3: Company page 品牌 | 综合热榜 tabs

**Files:**
- Modify: `apps/web/src/pages/ResearchCompanyPage.tsx`
- Modify: `apps/web/src/pages/ResearchCompanyPage.test.tsx`

**Produces:** Segmented control; brand tab = existing panel; hotlist tab = pulse with `hotlistOnly=1`; optional alias highlight (P3 in same task if small).

- [x] Tabs + pulse load + highlight helpers
- [x] Tests
- [x] Commit (bundled)

### Task 4: Brand RSS pack (P2)

**Files:**
- Modify: `config/config.yaml` `rss.feeds`
- Optional smoke: `apps/worker` load_rss_feeds count in a tiny test or manual

- [x] Add gnews for mazak/makino/hiring/cnc topics
- [x] Commit (bundled)

### Task 5: Verify

- [x] Run targeted vitest + worker RSS load check
- [x] Final status on branch

---
