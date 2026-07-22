# Research Hub + Company — 综合热榜 vs 品牌动态 Split

**Status:** Approved (brainstorm 2026-07-22; user chose surface **B** + approach with brand RSS)  
**Branch:** `feat/research-hotlist-vs-brand-split`  
**Worktree:** `.worktrees/research-hotlist-vs-brand-split`  
**Related:**

- `docs/superpowers/specs/2026-07-22-research-persona-hr-real-data-design.md` (live-first company page)
- `docs/superpowers/specs/2026-07-22-research-hotlist-platform-select-design.md` (数据源 / NewsNow IDs)
- `docs/superpowers/specs/2026-07-22-research-pulse-keywords-design.md` (市场动态 keywords)
- `docs/superpowers/specs/2026-07-22-research-crawler-industry-resume-loop-design.md` (ingest → project → resume)
- `config/research_hotlist_platforms.yaml`, `config/research_pulse_keywords.yaml`, `config/config.yaml` (`platforms` + `rss.feeds`)

## Problem

| Observation | Cause |
|-------------|--------|
| `/hr/research/fanuc` looks “Google RSS only” | Company page reads **projected** `research_signals`; entertainment hotlists rarely mention 发那科/FANUC |
| NewsNow platforms (weibo, zhihu, …) appear “dead” | They **are live**; they feed `news_items` / pulse, not company projection |
| One mixed list confuses desk | “What’s hot” vs “evidence about this brand” are different claims |

Live proof (local): NewsNow returns 10–30 items per platform; CNC/FANUC keyword scan of current hotlists often **zero hits**; brand density comes from `rss:gnews-*` feeds.

## Goal

Ship a **hub + company** product split so HR desk can:

1. Scan **综合热榜** (selected NewsNow platforms, optional pulse keywords) without claiming company ownership.
2. Open a company and read **品牌动态** (resolved signals, persona re-rank, real 原文).
3. Optionally open **综合热榜** on the company page for desk context (same feed as hub, not fake company-filtered hotlist).
4. Grow **品牌** density via brand-scoped RSS (and later trade feeds), not by loosening company projection.

Success is a checklist (below), not a single demo click.

## Non-goals

- Force-attach hotlist titles to a company without alias/industry resolve (false positives)
- Self-host NewsNow as a hard dependency
- New AI classifier for signal kinds (v1 stays rule projector)
- Full trade-site scrapers / CRM sequences
- Production deploy / origin push as part of this design
- Fixing global `GET /api/resumes/analysis-tasks` 403 noise (separate: workspace membership / dual-tab poller; not Research)

## Locked decisions

| Topic | Choice |
|-------|--------|
| Surface package | **B** — hub **and** company |
| Two read models | **品牌动态** = company signals; **综合热榜** = hotlist `news_items` / pulse (no company gate) |
| Hub primary section | Reframe today’s 市场动态 / pulse as **综合热榜** (copy + layout; keep pulse API unless filter gaps force extension) |
| Company default tab | **品牌动态** |
| Company 热榜 tab | Same workspace hotlist feed as hub; optional visual highlight for alias/keyword hits; **no** “this is a FANUC signal” claim |
| Platform select | Continues to control NewsNow IDs for ingest → 热榜 density |
| Pulse keywords | Soft-filter / chips on 热榜 only; not company projection |
| Brand density | Extend `rss.feeds` brand pack (gnews queries per golden brands + hiring/topic); label platform chips honestly |
| Projection | Unchanged: must resolve company (industry bridge + K3 alias) |
| Live / showcase | Live-first honesty unchanged; showcase secondary and labeled |
| Ingest spine | Timer / 运行实时抓取 → Convex → UI DB-read only |
| Demo seed | Never product-live |

## Architecture

```text
  NewsNow (effective platforms) ──┐
                                  ├──► ResearchIngestJob ──► news_items
  RSS (incl. brand pack) ─────────┘         │
                                            ├── project_signals ──► research_signals
                                            └── (unresolved → industry queue)

  UI read models:
    综合热榜  ── GET pulse (and/or news, hotlist platforms)
    品牌动态  ── GET /companies/:key/signals?persona=
```

### Data contracts (conceptual)

| Surface | Source of truth | Gate |
|---------|-----------------|------|
| 综合热榜 | Recent items with `platform` in NewsNow hotlist set (exclude pure `rss:*` from “热榜” labeling when possible) | Optional effective pulse keywords; `all=1` unfiltered |
| 品牌动态 | `research_signals` for `companyKey` | Company resolve at ingest; persona re-rank only at read |

