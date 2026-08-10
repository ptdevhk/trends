# Backup / Restore / Preview Parity Architecture

**Status:** active design (2026-07-16)  
**Priority:** first-class product capability — not a side script.

## Problem statement

Operators expected “clone production into preview” to reproduce HR search UI:

- Total results for a baseline query  
- Status facets (新候选人 / 已入围 / 已拒绝 / …)  
- AI score buckets (选择 80+ 分)

Observed failures were **architectural**, not one-off flukes.

## State model (what “production” actually is)

```mermaid
flowchart TB
  subgraph prod [Production trends.pt-mes.com]
    PC[Convex :3210<br/>resumes digests analyses<br/>candidate_status blocks …]
    PS[SQLite resume_screening.db<br/>candidate_actions]
    PE[/etc/trends/env]
    PA[trends-api :3000]
  end
  subgraph prev [Preview preview.pt-mes.com]
    VC[Docker Convex :4210]
    VS[SQLite under trends-preview/output]
    VE[.env.preview]
    VA[trends-preview-api :3002]
  end
  subgraph dev [Local dev this host]
    DC[Local Convex :3210]
    DS[SQLite under output/]
    DA[trends-api :3000]
  end
  PA --> PC
  PA --> PS
  VA --> VC
  VA --> VS
  DA --> DC
  DA --> DS
  VC --> DC
  VS --> DS
```

Local dev (this host) is refreshed from preview by `deploy/dev-sync-from-preview.sh`
— same Convex export/import + SQLite swap mechanics as preview, with a hard
source-aware parity gate (corpus, candidate_actions, verified-employer count,
baseline query totals) and preview-matching auth roles (hr-demo = admin).

| Surface | Holds | Needed for UI parity? |
|---------|--------|------------------------|
| Convex `resumes` + `resume_digests` | Corpus + search hot path | **Yes** (totals) |
| Convex `resume_analyses` | AI scores | **Yes** (80+ bucket) |
| Convex `candidate_status` | HR status overlays (workspace-scoped) | **Yes** (status facets when logged in) |
| SQLite `candidate_actions` | Local action trail | **Yes** (some paths / backup) |
| App code tree | Features / scoring rules | Pin only when testing same build |
| `.env.preview` | Domain, Convex URL, secrets | **Never** overwrite with prod |

Anonymous `/api/resumes` **does not** expose full HR status facets (`canReadOperationalOverlays`). Logged-in `/hr/resumes` does.

## Root causes (ordered)

1. **Split workflow, incomplete by default**  
   `preview-clone-from-prod` only copies **code**. Data required a second script that was often skipped. Result: stale Convex + empty SQLite (`candidate_actions=0`).

2. **Restore pipeline abort after successful import**  
   Admin login failure / AI smoke failure exited non-zero **after** Convex import, so full-state never reached SQLite swap.

3. **Digest backfill destroyed search parity**  
   Unconditional `backfillResumeDigests` after import recomputed digests. Search totals drifted (e.g. 248 → 242) even with identical resume documents.

4. **Post-import Convex instability**  
   Large `--replace-all` leaves the backend memory-heavy / flaky until force-recreate; API then 500s (`fetch failed` / socket closed).

5. **Dual status stores**  
   Facets use Convex `candidate_status` (workspace-aware). SQLite alone is insufficient.

## Design principles

1. **Backup before any write** (prod complete backup is a hard gate).  
2. **One orchestrator** for “preview = prod data”: `deploy/preview-sync-from-prod.sh`.  
3. **Data fidelity over recompute** — default `DIGEST_BACKFILL_MODE=skip`.  
4. **Never fail data path on auth/AI smoke** — soft checks unless `RESTORE_STRICT=1`.  
5. **Parity gate** — `deploy/preview-parity-check.sh` must pass (search total + SQLite counts).  
6. **Preview isolation** — domains, Telegram, Convex port after every sync.  
7. **Production is read-only** for this flow except export + temporary quiesce.

## Canonical operator flow

```bash
# On ptcloud — preferred single command
sudo ASSUME_YES=1 bash /home/ubuntu/trends/deploy/preview-sync-from-prod.sh

# Optional: also pin app code to prod SHA first
sudo ASSUME_YES=1 bash /home/ubuntu/trends/deploy/preview-sync-from-prod.sh --with-code-pin

# Parity only
bash deploy/preview-parity-check.sh
CHECK_MIN_SCORE=80 bash deploy/preview-parity-check.sh
```

### Phases inside orchestrator

| # | Phase | Script |
|---|--------|--------|
| 0 | Preflight | `preview-preflight.sh` |
| 1 | Prod complete backup | `backup-prod-complete.sh` |
| 2 | Optional code pin | `preview-clone-from-prod.sh` |
| 3 | Convex export/import + SQLite | `restore-preview-full-state-from-prod.sh` |
| 4 | Isolate integrations | `preview-isolate-integrations.sh --apply` |
| 5 | Stabilize Convex/API | force-recreate + restart |
| 6 | Parity check | `preview-parity-check.sh` |

## Selected historical backup rehearsal

The live-production clone path above intentionally remains optimized for
current-state parity. A separate attended controller,
`deploy/preview-rehearse-backup.sh`, handles immutable historical
`prod-complete-*` snapshots:

```text
strict manifest/artifact verification
→ protect current preview
→ install exact manifest source and stored data
→ verify same-version baseline
→ attended approval
→ install exact target
→ shared canonical Convex migrations
→ snapshot-aware verification
→ clean-browser evidence
→ finish or explicit rollback
```

Historical restore never runs a new production Convex export. It materializes
source and target trees with `git archive` without moving the controller
checkout. Preview is the only mutation target; production identity and current
parity are recorded as informational evidence. Explicit rollback restores the
protected application and data, reinstalls that version's dependencies, and
reapplies preview integration isolation instead of lifting it.

## Digest policy (critical)

| Mode | When |
|------|------|
| `skip` (**default**) | Export includes digests — keep them for search parity |
| `if-empty` | Old exports without digests |
| `always` | Explicit recompute (accept search drift) |

## Verification contract

Minimum automated checks after sync:

1. `candidate_actions` count prod == preview  
2. Baseline query `summary.total` prod == preview (`TOTAL_TOLERANCE` default 0)  
3. Optional: `minScore=80` bucket  
4. Preview Convex `/version` 200; `/api/blocks` 200  
5. Manual: logged-in HR page status facets for same query

## Non-goals

- Promoting preview → prod (separate, higher-risk path)  
- Using `make deploy` / `install.sh upgrade` on preview to pull prod **data**  
- Copying raw `convex_local_backend.sqlite3` between instances  

## Sources Used

- Local repository: `deploy/restore-*.sh`, `apps/api/src/routes/resumes_search.ts`, live ptcloud restore runs (2026-07-16)  
- Vault: `queries/2026-05-29-convex-local-backend-memory-oom.md` (import memory / retention)  
