# Preview MY CNC additive seed-driver runbook

Owner-gated data op. Adds the MY CNC company catalog (24 companies from the
phase-1 seed plan) to the preview Convex backend using the additive driver.
**Preview only — never prod.** Watch the wedge class (see `preview-convex-restart.md`).

## Artifacts

- Plan: `deploy/seed-data/my-cnc-company-catalog-seed-plan.json` (24 MY companies)
- Driver: `deploy/seed-data/my-cnc-seed-company-industry.mjs` — byte-identical to
  the committed file in local commit `5e437a03` (sha256 `58ce39124ead…`), not yet pushed.
- The driver requires two env vars, never prints the secret:
  - `CONVEX_URL` — preview Convex backend URL
  - `CONVEX_WRITE_SECRET` — backend write secret

## Prerequisites

1. Driver + plan are on the LXC at `/root/workspace/deploy/seed-data/`
   (both present, verified 2026-09-07; driver sha matches 5e437a03).
2. `convex/browser` client loads inside `trends-preview-convex`
   (`require("convex/browser")` returns `ConvexClient`) — verified.
3. The two env vars are NOT in the container env (only `TRENDS_DEPLOYMENT_ROLE`)
   and NOT in `/app/.env.local`. They must come from the preview deployment env
   on the ptcloud host (`.env.preview`) or be supplied explicitly by the owner.

## Run (authorized)

```bash
# on ptcloud host, with the preview backend env loaded (values redacted):
HOST_PREVIEW_ENV=/home/ubuntu/trends-preview/.env.preview
# 1) scp driver+plan onto the host
scp -q deploy/seed-data/my-cnc-company-catalog-seed-plan.json pvelxc-3adc3628:/tmp/ 2>/dev/null
# 2) into the convex container
docker cp /tmp/my-cnc-company-catalog-seed-plan.json trends-preview-convex:/app/
docker cp /tmp/my-cnc-seed-company-industry.mjs   trends-preview-convex:/app/
# 3) exec with env (source the deploy env so CONVEX_URL/WRITE_SECRET are present)
docker exec -e CONVEX_URL="$CONVEX_URL" -e CONVEX_WRITE_SECRET="$CONVEX_WRITE_SECRET" \
  trends-preview-convex node /app/my-cnc-seed-company-industry.mjs /app/my-cnc-company-catalog-seed-plan.json
# expect: SEED_OK with counts (idempotent; re-running no-ops)
```

## Verify

- Expect `SEED_OK companies=24 …` (or `SEED_FATAL` with reason).
- `GET /api/resumes?q=…` shows the newly reviewed MY company keys resolving from
  aliases; company-industry review surface for MY is populated.
- Re-run is a no-op (additive, idempotent).

## Guardrails

- **Preview only.** If `CONVEX_URL` points anywhere except preview, abort.
- Wedge watch: if `trends-preview-convex` shows unhealthy/wedged after the run,
  stop and report — do not `docker restart` without owner authorization
  (see `preview-convex-restart.md`).
- Never print the write secret. Never run against prod.
- After the run, prune the copied files from the container if desired.
