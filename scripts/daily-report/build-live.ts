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
  fetchThumbsForUrls,
  mergeNewsSources,
  parseNewsSourcesWorkspace,
  type DailyReportPack,
  type LiveNewsRow,
} from '@trends/shared'
import { loadResearchNewsSourcesSeed } from '@trends/shared/research-news-sources-seed'

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

/**
 * Merge the workspace pulse-keyword overlay (管理关键词) from Convex into the seed,
 * so the daily report uses the SAME effective keyword set as the hub 综合热榜.
 * Mirrors mergePulseKeywords(seed, workspace): seed ∪ custom ∪ enabled − excluded.
 * Overlay absent → seed unchanged (workspace defaults).
 */

async function mergeWorkspaceKeywords(env: Env, seed: string[]): Promise<string[]> {
  const workspaceSlug = (env.WORKSPACE_SLUG || 'hr').trim() || 'hr'
  let raw: unknown
  try {
    raw = await convexQuery(env, 'workspace_config:get', {
      workspaceSlug,
      configKey: 'research.pulseKeywords',
    })
  } catch {
    return seed
  }
  // worker req needs no writeSecret; but the convex query may. Pass if set.
  const row = raw as { configValue?: unknown } | undefined
  const ov = row?.configValue as
    | { custom?: unknown; enabled?: unknown; excluded?: unknown }
    | undefined
  if (!ov) return seed

  const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [])
  const custom = asList(ov.custom)
  const enabled = asList(ov.enabled)
  const excluded = asList(ov.excluded)

  const base: string[] = []
  const seenNorm = new Set<string>()
  const pushU = (kw: string) => {
    const t = kw.trim()
    if (!t) return
    const norm = t.normalize('NFKC').replace(/[A-Za-z]+/g, (m) => m.toLowerCase())
    if (seenNorm.has(norm)) return
    seenNorm.add(norm)
    base.push(t)
  }
  for (const k of seed) pushU(k)
  for (const k of custom) pushU(k)
  for (const k of enabled) pushU(k)
  const ex = new Set(excluded.map((k) => k.normalize('NFKC').replace(/[A-Za-z]+/g, (m) => m.toLowerCase())))
  const effective = base.filter((k) => !ex.has(k.normalize('NFKC').replace(/[A-Za-z]+/g, (m) => m.toLowerCase())))
  return effective.length > 0 ? effective : seed
}

function loadHotlistPlatforms(): { ids: string[]; defaults: string[]; catalog: Set<string> } {
  const p = join(ROOT, 'config/research_hotlist_platforms.yaml')
  const doc = parseYaml(readFileSync(p, 'utf8')) as {
    groups?: Array<{ platforms?: Array<{ id?: string }> }>
    defaults?: string[]
  }
  const catalog: string[] = []
  const seen = new Set<string>()
  for (const g of doc.groups ?? []) {
    for (const pl of g.platforms ?? []) {
      if (pl.id && !seen.has(pl.id)) {
        seen.add(pl.id)
        catalog.push(pl.id)
      }
    }
  }
  const defaults = (doc.defaults ?? []).filter((id) => seen.has(id))
  const orderedDefaults = catalog.filter((id) => defaults.includes(id))
  return { ids: catalog, defaults: orderedDefaults, catalog: seen }
}

/**
 * Effective hotlist platform set, mirroring the hub's mergeHotlistPlatforms
 * EXACTLY (catalog ∩ + defaults fallback): non-empty enabled → enabled ∩ catalog;
 * enabled empty → seed.defaults; drop excluded; empty-after-exclude → defaults.
 * Unlike the old build-live logic this intersects the FULL catalog, not just
 * defaults — so a desk-enabled id outside defaults isn't silently dropped.
 */
