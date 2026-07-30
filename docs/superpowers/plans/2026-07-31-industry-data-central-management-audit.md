# Industry Data Central Management + Evidence Audit — Implementation Plan

- **Date:** 2026-07-31
- **Spec:** `docs/superpowers/specs/2026-07-31-industry-data-central-management-audit-design.md` (Approved)
- **Execution mode:** subagent-driven-development (user chose option 1)
- **Scope:** Phase A only. Convex canonical for CN industry data; `config/industry-data/` files regenerated + auto-committed; ingest keeps reading files unchanged.

> **For agentic workers:** REQUIRED SUB-SKILL — use `superpowers:subagent-driven-development` to implement this plan task-by-task, or `superpowers:executing-plans` for inline. Each task is TDD: write failing test → verify red → implement → verify green → commit.

## Global Constraints

- Phase A only — ingest still reads `config/industry-data/` files; do **not** flip `IndustryDataService` read path to Convex.
- Generator output must be byte-compatible with what `IndustryDataService.loadAll()` parses today (golden test locks this).
- All new write routes require `requireAdmin` + CSRF.
- Snake_case Convex table names (repo convention).
- `keywords-raw.md` is out of scope.
- Human approval of company-industry verdicts stays manual.
- Local dev-loop only; no prod deploy.
- Git commit on edit is best-effort: on failure, files still written, `gitSha: null`, warning returned — never throw into the CRUD response.

---

### Task 1: Convex tables + CRUD + change-log + schedule-pause flag

**Files:**
- Modify: `packages/convex/convex/schema.ts` (append two tables before the closing `});` of `defineSchema`)
- Modify: `packages/convex/convex/companies.ts` (append functions after the last industry-maintenance function)
- Test: `packages/convex/__tests__/industry-data-admin.test.ts` (NEW)

**Interfaces produced:**
- `companies:upsertIndustryDataEntry({ entryType, entryId, data, sortOrder?, actor, writeSecret }) → { entryId }`
- `companies:deleteIndustryDataEntry({ entryId, actor, writeSecret }) → { ok: true }`
- `companies:listIndustryDataEntries({ entryType?, writeSecret }) → Entry[]`
- `companies:getIndustryDataEntry({ entryId, writeSecret }) → Entry | null`
- `companies:appendIndustryDataChange({ changeId, entryType, entryId, action, actor, before?, after?, companyKey?, gitSha?, writeSecret }) → { changeId }`
- `companies:setIndustryDataChangeGitSha({ changeId, gitSha, writeSecret }) → { ok: true }`
- `companies:listIndustryDataChanges({ entryType?, entryId?, companyKey?, limit?, writeSecret }) → Change[]` (newest-first)
- `companies:setIndustryMaintenanceSchedulePaused({ paused, writeSecret }) → { paused }`
- `companies:getIndustryMaintenanceSchedulePaused({ writeSecret }) → { paused: boolean }`

**Steps:**
1. Read `packages/convex/__tests__/test-helpers.js` (or `.ts`) to confirm the `createTest()` harness signature and how `writeSecret` / `CONVEX_WRITE_SECRET` is supplied. Read the existing `industry_maintenance_runs`/`industry_maintenance_ledger` functions in `companies.ts` for the `requireWriteSecret` pattern and the `system_settings` maintenance-mode flag pattern (grep `maintenanceMode`).
2. Write the failing test `industry-data-admin.test.ts`: (a) upsert → append change → list → update → set gitSha → list changes newest-first → delete; (b) write without secret rejects; (c) schedule pause toggles false→true.
3. Run `cd packages/convex && npx vitest run __tests__/industry-data-admin.test.ts` — expect FAIL (functions/tables undefined).
4. Add the two schema tables:
   - `industry_data_entries`: `entryType` union(company|keyword|brand|url), `entryId` string, `data` v.any(), `sortOrder?` number, `createdAt`/`updatedAt` number, `updatedBy` string. Indexes `by_type (entryType)`, `by_entry_id (entryId)`.
   - `industry_data_change_log`: `changeId` string, `entryType`/`entryId` string, `action` union(create|update|delete), `actor` string, `before?`/`after?` v.any(), `companyKey?` string, `gitSha?` string, `createdAt` number. Indexes `by_entry (entryType, entryId)`, `by_created (createdAt)`, `by_company_key (companyKey)`.
