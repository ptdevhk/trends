# Research Pulse Keywords — User-Controlled 市场动态 + Seeded Trending Keywords

**Status:** Approved for implementation plan (brainstorm 2026-07-22)  
**Branch context:** local `main` (showcase hub, industry bridge, predictive search + pulse chips shipped)  
**Related:**  
- `docs/superpowers/specs/2026-07-22-research-predictive-search-pulse-ux-design.md`  
- `docs/superpowers/specs/2026-07-22-research-showcase-hub-design.md`  
- TrendRadar donor idea (not bulk merge): `config/frequency_words.txt` groups/filter  
- Workspace config: `packages/convex/convex/workspace_config.ts`, `apps/api/src/services/workspace-config-service.ts`

## Problem

| Today | Gap |
|-------|-----|
| **市场动态** | Last ~12 `news_items` unfiltered — entertainment hotlist noise dominates |
| **User control** | No keyword prefs for research pulse |
| **TrendRadar distill** | `frequency_words.txt` is a design donor only; not a Research hub product surface |
| **CNC path** | Industry bridge + showcase are CNC/zh-Hans; pulse is not keyword-steered |

HR needs a **workspace-controlled** pulse feed with **seeded CNC trending keywords** so the desk opens with useful defaults, not an empty preference form.

## Goal

1. **Read-path filter (v1 ship):** 市场动态 shows news matching **effective keywords** (seed + workspace overlay).  
2. **Seed pack:** Repo config of CNC/zh-Hans trending keyword groups as defaults.  
3. **Workspace settings:** Shared desk list — enable/disable defaults, add custom, exclude.  
4. **Layer 2 (design only in v1):** Optional ingest-time filter behind env flag — **off by default**.

## Non-goals

- Full `frequency_words.txt` regex / `+must` / `!group-exclude` / `@limit` UI parity  
- Per-user keyword lists (v1 is **workspace-shared**)  
- AI keyword suggest  
- Telegram / multi-channel notify  
- CRM or auto company-policy write  
- Turning on ingest filter by default  
- Production deploy / origin push  

## Locked decisions

| Topic | Choice |
|-------|--------|
| Control layers | **Both thin layers** — display filter first; ingest gate later (flagged) |
| Prefs + seed | **Workspace prefs** + **repo config seed pack** |
| Scope of users | Workspace **user** or **admin** (same gate as `/api/research/*`) |
| Matching v1 | **Simple substring** (case-insensitive for Latin); no full regex engine |
| Empty effective after user exclude-all | **Fall back to seed defaults** (cannot hard-empty the desk by accident) |
| Zero hits with non-empty effective + raw news | Soft banner + **显示全部** toggle |
| Showcase honesty | Platform `showcase` unchanged; filtered feed is not “live market truth” |
| Config key | `research.pulseKeywords` on `workspace_config` |

## Architecture

```text
config/research_pulse_keywords.yaml     # seeded CNC groups (git)
        │ load + parse
workspace_config[research.pulseKeywords]  # enabled / excluded / custom
        │ pure merge → effectiveKeywords[]
        ▼
GET  /api/research/pulse?limit=12[&all=1]
GET  /api/research/pulse/keywords
PUT  /api/research/pulse/keywords
        │
ResearchIndexPage 市场动态
  chips + filtered list + 管理关键词 sheet
```

| Piece | Role |
|-------|------|
| Seed YAML | Defaults only; versioned in repo |
| Pure merge | `mergePulseKeywords(seed, workspace) → effective` |
| Pure filter | `filterNewsByKeywords(items, keywords) → hits with matchedKeywords[]` |
| BFF routes | Load seed, get/put workspace overlay, filtered pulse |
| Hub UI | Chips, soft empty, settings dialog |

Ingest remains soft-fail. **No worker change in v1** except optional documented flag for a later PR.

## Seed pack

**Path:** `config/research_pulse_keywords.yaml`

```yaml
version: v1
groups:
  - id: cnc-core
    label: 数控机床
    keywords:
      - 数控
      - 加工中心
      - 五轴
      - 机床
  - id: brands
    label: 重点品牌
    keywords:
      - 发那科
      - 马扎克
      - 牧野
      - 创世纪
      - 乔锋
      - 宝力机械
      - 宝惠
  - id: hiring-sales
    label: 招聘与商机
    keywords:
      - 招聘
      - 扩产
      - 中标
      - 采购
      - 订单
      - 签约
defaults:
  enabledGroupIds:
    - cnc-core
    - brands
    - hiring-sales
```

**Default flat keyword list** = unique concatenation of keywords in `enabledGroupIds` order (stable).

Operators may extend YAML in git; runtime workspace custom keywords do not rewrite the seed file.

## Workspace overlay

**Convex** `workspace_config`:

| Field | Value |
|-------|--------|
| `workspaceSlug` | Active workspace (e.g. `hr`) |
| `configKey` | `research.pulseKeywords` |
| `configValue` | See shape below |

```typescript
type PulseKeywordsWorkspaceValue = {
  version: 1;
  /** Extra keywords enabled beyond seed (or re-enable after exclude) */
  enabled: string[];
  /** Keywords never shown even if in seed/custom */
  excluded: string[];
  /** User-added keywords (workspace-shared) */
  custom: string[];
};
```

### Merge rules (pure)

```
seedDefaults = flatten(groups where id ∈ defaults.enabledGroupIds)
base = unique(seedDefaults ∪ custom)
// Apply explicit enabled as additive (idempotent)
base = unique(base ∪ enabled)
effective = base.filter(k => !excluded.includes(normalize(k)))
if (effective.length === 0) {
  effective = seedDefaults  // hard-empty guard
}
```

