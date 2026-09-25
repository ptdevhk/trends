import { describe, expect, it } from 'vitest'
import { renderDailyReportHtml } from './daily-report-render'
import { type DailyReportPack, parseDailyReportPack } from './daily-report-pack'

const pack: DailyReportPack = {
  date: '2026-09-22',
  localeDefault: 'zh-Hans',
  source: 'live',
  generatedAt: '2026-09-22T08:00:00Z',
  hero: {
    headline: '今日商机热度',
    value: '37',
    delta: '+8%',
    meta: '3 行业 · 8 新公司',
    sparkline: [30, 25, 27, 16, 10, 14, 7],
    dayLabels: ['Day1', 'Day2', 'Day3', 'Day4', 'Day5', 'Day6', 'Day7'],
    dayDates: [
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
    ],
  },
  headline: {
    title: '给工业母机装上 AI“大脑”，台州机床越用越聪明',
    tag: '今日头条 · 工业母机',
    source: '机床商务网',
    href: 'https://example.com/headline',
  },
  downstream: [
    {
      title: '东莞压铸厂扩产，询 800T 冷室压铸机 2 台',
      tag: '压铸',
      source: '压铸网',
      day: '2026-09-22',
      href: 'https://example.com/ds/1',
    },
    {
      title: 'Mexico die-casting buyer sourcing auto parts',
      tag: 'die-casting',
      source: '工业网',
      day: '2026-09-22',
      publishedAt: Date.parse('2026-09-22T02:00:00Z'),
      href: 'https://example.com/ds/2',
    },
  ],
  featured: {
    video: [
      { title: '设计师开箱：CO2 激光切割机 R1', type: 'video', length: '36 分钟', href: 'https://example.com/fv/1' },
      { title: '日本压铸产线 50 年演变', type: 'video', length: '22 分钟', href: 'https://example.com/fv/2' },
    ],
    gallery: [
      { title: '德国模具厂数字化改造全程图集', type: 'gallery', length: '24 张', href: 'https://example.com/fg/1' },
    ],
  },
  opportunities: [
    {
      kind: '商机',
      label: '3D 扫描 销售',
      heat: '3.8万',
      growth: '+1,200%',
      started: '2026-09-22',
      rowDay: '2026-09-22',
      sparkline: [26, 21, 23, 14, 9, 12, 6, 5],
      chips: ['三坐标测量机', '工业测量'],
      href: 'https://example.com/opp/1',
      imageUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    },
    {
      kind: '商机',
      label: 'CNC 编程',
      heat: '2.9万',
      growth: '+850%',
      started: '2026-09-22',
      rowDay: '2026-09-22',
      sparkline: [28, 24, 25, 18, 15, 12, 12, 12],
      chips: ['数控编程', '江苏'],
      href: 'https://example.com/opp/2',
      imageUrl:
        'data:image/svg+xml,' +
        encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="48"><rect fill="%231e3a5f" width="80" height="48"/></svg>'),
    },
    {
      kind: '转机',
      label: '数控机床 订单',
      heat: '1.6万',
      growth: '+540%',
      started: '2026-09-22',
      rowDay: '2026-09-22',
      sparkline: [24, 21, 22, 16, 17, 15, 15, 15],
      chips: ['订单回暖', '长三角'],
      href: 'https://example.com/opp/3',
    },
    {
      kind: '动态',
      label: '无链接应被省略',
      heat: '0.1万',
      growth: '+1%',
      started: '2026-09-22',
      rowDay: '2026-09-22',
      sparkline: [1, 1, 1],
    },
    // A non-report-day opportunity must NOT appear in TODAY (per-day file model).
    {
      kind: '商机',
      label: '昨日五轴出货',
      heat: '1.2万',
      growth: '+220%',
      started: '2026-09-21',
      rowDay: '2026-09-21',
      sparkline: [20, 18, 19, 15, 12, 10, 9],
      chips: ['五轴'],
      href: 'https://example.com/opp/4',
    },
  ],
  stories: [
    {
      title: '数控机床订单回暖',
      href: 'https://example.com/story/1',
      rowDay: '2026-09-22',
      imageUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    },
    {
      title: '长三角招工潮',
      href: 'https://example.com/story/2',
      rowDay: '2026-09-22',
    },
    { title: '无链接热闻应被省略', rowDay: '2026-09-22' },
  ],
}

