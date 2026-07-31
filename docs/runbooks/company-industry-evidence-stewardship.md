# Company Industry Evidence Stewardship

## Purpose

This runbook covers the attended lifecycle for reviewed company-industry evidence used by `行业验证`, verified role years, recruiter source previews, and targeted resume recomputation.

The governing rule is simple: automated research may discover, fetch, compare, and propose evidence, but it cannot approve, reject, revoke, or replace current truth. Only an authenticated human reviewer can advance an immutable verdict revision.

## Runtime boundaries

- Search, filtering, scoring, and Resume Detail read materialized data only.
- Recruiter-facing cards expose only human-approved `verified` summaries.
- A stale, unavailable, or changed source creates a proposal; it does not remove a current verified badge.
- `candidate`, `rejected`, worker confidence, conflicts, and unreviewed URLs stay inside stewardship surfaces.
- Preview and production strict cutover require separate authorization.

## Proposal lifecycle

Proposals may be coalesced from three trigger classes:

1. Ingest-driven unknown, weak, frequent, or high-value employer surfaces.
2. Scheduled freshness checks for approved evidence.
3. Recruiter-requested refresh from Resume Detail.

Repeated triggers merge into the existing open proposal by canonical `companyKey`, or by normalized unresolved employer surface when no company mapping exists.

The normal attended flow is:

1. Open the Industry Verification page under System Settings.
2. Select a `ready_for_review` proposal.
3. Confirm the canonical company, current revision, source domains, source types, excerpts, fetch timestamps, and material-change summary.
4. Approve only durable public HTTP(S) sources. Search-result pages and discovery-trust sources are not approval evidence.
5. Choose `verified` or `rejected`, the taxonomy class, decision reason, taxonomy version, and next review date.
6. Approve. The system creates a new immutable revision and advances the current profile atomically.
7. Start or monitor targeted recomputation for linked resumes.

Use `needs_more_evidence` when the evidence is insufficient. Use `rejected` on the proposal to reject the proposed change without creating a company truth revision. A company verdict of `rejected` is a separate attended approval that creates an immutable rejected revision.

## MY bootstrap

Prepare a reviewed JSON array with one entry per canonical company:

```json
[
  {
    "companyKey": "example-cnc",
    "employerName": "Example CNC Sdn. Bhd.",
    "industryClass": "cnc",
    "verificationLevel": "verified",
    "evidenceSummary": "Official product catalog confirms CNC machine tools.",
    "decisionReason": "Reviewed primary company evidence.",
    "taxonomyVersion": "industry-v1",
    "nextReviewAt": 1816982400000,
    "sources": [
      {
        "url": "https://example.com/products/cnc",
        "sourceType": "official_site",
        "trustTier": "primary",
        "title": "CNC products",
        "evidenceExcerpt": "Reviewer-selected bounded excerpt."
      }
    ]
  }
]
```

Validate and generate deterministic IDs without changing state:

```bash
bunx tsx scripts/industry-data/import-my-bootstrap-profiles.ts \
  --input output/industry-data/my-reviewed-evidence.json
```

Inspect the generated `*-bootstrap-plan.json`. Then, during an attended local session, apply it:

```bash
TRENDS_AUTH_USERNAME=... \
TRENDS_AUTH_PASSWORD=... \
bunx tsx scripts/industry-data/import-my-bootstrap-profiles.ts \
  --input output/industry-data/my-reviewed-evidence.json \
  --api-url http://localhost:3000 \
  --workspace dev \
  --apply
```

The apply step writes:

- `*-apply-results.json`;
- `*-rollback-packet.json`.

IDs are deterministic, so an interrupted retry coalesces with the same proposals and sources. Approval also uses optimistic current-revision matching, preventing a stale bootstrap packet from silently overwriting newer truth.

## Web research discovery

Discovery is an optional, default-off worker capability. When a proposal has no candidate sources, the scheduled maintenance job may first search the public web, fetch the top hits, classify their trust, and feed them into the same governed enrichment path used for every other candidate. The output is still only a proposal: search → fetch → classify → proposal enrichment.

Discovery runs for empty proposals only. If a proposal already has candidate sources, the maintenance job uses them and never searches.

Enablement requires both flags, set in the local `.env` only (never committed):

```bash
INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED=1
WEB_RESEARCH_ENABLED=1
```

Provider keys are optional. The provider chain and query pack depend on the target market, selected with `WEB_RESEARCH_MARKET` in `.env` (default `cn` — internal users are China users; CN is the product core):

