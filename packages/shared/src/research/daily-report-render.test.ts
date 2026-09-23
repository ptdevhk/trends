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
    meta: '3 行业 · 8 新公司 · Day1–Day7',
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
  opportunities: [
    {
      kind: '商机',
      label: '3D 扫描 销售',
      heat: '3.8万',
      growth: '+1,200%',
      started: 't1',
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
      started: 't2',
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
      started: 't3',
      sparkline: [24, 21, 22, 16, 17, 15, 15, 15],
      chips: ['订单回暖', '长三角'],
      href: 'https://example.com/opp/3',
    },
    {
      kind: '动态',
      label: '无链接应被省略',
      heat: '0.1万',
      growth: '+1%',
      started: 't4',
      sparkline: [1, 1, 1],
    },
    // Trend-table rows (index 3+) render in 今日趋势, disjoint from the cards.
    {
      kind: '商机',
      label: '行1 五轴出货',
      heat: '1.2万',
      growth: '+220%',
      started: 't5',
      sparkline: [20, 18, 19, 15, 12, 10, 9],
      chips: ['五轴'],
      href: 'https://example.com/opp/4',
    },
    {
      kind: '转机',
      label: '行2 牧野扩产',
      heat: '0.9万',
      growth: '+150%',
      started: 't6',
      sparkline: [16, 15, 15, 13, 11, 10, 9],
      chips: ['牧野'],
      href: 'https://example.com/opp/5',
    },
    {
      kind: '动态',
      label: '行3 电火花回暖',
      heat: '0.7万',
      growth: '+90%',
      started: 't7',
      sparkline: [12, 11, 11, 10, 9, 8, 8],
      chips: ['电火花'],
      href: 'https://example.com/opp/6',
    },
  ],
  stories: [
    {
      title: '数控机床订单回暖',
      href: 'https://example.com/story/1',
      imageUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    },
    {
      title: '长三角招工潮',
      href: 'https://example.com/story/2',
    },
    { title: '无链接热闻应被省略' },
  ],
}