5. Implement the functions following the existing `requireWriteSecret` pattern. Upsert = find by `by_entry_id`, patch if exists else insert with `createdAt`. `listIndustryDataChanges` sorts newest-first, default limit 50 / max 200. Schedule pause reuses `system_settings` key `industryMaintenanceSchedulePaused` (boolean; missing → false).
6. Run test — expect PASS (all cases).
7. Commit: `feat(convex): industry_data_entries + change_log tables and admin mutations`.

---

### Task 2: Seed importer + file generator + golden round-trip test

**Files:**
- Create: `apps/api/src/services/industry-data-generator.ts`
- Create: `apps/api/src/services/industry-data-seed.ts`
- Test: `apps/api/src/services/industry-data-generator.test.ts` (NEW)

**Interfaces produced:**
- `seedIndustryDataFromFiles(projectRoot, deps) → { imported: number }`
- `renderBrandsJson(brands) → string`
- `renderKeywordsStructuredMd({ companies, keywords, brands }) → string`
- `renderCompanyUrlsMd(urls) → string`
- `regenerateIndustryDataFiles(projectRoot, entries) → { written: string[] }`
- `commitIndustryDataFiles(projectRoot, actor, deps?) → { sha: string | null; warning?: string }`
- `regenerateAndCommit(projectRoot, actor, deps) → { sha: string | null; warning?: string }`

**Steps:**
1. **Read first:** `apps/api/src/services/industry-data-service.ts` — the exact `loadBrands`/`loadCompanies`/`loadKeywords`/`loadCompanyUrls` parse logic, and the real on-disk formats of `config/industry-data/brands.json`, `keywords-structured.md`, `company-urls.md`. The renderers must emit byte-identical formats. Extract pure parse helpers if that makes the golden test cleaner.
2. Write the failing golden test: load current files via `IndustryDataService`, render back through the new renderers, assert re-parse equals original on identity fields (and, where feasible, byte-identical output vs the committed files). Add a case: `commitIndustryDataFiles` with an injected `execGit` that throws → returns `{ sha: null, warning: /git/i }`, never throws.
3. Run `npx vitest run apps/api/src/services/industry-data-generator.test.ts` — expect FAIL (module missing).
4. Implement `industry-data-generator.ts` (renderers + write + best-effort git commit via injectable `execGit`, parse sha from `git rev-parse HEAD`) and `industry-data-seed.ts` (`loadAll()` → map to `{entryType, entryId, data, sortOrder}` with entryId scheme `brand-<id>`/`company-<id>`/`keyword-<id>`/`url-<hash>`; idempotent upsert via injected dep).
5. Run test — expect PASS.
6. Commit: `feat(api): industry-data file generator + seed importer with golden round-trip`.

---

### Task 3: Admin service + audit service + admin routes

**Files:**
- Create: `apps/api/src/services/industry-data-admin-service.ts`
- Create: `apps/api/src/services/industry-audit-service.ts`
- Create: `apps/api/src/services/industry-data-validators.ts` (shared zod schemas extracted from `routes/industry.ts` if clean; else minimal duplicate)
- Create: `apps/api/src/routes/industry-data-admin.ts`
- Modify: `apps/api/src/app.ts` (mount route + rate limit)
- Test: `apps/api/src/services/industry-data-admin-service.test.ts` (NEW)
- Test: `apps/api/src/routes/industry-data-admin.test.ts` (NEW)

