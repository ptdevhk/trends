/**
 * Task 4 — build today's DailyReportPack from LIVE research pulse.
 *
 * Reads real rows from Convex `research_news:listRecent` (same query the BFF
 * pulse service uses), applies the real pulse keyword seed
 * (config/research_pulse_keywords.yaml + industry catalog) and the hotlist
 * platform set, then projects them into an M3 pack via the shared
 * `buildLivePack` (no invented metrics).
 *
 * Hybrid: if the live day is thin (< HYBRID_MIN_ITEMS), reuse the last good
 * snapshot with `source: 'frozen'` + a 沿用 banner instead of publishing an
 * empty report.
 *
 * Persistence: each day's pack + rendered HTML is upserted into Convex
 * `daily_reports:upsertReport`. A JSON snapshot is also kept under
 * config/daily-reports/snapshots/{date}.json for offline replay/re-seed.
 * No files are written to apps/web/public/daily/ (the BFF serves from DB).
 *
 * Env: CONVEX_URL + CONVEX_WRITE_SECRET (repo .env pattern). No prod writes.
 * Run:  npx tsx scripts/daily-report/build-live.ts [YYYY-MM-DD]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  buildLivePack,
  parseDailyReportPack,
  renderDailyReportHtml,
  resolveOriginalArticleUrls,
  isGoogleNewsArticleUrl,
  sparklineWindowSinceMs,
  sparklineDayDates,
  HYBRID_MIN_ITEMS,
  type DailyReportPack,
  type LiveNewsRow,
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

async function convexRequest(
  env: Env,
  endpoint: 'query' | 'mutation',
  path: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const url = convexUrl(env)
  const res = await fetch(`${url}/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args }),
  })
  if (!res.ok) throw new Error(`Convex ${path} → HTTP ${res.status}`)
  const payload = (await res.json()) as { status?: string; value?: unknown; errorMessage?: string }
  if (payload.status !== 'success') throw new Error(`Convex ${path} error: ${payload.errorMessage ?? 'unknown'}`)
  return payload.value
}

async function convexQuery(env: Env, path: string, args: Record<string, unknown>): Promise<unknown> {
  return convexRequest(env, 'query', path, args)
}

async function convexMutation(env: Env, path: string, args: Record<string, unknown>): Promise<unknown> {
  return convexRequest(env, 'mutation', path, args)
}

/** Real pulse keyword seed: YAML groups + industry catalog (mirrors the API seed loader). */
function loadKeywordSeed(): string[] {
  const yamlPath = join(ROOT, 'config/research_pulse_keywords.yaml')
  const doc = parseYaml(readFileSync(yamlPath, 'utf8')) as {
    groups?: Array<{ keywords?: string[] }>
    defaults?: { enabledGroupIds?: string[]; excludedKeywords?: string[] }
  }
  const groups = doc.groups ?? []
  const enabled = new Set(doc.defaults?.enabledGroupIds ?? groups.map((g) => ''))
  const excluded = new Set((doc.defaults?.excludedKeywords ?? []).map((k) => k.trim().normalize('NFKC')))
  const out = new Set<string>()
  for (const g of groups) {
    for (const k of g.keywords ?? []) {
      const t = k.trim()
      if (t && !excluded.has(t.normalize('NFKC'))) out.add(t)
    }
  }
  // Brand + company surfaces from the industry catalog (nameCn/nameEn/aliases).
  try {
    const brands = JSON.parse(readFileSync(join(ROOT, 'config/industry-data/brands.json'), 'utf8')) as unknown
    const walk = (v: unknown): void => {
      if (typeof v === 'string') {
        const t = v.trim()
        if (t && t.length <= 32 && !excluded.has(t.normalize('NFKC'))) out.add(t)
      } else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk)
    }
    walk(brands)
  } catch {
    // brands.json optional — YAML groups alone still give a real keyword set.
  }
  return [...out]
}

function loadHotlistPlatforms(): string[] {
  const p = join(ROOT, 'config/research_hotlist_platforms.yaml')
  const doc = parseYaml(readFileSync(p, 'utf8')) as {
    groups?: Array<{ platforms?: Array<{ id?: string }> }>
    defaults?: string[]
  }
  if (doc.defaults?.length) return doc.defaults
  const out: string[] = []
  for (const g of doc.groups ?? []) for (const pl of g.platforms ?? []) if (pl.id) out.push(pl.id)
  return out
}

