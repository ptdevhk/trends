# Preview Convex restart runbook (CLI-wedged backend)

Incident class: the preview Convex Docker container (`trends-preview-convex`)
reports `Up` but the actual backend binary (`convex-local-backend`) is not
running, so every Convex call fails. Client symptom is an error-boundary page:
`Your request timed out performing too many system operations` on any Convex
query (e.g. `resumes_diagnostics:listIngestDiagnostics`), or BFF 500s with
`fetch failed` / ECONNREFUSED against `127.0.0.1:4210`. This is NOT a
query-budget problem — do not change application queries for it.

## Verify (run on ptcloud)

```bash
# Container health is NOT sufficient — the compose healthcheck probes POST
# /api/query on 3210 (host 4210) and can go unhealthy for 100+ consecutive
# checks while the container itself never restarts (restart: unless-stopped).
docker ps --filter name=trends-preview-convex --format '{{.Status}}'

# Direct host probe — listener must answer:
curl -s -m 8 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4210/instance_name   # expect 200
curl -s -m 8 -o /dev/null -w '%{http_code}\n' https://preview.pt-mes.com/convex/version  # expect 200

# The CLI is alive but no backend process:
docker top trends-preview-convex        # look for convex-local-backend (missing = wedged)
ps -ef | grep convex-local-backend      # only the prod :3210 one may exist
```

Wedged signature: the process tree ends at `node .../convex dev` +
esbuild — there is NO `convex-local-backend --port 3210` child, and nothing
listens on 3210 inside the container.

## Fix

```bash
docker restart trends-preview-convex
```

Then wait for the backend boot (~30-60 s on the 2.8 GB SQLite; the CLI logs
`Convex functions ready!` only after the backend answers `/instance_name`).
Verify with the probes above. The container's own healthcheck turns `healthy`
once POST `/api/query` answers.

## Automation

`deploy/preview-convex-restart.sh` (added in the 2026-08-27 degradation fix)
probes POST `/api/query` on host 4210 and restarts after N consecutive
failures:

```bash
# one-shot status
bash deploy/preview-convex-restart.sh
# watch + auto-restart (no systemd unit installed by default)
bash deploy/preview-convex-restart.sh --watch --recover
```

It refuses to touch prod `:3210` (hard guard in the script). If the failure
recurs with no restart watcher running, consider running the watch under a
durable supervisor (nohup/systemd) — as of 2026-09-04 no timer/unit was
installed on ptcloud, so the container relied on `restart: unless-stopped`
only (which does NOT restart a running-but-wedged container).

## History

- 2026-08-27/28: first documented degradation (ECONNRESET storm, listener
  gone); fix #1362 added the POST-probe healthcheck + restart script.
- 2026-09-04: recurrence — container `Up (unhealthy)` ~8 h, FailingStreak
  116, backend process absent, port 3210 refused. `docker restart` recovered
  in ~40 s; `listIngestDiagnostics` (100-row page, 333 KB) served again,
  BFF fetch-fail 500s stopped. Root cause of the wedge (why `convex dev`
  silently stops launching the binary after a long run) is upstream in the
  Convex CLI; no local code change was made.
