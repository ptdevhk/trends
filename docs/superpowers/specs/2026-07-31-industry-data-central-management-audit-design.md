# Industry Data Central Management + Evidence-Progress Audit — Design

- **Date:** 2026-07-31
- **Status:** Approved (all 6 design sections accepted)
- **Scope:** Phase A of a phased cutover. Convex becomes the canonical store for CN industry data; `config/industry-data/` files are generated from it and auto-committed. Ingest continues to read the files unchanged. Phase B (flip ingest to read Convex directly, retire file dependency) is a separate, later spec.
- **Related:** industry-maintenance-ops-automation (merged `8aa21909`) — supplies the `industry_maintenance_runs` / `industry_maintenance_ledger` tables and the `enqueueIndustryMaintenance` pipeline reused here.

## Problem

CN industry data (`config/industry-data/`: `brands.json`, `keywords-structured.md`, `keywords-raw.md`, `company-urls.md`) is hand-edited on disk and feeds the ingest scoring pipeline via the public, read-only `/api/industry/*` routes (`IndustryDataService`). There is:

1. No admin surface to view, edit, validate, import, or export the data.
2. No audit trail of *who* changed *what* (only `git blame` after the fact).
3. No unified view of evidence progress — the maintenance-run ledger exists per-proposal, but operators can't see an employer's full story (data edits + research actions) in one place, and can't re-research a single employer out-of-band.

## Decisions (locked, all recommended)

| Topic | Decision |
|---|---|
| Scope | All three surfaces as one cohesive admin section: control center + central management + audit |
| Persistence | Convex canonical + files generated + auto git commit |
| Cutover | **Phased.** Phase A: Convex write + generated files (ingest unchanged). Phase B: flip read later (separate spec). |
| Data-edit audit | Row-level change log + git sha per edit |
| Audit surface | Unified timeline (data-edits + maintenance-ledger, filterable) |
| Trigger control | Full: manual + pause/resume + scoped "research this employer now" |

## Architecture

New admin section **"Industry Data"** (`/dev/system/industry-data`, nav sibling to Verification / Operations / Config Sources) with three tabs — Manage, Control center, Audit — backed by two new Convex tables plus the two existing maintenance tables, and a file-generator service keeping `config/industry-data/` in sync.

```
Web Admin (3 tabs) → /api/industry-data/* (requireAdmin) →
  Convex mutations (entries + change_log)  |  Convex queries (audit join)
      | regenerate
  Generator → config/industry-data/*.md/json → auto git commit → sha to change_log
  Ingest + /api/industry read these files (UNCHANGED in Phase A)

Existing (ops-automation, unchanged):
  industry_maintenance_runs / industry_maintenance_ledger  ← joined into audit timeline
```

**Key constraint:** Phase A keeps ingest reading the files. Convex is canonical for edits, but the files the generator produces must be byte-compatible with what `IndustryDataService.loadAll()` parses today — ingest/verify/brand-match see zero behavior change. A golden test locks this.

## Data model (Convex, new)

### `industry_data_entries` — canonical store

| field | type | notes |
|---|---|---|
| `entryType` | union(`company`, `keyword`, `brand`, `url`) | |
| `entryId` | string | stable id, e.g. `brand-mazak`, `company-1001` |
| `data` | `v.any()` | typed payload per entryType (below) |
| `sortOrder` | optional number | preserve file ordering for stable regeneration |
| `createdAt` / `updatedAt` / `updatedBy` | number / number / string | |

Indexes: `by_type (entryType)`, `by_entry_id (entryId)`.

`data` payload per type (mirrors existing file shapes so regeneration is lossless):
- **company**: `{id, nameCn, nameEn?, type, category}` (`key_company` | `ites_exhibitor` | `agent`)
- **keyword**: `{id, keyword, english?, category}` (`machining` | `lathe` | `edm` | `measurement` | `smt` | `3d_printing`)
- **brand**: `{id, nameCn, nameEn?, type, origin}` (`international` | `domestic` | `agent`)
- **url**: `{url}`

### `industry_data_change_log` — row-level audit

One row per create/update/delete:

| field | type | notes |
|---|---|---|
| `changeId` | string | |
| `entryType` / `entryId` | string | |
| `action` | union(`create`, `update`, `delete`) | |
| `actor` | string | admin user id / email |
| `before` / `after` | optional `v.any()` | prior / new data payload |
| `gitSha` | optional string | set once auto-commit lands; `null` = commit failed |
| `createdAt` | number | |

Indexes: `by_entry (entryType, entryId)`, `by_created (createdAt)`, `by_company_key (companyKey)` (optional, for the audit-timeline join with maintenance ledger).

### Reused unchanged

`industry_maintenance_runs`, `industry_maintenance_ledger` (from ops-automation) — joined into the audit timeline. `triggerContext` (optional free-form string) carries the scoped `companyKey` with no schema change.

## Components

### `IndustryDataAdminService` (new, `apps/api/src/services/industry-data-admin-service.ts`) — write path
- `createEntry / updateEntry / deleteEntry(entryType, payload, actor)` → validate, Convex mutation, then regenerate + commit, return `{entry, gitSha, warning?}`.
- `importEntries(entries, actor)` → bulk upsert in one transaction + one regenerate/commit (one change-log row per entry, shared gitSha).
- `exportEntries(entryType?)` → canonical entries as JSON; file-shaped download for the `.md`/`.json` types.
- Validation reuses the `CompanyEntry / KeywordEntry / BrandEntry` zod schemas from `apps/api/src/routes/industry.ts`, moved into a shared validators module so read and write paths use one source.

