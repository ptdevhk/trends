# Corpus-Evidence Fast-Track Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a corpus-evidence fast-track script that scans the resume corpus, identifies high-confidence CNC/industrial employers from work-history title tokens, creates ready_for_review proposals with evidence sources, then runs auto-verify + reingest + UAT verification.

**Architecture:** Single new TypeScript script (`scripts/industry-data/corpus-fast-track.ts`) that queries the local API, classifies employers by title-token gates, upserts proposals + evidence sources via Convex mutations, then chains into the existing auto-verify + reingest pipeline. No schema changes, no new Convex functions.

**Tech Stack:** TypeScript (tsx), Convex local backend, REST API (BFF on :3000), existing `auto-verify-proposals.ts` and `drain-backlog.sh` patterns.

## Global Constraints

- Branch: `preview-v0.4.23`
- Convex URL: `http://127.0.0.1:3210` (local dev backend)
- API URL: `http://localhost:3000` (BFF)
- `CONVEX_WRITE_SECRET` from `packages/convex/.env.local`
- All scripts dry-run by default; `--apply` required for writes
- No Convex schema changes
- No changes to `approveIndustryProposal` or the worker
- Reuse the `convexRun` helper pattern from `curate-my-cnc-employers.ts`
- Title-token gate: employer name keywords NEVER count as evidence
- Exclusion tokens in employer name block fast-track (route to worker instead)

---

### Task 1: Build corpus-fast-track.ts - scan + classify + dry-run output

**Files:**
- Create: `scripts/industry-data/corpus-fast-track.ts`

**Interfaces:**
- Consumes: `/api/resumes` (GET, query params: q, location, source=convex, paged=true, limit, workspaceSlug)
- Produces: stdout classification report (dry-run) or Convex mutations (when `--apply`)

- [ ] **Step 1: Create the script with scan + classify + dry-run report**

Create `scripts/industry-data/corpus-fast-track.ts` with:

1. CLI args: `--apply` (boolean), `--market <my|cn|both>` (default: both)
2. Token sets:
   - `EXPLICIT_CNC_TOKENS`: `["cnc", "machinist", "milling", "turning", "machine tool", "precision engineering", "tooling", "mechatronics", "数控", "机床", "机加工", "加工中心", "模具", "刀具", "精密机械"]`
   - `ENGINEER_TOKENS`: `["technical sales engineer", "sales engineer", "application engineer", "field engineer", "技术销售", "销售工程师"]`
   - `EXCLUSION_TOKENS`: `["automobile", "car", "auto parts", "automotive", "汽车", "food", "beverage", "食品", "饮料", "retail", "mart", "shop", "store", "零售", "real estate", "property", "地产"]`
3. Scan function: query `/api/resumes?q=CNC+Sales&location=<loc>&source=convex&paged=true&limit=200&workspaceSlug=hr` for MY (location=Malaysia) and CN (location=China). No `minRoleYears` or `roleType` filter - we want the full unverified cohort.
4. For each resume, extract `ingestData.roleSignals` where `type === "sales"`, then `matchedWorkEntries` where `industryVerified === false`. Collect: `companyName`, `jobTitle`, `years`, `workEntryFingerprint`, `profileUrl`, `identityKey`, `resumeName` (from `name` field).
5. Group by normalized employer surface (lowercase, trim, collapse spaces to `-`).
6. Classify each employer:
   - Tier 1: 2+ distinct resumes (by identityKey) + ANY work entry title has CNC tokens OR engineer tokens
   - Tier 2: 1 resume + title has explicit CNC tokens (engineer tokens alone insufficient)
   - Excluded: employer name matches any EXCLUSION_TOKEN -> mark as "defer" (Tier 3)
   - Everything else: "defer" (Tier 3)
7. Dry-run output: print per-employer table with tier, resume count, titles, years, decision. Print summary counts.

