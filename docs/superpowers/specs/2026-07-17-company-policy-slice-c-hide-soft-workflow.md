# K3 Slice C — Visibility hide + soft workflow gate (no ranking)

**Status:** accepted 2026-07-17 (user)  
**Parent work item:** `projects/trends/work/2026-07-10-company-registry-policy-architecture`  
**Parent design:** `docs/superpowers/specs/2026-07-17-company-registry-policy-design.md`  
**Implementation plan:** `docs/superpowers/plans/2026-07-17-company-policy-slice-c-hide-soft-workflow.md`

## Why this slice

Slice B shipped registry + Policies UI + match/warnings. Operators can set **No-hire**, but:

- Default search still lists those resumes (no `visibility=hide` enforcement).
- Advancing workflow actions (shortlist / star / contact) still work (no `workflow=blocked` gate).

HR expects **operational** effects without changing AI score. Ranking bands are deferred to reduce complexity.

## Locked product decisions

| Decision | Choice |
|----------|--------|
| `visibility=hide` | **Yes** — omit from default search/list results |
| Recovery | Toggle **Show company-policy hidden** (default **off**) |
| When shown via toggle | Keep red warning banner; do not auto-clear policy |
| `workflow=blocked` | **Soft UI gate only** — no writes to `candidate_blocks` |
| Actions blocked | Advancing: shortlist, star, contact (+ bulk shortlist) |
| Actions allowed | View detail, reject, notes, rejected/withdrawn-style status, unblock person (person block is separate) |
| Ranking bands | **Out of scope** for Slice C |
| AI score | **Unchanged** always |
| Enforcement layer | **Client-first** (same match path as badges); API enforcement later if needed |
| Known-good | **No hide**; optional green badge only (already shipped); no special ranking |

### No-hire preset mapping (unchanged storage)

| Preset | visibility | workflow | rankingEffect |
|--------|------------|----------|---------------|
| No-hire | `hide` | `blocked` | `band_known_bad` (stored, **ignored** in C) |
| Known good | `default` | `default` | `band_known_good` (stored, **ignored** in C) |
| None | `default` | `default` | `none` |

## User-visible behavior

### A. Hide from default results

1. For each resume in the active list/search pipeline, compute `companyPolicyHits` via existing alias match.
2. Resume is **policy-hidden** if any hit has `effects.visibility === 'hide'`.
3. Default filter: drop policy-hidden resumes from displayed list.
4. UI control near results / bulk bar:
   - Checkbox or chip: **Show company-policy hidden**
   - When off (default): hidden omitted; show count if > 0: e.g. `3 hidden by company policy`
   - When on: include them; each still shows No-hire badge + banner
5. URL optional (nice-to-have): `?companyPolicyHidden=1` for shareable state — only if cheap; not required for C exit.

### B. Soft workflow gate

When resume has any hit with `effects.workflow === 'blocked'`:

| Surface | Behavior |
|---------|----------|
| Shortlist / star / contact buttons | Disabled or click → toast, no mutation |
| Bulk shortlist | Skip blocked rows; toast how many skipped |
| Status → shortlisted / offer / hired / contacted / interviewing… | Block advancing statuses; allow reject / withdrawn / notes |
| Person block (`candidate_blocks`) | Unchanged (orthogonal) |
| View / expand / detail | Always allowed |

**Toast copy (EN default):**  
`Blocked by company policy (No-hire): {displayName}. Operational only — AI score unchanged.`

**Do not:**

- Insert into `candidate_blocks`
- Rewrite analysis score or sort order
- Hard-fail entire bulk export (export may still include rows if selected while toggle is on)

## Architecture (client-first)

```
[Settings] company_policy_revisions (workspace)
        │
        ▼
useCompanyPolicies / useCompanyPolicyIndex  (cached)
        │
        ▼
matchResumeCompanyPolicies(workHistory + companyHits)
        │
        ├── badges/banner (Slice B — done)
        ├── filter policy-hidden from list (Slice C)
        └── gate advancing actions (Slice C)
```

No new Convex tables. No ranking projection. No score formula change.

## Match rules (reuse)

- Exact normalized alias + soft contains (already in `company-policy.ts`).
- Separate companies: 宝力机械 / Pro-Technic vs 宝惠 / Polywell.
- Only workspace policy effects in index (same as B).

## Surfaces to touch

| Area | Change |
|------|--------|
| Shared helpers | `isPolicyHidden`, `isWorkflowBlocked` pure helpers |
| Search list (`ResumeSearchPage` / list state) | Filter + toggle + count |
| Classic `ResumeList` | Same filter + toggle if still used |
| `SnippetCard` / `ResumeCard` | Gate shortlist/star/contact; status advancing |
| Bulk actions | Skip shortlist on workflow-blocked |
| i18n | Toggle, count, toast, disabled titles |

## Explicit non-goals (Slice C)

- Ranking band / sort bucket reordering
- Server-side search exclusion (Convex query filter)
- API hard-deny on status mutations
- Candidate-level policy override
- Market/global policy UI
- Auto person-block
- Prompt / score caps

## Acceptance criteria

1. Resume with work history matching a **No-hire** company is **absent** from default search/list.
2. Toggle **Show company-policy hidden** restores them with warning UI still visible.
3. Hidden count is visible when count > 0 and toggle is off.
4. Shortlist / star / contact cannot complete for workflow-blocked resumes (toast or disabled).
5. Reject / notes / detail still work.
6. Bulk shortlist skips blocked rows without failing the whole batch silently (toast with skip count).
7. AI score display and formula unchanged.
8. No new rows in `candidate_blocks` caused by company policy.
9. 宝力机械 and 宝惠 remain separate match keys.
10. Unit tests cover filter helper + action gate helper; at least one component test for toggle/filter and one for blocked action.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Alias miss → no-hire not hidden | Soft match already; operator can add alias; document in settings |
| HR cannot find “missing” people | Count + toggle + clear copy |
| Soft gate bypassed via API/CLI | Accept for C; document as Slice D if needed |
| Confusion with person block | Different badge copy; never auto-write blocks |

## Follow-up slices (not C)

- **D:** API/server enforcement of workflow + optional search-index hide  
- **E:** Ranking band (only if product still wants after hide/gate)  
- **F:** Provisional unresolved queue + entry snapshots  