**HTTP produced (all behind `requireAdmin`):**
- `GET /api/industry-data/entries?entryType=`
- `POST /api/industry-data/entries` `{ entries: [...], actor? }` (bulk import, all-or-nothing)
- `PUT /api/industry-data/entries/:entryId` `{ entryType, data, actor? }`
- `DELETE /api/industry-data/entries/:entryId`
- `GET /api/industry-data/export?entryType=`
- `GET /api/industry-data/audit?companyKey=&limit=`
- `POST /api/industry-data/trigger` `{ companyKey, workspaceSlug? }` → `enqueueIndustryMaintenance({ triggerSource:"manual", triggerContext: companyKey })`
- `POST /api/industry-data/schedule` `{ paused }`
- `GET /api/industry-data/schedule`

**Steps:**
1. **Read first:** `apps/api/src/routes/companies.ts` (OpenAPIHono + `createRoute` + `requireAdmin` mount pattern, `callConvexQuery/Mutation` usage), `apps/api/src/routes/industry.ts` (existing zod schemas + public read router, leave untouched), `apps/api/src/services/industry-maintenance-pipeline-service.ts` (`enqueueIndustryMaintenance` signature), `apps/api/src/app.ts` (how routers mount + rate-limit).
2. Write failing service tests with mocked deps: `createEntry` writes entry + change (action create) + regenerateAndCommit + setChangeGitSha, returns `{ gitSha }`; git-fail path surfaces `warning` + `gitSha: null`; `importEntries` all-or-nothing (invalid entry rejects whole batch, no upsert). Write failing route test: `requireAdmin` rejects unauthenticated `GET /entries`; scoped trigger calls `enqueueIndustryMaintenance` with `triggerContext = companyKey`.
3. Run both — expect FAIL.
4. Implement `IndustryDataAdminService` (create/update/delete/import/export → validate, Convex mutate, regenerate+commit, set sha, return `{entry, gitSha, warning?}`), `IndustryAuditService.listTimeline({companyKey?, limit})` (join change_log + maintenance_ledger by companyKey, map to `{kind, at, companyKey?, summary, detail, gitSha?, runId?, action}`, sort desc), the router, and mount + rate-limit in `app.ts`. Actor = authenticated admin identity if available, else body `actor`, else `"admin"`.
5. Run tests — expect PASS. Also `cd apps/api && npm run typecheck`.
6. Commit: `feat(api): industry-data admin CRUD, audit, scoped trigger, schedule pause routes`.

---

### Task 4: Worker respects schedule-pause flag

**Files:**
- Modify: worker industry-evidence maintenance entry (grep `run_industry_evidence_maintenance` under `apps/worker/`)
- Modify: worker Convex client (add best-effort `get_schedule_paused`)
- Test: `apps/worker/tests/test_industry_maintenance_schedule_pause.py` (NEW)

**Behavior:** scheduled runs finish as `skipped` with message containing "paused" when the flag is true; manual/scoped triggers ignore the flag.

**Steps:**
1. **Read first:** the worker maintenance entry + its Convex client wrapper to match the existing `_safe_query` / run start/claim/finish patterns and the `trigger` parameter shape.
2. Write failing tests: schedule trigger + paused → finish status `skipped`, message ~ "paused"; manual trigger + paused → does NOT skip for pause.
3. Run pytest — expect FAIL.
4. Implement: client `get_schedule_paused()` → safe query `companies:getIndustryMaintenanceSchedulePaused`, default `{paused: False}` on error. In the maintenance entry: if `trigger == "schedule"` and paused, finish as `skipped` ("schedule paused") and return without researching.
5. Run pytest — expect PASS.
6. Commit: `feat(worker): honor industryMaintenanceSchedulePaused for schedule triggers`.

---

### Task 5: Web admin — Industry Data page (Manage / Control center / Audit)

**Files:**
- Create: `apps/web/src/pages/system-settings/SystemSettingsIndustryDataPage.tsx`
- Create: `apps/web/src/pages/system-settings/SystemSettingsIndustryDataPage.test.tsx`
- Modify: `apps/web/src/App.tsx` (route) + system-settings nav (grep the file declaring the Verification/Operations nav links)