Use the `convexRun` helper from `curate-my-cnc-employers.ts` (lines 85-110) for Convex calls. Use `fetch()` for API calls. Read `CONVEX_WRITE_SECRET` from env or `packages/convex/.env.local`.

The script structure should follow `curate-my-cnc-employers.ts`:
- `getWriteSecret()` helper
- `convexRun<T>(functionName, args)` helper
- `main()` async function
- `process.argv.includes("--apply")` for apply flag

- [ ] **Step 2: Run dry-run to verify classification output**

Run: `npx tsx scripts/industry-data/corpus-fast-track.ts`
Expected: prints classification table with ~5 Tier 1 employers, ~26 Tier 2 employers, and summary counts. No writes.

- [ ] **Step 3: Commit**

```bash
git add scripts/industry-data/corpus-fast-track.ts
git commit -m "feat(industry): corpus-evidence fast-track scan + classify script

Scans resume corpus for unverified employers with CNC/industrial
job-title tokens. Classifies into Tier 1 (2+ resumes), Tier 2
(1 resume + explicit CNC title), or Tier 3 (defer to worker).
Dry-run by default."
```

---

### Task 2: Add upsert + evidence source creation (--apply path)

**Files:**
- Modify: `scripts/industry-data/corpus-fast-track.ts`

**Interfaces:**
- Consumes: `companies:upsert`, `companies:addAlias`, `companies:upsertIndustryProposal`, `companies:upsertIndustryEvidenceSource`, `companies:listIndustryProposals` (all from existing Convex API, write-secret gated)
- Produces: ready_for_review proposals with corpus evidence sources attached

- [ ] **Step 1: Add the apply path to the script**

Add after the dry-run classification section. For each fast-track employer (Tier 1 + Tier 2):

1. Check existing proposals: call `companies:listIndustryProposals` with `{ limit: 5000 }`. Match by `normalizedEmployerSurface` against the employer name. Also match by `companyKey`.
2. For each employer:
   - If no existing proposal: call `companies:upsert` (create company), `companies:addAlias` (add employer name as alias), `companies:upsertIndustryProposal` with `{ proposalId: "corpus-ft-<companyKey>", companyKey, triggerReasons: ["corpus_evidence"], priority: 90, suggestedIndustryClass: "cnc", suggestedVerificationLevel: "verified", status: "ready_for_review", materialChangeSummary: "Corpus evidence: <N> resume(s) with CNC-relevant titles", requestedBy: "corpus-fast-track", sampleReferences: [...], writeSecret }`. NOTE: `upsertIndustryProposal` may not accept `status` directly - check the mutation args. If it only creates with status "new", we need a separate `setIndustryProposalResearchState` call to move to "ready_for_review".
   - If existing proposal with status `new` or `needs_more_evidence`: call `companies:setIndustryProposalResearchState` with `{ proposalId, status: "ready_for_review", writeSecret }`.
   - If existing proposal with status `approved` or `rejected`: skip (log "already decided").
3. For each fast-track employer, create evidence sources: for each distinct resume that contributed evidence, call `companies:upsertIndustryEvidenceSource` with:
   - `sourceId: "corpus-src-<companyKey>-<resumeIdentityHash>"` (unique per resume)
   - `companyKey` (if available)
   - `proposalId`
   - `url: <resume.profileUrl>` (real HTTPS URL from Seek/51job)
   - `sourceType: "other"`
   - `trustTier: "corroborating"`
   - `title: "Corpus evidence: <jobTitle> (<years>y) at <employerName>"`
   - `evidenceExcerpt: "<jobTitle>, <years> years"`
   - `fetchStatus: "fetched"`
   - `fetchedAt: Date.now()`
   - `contentFingerprint: "corpus-<workEntryFingerprint>"`
   - `writeSecret`

The `upsertIndustryEvidenceSource` mutation (Convex `companies.ts:1905`) accepts these args. It sets `reviewStatus: "unreviewed"` and `sourceState: "active"` by default. The `normalizeIndustryEvidenceUrl` check on the URL will pass because `profileUrl` is a valid public HTTPS URL.

