# Handoff: Preview sync stale-import defect fix + recommendations + preview-site UAT

**To:** New session (fix + recommend + UAT)
**From:** Grok session (preview deploy test 0.4.23 closeout)
**Date:** 2026-08-18
**Repo:** `/root/workspace` (trends)
**Branch:** `preview-v0.4.23` (local, NO-PUSH; ahead of origin — do not push without explicit approval)
**HEAD at handoff:** `2ec40bce` — `docs: record preview deploy test 0.4.23 closeout in reference index`
**Status:** Deploy test **complete & verified**; **defect open** (stale-import cleanup); preview site **ready for UAT**

**Requested action:** Implement the sync-script defect fix (stale-import cleanup + timeout) and the recorded recommendations, then run UAT on the preview site and report. Do **not** touch prod. Do **not** push anything to GitHub without explicit user approval.

---

## Mission (one sentence)

Fix the preview prod→preview sync scripts so a wedged Convex import can never silently block every later sync, apply the four recorded recommendations, then run a full UAT pass on the preview site (https://preview.pt-mes.com) and close out with evidence.

---

## TL;DR diagnosis (read this first)

| Symptom | Meaning | Class |
|---|---|---|
| Convex import "Import canceled" for A1–A4, A5 OK | CLI client killed by `timeout 900` mid-import → backend cancels. **Not** an executor wedge (disproven) | **Defect: fix** |
| A5 completed 49,516 rows on same zip + same backend | Import itself works; timeout is the only killer | Root cause |
| No stale-import cleanup in sync scripts | A wedged `in_progress` import silently blocks every later sync (new upload parks; CLI waits out its whole timeout) | **Defect: fix** |
| `system_settings/` dropped by sync → table recreated EMPTY | Preview settings revert to defaults after every sync | **Decision needed** |
| `CHECK_MIN_SCORE=80` parity FAIL | `summary.total` ignores `minScore` (flat totals at 80/90/95 both sides) — same version-drift signal, not a scoring regression | **Recommendation** |
| Search totals differ prod vs preview (CN 313→639) | 0.4.23 query expansion ("CNC" → 17 terms, mode=AND) — **feature, not data divergence** | Expected |
| sqlite `candidate_actions` 406=406 | Prod/preview parity holds | ✅ Verified |
| Doctor `--full` 0 failures; endpoints 200/200/401/401 | Preview healthy after sync | ✅ Verified |

---

## Defect + fix recommendations (implement this)

### D1 — Stale-import cleanup (P0, the defect)

`deploy/preview-sync-from-prod.sh` / `deploy/restore-preview-from-prod.sh` have **no stale-import cleanup**. If a previous sync left an import in `in_progress` (e.g. the CLI was killed), every later sync silently fails: the new upload parks behind the wedged import and the CLI waits out its whole `timeout` before reporting.

**Candidate fix (chose one or both):**
1. **Pre-upload abort:** before `npx convex import`, query import state (backend SQLite `documents` table, table_id `X'9A977BA13592DE3CB25B9458012D507A'`, append-only journal) for `in_progress` imports and abort them via:
   - `POST /api/cancel_import` (NOT `/api/import/cancel_import` — wrong path returns 404/405)
   - Headers: `Authorization: Convex <adminKey>` (adminKey from `.convex/local/default/config.json` in the container)
   - Body: `{"importId": "<id>"}` → 200 on success
2. **Fail fast:** if a stale `in_progress` import exists, exit the sync with a clear message naming the importId instead of parking.

**Hard constraint:** the `documents` journal table is **append-only** — never `DELETE` middle rows (a middle-row delete broke backend startup on 2026-08-18; restored from a sqlite copy). Only use the cancel API, never direct deletes.

### D2 — `timeout 900` too tight (P1)

`deploy/restore-preview-from-prod.sh:254`:
```
timeout 900 npx convex import --replace-all /app/prod-convex-export.zip --yes
```
The 2026-08-18 import (27 MB, ~10.9k rows) exceeded 900 s → CLI killed → "Import canceled" A1–A4. An ephemeral `timeout 3600` patch was applied, verified (A5 completed 49,516 rows), then **reverted** — line 254 is back to `timeout 900`.

**Recommendation:** raise the timeout to ≥ 3600 (or make it configurable) AND/OR add graceful-cancel on timeout instead of a hard kill (see D1 route — the backend does cancel the import when the client dies; a hard kill is what leaves the wedged state).

### R3 — `system_settings/` drop behavior (decision, P2)

`deploy/restore-preview-from-prod.sh` (lines 67–71) drops `system_settings/` from the export before import → `--replace-all` leaves the table EMPTY → schema push recreates it empty → **preview settings revert to defaults on every sync** (verified: preview settings are at defaults now).

Options: (a) preserve prod settings rows into the preview export (copy rows), (b) document this as expected preview behavior + add a post-sync settings smoke, or (c) a preview-only settings overlay. Needs a decision, not just silence.

### R4 — `CHECK_MIN_SCORE=80` parity bucket (P3)

`preview-parity-check.sh` emits WARN/FAIL on search totals because `summary.total` **ignores `minScore`** (flat at 80/90/95 on both sides) and totals now reflect 0.4.23 query expansion. Recommend gating the minScore bucket on `api_version` match (skip when versions differ) so parity output only warns on real drift.

---

## UAT on preview site (do this)

- **URL:** https://preview.pt-mes.com (Caddy → API :3002, systemd `trends-preview-api`)
- **Login:** `hr-demo` / `AUTH_HR_DEMO_PASSWORD` — read from `/home/ubuntu/trends-preview/.env.preview` on `ptcloud` (ssh alias; do not paste secrets into files that get committed)
- **Workspace:** `hr` (send `X-Workspace-Slug: hr` on API calls; login helper `deploy/lib-preview-auth-session.sh`: `preview_auth_login`, `preview_auth_curl` with CSRF)
- **Data:** full prod copy (backup `prod-complete-20260818T181956Z`), so all review queues/HR lists carry real prod data.

**Checklist:**
1. **Settings state** — preview `system_settings` is empty → verify UI shows defaults (e.g. `resumeWorkHistoryLimit`, search gates). This is **expected** under current sync behavior (R3); record it, don't "fix" it mid-UAT.
2. **Search** — totals will differ from prod: 0.4.23 query expansion (CNC → 17-term `expandedTo`, mode=AND; 销售 → 4-term). `summary.total` ignores `minScore`. Expected drift, not data loss.
3. **Review queue** — industry verification + HR review flows with real prod data (see 2026-08-14 UAT for the CJK-company-key 500 history — fixed, do not regress: ASCII-safe keys + route-side filter).
4. **candidate_actions parity** — sqlite 406 rows = prod 406 rows (already verified 1:1 at sync; re-verify if touching sync).
5. **Extension** — extension v1.3.6 (local, not pushed) against preview; talentsearch detail + HR expand (v0.4.21 lineage).
6. **Health** — `make doctor-search-freshness` equivalents + doctor `--full` on preview backend = 0 failures (was 0 at closeout).
7. **Endpoints** — `/` 200, `/convex/version` 200, `/api/blocks` 401, `/api/resumes` 401 (was verified; re-run after any sync change).

**UAT infrastructure (host, ptcloud):** preview API systemd `trends-preview-api`; Convex container `trends-preview-convex` (bind `/home/ubuntu/trends-preview` → `/app`; volume → `/app/packages/convex/.convex`; container 3210/3211 → host 4210/4211). Host paths unresolvable from inside container → use `docker exec`/`docker cp`. Container has node but **no curl/ps/sqlite3**.

---

## Live state snapshot (2026-08-18 closeout)

```json
{
  "prod":  { "dir": "/opt/trends", "version": "0.4.16", "commit": "30b9015a", "creds": "/etc/trends/env" },
  "preview": {
    "dir": "/home/ubuntu/trends-preview", "version": "0.4.23", "commit": "6486bcf9",
    "mirrorRepo": "/home/ubuntu/trends", "mirrorHead": "6486bcf9", "mirrorTree": "clean",
    "tag": "v0.4.23 at preview head (local + mirror; GitHub 33d0e13c untouched — future pile PR must force-update)",
    "creds": "/home/ubuntu/trends-preview/.env.preview", "workspace": "hr",
    "api": { "port": 3002, "systemd": "trends-preview-api" },
    "convex": { "container": "trends-preview-convex", "ports": "3210/3211 (container) -> 4210/4211 (host)",
      "backend": "precompiled-2026-08-10-c0cb7ae/convex-local-backend", "cli": "convex 1.39.1",
      "adminAuth": "anonymous-convex|0102678f46e666fe0f97cd7ae5411431185b892e8c672d8d8ab75a6471a88f6e03df21227f" }
  },
  "sync": { "canonical": "sudo ASSUME_YES=1 bash /home/ubuntu/trends/deploy/preview-sync-from-prod.sh --data-only",
    "result": "6/6 legs green; PARITY OK (TOTAL_TOLERANCE=0); WARNs = version drift only",
    "backup": "prod-complete-20260818T181956Z" },
  "parityNumbers": { "candidate_actions": "406=406", "a5_rows": 49516, "resume_analyses": 9512,
    "search_total_cn": "313 (prod) vs 639 (preview) — query expansion", "search_total_my": "427 vs 60 — same drift",
    "api_version": "0.4.16 vs 0.4.23" },
  "verification": { "doctor_full": "0 failures", "endpoints": "/ 200, /convex/version 200, /api/blocks 401, /api/resumes 401",
    "cdp_parity_smoke": "identical UI + identical 403 both sides (expected: headerless fetch lacks CSRF + X-Workspace-Slug)" }
}
```

### Known caveats / product truth (do not "fix" by changing governance)

- **NO-PUSH rule:** workspace commits stay local. GitHub tag `33d0e13c` ≠ local `v0.4.23` — future pile PR must force-update the tag.
- **Prod is never modified** by any preview sync — verified by design and by backup MANIFEST.
- Preview settings at defaults (system_settings empty) is current **sync behavior**, not a fresh bug.
- Search total differences vs prod are the **0.4.23 query-expansion feature**, not data divergence.
- `summary.total` ignoring `minScore` is product behavior on both sides — parity bucket must account for it (R4), not change the API.
- Import journal `documents` table (table_id `X'9A977BA13592DE3CB25B9458012D507A'`) is **append-only**; middle-row deletes break backend startup.
- Human-only / deferred vault items (industry-data R1+R2+R4, company-policy follow-ups, workspace portability P2–P4, prod-unpin auth readiness) — **never auto-claim**.

### Verification substitution notes (this session had no browser MCP)

Prior session verified without browser tools. Substitutes that worked:
- **CDP parity smoke:** repo `scripts/preview-prod-parity-smoke.mjs` patched to CDP port 39382 (`/tmp/parity-smoke-39382.mjs`, ran as `scripts/.tmp-parity-smoke-39382.mjs` then deleted — module resolution needs repo node_modules). Requires `AUTH_HR_DEMO_PASSWORD` env. Note `fetchVersion` returns "unknown" (script artifact: `/health` serves SPA shell, not JSON — versions are proven by parity `api_version` + backup MANIFEST instead).
- **SQLite probes:** write `.sql` locally, pipe: `ssh ptcloud 'sqlite3 -readonly /tmp/sqlprobe/db.sqlite3' < /tmp/probe.sql` (single quotes; double quotes rejected).
- **In-container node:** `cat /tmp/x.cjs | ssh ptcloud 'sudo docker exec -i trends-preview-convex sh -c "cat > /app/tmp-x.cjs && node /app/tmp-x.cjs"'`; use `require("/app/node_modules/convex/dist/cjs/browser/http_client.js")` + `ConvexHttpClient("http://localhost:3210", { adminAuth })`; BigInt needs a JSON replacer.
- **Settle/retry:** e2e-style passes need Vite-proxy-tolerant recovery; the extension auto-scrape can hijack the driven tab; `sales` empty state after bulk actions is expected (new-only status filter).
- **No browser MCP is still true for this session** — if the new session has browser tools, use them for the UAT checklist; otherwise keep the substitutions and say what was not verified.

---

## Quick reference

| Thing | Command / location |
|---|---|
| Canonical sync | `sudo ASSUME_YES=1 bash /home/ubuntu/trends/deploy/preview-sync-from-prod.sh --data-only` |
| Import timeout | `deploy/restore-preview-from-prod.sh:254` (`timeout 900 npx convex import --replace-all …`) |
| Cancel-import API | `POST /api/cancel_import` + `Authorization: Convex <adminKey>` + `{"importId": …}` |
| system_settings drop | `deploy/restore-preview-from-prod.sh` lines 67–71 |
| Parity check | `TOTAL_TOLERANCE=0 bash deploy/preview-parity-check.sh` |
| Preview login helper | `deploy/lib-preview-auth-session.sh` (`preview_auth_login`, `preview_auth_curl`) |
| Handoff convention | `docs/superpowers/handoffs/2026-07-31-industry-verification-coverage-research-pipeline-handoff.md` |
| Deploy-test work item | `~/wiki/projects/trends/work/2026-08-18-preview-deploy-test/` (plan.md + log.md, completed) |
| Vault presync | `bash /root/.grok/installed-plugins/vault-sync-ae1287d3/skills/vault-presync/wiki-sync.sh --execute` |

**Suggested first steps for the new session:** (1) reproduce the wedged-import scenario or inspect current import state via the journal table, (2) implement D1 (pre-upload `/api/cancel_import` or fail-fast) + D2 (timeout), (3) run the canonical sync once to prove a clean pass, (4) execute the UAT checklist, (5) commit locally (NO-PUSH), (6) report with evidence, ask before any push.
