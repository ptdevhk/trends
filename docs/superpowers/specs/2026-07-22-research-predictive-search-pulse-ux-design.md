# Research Hub Predictive Search + Pulse Scanability — Design

**Status:** Approved for implementation plan (brainstorm 2026-07-22)  
**Branch context:** local `main` (showcase hub + industry→research adapter bridge A/B/C shipped)  
**Related:**  
- `docs/superpowers/specs/2026-07-22-research-showcase-hub-design.md`  
- Industry bridge: `apps/api/src/services/research-industry-bridge.ts`  
- TrendRadar distill (ideas only): `docs/superpowers/specs/2026-07-21-research-eng-full-distill-design.md`  
- Resume desk parity pattern: `apps/web/src/components/search/GoogleSearchBar.tsx`

## Problem

| Surface today | Pain |
|---------------|------|
| **搜索企业** | Submit-only form → full list after click; no as-you-type prediction |
| **市场动态** | Flat title list; weak platform/time scanability; no company resolve chips |
| **Resume desk** | Working prediction: combobox, recent, keyboard, debounce-adjacent UX |
| **TrendRadar distill** | Company-centric + hotlist/platform ranks as **ideas** — not full notify/report stack |

HR on `/hr/research` should find CNC companies the same way they search resumes: type → predictions → open.

## Goal

1. **Primary:** Make **搜索企业** a working predictive combobox (industry-data bridge + recent opens), nameCn-first, navigates to company research.  
2. **Secondary:** Improve **市场动态** scanability (platform chip, relative time, optional resolvable-company chip) without building a second product.

## Non-goals

- AI-assisted suggest  
- Unified omnibox that filters pulse + companies in one query box as the only path  
- Global Cmd/Ctrl+K that steals focus from the resume desk  
- Full TrendRadar frequency_words editor, Telegram notify, HTML report megamodule  
- CRM / auto company-policy write  
- Replacing industry bridge identity rules (canonicalKey + legacy pro-technic / polywell)  
- Production deploy / origin push  

## Locked decisions

| Topic | Choice |
|-------|--------|
| Lead slice | Predictive **搜索企业** first |
| Prediction sources v1 | **Industry bridge** + **recent opens** (localStorage); no AI |
| Approach | Client typeahead on existing/extended industry APIs (Approach A) |
| Row labels | **nameCn-first**; EN secondary; `companyKey` mono |
| Persona on navigate | `?persona=hr` from hub |
| Pulse | Secondary polish only; honest feed (live + showcase items already mixed at data layer — do not relabel seed pulse as live if platform is showcase) |
| Cmd+K | **Page-local** focus of research search input only |

## Architecture

```text
ResearchIndexPage
  ResearchCompanyPredictInput   (new, research-scoped component)
       │ debounce ~250ms
       ├─ localStorage recent opens (cap 8)
       ├─ GET /api/research/industry?limit=&q=   (CNC inventory + optional q filter)
       └─ GET /api/research/industry/resolve?q=  (pin exact/alias hit at top)
       │
       └─ navigate /:teamSlug/research/:companyKey?persona=hr
            + write recent open

  ResearchPulseSection          (inline or small extract)
       └─ GET showcase pulse / news list (existing)
            chips: platform, relative time
            optional: resolve title → nameCn link when industry resolve hits
```

| Piece | Role |
|-------|------|
| `ResearchCompanyPredictInput` | Combobox UI + debounce + recent + fetch; **not** a full `GoogleSearchBar` clone |
| Industry browse `q` | Optional query param: filter bridge entities by nameCn/nameEn/aliases/companyKey (server-side preferred) |
| Industry resolve | Already shipped; pin best hit when matchTier is not miss |
| `/api/research/companies/search` | Remains fallback for full “submit results list” if kept; typeahead does **not** require it for v1 |

### Identity (unchanged)

- New keys: `resolveEntity.canonicalKey` (e.g. FANUC → `fanuc`)  
- Legacy: 宝力机械 → `pro-technic-machinery`, 宝惠 → `polywell`  
- Resolve pin and list filter must use shipped bridge map — do not reinvent slugs  

## Interaction model — 搜索企业

### Empty / focus

Dropdown when focused and data exists:

1. **最近打开** — localStorage key e.g. `trends.research.recentCompanies.v1`  
   Shape: `{ companyKey, nameCn, nameEn?, openedAt }[]`, max 8, newest first  
2. **展示推荐** (optional short group) — when recent empty or as ≤4 golden chips from current showcase golden `nameCn` / `companyKey` (navigation only; not a density claim)

### Typing (debounced ~250ms)

1. Call `GET /api/research/industry?limit=24&q={trimmed}` (or client-filter cached CNC list if `q` not yet on API — prefer server `q` in same PR)  
2. Call `GET /api/research/industry/resolve?q={trimmed}`  
3. If resolve `hit` present, **pin** that row at top (dedupe by companyKey)  
4. Remaining rows: nameCn-first list from industry filter  

