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
    expect(mixed.pack.stories[0].href).toBe('https://ok.example/cmm')
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

  it('emits a 7-point sparkline per item', () => {
    expect(result.pack.opportunities[0].sparkline).toHaveLength(7)
    expect(result.pack.hero.sparkline).toHaveLength(7)
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
    expect(capped.pack.opportunities).toHaveLength(1)
    expect(capped.pack.stories).toHaveLength(1)
  })

  it('marks source live (real data)', () => {
    expect(result.pack.source).toBe('live')
  })
})
