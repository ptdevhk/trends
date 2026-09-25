import { describe, expect, it } from 'vitest'
import {
  buildLivePack,
  matchKeywords,
  meaningfulHits,
  isStrongKeyword,
  hasRealNewsUrl,
  shortLabel,
  isHotlistPlatform,
  HYBRID_MIN_ITEMS,
  isSurfaceableNewsRow,
  platformLabelFor,
  customerBranchKeywords,
  customerWatchlistSpreadTerms,
  isWatchPlatform,
  type LiveNewsRow,
} from './daily-report-live'
import { isDailyReportPack } from './daily-report-pack'
import {
  buildDailyReportThumbDataUri,
  buildDailyReportThumbSvg,
  chipGlyph,
  hashThumbSeed,
} from './daily-report-thumb'

const NOW = Date.UTC(2026, 8, 22, 8, 0, 0)

function row(partial: Partial<LiveNewsRow> & { title: string; platform: string }): LiveNewsRow {
  return { capturedAt: NOW, ...partial }
}

const KEYWORDS = ['数控', '机床', '招聘', '订单', '三坐标', 'CNC', '乔锋']

describe('matchKeywords', () => {
  it('matches substring on title', () => {
    expect(matchKeywords(row({ title: '国产数控机床突破', platform: 'weibo' }), KEYWORDS)).toEqual([
      '数控',
      '机床',
    ])
  })
  it('is case-insensitive for latin keywords', () => {
    expect(matchKeywords(row({ title: 'CNC 加工', platform: 'weibo' }), ['cnc'])).toEqual(['cnc'])
  })
  it('returns [] when nothing matches', () => {
    expect(matchKeywords(row({ title: '娱乐八卦', platform: 'weibo' }), KEYWORDS)).toEqual([])
  })
  it('raw-matches crime 订单 (filter happens in meaningfulHits)', () => {
    expect(
      matchKeywords(row({ title: '线上报复订单引发关注', platform: 'weibo' }), KEYWORDS),
    ).toEqual(['订单'])
  })
})

describe('meaningfulHits / isStrongKeyword', () => {
  it('treats 数控/机床/CNC as strong', () => {
    expect(isStrongKeyword('数控')).toBe(true)
    expect(isStrongKeyword('机床')).toBe(true)
    expect(isStrongKeyword('CNC')).toBe(true)
    expect(isStrongKeyword('三坐标')).toBe(true)
  })
  it('treats 订单/招聘/采购 as ultra-generic (not strong)', () => {
    expect(isStrongKeyword('订单')).toBe(false)
    expect(isStrongKeyword('招聘')).toBe(false)
    expect(isStrongKeyword('采购')).toBe(false)
  })
  it('drops generic-only hit sets', () => {
    expect(meaningfulHits(['订单'])).toEqual([])
    expect(meaningfulHits(['招聘', '订单'])).toEqual([])
  })
  it('keeps strong + trailing generics when industrial hit present', () => {
    expect(meaningfulHits(['订单', '数控', '招聘'])).toEqual(['数控', '订单', '招聘'])
  })
  it('rejects too-short latin tokens', () => {
    expect(isStrongKeyword('cn')).toBe(false)
    expect(isStrongKeyword('ab')).toBe(false)
  })
})

describe('hasRealNewsUrl', () => {
  it('requires http(s) publisher url (rejects Google News wrappers)', () => {
    expect(hasRealNewsUrl(row({ title: 'x', platform: 'weibo' }))).toBe(false)
    expect(hasRealNewsUrl(row({ title: 'x', platform: 'weibo', url: '' }))).toBe(false)
    expect(hasRealNewsUrl(row({ title: 'x', platform: 'weibo', url: 'ftp://x' }))).toBe(false)
    expect(hasRealNewsUrl(row({ title: 'x', platform: 'weibo', url: 'https://news.example/1' }))).toBe(
      true,
    )
    expect(
      hasRealNewsUrl(
        row({
          title: 'x',
          platform: 'rss:gnews',
          url: 'https://news.google.com/rss/articles/CBMid0FVX3lxTE54WGJs?oc=5',
        }),
      ),
    ).toBe(false)
  })
})