### Row layout

```
发那科                         fanuc
FANUC · 加工中心/数控车床
```

- Primary: `nameCn` (fallback displayName)  
- Secondary line: `nameEn` + optional `type`  
- Trailing mono: `companyKey`  

### Keyboard / a11y

Mirror resume combobox contract (not full chrome):

- `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, `aria-activedescendant`  
- ArrowUp/Down, Enter selects active, Escape closes listbox (and clears highlight)  
- Click outside closes  

### Select

1. `navigate(\`/${teamSlug}/research/${encodeURIComponent(companyKey)}?persona=hr\`)`  
2. Upsert into recent opens  

### Submit button

Keep a secondary **搜索** button that fills the results list under the bar (existing behavior) for discoverability. **Enter** while an option is active selects the option first; if no option active, Enter runs the list search fallback.

### Empty query results

- No match: “无匹配企业。可试 发那科 / 宝力机械，或加载展示数据。”  
- Loading: inline spinner in listbox, not full-page block  

## Interaction model — 市场动态 (secondary)

| Element | Behavior |
|---------|----------|
| Order | `capturedAt` descending (existing) |
| Platform chip | Show `platform` (e.g. showcase, weibo) |
| Time | Relative time from `capturedAt` (zh-Hans-friendly short form) |
| Company chip | If client can resolve a surface in title (optional batch or single resolve for short titles): show **nameCn** link to research page; else omit |
| URL | Keep external link when `url` present |
| Empty | Existing “运行实时抓取” / empty copy |

Do **not** claim showcase platform rows as live market intel beyond existing honesty elsewhere on the hub.

## API changes (minimal)

### Extend `GET /api/research/industry`

| Query | Type | Behavior |
|-------|------|----------|
| `limit` | number | existing |
| `includeNonCnc` | boolean | existing |
| `q` | string optional | Case/normalize-insensitive filter over nameCn, nameEn, aliases, companyKey; still CNC-first default |

Response shape unchanged: `{ success, items: BridgeEntity[] }`.

### Existing (no change required for v1)

- `GET /api/research/industry/resolve?q=`  
- `GET /api/research/showcase` pulse array  
- `GET /api/research/news` if pulse ever switches off showcase-only  

## UI structure

Prefer **extract** `ResearchCompanyPredictInput` under `apps/web/src/components/research/` so `ResearchIndexPage` stays hub layout.

Optional small helpers:

- `researchRecentCompanies.ts` — load/save recent (pure + localStorage)  
- Relative time util (reuse project helper if one exists; else minimal local)  

zh-Hans defaults for new copy (i18n keys with Chinese defaultValue, matching current hub).

## Error handling

| Case | UX |
|------|----|
| Industry API 401/403 | Same workspace auth as rest of research; show section error string |
| Industry API 5xx / network | Keep last good predictions if any; else error under input |
| Resolve fails | List filter only; no pin |
| localStorage blocked | Skip recent; typeahead still works |

## Testing

| Layer | Cases |
|-------|--------|
| API | `q=发那` / `fanuc` returns fanuc with nameCn 发那科; `q=宝力` includes pro-technic-machinery if in inventory via override; empty `q` still CNC list |
| Pure recent helper | upsert + cap 8 + order |
| Web combobox | focus shows recent mock; type triggers industry GET with q; resolve pin first; Enter navigates with persona=hr; showcase badge honesty on golden cards unchanged |
| Pulse | still renders platform + title; no regression on empty |

No flaky live NewsNow required for this UX slice.

## Implementation sequence (for plan skill)

1. Industry browse `q` filter + route/service tests  
2. Recent opens pure helper + unit tests  
3. `ResearchCompanyPredictInput` + hub wire-up + component tests  
4. Pulse chips / relative time / optional resolve chip  
5. Focused vitest green; manual smoke on `/hr/research` if stack up  

## Success criteria

1. Typing a CNC surface (e.g. 发那科 / FANUC) shows a prediction row with **nameCn-first** and correct `companyKey` without pressing Search first.  
2. Selecting a prediction opens company research with `persona=hr` and appears under 最近打开 on next focus.  
3. 宝力机械 prediction (when shown) uses `pro-technic-machinery`, not a forced rename.  
4. 市场动态 remains readable with platform + time; no false “live” labeling of showcase seed.  
5. Focused unit/route/web tests cover the above without AI or live hotlist dependence.  

## Spec self-review

| Check | Result |
|-------|--------|
| Placeholders | None intentional; relative-time helper may reuse existing util if found in plan |
| Consistency | Identity matches bridge design; pulse secondary to search |
| Scope | Single UX slice: predict search + light pulse; no notify/CRM |
| Ambiguity | Enter-with-active-option vs list search: active option wins; documented above |
| Dual truth | Typeahead uses industry bridge as source of truth for predictions, not dual K3 invent |
