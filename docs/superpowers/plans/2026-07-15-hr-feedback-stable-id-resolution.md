# HR Feedback Stable ID Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HR feedback import work after resume restore by resolving export rows via stable profile/external IDs when Convex document IDs no longer match.

**Architecture:** Portable resume backups do not include Convex `_id`. BFF restore re-inserts resumes and mints new IDs. Export CSVs still carry the old `Resume ID`. Fix matching in `importNotesBatch` (+ parser/UI) so feedback can resolve by `externalId` and profile-URL identity keys, not only document id. Optionally fall back to `Job Intention` when `User Comment` is empty for export-shaped CSVs used as feedback notes.

**Tech Stack:** TypeScript, Convex mutations, Vitest, PapaParse, BFF OpenAPI routes, React dialog.

## Global Constraints

- Never match restored resumes solely by old Convex `_id` when a stable selector exists.
- Keep workspace isolation: only match resumes in the active workspace slug.
- Preserve empty-comment skip and supersede-by-later-duplicate semantics.
- CSRF + workspace headers remain required for mutating feedback-batch calls.
- Do not require re-export/re-restore for the existing 34-row HR CSV to import.

---

### Task 1: Parser accepts export CSV profile URL + comment fallbacks

**Files:**
- Modify: `apps/web/src/lib/hr-feedback-import.ts`
- Test: `apps/web/src/lib/hr-feedback-import.test.ts`

**Interfaces:**
- Produces: `HrFeedbackRow { resumeId, name?, comments, profileUrl?, rowNumber }`

- [ ] **Step 1: RED tests for export CSV shape**
- [ ] **Step 2: Implement header mapping + Job Intention fallback when User Comment empty**
- [ ] **Step 3: GREEN tests**

### Task 2: Convex importNotesBatch resolves stable selectors

**Files:**
- Modify: `packages/convex/convex/candidate_status.ts`
- Test: `packages/convex/__tests__/candidate-status-convex-test.test.ts`

**Interfaces:**
- Consumes: items `{ resumeId, comments, profileUrl? }`
- Resolves order: document id → externalId → identityKey(s) from profile URL / external id → notFound

- [ ] **Step 1: RED test: old document id + profile URL/externalId finds reimported resume**
- [ ] **Step 2: Implement resolver**
- [ ] **Step 3: GREEN tests**

### Task 3: BFF + UI pass profileUrl through feedback-batch

**Files:**
- Modify: `apps/api/src/routes/resumes_feedback_batch.ts`
- Modify: `apps/api/src/routes/resumes_feedback_batch.test.ts`
- Modify: `apps/web/src/components/HrFeedbackImportDialog.tsx`
- Modify: `apps/web/src/components/HrFeedbackImportDialog.test.tsx` (if needed)

- [ ] **Step 1: Extend request schema + mutation args**
- [ ] **Step 2: Dialog posts profileUrl**
- [ ] **Step 3: GREEN route/dialog tests**

### Task 4: Document restore ID reality (no false preserve-_id mode)

**Files:**
- Modify: `docs/agent-runbook.md` short note (only if needed)

- [ ] **Step 1: Note that portable restore cannot preserve Convex `_id`; use profile/external matching for HR feedback**

### Task 5: Verification

- [ ] Unit/API/Convex tests green for touched files
- [ ] Dry-parse the user CSV path and confirm 34 rows with comments + profileUrl