Normalization for compare: trim + Unicode NFKC; Latin lowercased for membership in exclude/enabled sets. Display keeps original casing for CJK.

**Custom keyword limits:** max length **32** chars; max **20** custom entries; reject empty/whitespace.

## Matching / filter

Given news item `title` + optional `rawSnippet` / `snippet`:

1. Build haystack = `title + " " + snippet` (NFKC).  
2. Keyword matches if haystack includes keyword (CJK as-is; Latin case-insensitive).  
3. Item kept if **any** effective keyword matches (OR).  
4. Attach `matchedKeywords: string[]` (subset that hit) for UI chips on the row.  
5. Sort by `capturedAt` descending; apply `limit` **after** filter (unless `all=1`).

**`all=1` query:** skip keyword filter (operator “显示全部”); still respect limit.

## API

### `GET /api/research/pulse/keywords`

Auth: workspace user.

```json
{
  "success": true,
  "seed": { "version": "v1", "groups": [...], "defaultKeywords": ["数控", "..."] },
  "workspace": { "version": 1, "enabled": [], "excluded": [], "custom": [] },
  "effective": ["数控", "加工中心", "..."]
}
```

Missing workspace row → treat as empty overlay (seed defaults only).

### `PUT /api/research/pulse/keywords`

Auth: workspace user. Body:

```json
{
  "enabled": ["数控"],
  "excluded": ["签约"],
  "custom": ["刀塔"]
}
```

Validates lengths/counts; upserts `research.pulseKeywords`; returns same shape as GET.

### `GET /api/research/pulse`

Auth: workspace user.

| Query | Meaning |
|-------|---------|
| `limit` | Max items (default 12, max 50) |
| `all` | If `1`/`true`, do not apply keyword filter |

Response:

```json
{
  "success": true,
  "items": [
    {
      "title": "...",
      "platform": "showcase",
      "url": "...",
      "capturedAt": 0,
      "matchedKeywords": ["发那科"]
    }
  ],
  "meta": {
    "filtered": true,
    "effectiveKeywords": ["..."],
    "rawCount": 40,
    "matchedCount": 3
  }
}
```

**Showcase hub:** `getResearchShowcase` may keep an unfiltered or lightly filtered pulse for backward compatibility, **or** call the same filter helper so hub and dedicated pulse stay consistent. **Prefer shared helper** so 市场动态 on the hub uses effective keywords.

## UI

### 市场动态 section (ResearchIndexPage)

1. Chip row of **effective** keywords (truncate with “+N”).  
2. Click chip → temporary single-keyword filter (client or `?focus=`) until cleared.  
3. List: platform chip + relative time (existing) + title; optional small matched-keyword badges.  
4. Soft empty: when `matchedCount===0` && `rawCount>0` → banner + **显示全部** (`all=1`).  
5. **管理关键词** button → dialog/sheet.

### 管理关键词 dialog

- Sections: 默认词 (from seed groups, toggle → enabled/excluded), 自定义 (add/remove).  
- Save → PUT → refresh pulse.  
- Cancel discards local edits.

zh-Hans default copy for all new strings (i18n keys with Chinese `defaultValue`).

## Ingest gate (layer 2 — not v1 default)

| Item | Spec |
|------|------|
| Env | `RESEARCH_PULSE_INGEST_FILTER` ∈ {1,true,yes,on} |
| Default | **off** |
| Behavior when on | Worker may skip **signal projection** for titles with zero keyword hits; **still upsert news** so operators can inspect unfiltered corpus |
| Keyword source when on | Same effective merge would require worker to load seed + workspace (heavier) — **defer implementation**; document only in v1 |

v1 ships **read-path only**.

## Error handling

| Case | Behavior |
|------|----------|
| Seed file missing | API 500 with clear error; do not invent empty product |
| Workspace get fail | Fall back to seed defaults; log |
| PUT validation fail | 400 with field errors |
| Pulse news list fail | Existing research error path |

## Testing

| Layer | Cases |
|-------|--------|
| Pure merge | seed only; +custom; +excluded; exclude-all → seed fallback; enabled additive |
| Pure filter | 发那科 title hit; Latin case; no match excluded; limit after filter |
| Pack load | real YAML loads; groups + defaults present |
| Routes | GET keywords; PUT then GET; GET pulse filtered; `all=1` unfiltered |
| UI | chips; soft empty + 显示全部; dialog save (mocked APIs); showcase badge honesty unchanged on golden cards |

No live NewsNow required.

## Implementation sequence (for plan skill)

1. Seed YAML + pack loader + pure merge/filter + unit tests  
2. Workspace get/put via `workspaceConfigService` + routes  
3. `GET /api/research/pulse` + wire showcase hub helper  
4. Hub chips + soft empty + 管理关键词 dialog  
5. Focused vitest; optional live smoke  

## Success criteria

1. Fresh workspace with no prefs: pulse filter uses **seed CNC keywords**.  
2. Workspace excludes a keyword: that keyword no longer matches (unless exclude-all → seed fallback).  
3. Custom keyword appears in effective and can match a title.  
4. Soft empty when filter kills all rows but raw news exist; **显示全部** restores list.  
5. Showcase platform labels and golden **展示数据** honesty unchanged.  
6. Ingest path unchanged in v1 (flag documented only).

## Spec self-review

| Check | Result |
|-------|--------|
| Placeholders | None intentional |
| Consistency | Workspace key, merge rules, and fallback aligned across sections |
| Scope | v1 = seed + workspace + read filter + UI; ingest gate design-only |
| Ambiguity | Empty effective → seed fallback (locked); `all=1` unfiltered (locked) |
| Dual truth | Seed is git defaults; workspace is overlay only — no dual write to YAML |