- **CN (product core)** — the default; operators may set `WEB_RESEARCH_MARKET=cn` explicitly to confirm. Internal users are China users, so this is the market for attended employer-discovery runs. The chain is NewsNow (ourongxing/newsnow-compatible upstream, `https://newsnow.busiyi.world/api/s?id=<platform>&latest` with a browser UA + Referer) → DuckDuckGo → Google News RSS. NewsNow hotlists (zhihu, weibo, baidu, toutiao, thepaper) are not keyword-searchable upstream: the worker fetches each platform's hotlist and filters items client-side by employer tokens, so recall is hotlist-bounded — a hot employer story surfaces the same day, but a cold employer may return nothing. The CN query pack is `<surface> 公司` / `<surface> 机床` / `<surface> 数控`.
- **MY (additional case)** — opt in with `WEB_RESEARCH_MARKET=my`. Without keys, the chain is the free DuckDuckGo HTML endpoint followed by the Google News RSS search endpoint — both zero-key dev defaults, use them gently. DuckDuckGo may be bot-walled (CAPTCHA) from some networks, in which case it returns zero results and the chain soft-fails onward to Google News RSS, which returns reporting-tier news hits classified against MY/SG and global business press domains. The MY query pack is `<surface> Malaysia` / `<surface> CNC machine` / `<surface> machinery`.

The NewsNow upstream base URL is the same `RESEARCH_HOTLIST_API_URL` override used by hotlist news ingest — point it at a self-hosted newsnow / TrendRadar instance to change both in one place; no second env var.

With `TAVILY_API_KEY` and/or `BRAVE_API_KEY` present, the keyed providers prepend the chain in either market (Tavily and/or Brave first, then the market chain, with Google News RSS always last as the zero-key fallback). Keyed providers give full web search when hotlist-bounded recall is not enough. On each query the chain tries providers in order, skipping any provider whose monthly quota is exhausted, until one returns results.

Every provider query is recorded in the `web_research_quota` Convex table. The cap is 1000 queries per provider per month; when a provider reaches its cap the worker stops calling it (hard stop — no search request is made). Inspect the ledger rows from the Convex dashboard after any attended dry-run.

### Employer-relevance tightening (2026-07-30)

Discovery demotes unproven candidates to `discovery` tier before governed enrichment, so a hit can only flip a proposal to `ready_for_review` when its *content* provably mentions the employer:

- Only distinctive employer tokens count. Ultra-generic words (`new`, `line`, `group`, `tech`, `power`, `star`, `edge`, `world`, `holdings`, `services`, `engineering`, …) appear in any English news homepage and never prove relevance on their own. A surface with no distinctive vocabulary fails open (no filtering).
- The gate reads `title + excerpt` only — never the URL, because every curated press homepage passes on domain alone.
- Excerpt-provided hits (Google News RSS descriptions) whose excerpt lacks the employer are demoted; excerpt-less hits with portal-style homepage titles (`NST Online`, `The Edge Malaysia`, taglines, short publisher self-titles) are demoted because their fetched content would be homepage boilerplate.
- Demoted rows are **kept** on the proposal for steward visibility (marked `relevanceDemoted`) but are never approval-safe and cannot drive `ready_for_review` alone.

This was the fix for the robo-machine-tools false-ready run: generic tokens (`robo`, `machine`, `tools`) matched manufacturing headlines, and curated MY press homepages counted as proof sources without any employer-specific content.

Governance does not change under discovery:

- Automation never approves. Discovery output can at most move a proposal to `ready_for_review`; only an authenticated human reviewer advances a verdict revision.
- `discovery` and `search_result` sources are never approval-safe evidence. Approve only durable public HTTP(S) pages.
- Unreviewed evidence never reaches recruiters. Discovery-tier sources stay inside stewardship surfaces until a human approves a revision.
- Hot paths stay network-free. All web access happens in the worker; search, scoring, and Resume Detail never fetch.

## Maintenance ops automation (2026-07-30)

Governed maintenance runs automatically on a schedule and on data events, with an operator manual trigger and full run observability. Every run records a summary row and a per-proposal ledger in Convex so an operator can answer "why did/didn't employer X surface?" without terminal-log spelunking.

### Triggers

| Source | When | Hook |
|---|---|---|
| `schedule` | APScheduler 24h cadence (`INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED=1`) | Worker self-registers a run row |
| `restore` | After `make restore-resumes` / any import inserting ≥1 resume | API pipeline enqueues post-import |
| `approval` | After a human approves a proposal (so recycled `needs_more_evidence` re-chews) | API pipeline enqueues post-approve |
| `manual` | Operations page "Run maintenance now" button | `POST /api/worker/industry-maintenance` |

### Coalescing

If a run is already `queued` or `running` for the workspace, a new trigger appends its context onto that run instead of spawning a duplicate. Restoring 4 snapshot files produces 1 run, not 4.

### Run registry + ledger

