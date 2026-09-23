# Windows Local Dev Runbook

Tested on Windows 11 (host `MSI`, user `karlchow`), 2026-09-23.
This runbook covers the Windows-specific path; for the normal macOS/Linux flow, see
`scripts/dev.sh` and the agent runbook.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.x (`.nvmrc`) | matches CI |
| Git for Windows | any | provides `bash.exe` at `C:\Program Files\Git\bin\bash.exe` |
| bun | 1.3.x | used for workspace scripts; `bun.lock` may need npm fallback (see below) |
| uv | 0.12.x | optional, for the FastAPI worker |

## First-time setup

### 1. Install dependencies with npm (not bun)

```powershell
cd D:\GitHub\trends
npm install
```

**Why not bun?** The committed `bun.lock` uses a format that bun 1.3.x cannot read.
Running `bun install` ignores the lockfile, resolves fresh dependencies, and rewrites
`bun.lock` in a different format — which then pollutes `git status` on every Windows
machine. Use `npm install` (which reads `package-lock.json`) instead.

**Do not commit `bun.lock` modifications on Windows.**

### 2. Rebuild native modules

```powershell
npm rebuild better-sqlite3
npm install bindings   # better-sqlite3 transitive dep that npm hoisting misses
```

### 3. Create junction links for hoisted workspace binaries

npm hoists workspace packages to the root `node_modules`, but each workspace
expects its own local `node_modules/.bin` shim. Create Windows directory junctions:

```powershell
$root = "D:\GitHub\trends"

New-Item -ItemType Junction -Path "$root\packages\convex\node_modules\convex" `
  -Target "$root\node_modules\convex"
New-Item -ItemType Junction -Path "$root\apps\api\node_modules\tsx" `
  -Target "$root\node_modules\tsx"
New-Item -ItemType Junction -Path "$root\apps\web\node_modules\vite" `
  -Target "$root\node_modules\vite"
New-Item -ItemType Junction -Path "$root\packages\shared\node_modules\typescript" `
  -Target "$root\node_modules\typescript"
```

These junctions are machine-local and never need to be committed.

### 4. Build shared package

```powershell
bun run --filter "@trends/shared" build
```

The Convex backend imports from `@trends/shared/dist`. If the dist is stale
(missing exports like `normalizeAiApiBase`), rebuild it.

## Starting the dev server

`scripts/dev.sh` is a bash orchestrator that exits and kills its child processes
on Windows. Instead, start each service independently in a separate terminal:

### Terminal 1 — Convex (port 3210)

```powershell
cd D:\GitHub\trends\packages\convex
node node_modules/convex/bin/main.js dev --local
```

### Terminal 2 — BFF API (port 3000)

Load `.env` first so `CONVEX_WRITE_SECRET` and `AI_API_*` are available:

```powershell
cd D:\GitHub\trends
Get-Content .env | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}
cd apps\api
node node_modules/tsx/dist/cli.mjs watch --clear-screen=false src/index.ts
```

**Important:** if the BFF is started without `.env` loaded, Convex reads return
`401 Unauthorized` and AI analysis fails with `Unauthorized Convex read`.

### Terminal 3 — Web Vite (port 5173)

```powershell
cd D:\GitHub\trends\apps\web
node node_modules/vite/bin/vite.js
```

### Verify

| Service | URL | Check |
|---|---|---|
| Web | http://127.0.0.1:5173 | page loads |
| BFF | http://127.0.0.1:3000/api/resumes | 401 without login (expected) |
| Convex | http://127.0.0.1:3210/api/query | responds to POST |

## Authentication

The local Convex database has no users by default. Bootstrap the demo admin:

```powershell
cd D:\GitHub\trends
$env:AUTH_BOOTSTRAP_PASSWORD = "admin123"   # or whatever is in .env
bun run auth:bootstrap-demo
```

Then log in at http://127.0.0.1:5173/login with:
- Username: `demo-admin`
- Password: `admin123` (from `.env` `AUTH_BOOTSTRAP_PASSWORD`)

## Seeding resume data

```powershell
cd D:\GitHub\trends
bunx tsx scripts/seed-convex.ts --force --with-resumes
```

This writes resumes into the `resumes` table. But the search UI queries
`resume_digests` (built by the ingest pipeline), not `resumes` directly.
After seeding, backfill digests:

```powershell
$body = '{"path":"resumes_search:backfillResumeDigests","args":{"limit":200}}'
Invoke-RestMethod -Uri "http://127.0.0.1:3210/api/mutation" `
  -Method POST -Body $body -ContentType "application/json"
```

If more than 200 resumes exist, repeat with the returned `cursor` until
`hasMore: false`. After this, searching for e.g. `CNC` returns results.

## AI analysis verification

1. Go to http://127.0.0.1:5173/dev/resumes?q=CNC
2. Click **分析已加载的 N 份**
3. Poll `/api/resumes/analysis-tasks` until `status: completed`
4. Resume cards show AI summaries and scores

If AI analysis returns `Unauthorized Convex read`, restart the BFF with `.env`
loaded (see above).

## Known Windows-specific issues

| Issue | Workaround |
|---|---|
| `bun install` rewrites `bun.lock` | Use `npm install` instead |
| `better-sqlite3` ABI mismatch | `npm rebuild better-sqlite3` manually |
| Missing workspace bins (convex/tsx/vite) | Junction to root `node_modules` |
| `dev.sh` exits and kills children | Start services independently in background |
| BFF → Convex 401 | Load `.env` before starting BFF |
| Search returns 0 after seed | Call `backfillResumeDigests` mutation |

## Cleanup notes

- Junction links are machine-local; never commit them.
- `bun.lock` modifications on Windows should be discarded before any commit.
- Convex local data lives in `packages/convex/.convex/` and persists across restarts.