### `IndustryDataGenerator` (new, `apps/api/src/services/industry-data-generator.ts`) — sync-back path
- `regenerateAndCommit(): Promise<{sha}>` — read all entries from Convex, render `brands.json` / `keywords-structured.md` / `company-urls.md` in their exact current formats, write to `config/industry-data/`, `git add` + `commit` (`chore(industry-data): admin edit by <actor>`), return the sha. On git failure it still writes the files but records `gitSha: null` and surfaces a warning — never throws into the CRUD response.
- The renderer must round-trip byte-compatibly against `IndustryDataService.loadAll()` (golden test, below).

### `IndustryAuditService` (new, `apps/api/src/services/industry-audit-service.ts`) — unified audit query
- Joins `industry_data_change_log` + `industry_maintenance_ledger` (optionally `company_industry_evidence_checks`) by `companyKey`, sorts by time desc, paginates. Powers the Audit tab.

### Routes (new admin-gated router `apps/api/src/routes/industry-data-admin.ts`, mounted at `/api/industry-data/*`, behind `requireAdmin`)
- `GET /api/industry-data/entries`, `POST /api/industry-data/entries` (list + bulk import)
- `PUT /api/industry-data/entries/{entryId}`, `DELETE /api/industry-data/entries/{entryId}`
- `GET /api/industry-data/export`
- `GET /api/industry-data/audit`
- `POST /api/industry-data/trigger` — scoped trigger; body `{companyKey}` → `enqueueIndustryMaintenance({workspaceSlug, triggerSource:"manual", triggerContext: companyKey})`

The existing `/api/industry/*` public read routes stay untouched (separate router, not gated).

## Data flow (edit path)

1. Admin edits a brand → `PUT /api/industry-data/entries/brand-mazak`.
2. API (requireAdmin + CSRF): zod-validate → `updateEntry` → (a) Convex upsert to `industry_data_entries`, (b) Convex append to `industry_data_change_log` (actor/action/before/after, `gitSha: null`).
3. `regenerateAndCommit()` → render + write files → `git add`+`commit` → update the change-log row's `gitSha`; on git failure leave `gitSha: null` + attach warning.
4. Return `{success, entry, gitSha, warning?}`; web toasts accordingly. Audit tab shows the new row. Ingest reads the regenerated file next cycle — identical shape, zero behavior change.

**Scoped trigger:** `POST /trigger {companyKey}` → `enqueueIndustryMaintenance(..., triggerContext: companyKey)` (existing coalescing pipeline) → worker ledger rows → Audit unified timeline.

**Import:** paste/upload JSON/CSV → `POST /entries` bulk → single Convex transaction upserts all → single regenerate+commit → per-entry change-log rows sharing one gitSha.

## Error handling

- **Convex write fails** → 500, no regenerate/commit, nothing half-written (Convex mutation is atomic).
- **Regenerate succeeds, git commit fails** (dirty tree, no git access, prod pinned to hotfix) → files still written, `gitSha: null` on the change-log row, response carries `warning`; web shows warning toast. `gitSha: null` is the visible marker in the Audit tab.
- **Validation failure** → 400 with field errors, no Convex write, no regenerate.
- **Import partial failure** → single Convex transaction; any invalid entry rejects the whole import with per-entry errors (all-or-nothing).
- **Concurrent edits** → Convex mutations serialize; last-write-wins on `updatedAt`. Change-log keeps both edits; regenerate always renders from current Convex state so the file is never stale-relative-to-Convex.
- **Regenerate produces unparsable files** → golden test prevents at build time; at runtime files are written before commit, so a failed `git commit` still leaves correct files on disk to commit manually.

## Testing

- **Convex** (`convexTest`, `__tests__/industry-data-admin.test.ts`): seed entries; upsert/update/delete each type; change-log rows with before/after + actor; list queries; import all-or-nothing.
- **Generator golden test** (`__tests__/industry-data-generator.test.ts`): seed Convex matching current file content, run renderer (git stubbed), assert generated bytes are identical to committed files. Also `gitSha: null` path on commit failure.
- **API** (vitest): `requireAdmin` enforced; validation rejects bad payloads; CRUD calls service; scoped trigger passes `triggerContext = companyKey`; audit query joins both tables.
- **Web** (vitest + Testing Library): three tabs render; Manage list + edit form; Control center buttons; Audit filters; warning toast on `gitSha: null`.
- **Integration (attended live verify, final task):** real edit → file regenerated identically-shaped → commit lands → audit row shows gitSha → scoped trigger enqueues a run → ledger rows appear in the unified timeline.

## Non-goals

- **Phase B** — flipping `IndustryDataService` / ingest to read Convex directly and retiring the file dependency. Separate spec.
- `keywords-raw.md` (raw text reference, not machine-parsed by ingest) — left hand-edited; not in scope for central management unless a later need arises.
- Production deployment — all work is local dev-loop scope. Prod is pinned to a hotfix; no deploy here.
- Human approval of company-industry verdicts stays manual forever (unchanged governance).
