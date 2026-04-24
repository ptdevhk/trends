# verifiedRoleYears Precomputed Field — minRoleYears Hardening Plan

Date: 2026-04-24
Author: agent (with karl)
Supersedes-semantics-of: PR #655 (`fix: use getRoleSignalYears for minRoleYears filter ...`)
Related prior plan: `docs/superpowers/plans/2026-04-15-sales-role-detection-and-relatedexp-hardening-plan.md`
Related observations: S2308 (*Malaysia CNC Sales zero-result: industryVerified=false kills verifiedYears calculation*)

## Decision (2026-04-24, confirmed by karl)

**Strict industry-verified gating.** `minRoleYears` gates on `industryVerifiedRelevantYears ?? industryVerifiedYears` only. This matches the `verified Xy` number shown in the `roleEvidence` export column (`apps/api/src/services/export-service.ts:125-146`).

**Consequence: Seek Malaysia resumes with `industryVerified=false` will be rejected.** This reverses PR #655's permissive behavior. Fixing upstream `industryVerified=false` for real Seek Malaysia salespeople is a **separate** workstream, not part of this plan.

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:test-driven-development`. Every step lands a red test first, then makes it green. Do NOT skip the red phase.

---

## Problem

`minRoleYears` + `roleFilterType=sales` is supposed to gate on the **industry-verified** `verified Xy` number that operators see in the `roleEvidence` export column. Today it does not.

Current call chain in `packages/convex/convex/resumes.ts:933`:

```
matchesResumeListFilters
  → getResumeRoleYears(resume, roleType)            (resumes.ts:892)
    → getRoleSignalYears(roleSignals, roleType)     (packages/shared/src/analysis-key.ts:329)