describe('shortLabel', () => {
  it('strips RSS source suffix', () => {
    expect(shortLabel('国产数控机床突破 - 搜狐网')).toBe('国产数控机床突破')
  })
  it('caps long titles with ellipsis', () => {
    const out = shortLabel('x'.repeat(80), 20)
    expect(out.length).toBeLessThanOrEqual(20)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('isHotlistPlatform', () => {
  it('treats rss:* as non-hotlist', () => {
    expect(isHotlistPlatform('rss:gnews-cnc')).toBe(false)
    expect(isHotlistPlatform('weibo')).toBe(true)
  })
})

describe('daily-report-thumb', () => {
  it('emits deterministic svg data-uri', () => {
    const a = buildDailyReportThumbDataUri({
      title: '数控机床订单回暖',
      kind: '商机',
      chips: ['数控', '机床'],
    })
    const b = buildDailyReportThumbDataUri({
      title: '数控机床订单回暖',
      kind: '商机',
      chips: ['数控', '机床'],
    })
    expect(a).toBe(b)
    expect(a.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    const svg = buildDailyReportThumbSvg({ title: 'x', kind: '转机', chips: ['乔锋'] })
    expect(svg).toContain('<svg')
    expect(svg).toContain('转机')
    expect(svg).toContain('乔锋')
    expect(svg).not.toMatch(/#7c3aed|#a855f7|purple/i)
  })
  it('varies stripe by title seed', () => {
    expect(hashThumbSeed('a')).not.toBe(hashThumbSeed('b'))
  })
  it('truncates long chip glyphs', () => {
    expect(chipGlyph('三坐标测量', 4).length).toBeLessThanOrEqual(4)
  })
})

describe('buildLivePack', () => {
  const rows: LiveNewsRow[] = [
    row({
      title: '国产数控机床订单创新高 - 搜狐网',
      platform: 'weibo',
      url: 'https://a/1',
    }),
    row({
      title: '数控人才招聘会火热 - 红网',
      platform: 'weibo',
      url: 'https://a/2',
    }),
    row({
      title: '三坐标测量机需求增长 - 维度网',
      platform: 'rss:gnews-cmm',
      url: 'https://a/3',
    }),
    row({
      title: '机床企业扩产 - 新浪',
      platform: 'zhihu',
      url: 'https://a/4',
    }),
    row({ title: '娱乐八卦 - 微博', platform: 'weibo', url: 'https://a/noise' }),
  ]

  const result = buildLivePack(rows, {
    date: '2026-09-22',
    generatedAt: '2026-09-22T08:00:00Z',
    keywords: KEYWORDS,
  })

  it('produces a schema-valid pack', () => {
    expect(isDailyReportPack(result.pack)).toBe(true)
  })

  it('uses only real matched rows (drops non-matching)', () => {
    expect(result.counts.rows).toBe(5)
    expect(result.counts.matched).toBe(4)
  })

  it('hero value is the real matched count, not invented', () => {
    expect(result.pack.hero.value).toBe('4')
  })

  it('ranks hotlist hits ahead of rss hits', () => {
    expect(result.pack.opportunities[0].kind).toBe('商机')
  })

  it('labels heat as matched-keyword count and growth as platform count', () => {
    const first = result.pack.opportunities[0]
    expect(Number(first.heat)).toBeGreaterThanOrEqual(1)
    expect(Number(first.growth)).toBeGreaterThanOrEqual(1)
  })

  it('carries real chips (matched keywords) and href on every item', () => {
    for (const o of result.pack.opportunities) {
      expect(o.href).toMatch(/^https?:\/\//)
      expect(o.chips?.length).toBeGreaterThan(0)
    }
    for (const s of result.pack.stories) {
      expect(s.href).toMatch(/^https?:\/\//)
    }
  })

  it('sets bundled SVG imageUrl on every opportunity and story', () => {
    for (const o of result.pack.opportunities) {
      expect(o.imageUrl?.startsWith('data:image/svg+xml')).toBe(true)
    }
    for (const s of result.pack.stories) {
      expect(s.imageUrl?.startsWith('data:image/svg+xml')).toBe(true)
    }
  })

  it('drops crime news that only matches 订单', () => {
    const crime = buildLivePack(
      [
        row({
          title: '线上报复订单引发关注',
          platform: 'weibo',
          url: 'https://crime.example/1',
        }),
        row({
          title: '国产数控机床突破',
          platform: 'weibo',
          url: 'https://industry.example/1',
        }),
      ],
      { date: '2026-09-22', generatedAt: 'x', keywords: KEYWORDS },
    )
    expect(crime.counts.matched).toBe(1)
    expect(crime.pack.opportunities.every((o) => !o.label.includes('报复'))).toBe(true)
    expect(crime.pack.stories.every((s) => !s.title.includes('报复'))).toBe(true)
  })

  it('drops rows without a real news url before ranking', () => {
    const mixed = buildLivePack(
      [
        row({ title: '国产数控机床突破', platform: 'weibo' }),
        row({ title: '机床企业扩产', platform: 'zhihu', url: 'not-a-url' }),
        row({
          title: '三坐标测量机需求',
          platform: 'weibo',
          url: 'https://ok.example/cmm',
        }),
      ],
      { date: '2026-09-22', generatedAt: 'x', keywords: KEYWORDS },
    )
    expect(mixed.counts.matched).toBe(1)
    expect(mixed.pack.opportunities[0].href).toBe('https://ok.example/cmm')
    // A single distinct matched row fills the 商机 card; stories stay empty
    // rather than echoing the same item (sections are disjoint).
    expect(mixed.pack.stories).toHaveLength(0)
  })

  it('keeps 订单 when paired with an industrial hit', () => {
    const paired = buildLivePack(
      [
        row({
          title: '数控机床订单创新高',
          platform: 'weibo',
          url: 'https://ok.example/order',
        }),
      ],
      { date: '2026-09-22', generatedAt: 'x', keywords: KEYWORDS },
    )
    expect(paired.counts.matched).toBe(1)
    expect(paired.pack.opportunities[0].chips).toContain('数控')
  })

  it('drops rows with a publish-day older than the rolling window (evergreen 深度报告 leak)', () => {
    // capturedAt = NOW (ingested today); publishedAt = 2023 — the row is old
    // "预见2023/2024 全景图谱" SEO content and must NOT surface on a 2026 report.
    const old = buildLivePack(
      [
        row({
          title: '预见2023:2023年中国数控机床市场供需及发展前景',
          platform: 'rss:bing-guochantidai',
          url: 'https://old.example/1',
          publishedAt: Date.parse('2023-06-08T00:00:00Z'),
        }),
        // a fresh in-window row must still surface
        row({
          title: '国产数控机床订单创新高',
          platform: 'weibo',
          url: 'https://fresh.example/1',
        }),
      ],
      { date: '2026-09-22', generatedAt: 'x', keywords: KEYWORDS },
    )
    // only the fresh row is in-window → matched=1, no 预见 surfaced
    expect(old.counts.matched).toBe(1)
    const surfaced = [
      ...old.pack.opportunities.map((o) => o.label),
      ...old.pack.stories.map((s) => s.title),
    ].join(' ')
    expect(surfaced).not.toContain('预见2023')
    expect(surfaced).toContain('订单创新高')
  })

  it('emits a 7-point sparkline per item', () => {
    expect(result.pack.opportunities[0].sparkline).toHaveLength(7)
    expect(result.pack.hero.sparkline).toHaveLength(7)
  })

  it('labels sparkline Day1…Day7 (oldest → report day)', () => {
    expect(result.pack.hero.dayLabels).toEqual([
      'Day1',
      'Day2',
      'Day3',
      'Day4',
      'Day5',
      'Day6',
      'Day7',
    ])
    expect(result.pack.hero.dayDates).toEqual([
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
    ])
    expect(result.pack.hero.meta).toContain('2026-09-16–2026-09-22')
  })

  it('hero matched count is report-day only; prior days feed sparkline', () => {
    const prior = Date.UTC(2026, 8, 20, 8, 0, 0) // 2026-09-20
    const withHistory = buildLivePack(
      [
        ...rows,
        row({
          title: '数控机床昨日订单',
          platform: 'weibo',
          url: 'https://a/prior',
          capturedAt: prior,
        }),
      ],
      { date: '2026-09-22', generatedAt: 'x', keywords: KEYWORDS },
    )
    // Same-day matched stays 4; prior row is window-only.
    expect(withHistory.counts.matched).toBe(4)
    expect(withHistory.counts.windowMatched).toBe(5)
    expect(withHistory.pack.hero.value).toBe('4')
    expect(withHistory.pack.hero.sparkline[withHistory.pack.hero.sparkline.length - 1]).toBe(4)
    // Day5 = 2026-09-20 when Day7 = 2026-09-22 → index 4
    expect(withHistory.pack.hero.sparkline[4]).toBe(1)
  })

  it('is not thin when >= HYBRID_MIN_ITEMS items', () => {
    expect(result.counts.items).toBeGreaterThanOrEqual(HYBRID_MIN_ITEMS)
    expect(result.thin).toBe(false)
  })

  it('is thin on an empty live day', () => {
    const empty = buildLivePack([], { date: '2026-09-22', generatedAt: 'x', keywords: KEYWORDS })
    expect(empty.thin).toBe(true)
    expect(empty.counts.matched).toBe(0)
    expect(empty.pack.opportunities).toHaveLength(0)
  })

  it('is thin when matched rows are below threshold', () => {
    const thin = buildLivePack([rows[0]], { date: '2026-09-22', generatedAt: 'x', keywords: KEYWORDS })
    expect(thin.thin).toBe(true)
  })

  it('computes honest growth vs previous pack hero value', () => {
    const prev = { ...result.pack, hero: { ...result.pack.hero, value: '2' } }
    const grown = buildLivePack(rows, {
      date: '2026-09-22',
      generatedAt: 'x',
      keywords: KEYWORDS,
      previous: prev,
    })
    expect(grown.pack.hero.delta).toBe('+100%')
  })

  it('shows — delta when no previous pack', () => {
    expect(result.pack.hero.delta).toBe('—')
  })

  it('dedupes syndicated duplicate titles', () => {
    const dup = buildLivePack(
      [
        row({ title: '数控机床订单创新高 - A', platform: 'weibo', url: 'https://a/1' }),
        row({ title: '数控机床订单创新高 - B', platform: 'zhihu', url: 'https://a/2' }),
      ],
      { date: '2026-09-22', generatedAt: 'x', keywords: KEYWORDS },
    )
    expect(dup.counts.matched).toBe(2)
    expect(dup.pack.opportunities).toHaveLength(1)
  })

  it('honors maxOpportunities / maxTrendRows / maxStories', () => {
    const capped = buildLivePack(rows, {
      date: '2026-09-22',
      generatedAt: 'x',
      keywords: KEYWORDS,
      maxOpportunities: 1,
      maxTrendRows: 2,
      maxStories: 1,
    })
    // opportunities pool = maxOpportunities + maxTrendRows = 3 distinct (cards+rows)
    expect(capped.pack.opportunities).toHaveLength(3)
    // stories carved from the REMAINING pool (4 matched − 3 opportunity slots = 1)
    expect(capped.pack.stories).toHaveLength(1)
    // the 4 matched rows fill 3 opportunity slots + 1 story slot, disjoint
    const all = [
      ...capped.pack.opportunities.map((o) => shortLabel(o.label)),
      ...capped.pack.stories.map((s) => shortLabel(s.title)),
    ]
    expect(new Set(all).size).toBe(all.length)
    expect(capped.counts.items).toBe(4)
  })

  it('carves stories disjoint from opportunities (no echo)', () => {
    const many = buildLivePack(
      [
        ...rows,
        row({ title: '数控机床出口创新高', platform: 'weibo', url: 'https://a/5' }),
        row({ title: '三坐标测量机新品发布', platform: 'rss:gnews-cmm', url: 'https://a/6' }),
        row({ title: '重型数控龙门镗铣床', platform: 'zhihu', url: 'https://a/7' }),
        row({ title: '牧野机床新工厂开工', platform: 'weibo', url: 'https://a/8' }),
        row({ title: '数控车床需求回暖', platform: 'rss:gnews-cmm', url: 'https://a/9' }),
        row({ title: '龙门铣床数控订单', platform: 'weibo', url: 'https://a/10' }),
        row({ title: '车铣复合机床热销', platform: 'zhihu', url: 'https://a/11' }),
      ],
      { date: '2026-09-22', generatedAt: 'x', keywords: KEYWORDS },
    )
    const cardLabels = many.pack.opportunities.slice(0, 3).map((o) => shortLabel(o.label))
    const rowLabels = many.pack.opportunities.slice(3).map((o) => shortLabel(o.label))
    const storyLabels = many.pack.stories.map((s) => shortLabel(s.title))
    const all = [...cardLabels, ...rowLabels, ...storyLabels]
    expect(new Set(all).size).toBe(all.length) // fully disjoint across sections
    // 11 matched distinct rows: cards(3) + rows(8) + stories(remaining)
    expect(many.counts.matched).toBe(11)
    expect(many.pack.opportunities).toHaveLength(11)
    expect(many.counts.items).toBeGreaterThanOrEqual(HYBRID_MIN_ITEMS)
  })

  it('window-fallback does NOT pad the surfaced sections on a thin report day (no prior-day echo)', () => {
    const prior = Date.UTC(2026, 8, 20, 8, 0, 0) // 2026-09-20
    const windowed = buildLivePack(
      [
        // only ONE report-day match, plus 4 prior-window matches (different days)
        row({ title: '今日数控机床成交', platform: 'weibo', url: 'https://a/today' }),
        row({ title: '昨日机床扩产', platform: 'weibo', url: 'https://a/p1', capturedAt: prior }),
        row({ title: '前日五轴数控出口', platform: 'weibo', url: 'https://a/p2', capturedAt: prior }),
        row({ title: '昨日慢走丝机床新品', platform: 'weibo', url: 'https://a/p3', capturedAt: prior }),
        row({ title: '前日数控机床工厂', platform: 'weibo', url: 'https://a/p4', capturedAt: prior }),
      ],
      { date: '2026-09-22', generatedAt: 'x', keywords: KEYWORDS },
    )
    // hero stays report-day-only (honest)
    expect(windowed.pack.hero.value).toBe('1')
    expect(windowed.counts.matched).toBe(1)
    // 5 distinct matches across the window, but the report day contributes just 1
    expect(windowed.counts.windowMatched).toBe(5)
    // surfaced sections come from the report day ONLY — no prior-day echo into today
    expect(windowed.pack.opportunities.length).toBe(1)
    for (const o of windowed.pack.opportunities) {
      expect(o.label).toContain('今日')
    }
    expect(windowed.pack.stories.length).toBe(0)
  })

  it('marks source live (real data)', () => {
    expect(result.pack.source).toBe('live')
  })

  it('hero falls back to the 7-day window total when the report day is empty (never 0)', () => {
    const prior = Date.UTC(2026, 8, 22, 8, 0, 0) // 2026-09-22 (report day is 09-23)
    const sparse = buildLivePack(
      [
        row({ title: '数控机床扩产', platform: 'weibo', url: 'https://a/p1', capturedAt: prior }),
        row({ title: '数控机床出口', platform: 'weibo', url: 'https://a/p2', capturedAt: prior }),
        row({ title: '数控招聘火爆', platform: 'weibo', url: 'https://a/p3', capturedAt: prior }),
      ],
      { date: '2026-09-23', generatedAt: 'x', keywords: KEYWORDS },
    )
    // report day (09-23) has 0 matches → hero shows the 7-day window total, not 0
    expect(sparse.counts.matched).toBe(0)
    expect(sparse.counts.windowMatched).toBe(3)
    expect(sparse.pack.hero.value).toBe('3')
    // delta is — on fallback (no day-vs-prev comparison)
    expect(sparse.pack.hero.delta).toBe('—')
  })

  it('excludes non-CN sources from the pool (sales-first, CN audience)', () => {
    const withEn = buildLivePack(rows, {
      date: '2026-09-22',
      generatedAt: 'x',
      keywords: KEYWORDS,
      excludePlatforms: ['rss:hacker-news', 'rss:yahoo-finance', 'rss:gnews-fanuc-en'],
    })
    // the base `rows` fixture has no EN platforms, so nothing is dropped here
    expect(withEn.counts.matched).toBe(4)
    // now add an EN feed and confirm it is excluded from ranking/hero
    const mixed = buildLivePack(
      [
        ...rows,
        row({ title: 'FANUC CNC global sales', platform: 'rss:hacker-news', url: 'https://en/1' }),
        row({ title: 'US machine tool index', platform: 'rss:yahoo-finance', url: 'https://en/2' }),
      ],
      { date: '2026-09-22', generatedAt: 'x', keywords: KEYWORDS, excludePlatforms: ['rss:hacker-news', 'rss:yahoo-finance', 'rss:gnews-fanuc-en'] },
    )
    expect(mixed.counts.matched).toBe(4) // the 2 EN rows are excluded
    expect(mixed.pack.opportunities.length).toBe(4)
    for (const s of mixed.pack.stories) {
      expect(s.title).not.toMatch(/FANUC CNC|machine tool index/i)
    }
  })

  it('buckets rows into the report day by publishedAt (real publish day), not capturedAt', () => {
    // All three rows share one ingest capturedAt=report day, but their REAL
    // publish dates are 09-21, 09-22, and 09-23. Only the 09-23 row counts
    // toward the 09-23 report; the older ones are window (sparkline) hits.
    const report = Date.UTC(2026, 8, 23, 8, 0, 0)   // 2026-09-23 report day
    const ingestToday = Date.UTC(2026, 8, 23, 6, 0, 0)
    const rows = [
      row({ title: '今日数控机床投产', platform: 'weibo', url: 'https://a/t1', capturedAt: ingestToday, publishedAt: Date.UTC(2026, 8, 23, 10, 0, 0) }),
      row({ title: '昨日机床扩产', platform: 'weibo', url: 'https://a/t2', capturedAt: ingestToday, publishedAt: Date.UTC(2026, 8, 22, 10, 0, 0) }),
      row({ title: '前日五轴数控出口', platform: 'weibo', url: 'https://a/t3', capturedAt: ingestToday, publishedAt: Date.UTC(2026, 8, 21, 10, 0, 0) }),
    ]
    const res = buildLivePack(rows, { date: '2026-09-23', generatedAt: 'x', keywords: ['数控', '机床'] })
    // report day = only the publishedAt-09-23 row
    expect(res.counts.matched).toBe(1)
    // matched titles all inside the 7d window
    expect(res.counts.windowMatched).toBe(3)
    // hero shows report-day count (honest), not the collapsed ingest-day total
    expect(res.pack.hero.value).toBe('1')
    // surfacing respects publish day: only the 09-23 report-day row is surfaced;
    // the 09-21/09-22 rows are window-sparkline hits only, NOT surfaced (so today's
    // report never echoes prior-day news).
    const startedDays = res.pack.opportunities.map((o) => o.started)
    expect(startedDays).toEqual(['2026-09-23'])
    expect(res.pack.stories.length).toBe(0)
    // no surfaced item is stamped after the window head
    for (const sd of startedDays) {
      expect(sd <= '2026-09-23').toBe(true)
    }
  })

  it('sparkline spreads rows by publishedAt across Day1..Day7 (no single-day spike)', () => {
    const report = Date.UTC(2026, 8, 23, 8, 0, 0)
    const ingestToday = Date.UTC(2026, 8, 23, 6, 0, 0)
    const titles = ['数控A', '数控B', '数控C', '数控D', '数控E', '数控F', '数控G']
    const rows = titles.map((t, i) =>
      row({
        title: t,
        platform: 'weibo',
        url: `https://a/${i}`,
        capturedAt: ingestToday, // all ingested same day (single ingest run)
        publishedAt: Date.UTC(2026, 8, 23 - (6 - (i % 7)), 10, 0, 0), // spread over 7 publish days
      }),
    )
    const res = buildLivePack(rows, { date: '2026-09-23', generatedAt: 'x', keywords: ['数控'] })
    // sparkline = per-publish-day count over 7 days; each Day1..Day7 has >=1 (7 distinct publish days)
    const spark = res.pack.hero.sparkline
    expect(spark).toHaveLength(7)
    for (const v of spark) {
      expect(v).toBeGreaterThan(0)
    }
    // and NOT a single-day spike (the old capturedAt collapse would put all 7 on Day7)
    const max = Math.max(...spark)
    const min = Math.min(...spark)
    expect(max - min).toBeLessThanOrEqual(1)
  })
})

describe('isSurfaceableNewsRow (rss:watch-*)', () => {
  it('surfaces a customer-spread row by title alone (no publisher URL), like gnews/bing', () => {
    expect(
      isSurfaceableNewsRow(row({ title: '某下游客户扩产', platform: 'rss:watch-acme-cnc' })),
    ).toBe(true)
    expect(
      isSurfaceableNewsRow(row({ title: '', platform: 'rss:watch-acme-cnc' })),
    ).toBe(false)
  })
  it('still requires a real URL for non-feed platforms', () => {
    expect(isSurfaceableNewsRow(row({ title: 'x', platform: 'weibo' }))).toBe(false)
    expect(
      isSurfaceableNewsRow(row({ title: 'x', platform: 'weibo', url: 'https://a.example.com/1' })),
    ).toBe(true)
  })
  it('prefers the caller platformLabels map for customer platforms', () => {
    expect(platformLabelFor('rss:watch-acme-cnc')).toBe('watch-acme-cnc')
    expect(platformLabelFor('rss:watch-acme-cnc', { 'watch-acme-cnc': '铩硕精密' })).toBe('铩硕精密')
  })
})

describe('customerWatchlistSpreadTerms', () => {
  it('builds name + aliases + branch terms (deduped, normalized)', () => {
    const terms = customerWatchlistSpreadTerms({
      name: '铩硕精密',
      aliases: ['SASO', '铩硕'],
      downstreamBranch: '压铸',
    })
    expect(terms).toContain('铩硕精密')
    expect(terms).toContain('SASO')
    expect(terms).toContain('压铸')
    expect(terms).toContain('die-casting')
    // no duplicate raw names for a dup alias (same normalized term)
    expect(terms.filter((t) => t === '铩硕精密').length).toBe(1)
  })
  it('generic 其他 branch spreads on name/aliases only (no branch terms)', () => {
    expect(customerBranchKeywords('其他')).toEqual([])
    expect(customerWatchlistSpreadTerms({ name: '某客户', downstreamBranch: '其他' })).toEqual([
      '某客户',
    ])
  })
})

describe('isWatchPlatform + watch-over-generic dedupe', () => {
  it('flags rss:watch-* platforms', () => {
    expect(isWatchPlatform('rss:watch-铩硕精密-压铸')).toBe(true)
    expect(isWatchPlatform('rss:gnews-diecast')).toBe(false)
    expect(isWatchPlatform('weibo')).toBe(false)
  })

  it('prefers the customer (rss:watch-*) row when the same article is also a gnews feed row', () => {
    const gen = row({
      title: '从小五金到制造革命：一体化压铸为何在珠三角落地生根？',
      platform: 'rss:gnews-diecast',
      url: 'https://gnews.example/1',
      publishedAt: Date.UTC(2026, 8, 25, 2, 0, 0),
    })
    const watch = row({
      title: '从小五金到制造革命：一体化压铸为何在珠三角落地生根？',
      platform: 'rss:watch-铩硕精密-压铸',
      url: 'https://bing.example/watch',
      publishedAt: Date.UTC(2026, 8, 25, 3, 0, 0),
    })
    const res = buildLivePack([gen, watch], {
      date: '2026-09-25',
      generatedAt: 'x',
      keywords: ['压铸', '铩硕精密'],
      platformLabels: { 'watch-铩硕精密-压铸': '铩硕精密' },
    })
    const all = [
      ...(res.pack.downstream ?? []),
      ...res.pack.opportunities,
      ...res.pack.stories,
    ]
    expect(all.length).toBeGreaterThan(0)
    for (const it of all as Array<{ title?: string; source?: string }>) {
      if (it.title?.includes('从小五金')) {
        expect(it.source).toBe('铩硕精密')
      }
    }
  })
})