4. Log each action: `[✓] <companyKey> tier=<1|2> resumes=<N> sources=<M>`
5. Error handling: catch per-employer, log error, continue.

- [ ] **Step 2: Run with --apply against local Convex**

Run: `npx tsx scripts/industry-data/corpus-fast-track.ts --apply`
Expected: creates/upgrades ~31 proposals to ready_for_review with corpus evidence sources. Each line shows `[✓] <companyKey> tier=<1|2> resumes=<N> sources=<M>`.

- [ ] **Step 3: Verify proposals are ready_for_review**

Run: `cd packages/convex && npx convex run companies:listIndustryProposals '{"writeSecret":"<secret>","limit":200,"status":"ready_for_review"}'`
Expected: count increased by ~31 from the baseline of 31.

- [ ] **Step 4: Commit**

```bash
git add scripts/industry-data/corpus-fast-track.ts
git commit -m "feat(industry): add upsert + evidence source creation to corpus fast-track

Creates ready_for_review proposals with corpus evidence sources
for high-confidence CNC employers. Evidence source URL = resume
profileUrl (real public HTTPS). Uses existing Convex mutations
only - no schema changes."
```

---

### Task 3: Run auto-verify + reingest

**Files:**
- No file changes - uses existing scripts

- [ ] **Step 1: Run auto-verify with --apply**

Run: `CONVEX_WRITE_SECRET=<secret> npx tsx scripts/industry-data/auto-verify-proposals.ts --limit 100 --apply`
Expected: batch-approves ready_for_review proposals. The corpus evidence sources pass the approval-safe filter (trustTier=corroborating, fetchStatus=fetched, sourceState=active, reviewStatus not rejected/disputed). Log shows "N approved".

- [ ] **Step 2: Run reingest**

Run: `cd packages/convex && npx convex run migrations:reIngestAllResumes '{}'`
Expected: recomputes verifiedRoleYears and stamps industryVerified on work entries at newly approved employers. Takes 1-3 minutes.

- [ ] **Step 3: Verify golden query count grew**

Run: `curl -s "http://localhost:3000/api/resumes?q=CNC+Sales&location=Malaysia&minRoleYears=1&roleType=sales&source=convex&paged=true&limit=200&workspaceSlug=hr" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(f'MY golden: {d[\"summary\"][\"total\"]}")'`
Expected: total > 37 (the pre-fast-track baseline).

Also check CN:
Run: `curl -s "http://localhost:3000/api/resumes?q=CNC+%E9%94%80%E5%94%AE&location=China&minRoleYears=1&roleType=sales&source=convex&paged=true&limit=200&workspaceSlug=hr" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(f'CN golden: {d[\"summary\"][\"total\"]}")'`
Expected: total > 447.

- [ ] **Step 4: Commit the auto-verify-proposals.ts change (already modified)**

```bash
git add scripts/industry-data/auto-verify-proposals.ts
git commit -m "fix(industry): stricter approval-safe filter for auto-verify

Adds fetchStatus/sourceState/reviewStatus checks to the approval-safe
filter. Corpus evidence sources pass all checks."
```

---

### Task 4: UAT verification - API search scenarios

**Files:**
- No file changes - captures to `/tmp/uat-search-{a,b,c}.json`

- [ ] **Step 1: Capture scenario (a) - MY CNC Sales with verified gate**

Run:
```bash
curl -s "http://localhost:3000/api/resumes?q=CNC+Sales&location=Malaysia&minRoleYears=1&roleType=sales&source=convex&paged=true&limit=200&workspaceSlug=hr" > /tmp/uat-search-a.json
```
Then run it again and compare totals (consistency check):
```bash
curl -s "http://localhost:3000/api/resumes?q=CNC+Sales&location=Malaysia&minRoleYears=1&roleType=sales&source=convex&paged=true&limit=200&workspaceSlug=hr" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d['summary']['total'])"
```
Expected: both totals identical, and > 37.