- `industry_maintenance_runs` - one row per execution: `triggerSource`, `status` (`queued`/`running`/`completed`/`failed`/`skipped`), `counts` (proposalsResearched, readyCreated, sourcesDemoted, freshnessChecked, freshnessRefreshed, errors), `operatorSummary`.
- `industry_maintenance_ledger` - one row per proposal action: `action` (`researched`/`ready`/`demoted`/`needs_more_evidence`/`freshness_ok`/`freshness_refreshed`/`error`) + human-readable `reason`.

Ledger writes are best-effort: a Convex outage logs a warning and never aborts the run. Maintenance correctness does not depend on observability.

### Admin surfaces

- **Operations page** (`/system-settings/operations`): "Industry evidence maintenance" card shows the last run (status, trigger, summary) and a "Run maintenance now" button (admin-only, CSRF, busy state).
- **Industry-verification page** (`/system-settings/industry-verification`): "Maintenance run history" section below the review queue. Expand a row to lazy-load its ledger with action-tone chips (green=ready, amber=demoted/needs_more, red=error). When the queue is empty the hint points at the history section.

### Reading the ledger to debug "why didn't employer X surface?"

1. Find the employer's proposal on the verification page, or query `GET /api/company-industry-proposals/:proposalId/maintenance-ledger`.
2. The ledger rows show every maintenance decision for that proposal across runs: `demoted` (with the reason, e.g. "homepage-only evidence, demoted pre-fetch"), `needs_more_evidence` (with the shortfall), `ready`, or `error` (with the provider failure).
3. Cross-reference with the run's `operatorSummary` for the overall outcome.

### Env gates

- `INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED=1` enables scheduled maintenance. The manual trigger and API pipeline force-enable the gate for their call (mirroring `/worker/research/ingest`), so manual/restore/approval runs work even when the scheduled gate is off.
- When the gate is off at schedule time the job is not registered; the Operations card shows the disabled hint.

## Industry data central management (2026-07-31)

Phase A: Convex is the canonical store for CN industry data (`industry_data_entries` + append-only `industry_data_change_log`). Edits regenerate `config/industry-data/` files (`brands.json`, `keywords-structured.md`, `company-urls.md`) and best-effort git-commit them. Ingest and public `/api/industry/*` keep reading the files unchanged. `keywords-raw.md` is out of scope.

### Where the admin UI lives

- **Industry Data** page: `/system/settings/industry-data` (admin nav sibling to Industry verification / Operations).
- Three tabs:
  - **Manage** — list/filter by entryType, import JSON, export JSON, delete; edits go through `/api/industry-data/*`.
  - **Control center** — Run now (`POST /api/worker/industry-maintenance`), Pause/Resume schedule (`POST /api/industry-data/schedule`), scoped “research this employer now” (`POST /api/industry-data/trigger` with `companyKey`), recent runs.
  - **Audit** — unified timeline of data edits + maintenance ledger (`GET /api/industry-data/audit?companyKey=`).

All routes under `/api/industry-data/*` require admin + CSRF.

### Seed-once flow

After deploy/reset of the Convex tables, import the current on-disk files once:

```bash
# authenticated admin session + CSRF
curl -X POST "$API/api/industry-data/seed" -H "X-Workspace-Slug: dev" ...
# → { "success": true, "imported": N }
```

Seed is idempotent (stable entryIds: `brand-<id>`, `company-<category>-<id>`, `keyword-<category>-<id>`, `url-<hash>`). It does **not** regenerate or git-commit — it only upserts Convex from files.

### Edit → regenerate → commit flow

1. Admin edits via Manage (PUT/POST/DELETE `/api/industry-data/entries…`) or bulk import.
2. API validates → Convex upsert/delete + change-log row (`gitSha: null` initially).
3. Generator rewrites the three files under `config/industry-data/`.
4. Best-effort `git add` + `git commit` (`chore(industry-data): regenerate from admin (<actor>)`).
5. On success, change-log row gets the new HEAD sha; response includes `gitSha`. On git failure, files are still written, `gitSha: null`, and `warning` is returned — UI shows a warning toast. Never throws into the CRUD response.

### Pause / resume schedule

- `POST /api/industry-data/schedule { "paused": true|false }` writes Convex system flag `industryMaintenanceSchedulePaused`.
- Worker checks the flag only for `trigger == "schedule"`: when paused, the run finishes as `skipped` with message containing “paused”.
- Manual / scoped triggers ignore the flag.

### Scoped research

`POST /api/industry-data/trigger { "companyKey": "lung-kee-metal" }` → `enqueueIndustryMaintenance({ triggerSource: "manual", triggerContext: companyKey })`. Ledger rows for that employer appear in the Audit timeline under kind `maintenance`.

### Reading the unified audit timeline

