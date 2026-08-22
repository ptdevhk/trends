# Company Industry Evidence Stewardship

## Purpose

This runbook covers the attended lifecycle for reviewed company-industry evidence used by `行业验证`, verified role years, recruiter source previews, and targeted resume recomputation.

The governing rule is simple: automated research may discover, fetch, compare, and propose evidence, but it cannot approve, reject, revoke, or replace current truth. Only an authenticated human reviewer can advance an immutable verdict revision.

**Amended by the governed Lane A auto-verify lane (v0.4.24):** automation may approve a `verified` verdict ONLY when every Lane A condition holds — every selected source is a structured `registry`/`taxonomy` record with explicit CNC/industrial signal text (never prose: official sites, reporting, OEM pages, directories route to the human cockpit), all sources are fetched + active + unreviewed, the proposal has a canonical `companyKey`, and the verdict is `verified` only. `rejected` verdicts remain human-only, forever. Every revision records `reviewerType` (`human` | `auto-verify-bot`) for audit, and a ~10% risk-weighted sampling audit re-reviews auto-approved verdicts with override-rate tracking.

## Runtime boundaries

- Search, filtering, scoring, and Resume Detail read materialized data only.
- Recruiter-facing cards expose only approved `verified` summaries (human or governed Lane A).
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

- **CN (product core)** — the default; operators may set `WEB_RESEARCH_MARKET=cn` explicitly to confirm. Internal users are China users, so this is the market for attended employer-discovery runs. The chain is So360 (`so.com` keyword search, `WEB_RESEARCH_360_ENABLED=1` default-on) → NewsNow (ourongxing/newsnow-compatible upstream, `https://newsnow.busiyi.world/api/s?id=<platform>&latest` with a browser UA + Referer) → DuckDuckGo → Google News RSS. So360 is the primary CN provider: it parses `so.com` result pages, resolves meta-refresh redirects, and feeds shuidi.cn company-record pages into the registry lane. NewsNow hotlists (zhihu, weibo, baidu, toutiao, thepaper) are not keyword-searchable upstream: the worker fetches each platform's hotlist and filters items client-side by employer tokens, so recall is hotlist-bounded — a hot employer story surfaces the same day, but a cold employer may return nothing. The CN query pack is `<surface> 公司` / `<surface> 机床` / `<surface> 数控`.
- **CN registry lane** — shuidi.cn, qcc.com, tianyancha.com, and xin.baidu.com are classified as `registry`/`authoritative` **only** for company-record URLs (path patterns: `/company-<hex>.html`, `/firm/`, `/company/<id>`, `/detail/compinfo`). Homepages and 360-search landings (e.g. `qcc.com/?utm_source=360zrkp`) are `search_result`/`discovery` — they fail fetch and would hard-block review with `stale_or_failed_source` if misclassified (observed and fixed 2026-08-14). aiqicha.baidu.com is always discovery (rate-gates anonymous access).
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

## Governed Lane A auto-verify (2026-08-07, v0.4.24)

Lane A is the single, narrow exception to "automation never approves". It exists so that structured registry/taxonomy evidence — the highest-trust, lowest-ambiguity source class — can advance to `verified` without a human click, while everything else still routes to the human cockpit (Lane B). The lane is deliberately conservative: it can only approve, never reject, and it can only approve when every condition below holds.

### Lane A conditions (all must hold)

1. **Structured source types only.** Every selected source must be `registry` or `taxonomy`. Prose sources — `official_site`, `reporting`, `oem_page`, `directory`, `search_result`, `discovery` — are never auto-approvable and route to the human cockpit.
2. **Explicit CNC/industrial signal text.** Every source must carry explicit CNC/industrial evidence text (`hasExplicitCncEvidence` regex, the same gate used by the attended approval path). A registry row that merely names the company without industrial signal does not qualify.
3. **Fetched + active + unreviewed.** Every source must be fetched, active, and not previously reviewed/disputed/rejected.
4. **Canonical `companyKey`.** The proposal must be mapped to a canonical company. Unmapped proposals (the bulk of the Tier-3 backlog) cannot be auto-approved — they stay in the human queue.
5. **Verdict is `verified` only.** Lane A never writes `rejected`; rejection remains human-only, forever.
6. **No risk flags.** Proposals with conflicts, worker low confidence, or other risk flags are excluded from the lane.

