/**
 * Re-seed Convex daily_reports from local snapshots (remote cover URLs only).
 *
 * Real-photo → SVG wrapping happens on the BFF HTML path
 * (`GET /daily/{date}.html` via embedPackRemoteCovers). Do NOT embed into
 * packJson — SVG wraps blow the Convex 1 MiB document limit.
 *
 * Run:  npx tsx scripts/daily-report/embed-covers.ts [YYYY-MM-DD|all]
 * (name kept for continuity; this now only re-upserts remotes from snapshots)
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseDailyReportPack,
  type DailyReportPack,
} from '@trends/shared'

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

async function seedOne(env: Env, date: string): Promise<void> {
  const file = join(SNAPSHOT_DIR, `${date}.json`)
  if (!existsSync(file)) {
    console.log(`skip ${date}: no snapshot`)
    return
  }
  const pack = parseDailyReportPack(JSON.parse(readFileSync(file, 'utf8'))) as DailyReportPack
  const items = [...(pack.opportunities ?? []), ...(pack.stories ?? [])]
  const remotes = items.filter(
    (it) => typeof it.imageUrl === 'string' && /^https?:\/\//i.test(it.imageUrl),
  ).length
  const plates = items.filter(
    (it) => typeof it.imageUrl === 'string' && /^data:image\/svg\+xml/i.test(it.imageUrl),
  ).length
  // Empty html — BFF re-renders + embeds on serve.
  const html = ''
  const upserted = (await convexMutation(env, 'daily_reports:upsertReport', {
    writeSecret: env.CONVEX_WRITE_SECRET,
    date,
    packJson: JSON.stringify(pack),
    html,
    source: pack.source ?? 'live',
    fallbackFromDate: pack.fallbackFromDate,
    builtAt: Date.now(),
  })) as { id: string; created: boolean } | undefined
  const packBytes = JSON.stringify(pack).length
  console.log(
    `${date}: remotes=${remotes} plates=${plates} packBytes=${packBytes} convex=${upserted?.created ? 'created' : 'patched'} ${upserted?.id ?? '?'}`,
  )
}

async function main(): Promise<void> {
  const env = loadEnv()
  const arg = process.argv[2] || 'all'
  const dates =
    arg === 'all'
      ? readdirSync(SNAPSHOT_DIR)
          .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
          .map((f) => f.replace(/\.json$/, ''))
          .sort()
      : [arg]
  for (const date of dates) {
    await seedOne(env, date)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