`GET /api/industry-data/audit?companyKey=&limit=` merges:

| kind | source | fields |
|---|---|---|
| `data_edit` | `industry_data_change_log` | action, actor, entryId, gitSha, before/after |
| `maintenance` | `industry_maintenance_ledger` (via recent runs) | action, reason, runId, companyKey |

Newest-first. Filter by `companyKey` when debugging a single employer.

### Failure modes

| Symptom | Meaning | Operator action |
|---|---|---|
| `gitSha: null` + warning toast | Files written; git commit failed (dirty tree / no git) | Inspect working tree; commit manually if needed |
| 400 validation reject | Bad entry payload; no Convex write | Fix JSON and retry (import is all-or-nothing) |
| Schedule-paused skips | Flag true; scheduled job records `skipped` | Resume via Control center or leave paused |
| 401/403 on `/api/industry-data/*` | Not signed in as admin | Use admin membership on the workspace |

### Live verification (attended, deferred from automated bar)

When the local stack is up (API + worker + Convex): seed → list brands → edit one alias via PUT → confirm `config/industry-data/brands.json` updated + `git log -1` shows `chore(industry-data)` → audit shows the data_edit row with gitSha → scoped trigger returns runId → pause toggles true. Unit/route tests cover the same contracts without requiring the live stack.

## Verified employers in recruiter search (keyword bridge)

Approved verdicts drive recruiter search recall, not just the card badge. When a keyword group is industry-scoped (via the skills.md domain taxonomy — `machinery` maps to cnc/automation/metrology/industrial), `/api/resumes/keyword-expansion` injects the display names and aliases of companies whose **current** verdict revision is `verified` and taxonomy-compatible. A candidate whose employer is verified (e.g. Eonmetall Group Bhd, verified/cnc) then matches a "CNC Sales" search even when the raw resume text contains no CNC term.

- Read-only and current: the feed (`companies:listVerifiedIndustryEmployerAliases`) reads live profiles, so superseding rejections remove an employer from expansion immediately. Rejected/unknown profiles never bridge.
- Degraded catalog = synonyms-only expansion (silent, logged).
- Query-time behavior: no re-ingest is required when the bridge or verdicts change; only the usual profile→recompute path updates cards.
- The 60s TTL cache warms at API startup; the first expansion before warm returns synonyms-only.

## Rollback

Verdict revisions are immutable. Never delete or mutate the imported current revision.

Use the rollback packet to create a new attended compensating proposal:

1. Compare the packet’s `previousCurrentRevisionId` with current state.
2. Re-open the prior evidence and decision context.
3. Create a new proposal that explicitly supersedes the imported revision.
4. Approve a new compensating revision with a clear rollback reason.
5. Run targeted recomputation for the company.

If the prior state had no approved revision, approve a new `rejected` or corrected classified revision only when evidence supports it. Do not restore legacy seed truth by direct database patch.

## Local strict cutover

Strict mode may be enabled locally only after:

- reviewed bootstrap coverage is accepted for the intended MY golden cohort;
- every projected verified summary references a current immutable revision;
- affected resumes have completed targeted recomputation;
- golden searches return semantically verified direct work entries;
- recruiter cards and Resume Detail show the same revision IDs;
- no request-time research or external fetch appears in browser network traces.

Set locally:

```bash
INDUSTRY_EVIDENCE_COMPATIBILITY_MODE=strict-reviewed
```

Restart the API, run the compute-mode reingest/targeted recompute, and verify the MY CNC golden queries. If coverage regresses, unset the variable, restart locally, and investigate missing company mappings or revisions. Do not enable strict mode in preview or production from this runbook.

## Failure handling

- Catalog unavailable: ingest marks the catalog degraded and invents no verification.
- Revision mismatch: digest years become unverified/stale until recomputation.
- Source fetch failed: preserve current truth and create/coalesce a maintenance proposal.
- Approval concurrency conflict: reload current revision and review again.
- Partial recompute: retry the durable run; completed resume identities remain idempotent.
- Unsafe URL: reject before persistence or projection.
- Worker unreachable from the trigger pipeline: the run is marked `failed` with the connection error; schedule/restore triggers retry on the next event (no infinite retry loop).
- Maintenance mode active: the run is recorded as `skipped` with the reason (visible in history instead of a silent skip).
- Ledger write failure: best-effort only; the maintenance run completes normally and the missing ledger rows do not affect correctness.

## Audit evidence

For each attended approval retain:

- proposal ID and trigger reasons;
- canonical company key;
- approved source IDs and normalized domains;
- immutable revision ID;
- reviewer and review timestamp;
- decision reason and taxonomy/rule version;
- targeted recompute run ID, counts, failures, and final state;
- rollback packet for bootstrap batches.