The shared policy lives in `packages/shared/src/industry-review.ts` (`isAutoApprovableSource` / `hasAutoApprovableEvidence` / `AUTO_VERIFY_SOURCE_TYPES`) and is enforced inside the Convex mutation — the script and API are thin drivers and cannot bypass it.

### Mutation and idempotency

- `companies:autoApproveIndustryProposal` requires `companyKey`, an open proposal, and ≥1 source; if any source fails the Lane A gate it errors with `AUTO_VERIFY_LANE_A_REQUIRED` and writes nothing.
- The revision is deterministic: `revisionId = auto-<fnv1a8(proposalId + approvedSourceIds + fingerprint)>`. Re-running the same approval is idempotent and returns `{ idempotent: true, revisionId }` instead of duplicating a revision.
- The attestation fingerprint is derived from the actual approved sources (no caller-supplied fingerprint), so the revision is self-verifying.
- Every revision records `reviewerType: "auto-verify-bot"` (attended approvals record `"human"`; legacy rows before v0.4.24 are optional and inferred via `reviewedBy`).

### Queue and UI

- `listIndustryReviewQueue` excludes auto-approvable proposals (`excludeAutoApprovableFromQueue`), so the human cockpit only ever shows work the bot cannot do. The recommendation payload exposes `autoApprovable` for observability.
- Recruiter-facing cards expose approved `verified` summaries regardless of reviewer type; there is no UI distinction, and no additional action is required from `hr`/admin users when the bot approves — the search results update on the next recompute exactly as they do after a human approval.

### Sampling audit (HOTL)

A ~10% risk-weighted sample of auto-approved revisions is re-reviewed by a human steward (`scripts/industry-data/sampling-audit.ts`): single-source approvals are weighted ×2, corroborating multi-source ×1.5, and the sample is drawn deterministically from the revision list. The audit writes a report to `output/industry-data/auto-verify-audit-<ts>.json` with the sampled revisions and an override rate. A rising override rate is the signal to tighten the lane (e.g. require corroboration, or demote a source type).

### Drain script

`scripts/industry-data/auto-verify-proposals.ts` lists auto-approvable proposals and calls the governed mutation for each, reporting approved vs idempotent re-runs. It is a thin driver: all policy enforcement happens in the mutation.

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

### Shared review recommendations (2026-07-31)

The verification queue and the read-only Trends CLI consume the same deterministic
`industry-review.v1` recommendation envelope. The API computes source eligibility,
risk flags, confidence, source preselection, and worker-failure warnings at read time;
it does not change an approved profile or proposal status.

- **Queue:** `GET /api/company-industry-proposals/review-queue?status=ready_for_review&limit=100`
- **Packet:** `GET /api/company-industry-proposals/:proposalId/review-packet`
- **CLI:** `trends industry review`, `inspect`, `recommend`, `review-packet`, and `open`
  (all read-only; set `--output json` for the shared envelope).
- `discovery`, `search_result`, unsafe, stale, unavailable, failed, disputed, and
  conflicting sources are never preselected as approval-safe evidence. CNC claims need
  explicit industrial/product evidence and remain human-reviewed.
- The approval form sends the packet fingerprint, proposal timestamp, and source
  versions. Convex returns `409 INDUSTRY_REVIEW_STALE` when any of those inputs changed;
  reload the packet before deciding. Resolve actions carry the proposal timestamp too.
- `requiresHumanReview` is always `true`. The CLI intentionally has no approve/reject
  or bulk command; use the authenticated admin UI for the final attended decision and
  targeted recompute.