```

`getRoleSignalYears` fallback chain (`analysis-key.ts:361-366`):

```
industryVerifiedRelevantYears
?? roleRelevantYears       // unverified; admits adjacent/support
?? industryVerifiedYears
?? years                   // RAW TOTAL EXPERIENCE
?? 0
```

A resume with only `years=10` (no roleSignal match for sales, no industry-verified evidence) currently passes `minRoleYears=10&roleType=sales`. A resume showing `sales:4.9y · signals 业务` (no `verified` chip) falls back to 4.9 rather than using 0. Both contradict the operator's mental model that `minRoleYears` equals the `verified Xy` value.

PR #655 chose the permissive helper to keep Seek Malaysia resumes (`industryVerified=false`, observation S2308) in results. Karl confirmed 2026-04-24 that strict verified gating is the correct semantic — upstream `industryVerified=false` for real Malaysian salespeople is a **separate** bug to fix in its own workstream.

**We need a single, unambiguous source of truth that:**
1. Gates on the exact `verified Xy` value displayed in `roleEvidence`.
2. Rejects resumes with only unverified `roleRelevantYears` or raw `years`.
3. Cannot be re-broken by a future engineer picking the wrong helper.

---

## Decision

Add a precomputed field `ingestData.verifiedRoleYears: Record<string, number>` populated at ingest. The filter reads this field directly. No helper, no fallback chain, no second opinion.

### Why not alternative approaches

| Option | Why rejected |
|---|---|
| Swap to `getVerifiedRoleSignalYears` only (no field) | Two helpers remain with subtly different rules — next engineer picks wrong one again |
| Tighten `getRoleSignalYears` fallback (drop `?? years`) | Same as above; also keeps unverified `roleRelevantYears` in the filter path |
| DB index / query tuning | Doesn't touch semantics |
| Add `strict` flag to `getRoleSignalYears` | Runtime branching still invites wrong callsite choice |
| `directRoleYears` (directRoleMatch only) | Rejected 2026-04-24 by karl: he wants the UI's `verified Xy` number, which is industry-verified, not title-verified |

### Semantic contract (the only rule readers need to remember)

> `ingestData.verifiedRoleYears[roleType]` = `industryVerifiedRelevantYears ?? industryVerifiedYears ?? 0`, read from the `roleSignal` whose `type === roleType`.
>
> Requires `industryVerified === true` in the upstream signal computation.
>
> `minRoleYears` filter passes iff `verifiedRoleYears[roleType] >= minRoleYears`.
>
> Missing field ⇒ 0 ⇒ rejected.

---

## Files Touched (ordered)

1. **Tests first**
   - `packages/convex/convex/__tests__/resumes-paginated-default.test.ts` — add regression tests.
   - `packages/shared/src/analysis-key.test.ts` (create if missing, else add) — lock `computeVerifiedRoleYears` helper semantics.

2. **Shared helper**
   - `packages/shared/src/analysis-key.ts` — add `computeVerifiedRoleYears(roleSignals)` returning `Record<string, number>`. Later: drop `?? years` from `getRoleSignalYears` fallback.

3. **Schema**
   - `packages/convex/convex/schema.ts` — add `verifiedRoleYears: v.optional(v.record(v.string(), v.number()))` to the `ingestData` validator.

4. **Ingest / store**
   - Wherever `ingestData` is assembled for resume writes — search for `roleSignals:` assignment, add `verifiedRoleYears: computeVerifiedRoleYears(roleSignals)` next to it. Likely sites: `packages/convex/convex/resumes.ts`, `apps/api/src/services/resume-service.ts`, any analysis task that rewrites `ingestData`.

5. **Filter**
   - `packages/convex/convex/resumes.ts:933` — replace `getResumeRoleYears` call with `resume.ingestData?.verifiedRoleYears?.[roleType] ?? 0`.

6. **Migration**
   - `packages/convex/convex/migrations.ts` — paginated backfill (repo convention, see memory entry *"all resume-scanning migrations use .paginate()"*).

7. **Cleanup**
   - `packages/shared/src/analysis-key.ts` — remove `?? years` (raw total) from `getRoleSignalYears` fallback; audit remaining callers. If no callsite needs the unverified `roleRelevantYears` path, deprecate that branch with a comment pointing at this plan.

---

## Tasks (checkbox-tracked)

### Task 1 — Feature branch + plan snapshot
- [ ] Branch: `fix/min-role-years-direct-role-years-field`
- [ ] This plan already saved at `docs/superpowers/plans/2026-04-24-direct-role-years-precomputed-field-plan.md`

### Task 2 — Red: filter regression tests
Add to `packages/convex/convex/__tests__/resumes-paginated-default.test.ts`:

- [ ] **verified-only resume passes**: resume with `ingestData.verifiedRoleYears: { sales: 5 }`. `minRoleYears:1, roleFilterType:"sales"` → resume included.
- [ ] **roleRelevantYears-only rejected**: resume with a `roleSignals: [{ type:"sales", roleRelevantYears:10, industryVerifiedRelevantYears: undefined }]`, no `verifiedRoleYears` field → **rejected** by `minRoleYears:1, roleFilterType:"sales"`.
- [ ] **raw-years-only rejected**: resume with `ingestData.roleSignals=[]`, `years=10`, no `verifiedRoleYears` → **rejected** by `minRoleYears:1, roleFilterType:"sales"`.
- [ ] **Seek Malaysia rejected (documented consequence)**: resume with `roleSignals: [{ type:"sales", matchedWorkEntries:[{ directRoleMatch:true, industryVerified:false, years:3 }] }]`, no `industryVerifiedRelevantYears` → **rejected**. Test comment must point at this plan so reviewers know the rejection is intentional and the fix is an upstream industryVerified repair.

Run tests; they must fail before next task.

### Task 3 — Red: shared helper test
- [ ] Add `computeVerifiedRoleYears` case in analysis-key tests: mixed signals (sales with `industryVerifiedRelevantYears:5`, engineering with `industryVerifiedYears:3` only, adjacent with only `roleRelevantYears:7`) → expect `{sales: 5, engineering: 3}`. The role with only `roleRelevantYears` must NOT appear — never fall back to unverified years.

### Task 4 — Green: implement helper
- [ ] In `packages/shared/src/analysis-key.ts`, add:
  ```ts
  export function computeVerifiedRoleYears(
    roleSignals: AnalysisRoleSignalLike[] | undefined
  ): Record<string, number>
  ```
  For each signal, resolve `industryVerifiedRelevantYears ?? industryVerifiedYears ?? 0`. Key by `signal.type.trim().toLowerCase()`. Drop entries where the resolved value is 0. Never read `years` or `roleRelevantYears`. Mirrors the numerator used by `formatRoleEvidence` (`apps/api/src/services/export-service.ts:133`) so the UI `verified Xy` chip and the filter stay in lockstep.
- [ ] Export from `packages/shared/src/index.ts` if that's the barrel.
- [ ] Run shared test → green.

### Task 5 — Green: schema + ingest population
- [ ] `packages/convex/convex/schema.ts` — add optional `verifiedRoleYears` to `ingestData`.
- [ ] Every writer of `ingestData` calls `computeVerifiedRoleYears(roleSignals)` and stores the result. Identify all sites via Grep for `roleSignals:` assignments in `packages/` and `apps/`, and check each that assigns `roleSignals`.
- [ ] Existing ingest tests must still pass.

### Task 6 — Green: filter swap
- [ ] `packages/convex/convex/resumes.ts:933`:
  ```ts
  if ((filters.minRoleYears ?? 0) > 0) {
      const key = (filters.roleFilterType ?? "").trim().toLowerCase() || "sales";
      const y = resume.ingestData?.verifiedRoleYears?.[key] ?? 0;
      if (y < filters.minRoleYears!) return false;
  }
  ```
- [ ] Delete `getResumeRoleYears` helper if no callers remain.
- [ ] Regression tests from Task 2 → green.

### Task 7 — Backfill migration
- [ ] Add paginated migration to `packages/convex/convex/migrations.ts` named `backfillDirectRoleYears`. For each resume:
  - Compute `computeVerifiedRoleYears(ingestData?.roleSignals)`.
  - Patch only if result differs from existing `ingestData.verifiedRoleYears`.
- [ ] Follow the repo's paginated migration convention (see existing migrations in the same file).

### Task 8 — Cleanup / prevention
- [ ] Remove `?? years` branch from `getRoleSignalYears` in `analysis-key.ts:361-366`. Add doc comment on the function warning readers that this is a **ranking/display helper** and must NOT be used for hard filters — point at this plan.
- [ ] Audit remaining `getRoleSignalYears` callers (from Grep earlier: `packages/convex/convex/resumes.ts`, the same file's tests, `apps/web/src/hooks/useResumeSearchState.ts`, `packages/shared/src/analysis-key.ts`). For each, confirm ranking/display usage is OK with the narrowed fallback.
- [ ] Update the 2026-04-15 plan doc (`docs/superpowers/plans/2026-04-15-sales-role-detection-and-relatedexp-hardening-plan.md`) with a short pointer to this plan's outcome so the next reader follows this trail instead of rediscovering #655.

### Task 9 — Validation + ship
- [ ] `make check` — must pass.
- [ ] `make check TARGET=all` if governance changed (not expected here).
- [ ] Commit, push feature branch, open PR titled `fix: precomputed verifiedRoleYears for minRoleYears filter`.
- [ ] `gh pr merge <n> --squash --auto`.

---

## Regression-Prevention Invariants

After this lands, the following must be true and tested:

1. **The filter reads exactly one field.** Grep in `resumes.ts`: `minRoleYears` should appear only near `verifiedRoleYears`. If a future PR adds another `getRoleSignalYears`/`getVerifiedRoleSignalYears` call to the filter path, code review catches it.
2. **`computeVerifiedRoleYears` never reads `years` or `roleRelevantYears`.** A unit test pins this by supplying a resume with those two fields set and `industryVerifiedRelevantYears`/`industryVerifiedYears` absent — expected output `{}`.
3. **Backfill is idempotent.** Running the migration twice produces the same state.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Ingest writers miss populating the new field → 0-results regression | Paginated backfill covers existing data; Task 5 audit covers all write sites; filter treats missing field as 0 which is the safe default (no one over-passes). |
| Other callers of `getRoleSignalYears` depend on `?? years` (Task 8 cleanup) | Audit step in Task 8. If any legitimate display usage needs raw years as a last resort, keep the branch but gate behind an explicit `{ allowRawYears: true }` option. |
| Backfill write rate hits Convex local dev 4 MiB/s limit | Existing paginated-migration infra handles this; backfill runs in prod manually via standard migration workflow. |

---

## Sources Used

- Local files:
  - `packages/convex/convex/resumes.ts:892-899, 933-938`
  - `packages/shared/src/analysis-key.ts:267-327, 329-388`
  - `packages/convex/convex/__tests__/resumes-paginated-default.test.ts:374-390`
  - `docs/superpowers/plans/2026-04-15-sales-role-detection-and-relatedexp-hardening-plan.md:64`
  - Git log: `e8e7e042` (PR #655), `64ce563c` (PR #613), `84464d70`
- Context7: none (repo-internal refactor, no library API question).
- Web: none.