async function mergeWorkspaceHotlistPlatforms(env: Env, seed: { ids: string[]; defaults: string[]; catalog: Set<string> }): Promise<string[]> {
  const workspaceSlug = (env.WORKSPACE_SLUG || 'hr').trim() || 'hr'
  let raw: unknown
  try {
    raw = await convexQuery(env, 'workspace_config:get', {
      workspaceSlug,
      configKey: 'research.hotlistPlatforms',
    })
  } catch {
    return seed.defaults
  }
  const row = raw as { configValue?: unknown } | undefined
  const ov = row?.configValue as { enabled?: unknown; excluded?: unknown } | undefined
  if (!ov) return seed.defaults
  const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [])
  const enabled = asList(ov.enabled).map((x) => x.trim())
  const excluded = new Set(asList(ov.excluded).map((x) => x.trim()))
  const catalogSet = seed.catalog
  const baseIds = enabled.length > 0 ? enabled.filter((id) => catalogSet.has(id)) : [...seed.defaults]
  const baseSet = new Set(baseIds)
  const order = seed.ids.filter((id) => baseSet.has(id))
  const effective = order.filter((id) => !excluded.has(id))
  return effective.length > 0 ? effective : [...seed.defaults]
}

/**
 * Platform ids to exclude from the daily report (EN / non-CN-audience feeds
 * harvested by TrendRadar). Sales-first: keeps the report CN-only.
 */
function loadExcludedPlatforms(): string[] {
  return ['rss:hacker-news', 'rss:yahoo-finance', 'rss:gnews-fanuc-en']
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
  writeFileSync(join(SNAPSHOT_DIR, `${date}.json`), `${JSON.stringify(pack, null, 2)}\n`, 'utf8')

  // BFF always re-renders from packJson. Skip storing the full HTML blob —
  // SVG-wrapped real covers make pack+html exceed Convex's 1 MiB doc limit.
  const upserted = (await convexMutation(env, 'daily_reports:upsertReport', {
    writeSecret: env.CONVEX_WRITE_SECRET,
    date,
    packJson: JSON.stringify(pack),
    html: '',
    source: pack.source ?? 'live',
    fallbackFromDate: pack.fallbackFromDate,
    builtAt: Date.now(),
  })) as { id: string; created: boolean } | undefined

  console.log(
    `wrote ${date}.json snapshot; convex ${upserted?.created ? 'created' : 'patched'} ${upserted?.id ?? '?'} (packBytes=${JSON.stringify(pack).length})`,
  )
}