When the packet contains `worker_unreachable`, start `apps.worker.api` on `:8000`,
verify the API's worker URL, and run maintenance again. A newer successful maintenance
run suppresses an older worker-failure warning; a failure with no newer success remains
visible so an empty evidence queue is not mistaken for a negative industry finding.

### CNC reviewer cockpit and local UAT (2026-07-31)

The recommendation-led cockpit keeps CNC and other elevated-risk evidence decisions
human-only. The shared `industry-review.v1` policy classifies explicit industrial or
product evidence separately from keyword-only claims; keyword-only CNC evidence stays
`needs_more_evidence`, while discovery/search-result sources remain visible but cannot
be selected for approval. An approval request must carry the current packet fingerprint,
the selected source IDs, and a versioned `reviewAttestation`; stale input returns the
stable `409 INDUSTRY_REVIEW_STALE` contract.

The local UAT harness is intentionally split into a guarded setup write, read-only
automated checks, an approval-intercepting browser check, and a read-only post-check:

```bash
# Read-only fixture/policy checks; accepts --base-url http://localhost:3000 for health.
bun run verify:industry-review-uat -- --base-url http://localhost:3000

# Namespaced local setup only. This refuses non-loopback Convex URLs and requires
# CONVEX_WRITE_SECRET; it writes an ignored before-snapshot under tmp/.
# --workspace overrides the default 'dev' fixture workspace (e.g. --workspace hr).
bun --env-file=.env.local run setup:industry-review-uat -- --allow-local-write

# Browser path reaches confirmation but intercepts approval, so it cannot mutate truth.
# --workspace defaults to 'hr' (the reviewer workspace route); pass --workspace dev to
# run against the dev workspace. Row selection uses data-testid (locale-independent).
bun run verify:industry-review-browser-uat -- --storage-state tmp/industry-review/browser-state.json

# After one attended approval in the authenticated local UI, verify coverage,
# immutable revision, targeted recompute, maintenance run/ledger, and zero extra truth changes.
bun --env-file=.env.local run verify:industry-review-post-uat
```

The final attended action is exactly one authenticated approval of the explicit-CNC
fixture. There is no setup reset or cleanup command: preserve the namespaced evidence,
the before-snapshot, and the post-UAT report for review. The CLI remains read-only;
`trends industry recommend` consumes the recommendation-only endpoint and cannot
approve, reject, or bulk-mutate industry truth.

#### Fixture company mapping (CN, 2026-08-14)

The `companyKeyByCase` block in `scripts/industry-review/fixtures/cnc-review-cases.json`
is a local-environment binding: it must point at companies that already exist in the
local Convex registry with no open proposal. The mapping was rebound from the original
MY bootstrap companies (adastream-sdn-bhd, airtac-industrial-malaysia-sdn-bhd,
alps-electric, amerix-metal-machining-technology, anoz-aluminiumsuzhoucoltd,
autoveyor-malaysia-sdn-bhd) to the CN registry lane:

| Case | Local company | Why |
|---|---|---|
| explicit-cnc (manual approval) | `polywell` | Zero resume links + zero prior verdict revisions → recompute reaches terminal and verified-profile delta is exactly +1 |
| keyword-only | `pro-technic-machinery` | Canonical CNC machine-tool distributor |
| discovery-only | `candidate-a863a82c…` (济南创开电气) | Provisional electrical-equipment company |
| stale-source | `上海易初电线电缆有限公司` | Already-verified industrial; "previous catalog unavailable" narrative |
| conflict | `candidate-493dce82…` (宁波中大力德) | Reducer/transmission maker sits between CNC and automation |
| worker-failure | `米思米中国精密机械贸易有限公司` | Maintenance-only case; carries corpus links (unused by this case) |

