# Release Note: Raw CDP Resume Snapshot Flow

Date: 2026-03-21 (updated 2026-04-13)
Area: Resume snapshot tooling (`scripts/resume`, `scripts/browser_cdp.py`, `apps/browser-extension`)

## What Changed

The resume snapshot workflow now runs through raw Chrome DevTools Protocol on port `9222` and no longer depends on the agent MCP browser tool.

- `job5156`, `seek`, and `51job` are collected directly from the browser extension accessor through CDP.
- `51job-manual` is parsed locally into the same portable resume backup payload shape.
- Snapshot generation no longer resets, imports into, or backs up from the live Convex resume tables.
- The helper writes restore-compatible portable backup files directly, and they remain restorable with `bin/trends resume restore`.

## Fixed Source Map

| Alias | Host | Method |
|-------|------|--------|
| `job5156` | `hr.job5156.com` | CDP browser collector |
| `seek` | `hk.employer.seek.com` | CDP browser collector |
| `51job` | `ehire.51job.com` | CDP browser collector (live) |
| `51job-manual` | `51job-manual` | Local archive import |

The helper normalizes collected payloads back to these fixed source hosts before writing the snapshot file.

## Prerequisites

- Chrome started with remote debugging, default `http://127.0.0.1:9222`
- Browser extension loaded on the target site
- Valid logged-in session on the source site
- Optional for restore only: Trends API reachable, default `http://localhost:3000`

The shared CDP helper can now create a Chrome page target when `9222` is reachable but no page tab is already open.

## Quick Start (Recommended)

Use the CLI wrapper — it delegates to the TS/Python layers underneath.

Snapshot all configured sources:

```bash
bin/trends --workspace dev resume snapshot --count 20
```

Snapshot one source:

```bash
bin/trends --workspace dev resume snapshot --source job5156 --count 20
bin/trends --workspace dev resume snapshot --source 51job --count 20
```

Import a local 51job archive (no browser needed):

```bash
bin/trends --workspace dev resume import-51job ~/Downloads/51job.rar --keyword "CNC 销售"
```

Check browser readiness before collecting:

```bash
uv run python scripts/resume/collect_browser_source.py --source 51job --check-only
```

## Restore

Snapshot generation writes plain JSON backup files under `output/resume-backups/<run-stamp>/`.
Those files can be restored later without having mutated the live resume tables during snapshot creation.
The CLI now accepts either a single backup file or a full snapshot run directory.

Restore a whole snapshot run directory:

```bash
bin/trends --workspace dev resume restore output/resume-backups/<run-stamp>
```

Restore a single snapshot file:

```bash
bin/trends --workspace dev resume restore \
  output/resume-backups/<run-stamp>/resume-backup-job5156-top20-<run-stamp>.json
```

Replace live data instead of upserting:

```bash
bin/trends --workspace dev resume restore --mode replace --yes \
  output/resume-backups/<run-stamp>
```

## Verification

Typical local verification flow after restore:

```bash
bin/trends --workspace dev resume search "CNC 销售" --source convex --limit 20
bin/trends --workspace dev resume match --query "CNC 销售" --source convex --mode rules_only
bin/trends --workspace dev resume debug ai-score --query "CNC 销售" --source convex --limit 20 --top-n 5
```

Manual 51job API verification before or after snapshot restore:

```bash
bin/trends --workspace dev resume import-51job \
  ~/Downloads/51job.rar \
  --keyword "CNC 销售" \
  --location "东莞"
```

The command surfaces per-entry `warnings` and `error` details from `/api/resumes/manual-import`, so it is the preferred live check when validating malformed archives or mixed-success uploads.

## Advanced Usage

Direct TS snapshot script (underlying implementation):

```bash
bun run scripts/resume/snapshot-source-backups.ts --source job5156 --count 20
bun run scripts/resume/snapshot-source-backups.ts --count 20
```

Use a custom CDP endpoint or manual archive path:

```bash
bun run scripts/resume/snapshot-source-backups.ts \
  --source 51job-manual \
  --count 20 \
  --manual-file ~/Downloads/51job.rar \
  --cdp-endpoint http://127.0.0.1:9222
```

Direct Python browser collector:

```bash
uv run python scripts/resume/collect_browser_source.py --source 51job --limit 20 --max-pages 10
```

Bypass 51job safe collection caps (append `tr_unsafe_limits=1` to the URL):

```bash
bun run scripts/resume/snapshot-source-backups.ts --source 51job --count 100 --unsafe-limits
```

## Defaults

- `job5156` URL:
  `https://hr.job5156.com/search?keyword=CNC+%E9%94%80%E5%94%AE&tr_min_age=25&tr_max_age=40`
- `seek` URL:
  `https://hk.employer.seek.com/candidates/recommended?jobId=90842915`
- `51job` URL:
  `https://ehire.51job.com/Revision/talent/search`
- `51job-manual` file:
  `~/Downloads/51job.rar`

## 51job Live Collection Notes

- The `51job` live source collects from `ehire.51job.com` through the extension's API capture and detail enrichment pipeline.
- Safe limits default to 50 resumes / 1 page; use `--unsafe-limits` to bypass.
- Detail enrichment uses sequential tab fallback (slower than job5156 direct fetch) because 51job requires a per-request HMAC `sign` computed by obfuscated frontend JS.
- Rate limit handling includes page cooldown (`8s`) and detail fetch delays (`5s` normal, `1s` unsafe).

## Operational Notes

- The snapshot job does not reset or import into the live resume tables.
- `trends resume snapshot` is the preferred operator entrypoint; the Bun script remains the underlying implementation.
- `trends resume import-51job <file...>` is the preferred live API check for the `51job-manual` upload lane; it accepts local `.rar`, `.zip`, `.docx`, and `.pdf` inputs and surfaces file-level warnings/failures.
- `trends resume restore <run-dir>` imports files in deterministic source order: `job5156`, `seek`, `51job`, `51job-manual`.
- `seek` may redirect to a non-talent-search page depending on the logged-in account; if that happens, the extension accessor will not be available and the helper will fail fast before writing a snapshot file.
- Generated files are date-stamped in `output/resume-backups/<run-stamp>/`.
