# K3 Slice C — Hide + Soft Workflow Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce company-policy `visibility=hide` on default resume search/list results and soft-block advancing workflow actions when `workflow=blocked`, without ranking or score changes.

**Architecture:** Reuse client-side `useCompanyPolicyIndex` + `matchResumeCompanyPolicies`. Add pure helpers for hide/workflow flags. Filter displayed lists behind a default-off recovery toggle. Gate shortlist/star/contact (and advancing statuses) in UI only — no `candidate_blocks` writes, no ranking.

**Tech Stack:** TypeScript, `@trends/shared`, React (apps/web), existing company policy API/cache, vitest.

## Global Constraints

- Exact names: `宝力机械` / `Pro-Technic Machinery` and `宝惠` / `Polywell` are separate; never umbrella `BaoLi`.
- Company policy must not rewrite canonical AI score.
- Ranking band reordering is out of scope.
- Soft UI gate only (no data mutation into person blocks).
- Prefer pure helpers + list filter over new backend tables.
- Workspace-scoped policy only for runtime (same as Slice B).

---

## File map

| Path | Role |
|------|------|
| `packages/shared/src/company-policy.ts` | Pure helpers: `isCompanyPolicyHidden`, `isCompanyWorkflowBlocked`, `summarizeCompanyPolicyHits` |
| `packages/shared/src/company-policy.test.ts` | Unit tests for helpers |
| `apps/web/src/lib/company-policy-runtime.ts` | Thin web wrapper: match + flags for a resume-like object |
| `apps/web/src/lib/company-policy-runtime.test.ts` | Unit tests |
| `apps/web/src/hooks/useCompanyPolicyListFilter.ts` | Filter list + toggle state + hidden count |
| `apps/web/src/components/CompanyPolicyHiddenToggle.tsx` | Toggle + count chip UI |
| `apps/web/src/components/search/SnippetCard.tsx` | Soft-block advancing actions |
| `apps/web/src/components/ResumeCard.tsx` | Soft-block advancing actions |
| `apps/web/src/pages/ResumeSearchPage.tsx` (and/or list state hook) | Apply filter + toggle |
| `apps/web/src/components/ResumeList.tsx` | Apply filter + toggle if classic list still primary |
| `apps/web/src/i18n/locales/{en,zh-Hans,zh-Hant}.json` | Copy for toggle/toast/count |

---

### Task 1: Shared pure helpers

**Files:**
- Modify: `packages/shared/src/company-policy.ts`
- Modify: `packages/shared/src/company-policy.test.ts`

**Interfaces:**
- Consumes: `CompanyPolicyMatchHit` (existing)
- Produces:
  - `isCompanyPolicyHidden(hits: CompanyPolicyMatchHit[]): boolean`
  - `isCompanyWorkflowBlocked(hits: CompanyPolicyMatchHit[]): boolean`
  - `primaryCompanyPolicyHit(hits: CompanyPolicyMatchHit[]): CompanyPolicyMatchHit | null` (prefer no_hire)

- [ ] **Step 1: Write failing tests**

```ts
it("flags hide and workflow from no_hire hits", () => {
  const hits = [{
    companyKey: "pro-technic-machinery",
    displayName: "宝力机械 / Pro-Technic Machinery",
    matchedEmployer: "东莞宝力机械",
    preset: "no_hire" as const,
    effects: policyEffectsFromPreset("no_hire"),
  }];
  expect(isCompanyPolicyHidden(hits)).toBe(true);
  expect(isCompanyWorkflowBlocked(hits)).toBe(true);
  expect(isCompanyPolicyHidden([])).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run packages/shared/src/company-policy.test.ts`  
Expected: FAIL — helpers not defined

- [ ] **Step 3: Implement helpers**

```ts
export function isCompanyPolicyHidden(hits: CompanyPolicyMatchHit[]): boolean {
  return hits.some((hit) => hit.effects.visibility === "hide");
}

export function isCompanyWorkflowBlocked(hits: CompanyPolicyMatchHit[]): boolean {
  return hits.some((hit) => hit.effects.workflow === "blocked");
}

export function primaryCompanyPolicyHit(
  hits: CompanyPolicyMatchHit[],
): CompanyPolicyMatchHit | null {
  return hits[0] ?? null; // already sorted no_hire first
}
```