async function main(): Promise<void> {
  const date = process.argv[2] || new Date().toISOString().slice(0, 10)
  const env = loadEnv()
  const seedKeywords = loadKeywordSeed()
  const keywords = await mergeWorkspaceKeywords(env, seedKeywords)
  const seedHotlist = loadHotlistPlatforms()
  const hotlistPlatforms = await mergeWorkspaceHotlistPlatforms(env, seedHotlist)
  console.log(`keywords: seed=${seedKeywords.length} effective=${keywords.length}`)

  const since = sparklineWindowSinceMs(date)
  console.log(`window: date=${date} since=${new Date(since).toISOString()} (Day1–Day7 Asia/Shanghai)`)

  // Single flat listRecent caps at 200 DESC — with every row on one ingest day
  // that top-200 is dominated by hotlist noise and starves the CN gnews feeds
  // (which carry the actual CNC content). Fetch the CN feeds PER-PLATFORM and
  // merge, so the report corpus actually contains all the CNC rows.
  const flatRaw = (await convexQuery(env, 'research_news:listRecent', {
    writeSecret: env.CONVEX_WRITE_SECRET,
    limit: 200,
    since,
  })) as Array<Record<string, unknown>>

  // Effective feed-set from the workspace news-sources opt-out overlay (default ON).
  // Catalog feed ids not in `effective` are skipped (non-catalog ids untouched).
  const newsSourcesSeed = loadResearchNewsSourcesSeed(ROOT)
  let newsWorkspace
  try {
    const row = (await convexQuery(env, 'workspace_config:get', {
      workspaceSlug: (env.WORKSPACE_SLUG || 'hr').trim() || 'hr',
      configKey: 'research.enabledNewsSources',
    })) as { configValue?: unknown } | undefined
    newsWorkspace = parseNewsSourcesWorkspace(row?.configValue)
  } catch {
    newsWorkspace = parseNewsSourcesWorkspace(undefined)
  }
  const effectiveNewsFeeds = new Set(mergeNewsSources(newsSourcesSeed, newsWorkspace))
  const newsCatalog = new Set(newsSourcesSeed.catalogIds)
  const isNewsFeedActive = (plat: string): boolean => {
    const id = plat.replace(/^rss:/, '')
    return !newsCatalog.has(id) || effectiveNewsFeeds.has(id)
  }
  console.log(`news-sources: seed=${newsCatalog.size} effective=${effectiveNewsFeeds.size} master=${newsWorkspace.masterEnabled ?? true}`)

  // Enabled CN gnews feeds (CN-audience CNC content) — fetch each explicitly.
  const cnFeedRows: Array<Record<string, unknown>> = []
  for (const plat of [
    'rss:gnews-cnc-machine',
    'rss:gnews-cnc-hiring',
    'rss:gnews-mazak-cn',
    'rss:gnews-fanuc-cn',
    'rss:gnews-makino-cn',
    'rss:gnews-robot-cnc',
    'rss:gnews-baoli',
    'rss:gnews-polywell',
    'rss:gnews-genesis',
    'rss:gnews-qiaofeng',
    'rss:gnews-diecast',
    // 2026-09-23 CNC topic expansion — broadens the 7d window to >=10/day.
    'rss:gnews-cnc-core-process',
    'rss:gnews-cnc-turning',
    'rss:gnews-cnc-systems',
    'rss:gnews-cnc-market',
    'rss:gnews-cnc-laser',
    'rss:gnews-cnc-wirecut',
    'rss:gnews-cnc-brand-more',
    'rss:gnews-cnc-mould',
    'rss:gnews-cnc-automation',
    'rss:gnews-cnc-gantry',
    'rss:gnews-cnc-machines-export',
    'rss:gnews-gongyemuji',
    'rss:gnews-shukongxitong',
    'rss:gnews-shukongzhuantai',
    'rss:gnews-daoku',
    'rss:gnews-zhuzhou-jichuang',
    'rss:gnews-sigang',
    'rss:gnews-daogui-jichuang',
    'rss:gnews-sifudianji',
    'rss:gnews-jiansuji',
    'rss:gnews-dianhuohua',
    'rss:gnews-xianqiege',
    'rss:gnews-manzousi',
    'rss:gnews-jiguang-qiege',
    'rss:gnews-jiguang-hanjie',
    'rss:gnews-chexifuhe',
    'rss:gnews-zuangong',
    'rss:gnews-zouxinji',
    'rss:gnews-wuzhou-liandong',
    'rss:gnews-longmenxi',
    'rss:gnews-rouxingzhzao',
    'rss:gnews-jichuang-chukou',
    'rss:gnews-jichuang-caigou',
    'rss:gnews-jichuang-zhongbiao',
    'rss:gnews-muju-qiche',
    'rss:gnews-chongya',
    'rss:gnews-duanya',
    'rss:gnews-yazhuji',
    'rss:gnews-zhusuji',
    'rss:gnews-guochantidai',
    'rss:gnews-shukong-chukou',
    'rss:gnews-haitianjinggong',
    'rss:gnews-chuangshiji',
    'rss:gnews-kede',
    'rss:gnews-guosheng',
    'rss:gnews-niupi',
    'rss:gnews-huaizhong',
    'rss:gnews-guangzhou',
    'rss:gnews-shenyang',
    'rss:gnews-qinchuan',
    'rss:gnews-rifa',
    'rss:gnews-jinan',
    'rss:gnews-xinghuo',
    'rss:gnews-baoji',
    'rss:gnews-dianzhuzhou',
    'rss:gnews-shukong-daoju',
    'rss:gnews-jiansuqi-jichuang',
    'rss:bing-cnc-machine',
    'rss:bing-gongyemuji',
    'rss:bing-haitian',
    'rss:bing-chexifuhe',
    'rss:bing-shukong-chechuang',
    'rss:bing-shukong-xichuang',
    'rss:bing-chechuang',
    'rss:bing-wuzhou',
    'rss:bing-zhusuji',
    'rss:bing-muju',
    'rss:bing-chongya',
    'rss:bing-jiansuji',
    'rss:bing-jiguang-qiege',
    'rss:bing-sigang',
    'rss:bing-jichuang-caigou',
    'rss:bing-jichuang-chukou',
    'rss:bing-guochantidai',
    // 2026-09-25: enable 3 config-defined-but-orphaned CNC feeds (电火花/线切割
    // Bing + 发那科-招聘 gnews) so their rows reach the daily-report corpus.
    'rss:bing-dianhuohua',
    'rss:bing-xianqiege',
    'rss:gnews-fanuc-hire',
  ]) {
    if (!isNewsFeedActive(plat)) {
      // opted-out catalog feed: skip fetching (respect shared effective set)
      continue
    }
    try {
      const rows = (await convexQuery(env, 'research_news:listRecent', {
        writeSecret: env.CONVEX_WRITE_SECRET,
        limit: 200,
        since,
        platform: plat,
      })) as Array<Record<string, unknown>>
      if (Array.isArray(rows)) cnFeedRows.push(...rows)
    } catch {
      // soft-fail per feed
    }
  }

  // Merge flat + per-platform gnews rows, dedupe by contentHash (prefer gnews).
  const seen = new Set<string>()
  const merged: Array<Record<string, unknown>> = []
  const pushRow = (r: Record<string, unknown>) => {
    const key: string =
      r.contentHash != null ? String(r.contentHash) : `${String(r.platform)}|${String(r.title)}`
    if (seen.has(key)) return
    seen.add(key)
    merged.push(r)
  }
  for (const plat of [
    'rss:gnews-cnc-machine',
    'rss:gnews-cnc-hiring',
    'rss:gnews-mazak-cn',
    'rss:gnews-fanuc-cn',
    'rss:gnews-makino-cn',
    'rss:gnews-robot-cnc',
    'rss:gnews-baoli',
    'rss:gnews-polywell',
    'rss:gnews-genesis',
    'rss:gnews-qiaofeng',
    'rss:gnews-diecast',
    'rss:gnews-cnc-core-process',
    'rss:gnews-cnc-turning',
    'rss:gnews-cnc-systems',
    'rss:gnews-cnc-market',
    'rss:gnews-cnc-laser',
    'rss:gnews-cnc-wirecut',
    'rss:gnews-cnc-brand-more',
    'rss:gnews-cnc-mould',
    'rss:gnews-cnc-automation',
    'rss:gnews-cnc-gantry',
    'rss:gnews-cnc-machines-export',
    'rss:gnews-gongyemuji',
    'rss:gnews-shukongxitong',
    'rss:gnews-shukongzhuantai',
    'rss:gnews-daoku',
    'rss:gnews-zhuzhou-jichuang',
    'rss:gnews-sigang',
    'rss:gnews-daogui-jichuang',
    'rss:gnews-sifudianji',
    'rss:gnews-jiansuji',
    'rss:gnews-dianhuohua',
    'rss:gnews-xianqiege',
    'rss:gnews-manzousi',
    'rss:gnews-jiguang-qiege',
    'rss:gnews-jiguang-hanjie',
    'rss:gnews-chexifuhe',
    'rss:gnews-zuangong',
    'rss:gnews-zouxinji',
    'rss:gnews-wuzhou-liandong',
    'rss:gnews-longmenxi',
    'rss:gnews-rouxingzhzao',
    'rss:gnews-jichuang-chukou',
    'rss:gnews-jichuang-caigou',
    'rss:gnews-jichuang-zhongbiao',
    'rss:gnews-muju-qiche',
    'rss:gnews-chongya',
    'rss:gnews-duanya',
    'rss:gnews-yazhuji',
    'rss:gnews-zhusuji',
    'rss:gnews-guochantidai',
    'rss:gnews-shukong-chukou',
    'rss:gnews-haitianjinggong',
    'rss:gnews-chuangshiji',
    'rss:gnews-kede',
    'rss:gnews-guosheng',
    'rss:gnews-niupi',
    'rss:gnews-huaizhong',
    'rss:gnews-guangzhou',
    'rss:gnews-shenyang',
    'rss:gnews-qinchuan',
    'rss:gnews-rifa',
    'rss:gnews-jinan',
    'rss:gnews-xinghuo',
    'rss:gnews-baoji',
    'rss:gnews-dianzhuzhou',
    'rss:gnews-shukong-daoju',
    'rss:gnews-jiansuqi-jichuang',
    'rss:bing-cnc-machine',
    'rss:bing-gongyemuji',
    'rss:bing-haitian',
    'rss:bing-chexifuhe',
    'rss:bing-shukong-chechuang',
    'rss:bing-shukong-xichuang',
    'rss:bing-chechuang',
    'rss:bing-wuzhou',
    'rss:bing-zhusuji',
    'rss:bing-muju',
    'rss:bing-chongya',
    'rss:bing-jiansuji',
    'rss:bing-jiguang-qiege',
    'rss:bing-sigang',
    'rss:bing-jichuang-caigou',
    'rss:bing-jichuang-chukou',
    'rss:bing-guochantidai',
    'rss:bing-dianhuohua',
    'rss:bing-xianqiege',
    'rss:gnews-fanuc-hire',
  ]) {
    for (const r of cnFeedRows.filter((x) => x.platform === plat)) pushRow(r)
  }
  for (const r of (Array.isArray(flatRaw) ? flatRaw : [])) {
    const p = typeof r.platform === 'string' ? r.platform : ''
    if (!p || p.startsWith('rss:gnews')) continue
    // also drop opted-out catalog feeds that sneak in via the flat list
    if (p.startsWith('rss:') && !isNewsFeedActive(p)) continue
    pushRow(r)
  }
  const raw = merged
  console.log(`corpus: flat=${(Array.isArray(flatRaw) ? flatRaw : []).length} cn-feeds=${cnFeedRows.length} merged=${raw.length}`)

  const rawRows: LiveNewsRow[] = raw
    .map((r) => ({
      title: typeof r.title === 'string' ? r.title : '',
      platform: typeof r.platform === 'string' ? r.platform : '',
      ...(typeof r.url === 'string' ? { url: r.url } : {}),
      capturedAt: typeof r.capturedAt === 'number' ? r.capturedAt : 0,
      // Real article publish time (RSS <pubDate> -> ms). The report buckets
      // Day1..Day7 by this so a 7-day window spreads news by actual publish day
      // instead of collapsing onto the single ingest capturedAt day.
      ...(typeof r.publishedAt === 'number' ? { publishedAt: r.publishedAt } : {}),
      ...(typeof r.rawSnippet === 'string' ? { rawSnippet: r.rawSnippet } : {}),
      ...(typeof r.rank === 'number' ? { rank: r.rank } : {}),
    }))
    .filter((r) => r.title && r.platform)

  // Decode Google News wrappers → publisher originals before packing.
  const googleUrls = [
    ...new Set(rawRows.map((r) => r.url).filter((u): u is string => !!u && isGoogleNewsArticleUrl(u))),
  ]
  // Parallelized + time-bounded decode (never stalls a day-roll on Google
  // decode work that returns null en masse from a region-blocked egress).
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

  // CN-audience, sales-first: the TrendRadar harvest pulls EN feeds (news
  // sources outside the CN sales desk's audience). Exclude them before packing
  // so cards/rows/stories all reflect the Chinese CNC desk.
  const excludePlatforms = loadExcludedPlatforms()

  // Surfaced-item thumbnail resolution. Store publisher cover URLs only —
  // Convex docs are 1 MiB; the BFF wraps remotes into real-photo SVG data-URIs
  // when serving /daily/{date}.html (iframe + 下载完整 HTML).
  async function patchSurfacedThumbs(pack: DailyReportPack): Promise<void> {
    const surfacedHrefs = [
      ...(pack.opportunities.map((o) => o.href).filter((h): h is string => !!h)),
      ...(pack.stories.map((s) => s.href).filter((h): h is string => !!h)),
    ]
    const unique = [...new Set(surfacedHrefs)].filter((u) => isGoogleNewsArticleUrl(u) === false)
    if (unique.length === 0) return
    const thumbByUrl = await fetchThumbsForUrls(unique, 24, 4)
    for (const opp of pack.opportunities) {
      if (opp.href && thumbByUrl.has(opp.href)) opp.imageUrl = thumbByUrl.get(opp.href)
    }
    for (const st of pack.stories) {
      if (st.href && thumbByUrl.has(st.href)) st.imageUrl = thumbByUrl.get(st.href)
    }
    console.log(`thumbs[remote]: resolved=${thumbByUrl.size}/${unique.length}`)
  }

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
      excludePlatforms,
    })

    // Patch real thumbnails onto the freshly-built pack before persisting — fetched
    // from the surfaced hrefs so every rendered card/story gets a real-thumb chance.
    await patchSurfacedThumbs(result.pack)

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