function loadPreviousPack(date: string): DailyReportPack | null {
  if (!existsSync(SNAPSHOT_DIR)) return null
  const files = readdirSync(SNAPSHOT_DIR)
    .filter((f) => f.endsWith('.json') && f !== `${date}.json`)
    .sort()
    .reverse()
  for (const f of files) {
    try {
      return parseDailyReportPack(JSON.parse(readFileSync(join(SNAPSHOT_DIR, f), 'utf8')))
    } catch {
      // skip unreadable snapshot
    }
  }
  return null
}

function lastGoodSnapshot(date: string): DailyReportPack | null {
  if (!existsSync(SNAPSHOT_DIR)) return null
  // Only earlier calendar days — never clone a future/same-run newer day backward.
  const files = readdirSync(SNAPSHOT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((d) => d < date)
    .sort()
    .reverse()
  for (const d of files) {
    try {
      const pack = parseDailyReportPack(JSON.parse(readFileSync(join(SNAPSHOT_DIR, `${d}.json`), 'utf8')))
      if (pack.opportunities.length + pack.stories.length >= HYBRID_MIN_ITEMS) return pack
    } catch {
      // skip
    }
  }
  return null
}

async function writeOutputs(env: Env, pack: DailyReportPack, date: string): Promise<void> {
  mkdirSync(SNAPSHOT_DIR, { recursive: true })
  const html = renderDailyReportHtml(pack)
  writeFileSync(join(SNAPSHOT_DIR, `${date}.json`), `${JSON.stringify(pack, null, 2)}\n`, 'utf8')

  const upserted = (await convexMutation(env, 'daily_reports:upsertReport', {
    writeSecret: env.CONVEX_WRITE_SECRET,
    date,
    packJson: JSON.stringify(pack),
    html,
    source: pack.source ?? 'live',
    fallbackFromDate: pack.fallbackFromDate,
    builtAt: Date.now(),
  })) as { id: string; created: boolean } | undefined

  console.log(
    `wrote ${date}.json snapshot; convex ${upserted?.created ? 'created' : 'patched'} ${upserted?.id ?? '?'} (${html.length} bytes)`,
  )
}

async function main(): Promise<void> {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10)
  const env = loadEnv()
  const keywords = loadKeywordSeed()
  const hotlistPlatforms = loadHotlistPlatforms()

  const since = sparklineWindowSinceMs(date)
  console.log(`window: date=${date} since=${new Date(since).toISOString()} (Day1–Day7 Asia/Shanghai)`)

  const raw = (await convexQuery(env, 'research_news:listRecent', {
    writeSecret: env.CONVEX_WRITE_SECRET,
    limit: 500,
    since,
  })) as Array<Record<string, unknown>>
  const rawRows: LiveNewsRow[] = (Array.isArray(raw) ? raw : [])
    .map((r) => ({
      title: typeof r.title === 'string' ? r.title : '',
      platform: typeof r.platform === 'string' ? r.platform : '',
      ...(typeof r.url === 'string' ? { url: r.url } : {}),
      capturedAt: typeof r.capturedAt === 'number' ? r.capturedAt : 0,
      ...(typeof r.rawSnippet === 'string' ? { rawSnippet: r.rawSnippet } : {}),
      ...(typeof r.rank === 'number' ? { rank: r.rank } : {}),
    }))
    .filter((r) => r.title && r.platform)

  // Decode Google News wrappers → publisher originals before packing.
  const googleUrls = [
    ...new Set(rawRows.map((r) => r.url).filter((u): u is string => !!u && isGoogleNewsArticleUrl(u))),
  ]
  const resolved = googleUrls.length > 0 ? await resolveOriginalArticleUrls(googleUrls) : new Map()
  let googleDecoded = 0
  let googleDropped = 0
  const rows: LiveNewsRow[] = rawRows.map((r) => {
    if (!r.url || !isGoogleNewsArticleUrl(r.url)) return r
    const next = resolved.get(r.url)
    if (next) {
      googleDecoded += 1
      return { ...r, url: next }
    }
    googleDropped += 1
    const { url: _drop, ...rest } = r
    return rest
  })
  console.log(
    `article-url: google=${googleUrls.length} decoded=${googleDecoded} dropped=${googleDropped}`,
  )

  // Real hotlist rank totals per platform (for the rank→heat inversion).
  const hotlistRankTotals: Record<string, number> = {}
  for (const r of rows) {
    if (r.rank == null) continue
    hotlistRankTotals[r.platform] = Math.max(hotlistRankTotals[r.platform] ?? 0, r.rank)
  }

  // Write the full rolling window so Day1…Day7 nav links resolve (09-16…09-22).
  const windowDates = sparklineDayDates(date)
  console.log(`rolling-days: ${windowDates.join(' → ')}`)
  const generatedAt = new Date().toISOString()

  for (const day of windowDates) {
    const previous = loadPreviousPack(day)
    const result = buildLivePack(rows, {
      date: day,
      navAnchorDate: date,
      generatedAt,
      keywords,
      hotlistPlatforms,
      previous,
      hotlistRankTotals,
    })

    console.log(
      `live[${day}]: rows=${result.counts.rows} matched=${result.counts.matched} windowMatched=${result.counts.windowMatched} hotlist=${result.counts.hotlistMatched} items=${result.counts.items} thin=${result.thin}`,
    )

    if (result.thin) {
      const fallback = lastGoodSnapshot(day)
      if (fallback) {
        const frozen: DailyReportPack = {
          ...fallback,
          date: day,
          source: 'frozen',
          generatedAt,
          fallbackFromDate: fallback.date,
          banner: `沿用最近完整日（${fallback.date}）· ${day} 实时命中不足 ${HYBRID_MIN_ITEMS} 条`,
          hero: {
            ...fallback.hero,
            sparkline: result.pack.hero.sparkline,
            dayLabels: result.pack.hero.dayLabels,
            dayDates: result.pack.hero.dayDates,
          },
        }
        await writeOutputs(env, frozen, day)
        console.log(`hybrid[${day}]: reused ${fallback.date} as frozen snapshot`)
        continue
      }
      await writeOutputs(
        env,
        {
          ...result.pack,
          banner: `${day} 实时命中不足 ${HYBRID_MIN_ITEMS} 条 · 数据偏薄`,
        },
        day,
      )
      console.log(`hybrid[${day}]: no prior snapshot; published thin live pack with banner`)
      continue
    }

    await writeOutputs(env, result.pack, day)
  }

  // Second pass: thin earlier days in this window may have no prior snapshot
  // when the only rich day is "today" (single ingest). Fill from the newest
  // rich pack in the window so Day1…Day7 nav is usable for boss demos.
  const richInWindow = windowDates
    .map((d) => {
      try {
        return parseDailyReportPack(
          JSON.parse(readFileSync(join(SNAPSHOT_DIR, `${d}.json`), 'utf8')),
        )
      } catch {
        return null
      }
    })
    .filter((p): p is DailyReportPack => !!p && p.opportunities.length + p.stories.length >= HYBRID_MIN_ITEMS)
  const newestRich = richInWindow.length ? richInWindow[richInWindow.length - 1] : null
  if (newestRich) {
    for (const day of windowDates) {
      if (day >= newestRich.date) continue
      let existing: DailyReportPack | null = null
      try {
        existing = parseDailyReportPack(
          JSON.parse(readFileSync(join(SNAPSHOT_DIR, `${day}.json`), 'utf8')),
        )
      } catch {
        existing = null
      }
      if (existing && existing.opportunities.length + existing.stories.length >= HYBRID_MIN_ITEMS) {
        continue
      }
      const liveHero = existing?.hero
      const frozen: DailyReportPack = {
        ...newestRich,
        date: day,
        source: 'frozen',
        generatedAt,
        fallbackFromDate: newestRich.date,
        banner: `沿用最近完整日（${newestRich.date}）· ${day} 实时命中不足 ${HYBRID_MIN_ITEMS} 条`,
        hero: {
          ...newestRich.hero,
          ...(liveHero
            ? {
                sparkline: liveHero.sparkline,
                dayLabels: liveHero.dayLabels,
                dayDates: liveHero.dayDates,
              }
            : {}),
        },
      }
      await writeOutputs(env, frozen, day)
      console.log(`hybrid-pass2[${day}]: reused ${newestRich.date} as frozen snapshot`)
    }
  }

  console.log(`keywords=${keywords.length} hotlistPlatforms=${hotlistPlatforms.length}`)
}

main().catch((e) => {
  console.error('build-live failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
