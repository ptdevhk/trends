---
name: refresh-sample-snapshots
description: >
  Refresh, push, pull, and restore resume sample snapshots across 3 CDP sources
  (51job, job5156, seek). Seek supports both recommended and talentsearch collection modes.
  Use when the user mentions sample
  snapshots, sample repo, refresh/push/pull/restore samples, dev-samples, or wants to update
  the ptdevhk/trends-resume-samples repository.
validation:
  descriptionTerms: [sample, snapshot, resume, refresh, push, pull, restore, dev-samples]
---

# Refresh Sample Snapshots

Manage the resume sample snapshot lifecycle: collect fresh data from browser sources via CDP, push to the shared GitHub sample repo, and pull/restore into a local dev environment.

## Prerequisites

- Chrome running with remote debugging on port 9222 (`make chrome-debug` or `./apps/browser-extension/scripts/cmux-setup-profile.sh`)
- Browser extension loaded and active in Chrome
- Logged into each target source in Chrome (see per-source reference files for details)
- For pull/restore: local dev stack running (`make dev` or at minimum API + Convex)

## Source Coverage

| Source alias | Market | Collection mechanism | Reference |
|---|---|---|---|
| `51job` | CN | Keyword search on `ehire.51job.com` | [references/51job.md](references/51job.md) |
| `job5156` | MY/CN | Keyword + location on `hr.job5156.com` | [references/job5156.md](references/job5156.md) |
| `seek` (recommended) | HK | jobId-based on `hk.employer.seek.com` | [references/seek.md](references/seek.md) |
| `seek` (talent search) | MY | Keyword-based on `hk.employer.seek.com/talentsearch` with `market=MY` | [references/seek.md](references/seek.md) |

## Workflow Quick Reference

| Workflow | Trigger phrases | What it does |
|---|---|---|
| **Collect** | "collect 51job samples", "snapshot seek", "refresh job5156 samples" | CDP scrape from one or more sources into `output/resume-backups/` |
| **Push** | "push sample snapshots", "push samples to GitHub" | Upload latest snapshot dir to `ptdevhk/trends-resume-samples` |
| **Pull+Restore** | "pull sample snapshots", "restore samples" | Clone sample repo → restore into local Convex |
| **Full refresh** | "full sample refresh", "refresh all samples" | Collect all sources → push to GitHub (multi-step) |

---

## Collect Workflow

Collect fresh resume samples from browser sources via CDP.

**Primary script:** `scripts/resume/snapshot-source-backups.ts` (calls `scripts/resume/collect_browser_source.py` under the hood).

### Single source

```bash
bun run scripts/resume/snapshot-source-backups.ts --source 51job --count 20
```

### Multiple sources in one run

```bash
bun run scripts/resume/snapshot-source-backups.ts \
  --source 51job --source job5156 --source seek --count 20
```

### Custom URL override

Override the default search URL for a source:

```bash
# Seek talent search (MY market) — uses keyword-based collection
bun run scripts/resume/snapshot-source-backups.ts \
  --source seek --count 20 \
  --seek-url "https://hk.employer.seek.com/talentsearch?searchQuery=CNC+Sales&market=MY&pageNumber=1&roleTitles=Sales&salaryType=MONTHLY&minSalary=0&salaryUnspecified=true&keywords=CNC&matchAll=false&sortBy=RELEVANCE"

# Custom 51job keyword/location
bun run scripts/resume/snapshot-source-backups.ts \
  --source 51job --count 20 \
  --51job-url "https://ehire.51job.com/Revision/talent/search?keyword=工程师&tr_min_age=25&tr_max_age=40"
```

### Key options

| Option | Default | Description |
|---|---|---|
| `--source <alias>` | (required) | Source alias: `51job`, `job5156`, `seek` (repeatable) |
| `--count <n>` | `20` | Resumes to collect per source |
| `--max-pages <n>` | `10` | Max pages to paginate through |
| `--cdp-endpoint <url>` | `http://127.0.0.1:9222` | Chrome DevTools endpoint |
| `--<source>-url <url>` | Per-source default | Override the search URL for a source |
| `--out-dir <path>` | `output/resume-backups` | Output directory for timestamped snapshots |

### Output

