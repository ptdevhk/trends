# Release Note: Raw CDP Resume Snapshot Flow

Date: 2026-03-21
Area: Resume snapshot tooling (`scripts/resume`, `scripts/browser_cdp.py`, `apps/browser-extension`)

## What Changed

The resume snapshot workflow now runs through raw Chrome DevTools Protocol on port `9222` and no longer depends on the agent MCP browser tool.

- `job5156` and `seek` are collected directly from the browser extension accessor through CDP.
- `51job-manual` is parsed locally into the same portable resume backup payload shape.
- Snapshot generation no longer resets, imports into, or backs up from the live Convex resume tables.
- The helper writes restore-compatible portable backup files directly, and they remain restorable with `bin/trends resume restore`.

## Fixed Source Map

- `job5156` -> `hr.job5156.com`
- `seek` -> `hk.employer.seek.com`
- `51job-manual` -> `51job-manual`

The helper normalizes collected payloads back to these fixed source hosts before writing the snapshot file.

## Prerequisites

- Chrome started with remote debugging, default `http://127.0.0.1:9222`
- Browser extension loaded on the target site
- Valid logged-in session on the source site
- Optional for restore only: Trends API reachable, default `http://localhost:3000`

The shared CDP helper can now create a Chrome page target when `9222` is reachable but no page tab is already open.

## Usage

Preferred CLI wrapper for one source:

```bash
bin/trends --workspace dev --api-url http://localhost:3000 resume snapshot \
  --source job5156 \
  --count 20
```

Preferred CLI wrapper for all configured sources:

```bash
bin/trends --workspace dev --api-url http://localhost:3000 resume snapshot \
  --count 20
```

Direct API-side validation of the manual 51job import lane:

```bash
bin/trends --workspace dev --api-url http://localhost:3000 resume import-51job \
  ~/Downloads/51job.rar \
  --keyword "CNC 销售"
```

Snapshot one source:

```bash
bun run scripts/resume/snapshot-source-backups.ts --source job5156 --count 20
```

Snapshot all three configured sources:

```bash
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

Direct browser collector check:

```bash
uv run python scripts/resume/collect_browser_source.py --source job5156 --check-only
```

Direct browser collection:

```bash
uv run python scripts/resume/collect_browser_source.py --source job5156 --limit 20 --max-pages 10
```

## Restore

Snapshot generation writes plain JSON backup files under `output/resume-backups/<run-stamp>/`.
Those files can be restored later without having mutated the live resume tables during snapshot creation.
The CLI now accepts either a single backup file or a full snapshot run directory.

Restore a whole snapshot run directory with the Trends CLI:

```bash
bin/trends --workspace dev --api-url http://localhost:3000 resume restore \
  output/resume-backups/<run-stamp>
```

Restore any generated snapshot file with the Trends CLI:

```bash
bin/trends --workspace dev --api-url http://localhost:3000 resume restore \
  output/resume-backups/<run-stamp>/resume-backup-job5156-top20-<run-stamp>.json
```

Replace live data instead of upserting:

```bash
bin/trends --workspace dev --api-url http://localhost:3000 resume restore \
  --mode replace \
  --yes \
  output/resume-backups/<run-stamp>
```

Typical local verification flow after restore:

```bash
bin/trends --workspace dev --api-url http://localhost:3000 resume search "CNC 销售" --source convex --limit 20
bin/trends --workspace dev --api-url http://localhost:3000 resume match --query "CNC 销售" --source convex --mode rules_only
bin/trends --workspace dev --api-url http://localhost:3000 resume debug ai-score --query "CNC 销售" --source convex --limit 20 --top-n 5
```

Manual 51job API verification before or after snapshot restore:

```bash
bin/trends --workspace dev --api-url http://localhost:3000 resume import-51job \
  ~/Downloads/51job.rar \
  --keyword "CNC 销售" \
  --location "东莞"
```

The command surfaces per-entry `warnings` and `error` details from `/api/resumes/manual-import`, so it is the preferred live check when validating malformed archives or mixed-success uploads.

## Defaults

- `job5156` URL:
  `https://hr.job5156.com/search?keyword=CNC+%E9%94%80%E5%94%AE&tr_min_age=25&tr_max_age=40`
- `seek` URL:
  `https://hk.employer.seek.com/candidates/recommended?jobId=90842915`
- `51job-manual` file:
  `~/Downloads/51job.rar`

## Operational Notes

- The snapshot job does not reset or import into the live resume tables.
- `trends resume snapshot` is the preferred operator entrypoint; the Bun script remains the underlying implementation.
- `trends resume import-51job <file...>` is the preferred live API check for the `51job-manual` upload lane; it accepts local `.rar`, `.zip`, `.docx`, and `.pdf` inputs and surfaces file-level warnings/failures.
- `trends resume restore <run-dir>` imports files in deterministic source order: `job5156`, `seek`, `51job-manual`.
- `seek` may redirect to a non-talent-search page depending on the logged-in account; if that happens, the extension accessor will not be available and the helper will fail fast before writing a snapshot file.
- Generated files are date-stamped in `output/resume-backups/<run-stamp>/`.