Rebinding rules of thumb (enforced by the harness): the mapped company must (1) exist
in `companies:list`, (2) have no open proposal with a different proposalId
(`setup-local-uat.ts` fails otherwise), (3) have **no verified industry profile** for
the manual-approval case (approval patches the profile in place, so a pre-existing
profile makes the post-UAT verified-profile delta 0), and (4) be findable by the
browser UAT (row selection now uses the row's `data-testid`; a company with zero
corpus links keeps the recompute run clean). Avoid companies whose resumes carry
real corpus links for the manual case — the recompute re-ingest can stall on
`industry_evidence_company_link_missing` targets.

### Reading the ledger to debug "why didn't employer X surface?"

1. Find the employer's proposal on the verification page, or query `GET /api/company-industry-proposals/:proposalId/maintenance-ledger`.
2. The ledger rows show every maintenance decision for that proposal across runs: `demoted` (with the reason, e.g. "homepage-only evidence, demoted pre-fetch"), `needs_more_evidence` (with the shortfall), `ready`, or `error` (with the provider failure).
3. Cross-reference with the run's `operatorSummary` for the overall outcome.

### Env gates

- `INDUSTRY_EVIDENCE_MAINTENANCE_ENABLED=1` enables scheduled maintenance. The manual trigger and API pipeline force-enable the gate for their call (mirroring `/worker/research/ingest`), so manual/restore/approval runs work even when the scheduled gate is off.
- When the gate is off at schedule time the job is not registered; the Operations card shows the disabled hint.

## Targeted evidence research queue (2026-08-03)

Targeted research is a durable, admin-only demand lane for a proposal that
needs a fresh employer/evidence collection. It is deliberately separate from
proposal status and from approval truth.

### Enablement and safety

The server gate is off by default and is the authorization boundary:

```bash
INDUSTRY_EVIDENCE_TARGETED_QUEUE_ENABLED=true
INDUSTRY_EVIDENCE_RESEARCH_MAX_BATCH=20
```

The web-only companion flag (`VITE_ENABLE_INDUSTRY_EVIDENCE_TARGETED_QUEUE=true`)
controls whether the resume-search bulk affordance is visible; it cannot grant
access to the API. Keep both flags local during rollout. The queue is capped at
100 active requests per workspace and 1,000 queued rows globally; a batch is
bounded to 50 targets. Direct resume-detail demand has priority 100, while the
scheduled lane starts at 10 and receives bounded age-based priority uplift.

### Guided workflow

1. Open the canonical Industry Verification proposal route. The recovery panel
   distinguishes canonical identity, durable evidence, and the final human CNC
   claim.
2. Use **Research & verify employer** to create/coalesce one exact proposal
   request. Retry and cancel operate on that request only.
3. Review fetched sources and any identity candidate. A candidate is extracted
   only from permitted fetched proposal sources; search snippets, discovery URLs,
   and directory labels are never identity truth.
4. If needed, map the selected candidate to an existing registry row or create a
   provisional row. The identity mutation is audited and patches only the
   selected proposal/source IDs. It does not approve an industry verdict.
5. Complete the existing approval attestation only after approval-safe evidence,
   explicit CNC proof, and canonical mapping are all present.

The result-set control on `/dev/resumes` sends opaque resume IDs only. The API
resolves exact workspace/fingerprint proposal links, deduplicates targets, and
reports queued/already-queued/not-linked/not-eligible counts. Employer names and
company keys are never accepted as selectors.

### Operations and recovery

Coverage and Operations show active/queued/leased/identity-review/failed counts,
priority lanes, oldest direct-demand age, and alerts for high retry rate,
provider-limited backlog, or worker-unreachable runs. Worker HTTP failures and
timeouts release leases into bounded retry backoff; expired leases are recovered
by the queue mutation. A run with isolated target errors is marked `partial`,
not as an unqualified success. Schedule pause suppresses the background
producer; manual targeted demand remains available when the feature gate is on.

Never treat a queued/retried request as evidence, and never treat a candidate
identity as a confirmed company without an attended mapping decision. Discovery
is a lead, not proof; retrying research cannot approve or alter current verdict
revisions.

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

## Targeted recompute and company-resume links (2026-08-08)

