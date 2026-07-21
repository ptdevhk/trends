# Handoff: Review Research Eng Full Distill Design + Plan

**To:** Reviewing agent (read-only design/plan review — **do not implement**)  
**From:** Design session on branch `design/trendradar-v6-migrate-research-agent`  
**Date:** 2026-07-21  
**Status of artifacts:** Drafts committed; product code **not** started  
**Requested action:** Design + plan review only; write findings; do not open implementation PRs unless human explicitly re-tasks you

---

## Mission (one sentence)

Review whether the **Option 1 full-distill Research Eng** design and PR1–PR7 plan are coherent, safe for a hard cut of legacy TrendRadar, and correctly aligned with Trends (Convex company registry, worker, API, CLI, web desks) — then produce a structured review report.

---

## Where to work

| Item | Path |
|------|------|
| Worktree | `/Users/karlchow/Desktop/code/trends/.worktrees/trendradar-v6-migrate-research-agent` |
| Branch | `design/trendradar-v6-migrate-research-agent` |
| Commit (docs) | `ae0a64c3` — `docs(research): full-distill Research Eng design and PR plan` |
| **Design (primary)** | `docs/superpowers/specs/2026-07-21-research-eng-full-distill-design.md` |
| **Plan (primary)** | `docs/superpowers/plans/2026-07-21-research-eng-full-distill-plan.md` |
| Vault work item | `~/wiki/projects/trendradar/work/2026-07-21-research-eng-full-distill/` |
| Donor architecture extracts | `~/wiki/projects/trendradar/architecture/` (00–10) |
| Donor pin (code reference only) | `karlorz/TrendRadar-dev` @ `v6.10.0-7-gfddcb0fa` — local often `/Users/karlchow/Desktop/code/TrendRadar-dev` |
| Trends main checkout | `/Users/karlchow/Desktop/code/trends` (same monorepo; may lag this branch) |

```bash
cd /Users/karlchow/Desktop/code/trends/.worktrees/trendradar-v6-migrate-research-agent
git log -1 --oneline
# ae0a64c3 docs(research): full-distill Research Eng design and PR plan
```

---

## Context (what was decided)

### North star

**Architecture transfer** of TrendRadar ideas into Trends as **Research Eng** — not “run bigger TrendRadar as a service.” Legacy crawl → SQLite → MCP/API is **not** the long-term product path.

### Locked decisions (must not “fix” by reopening product scope)

| Topic | Locked choice |
|-------|----------------|
| Storage | **Full distill** — native Convex `news_items` + `research_signals`; no permanent SQLite corpus |
| Company identity | Reuse K3 `companyKey` / `company_aliases` / `resolveAlias` |
| Entity P1 | **Company** only |
| Personas | **HR + Sales** from day one; **same store**, different rank/copy |
| Crawl | **`apps/worker` ResearchIngestJob** (thin ports; no `NewsAnalyzer` product spine) |
| Contracts | Convex + `/api/research/*` + `trends research` CLI; **MCP deferred** |
| UI P1 | HR desk + Sales desk **widgets** |
| Donor | Pin = **design donor only** — **no bulk v6 merge** |
| Cutover | Dual-run shadow → **3 consecutive** green parity → **hard cut** delete legacy |
| Approach | Option 1 full-stack hard migration (PR1→PR7) |

### Explicit P1 non-goals

- Full AI analyze / translate / multi-channel notify parity  
- Industry / role / person graphs  
- CRM / outreach / resume auto-writes  
- Upstream TrendRadar contribution  
- Bulk merge of `trendradar/` + `mcp_server/`  
- Long-term dual-brain SQLite + Convex  

### PR DAG (plan)

1. **PR1** Convex schema + tests (`news_items`, `research_signals`)  
2. **PR2** Worker ingest → news items  
3. **PR3** Company resolve + signal projector  
4. **PR4** API + CLI  
5. **PR5** Web HR/Sales widgets  
6. **PR6** Parity harness + dual-run  
7. **PR7** Hard cut / delete legacy product path  

---

## What to read (order)

1. Design: `docs/superpowers/specs/2026-07-21-research-eng-full-distill-design.md` (full)  
2. Plan: `docs/superpowers/plans/2026-07-21-research-eng-full-distill-plan.md` (full)  
3. Spot-check Trends reality (read-only):  
   - `packages/convex/convex/schema.ts` (K3 companies / aliases)  
   - `packages/convex/convex/companies.ts` (`resolveAlias`, write secret)  
   - `apps/worker/tasks.py` (`run_crawl_analyze` / `NewsAnalyzer`)  
   - `apps/api/src/routes/trends.ts` + `apps/api/src/services/data-service.ts` (legacy news read path)  
   - `packages/cli/cmd/root.go` (CLI registration patterns)  
   - `apps/web/src/App.tsx` / policies desk (where widgets might mount)  
4. Optional donor context: `~/wiki/projects/trendradar/architecture/01-topology.md`, `10-tech-debt.md`  
5. Do **not** require reading entire `trendradar/` tree unless a claim looks false  

