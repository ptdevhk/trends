# Research Hotlist Platform Select — NewsNow Catalog + Workspace Ingest Set

**Status:** Approved for implementation plan (brainstorm 2026-07-22)  
**Branch context:** local `main` (Research Eng thin vertical, pulse keywords, showcase hub shipped)  
**Related:**  
- `docs/superpowers/specs/2026-07-22-research-eng-productional-thin-vertical-design.md`  
- `docs/superpowers/specs/2026-07-22-research-pulse-keywords-design.md` (workspace overlay pattern)  
- `docs/superpowers/research/2026-07-21-research-eng-pr7-cutover-precondition.md`  
- Upstream catalog donors (ideas only, not bulk merge):  
  - [ourongxing/newsnow](https://github.com/ourongxing/newsnow) — platform `id` = `server/sources/*`  
  - [TrendRadar platforms docs](https://trendradar.sandev.cc/zh/docs/platforms/) — config shape + discovery  
  - Community platform list: [sansan0/TrendRadar#95](https://github.com/sansan0/TrendRadar/issues/95)  
- Workspace config: `packages/convex/convex/workspace_config.ts`, `apps/api/src/services/workspace-config-service.ts`

## Problem

| Today | Gap |
|-------|-----|
| **Hotlist platforms** | Fixed by `config/config.yaml` `platforms.sources` (11 IDs); no desk control |
| **NewsNow catalog** | Upstream exposes many more sources than we surface; operators must edit YAML |
| **Workspace** | Pulse keywords are workspace-scoped; **ingest platforms are global only** |
| **HR desk honesty** | 市场动态 can show real Zhihu/Douyin URLs while CNC company pages stay showcase-seed dense — hard to steer which **sources** feed the next ingest |
| **TrendRadar distill** | Platform select is a donor idea only; not a Research hub product surface |

HR/ops need a **curated platform catalog** (NewsNow IDs) and a **workspace-controlled ingest set** so the next Research Eng run pulls the right hotlists without redeploying config for every experiment.

## Goal

1. **Catalog (seed pack):** Repo YAML of NewsNow-compatible platform IDs grouped for desk display (general CN, finance, video, etc.), derived from TrendRadar/NewsNow options.  
2. **Workspace overlay:** Shared desk prefs — enable/disable defaults, exclude noise platforms.  
3. **Ingest set (v1 ship):** Effective platform IDs drive **`ResearchIngestJob` platforms** for the workspace on the next run (not pulse-only filter).  
4. **Desk UI:** Research hub “数据源” dialog: multi-select by group, save, optional run ingest.  
5. **API:** List catalog + workspace state; PUT overlay; ingest path accepts workspace-effective platforms.

## Non-goals

- Full TrendRadar crawl / AI analyze / multi-channel notify stack  
- Permanent import of donor `DataFetcher` / `NewsAnalyzer`  
- PR7 hard cut of legacy SQLite product path  
- Self-hosting NewsNow as a required dependency (ops may still set `RESEARCH_HOTLIST_API_URL`)  
- Dynamic scrape of every NewsNow `server/sources` file at runtime (v1 is **curated pack**; refresh is a docs/PR process)  
- Per-user platform lists (v1 is **workspace-shared**, same as pulse keywords)  
- Pulse platform chips as the primary control (optional follow-up after ingest set ships)  
- RSS feed multi-select in the same dialog (RSS stays YAML/`rss.sources` for this slice)  
- Production deploy / origin push as part of design approval  

## Locked decisions

| Topic | Choice |
|-------|--------|
| Product surface | **Both thin vertical** — catalog API + desk multi-select + workspace overlay |
| Primary control | **Ingest set** — workspace effective IDs become platforms fetched on next run |
| Secondary (later) | Pulse platform filter chips — out of v1 scope |
| ID contract | **NewsNow-compatible** platform `id` strings only (`weibo`, `zhihu`, `cls-hot`, …) |
| Catalog source | **Curated seed pack** in repo, not live scrape of GitHub tree |
| Prefs + seed | Workspace prefs + repo seed (mirror pulse keywords) |
| Auth | Same gate as `/api/research/*` (workspace user or admin) |
| Empty / exclude-all | **Fall back to seed defaults** (cannot hard-empty ingest by accident) |
| Global YAML role | `config/config.yaml` platforms remain **ops fallback** when no workspace overlay exists (worker CLI / non-workspace runs) |
| Config key | `research.hotlistPlatforms` on `workspace_config` |
| Domain check | Optional `expectedDomain` in seed for **docs + future validation**; v1 does not hard-drop items on domain mismatch (avoid false negatives on mobile/share URLs) |
| Showcase honesty | Unchanged: showcase seed evidence is not live; live NewsNow URLs remain real `http(s)` |

## Architecture

```text
config/research_hotlist_platforms.yaml   # curated NewsNow IDs (git)
config/config.yaml platforms.sources     # ops fallback / parity windows
        │
workspace_config[research.hotlistPlatforms]
  { version: 1, enabled: string[], excluded: string[] }
        │ pure merge → effectivePlatformIds[]
        ▼
GET  /api/research/platforms
PUT  /api/research/platforms
POST /api/research/ingest/run   # already exists; resolve workspace → effective IDs
        │
apps/worker ResearchIngestJob(platforms=effective | yaml fallback)
  NewsNowHotlistPort  GET {api}?id={platformId}&latest
        │
Convex news_items → resolveAlias → research_signals
        │
ResearchIndexPage 数据源 dialog + optional run ingest
```

| Piece | Role |
|-------|------|
| Seed YAML | Catalog + default enabled set; versioned in repo |
| Pure merge | `mergeHotlistPlatforms(seed, workspace) → effectiveIds` |
| BFF routes | Load seed, get/put workspace overlay |
| Ingest | Pass effective IDs into worker job when workspace known |
| Hub UI | Grouped multi-select, save, soft validation |

## Seed pack

**Path:** `config/research_hotlist_platforms.yaml`

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

# Defaults bias CNC/HR desk toward finance + major CN portals (not pure entertainment).
defaults:
  - weibo
  - zhihu
  - baidu
  - wallstreetcn-hot
  - cls-hot
  - thepaper
```

### Catalog maintenance

- IDs must remain valid for the configured NewsNow-compatible API (`RESEARCH_HOTLIST_API_URL` or default `https://newsnow.busiyi.world/api/s`).  
- Adding a platform = PR to seed YAML (and optionally `config/config.yaml` for ops parity).  
- Do **not** auto-pull GitHub `server/sources` in production path in v1.

## Workspace overlay

**Key:** `research.hotlistPlatforms`

```ts
type HotlistPlatformsWorkspaceValue = {
  version: 1
  /** When non-empty: start from this list; when empty: use seed.defaults */
  enabled: string[]
  /** Always removed from effective */
  excluded: string[]
}
```

### Merge rules (pure)

1. Start with `enabled` if non-empty; else `seed.defaults`.  
2. Drop any id not present in catalog.  
3. Remove every id in `excluded`.  
4. If result is empty → **fall back to seed.defaults** (then re-apply exclude only if that still leaves ≥1; if exclude would wipe all defaults, ignore excludes that empty the set and log warning in API).  
5. Preserve catalog order for stable UI.

Mirror validation limits from pulse keywords where useful (max list length, non-empty strings, max id length).

## API

### `GET /api/research/platforms`

Auth: workspace user.

Response:

```json
{
  "success": true,
  "seed": { "version": "v1", "groups": [...], "defaults": ["weibo", "..."] },
  "workspace": { "version": 1, "enabled": [], "excluded": [] },
  "effective": ["weibo", "zhihu", "..."]
}
```

### `PUT /api/research/platforms`

Body: partial `{ enabled?: string[], excluded?: string[] }`  
Validates ids against catalog; upserts workspace config; returns same shape as GET.

### Ingest integration

Existing `POST /api/research/ingest/run` (and CLI once-run):

1. Resolve workspace slug (header / auth context; default `hr` only where already used).  
2. Load effective platform ids via merge helper.  
3. Proxy/trigger worker with **platforms override** (env or request body already used for research ingest — extend the minimal contract).  
4. Worker `ResearchIngestJob(..., platforms=override or yaml fallback)`.

If worker cannot receive per-run platforms yet, **v1 plan must add that parameter** before claiming done — do not only store prefs without wiring ingest.

## Desk UI

**Entry:** Research hub header / 市场动态 section — button **数据源** (alongside 管理关键词).

**Dialog:**

- Grouped checkboxes (seed groups)  
- Show effective count  
- Save → PUT  
- Optional secondary: **运行抓取** after save (reuse existing ingest button path)  
- Empty-state copy: “将使用默认平台集” when workspace has never saved  

**Not in v1 dialog:** RSS toggles, domain health matrix, per-platform last-error (nice follow-up).

## Worker / ports (unchanged contract)

Keep:

- `NewsNowHotlistPort` → `GET {base}?id={platformId}&latest`  
- Soft-fail per platform  
- `parse_newsnow_payload` status `success` | `cache`  
- Real item `url` / `mobileUrl` stored as-is  

Do not:

- Import TrendRadar crawler modules on product path  
- Treat showcase seed URLs as live evidence (existing UI honesty rules)

## Data honesty (product)

| Row type | Link behavior |
|----------|----------------|
| Live NewsNow item with `https://…` | Title/source open real URL |
| Showcase seed (`platform: showcase`, `*.local`) | Label 展示数据; no fake external evidence link |
| Test fixtures | Use `example.invalid` only in tests — never `weibo.com/example/...` |

## Testing

| Layer | Coverage |
|-------|----------|
| Pure merge | defaults, enabled, excluded, unknown ids dropped, empty fallback |
| Seed load | YAML parse + catalog id uniqueness |
| API | GET/PUT auth, validation 400, effective list |
| Worker | Job honors platforms override; yaml fallback when override null |
| Web | Dialog renders groups; save calls PUT; hub shows effective summary |

No live NewsNow network required for unit tests (fixtures only).

## Rollout

1. Land seed + pure merge + API (read-only GET first if needed).  
2. Wire PUT + workspace key.  
3. Wire ingest platforms override end-to-end.  
4. Hub 数据源 dialog.  
5. Operator note: document `RESEARCH_HOTLIST_API_URL` / proxy still apply.

## Success criteria

| # | Criterion |
|---|-----------|
| 1 | Catalog lists curated NewsNow IDs with groups in GET `/api/research/platforms` |
| 2 | PUT updates workspace overlay; effective list is non-empty and catalog-valid |
| 3 | Next `ingest/run` for that workspace fetches **only** effective platforms (or soft-fails per platform) |
| 4 | Desk dialog can change set without editing `config/config.yaml` |
| 5 | Focused unit/route/web tests pass without live hotlist dependence |
| 6 | No product path claims showcase evidence as live market links |

## Follow-ups (explicitly later)

- Pulse filter by platform chip (view-only)  
- RSS multi-select in same dialog  
- `expectedDomain` soft validation on ingest  
- Self-hosted NewsNow operator guide  
- Expand catalog from community list / NewsNow tree via periodic curated PR  

## Sources Used

Local repository sources:

- `apps/worker/research_ports.py`, `apps/worker/research_ingest.py`  
- `config/config.yaml` platforms section  
- `docs/superpowers/specs/2026-07-22-research-eng-productional-thin-vertical-design.md`  
- `docs/superpowers/specs/2026-07-22-research-pulse-keywords-design.md`  
- `docs/superpowers/research/2026-07-21-research-eng-pr7-cutover-precondition.md`  
- Wiki: `projects/trendradar/work/2026-07-21-research-eng-full-distill/README.md` (status may lag shipped code)  

External (freshness / catalog):

- https://trendradar.sandev.cc/zh/docs/platforms/  
- https://github.com/ourongxing/newsnow  
- https://github.com/sansan0/TrendRadar/issues/95  