Targeted recompute (`companies:startIndustryRecomputeRun` + BFF
`company-industry-recompute-service`) drives off `company_resume_links`: the BFF
lists affected resumes via `companies:listAffectedResumesByCompany`, reserves a
page, and dispatches `ingest_agent:scheduleExactReingest` batches. If a company
has zero links, the run finalizes with `processedCount` 0 — a silent no-op.

Links are derived from computed ingestData (`matchedWorkEntries[].companyKey`)
during every ingest update, so **newly approved companies historically had zero
links and every recompute no-oped**. Since 2026-08-08 a `verified` approval
(human lane and governed auto-approve lane alike, via the shared
`commitIndustryVerdictApproval` path) schedules
`companies:backfillCompanyResumeLinksByCompany`:

- The backfill scans resumes and matches raw work-history employer surfaces
  against the company's display names + registered aliases
  (`company_aliases`), case/punctuation-insensitive with longest-alias soft
  match (shared `buildCompanyAliasIndex` / `resolveCompanyAlias`).
- Links are idempotent (delete-then-insert per resume+company), bounded (≤10
  pages per invocation), and self-chain via the scheduler with a cursor until
  the corpus is done.
- A link only carries `currentVerdictRevisionId` when the resume was actually
  computed under that verdict (from its ingestData entries). Resumes never
  computed under the company stay revision-less, so the recompute classifies
  them as stale and processes them.
- **Backfill for already-verified companies:** the write-secret-gated ops
  mutation `companies:backfillCompanyResumeLinks` (registry-listed,
  maintenance-guarded) schedules the same backfill for an existing company —
  use it after importing a reviewed catalog or adding aliases.
- Rejected verdicts never schedule a backfill.

**Corpus drain fallback:** when the full-corpus scan
(`migrations:reIngestStaleSkillsVersion`) cannot run (local-backend overload),
use exact re-ingest for targeted cohorts
(`ingest_agent:scheduleExactReingest`, `MAX_EXACT_REINGEST_TARGETS=500`),
which dispatches `internal.ingest_agent.processNewResumes` per batch. The BFF
`trigger-reingest` route and the search-freshness doctor report this fallback
hint explicitly on action failure instead of a bare 500.

**Drain counters are honest:** `reIngestStaleResumes` reports `scannedRows`
(rows actually fetched) + `hasMore`; the doctor's `lag.scanned` is the real
scanned window and `scanComplete = !hasMore` — an incomplete window
understates the true stale population and is called out in doctor messages and
by `deploy/search-freshness-gate.sh`.

**Shared-corpus workspace routing (2026-08-14):** shared-corpus resumes
(collected via 51job/job5156/seek crawlers) carry no `workspaceSlug` — their
owning workspace lives in `resume_digest_statuses` (the workspace-scoped
candidate status overlay). The link writers (`upsertCompanyResumeLinkForCompany`
and `replaceCompanyResumeLinksForResume`) resolve owning workspace(s) from that
table when the resume doc has none, and write one link per owning workspace.
Without this, links for shared-corpus resumes always landed in the default
workspace (`dev`) and per-workspace recomputes no-oped for every other
workspace — observed on the CN lane: hr-workspace approvals showed
`affectedCount: 0` and `withVerifiedEvidence` never advanced.

**Sweep includes unmapped ready proposals (2026-08-14):** the maintenance sweep
researches `ready_for_review` proposals that have no `companyKey`, so
identity-candidate extraction runs against stored evidence on every sweep
(candidates are only built during research). Mapped ready proposals are
reviewable as-is and are skipped to avoid fetch churn every round.

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

For each Lane A auto-approval, the revision itself is the audit record: deterministic `auto-<fnv1a8>` revision ID, `reviewerType: "auto-verify-bot"`, source-derived fingerprint, and the approved source IDs. The ~10% risk-weighted sampling audit (`scripts/industry-data/sampling-audit.ts`) additionally re-reviews a deterministic sample and tracks the override rate in `output/industry-data/auto-verify-audit-<ts>.json`.