- [ ] **Step 2: Capture scenario (b) - MY CNC Sales without gate**

Run:
```bash
curl -s "http://localhost:3000/api/resumes?q=CNC+Sales&location=Malaysia&source=convex&paged=true&limit=200&workspaceSlug=hr" > /tmp/uat-search-b.json
```
Expected: total > (a) total.

- [ ] **Step 3: Capture scenario (c) - CN CNC 销售 with verified gate**

Run:
```bash
curl -s "http://localhost:3000/api/resumes?q=CNC+%E9%94%80%E5%94%AE&location=China&minRoleYears=1&roleType=sales&source=convex&paged=true&limit=200&workspaceSlug=hr" > /tmp/uat-search-c.json
```
Expected: total > 447.

---

### Task 5: UAT verification - gate cross-check + fast-track accuracy audit

**Files:**
- No file changes - captures to `/tmp/uat-sample.json`

- [ ] **Step 1: Sample 5+ resumes from scenario (a) and verify gate**

Parse `/tmp/uat-search-a.json`, take first 5 resumes. For each:
- Check `ingestData.verifiedRoleYears.sales >= 1`
- Check at least one `matchedWorkEntries` has `industryVerified: true` and `directRoleMatch: true`
- Extract employer companyKey and check it appears in approved proposals from `listIndustryProposals`
- Write results to `/tmp/uat-sample.json`

- [ ] **Step 2: Audit fast-track employers for false positives**

For each employer fast-tracked via corpus evidence:
- Verify the approved profile exists in Convex (query `listIndustryProposals` with `status: "approved"`)
- Confirm none have exclusion-token names (automobile, food, retail, etc.)
- For at least 3 employers, confirm resume work entries now show `industryVerified: true`

---

### Task 6: UAT verification - browser + fixture + report

**Files:**
- Captures to `/tmp/uat-browser-*.png`, `/tmp/uat-fixture.log`, `/tmp/uat-report.md`

- [ ] **Step 1: Browser UAT (honest degradation)**

Try to load `http://localhost:5173/hr/resumes?location=Malaysia&q=CNC+Sales&minRoleYears=1&roleType=sales` with Playwright using an authenticated session (check `tmp/industry-review/browser-state.json`). If auth fails, capture the failure and fall back to API checks.

- [ ] **Step 2: Fixture check**

Run: `bun run verify:industry-review-uat -- --base-url http://localhost:3000 > /tmp/uat-fixture.log 2>&1`
Expected: exit 0, status `passed`.

- [ ] **Step 3: Write go/no-go report**

Write `/tmp/uat-report.md` with:
- Per-scenario rows (observed vs expected)
- Fast-track accuracy audit results
- Defects found/fixed
- Explicit go/no-go recommendation

---

### Task 7: Commit untracked files + final commit

**Files:**
- `scripts/industry-data/curate-my-cnc-employers.ts` (untracked from prior session)
- `scripts/industry-data/auto-verify-proposals.ts` (modified)
- `uat-search-results.yml` (untracked - check if needed or should be gitignored)

- [ ] **Step 1: Commit curate script + auto-verify changes**

```bash
git add scripts/industry-data/curate-my-cnc-employers.ts scripts/industry-data/auto-verify-proposals.ts
git commit -m "feat(industry): curate MY CNC employers + stricter auto-verify filter

Adds curate-my-cnc-employers.ts (17 curated MY CNC employers from
resume corpus evidence) and tightens auto-verify approval-safe filter
with fetchStatus/sourceState/reviewStatus checks."
```

- [ ] **Step 2: Check if uat-search-results.yml should be committed or gitignored**

If it's a stale browser snapshot unrelated to this work, add to `.gitignore`. If relevant, commit.
