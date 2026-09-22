/**
 * Replay all config/daily-reports/snapshots/*.json into Convex `daily_reports`.
 *
 * Use after restoring a preview/prod snapshot, or to backfill DB from disk.
 * Idempotent: upserts by date; logs created/patched for each snapshot.
 *
 * Env: CONVEX_URL + CONVEX_WRITE_SECRET (repo .env pattern).
 * Run:  npx tsx scripts/daily-report/seed-convex-daily-reports.ts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseDailyReportPack, renderDailyReportHtml } from '@trends/shared'

const ROOT = process.cwd()
const SNAPSHOT_DIR = join(ROOT, 'config/daily-reports/snapshots')

type Env = Record<string, string>
function loadEnv(): Env {
  const env: Env = { ...process.env } as Env
  for (const file of ['.env', '.env.local']) {
    const p = join(ROOT, file)
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return env
}

function convexUrl(env: Env): string {
  const url = (env.CONVEX_URL || '').replace(/\/$/, '')
  if (!url) throw new Error('CONVEX_URL missing')
  return url
}

async function convexMutation(env: Env, path: string, args: Record<string, unknown>): Promise<unknown> {
  const url = convexUrl(env)
  const res = await fetch(`${url}/api/mutation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args }),
  })
  if (!res.ok) throw new Error(`Convex ${path} → HTTP ${res.status}`)
  const payload = (await res.json()) as { status?: string; value?: unknown; errorMessage?: string }
  if (payload.status !== 'success') throw new Error(`Convex ${path} error: ${payload.errorMessage ?? 'unknown'}`)
  return payload.value
}

async function main(): Promise<void> {
  const env = loadEnv()
  if (!existsSync(SNAPSHOT_DIR)) {
    console.log('no snapshots dir; nothing to seed')
    return
  }

  const files = readdirSync(SNAPSHOT_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()

  console.log(`seeding ${files.length} snapshot(s) from ${SNAPSHOT_DIR}`)

  for (const file of files) {
    const date = file.replace(/\.json$/, '')
    const raw = JSON.parse(readFileSync(join(SNAPSHOT_DIR, file), 'utf8'))
    const pack = parseDailyReportPack(raw)
    const html = renderDailyReportHtml(pack)

    const upserted = (await convexMutation(env, 'daily_reports:upsertReport', {
      writeSecret: env.CONVEX_WRITE_SECRET,
      date,
      packJson: JSON.stringify(pack),
      html,
      source: pack.source ?? 'live',
      fallbackFromDate: pack.fallbackFromDate,
      builtAt: Date.now(),
    })) as { id: string; created: boolean } | undefined

    console.log(`${date}: ${upserted?.created ? 'created' : 'patched'} ${upserted?.id ?? '?'}`)
  }

  console.log('seed complete')
}

main().catch((e) => {
  console.error('seed-convex-daily-reports failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