- [ ] **Step 4: Run tests — pass**

Run: `bunx vitest run packages/shared/src/company-policy.test.ts`  
Expected: PASS

- [ ] **Step 5: Rebuild shared**

Run: `cd packages/shared && bun run build`

---

### Task 2: Web runtime helper + list filter hook

**Files:**
- Create: `apps/web/src/lib/company-policy-runtime.ts`
- Create: `apps/web/src/lib/company-policy-runtime.test.ts`
- Create: `apps/web/src/hooks/useCompanyPolicyListFilter.ts`
- Create: `apps/web/src/hooks/useCompanyPolicyListFilter.test.ts` (optional if hook is thin)

**Interfaces:**
- Consumes: `useCompanyPolicyIndex().matchResume`, shared helpers
- Produces:
  - `getResumeCompanyPolicyState(resume, matchResume) => { hits, hidden, workflowBlocked, primary }`
  - `useCompanyPolicyListFilter(items, getResume)` → `{ visibleItems, hiddenCount, showHidden, setShowHidden }`

- [ ] **Step 1: Failing tests for runtime helper**

```ts
it("marks resume with no_hire match as hidden and workflow blocked", () => {
  // mock matchResume returning no_hire hit
  const state = getResumeCompanyPolicyState(resumeWithBaoli, matchResume);
  expect(state.hidden).toBe(true);
  expect(state.workflowBlocked).toBe(true);
});
```

- [ ] **Step 2: Implement `getResumeCompanyPolicyState`**

```ts
export function getResumeCompanyPolicyState(
  input: { workHistory?: ...; companyHits?: string[] | null },
  matchResume: (input) => CompanyPolicyMatchHit[],
) {
  const hits = matchResume(input);
  return {
    hits,
    hidden: isCompanyPolicyHidden(hits),
    workflowBlocked: isCompanyWorkflowBlocked(hits),
    primary: primaryCompanyPolicyHit(hits),
  };
}
```

- [ ] **Step 3: Implement filter hook**

```ts
export function useCompanyPolicyListFilter<T>(
  items: T[],
  resolveResume: (item: T) => { workHistory?: ...; companyHits?: string[] | null },
) {
  const { matchResume } = useCompanyPolicyIndex(true);
  const [showHidden, setShowHidden] = useState(false);
  // compute states, filter, hiddenCount
}
```

- [ ] **Step 4: Run unit tests — pass**

Run: `cd apps/web && bunx vitest run src/lib/company-policy-runtime.test.ts`

---

### Task 3: Toggle UI component + i18n

**Files:**
- Create: `apps/web/src/components/CompanyPolicyHiddenToggle.tsx`
- Create: `apps/web/src/components/CompanyPolicyHiddenToggle.test.tsx`
- Modify: `apps/web/src/i18n/locales/en.json`
- Modify: `apps/web/src/i18n/locales/zh-Hans.json`
- Modify: `apps/web/src/i18n/locales/zh-Hant.json`

**Copy keys (under `settings.policies.runtime`):**

- `showHidden`: `Show company-policy hidden`
- `hiddenCount`: `{{count}} hidden by company policy`
- `workflowBlockedToast`: `Blocked by company policy (No-hire): {{name}}. Operational only — AI score unchanged.`
- `workflowBlockedTitle`: `Blocked by company policy`

- [ ] **Step 1: Component renders count when hiddenCount > 0 and toggle off**
- [ ] **Step 2: Clicking toggle calls onChange(true)**
- [ ] **Step 3: i18n all three locales**

---

### Task 4: Wire filter into search results list path

**Files:**
- Modify: primary search page / state — locate where `items` / `displayedResumes` are built  
  (inspect `apps/web/src/pages/ResumeSearchPage.tsx`, hooks under `apps/web/src/hooks/useResume*`, `SearchResultsList` consumers)
- Modify: `apps/web/src/components/search/SearchResultsList.tsx` **or** parent to render toggle above list
- Modify: `apps/web/src/components/ResumeList.tsx` if still used for HR screening

**Behavior:**

1. After existing filters/sort, apply company-policy hide filter when `showHidden === false`.
2. Do **not** change sort order of remaining items.
3. Place `CompanyPolicyHiddenToggle` near bulk bar / results header.
4. Pass through unchanged score fields.