Creates a timestamped directory:
```
output/resume-backups/20260602-190034/
├── resume-backup-51job-top20-20260602-190034.json
├── resume-backup-job5156-top20-20260602-190034.json
└── resume-backup-seek-top20-20260602-190034.json
```

### Known issues

- **51job login redirect:** If not fully logged in, the collector raises "51job redirected to a login page". Log in inside Chrome, reopen the talent search page, then rerun.
- **Seek account selection:** If redirected to `/account/select`, complete account selection in Chrome first.
- **Extension `collect()` missing:** If the extension accessor doesn't expose `collect()`, reload the browser extension.
- For detailed per-source prerequisites and troubleshooting, read the reference file for that source.

---

## Push Workflow

Push the latest snapshot directory to the GitHub sample repo.

**Command:** `make push-sample-snapshots`

### What it does

1. Finds the latest `output/resume-backups/YYYYMMDD-HHMMSS/` directory containing `.json` files
2. Clones `ptdevhk/trends-resume-samples`, replaces snapshot files, regenerates README
3. Commits and pushes to `main`

### Auth

The push script auto-detects `gh auth token` and uses authenticated HTTPS clone. Works for both public and private repos. Ensure `gh` is logged in:

```bash
gh auth status
```

### Note

The script pushes **all** `.json` files in the latest snapshot directory. To push only a specific source, create a directory containing only that source's file, or use `SNAPSHOT_DIR` to point at a specific directory:

```bash
SNAPSHOT_DIR=output/resume-backups/20260602-190034 make push-sample-snapshots
```

---

## Pull+Restore Workflow

Pull sample snapshots from GitHub and restore them into the local Convex backend.

### One command

```bash
make restore-sample-snapshots
```

### Step by step

```bash
# Step 1: Pull from GitHub to output/resume-samples/
make pull-sample-snapshots

# Step 2: Restore to local Convex with derived field recomputation
make restore-resumes FILE=output/resume-samples RECOMPUTE_DERIVED_FIELDS=1
```

### Prerequisites

- Local dev stack running (at minimum API + Convex backend)
- Same `gh` auth considerations as push workflow

### After restore

- Resumes are available in the local Convex dashboard and search UI
- Run `make seed` if you also need job descriptions seeded alongside the samples

---

## Full Refresh Workflow

End-to-end pipeline: collect all sources (both seek modes) → push to GitHub.

Each `snapshot-source-backups.ts` invocation creates a new timestamped directory. `push-sample-snapshots` pushes only the **latest** directory. To push all source variants together, merge the files into one directory first.

### Step 1: Collect primary sources

```bash
bun run scripts/resume/snapshot-source-backups.ts \
  --source 51job --source job5156 --source seek --count 20
```

This creates `output/resume-backups/<timestamp-1>/` with 51job, job5156, and seek-recommended snapshots.

### Step 2: Collect seek talent search variant

```bash
bun run scripts/resume/snapshot-source-backups.ts \
  --source seek --count 20 \
  --seek-url "https://hk.employer.seek.com/talentsearch?searchQuery=CNC+Sales&market=MY&pageNumber=1&roleTitles=Sales&salaryType=MONTHLY&minSalary=0&salaryUnspecified=true&keywords=CNC&matchAll=false&sortBy=RELEVANCE"
```

This creates `output/resume-backups/<timestamp-2>/` with the seek-talentsearch snapshot. Note that this file is also named `resume-backup-seek-top20-<timestamp>.json` (same alias), so it must be renamed before merging to avoid overwriting the seek-recommended file.

### Step 3: Merge and push

```bash
# Merge talentsearch file into the first directory with a distinct name
cp output/resume-backups/<timestamp-2>/resume-backup-seek-top20-*.json \
   output/resume-backups/<timestamp-1>/resume-backup-seek-talentsearch-top20.json

# Push the merged directory
SNAPSHOT_DIR=output/resume-backups/<timestamp-1> make push-sample-snapshots
```

### Verification

Check that all 4 files are present before pushing:

```bash
ls output/resume-backups/<timestamp-1>/
# Expected:
#   resume-backup-51job-top20-<ts>.json
#   resume-backup-job5156-top20-<ts>.json
#   resume-backup-seek-top20-<ts>.json          (recommended)
#   resume-backup-seek-talentsearch-top20.json  (talent search)
```