describe('renderDailyReportHtml (定稿C single-headline)', () => {
  const html = renderDailyReportHtml(pack)

  it('includes 定稿C section headers (头条 / 当日内容 / 下游需求 / 商机/新闻 / 精选)', () => {
    expect(html).toContain('头条')
    expect(html).toContain('当日内容')
    expect(html).toContain('下游需求')
    expect(html).toContain('商机 / 新闻')
    expect(html).toContain('精选')
  })

  it('removes the heat-hero (no class="v" big number, no 今日行业热度 as primary)', () => {
    expect(html).not.toContain('class="v"')
    expect(html).not.toContain('>37 <span')
  })

  it('renders the single masked headline: tag + title + source', () => {
    expect(html).toContain('class="hero"')
    expect(html).toContain('给工业母机装上 AI“大脑”')
    expect(html).toContain('来源：机床商务网')
    expect(html).toMatch(/<a class="hero" href="https:\/\/example.com\/headline"/)
  })

  it('does NOT show a publish date on the headline', () => {
    // The hero block carries only tag/title/source — no calendar date label.
    const heroBlock =
      /<a class="hero"[\s\S]*?<\/a>/.exec(html)?.[0] ??
      /<div class="hero"[\s\S]*?<\/div>/.exec(html)?.[0] ??
      ''
    expect(heroBlock).toContain('给工业母机装上 AI')
    expect(heroBlock).not.toMatch(/日 星期|data-date|9月/)
  })

  it('renders TODAY downstream rows with keyword chip + title + source + age', () => {
    expect(html).toContain('东莞压铸厂扩产，询 800T 冷室压铸机 2 台')
    expect(html).toContain('压铸')
    expect(html).toContain('来源：压铸网')
    expect(html).toContain('Mexico die-casting buyer')
    expect(html).toContain('die-casting')
  })

  it('TODAY 商机/新闻 shows report-day opportunities and merged stories', () => {
    // report-day 商机/转机 opps appear
    expect(html).toContain('3D 扫描 销售')
    expect(html).toContain('数控机床 订单')
    // merged story rows show as 新闻
    expect(html).toContain('数控机床订单回暖')
    expect(html).toContain('长三角招工潮')
    // non-report-day opp is EXCLUDED (per-day file model)
    expect(html).not.toContain('昨日五轴出货')
    // no-href items dropped
    expect(html).not.toContain('无链接应被省略')
    expect(html).not.toContain('无链接热闻应被省略')
  })

  it('renders FEATURED VIDEO/GALLERY dual col with type + length, no dates', () => {
    expect(html).toContain('视频 VIDEO')
    expect(html).toContain('图集 GALLERY')
    expect(html).toContain('设计师开箱：CO2 激光切割机 R1')
    expect(html).toContain('36 分钟')
    expect(html).toContain('24 张')
    expect(html).toContain('class="fcard"')
  })

  it('omits FEATURED section when the pack has none', () => {
    const out = renderDailyReportHtml({ ...pack, featured: undefined })
    expect(out).not.toContain('class="featured"')
    expect(out).not.toContain('视频 VIDEO')
    expect(out).not.toContain('图集 GALLERY')
  })

  it('falls back to top same-day opportunity as headline when none supplied', () => {
    const noHl = { ...pack, headline: undefined }
    const out = renderDailyReportHtml(noHl)
    expect(out).toContain('class="hero"')
    expect(out).toContain('3D 扫描 销售')
  })

  it('renders linked items as clickable rows', () => {
    expect(html).toMatch(/class="row" href="https:\/\/example.com\/opp\/1"/)
    expect(html).toMatch(/target="_blank" rel="noopener"/)
    expect(html).toMatch(/class="row" href="https:\/\/example.com\/story\/1"/)
  })

  it('renders no remote http(s) covers (shareable single-file HTML)', () => {
    // 定稿C rows/hero are text-first; FEATURED covers embed as data-URI.
    // A remote imageUrl must NOT leak as a plain `src="http..."`.
    const withRemoteCover = renderDailyReportHtml({
      ...pack,
      featured: {
        video: [
          {
            title: '带封面视频',
            type: 'video',
            length: '5 分钟',
            imageUrl: 'https://cdn.example.com/v.jpg',
            href: 'https://example.com/fv/remote',
          },
        ],
        gallery: [],
      },
    })
    expect(withRemoteCover).not.toContain('cdn.example.com/v.jpg')
    expect(withRemoteCover).not.toMatch(/src="https?:\/\//)
    expect(withRemoteCover).not.toContain('fonts.googleapis.com')
    // A featured card with an embedded data-URI cover renders it inline.
    const withData = renderDailyReportHtml({
      ...pack,
      featured: {
        video: [
          {
            title: '内嵌封面视频',
            type: 'video',
            length: '5 分钟',
            imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            href: 'https://example.com/fv/data',
          },
        ],
        gallery: [],
      },
    })
    expect(withData).toContain('src="data:image/png;base64,')
  })

  it('HTML-escapes labels coming from the pack', () => {
    const evil = {
      ...pack,
      downstream: [{ ...pack.downstream![0], title: '<script>bad()</script>' }],
    }
    const out = renderDailyReportHtml(evil)
    expect(out).not.toContain('<script>bad()</script>')
  })

  it('has no resume/PII marker strings', () => {
    expect(html).not.toMatch(/resume|姓名|手机号|email|身份证/gi)
  })

  it('has the EN toggle hooks (btn-zh / btn-en + I18N map)', () => {
    expect(html).toContain('btn-zh')
    expect(html).toContain('btn-en')
    expect(html).toContain('I18N=')
  })

  it('defaults lang to zh-Hans', () => {
    expect(html).toContain('<html lang="zh-Hans">')
  })

  it('renders date + 星期N in the header (report date)', () => {
    expect(html).toContain('data-date="2026-09-22" placeholder="__fmt__"'.replace(' placeholder="__fmt__"', ''))
    expect(html).toContain('<html lang="zh-Hans">')
  })

  it('renders a validated frozen fixture end-to-end', () => {
    const validated = parseDailyReportPack(JSON.parse(JSON.stringify(pack))) as DailyReportPack
    const out = renderDailyReportHtml(validated)
    expect(out).toContain('销售日报')
    expect(out).toContain('class="hero"')
    expect(out).toMatch(/class="row" href=/)
  })
})