---

## Review criteria (use these)

### A. Design integrity

- [ ] Locked decisions are consistent end-to-end (no half-SQLite / half-Convex product truth)  
- [ ] Non-goals actually constrain the plan (no sneaky AI/MCP/CRM scope in PR tasks)  
- [ ] Company registry reuse is correct vs inventing a second registry  
- [ ] Persona model is sound (shared signals, rank-only difference)  
- [ ] Hard cut + 3× parity is operationally credible (or flag as under-specified)  

### B. Plan quality (writing-plans)

- [ ] PR1–PR7 order is dependency-correct  
- [ ] File map matches real monorepo paths / patterns  
- [ ] Interfaces between PR tasks are named and usable  
- [ ] Test steps are real entry points (convex-test, pytest, vitest, go test) — not theater  
- [ ] PR7 preconditions (3 greens) are enforceable; rollback story exists  
- [ ] No TBD / contradictory steps vs design  

### C. Trends fit / risk

- [ ] Worker write path to Convex (secret, BFF, or direct) is feasible given current code  
- [ ] Dual-run does not force product UI to keep SQLite  
- [ ] Deleting `trendradar/` / `mcp_server` impact on resume worker, deploy, MCP CLI is acknowledged  
- [ ] Desk widget mount points are realistic (or plan should name exact routes)  
- [ ] Golden companies + 80% news parity thresholds are fair or need tuning  

### D. Severity rubric for findings

| Severity | Meaning |
|----------|---------|
| **Blocker** | Must change design/plan before any implementation PR |
| **Major** | Should fix before PR1; implementation risk high if ignored |
| **Minor** | Improve clarity / naming / tests; can fix during PR1–2 |
| **Nit** | Style / wording only |

---

## Deliverable (write this)

Create **both** of the following (or one file with both sections):

### 1. Review report (required)

**Path (preferred):**  
`docs/superpowers/reviews/2026-07-21-research-eng-full-distill-design-plan-review.md`  
in the same worktree, on a branch of your choice (e.g. continue on design branch or `review/research-eng-full-distill`).

**Structure:**

```markdown
# Review: Research Eng Full Distill Design + Plan

**Reviewer:** <agent/session>
**Date:** <ISO date>
**Artifacts:** design + plan @ ae0a64c3 (or later SHA if amended)
**Verdict:** APPROVE | APPROVE_WITH_NITS | REQUEST_CHANGES | REJECT

## Summary
(3–6 sentences)

## Blockers
- ...

## Majors
- ...

## Minors / Nits
- ...

## Checklist results
(A–D criteria, pass/fail)

## Recommended edits (concrete)
- Design: section X → change Y
- Plan: Task PRn step Z → change W

## Safe to implement?
YES only if no blockers. If YES, start at PR1. If NO, list must-fix items.
```

### 2. Vault log line (optional but preferred)

Append to:  
`~/wiki/projects/trendradar/work/2026-07-21-research-eng-full-distill/log.md`

One short entry: verdict + path to review report.

---

## Out of scope for the reviewing agent

- Implementing PR1–PR7  
- Bulk merging TrendRadar v6  
- Deleting `trendradar/` / `mcp_server`  
- Changing product code under `apps/` / `packages/convex/convex/` except **docs/review files**  
- Re-grilling the user unless a **blocker** requires a human decision (then list questions, do not invent new north stars)  

---

## Suggested skills / mode

- Read-only exploration; optional `review` skill **branch mode** against `design/trendradar-v6-migrate-research-agent` if you want diff framing (diff is mostly the two docs).  
- Do **not** treat this as code implementation; design review only.  
- If using subagents: one explore for codebase fit, one for design coherence — merge into single report.  

---

## Paste-ready prompt for the next agent

```text
You are a reviewing agent. Do NOT implement product code.

Handoff file (read first):
docs/superpowers/handoffs/2026-07-21-research-eng-full-distill-review-handoff.md
in worktree:
/Users/karlchow/Desktop/code/trends/.worktrees/trendradar-v6-migrate-research-agent
branch: design/trendradar-v6-migrate-research-agent
commit: ae0a64c3

Review ONLY:
- docs/superpowers/specs/2026-07-21-research-eng-full-distill-design.md
- docs/superpowers/plans/2026-07-21-research-eng-full-distill-plan.md

Spot-check Trends code (companies, worker crawl, trends API, CLI root) for fit.
Write review to:
docs/superpowers/reviews/2026-07-21-research-eng-full-distill-design-plan-review.md
Use severity Blocker/Major/Minor/Nit and verdict APPROVE | APPROVE_WITH_NITS | REQUEST_CHANGES | REJECT.
Follow the handoff checklist A–D. Append a short vault log entry if possible.
```

---

## Human contact notes

- User accepted **high risk** and **hard cut** after event-based parity.  
- User explicitly rejected bulk v6 merge and permanent SQLite after re-grill.  
- Implementation should wait for review verdict unless human overrides.  