**Steps:**
1. **Read first:** `SystemSettingsIndustryVerificationPage.tsx` + `SystemSettingsOperationsPage.tsx` (`useSettingsRequestJson`, i18n `defaultValue` fallback pattern, `IndustryMaintenanceCard`/`IndustryMaintenanceHistory`), and the nav declaration.
2. Write the failing UI test: three tabs render; Manage lists a brand from mocked `/api/industry-data/entries`; Control center scoped-trigger form posts `companyKey` to `/api/industry-data/trigger`.
3. Run `cd apps/web && npm test -- src/pages/system-settings/SystemSettingsIndustryDataPage.test.tsx` — expect FAIL.
4. Implement the page (local `activeTab` state, not router split):
   - **Manage:** entryType chips, entries table, Add/Edit dialog, Delete, Import (JSON textarea → POST /entries), Export (GET /export download).
   - **Control center:** Run-now (existing worker trigger), Pause/Resume (POST /schedule), scoped research form (companyKey → POST /trigger), recent runs list.
   - **Audit:** companyKey filter, unified timeline with kind chip (data_edit vs maintenance), action, actor/runId, gitSha, timestamp.
   - Toast success with gitSha; `toast.warning` when `warning` present / gitSha null.
   - Wire route in `App.tsx` + nav link with i18n `defaultValue` fallbacks.
5. Run test — expect PASS.
6. Commit: `feat(web): Industry Data admin page — Manage, Control center, Audit tabs`.

---

### Task 6: Seed endpoint + runbook + attended live verification

**Files:**
- Modify: `apps/api/src/routes/industry-data-admin.ts` — add `POST /api/industry-data/seed` (admin, idempotent import from files, no regenerate/commit)
- Modify: `apps/api/src/routes/industry-data-admin.test.ts` — assert seed admin-gated + `{ imported }`
- Modify: the company-industry-evidence stewardship runbook under `docs/runbooks/` (grep for it)

**Steps:**
1. Add `POST /seed` → `seedIndustryDataFromFiles(config.projectRoot, deps)` → `{ success, imported }`; extend route test (mock seed fn, assert admin gate + count).
2. Append runbook section "Industry data central management (2026-07-31)": where the admin UI lives, seed-once flow, edit→regenerate→commit flow, pause/resume, scoped research, reading the unified audit timeline, failure modes (gitSha null, validation reject, schedule-paused skips).
3. Attended live verify (local): seed → list brands → edit one alias via PUT → confirm `config/industry-data/brands.json` updated + `git log -1` shows `chore(industry-data)` → audit shows the data_edit row with gitSha → scoped trigger returns runId → pause toggles true. Record results in the commit message.
4. Commit: `docs(runbook)+feat(api): industry-data seed endpoint and central-management runbook`.

---

## Self-review (plan ↔ spec)

| Spec requirement | Task |
|---|---|
| `industry_data_entries` + `industry_data_change_log` | 1 |
| Row-level audit + gitSha | 1 + 3 |
| Generator + auto git commit + gitSha-null path | 2 |
| Seed from existing files | 2 + 6 |
| Admin CRUD / import / export | 3 |
| Unified audit timeline | 3 (`IndustryAuditService`) |
| Scoped trigger (`triggerContext = companyKey`) | 3 |
| Pause/resume schedule | 1 flag + 3 route + 4 worker |
| 3-tab admin UI | 5 |
| Golden byte-compat | 2 |
| Runbook + live verify | 6 |
| Phase A ingest read path unchanged | Global constraint; no task touches `IndustryDataService` read path |
| `keywords-raw.md` out of scope | Not in any task |

No placeholders. Types consistent across tasks (`entryId`, `changeId`, `gitSha`, `paused`, `triggerContext = companyKey`).
