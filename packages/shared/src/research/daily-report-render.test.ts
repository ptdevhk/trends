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
    sparkline: [30, 25, 27, 16, 10, 14, 7, 4],
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
      imageUrl: 'https://example.com/thumbs/scan.jpg',
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
  ],
  stories: [
    {
      title: '数控机床订单回暖',
      href: 'https://example.com/story/1',
      imageUrl: 'https://example.com/thumbs/story1.jpg',
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
    expect(rows).toBe(3)
    expect(html).toContain('<a href="https://example.com/opp/2" class="row"')
  })

  it('renders hot stories as clickable rows with thumbs', () => {
    expect(html).toContain('<a href="https://example.com/story/1" class="story"')
    expect(html).toContain('src="https://example.com/thumbs/story1.jpg"')
    expect(html).not.toContain('无链接热闻应被省略')
  })

  it('shows img thumbs for http(s) and SVG data-URI imageUrl', () => {
    expect(html).toContain('src="https://example.com/thumbs/scan.jpg"')
    expect(html).toContain('src="data:image/svg+xml,')
    expect(html).toMatch(/object-fit:\s*cover/)
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
    expect(out).toContain('<circle cx="12" cy="12" r="8"')
    expect(out).toContain('<a href="https://example.com/opp/svg"')
  })

  it('embeds sparkline SVGs (hero + cards + rows)', () => {
    expect(html.match(/<svg/g)?.length).toBeGreaterThanOrEqual(7)
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