describe('renderDailyReportHtml', () => {
  const html = renderDailyReportHtml(pack)

  it('includes the section headers (今日商机 + 今日趋势 + 热闻)', () => {
    expect(html).toContain('今日商机')
    expect(html).toContain('今日趋势')
    expect(html).toContain('热闻')
  })

  it('includes the big hero number from the pack', () => {
    expect(html).toContain('class="v"')
    expect(html).toContain('>37 <span')
  })

  it('uses pack.hero.delta / meta / headline (not a hardcoded fake +12%)', () => {
    expect(html).toContain(pack.hero.delta)
    expect(html).toContain(pack.hero.meta)
    expect(html).toContain(pack.hero.headline)
    expect(html).not.toContain('▲ +12%')
    // I18N payload must not ship a fake hero delta either
    expect(html).not.toMatch(/"heroD"\s*:/)
  })

  it('renders linked opportunity tiles as <a href=…>', () => {
    const cards = (html.match(/class="tile"/g) ?? []).length
    expect(cards).toBe(3)
    expect(html).toContain('<a href="https://example.com/opp/1"')
    expect(html).toContain('target="_blank" rel="noopener"')
    expect(html).not.toContain('无链接应被省略')
  })

  it('renders trend-table rows as clickable <a href=…>', () => {
    const rows = (html.match(/class="row"/g) ?? []).length
    // Cards = first 3 opps; the remaining opportunities render as trend rows.
    expect(rows).toBe(3)
    expect(html).toContain('<a href="https://example.com/opp/4" class="row"')
  })

  it('shows distinct items in 商机 cards vs 今日趋势 rows (no echo)', () => {
    const cardHrefs = (html.match(/class="tile"/g) ?? []).length
    const rowHrefs = (html.match(/class="row"/g) ?? []).length
    // 3 cards + 3 row items render from a 6-opportunity pool
    expect(cardHrefs).toBe(3)
    expect(rowHrefs).toBe(3)
    // the 3 no-href opportunities (opp index 3 '无链接应被省略') are dropped from rows
    expect(html).not.toContain('无链接应被省略')
  })

  it('renders hot stories as clickable rows with thumbs', () => {
    expect(html).toContain('<a href="https://example.com/story/1" class="story"')
    expect(html).toContain('src="data:image/png;base64,')
    expect(html).not.toContain('无链接热闻应被省略')
  })

  it('shows embedded data-URI thumbs only (shareable single-file HTML)', () => {
    expect(html).toContain('src="data:image/png;base64,')
    expect(html).toContain('src="data:image/svg+xml,')
    expect(html).toMatch(/object-fit:\s*cover/)
    // Remote CDN covers must NOT appear — download/share would break offline.
    expect(html).not.toMatch(/src="https?:\/\//)
    expect(html).not.toContain('fonts.googleapis.com')
  })

  it('rejects remote http(s) imageUrl and falls back to branded SVG plate', () => {
    const remote = {
      ...pack,
      opportunities: [
        {
          ...pack.opportunities[0],
          imageUrl: 'https://cdn.example.com/cover.jpg',
          href: 'https://example.com/opp/remote',
        },
      ],
      stories: [],
    }
    const out = renderDailyReportHtml(remote)
    expect(out).not.toContain('cdn.example.com/cover.jpg')
    expect(out).toMatch(/<img src="data:image\/svg\+xml;charset=utf-8/)
  })

  it('crops story covers to a fixed 4:3 box (not intrinsic portrait height)', () => {
    // Portrait publisher covers (people.cn ~96×206, sina ~96×134) must not
    // stretch the story row — cover is a fixed aspect-ratio crop frame.
    expect(html).toMatch(/\.story \.cover\{[^}]*aspect-ratio:\s*4\/3/)
    expect(html).toMatch(/\.story \.cover img[^}]*object-fit:\s*cover/)
    expect(html).not.toMatch(/\.story \.cover\{[^}]*min-height:\s*64px/)
  })

  it('renders fallback plate as an <img>, never as bare text', () => {
    // A pack item WITHOUT a usable imageUrl must produce an <img src="data:...">
    // (branded plate), NOT a raw-injected SVG string that leaks as text.
    const noImg = {
      ...pack,
      opportunities: [
        {
          ...pack.opportunities[0],
          imageUrl: undefined,
          thumbSvg: undefined,
          href: 'https://example.com/opp/noimg',
        },
      ],
      stories: [],
    }
    const out = renderDailyReportHtml(noImg)
    // must contain an <img whose src is a data:image/svg data URI
    expect(out).toMatch(/<img src="data:image\/svg\+xml;charset=utf-8/)
    // and must NOT contain the raw SVG markup leaked as page text
    expect(out).not.toContain('<svg xmlns="http://www.w3.org/2000/svg" width="320"')
  })

it('embeds thumbSvg when present on a pack item', () => {
    const withSvg = {
      ...pack,
      opportunities: [
        {
          ...pack.opportunities[0],
          imageUrl: undefined,
          href: 'https://example.com/opp/svg',
          thumbSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24"><circle cx="12" cy="12" r="8" fill="#5b8def"/></svg>',
        } as DailyReportPack['opportunities'][number] & { thumbSvg: string },
      ],
      stories: [],
    }
    const out = renderDailyReportHtml(withSvg)
    // thumbSvg is no longer embedded directly; with imageUrl undefined the renderer
    // now uses the branded plate data-URI. Assert the plate SVGs are present instead.
    expect(out).toContain('data:image/svg+xml')
    expect(out).toContain('<a href="https://example.com/opp/svg"')
  })

  it('embeds sparkline SVGs (hero + cards + rows)', () => {
    expect(html.match(/<svg/g)?.length).toBeGreaterThanOrEqual(7)
  })

  it('renders date + 星期N nav under the hero sparkline (not DayN as head)', () => {
    expect(html).toContain('data-testid="hero-day-labels"')
    expect(html).toContain('>09-22<')
    expect(html).toContain('>09-16<')
    expect(html).toContain('>星期二<') // 2026-09-22 was a Tuesday
    expect(html).toContain('>星期三<') // 2026-09-16 was a Wednesday
    expect(html).not.toContain('>Day1<')
    expect(html).not.toContain('>Day7<')
  })

  it('links each day chip to that calendar day’s static report', () => {
    expect(html).toContain('href="/daily/2026-09-16.html"')
    expect(html).toContain('href="/daily/2026-09-22.html"')
    expect(html).toContain('aria-current="page"')
  })

  it('opens day-nav links in the top frame with absolute URLs', () => {
    // Inside the in-app srcDoc iframe, relative hrefs resolve against the parent
    // route and hit research/:companyKey. Absolute /daily/ + target="_top" fixes it.
    expect(html).toContain('href="/daily/2026-09-16.html" target="_top"')
    expect(html).toContain('href="/daily/2026-09-22.html" target="_top"')
    // No relative day links should remain.
    expect(html).not.toMatch(/href="\.\/2026-09-\d{2}\.html"/)
  })

  it('hides nothing in a pic-first file: no prose body text beyond labels', () => {
    expect(html).not.toContain('<p>')
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

  it('HTML-escapes labels coming from the pack', () => {
    const evil = {
      ...pack,
      opportunities: [{ ...pack.opportunities[0], label: '<script>bad()</script>' }],
    }
    const out = renderDailyReportHtml(evil)
    expect(out).not.toContain('<script>bad()</script>')
  })

  it('renders a validated frozen fixture end-to-end', () => {
    const validated = parseDailyReportPack(JSON.parse(JSON.stringify(pack))) as DailyReportPack
    const out = renderDailyReportHtml(validated)
    expect(out).toContain('销售日报')
    expect(out).toContain('<a href=')
  })
})