- [ ] **Step 1: Identify exact list array to filter (search + classic list)**
- [ ] **Step 2: Apply `useCompanyPolicyListFilter` once per list parent (not per card)**
- [ ] **Step 3: Manual check: set Pro-Technic no-hire → resume disappears; toggle on → appears with banner**
- [ ] **Step 4: Component/integration test: with mocked index, filtered length drops**

---

### Task 5: Soft UI gate on advancing actions

**Files:**
- Modify: `apps/web/src/components/search/SnippetCard.tsx`
- Modify: `apps/web/src/components/ResumeCard.tsx`
- Modify: bulk shortlist path in `ResumeList.tsx` / search page bulk handler
- Test: extend `SnippetCard.test.tsx` / `ResumeCard.test.tsx`

**Blocked actions when `workflowBlocked`:**

- `onAction('shortlist' | 'star' | 'contact')` — prevent + toast
- Status changes to advancing set:  
  `shortlisted`, `contacted`, `interviewing`, `interviewed_pass`, `offer`, `hired`  
  (allow: `rejected`, `interviewed_reject`, `withdrawn`, `new` if already set, notes)

**Allowed always:** view detail, expand, reject action, person block/unblock, rating/notes.

**Implementation sketch:**

```ts
const policy = getResumeCompanyPolicyState(...)
const guardAdvance = (fn: () => void) => {
  if (!policy.workflowBlocked) {
    fn()
    return
  }
  toast.error(t('settings.policies.runtime.workflowBlockedToast', {
    name: policy.primary?.displayName ?? 'company',
  }))
}
// shortlist button: onClick={() => guardAdvance(() => onAction?.('shortlist'))}
// or disabled={policy.workflowBlocked} + title=
```

Bulk shortlist:

```ts
const blocked = selected.filter(isWorkflowBlocked)
const allowed = selected.filter(notBlocked)
// shortlist allowed only; toast: skipped blocked.length
```

- [ ] **Step 1: Failing test — shortlist click does not call onAction when blocked**
- [ ] **Step 2: Implement guards on SnippetCard + ResumeCard**
- [ ] **Step 3: Bulk shortlist skip + toast**
- [ ] **Step 4: Tests pass**

---

### Task 6: Verification pack + wiki/docs closeout

**Files:**
- Modify: wiki `projects/trends/work/2026-07-10-company-registry-policy-architecture/{spec,plan,log}.md`
- Modify: `docs/superpowers/specs/2026-07-17-company-registry-policy-design.md` (point to Slice C)
- Optional: note in `projects/trends/index.md`

**Verification commands:**

```bash
cd packages/shared && bun run build
bunx vitest run packages/shared/src/company-policy.test.ts
cd apps/web && bunx vitest run \
  src/lib/company-policy-runtime.test.ts \
  src/components/CompanyPolicyHiddenToggle.test.tsx \
  src/components/search/SnippetCard.test.tsx \
  src/components/ResumeCard.test.tsx
```

**Manual UAT:**

1. Seed companies; set Pro-Technic **No-hire**.
2. Search cohort with 宝力 work history → default: hidden; count > 0.
3. Toggle show → visible + red banner; score same as before.
4. Try shortlist → toast; reject still works.
5. Polywell without no-hire → not hidden.

- [ ] **Step 1: Run automated tests**
- [ ] **Step 2: Manual UAT checklist above**
- [ ] **Step 3: Update wiki log with Slice C completion notes**

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Default hide for visibility=hide | Task 4 |
| Recovery toggle | Task 3–4 |
| Hidden count | Task 3–4 |
| Soft-block shortlist/star/contact | Task 5 |
| Allow reject/notes/detail | Task 5 |
| Bulk shortlist skip | Task 5 |
| No score/ranking change | Global + Tasks 4–5 |
| No candidate_blocks write | Task 5 (explicit non-action) |
| Separate Pro-Technic / Polywell | Global / match reuse |
| Tests | Tasks 1–5 |

## Placeholder / complexity scan

- No ranking implementation tasks.
- No API hard-deny in this plan.
- No new Convex tables.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-17-company-policy-slice-c-hide-soft-workflow.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — implement in this session with checkpoints  

**Which approach?**