**Hard rule:** Never promote a 热榜 row into 品牌 unless the projector already created a signal. Optional `resolvedCompanies` on pulse rows remain **navigation chips**, not brand ownership.

## Surfaces

### Hub — `/{team}/research?persona=hr`

```text
[ 搜索企业 ]
[ 综合热榜 ]          ← primary named section (today’s pulse section)
    · effective platform chips (from workspace hotlist overlay)
    · keyword chips (pulse keywords) + 关键词筛选 | 全部热榜
    · rows: title · platform · 原文 · optional resolvedCompanies → company
[ 品牌入口 ]
    · search results, industry browse, showcase cards (existing)
[ 数据源 ] [ 管理关键词 ]  (existing dialogs)
```

Copy: prefer **综合热榜** over ambiguous “市场动态” where user-facing; keep i18n keys stable where tests depend on them, or update tests with rename.

### Company — `/{team}/research/{companyKey}?persona=hr`

```text
[ 品牌动态 | 综合热榜 ]   segmented control (default: 品牌动态)
```

| Tab | Content |
|-----|---------|
| **品牌动态** | Existing `CompanyResearchPanel`: live-first signals, persona, kinds, 原文. Empty: honest copy + CTA 运行实时抓取 / link hub 热榜 |
| **综合热榜** | Same pulse feed as hub (workspace-scoped). Optional highlight if title matches company aliases or pulse brand keywords (visual only). Resume strip / policy badges stay on brand path |

Deep-link (optional v1.1): `?tab=hotlist|brand` — not required for P1 if local state is enough.

## Brand RSS pack (density)

| Work | Detail |
|------|--------|
| Config | Extend `config/config.yaml` `rss.feeds` (and/or a dedicated pack YAML loaded by worker) for golden CNC brands + topic queries (e.g. 发那科 招聘, FANUC CNC, peer brands) |
| Ingest | Existing `load_rss_feeds` + `HttpRssPort`; strip HTML on parse (already shipped) |
| UI | Platform chip shows `rss:gnews-…` vs `weibo` so desk sees channel mix |
| Out of scope v1 | Desk UI editor for RSS feeds |

## API

| Need | Approach |
|------|----------|
| Hub / company 热榜 | Prefer existing `GET /api/research/pulse` (`all`, `limit`). Extend only if we must force **hotlist-only** (exclude `rss:*`) or multi-platform filter |
| Brand | Existing `GET /api/research/companies/{companyKey}/signals` |
| Platforms | Existing GET/PUT `/api/research/platforms` |
| Keywords | Existing GET/PUT `/api/research/pulse/keywords` |

New endpoints only when pulse cannot express “hotlist platforms only” cleanly.

## Phased ship

| Phase | Outcome |
|-------|---------|
| **P1** | Hub section rename/layout to 综合热榜; company segmented **品牌 \| 热榜**; wire 热榜 tab to pulse |
| **P2** | Brand RSS pack expansion for golden brands / hiring topics |
| **P3** | Optional alias/keyword highlight on 热榜 titles (no company claim) |

Implement P1 before P2 unless brand empty-state blocks UAT; P2 can ship in same PR if small.

## Success checklist

1. Hub shows **综合热榜** with live weibo/zhihu/… rows even when zero CNC keyword hits.
2. `/research/fanuc` **品牌** remains live-first with real `http(s)` 原文; may stay RSS-heavy until titles match brands.
3. Company **综合热榜** tab shows general hotlist (honest: may not mention the company).
4. Changing 数据源 + re-ingest changes 热榜 composition.
5. No raw HTML under titles; no demo-seed presented as live.
6. Persona=hr still only re-ranks brand signals; does not fork storage.

## Test plan (high level)

- API: pulse still filters/unfilters; signals live-first meta unchanged.
- Web: hub section testids / copy; company tab switch loads pulse without claiming brand.
- Worker: brand RSS feeds load; HTML strip regression stays green.
- Manual UAT: `/{team}/research` + `/research/fanuc?persona=hr` after real ingest.

## Open follow-ups (not this design)

- analysis-tasks 403 dual-tab / membership hardening
- Trade RSS / official IR feeds
- Soft “related” ranking on 热榜 beyond highlight
- `?tab=` deep links

## Approval

- Brainstorm approaches presented; user chose **B** (hub + company).
- Design sections approved 2026-07-22.
- Spec written on `feat/research-hotlist-vs-brand-split` for plan → implement.
